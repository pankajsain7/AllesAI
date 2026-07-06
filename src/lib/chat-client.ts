"use client";

import { filterSelectableModelIds, getEnabledRoutes, useChat, useSettings, type Message, normalizeModelId } from "./store";
import { isCloudOllamaModelId, isOllamaModelId, isOpenCodeModelId, type ModelInfo } from "./models";
import { streamDraftKey, useStreamDrafts } from "./stream-drafts";

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
        geminiApiKey: settings.geminiApiKey || undefined,
        opencodeApiKey: settings.opencodeApiKey || undefined,
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
      geminiApiKey: settings.geminiApiKey || undefined,
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

const ROUTER_SYSTEM_PROMPT = [
  "You are a router that selects the single best AI model to answer the user's question.",
  "Choose strictly from the provided candidate list, using each model's strengths and category.",
  "Prefer reasoning/coding models for hard logic or code, vision models for images, and fast general models for simple chat.",
  "Reply with ONLY the exact model id from the list - no quotes, labels, or explanation.",
].join("\n");

// Picks the best model id for a prompt by asking a fast model to classify it.
// Falls back to the first candidate (or provided fallback) if routing fails.
export async function pickBestModel(
  prompt: string,
  fallback?: string,
  signal?: AbortSignal
): Promise<string> {
  const candidates = autoRouterCandidates();
  if (candidates.length === 0) return fallback ?? "";
  if (candidates.length === 1) return candidates[0].id;

  const settings = useSettings.getState();
  const routerModel =
    normalizeModelId(settings.consensusModel) ??
    candidates.find((c) => c.apiProvider === "gemini")?.id ??
    candidates[0].id;

  const list = candidates
    .map((c) => `- ${c.id} | ${c.label} | ${c.category}${c.bestFor ? ` | best for: ${c.bestFor}` : ""}`)
    .join("\n");
  const userMessage = `Candidate models:\n${list}\n\nUser question:\n${prompt}\n\nBest model id:`;

  try {
    const raw = await callModelOnce(
      routerModel,
      [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      signal
    );
    const answer = raw.trim();
    // Prefer an exact id match, then a substring match.
    const exact = candidates.find((c) => c.id === answer);
    if (exact) return exact.id;
    const contained = candidates.find((c) => answer.includes(c.id));
    if (contained) return contained.id;
    const byLabel = candidates.find((c) => answer.toLowerCase().includes(c.label.toLowerCase()));
    if (byLabel) return byLabel.id;
  } catch {
    // fall through to fallback
  }
  return fallback ?? candidates[0].id;
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
      geminiApiKey: settings.geminiApiKey || undefined,
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

  // Auto mode picks the single best model, then chats with just that one.
  if (conv.chatMode === "auto") {
    void runAutoPrompt(convId, prompt, ctrl);
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

// Auto mode: route the first message to the best model, then reuse it so the
// conversation stays coherent. A new chat re-picks for the next question.
async function runAutoPrompt(convId: string, prompt: string, ctrl: AbortController) {
  const settings = useSettings.getState();
  const conv = useChat.getState().conversations[convId];
  if (!conv) return;
  const enabledSelected = filterSelectableModelIds(conv.selectedModels, settings);
  const hasAnswers = enabledSelected.some((id) =>
    (conv.threads[id]?.messages ?? []).some((m) => m.role === "assistant")
  );

  // Continuing an auto chat: keep the chosen model, skip routing for low latency.
  if (enabledSelected.length >= 1 && hasAnswers) {
    useChat.getState().addUserMessage(convId, prompt, [enabledSelected[0]]);
    streamTargets(convId, prompt, [enabledSelected[0]], ctrl, settings);
    return;
  }

  const provisional = enabledSelected[0] ?? autoRouterCandidates()[0]?.id;
  if (!provisional) return; // no models available

  // Show the question + a thinking placeholder immediately while we route.
  if (conv.selectedModels.length !== 1 || conv.selectedModels[0] !== provisional) {
    useChat.getState().setSelectedModels(convId, [provisional]);
  }
  useChat.getState().addUserMessage(convId, prompt, [provisional]);
  const placeholderId = useChat.getState().startAssistant(convId, provisional, "thinking");
  // Keep the placeholder responsive to "stop" while routing is in flight.
  ctrl.signal.addEventListener("abort", () => {
    const msg = useChat
      .getState()
      .conversations[convId]?.threads[provisional]?.messages.find((m) => m.id === placeholderId);
    if (msg?.pending) useChat.getState().finishAssistant(convId, provisional, placeholderId);
  });

  const picked = (await pickBestModel(prompt, provisional, ctrl.signal)) || provisional;
  if (ctrl.signal.aborted) return;

  if (picked === provisional) {
    streamTargets(convId, prompt, [provisional], ctrl, settings, new Map([[provisional, placeholderId]]));
    return;
  }

  // Routed to a different model: clear the provisional placeholder and switch.
  useChat.getState().finishAssistant(convId, provisional, placeholderId);
  useChat.getState().setSelectedModels(convId, [picked]);
  useChat.getState().addUserMessage(convId, prompt, [picked]);
  streamTargets(convId, prompt, [picked], ctrl, settings);
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
        geminiApiKey: settings.geminiApiKey || undefined,
        opencodeApiKey: settings.opencodeApiKey || undefined,
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
