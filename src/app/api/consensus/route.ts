import { NextRequest } from "next/server";
import { getModelAlias } from "@/lib/model-rules";

export const runtime = "nodejs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENCODE_URL = "https://opencode.ai/zen/v1/chat/completions";
const OPENCODE_PREFIX = "opencode/";
const OLLAMA_PREFIX = "ollama/";
const CLOUD_OLLAMA_PREFIX = "ollama-cloud/";
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
  mode?: "single" | "council";
  qualityMode?: QualityMode;
  consensusModel?: string;
  candidateModels?: string[];
  fallbackModels?: string[];
  moderatorModels?: string[];
  judgeModel?: string;
  judgeFallbackModels?: string[];
  apiKey?: string;
  geminiApiKey?: string;
  opencodeApiKey?: string;
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


type ProviderKey = "gemini" | "ollama" | "ollama-cloud" | "opencode" | "groq";
type QualityMode = "quick" | "deep";
type CouncilRoundName = "opening" | "critique" | "convergence";
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

const MODEL_NAME_RULES = `Refer to sources only by their short model names (e.g. Gemini 2.5, Gemma 4, Llama 4, Cogito, Nemotron, GPT).
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

function synthesisPrompt(mode: QualityMode, solo: boolean): string {
  const deepInstruction =
    mode === "deep"
      ? `Deep answer mode is enabled. Claim-check the most important statements against only the supplied answers, flag unsupported or conflicting claims, and explain precisely why the winning answer beat the alternatives.`
      : `Quick answer mode is enabled. Be concise, but still apply the full rubric.`;

  const roleBlock = solo
    ? `You are a rigorous self-review synthesizer. Only one model answer is available, so your job is to stress-test it: verify its claims, correct errors, fill gaps, and return a stronger, trustworthy final answer. Do not fabricate agreement from other models that do not exist. Be explicit that this is a single-source answer and lower your confidence accordingly.`
    : `You are a careful consensus synthesizer. Compare the answers, resolve conflicts on the merits, and produce one superior answer. Never copy a single model's answer wholesale — synthesize.`;

  return `${roleBlock}
${MODEL_NAME_RULES}
${temporalGrounding()}
${QUALITY_RUBRIC}
If a judge scorecard is provided, treat it as advisory evidence: weigh it, but override it when the underlying answers clearly contradict the judge.
${deepInstruction}

${mode === "deep" ? DEEP_SECTIONS : QUICK_SECTIONS}`;
}

function councilPositionPrompt(mode: QualityMode): string {
  const deepInstruction =
    mode === "deep"
      ? "Deep mode: explicitly flag unsupported claims, weak assumptions, missing evidence, and any disagreement that would change the final answer."
      : "Quick mode: keep the note short while naming the single most important strength and the single biggest risk.";

  return `You are one member of an expert model council debating to reach the best possible answer.
${temporalGrounding()}
Refer to yourself and others only by short model names.
Write visible public debate notes for the user — clear, concrete, and defensible. Never include hidden chain-of-thought or private scratch reasoning; state conclusions and the evidence for them.
Argue in good faith: concede points that are correct, and push hard on points that are wrong or unsupported. Cite the specific claim you are addressing.
Apply the rubric: correctness, evidence, completeness, uncertainty, disagreements, and missing context.
${deepInstruction}
Do not write the final answer alone — that is the moderator's job.`;
}

function councilSynthesisPrompt(mode: QualityMode): string {
  const deepInstruction =
    mode === "deep"
      ? `Deep mode: use the council notes and judge scorecard to claim-check the key statements and explain why the final answer beat the strongest alternative.`
      : `Quick mode: keep the final verdict concise but decisive.`;

  return `You are the final moderator of an expert model council. You have the last word.
${MODEL_NAME_RULES}
${temporalGrounding()}
Weigh the council debate, the original answers, and any judge scorecard, then deliver one authoritative answer. Do not copy any single member's answer — synthesize the strongest, best-supported result.
Resolve the debate on the merits, not by majority vote. If the council was wrong or missed something, correct it.
${QUALITY_RUBRIC}
${deepInstruction}

${mode === "deep" ? DEEP_SECTIONS : QUICK_SECTIONS}`;
}

function qualityModeFor(mode?: QualityMode): QualityMode {
  return mode === "deep" ? "deep" : "quick";
}

const COUNCIL_ROUNDS: CouncilRound[] = [
  {
    id: "opening",
    title: "Opening",
    instruction:
      "State which original answer is strongest and why, what it gets right, and the single most important point it misses. Take a clear position.",
  },
  {
    id: "critique",
    title: "Critique",
    instruction:
      "Read the opening notes. Challenge the weakest assumption, unsupported claim, or missing detail from another member by name. Concede any point where they were right.",
  },
  {
    id: "convergence",
    title: "Convergence",
    instruction:
      "State what the council now agrees on, what remains genuinely disputed, and draft the key points the final answer must include. Be specific and actionable.",
  },
];

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
  if (modelId.startsWith("gemini")) return "gemini";
  if (modelId.startsWith(CLOUD_OLLAMA_PREFIX)) return "ollama-cloud";
  if (modelId.startsWith(OLLAMA_PREFIX)) return "ollama";
  if (modelId.startsWith(OPENCODE_PREFIX)) return "opencode";
  return "groq";
}

function modelNameForProvider(modelId: string): string {
  if (modelId.startsWith(CLOUD_OLLAMA_PREFIX)) return modelId.slice(CLOUD_OLLAMA_PREFIX.length);
  if (modelId.startsWith(OLLAMA_PREFIX)) return modelId.slice(OLLAMA_PREFIX.length);
  if (modelId.startsWith(OPENCODE_PREFIX)) return modelId.slice(OPENCODE_PREFIX.length);
  return modelId.replace(/^groq\//, "");
}

function keyFor(body: RequestBody, modelId: string): string | undefined {
  const provider = providerFor(modelId);
  if (provider === "gemini") return body.geminiApiKey || process.env.GEMINI_API_KEY;
  if (provider === "groq") return body.apiKey || process.env.GROQ_API_KEY;
  if (provider === "opencode") return body.opencodeApiKey || process.env.OpenCode_API_Key || process.env.OPENCODE_API_KEY;
  return body.ollamaApiKey || process.env.OLLAMA_API_KEY;
}

function shortResponses(responses: ResponseEntry[]): ResponseEntry[] {
  return responses.map((response) => ({
    ...response,
    model: getModelAlias(response.model),
  }));
}

function truncateResponses(responses: ResponseEntry[]): ResponseEntry[] {
  const maxTotalChars = 500000;
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

function toGeminiBody(messages: ChatMessage[]) {
  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push({ text: message.content });
    } else {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      });
    }
  }

  return {
    ...(systemParts.length > 0 ? { system_instruction: { parts: systemParts } } : {}),
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };
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

async function fetchUpstream(body: RequestBody, modelId: string, messages: ChatMessage[], stream: boolean) {
  const provider = providerFor(modelId);
  const model = modelNameForProvider(modelId);

  if (provider === "gemini") {
    const key = keyFor(body, modelId);
    if (!key) throw new UpstreamError("No API key. Add your Gemini API key in Settings.", 401);
    const endpoint = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return fetch(`${GEMINI_BASE}/${model}:${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(toGeminiBody(messages)),
    }).catch((err: unknown) => {
      throw new UpstreamError(`Gemini API is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
    });
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

    return fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream }),
    }).catch((err: unknown) => {
      throw new UpstreamError(`${provider === "ollama-cloud" ? "Ollama API" : "Ollama"} is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
    });
  }

  if (provider === "opencode") {
    const key = keyFor(body, modelId);
    if (!key) throw new UpstreamError("No OpenCode API key. Add OpenCode_API_Key to .env.local or Settings.", 401);
    return fetch(OPENCODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: stream ? 4096 : 1200, stream }),
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
      max_tokens: stream ? 4096 : 1200,
      stream,
    }),
  }).catch((err: unknown) => {
    throw new UpstreamError(`Groq API is unreachable. ${err instanceof Error ? err.message : String(err)}`, 502);
  });
}

async function generateText(body: RequestBody, modelId: string, messages: ChatMessage[]): Promise<string> {
  const upstream = await fetchUpstream(body, modelId, messages, false);
  if (upstream.status !== 200) {
    throw new UpstreamError(await readError(upstream, `${getModelAlias(modelId)} returned HTTP ${upstream.status}`), upstream.status);
  }

  const provider = providerFor(modelId);
  const json = await upstream.json().catch(() => ({}));
  if (provider === "gemini") {
    return (json?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();
  }
  if (provider === "ollama" || provider === "ollama-cloud") {
    return String(json?.message?.content ?? "").trim();
  }
  return String(json?.choices?.[0]?.message?.content ?? "").trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

async function openStreamingUpstream(body: RequestBody, modelId: string, messages: ChatMessage[]) {
  const upstream = await fetchUpstream(body, modelId, messages, true);
  if (upstream.status !== 200) {
    if (upstream.status === 413) {
      throw new UpstreamError("Responses too large for consensus - try shorter conversations.", 413);
    }
    throw new UpstreamError(await readError(upstream, `${getModelAlias(modelId)} returned HTTP ${upstream.status}`), upstream.status);
  }
  if (!upstream.body) throw new UpstreamError("No upstream body", 502);

  return { upstream, provider: providerFor(modelId) };
}

async function pipeStreamingText(
  send: SendEvent,
  opened: Awaited<ReturnType<typeof openStreamingUpstream>>
) {
  const reader = opened.upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
          if (delta) send({ type: "delta", text: delta });
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
        if (opened.provider === "gemini") {
          const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) send({ type: "delta", text });
        } else {
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) send({ type: "delta", text: delta });
          if (json?.usage) send({ type: "usage", usage: json.usage });
          const finish = json?.choices?.[0]?.finish_reason;
          if (finish) send({ type: "finish", reason: finish });
        }
      } catch {
        // ignore malformed stream lines
      }
    }
  }
}

async function streamTextEvents(
  send: SendEvent,
  body: RequestBody,
  modelId: string,
  messages: ChatMessage[]
) {
  const opened = await openStreamingUpstream(body, modelId, messages);
  await pipeStreamingText(send, opened);
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

// Runs the judge (non-streaming) over the panel answers. Non-fatal: returns null
// if no judge model succeeds or the output cannot be parsed, so synthesis proceeds.
async function maybeRunJudge(send: SendEvent, body: RequestBody): Promise<JudgeResult | null> {
  if (body.responses.length === 0) return null;
  const judgeModels = unique([
    body.judgeModel,
    ...(body.judgeFallbackModels ?? []),
    body.consensusModel,
    ...(body.fallbackModels ?? []),
  ]);
  if (judgeModels.length === 0) return null;

  const messages = judgeMessages(body);
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
  return [
    { role: "system", content: synthesisPrompt(qualityModeFor(body.qualityMode), solo) },
    { role: "user", content },
  ];
}

async function runSingle(body: RequestBody): Promise<Response> {
  const models = unique([body.consensusModel, ...(body.fallbackModels ?? [])]);
  if (models.length === 0) throw new UpstreamError("Missing consensusModel", 400);

  return createNdjsonResponse(async (send) => {
    const judge = await maybeRunJudge(send, body);
    const messages = synthesisMessages(body, judge);

    let lastError: UpstreamError | null = null;
    for (const model of models) {
      try {
        await streamTextEvents(send, body, model, messages);
        return;
      } catch (err) {
        lastError =
          err instanceof UpstreamError
            ? err
            : new UpstreamError(err instanceof Error ? err.message : String(err), 502);
      }
    }

    throw lastError ?? new UpstreamError("Consensus failed.", 502);
  });
}

function formatCouncilHistory(notes: CouncilNote[]): string {
  if (notes.length === 0) return "No previous council notes yet.";
  return notes
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
  notes: CouncilNote[]
): Promise<CouncilNote> {
  const alias = getModelAlias(modelId);
  const content = await generateText(body, modelId, [
    { role: "system", content: councilPositionPrompt(qualityModeFor(body.qualityMode)) },
    {
      role: "user",
      content:
        `You are ${alias}.\n\n` +
        `Round: ${round.title}\n` +
        `Your task: ${round.instruction}\n\n` +
        `${baseBlock}\n\n` +
        `Previous visible council notes:\n${formatCouncilHistory(notes)}\n\n` +
        `Respond as ${alias}. Start with "${alias}:". Keep it concise and user-visible.`,
    },
  ]);
  if (!content) throw new UpstreamError(`${alias} returned an empty council note.`, 502);
  return { round: round.id, roundTitle: round.title, modelId, alias, content };
}

function moderatorModelIds(body: RequestBody, participants: string[]): string[] {
  if (body.moderatorModels?.length) {
    return unique([...body.moderatorModels, ...participants]);
  }
  return unique([body.consensusModel, ...(body.fallbackModels ?? []), ...participants]);
}

async function runCouncil(body: RequestBody): Promise<Response> {
  const candidates = unique(body.candidateModels ?? []);
  const fallbacks = unique(body.fallbackModels ?? []);
  if (candidates.length < 2) throw new UpstreamError("Model council needs at least two available models.", 400);

  return createNdjsonResponse(async (send) => {
    const fallbackQueue = fallbacks.filter((id) => !candidates.includes(id));
    const usedModels = new Set(candidates);
    const allNotes: CouncilNote[] = [];
    const baseBlock = formatResponseBlock(body.prompt, body.responses, body.webSearch);
    let participants = [...candidates];

    for (const candidate of participants) {
      sendCouncilStatus(send, candidate, "queued");
    }

    for (const round of COUNCIL_ROUNDS) {
      send({ type: "round_start", round: round.id, title: round.title });
      const settled = await Promise.allSettled(
        participants.map(async (modelId) => {
          sendCouncilStatus(send, modelId, "running", round.id);
          return generateCouncilNote(body, modelId, round, baseBlock, allNotes);
        })
      );
      const nextParticipants: string[] = [];

      for (let i = 0; i < settled.length; i += 1) {
        const modelId = participants[i];
        const result = settled[i];
        if (result.status === "fulfilled") {
          allNotes.push(result.value);
          nextParticipants.push(modelId);
          sendCouncilStatus(send, modelId, "done", round.id);
          send({
            type: "council_note",
            round: round.id,
            roundTitle: round.title,
            modelId,
            model: result.value.alias,
            text: result.value.content,
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
            replacementNote = await generateCouncilNote(body, fallback, round, baseBlock, allNotes);
            allNotes.push(replacementNote);
            nextParticipants.push(fallback);
            sendCouncilStatus(send, fallback, "done", round.id);
            send({
              type: "council_note",
              round: round.id,
              roundTitle: round.title,
              modelId: fallback,
              model: replacementNote.alias,
              text: replacementNote.content,
            });
          } catch (err: unknown) {
            sendCouncilStatus(send, fallback, "failed", round.id, errorMessage(err));
          }
        }
      }

      participants = nextParticipants;
      if (participants.length < 2) {
        throw new UpstreamError("Model council needs at least two working models.", 502);
      }
    }

    const judge = await maybeRunJudge(send, body);
    const councilBlock = [
      baseBlock,
      "",
      "Visible council debate:",
      ...allNotes.map((note) => `\n--- ${note.roundTitle} / ${note.alias} ---\n${note.content}`),
      ...(judge ? ["", formatJudgeBlock(judge)] : []),
    ].join("\n");

    send({ type: "round_start", round: "synthesis", title: "Final synthesis" });
    let lastError: UpstreamError | null = null;
    for (const modelId of moderatorModelIds(body, participants)) {
      try {
        sendCouncilStatus(send, modelId, "running", "synthesis", "Moderating final verdict");
        await streamTextEvents(send, body, modelId, [
          { role: "system", content: councilSynthesisPrompt(qualityModeFor(body.qualityMode)) },
          { role: "user", content: councilBlock },
        ]);
        sendCouncilStatus(send, modelId, "done", "synthesis", "Final verdict complete");
        return;
      } catch (err: unknown) {
        lastError = err instanceof UpstreamError ? err : new UpstreamError(errorMessage(err), 502);
        sendCouncilStatus(send, modelId, "failed", "synthesis", lastError.message);
      }
    }

    throw lastError ?? new UpstreamError("Model council synthesis failed.", 502);
  });
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

  try {
    return body.mode === "council" ? await runCouncil(body) : await runSingle(body);
  } catch (err) {
    const error = err instanceof UpstreamError ? err : new UpstreamError(err instanceof Error ? err.message : String(err), 502);
    return new Response(error.message, { status: error.status });
  }
}
