import { NextRequest } from "next/server";
import { getModelAlias } from "@/lib/model-rules";
import {
  CONSENSUS_EFFORT,
  COUNCIL_EFFORT,
  COUNCIL_ROUND_TITLES,
  isEffortLevel,
  type CouncilDebateRoundId,
  type EffortLevel,
} from "@/lib/effort";
import { assertSafeUpstreamUrl } from "@/lib/ssrf";

export const runtime = "nodejs";
// A three-round council plus judging and synthesis measured 60s+ end to end,
// well past the 30s serverless default.
export const maxDuration = 300;

// Hard timeout for non-streaming (judge) calls. Prevents a stalled upstream
// from blocking the entire consensus run indefinitely.
const GENERATE_TEXT_TIMEOUT_MS = 45_000;

// Streaming synthesis watchdogs. If the chosen synthesizer/judge produces no
// first token within FIRST_TOKEN_TIMEOUT, the server aborts it and tries the
// next fallback model itself — instead of hanging until the client gives up.
// Once tokens are flowing, IDLE_TIMEOUT catches a mid-stream stall.
const STREAM_FIRST_TOKEN_TIMEOUT_MS = 40_000;
const STREAM_IDLE_TIMEOUT_MS = 40_000;

// While the server is doing non-streaming work (judge scoring) or waiting for
// the synthesizer's first token, it emits a heartbeat this often so the client
// connection watchdog sees liveness and does not abort the whole request while
// the server is still working through its fallback chain.
const HEARTBEAT_INTERVAL_MS = 12_000;

// Starting context budget (chars) for the Default effort level. Pro and Ultra
// raise it (see lib/effort.ts). Halved on each 413/context-too-large retry so
// the synthesizer always gets a response even with many long model answers.
const INITIAL_CONTEXT_BUDGET = 280_000;

// Council debaters only need enough context to understand the topic and debate
// — they don't need the full synthesizer-level transcript. Keeping this small
// reduces latency and avoids context-overflow rejections mid-debate.
const COUNCIL_RESPONSE_BUDGET = 80_000;

// Maximum council notes shown to each debater per turn, at the Default effort
// level. Caps the context that grows each round so later rounds don't hit token
// limits. Pro and Ultra raise it (see lib/effort.ts).
const COUNCIL_HISTORY_CAP = 6;

// The final moderator receives the original answers plus every debate note.
// Keep that synthesis payload well under Groq's smaller request allowance so
// a successful debate cannot fail only at the verdict stage.
const COUNCIL_SYNTHESIS_RESPONSE_BUDGET = 10_000;
const COUNCIL_SYNTHESIS_NOTE_BUDGET = 1_600;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENCODE_URL = "https://opencode.ai/zen/v1/chat/completions";
// Project-scoped "mantle" endpoint. Note .api.aws, and the plain /v1 path —
// the /openai/v1 variant exists but rejects these model ids.
const BEDROCK_URL = "https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions";
const BEDROCK_PREFIX = "bedrock/";
const OPENCODE_PREFIX = "opencode/";
const OLLAMA_PREFIX = "ollama/";
const CLOUD_OLLAMA_PREFIX = "ollama-cloud/";
const CUSTOM_PREFIX = "custom/";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_CLOUD_OLLAMA_BASE_URL = "https://ollama.com";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ResponseEntry = {
  model: string;
  content: string;
};

type RequestBody = {
  prompt: string;
  responses: ResponseEntry[];
  mode?: "single" | "council" | "super";
  qualityMode?: QualityMode;
  consensusModel?: string;
  candidateModels?: string[];
  fallbackModels?: string[];
  moderatorModels?: string[];
  judgeModel?: string;
  judgeFallbackModels?: string[];
  judgeModels?: string[];
  /** Effort tier for this run. Absent/invalid means "default". */
  effort?: EffortLevel;
  apiKey?: string;
  opencodeApiKey?: string;
  bedrockApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaCloudBaseUrl?: string;
  webSearch?: boolean;
};

const JUDGE_CRITERIA = ["accuracy", "relevance", "completeness", "clarity", "citations"] as const;
type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];
type JudgeRanking = {
  model: string;
  scores?: Partial<Record<JudgeCriterion, number>>;
  overall?: number;
  rationale?: string;
};
type JudgeResult = {
  model: string;
  rankings: JudgeRanking[];
  winner?: string;
  confidence?: "high" | "medium" | "low";
};


type ProviderKey = "ollama" | "ollama-cloud" | "opencode" | "groq" | "bedrock" | "custom";
type QualityMode = "quick" | "deep";
type CouncilRoundName = CouncilDebateRoundId;
type CouncilRound = {
  id: CouncilRoundName;
  title: string;
  instruction: string;
};
type CouncilNote = {
  round: CouncilRoundName;
  roundTitle: string;
  modelId: string;
  alias: string;
  content: string;
};
type SendEvent = (event: Record<string, unknown>) => void;

class UpstreamError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MODEL_NAME_RULES = `Refer to sources only by their short model names (e.g. GLM, Kimi, DeepSeek, Ministral, Qwen, Nemotron, GPT).
Never write "Model 1", "Model 2", "the first model", or raw model IDs. Never invent names that were not provided.`;

const QUALITY_RUBRIC = `Judge every candidate answer against this rubric before you decide:
- Correctness: reward claims that are factual, internally consistent, and honest about uncertainty; penalise confident guesses.
- Evidence: prefer answers grounded in the supplied web context or verifiable specifics over unsupported assertions.
- Completeness: the answer must directly and fully satisfy what the user asked — no partial coverage.
- Disagreement handling: surface material conflicts between sources explicitly; never paper over them.
- Missing context: state plainly what cannot be determined from the material provided.
- Decisiveness: commit to one clear recommendation. Do not hedge with a vote tally or "it depends" when the evidence favours an answer.`;

function temporalGrounding(): string {
  const currentDate = new Date().toISOString().slice(0, 10);
  return `The authoritative runtime date is ${currentDate}.
Treat that date as true even if it is later than your training data or knowledge cutoff. Never call it a future or fictional date.
Web search context (Tavily) was provided to all models. Despite having the same web results, some models may ignore them and fall back to outdated training data. Your knowledge cutoff predates the runtime date, so current events in the answers may be unknown to you.
Compare model answers carefully: responses with specific details, dates, names, or citations likely used the web context and should be weighted more heavily than unsourced assertions or vague denials from models that ignored it. When multiple models correctly report the same web-sourced fact, that is strong corroboration. When only a minority correctly reports a fact that has the specificity of a web citation, prefer it over the majority. Do not claim that you independently verified a citation: you can only assess the evidence shown here.`;
}

const QUICK_SECTIONS = `First output the synthesized answer. Then output "---" on its own line. Then output these analysis sections:

**Why this is best**
**Confidence**
**Agreement**
**Disagreement**
**Model notes**`;

const DEEP_SECTIONS = `First output the synthesized answer. Then output "---" on its own line. Then output these analysis sections:

**Why this is best**
**Confidence**
**Quality scorecard**
**Claim checks**
**Agreement**
**Disagreement**
**Missing context**
**Model notes**`;

function synthesisPrompt(mode: QualityMode, solo: boolean, hasJudge: boolean): string {
  const deepInstruction =
    mode === "deep"
      ? `Deep answer mode is enabled. Claim-check the most important statements against only the supplied answers, flag unsupported or conflicting claims, and explain precisely why the winning answer beat the alternatives.`
      : `Quick answer mode is enabled. Be concise, but still apply the full rubric.`;

  const judgedBlock = `You are the final synthesizer. Independent judge model(s) have ALREADY scored every candidate answer, and their scorecard is included below.
Treat the scorecard as expert evidence, not as a verdict you must obey: if the scores are wrong on the merits, say so explicitly and explain why before overriding them.
Synthesize: resolve conflicts on the merits — not by majority vote — and produce one superior, decisive answer. Prefer specific, evidence-backed claims over vague or unsupported ones. Never copy a single model's answer wholesale; combine the strongest, best-supported parts and correct anything the models got wrong.`;

  const selfJudgeBlock = `You are a single expert who acts as BOTH the impartial judge and the final synthesizer. There is no separate judge — you do the whole job yourself in this one pass.
First, silently evaluate every candidate answer like a strict judge, scoring each on: accuracy (factual correctness, internal consistency), relevance (does it answer what was actually asked), completeness (full coverage, no gaps), clarity (clear, well-structured, actionable), and evidence (grounded in the supplied web context / verifiable specifics, not confident guesses).
Then synthesize: resolve conflicts on the merits — not by majority vote — and produce one superior, decisive answer. Prefer specific, evidence-backed claims over vague or unsupported ones. Never copy a single model's answer wholesale; combine the strongest, best-supported parts and correct anything the models got wrong.`;

  const roleBlock = solo
    ? `You are a rigorous expert reviewer. Only one model answer is available, so your job is to stress-test it: verify its claims, correct errors, fill gaps, and return a stronger, trustworthy final answer. Do not fabricate agreement from other models that do not exist. Be explicit that this is a single-source answer and lower your confidence accordingly.`
    : hasJudge
      ? judgedBlock
      : selfJudgeBlock;

  return `${roleBlock}
${MODEL_NAME_RULES}
${temporalGrounding()}
${QUALITY_RUBRIC}
${deepInstruction}

${mode === "deep" ? DEEP_SECTIONS : QUICK_SECTIONS}`;
}

function councilPositionPrompt(mode: QualityMode, debaterCount: number): string {
  const deepInstruction =
    mode === "deep"
      ? "Deep mode: explicitly flag unsupported claims, weak assumptions, missing evidence, and any disagreement that would change the final answer."
      : "Quick mode: keep the note short while naming the single most important strength and the single biggest risk.";

  const roster =
    debaterCount <= 2
      ? "You are one of exactly two expert models debating head-to-head to reach the single best answer for the user."
      : `You are one of ${debaterCount} expert models debating to reach the single best answer for the user. Engage with the other models individually — never lump them together as "the others".`;

  return `${roster}
${temporalGrounding()}
Refer to yourself and the other models only by short model names.
This is a real debate: talk directly TO the other models, respond to their specific points, and clarify precisely where and why you disagree. Do not talk past each other.
Write visible public debate notes for the user — clear, concrete, and defensible. Never include hidden chain-of-thought or private scratch reasoning; state conclusions and the evidence for them.
Argue in good faith: concede points that are correct, and push hard on points that are wrong or unsupported. Always cite the specific claim you are addressing.
Apply the rubric to every claim: correctness, evidence, completeness, uncertainty, disagreements, and missing context.
${deepInstruction}
Do not declare a final winner or write the final answer — the judge does that after the debate.`;
}

function councilSynthesisPrompt(mode: QualityMode, debaterCount: number): string {
  const deepInstruction =
    mode === "deep"
      ? `Deep mode: claim-check the key statements from the debate and explain precisely why your verdict beats the losing position.`
      : `Quick mode: keep the verdict concise but decisive.`;

  const roster =
    debaterCount <= 2
      ? "a two-model debate"
      : `a ${debaterCount}-model debate`;

  return `You are the impartial JUDGE of ${roster}. You did not debate; your job is to read every model's arguments across all rounds and deliver the single best final answer for the user.
${MODEL_NAME_RULES}
${temporalGrounding()}
Read the full debate, the original answers, and any judge scorecard. Decide each disputed point ON THE MERITS — not by splitting the difference, not by majority vote, and not by favouring the more confident or more verbose model. If EVERY debater was wrong or missed something, correct it yourself.
Explicitly resolve the points the debaters left disputed: say which side was right and why, citing the evidence.
${QUALITY_RUBRIC}
${deepInstruction}

${mode === "deep" ? DEEP_SECTIONS : QUICK_SECTIONS}`;
}

function qualityModeFor(mode?: QualityMode): QualityMode {
  return mode === "deep" ? "deep" : "quick";
}

// Super mode synthesis: read the candidate answers and return ONLY the single
// best answer to the user. No analysis sections, no model names, no meta talk
// about how the answer was produced — the orchestration is fully under the hood.
function superSynthesisPrompt(): string {
  return `You are a single expert assistant. Several draft answers to the user's question are provided as private working material.
Silently evaluate them for correctness, evidence, completeness, and clarity, then produce ONE definitive best answer for the user.
Resolve conflicts on the merits — not by majority vote. Prefer specific, evidence-backed claims over vague or unsupported ones, and correct anything the drafts got wrong.
${temporalGrounding()}

Output rules (critical):
- Reply with ONLY the final answer, written directly to the user in a natural, self-contained voice.
- Never mention the drafts, other models, model names, "sources", judges, synthesis, scoring, or that multiple answers existed.
- Do not add headings like "Why this is best", "Confidence", or "---" separators. Do not include any analysis section.
- Format the answer well (markdown, code blocks, lists) when it helps, and cite web-backed facts with source numbers like [1] when web context was provided.`;
}

// Instructions for every debate round that any effort level can schedule. The
// effort tier decides which of these actually run, and in what order.
const COUNCIL_ROUND_INSTRUCTIONS: Record<CouncilRoundName, string> = {
  opening:
    "Give your own best answer to the user's question in a few sentences, then state the single most important point you expect the other models to get wrong or miss. Take a clear, specific position — no hedging.",
  critique:
    "Read the other models' openings. Address them directly by name: say exactly which claims you agree with, which you dispute, and why. Quote or paraphrase the specific claim you are challenging. Concede any point where they were right — do not defend a weak position out of pride.",
  rebuttal:
    "You have now been critiqued. Defend or withdraw each challenged claim explicitly — do not ignore a critique you cannot answer, say plainly that you were wrong. Then press the strongest objection the others have still not answered. Bring new evidence or reasoning, not a restatement of your opening.",
  convergence:
    "Now converge. State plainly: (1) what you and the other models now AGREE on, (2) which points remain genuinely DISPUTED and why neither side has conceded, and (3) the concrete facts/steps the final answer must contain. Be specific and actionable — this is the material the judge will rule on.",
  closing:
    "Closing statement. In a short, self-contained paragraph, commit to the single answer you believe the judge should adopt, and give the one strongest reason it beats every rival position raised in this debate. No new topics — this is your final position on record.",
};

function councilRoundsFor(effort: EffortLevel): CouncilRound[] {
  return COUNCIL_EFFORT[effort].rounds.map((id) => ({
    id,
    title: COUNCIL_ROUND_TITLES[id],
    instruction: COUNCIL_ROUND_INSTRUCTIONS[id],
  }));
}

function effortOf(body: RequestBody): EffortLevel {
  return isEffortLevel(body.effort) ? body.effort : "default";
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function resolveOllamaBaseUrl(raw?: string) {
  const input = (raw || DEFAULT_OLLAMA_BASE_URL).trim();
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function providerFor(modelId: string): ProviderKey {
  if (modelId.startsWith(CLOUD_OLLAMA_PREFIX)) return "ollama-cloud";
  if (modelId.startsWith(OLLAMA_PREFIX)) return "ollama";
  if (modelId.startsWith(OPENCODE_PREFIX)) return "opencode";
  if (modelId.startsWith(BEDROCK_PREFIX)) return "bedrock";
  if (modelId.startsWith(CUSTOM_PREFIX)) return "custom";
  return "groq";
}

function modelNameForProvider(modelId: string): string {
  if (modelId.startsWith(CLOUD_OLLAMA_PREFIX)) return modelId.slice(CLOUD_OLLAMA_PREFIX.length);
  if (modelId.startsWith(OLLAMA_PREFIX)) return modelId.slice(OLLAMA_PREFIX.length);
  if (modelId.startsWith(OPENCODE_PREFIX)) return modelId.slice(OPENCODE_PREFIX.length);
  if (modelId.startsWith(BEDROCK_PREFIX)) return modelId.slice(BEDROCK_PREFIX.length);
  return modelId.replace(/^groq\//, "");
}

function keyFor(body: RequestBody, modelId: string): string | undefined {
  const provider = providerFor(modelId);
  if (provider === "groq") return body.apiKey || process.env.GROQ_API_KEY;
  if (provider === "bedrock") {
    return (
      body.bedrockApiKey ||
      process.env.AWS_Bedrock_API_Key ||
      process.env.AWS_BEDROCK_API_KEY ||
      process.env.AWS_BEARER_TOKEN_BEDROCK
    )?.trim();
  }
  if (provider === "opencode") return body.opencodeApiKey || process.env.OpenCode_API_Key || process.env.OPENCODE_API_KEY;
  return body.ollamaApiKey || process.env.OLLAMA_API_KEY;
}

function shortResponses(responses: ResponseEntry[]): ResponseEntry[] {
  return responses.map((response) => ({
    ...response,
    model: getModelAlias(response.model),
  }));
}

function truncateResponses(responses: ResponseEntry[], maxTotalChars = INITIAL_CONTEXT_BUDGET): ResponseEntry[] {
  const maxPerResponse = Math.max(1, Math.floor(maxTotalChars / Math.max(1, responses.length)));
  return responses.map((response) => ({
    ...response,
    content:
      response.content.length > maxPerResponse
        ? response.content.slice(0, maxPerResponse) + "\n...[truncated]"
        : response.content,
  }));
}

function formatResponseBlock(prompt: string, responses: ResponseEntry[], webSearch?: boolean): string {
  const parts: string[] = [
    `User question:\n${prompt}`,
    "",
    webSearch ? "Web search context (Tavily) was provided to all models. Some models may still ignore it and fall back to outdated training data — evaluate carefully which responses actually used the web results." : "",
    webSearch ? "" : "",
    "Model answers:",
    ...truncateResponses(shortResponses(responses)).map(
      (response) => `\n--- ${response.model} ---\n${response.content || "(empty)"}`
    ),
  ];
  return parts.filter(Boolean).join("\n");
}

async function readError(upstream: Response, fallback: string): Promise<string> {
  const raw = await upstream.text().catch(() => fallback);
  if (!raw) return fallback;
  try {
    const json = JSON.parse(raw);
    if (typeof json?.error === "string") return json.error;
    if (typeof json?.error?.message === "string") return json.error.message;
    if (typeof json?.message === "string") return json.message;
  } catch {
    // keep raw text
  }
  return raw;
}

async function fetchUpstream(body: RequestBody, modelId: string, messages: ChatMessage[], stream: boolean, signal?: AbortSignal) {
  const provider = providerFor(modelId);
  const model = modelNameForProvider(modelId);

  if (provider === "custom") {
    // Custom OpenAI-compatible providers are not wired into consensus. Say so
    // instead of silently sending the id to Groq, which 404s confusingly.
    throw new UpstreamError(
      `${getModelAlias(modelId)} is a custom provider model, which cannot be used for consensus or council.`,
      400
    );
  }

  if (provider === "ollama" || provider === "ollama-cloud") {
    const baseUrl = resolveOllamaBaseUrl(
      provider === "ollama-cloud"
        ? body.ollamaCloudBaseUrl || DEFAULT_CLOUD_OLLAMA_BASE_URL
        : body.ollamaBaseUrl
    );
    if (!baseUrl) {
      throw new UpstreamError(provider === "ollama-cloud" ? "Invalid Ollama API base URL." : "Invalid Ollama base URL.", 400);
    }

    const key = keyFor(body, modelId);
    if (provider === "ollama-cloud" && !key) {
      throw new UpstreamError("No Ollama API key. Add OLLAMA_API_KEY to .env.local or Settings.", 401);
    }
    try {
      await assertSafeUpstreamUrl(baseUrl);
    } catch (err) {
      throw new UpstreamError(errorMessage(err), 400);
    }

    return fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream }),
      ...(signal ? { signal } : {}),
    }).catch((err: unknown) => {
      throw new UpstreamError(`${provider === "ollama-cloud" ? "Ollama API" : "Ollama"} is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
    });
  }

  if (provider === "bedrock") {
    const key = keyFor(body, modelId);
    if (!key) throw new UpstreamError("No Amazon Bedrock API key. Add it in Settings.", 401);
    return fetch(BEDROCK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: stream ? 8192 : 1200, stream }),
      ...(signal ? { signal } : {}),
    }).catch((err: unknown) => {
      throw new UpstreamError(`Amazon Bedrock is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
    });
  }

  if (provider === "opencode") {
    const key = keyFor(body, modelId);
    if (!key) throw new UpstreamError("No OpenCode API key. Add OpenCode_API_Key to .env.local or Settings.", 401);
    return fetch(OPENCODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: stream ? 8192 : 1200, stream }),
      ...(signal ? { signal } : {}),
    }).catch((err: unknown) => {
      throw new UpstreamError(`OpenCode Zen is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
    });
  }

  const key = keyFor(body, modelId);
  if (!key) throw new UpstreamError("No API key. Add your Groq API key in Settings.", 401);
  return fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: stream ? 8192 : 1200,
      stream,
    }),
    ...(signal ? { signal } : {}),
  }).catch((err: unknown) => {
    throw new UpstreamError(`Groq API is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
  });
}

async function generateText(body: RequestBody, modelId: string, messages: ChatMessage[]): Promise<string> {
  // Non-streaming calls (judges, council notes) must not hang forever.
  const signal = AbortSignal.timeout(GENERATE_TEXT_TIMEOUT_MS);
  const upstream = await fetchUpstream(body, modelId, messages, false, signal);
  if (upstream.status !== 200) {
    throw new UpstreamError(await readError(upstream, `${getModelAlias(modelId)} returned HTTP ${upstream.status}`), upstream.status);
  }

  const provider = providerFor(modelId);
  const json = await upstream.json().catch(() => ({}));
  if (provider === "ollama" || provider === "ollama-cloud") {
    return String(json?.message?.content ?? "").trim();
  }
  return String(json?.choices?.[0]?.message?.content ?? "").trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Rate limits and gateway blips are common and recover in seconds. Burning a
// backup model on one is wasteful, so retry the same model once before the
// caller moves down the bench. Auth/not-found/bad-request errors are permanent
// and fall through immediately.
function isTransientUpstreamError(err: unknown): boolean {
  if (!(err instanceof UpstreamError)) return false;
  return err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;
}

const TRANSIENT_RETRY_DELAY_MS = 1_500;

async function withTransientRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isTransientUpstreamError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
    return run();
  }
}

// Emits a periodic heartbeat so the client's connection watchdog sees liveness
// during long non-streaming work (judge scoring) or while the server is waiting
// for a synthesizer's first token / cycling through fallbacks. Returns a stop
// function that must be called when the work completes.
function startHeartbeat(send: SendEvent): () => void {
  const timer = setInterval(() => send({ type: "ping" }), HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

function createNdjsonResponse(handler: (send: SendEvent) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: SendEvent = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        await handler(send);
      } catch (err: unknown) {
        send({ type: "error", message: errorMessage(err) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function openStreamingUpstream(body: RequestBody, modelId: string, messages: ChatMessage[], signal?: AbortSignal) {
  const upstream = await fetchUpstream(body, modelId, messages, true, signal);
  if (upstream.status !== 200) {
    // Preserve the HTTP status so runSingle can detect context-overflow (413)
    // and retry with a smaller context budget instead of surfacing an error.
    throw new UpstreamError(await readError(upstream, `${getModelAlias(modelId)} returned HTTP ${upstream.status}`), upstream.status);
  }
  if (!upstream.body) throw new UpstreamError("No upstream body", 502);

  return { upstream, provider: providerFor(modelId) };
}

async function pipeStreamingText(
  send: SendEvent,
  opened: Awaited<ReturnType<typeof openStreamingUpstream>>,
  onDelta?: () => void
) {
  const reader = opened.upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emitDelta = (text: string) => {
    send({ type: "delta", text });
    onDelta?.();
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      try {
        if (opened.provider === "ollama" || opened.provider === "ollama-cloud") {
          const json = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          const delta = json.message?.content;
          if (delta) emitDelta(delta);
          if (json.done) {
            if (typeof json.prompt_eval_count === "number" || typeof json.eval_count === "number") {
              send({ type: "usage", usage: { prompt_tokens: json.prompt_eval_count, completion_tokens: json.eval_count } });
            }
            if (json.done_reason) send({ type: "finish", reason: json.done_reason });
          }
          continue;
        }

        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) emitDelta(delta);
        if (json?.usage) send({ type: "usage", usage: json.usage });
        const finish = json?.choices?.[0]?.finish_reason;
        if (finish) send({ type: "finish", reason: finish });
      } catch {
        // ignore malformed stream lines
      }
    }
  }
}

// Streams a model's answer with a server-side stall watchdog. If no first
// token arrives within STREAM_FIRST_TOKEN_TIMEOUT_MS (or the stream goes idle
// mid-answer), the upstream is aborted so the caller can try the next fallback
// model. Returns whether any content was emitted: once bytes have reached the
// client, a later failure is swallowed (partial answer beats duplicating it
// with a fallback), so callers should only fall back when emitted is false.
async function streamTextEvents(
  send: SendEvent,
  body: RequestBody,
  modelId: string,
  messages: ChatMessage[]
): Promise<{ emitted: boolean }> {
  const controller = new AbortController();
  let emitted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };

  arm(STREAM_FIRST_TOKEN_TIMEOUT_MS);
  try {
    const opened = await openStreamingUpstream(body, modelId, messages, controller.signal);
    await pipeStreamingText(send, opened, () => {
      emitted = true;
      arm(STREAM_IDLE_TIMEOUT_MS);
    });
    return { emitted };
  } catch (err) {
    if (emitted) {
      // Partial content already streamed to the user — don't fall back or it
      // would duplicate the answer. Treat as a completed (if truncated) result.
      return { emitted };
    }
    if (controller.signal.aborted) {
      throw new UpstreamError(`${getModelAlias(modelId)} produced no output before timeout.`, 504);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function judgePrompt(): string {
  return `You are a strict, impartial evaluation judge scoring a panel of AI answers to the same question. You do not write your own answer.
${MODEL_NAME_RULES}
${temporalGrounding()}
Score each answer independently on a 0-10 integer scale for these criteria:
- accuracy: factual correctness and internal consistency.
- relevance: how directly it addresses the user's actual question.
- completeness: coverage of everything the question needs.
- clarity: how clear, well-structured, and easy to act on it is.
- citations: use of the supplied web context / verifiable specifics (score 0 if none were needed and none given).
Reward answers grounded in evidence; penalise confident but unsupported claims. Do not favour length. Be discriminating — avoid giving every answer the same score.
Set "overall" as your holistic 0-10 rating (not necessarily the average). Pick the single best answer as "winner". Set "confidence" to how sure you are the winner is genuinely best.
Return ONLY valid minified JSON — no markdown, no code fences, no commentary — exactly matching this shape:
{"rankings":[{"model":"<short name>","scores":{"accuracy":0,"relevance":0,"completeness":0,"clarity":0,"citations":0},"overall":0,"rationale":"one concise sentence"}],"winner":"<short name>","confidence":"high|medium|low"}`;
}

function judgeMessages(body: RequestBody): ChatMessage[] {
  return [
    { role: "system", content: judgePrompt() },
    { role: "user", content: formatResponseBlock(body.prompt, body.responses, body.webSearch) },
  ];
}

function clampScore(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10));
}

function parseJudge(raw: string, model: string): JudgeResult | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const obj = data as { rankings?: unknown; winner?: unknown; confidence?: unknown };
  if (!Array.isArray(obj.rankings)) return null;

  const rankings: JudgeRanking[] = [];
  for (const entry of obj.rankings) {
    const row = entry as { model?: unknown; scores?: unknown; overall?: unknown; rationale?: unknown };
    if (typeof row.model !== "string" || !row.model.trim()) continue;
    const scores: Partial<Record<JudgeCriterion, number>> = {};
    const rawScores = (row.scores ?? {}) as Record<string, unknown>;
    for (const criterion of JUDGE_CRITERIA) {
      const score = clampScore(rawScores[criterion]);
      if (score !== undefined) scores[criterion] = score;
    }
    rankings.push({
      model: row.model.trim(),
      ...(Object.keys(scores).length > 0 ? { scores } : {}),
      ...(clampScore(row.overall) !== undefined ? { overall: clampScore(row.overall) } : {}),
      ...(typeof row.rationale === "string" && row.rationale.trim()
        ? { rationale: row.rationale.trim() }
        : {}),
    });
  }
  if (rankings.length === 0) return null;

  const confidence =
    obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence
      : undefined;

  return {
    model,
    rankings,
    ...(typeof obj.winner === "string" && obj.winner.trim() ? { winner: obj.winner.trim() } : {}),
    ...(confidence ? { confidence } : {}),
  };
}

function formatJudgeBlock(judge: JudgeResult): string {
  const lines = judge.rankings.map((ranking) => {
    const parts = JUDGE_CRITERIA.map((criterion) =>
      ranking.scores?.[criterion] !== undefined ? `${criterion} ${ranking.scores[criterion]}` : null
    ).filter(Boolean);
    const overall = ranking.overall !== undefined ? ` | overall ${ranking.overall}/10` : "";
    const rationale = ranking.rationale ? ` — ${ranking.rationale}` : "";
    return `- ${ranking.model}: ${parts.join(", ")}${overall}${rationale}`;
  });
  const header = [
    "Independent judge scorecard (advisory, 0-10):",
    judge.winner ? `Judge's pick: ${judge.winner}` : null,
    judge.confidence ? `Judge confidence: ${judge.confidence}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n${lines.join("\n")}`;
}

// Combines independent judge scorecards into one aggregate result: scores and
// overall ratings are averaged per candidate, and the winner is decided by
// majority vote (ties broken by highest averaged overall). Two judges is
// usually the sweet spot — enough to catch a single judge's bias without
// doubling cost/latency for marginal extra reliability.
function mergeJudgeResults(results: JudgeResult[]): JudgeResult {
  if (results.length === 1) return results[0];

  const byModel = new Map<
    string,
    { scores: Partial<Record<JudgeCriterion, number[]>>; overalls: number[]; rationales: string[] }
  >();
  for (const judge of results) {
    for (const ranking of judge.rankings) {
      const entry = byModel.get(ranking.model) ?? { scores: {}, overalls: [], rationales: [] };
      for (const criterion of JUDGE_CRITERIA) {
        const value = ranking.scores?.[criterion];
        if (value !== undefined) {
          (entry.scores[criterion] ??= []).push(value);
        }
      }
      if (ranking.overall !== undefined) entry.overalls.push(ranking.overall);
      if (ranking.rationale) entry.rationales.push(`${judge.model}: ${ranking.rationale}`);
      byModel.set(ranking.model, entry);
    }
  }

  const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

  const rankings: JudgeRanking[] = Array.from(byModel.entries()).map(([model, entry]) => {
    const scores: Partial<Record<JudgeCriterion, number>> = {};
    for (const criterion of JUDGE_CRITERIA) {
      const values = entry.scores[criterion];
      if (values && values.length > 0) scores[criterion] = Math.round(avg(values) * 10) / 10;
    }
    return {
      model,
      ...(Object.keys(scores).length > 0 ? { scores } : {}),
      ...(entry.overalls.length > 0 ? { overall: Math.round(avg(entry.overalls) * 10) / 10 } : {}),
      ...(entry.rationales.length > 0 ? { rationale: entry.rationales.join(" / ") } : {}),
    };
  });

  const winnerVotes = new Map<string, number>();
  for (const judge of results) {
    if (judge.winner) winnerVotes.set(judge.winner, (winnerVotes.get(judge.winner) ?? 0) + 1);
  }
  let winner: string | undefined;
  let bestVotes = 0;
  for (const [model, votes] of winnerVotes) {
    const overall = rankings.find((r) => r.model === model)?.overall ?? 0;
    const bestOverall = rankings.find((r) => r.model === winner)?.overall ?? -1;
    if (votes > bestVotes || (votes === bestVotes && overall > bestOverall)) {
      winner = model;
      bestVotes = votes;
    }
  }
  if (!winner) {
    winner = rankings.slice().sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0]?.model;
  }

  const confidence: NonNullable<JudgeResult["confidence"]> =
    winner !== undefined && bestVotes === results.length
      ? "high"
      : bestVotes > results.length / 2
        ? "medium"
        : "low";

  return {
    model: `${results.length} judges (${results.map((r) => r.model).join(", ")})`,
    rankings,
    ...(winner ? { winner } : {}),
    confidence,
  };
}

// Runs the judge(s) (non-streaming) over the panel answers. Non-fatal: returns
// null if no judge model succeeds or the output cannot be parsed, so synthesis
// proceeds anyway.
async function maybeRunJudge(send: SendEvent, body: RequestBody): Promise<JudgeResult | null> {
  if (body.responses.length === 0) return null;
  const messages = judgeMessages(body);

  const explicitJudges = unique(body.judgeModels ?? []).slice(0, 3);
  if (explicitJudges.length > 0) {
    const settled = await Promise.allSettled(
      explicitJudges.map(async (modelId) => {
        const raw = await withTransientRetry(() => generateText(body, modelId, messages));
        return parseJudge(raw, getModelAlias(modelId));
      })
    );
    const parsedJudges = settled
      .filter((result): result is PromiseFulfilledResult<JudgeResult | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((result): result is JudgeResult => Boolean(result));
    if (parsedJudges.length === 0) {
      // The user explicitly picked these judges — surface the failure instead
      // of silently substituting a different model.
      const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      const message = firstFailure
        ? `Judge scoring failed: ${errorMessage(firstFailure.reason)}`
        : "Judge scoring failed: selected judge model(s) returned an unreadable response.";
      send({ type: "judge_error", message });
      return null;
    }
    const merged = mergeJudgeResults(parsedJudges);
    send({
      type: "judge",
      model: merged.model,
      rankings: merged.rankings,
      winner: merged.winner,
      confidence: merged.confidence,
    });
    return merged;
  }

  // Legacy fallback path (no explicit judge panel supplied): try judges
  // sequentially and stop at the first that returns a parseable scorecard.
  const judgeModels = unique([
    body.judgeModel,
    ...(body.judgeFallbackModels ?? []),
    body.consensusModel,
    ...(body.fallbackModels ?? []),
  ]);
  if (judgeModels.length === 0) return null;

  for (const modelId of judgeModels) {
    try {
      const raw = await generateText(body, modelId, messages);
      const parsed = parseJudge(raw, getModelAlias(modelId));
      if (parsed) {
        send({
          type: "judge",
          model: parsed.model,
          rankings: parsed.rankings,
          winner: parsed.winner,
          confidence: parsed.confidence,
        });
        return parsed;
      }
    } catch {
      // try next judge model
    }
  }
  return null;
}


function synthesisMessages(body: RequestBody, judge: JudgeResult | null): ChatMessage[] {
  const solo = body.responses.length < 2;
  const block = formatResponseBlock(body.prompt, body.responses, body.webSearch);
  const content = judge ? `${block}\n\n${formatJudgeBlock(judge)}` : block;
  const systemContent =
    body.mode === "super"
      ? superSynthesisPrompt()
      : synthesisPrompt(qualityModeFor(body.qualityMode), solo, Boolean(judge));
  return [
    { role: "system", content: systemContent },
    { role: "user", content },
  ];
}

// Returns true when an error indicates the input was too large for the model.
function isContextOverflow(err: UpstreamError): boolean {
  return (
    err.status === 413 ||
    /context.?length|context.?window|token.?limit|too.?long|input.?too.?large|payload.?too/i.test(err.message)
  );
}

async function runSingle(body: RequestBody): Promise<Response> {
  const models = unique([body.consensusModel, ...(body.fallbackModels ?? [])]);
  if (models.length === 0) throw new UpstreamError("Missing consensusModel", 400);
  const effort = CONSENSUS_EFFORT[effortOf(body)];

  return createNdjsonResponse(async (send) => {
    // Default effort uses a single expert model that is BOTH judge and
    // synthesizer. Pro/Ultra run independent judges first and hand their merged
    // scorecard to the synthesizer. If a model fails or the context is too
    // large we silently try the next fallback, halving the budget on overflow.
    let contextBudget = effort.contextBudget;
    let lastError: UpstreamError | null = null;

    // Keep the connection alive while we wait for the first token / fall back.
    const stopHeartbeat = startHeartbeat(send);
    try {
      // Judge scoring is advisory: if every judge fails we still synthesize.
      // Requires an explicit panel — without one maybeRunJudge would fall back
      // to the synthesizer itself, which is self-assessment, not an independent
      // second opinion.
      const hasJudgePanel = unique(body.judgeModels ?? []).length > 0;
      const judge = effort.judges > 0 && hasJudgePanel ? await maybeRunJudge(send, body) : null;

      for (const modelId of models) {
        // Retry the same model once on a transient error, but only while it has
        // not streamed anything yet — retrying mid-answer would duplicate text.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let sawDelta = false;
          const trackedSend: SendEvent = (obj) => {
            if (obj.type === "delta") sawDelta = true;
            send(obj);
          };
          try {
            const effectiveResponses = truncateResponses(body.responses, contextBudget);
            const messages = synthesisMessages({ ...body, responses: effectiveResponses }, judge);
            const { emitted } = await streamTextEvents(trackedSend, body, modelId, messages);
            if (!emitted) {
              throw new UpstreamError(`${getModelAlias(modelId)} returned an empty answer.`, 502);
            }
            return;
          } catch (err) {
            const ue =
              err instanceof UpstreamError
                ? err
                : new UpstreamError(err instanceof Error ? err.message : String(err), 502);
            lastError = ue;
            // Shrink context budget for the next attempt when the model rejected
            // the request due to size, so the fallback has a better chance.
            if (isContextOverflow(ue)) {
              contextBudget = Math.max(40_000, Math.floor(contextBudget / 2));
              break; // a smaller context needs a fresh model, not a blind retry
            }
            if (attempt === 0 && !sawDelta && isTransientUpstreamError(ue)) {
              await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
              continue;
            }
            break; // permanent failure (or already streamed) — move to the bench
          }
        }
      }
    } finally {
      stopHeartbeat();
    }

    throw lastError ?? new UpstreamError("Consensus failed.", 502);
  });
}

function formatCouncilHistory(notes: CouncilNote[], historyCap = COUNCIL_HISTORY_CAP): string {
  if (notes.length === 0) return "No previous council notes yet.";
  return notes
    .slice(-historyCap)
    .map((note) => `\n--- ${note.roundTitle} / ${note.alias} ---\n${note.content}`)
    .join("\n");
}

function sendCouncilStatus(
  send: SendEvent,
  modelId: string,
  status: "queued" | "running" | "done" | "failed" | "replaced",
  round?: CouncilRoundName | "synthesis",
  message?: string,
  replacementModelId?: string
) {
  send({
    type: "status",
    modelId,
    model: getModelAlias(modelId),
    status,
    round,
    message,
    replacementModelId,
    replacementModel: replacementModelId ? getModelAlias(replacementModelId) : undefined,
  });
}

async function generateCouncilNote(
  body: RequestBody,
  modelId: string,
  round: CouncilRound,
  baseBlock: string,
  notes: CouncilNote[],
  debaterCount: number,
  historyCap: number
): Promise<CouncilNote> {
  const alias = getModelAlias(modelId);
  const content = await withTransientRetry(() =>
    generateText(body, modelId, [
      { role: "system", content: councilPositionPrompt(qualityModeFor(body.qualityMode), debaterCount) },
      {
        role: "user",
        content:
          `You are ${alias}.\n\n` +
          `Round: ${round.title}\n` +
          `Your task: ${round.instruction}\n\n` +
          `${baseBlock}\n\n` +
          `Previous visible council notes:\n${formatCouncilHistory(notes, historyCap)}\n\n` +
          `Respond as ${alias}. Start with "${alias}:". Keep it concise and user-visible.`,
      },
    ])
  );
  if (!content) throw new UpstreamError(`${alias} returned an empty council note.`, 502);
  return { round: round.id, roundTitle: round.title, modelId, alias, content };
}

// Strip "ModelName: " prefix from content to avoid redundant display
// when the model name is shown as a separate header label.
function stripModelPrefix(content: string, modelName: string): string {
  const prefix = `${modelName}:`;
  if (content.trimStart().startsWith(prefix)) {
    return content.trimStart().slice(prefix.length).trimStart();
  }
  return content;
}

// Moderator tries the explicitly chosen judge models first, then silently
// falls back through the full fallback chain and finally the debate
// participants — so synthesis always completes even if the chosen judge is
// temporarily unavailable.
function moderatorModelIds(body: RequestBody, participants: string[]): string[] {
  if (body.moderatorModels?.length) {
    return unique([
      ...body.moderatorModels,
      ...(body.fallbackModels ?? []),
      ...participants,
    ]);
  }
  return unique([body.consensusModel, ...(body.fallbackModels ?? []), ...participants]);
}

async function runCouncil(body: RequestBody): Promise<Response> {
  const effort = COUNCIL_EFFORT[effortOf(body)];
  const rounds = councilRoundsFor(effortOf(body));
  let candidates = unique(body.candidateModels ?? []);
  let fallbacks = unique(body.fallbackModels ?? []);
  // Start by combining all available models to maximize chances of success.
  // If fewer debaters than the tier wants, backfill from the fallback pool.
  if (candidates.length < effort.debaters) {
    const backfill = fallbacks.filter((id) => !candidates.includes(id));
    candidates = unique([...candidates, ...backfill]).slice(0, effort.debaters);
    fallbacks = fallbacks.filter((id) => !candidates.includes(id));
  }
  // If still only 1 model, use it twice (same model debates itself).
  if (candidates.length === 1) {
    candidates = [candidates[0], candidates[0]];
  }
  if (candidates.length === 0) throw new UpstreamError("No available models for council.", 400);

  return createNdjsonResponse(async (send) => {
    const fallbackQueue = fallbacks.filter((id) => !candidates.includes(id));
    const usedModels = new Set(candidates);
    const allNotes: CouncilNote[] = [];
    // Use a smaller context budget for the base block passed to debaters —
    // they need the topic/context, not the full synthesizer-level transcript.
    const baseBlock = formatResponseBlock(
      body.prompt,
      truncateResponses(body.responses, COUNCIL_RESPONSE_BUDGET),
      body.webSearch
    );
    let participants = [...candidates];

    for (const candidate of participants) {
      sendCouncilStatus(send, candidate, "queued");
    }

    for (const round of rounds) {
      send({ type: "round_start", round: round.id, title: round.title });
      const settled = await Promise.allSettled(
        participants.map(async (modelId) => {
          sendCouncilStatus(send, modelId, "running", round.id);
          return generateCouncilNote(
            body,
            modelId,
            round,
            baseBlock,
            allNotes,
            participants.length,
            effort.historyCap
          );
        })
      );
      const nextParticipants: string[] = [];

      for (let i = 0; i < settled.length; i += 1) {
        const modelId = participants[i];
        const result = settled[i];
        if (result.status === "fulfilled") {
          // Strip any "ModelName: " prefix from content to avoid redundant display.
          const cleanContent = stripModelPrefix(result.value.content, result.value.alias);
          const noteWithCleanContent = { ...result.value, content: cleanContent };
          allNotes.push(noteWithCleanContent);
          nextParticipants.push(modelId);
          sendCouncilStatus(send, modelId, "done", round.id);
          send({
            type: "council_note",
            round: round.id,
            roundTitle: round.title,
            modelId,
            model: result.value.alias,
            text: cleanContent,
          });
          continue;
        }

        sendCouncilStatus(send, modelId, "failed", round.id, errorMessage(result.reason));
        let replacementNote: CouncilNote | null = null;

        while (fallbackQueue.length > 0 && !replacementNote) {
          const fallback = fallbackQueue.shift()!;
          if (usedModels.has(fallback)) continue;
          usedModels.add(fallback);
          sendCouncilStatus(send, modelId, "replaced", round.id, `Replaced by ${getModelAlias(fallback)}`, fallback);
          sendCouncilStatus(send, fallback, "running", round.id, `Replacing ${getModelAlias(modelId)}`);
          try {
            replacementNote = await generateCouncilNote(
              body,
              fallback,
              round,
              baseBlock,
              allNotes,
              participants.length,
              effort.historyCap
            );
            // Strip any model name prefix from replacement note as well.
            const cleanReplacement = { ...replacementNote, content: stripModelPrefix(replacementNote.content, getModelAlias(fallback)) };
            allNotes.push(cleanReplacement);
            nextParticipants.push(fallback);
            sendCouncilStatus(send, fallback, "done", round.id);
            const cleanContent = stripModelPrefix(replacementNote.content, replacementNote.alias);
            send({
              type: "council_note",
              round: round.id,
              roundTitle: round.title,
              modelId: fallback,
              model: replacementNote.alias,
              text: cleanContent,
            });
          } catch (err: unknown) {
            sendCouncilStatus(send, fallback, "failed", round.id, errorMessage(err));
          }
        }
      }

      participants = nextParticipants;
      // Allow synthesis even with 1 debater. If 0 participants remain, error out.
      if (participants.length === 0) {
        throw new UpstreamError("All debaters failed. Council could not proceed.", 502);
      }
    }

    // Judge scoring is a non-streaming call that can take tens of seconds with a
    // full Ultra panel, so the heartbeat has to cover it too — otherwise the
    // client's stall watchdog can abort a run that is still healthy.
    const stopHeartbeat = startHeartbeat(send);
    const judge = await maybeRunJudge(send, body);
    const synthesisBaseBlock = formatResponseBlock(
      body.prompt,
      truncateResponses(body.responses, COUNCIL_SYNTHESIS_RESPONSE_BUDGET),
      body.webSearch
    );
    const councilBlock = [
      synthesisBaseBlock,
      "",
      "Visible council debate:",
      ...allNotes.map(
        (note) =>
          `\n--- ${note.roundTitle} / ${note.alias} ---\n${
            note.content.length > COUNCIL_SYNTHESIS_NOTE_BUDGET
              ? `${note.content.slice(0, COUNCIL_SYNTHESIS_NOTE_BUDGET)}\n...[note truncated for final synthesis]`
              : note.content
          }`
      ),
      ...(judge ? ["", formatJudgeBlock(judge)] : []),
    ].join("\n");

    send({ type: "round_start", round: "synthesis", title: "Judge's verdict" });
    let lastError: UpstreamError | null = null;
    // The heartbeat started before judging is still running, and keeps the
    // connection alive through the moderator fallback chain too.
    try {
      for (const modelId of moderatorModelIds(body, participants)) {
        try {
          sendCouncilStatus(send, modelId, "running", "synthesis", "Judging the debate");
          const { emitted } = await streamTextEvents(send, body, modelId, [
            {
              role: "system",
              content: councilSynthesisPrompt(qualityModeFor(body.qualityMode), participants.length),
            },
            { role: "user", content: councilBlock },
          ]);
          if (!emitted) {
            // Upstream closed without producing any verdict text — treat as a
            // failure so the next moderator fallback gets a turn.
            throw new UpstreamError(`${getModelAlias(modelId)} returned an empty verdict.`, 502);
          }
          sendCouncilStatus(send, modelId, "done", "synthesis", "Verdict complete");
          return;
        } catch (err: unknown) {
          lastError = err instanceof UpstreamError ? err : new UpstreamError(errorMessage(err), 502);
          sendCouncilStatus(send, modelId, "failed", "synthesis", lastError.message);
        }
      }
    } finally {
      stopHeartbeat();
    }

    throw lastError ?? new UpstreamError("Model council synthesis failed.", 502);
  });
}

// Caps on client-supplied input. Without these a single request can fan out to
// an unbounded number of upstream calls or pin hundreds of MB in memory.
const MAX_PROMPT_CHARS = 200_000;
const MAX_RESPONSES = 32;
const MAX_RESPONSE_CHARS = 400_000;
const MAX_MODEL_IDS = 16;
const MAX_MODEL_ID_CHARS = 200;

function validateModelIdList(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${field} must be an array.`;
  if (value.length > MAX_MODEL_IDS) return `${field} may contain at most ${MAX_MODEL_IDS} models.`;
  for (const id of value) {
    if (typeof id !== "string" || id.length > MAX_MODEL_ID_CHARS) return `${field} contains an invalid model id.`;
  }
  return null;
}

function validateRequestBody(body: RequestBody): string | null {
  if (typeof body.prompt !== "string" || body.prompt.length > MAX_PROMPT_CHARS) {
    return `prompt must be a string of at most ${MAX_PROMPT_CHARS} characters.`;
  }
  if (body.responses.length > MAX_RESPONSES) {
    return `responses may contain at most ${MAX_RESPONSES} entries.`;
  }
  for (const entry of body.responses) {
    if (!entry || typeof entry.content !== "string" || typeof entry.model !== "string") {
      return "each response must have string model and content fields.";
    }
    if (entry.content.length > MAX_RESPONSE_CHARS) {
      return `each response content may be at most ${MAX_RESPONSE_CHARS} characters.`;
    }
  }
  for (const [field, value] of [
    ["candidateModels", body.candidateModels],
    ["fallbackModels", body.fallbackModels],
    ["moderatorModels", body.moderatorModels],
    ["judgeModels", body.judgeModels],
    ["judgeFallbackModels", body.judgeFallbackModels],
  ] as const) {
    const error = validateModelIdList(value, field);
    if (error) return error;
  }
  if (body.effort !== undefined && !isEffortLevel(body.effort)) {
    return `effort must be one of "default", "pro", or "ultra".`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.prompt || !Array.isArray(body.responses) || body.responses.length === 0) {
    return new Response("Missing prompt or responses", { status: 400 });
  }

  const invalid = validateRequestBody(body);
  if (invalid) return new Response(invalid, { status: 400 });

  try {
    return body.mode === "council" ? await runCouncil(body) : await runSingle(body);
  } catch (err) {
    const error = err instanceof UpstreamError ? err : new UpstreamError(err instanceof Error ? err.message : String(err), 502);
    return new Response(error.message, { status: error.status });
  }
}
