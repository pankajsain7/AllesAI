"use client";

import { filterSelectableModelIds, getEnabledRoutes, useChat, useSettings, type Message, normalizeModelId, SUPER_THREAD_ID } from "./store";
import { isCloudOllamaModelId, isOllamaModelId, isOpenCodeModelId, isBedrockModelId, type ModelInfo } from "./models";
import { streamDraftKey, useStreamDrafts } from "./stream-drafts";
import { markPromptSubmitted } from "./scroll-intent";

// Per-model abort controllers for mid-stream stopping
const activeControllers = new Map<string, AbortController>();

// Tracks the latest top-level session controller so the Composer stop button
// works even when the prompt was sent from HeroComposer (which can't keep its
// own ref because the component unmounts before streaming starts).
let sessionAbortController: AbortController | null = null;

export function abortModel(convId: string, modelId: string) {
  const key = `${convId}:${modelId}`;
  activeControllers.get(key)?.abort();
  activeControllers.delete(key);
}

export function abortAllStreams() {
  sessionAbortController?.abort();
  sessionAbortController = null;
}

type ChatRequestMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type WebContext = {
  text: string;
  grounding: NonNullable<Message["grounding"]>;
};

function cleanContextText(text?: string) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function limitContextText(text: string | undefined, maxLength: number) {
  const cleaned = cleanContextText(text);
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).replace(/\s+\S*$/, "").trim() + "...";
}

function createDraftWriter(key: string) {
  let content = "";
  let frame: number | null = null;

  const writeDraft = () => {
    frame = null;
    useStreamDrafts.getState().setDraft(key, content);
  };

  const cancelScheduledWrite = () => {
    if (frame === null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frame);
    } else {
      window.clearTimeout(frame);
    }
    frame = null;
  };

  const scheduleWrite = () => {
    if (frame !== null) return;
    frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(writeDraft)
        : window.setTimeout(writeDraft, 16);
  };

  return {
    append(delta: string) {
      content += delta;
      scheduleWrite();
    },
    getContent() {
      return content;
    },
    flush() {
      cancelScheduledWrite();
      writeDraft();
    },
    clear() {
      cancelScheduledWrite();
      useStreamDrafts.getState().clearDraft(key);
    },
  };
}

function extractApiError(raw: string, fallback: string): string {
  if (!raw) return fallback;
  try {
    const json = JSON.parse(raw);
    if (typeof json?.error === "string") return json.error;
    if (typeof json?.error?.message === "string") return json.error.message;
    if (typeof json?.message === "string") return json.message;
  } catch {
    /* keep raw text */
  }
  return raw;
}

function isSubscriptionError(message: string): boolean {
  return /requires?\s+(an?\s+)?subscription|upgrade\s+for\s+access/i.test(message);
}

function formatChatError(raw: string, status: number, statusText: string, modelId: string): string {
  const parsed = extractApiError(raw, statusText || "Request failed");

  if (isSubscriptionError(parsed)) {
    if (modelId === "ollama-cloud/qwen3-coder:480b") {
      return "Qwen3 Coder 480B on Ollama requires a paid subscription tier. Choose a free alternative (for example Qwen3 32B on Groq or Big Pickle on OpenCode)."
    }
    const provider = isCloudOllamaModelId(modelId) || isOllamaModelId(modelId)
      ? "Ollama"
      : "The provider";
    return `${provider} says this model requires a subscription. Choose another model/source, or upgrade at https://ollama.com/upgrade.`;
  }

  if (status === 429) return "Rate limited - wait a moment and try again.";
  if (status === 401) return "Invalid or missing API key for this model. Check Settings.";
  if (status === 404) return `Model "${modelId}" not found. ${parsed}`;
  if (status === 502 && isOllamaModelId(modelId)) {
    return "Ollama is offline or unreachable. Start Ollama and retry this column.";
  }
  if (status === 502 && isCloudOllamaModelId(modelId)) {
    return "Ollama API is unreachable. Check the base URL in Settings.";
  }
  if (status === 502 && isOpenCodeModelId(modelId)) {
    return "OpenCode Zen is unreachable. Check your OpenCode API key in Settings.";
  }
  if (status === 502 && isBedrockModelId(modelId)) {
    return "Amazon Bedrock is unreachable. Check your Bedrock API key in Settings.";
  }

  return parsed || "Request failed";
}

function toApiMessages(
  history: Message[],
  systemPrompt: string,
  webContext?: WebContext
): ChatRequestMessage[] {
  const out: ChatRequestMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  if (webContext) {
    out.push({
      role: "system",
      content:
        [
          "Use the private web context below as live retrieval for this turn.",
          "Answer directly, as if you checked the web yourself.",
          "Do not mention search results, snippets, private context, or retrieval mechanics.",
          "Cite web-backed claims with source numbers like [1] or [2].",
          "Prefer recent and primary sources; if sources conflict or are insufficient, say what could not be verified.",
          "Use your own reasoning to synthesize the answer instead of summarizing sources one by one.",
        ].join("\n") +
        "\n\n" +
        webContext.text,
    });
  }
  for (const m of history) {
    if (m.role === "system") continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export async function streamModel(opts: {
  convId: string;
  modelId: string;
  assistantMsgId?: string;
  abortSignal?: AbortSignal;
  webContext?: WebContext;
}) {
  const { convId, modelId } = opts;
  // Create a local controller so we can abort per-model independently
  const localCtrl = new AbortController();
  const streamKey = `${convId}:${modelId}`;
  activeControllers.set(streamKey, localCtrl);
  // If a parent signal is passed (e.g. "stop all"), hook it up
  opts.abortSignal?.addEventListener("abort", () => localCtrl.abort());
  if (opts.abortSignal?.aborted) localCtrl.abort();
  const abortSignal = localCtrl.signal;
  const chatState = useChat.getState();
  const settings = useSettings.getState();
  const conv = chatState.conversations[convId];
  if (!conv) return;
  const thread = conv.threads[modelId];
  if (!thread) return;

  // Drop any trailing assistant placeholder we're about to add anew, send only history.
  const history = thread.messages.filter(
    (m) => !(m.role === "assistant" && m.pending)
  );

  const msgId = opts.assistantMsgId ?? chatState.startAssistant(convId, modelId);
  chatState.setAssistantStatus(convId, modelId, msgId, "thinking");
  const draftKey = streamDraftKey(convId, modelId, msgId);
  useStreamDrafts.getState().clearDraft(draftKey);
  const draft = createDraftWriter(draftKey);

  // Normalize model ID in case persisted data still has a stale alias
  const resolvedModelId = normalizeModelId(modelId) ?? modelId;
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      signal: abortSignal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolvedModelId,
        messages: toApiMessages(history, settings.systemPrompt, opts.webContext),
        apiKey: settings.apiKey || undefined,
        opencodeApiKey: settings.opencodeApiKey || undefined,
        bedrockApiKey: settings.bedrockApiKey || undefined,
        ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
        ollamaApiKey: settings.ollamaApiKey || undefined,
        ollamaCloudBaseUrl: settings.ollamaCloudBaseUrl || undefined,
        customProviders: settings.customProviders.length ? settings.customProviders : undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => res.statusText);
      const errorMsg = formatChatError(raw, res.status, res.statusText, resolvedModelId);
      useChat.getState().failAssistant(convId, modelId, msgId, errorMsg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: { promptTokens?: number; completionTokens?: number; costUsd?: number } | undefined;
    let grounding: Message["grounding"] | undefined = opts.webContext?.grounding;

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
          const evt = JSON.parse(line);
          if (evt.type === "delta") {
            if (firstTokenAt === null) {
              firstTokenAt = performance.now();
              if (process.env.NODE_ENV === "development") {
                console.debug(
                  `[stream] first token ${resolvedModelId}: ${Math.round(firstTokenAt - startedAt)}ms`
                );
              }
            }
            draft.append(evt.text);
          } else if (evt.type === "usage") {
            const u = evt.usage as {
              prompt_tokens?: number;
              completion_tokens?: number;
              cost?: number;
            };
            usage = {
              promptTokens: u.prompt_tokens,
              completionTokens: u.completion_tokens,
              costUsd: typeof u.cost === "number" ? u.cost : undefined,
            };
          } else if (evt.type === "grounding") {
            grounding = { queries: evt.queries, sources: evt.sources };
          } else if (evt.type === "error") {
            draft.flush();
            useChat.getState().finishAssistant(convId, modelId, msgId, {
              content: draft.getContent(),
              error: evt.message,
              pending: false,
            });
            return;
          }
        } catch {
          // ignore
        }
      }
    }

    draft.flush();
    useChat.getState().finishAssistant(convId, modelId, msgId, {
      content: draft.getContent(),
      usage,
      grounding,
    });
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "AbortError") {
      // Keep whatever was already streamed - just mark as no longer pending
      draft.flush();
      useChat.getState().finishAssistant(convId, modelId, msgId, {
        content: draft.getContent(),
      });
      return;
    }
    draft.flush();
    useChat.getState().finishAssistant(convId, modelId, msgId, {
      content: draft.getContent(),
      error: err instanceof Error ? err.message : String(err),
      pending: false,
    });
  } finally {
    if (process.env.NODE_ENV === "development") {
      console.debug(
        `[stream] finished ${resolvedModelId}: ${Math.round(performance.now() - startedAt)}ms`
      );
    }
    draft.clear();
    activeControllers.delete(streamKey);
  }
}

type SearchApiResponse = {
  query?: string;
  answer?: string;
  results?: Array<{
    title: string;
    uri: string;
    snippet?: string;
    content?: string;
    publishedDate?: string;
  }>;
  error?: string;
};

function promptNeedsFreshInfo(prompt: string) {
  return /\b(latest|today|current|currently|recent|news|updates?|new|now|this week|this month|breaking|headlines|202[5-9])\b/i.test(prompt);
}

function getWebSearchMode(prompt: string, settings: ReturnType<typeof useSettings.getState>) {
  if (settings.webSearch) return "manual" as const;
  if (promptNeedsFreshInfo(prompt)) return "auto" as const;
  return "off" as const;
}

async function fetchWebContext(prompt: string, signal: AbortSignal): Promise<WebContext> {
  const settings = useSettings.getState();
  const res = await fetch("/api/search", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: prompt,
      apiKey: settings.tavilyApiKey || undefined,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as SearchApiResponse;
  if (!res.ok) {
    throw new Error(data.error || `Tavily MCP search failed with HTTP ${res.status}.`);
  }

  const results = data.results ?? [];
  if (results.length === 0) {
    throw new Error("Tavily MCP returned no useful results.");
  }

  return {
    text: [
      `Question: ${prompt}`,
      `Retrieval query: ${data.query || prompt}`,
      data.answer ? `Retrieval synthesis: ${limitContextText(data.answer, 900)}` : "",
      ...results.map(
        (result, index) => {
          const lines = [
            `[${index + 1}] ${result.title}`,
            `URL: ${result.uri}`,
          ];
          if (result.publishedDate) lines.push(`Published: ${result.publishedDate}`);
          lines.push(`Key facts: ${limitContextText(result.snippet, 700) || "(no summary)"}`);
          if (result.content) {
            lines.push(`Relevant excerpt: ${limitContextText(result.content, 1400)}`);
          }
          return lines.join("\n");
        }
      ),
    ].filter(Boolean).join("\n\n"),
    grounding: {
      queries: data.query ? [data.query] : [prompt],
      sources: results.map((result) => ({ title: result.title, uri: result.uri })),
    },
  };
}

const ENHANCE_SYSTEM_PROMPT = [
  "You are an expert prompt engineer. Rewrite the user's prompt so an AI assistant returns a clearer, more accurate, and more useful answer.",
  "Preserve the user's original intent and language. Make the request specific and well-structured: add helpful context, constraints, and a desired output format when they improve the result.",
  "Do not invent facts, do not add placeholders the user must fill in, and do not answer the prompt yourself.",
  "Output ONLY the improved prompt text - no preamble, quotes, labels, or explanation.",
].join("\n");

function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

// Calls a single model via /api/chat to rewrite a prompt into a stronger version.
// Reuses the chat endpoint so every provider route is supported automatically.
export async function enhancePrompt(
  modelId: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const settings = useSettings.getState();
  const resolvedModelId = normalizeModelId(modelId) ?? modelId;

  const res = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: resolvedModelId,
      messages: [
        { role: "system", content: ENHANCE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      apiKey: settings.apiKey || undefined,
      opencodeApiKey: settings.opencodeApiKey || undefined,
      bedrockApiKey: settings.bedrockApiKey || undefined,
      ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
      ollamaApiKey: settings.ollamaApiKey || undefined,
      ollamaCloudBaseUrl: settings.ollamaCloudBaseUrl || undefined,
      customProviders: settings.customProviders.length ? settings.customProviders : undefined,
    }),
  });

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => res.statusText);
    throw new Error(formatChatError(raw, res.status, res.statusText, resolvedModelId));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let evt: { type?: string; text?: string; message?: string } | null = null;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt?.type === "delta" && typeof evt.text === "string") out += evt.text;
      else if (evt?.type === "error" && evt.message) throw new Error(evt.message);
    }
  }

  return stripThinking(out);
}

// Candidate models the auto-router can choose from (one route per family).
function autoRouterCandidates(): ModelInfo[] {
  const settings = useSettings.getState();
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const route of getEnabledRoutes(settings)) {
    if (seen.has(route.familyId)) continue;
    seen.add(route.familyId);
    out.push(route);
  }
  return out;
}

const MULTI_ROUTER_SYSTEM_PROMPT = [
  "You are a router that ranks the AI models best suited to answer the user's question.",
  "Choose strictly from the provided candidate list, using each model's strengths and category.",
  "Prefer complementary picks: reasoning/coding models for hard logic or code, vision models for images, strong general models for everything else.",
  "Reply with ONLY the exact model ids in ranked order, best first, separated by commas - no quotes, labels, or explanation.",
].join("\n");

// Picks the N best distinct model ids for a prompt by asking a fast model to
// rank the available candidates. Falls back to the first N candidates when
// routing fails or returns too few matches. Used by super mode to choose the
// two models that will collaborate on the answer.
export async function pickBestModels(
  prompt: string,
  count: number,
  signal?: AbortSignal
): Promise<string[]> {
  const candidates = autoRouterCandidates();
  if (candidates.length <= count) return candidates.map((c) => c.id);

  const settings = useSettings.getState();
  const routerModel =
    normalizeModelId(settings.consensusModel) ??
    candidates.find((c) => c.apiProvider === "bedrock")?.id ??
    candidates[0].id;

  const list = candidates
    .map((c) => `- ${c.id} | ${c.label} | ${c.category}${c.bestFor ? ` | best for: ${c.bestFor}` : ""}`)
    .join("\n");
  const userMessage = `Candidate models:\n${list}\n\nUser question:\n${prompt}\n\nBest ${count} model ids, ranked, comma-separated:`;

  const picked: string[] = [];
  try {
    const raw = await callModelOnce(
      routerModel,
      [
        { role: "system", content: MULTI_ROUTER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      signal
    );
    const answer = raw.trim();
    for (const candidate of candidates) {
      if (picked.length >= count) break;
      if (answer.includes(candidate.id) && !picked.includes(candidate.id)) {
        picked.push(candidate.id);
      }
    }
    // Preserve the router's ranking order when it emitted ids in a clear order.
    const ordered = answer
      .split(/[\s,]+/)
      .map((token) => candidates.find((c) => c.id === token)?.id)
      .filter((id): id is string => Boolean(id));
    const rankedUnique = Array.from(new Set([...ordered, ...picked]));
    if (rankedUnique.length >= count) return rankedUnique.slice(0, count);
    picked.splice(0, picked.length, ...rankedUnique);
  } catch {
    // fall through to fill from the candidate order
  }

  // Backfill with the highest-priority remaining candidates.
  for (const candidate of candidates) {
    if (picked.length >= count) break;
    if (!picked.includes(candidate.id)) picked.push(candidate.id);
  }
  return picked.slice(0, count);
}

// Calls a single model via /api/chat and returns its full text response.
async function callModelOnce(
  modelId: string,
  messages: ChatRequestMessage[],
  signal?: AbortSignal
): Promise<string> {
  const settings = useSettings.getState();
  const resolvedModelId = normalizeModelId(modelId) ?? modelId;
  const res = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: resolvedModelId,
      messages,
      apiKey: settings.apiKey || undefined,
      opencodeApiKey: settings.opencodeApiKey || undefined,
      bedrockApiKey: settings.bedrockApiKey || undefined,
      ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
      ollamaApiKey: settings.ollamaApiKey || undefined,
      ollamaCloudBaseUrl: settings.ollamaCloudBaseUrl || undefined,
      customProviders: settings.customProviders.length ? settings.customProviders : undefined,
    }),
  });

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => res.statusText);
    throw new Error(formatChatError(raw, res.status, res.statusText, resolvedModelId));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let evt: { type?: string; text?: string; message?: string } | null = null;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      if (evt?.type === "delta" && typeof evt.text === "string") out += evt.text;
      else if (evt?.type === "error" && evt.message) throw new Error(evt.message);
    }
  }
  return stripThinking(out);
}

export function sendPromptToAll(
  convId: string,
  prompt: string
): AbortController {
  const ctrl = new AbortController();
  sessionAbortController = ctrl;
  const state = useChat.getState();
  const settings = useSettings.getState();
  const conv = state.conversations[convId];
  if (!conv) return ctrl;

  markPromptSubmitted(convId);

  // Super mode orchestrates the two best models under the hood and streams back
  // one synthesized answer (no model names, auto prompt-enhancement + search).
  if (conv.chatMode === "super") {
    void runSuperPrompt(convId, prompt, ctrl);
    return ctrl;
  }

  // Respect focus mode and disabled models
  const disabled = new Set(conv.disabledModels ?? []);
  const candidateTargets = (conv.focusedModel ? [conv.focusedModel] : conv.selectedModels)
    .filter((id) => !disabled.has(id));
  const targets = filterSelectableModelIds(candidateTargets, settings);
  state.addUserMessage(convId, prompt, targets);
  streamTargets(convId, prompt, targets, ctrl, settings);
  return ctrl;
}

// Super mode: the whole pipeline runs silently and streams a single best answer
// into one virtual thread. Steps: (1) web-search ONLY when the question needs
// fresh facts (prompt enhancement is an optional helper that just sharpens the
// search query — it never changes the question), (2) pick the two best
// available models for this question, (3) get both answers on the REAL question
// with full conversation context, (4) synthesize them into one clean answer
// with no model names or analysis sections. Grounding mirrors consensus mode.
async function runSuperPrompt(convId: string, prompt: string, ctrl: AbortController) {
  const settings = useSettings.getState();
  const state = useChat.getState();
  const conv = state.conversations[convId];
  if (!conv) return;

  state.addUserMessage(convId, prompt, [SUPER_THREAD_ID]);
  const msgId = state.startAssistant(convId, SUPER_THREAD_ID, "thinking");

  const streamKey = `${convId}:${SUPER_THREAD_ID}`;
  const localCtrl = new AbortController();
  activeControllers.set(streamKey, localCtrl);
  ctrl.signal.addEventListener("abort", () => localCtrl.abort());
  if (ctrl.signal.aborted) localCtrl.abort();
  const signal = localCtrl.signal;

  const draftKey = streamDraftKey(convId, SUPER_THREAD_ID, msgId);
  useStreamDrafts.getState().clearDraft(draftKey);
  const draft = createDraftWriter(draftKey);

  let finalized = false;
  const finalize = (patch: Partial<Message>) => {
    if (finalized) return;
    finalized = true;
    draft.flush();
    useChat.getState().finishAssistant(convId, SUPER_THREAD_ID, msgId, {
      content: draft.getContent(),
      ...patch,
    });
    draft.clear();
    if (activeControllers.get(streamKey) === localCtrl) activeControllers.delete(streamKey);
  };

  const setStatus = (status: Message["status"]) =>
    useChat.getState().setAssistantStatus(convId, SUPER_THREAD_ID, msgId, status);
  const fail = (message: string) => finalize({ error: message, pending: false });

  // A stop (from the column or "stop all") finalizes the message with whatever
  // was streamed so far, instead of leaving it stuck as pending.
  localCtrl.signal.addEventListener("abort", () => finalize({}));

  try {
    const candidates = autoRouterCandidates();
    if (candidates.length === 0) {
      fail("No models are available. Enable a provider in Settings to use Super mode.");
      return;
    }

    // 1) Web search is an ADDITIONAL step, only when the question needs fresh
    //    facts (auto-detected) or the user turned it on. Prompt enhancement is
    //    EXTRA and non-destructive: it is used only to sharpen the search query,
    //    never to alter the actual question the models answer. This keeps the
    //    answer grounded in what the user really asked (no context drift).
    let webContext: WebContext | undefined;
    if (getWebSearchMode(prompt, settings) !== "off") {
      setStatus("searching");
      let searchQuery = prompt;
      // Prompt enhancement only helps short/vague prompts. Skip it for longer
      // prompts (>= 100 chars) that already carry enough detail to search well.
      if (prompt.trim().length < 100) {
        const enhancerModel =
          normalizeModelId(settings.consensusModel) &&
          candidates.some((c) => c.id === normalizeModelId(settings.consensusModel))
            ? (normalizeModelId(settings.consensusModel) as string)
            : candidates[0].id;
        try {
          const improved = await enhancePrompt(enhancerModel, prompt, signal);
          if (improved && improved.trim()) searchQuery = improved.trim();
        } catch {
          // enhancement is optional — fall back to the raw prompt as the query
        }
      }
      if (signal.aborted) return;
      try {
        webContext = await fetchWebContext(searchQuery, signal);
      } catch {
        // search is best-effort in super mode — continue without it
      }
    }
    if (signal.aborted) return;
    setStatus("thinking");

    // 2) Pick the two best models for this question (based on the real prompt).
    const picked = await pickBestModels(prompt, 2, signal);
    if (signal.aborted) return;
    if (picked.length === 0) {
      fail("Could not select models for Super mode.");
      return;
    }

    // 3) Ask each picked model the ACTUAL question with full conversation
    //    context (mirrors normal chat + consensus, so answers stay on-topic).
    //    Web context, when present, is attached as extra retrieval material.
    const thread = useChat.getState().conversations[convId]?.threads[SUPER_THREAD_ID];
    const history = (thread?.messages ?? []).filter(
      (m) => !(m.role === "assistant" && m.pending)
    );
    const modelMessages = toApiMessages(history, settings.systemPrompt, webContext);

    const settled = await Promise.allSettled(
      picked.map((modelId) => callModelOnce(modelId, modelMessages, signal))
    );
    if (signal.aborted) return;

    const answers: Array<{ model: string; content: string }> = [];
    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      if (result.status === "fulfilled" && result.value.trim()) {
        answers.push({ model: picked[i], content: result.value });
      }
    }
    if (answers.length === 0) {
      const firstError = settled.find(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );
      fail(
        firstError
          ? firstError.reason instanceof Error
            ? firstError.reason.message
            : String(firstError.reason)
          : "No model produced an answer."
      );
      return;
    }

    // 4) Synthesize the answers into one clean best answer via the consensus
    //    endpoint's "super" mode. Grounded on the REAL question + the real
    //    answers, exactly like consensus (answer only, no names, no sections).
    const synthesizer =
      normalizeModelId(settings.consensusModel) &&
      candidates.some((c) => c.id === normalizeModelId(settings.consensusModel))
        ? (normalizeModelId(settings.consensusModel) as string)
        : candidates.find((c) => c.apiProvider === "bedrock")?.id ?? candidates[0].id;
    const fallbackModels = Array.from(
      new Set([...picked, ...candidates.map((c) => c.id)])
    ).filter((id) => id !== synthesizer);

    const res = await fetch("/api/consensus", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        responses: answers,
        mode: "super",
        qualityMode: "quick",
        consensusModel: synthesizer,
        fallbackModels,
        webSearch: Boolean(webContext),
        apiKey: settings.apiKey || undefined,
        opencodeApiKey: settings.opencodeApiKey || undefined,
        bedrockApiKey: settings.bedrockApiKey || undefined,
        ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
        ollamaApiKey: settings.ollamaApiKey || undefined,
        ollamaCloudBaseUrl: settings.ollamaCloudBaseUrl || undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => res.statusText);
      fail(extractApiError(raw, res.statusText || "Super mode failed."));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: Message["usage"];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let evt: { type?: string; text?: string; message?: string; usage?: Record<string, number> };
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "delta" && typeof evt.text === "string") {
          draft.append(evt.text);
        } else if (evt.type === "usage" && evt.usage) {
          usage = {
            promptTokens: evt.usage.prompt_tokens,
            completionTokens: evt.usage.completion_tokens,
            costUsd: typeof evt.usage.cost === "number" ? evt.usage.cost : undefined,
          };
        } else if (evt.type === "error" && evt.message) {
          fail(evt.message);
          return;
        }
      }
    }

    finalize({ usage, grounding: webContext?.grounding });
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "AbortError") {
      finalize({});
      return;
    }
    fail(err instanceof Error ? err.message : String(err));
  }
}

// Starts assistant placeholders and streams responses for the given targets.
// The user message must already have been added to each target thread.
// `existingMsgIds` lets callers reuse a placeholder they already created.
function streamTargets(
  convId: string,
  prompt: string,
  targets: string[],
  ctrl: AbortController,
  settings = useSettings.getState(),
  existingMsgIds?: Map<string, string>
) {
  const webSearchMode = getWebSearchMode(prompt, settings);
  const effectiveWebSearch = webSearchMode !== "off";
  const state = useChat.getState();
  const assistantMsgIds = new Map<string, string>();
  for (const modelId of targets) {
    const existing = existingMsgIds?.get(modelId);
    const msgId = existing ?? state.startAssistant(convId, modelId, effectiveWebSearch ? "searching" : "thinking");
    if (existing && effectiveWebSearch) state.setAssistantStatus(convId, modelId, msgId, "searching");
    assistantMsgIds.set(modelId, msgId);
  }

  void (async () => {
    let webContext: WebContext | undefined;
    if (effectiveWebSearch) {
      try {
        webContext = await fetchWebContext(prompt, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (webSearchMode === "auto") {
          for (const modelId of targets) {
            const msgId = assistantMsgIds.get(modelId);
            if (msgId) useChat.getState().setAssistantStatus(convId, modelId, msgId, "thinking");
          }
        } else {
          const message = err instanceof Error ? err.message : String(err);
          for (const modelId of targets) {
            const msgId = assistantMsgIds.get(modelId) ?? useChat.getState().startAssistant(convId, modelId);
            useChat.getState().failAssistant(convId, modelId, msgId, `Web search failed: ${message}`);
          }
          return;
        }
      }
    }

    if (ctrl.signal.aborted) return;

    // Multiple models: send one multiplexed request so all models stream over a
    // single connection (avoids the browser's ~6 concurrent-connection limit,
    // which otherwise makes large runs complete in slow sequential waves).
    if (targets.length > 1) {
      await streamMultiplexed(convId, targets, assistantMsgIds, ctrl, settings, webContext);
      return;
    }

    // Single model (also used by auto/single modes): keep the direct per-model
    // stream. streamModel registers its own abort controller for stop support.
    for (const modelId of targets) {
      void streamModel({
        convId,
        modelId,
        assistantMsgId: assistantMsgIds.get(modelId),
        abortSignal: ctrl.signal,
        webContext,
      });
    }
  })();
}

type MultiplexModelState = {
  modelId: string;
  apiModel: string;
  msgId: string;
  draft: ReturnType<typeof createDraftWriter>;
  ctrl: AbortController;
  usage?: { promptTokens?: number; completionTokens?: number; costUsd?: number };
  grounding?: Message["grounding"];
  firstTokenAt: number | null;
  startedAt: number;
  done: boolean;
};

// Streams every target model through the /api/chat/multi fan-out endpoint over a
// single HTTP connection, routing each tagged event back to the right column.
async function streamMultiplexed(
  convId: string,
  targets: string[],
  assistantMsgIds: Map<string, string>,
  ctrl: AbortController,
  settings: ReturnType<typeof useSettings.getState>,
  webContext?: WebContext
) {
  const chatState = useChat.getState();
  const conv = chatState.conversations[convId];
  if (!conv) return;

  const perModel = new Map<string, MultiplexModelState>();
  const items: Array<{ id: string; model: string; messages: ChatRequestMessage[] }> = [];

  for (const modelId of targets) {
    const thread = conv.threads[modelId];
    const msgId = assistantMsgIds.get(modelId);
    if (!thread || !msgId) continue;
    chatState.setAssistantStatus(convId, modelId, msgId, "thinking");
    const draftKey = streamDraftKey(convId, modelId, msgId);
    useStreamDrafts.getState().clearDraft(draftKey);
    const history = thread.messages.filter((m) => !(m.role === "assistant" && m.pending));
    const apiModel = normalizeModelId(modelId) ?? modelId;
    const modelCtrl = new AbortController();
    activeControllers.set(`${convId}:${modelId}`, modelCtrl);
    perModel.set(modelId, {
      modelId,
      apiModel,
      msgId,
      draft: createDraftWriter(draftKey),
      ctrl: modelCtrl,
      firstTokenAt: null,
      startedAt: performance.now(),
      grounding: webContext?.grounding,
      done: false,
    });
    items.push({
      id: modelId,
      model: apiModel,
      messages: toApiMessages(history, settings.systemPrompt, webContext),
    });
  }

  if (items.length === 0) return;

  const finalize = (pm: MultiplexModelState, patch: Partial<Message>) => {
    if (pm.done) return;
    pm.done = true;
    pm.draft.flush();
    useChat.getState().finishAssistant(convId, pm.modelId, pm.msgId, {
      content: pm.draft.getContent(),
      usage: pm.usage,
      grounding: pm.grounding,
      ...patch,
    });
    pm.draft.clear();
    const streamKey = `${convId}:${pm.modelId}`;
    if (activeControllers.get(streamKey) === pm.ctrl) activeControllers.delete(streamKey);
  };

  // The batch shares one network request. Stopping a single column finalizes
  // just that model locally; once every column is stopped we abort the request.
  const requestCtrl = new AbortController();
  ctrl.signal.addEventListener("abort", () => requestCtrl.abort());
  for (const pm of perModel.values()) {
    pm.ctrl.signal.addEventListener("abort", () => {
      finalize(pm, {});
      if ([...perModel.values()].every((p) => p.done)) requestCtrl.abort();
    });
  }

  try {
    const res = await fetch("/api/chat/multi", {
      method: "POST",
      signal: requestCtrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        apiKey: settings.apiKey || undefined,
        opencodeApiKey: settings.opencodeApiKey || undefined,
        bedrockApiKey: settings.bedrockApiKey || undefined,
        ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
        ollamaApiKey: settings.ollamaApiKey || undefined,
        ollamaCloudBaseUrl: settings.ollamaCloudBaseUrl || undefined,
        customProviders: settings.customProviders.length ? settings.customProviders : undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => res.statusText);
      for (const pm of perModel.values()) {
        finalize(pm, {
          error: formatChatError(raw, res.status, res.statusText, pm.apiModel),
          pending: false,
        });
      }
      return;
    }

    const reader = res.body.getReader();
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
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        const pm = perModel.get(String(evt.id));
        if (!pm || pm.done || pm.ctrl.signal.aborted) continue;

        switch (evt.type) {
          case "delta": {
            if (pm.firstTokenAt === null) pm.firstTokenAt = performance.now();
            pm.draft.append(String(evt.text ?? ""));
            break;
          }
          case "usage": {
            const u = evt.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
            pm.usage = {
              promptTokens: u?.prompt_tokens,
              completionTokens: u?.completion_tokens,
              costUsd: typeof u?.cost === "number" ? u.cost : undefined,
            };
            break;
          }
          case "grounding": {
            pm.grounding = {
              queries: (evt.queries as string[]) ?? [],
              sources: (evt.sources as NonNullable<Message["grounding"]>["sources"]) ?? [],
            };
            break;
          }
          case "error": {
            finalize(pm, { error: String(evt.message ?? "Request failed"), pending: false });
            break;
          }
          case "http_error": {
            finalize(pm, {
              error: formatChatError(
                String(evt.body ?? ""),
                Number(evt.status ?? 0),
                String(evt.statusText ?? ""),
                pm.apiModel
              ),
              pending: false,
            });
            break;
          }
          case "stream_end": {
            finalize(pm, {});
            break;
          }
        }
      }
    }

    // Response ended: close out any columns that never got a stream_end.
    for (const pm of perModel.values()) finalize(pm, {});
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "AbortError") {
      for (const pm of perModel.values()) finalize(pm, {});
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    for (const pm of perModel.values()) finalize(pm, { error: message, pending: false });
  }
}
