"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CONSENSUS_MODEL,
  DEFAULT_OPENCODE_MODEL_IDS,
  DEFAULT_BEDROCK_MODEL_IDS,
  getBedrockModelInfos,
  DEFAULT_SELECTED_MODELS,
  MODEL_CATALOG,
  dedupeModelIdsByFamily,
  getCloudOllamaModelInfos,
  getCloudOllamaModelNames,
  getGroqExtraModelInfos,
  getLocalOllamaModelInfo,
  getModel,
  getModelFamilyId,
  getOpenCodeModelInfos,
  getCustomProviderModelInfos,
  isCloudOllamaModelId,
  isCustomModelId,
  isOllamaModelId,
  isOpenCodeModelId,
  type CustomProvider,
  type ModelInfo,
} from "./models";
import { isRemovedModelName } from "./model-rules";
import type { ApiProviderKey } from "./providers";
import { uid } from "./utils";

export type Role = "user" | "assistant" | "system";

export type Message = {
  id: string;
  role: Role;
  content: string;
  imageDataUrl?: never; // image upload removed
  modelId?: string; // for assistant messages
  createdAt: number;
  // streaming/runtime metadata
  pending?: boolean;
  status?: "searching" | "thinking";
  error?: string;
  responseTimeMs?: number;
  usage?: { promptTokens?: number; completionTokens?: number; costUsd?: number };
  grounding?: { queries: string[]; sources: Array<{ title: string; uri: string }> };
};

export type SharedResultType = "consensus" | "council";
export type SharedResultQualityMode = "quick" | "deep";
export type SharedResultScore = {
  label: string;
  value: string;
  note?: string;
};
export type SharedResultJudgeRanking = {
  model: string;
  overall?: number;
  scores?: Record<string, number>;
  rationale?: string;
};
export type SharedResultJudge = {
  model: string;
  winner?: string;
  confidence?: string;
  rankings: SharedResultJudgeRanking[];
};
export type CouncilRoundId = "opening" | "critique" | "convergence" | "synthesis";
export type CouncilMemberStatus = "queued" | "running" | "done" | "failed" | "replaced";

export type CouncilStatusEntry = {
  modelId: string;
  model: string;
  status: CouncilMemberStatus;
  round?: CouncilRoundId;
  message?: string;
  replacementModelId?: string;
  replacementModel?: string;
  updatedAt: number;
};

export type CouncilRoundEntry = {
  id: CouncilRoundId;
  title: string;
  startedAt: number;
};

export type CouncilNoteEntry = {
  id: string;
  round: CouncilRoundId;
  roundTitle: string;
  modelId: string;
  model: string;
  content: string;
  createdAt: number;
};

export type SharedResult = {
  id: string;
  type: SharedResultType;
  title: string;
  modelId: string;
  content: string;
  finalAnswer?: string;
  qualityMode?: SharedResultQualityMode;
  confidence?: string;
  decisionSummary?: string;
  scores?: SharedResultScore[];
  judge?: SharedResultJudge;
  createdAt: number;
  updatedAt: number;
  pending?: boolean;
  error?: string;
  participants?: string[];
  statuses?: CouncilStatusEntry[];
  rounds?: CouncilRoundEntry[];
  notes?: CouncilNoteEntry[];
};

// Per-model thread of messages. The user prompt is mirrored across all columns.
export type ModelThread = {
  modelId: string;
  messages: Message[];
};

// How a conversation routes prompts to models.
// - "multi": broadcast to several models side-by-side (classic behavior).
// - "single": chat with one specific user-chosen model.
// - "super": orchestrate the two best models under the hood and synthesize a
//   single best answer (prompt enhancement + auto web search happen silently).
export type ChatMode = "multi" | "single" | "super";

// Virtual thread id that holds the synthesized answer in "super" mode. It is
// not a real model, so getModel() returns undefined and no model name is shown.
export const SUPER_THREAD_ID = "__super__";

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chatMode: ChatMode;
  selectedModels: string[];
  disabledModels?: string[]; // models paused - won't receive new prompts
  focusedModel?: string | null; // when set, only this model receives further prompts
  threads: Record<string, ModelThread>; // keyed by modelId
  consensusMessages?: Message[];
  sharedResults?: SharedResult[];
};

export type LocalOllamaModel = {
  name: string;
  model: string;
  modifiedAt?: string;
  size?: number;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
};
function sanitizeModelNames(modelNames: string[]): string[] {
  return Array.from(new Set(modelNames.map((name) => name.trim()).filter(Boolean))).filter(
    (name) => !isRemovedModelName(name)
  );
}

function sanitizeLocalModels(models: LocalOllamaModel[]): LocalOllamaModel[] {
  return models.filter((model) => !isRemovedModelName(model.name) && !isRemovedModelName(model.model));
}

export type SettingsState = {
  apiKey: string;
  setApiKey: (k: string) => void;
  groqEnabled: boolean;
  setGroqEnabled: (v: boolean) => void;
  opencodeApiKey: string;
  setOpencodeApiKey: (k: string) => void;
  opencodeEnabled: boolean;
  setOpencodeEnabled: (v: boolean) => void;
  opencodeModels: string[];
  setOpencodeModels: (models: string[]) => void;
  bedrockApiKey: string;
  setBedrockApiKey: (k: string) => void;
  bedrockEnabled: boolean;
  setBedrockEnabled: (v: boolean) => void;
  bedrockModels: string[];
  setBedrockModels: (models: string[]) => void;
  groqExtraModels: string[];
  setGroqExtraModels: (models: string[]) => void;
  systemPrompt: string;
  setSystemPrompt: (s: string) => void;
  webSearch: boolean;
  setWebSearch: (v: boolean) => void;
  tavilyApiKey: string;
  setTavilyApiKey: (k: string) => void;
  compactColumns: boolean;
  setCompactColumns: (v: boolean) => void;
  consensusModel: string;
  setConsensusModel: (modelId: string) => void;
  saveConsensusToChat: boolean;
  setSaveConsensusToChat: (v: boolean) => void;
  localEnabled: boolean;
  setLocalEnabled: (v: boolean) => void;
  ollamaBaseUrl: string;
  setOllamaBaseUrl: (url: string) => void;
  ollamaApiKey: string;
  setOllamaApiKey: (k: string) => void;
  cloudOllamaEnabled: boolean;
  setCloudOllamaEnabled: (v: boolean) => void;
  ollamaCloudBaseUrl: string;
  setOllamaCloudBaseUrl: (url: string) => void;
  ollamaCloudModels: string[];
  setOllamaCloudModels: (models: string[]) => void;
  availableLocalModels: LocalOllamaModel[];
  setAvailableLocalModels: (models: LocalOllamaModel[]) => void;
  customProviders: CustomProvider[];
  addCustomProvider: (provider: CustomProvider) => void;
  updateCustomProvider: (id: string, patch: Partial<CustomProvider>) => void;
  removeCustomProvider: (id: string) => void;
};

export type ProviderToggleSettings = Pick<
  SettingsState,
  "groqEnabled" | "opencodeEnabled" | "cloudOllamaEnabled" | "localEnabled" | "bedrockEnabled"
>;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: "",
      setApiKey: (k) => set({ apiKey: k }),
      groqEnabled: true,
      setGroqEnabled: (v) => set({ groqEnabled: v }),
      opencodeApiKey: "",
      setOpencodeApiKey: (k) => set({ opencodeApiKey: k }),
      opencodeEnabled: false,
      setOpencodeEnabled: (v) => set({ opencodeEnabled: v }),
      opencodeModels: DEFAULT_OPENCODE_MODEL_IDS,
      setOpencodeModels: (models) => set({ opencodeModels: sanitizeModelNames(models) }),
      bedrockApiKey: "",
      setBedrockApiKey: (k) => set({ bedrockApiKey: k }),
      bedrockEnabled: true,
      setBedrockEnabled: (v) => set({ bedrockEnabled: v }),
      bedrockModels: DEFAULT_BEDROCK_MODEL_IDS,
      setBedrockModels: (models) => set({ bedrockModels: sanitizeModelNames(models) }),
      groqExtraModels: [],
      setGroqExtraModels: (models) => set({ groqExtraModels: sanitizeModelNames(models) }),
      systemPrompt: "You are a helpful, concise assistant.",
      setSystemPrompt: (s) => set({ systemPrompt: s }),
      webSearch: false,
      setWebSearch: (v) => set({ webSearch: v }),
      tavilyApiKey: "",
      setTavilyApiKey: (k) => set({ tavilyApiKey: k }),
      compactColumns: false,
      setCompactColumns: (v) => set({ compactColumns: v }),
      consensusModel: CONSENSUS_MODEL,
      setConsensusModel: (modelId) => set({ consensusModel: modelId }),
      saveConsensusToChat: false,
      setSaveConsensusToChat: (v) => set({ saveConsensusToChat: v }),
      localEnabled: false,
      setLocalEnabled: (v) => set({ localEnabled: v, availableLocalModels: [] }),
      ollamaBaseUrl: "http://localhost:11434",
      setOllamaBaseUrl: (url) => set({ ollamaBaseUrl: url }),
      ollamaApiKey: "",
      setOllamaApiKey: (k) => set({ ollamaApiKey: k }),
      cloudOllamaEnabled: false,
      setCloudOllamaEnabled: (v) => set({ cloudOllamaEnabled: v }),
      ollamaCloudBaseUrl: "https://ollama.com",
      setOllamaCloudBaseUrl: (url) => set({ ollamaCloudBaseUrl: url }),
      ollamaCloudModels: [],
      setOllamaCloudModels: (models) => set({ ollamaCloudModels: sanitizeModelNames(models) }),
      availableLocalModels: [],
      setAvailableLocalModels: (models) => set({ availableLocalModels: sanitizeLocalModels(models) }),
      customProviders: [],
      addCustomProvider: (provider) =>
        set((s) => ({ customProviders: [...s.customProviders, provider] })),
      updateCustomProvider: (id, patch) =>
        set((s) => ({
          customProviders: s.customProviders.map((p) =>
            p.id === id ? { ...p, ...patch } : p
          ),
        })),
      removeCustomProvider: (id) =>
        set((s) => ({ customProviders: s.customProviders.filter((p) => p.id !== id) })),
    }),
    {
      name: "alles-ai-settings",
      version: 11,
      migrate: (persistedState) => {
        const state = persistedState as Partial<SettingsState>;
        return {
          apiKey: state.apiKey ?? "",
          groqEnabled: state.groqEnabled ?? true,
          opencodeApiKey: state.opencodeApiKey ?? "",
          opencodeEnabled: state.opencodeEnabled ?? false,
          opencodeModels: sanitizeModelNames(state.opencodeModels ?? DEFAULT_OPENCODE_MODEL_IDS),
          bedrockApiKey: state.bedrockApiKey ?? "",
          bedrockEnabled: state.bedrockEnabled ?? true,
          bedrockModels: sanitizeModelNames(state.bedrockModels ?? DEFAULT_BEDROCK_MODEL_IDS),
          groqExtraModels: sanitizeModelNames(state.groqExtraModels ?? []),
          systemPrompt: state.systemPrompt ?? "You are a helpful, concise assistant.",
          webSearch: state.webSearch ?? false,
          tavilyApiKey: state.tavilyApiKey ?? "",
          compactColumns: state.compactColumns ?? false,
          consensusModel: state.consensusModel ?? CONSENSUS_MODEL,
          saveConsensusToChat: state.saveConsensusToChat ?? false,
          localEnabled: state.localEnabled ?? false,
          ollamaBaseUrl: state.ollamaBaseUrl ?? "http://localhost:11434",
          ollamaApiKey: state.ollamaApiKey ?? "",
          cloudOllamaEnabled: state.cloudOllamaEnabled ?? false,
          ollamaCloudBaseUrl: state.ollamaCloudBaseUrl ?? "https://ollama.com",
          ollamaCloudModels: sanitizeModelNames(state.ollamaCloudModels ?? []),
          customProviders: state.customProviders ?? [],
        };
      },
      partialize: (state) => ({
        apiKey: state.apiKey,
        groqEnabled: state.groqEnabled,
        opencodeApiKey: state.opencodeApiKey,
        opencodeEnabled: state.opencodeEnabled,
        opencodeModels: state.opencodeModels,
        groqExtraModels: state.groqExtraModels,
        systemPrompt: state.systemPrompt,
        webSearch: state.webSearch,
        tavilyApiKey: state.tavilyApiKey,
        compactColumns: state.compactColumns,
        consensusModel: state.consensusModel,
        saveConsensusToChat: state.saveConsensusToChat,
        localEnabled: state.localEnabled,
        ollamaBaseUrl: state.ollamaBaseUrl,
        ollamaApiKey: state.ollamaApiKey,
        cloudOllamaEnabled: state.cloudOllamaEnabled,
        ollamaCloudBaseUrl: state.ollamaCloudBaseUrl,
        ollamaCloudModels: state.ollamaCloudModels,
        bedrockApiKey: state.bedrockApiKey,
        bedrockEnabled: state.bedrockEnabled,
        bedrockModels: state.bedrockModels,
        customProviders: state.customProviders,
      }),
    }
  )
);

export function isApiProviderEnabled(
  apiProvider: ApiProviderKey,
  settings: ProviderToggleSettings = useSettings.getState()
): boolean {
  if (apiProvider === "groq") return settings.groqEnabled;
  if (apiProvider === "bedrock") return settings.bedrockEnabled;
  if (apiProvider === "opencode") return settings.opencodeEnabled;
  if (apiProvider === "ollama-cloud") return settings.cloudOllamaEnabled;
  if (apiProvider === "ollama-local") return settings.localEnabled;
  return true;
}

export function filterEnabledModelIds(
  modelIds: string[],
  settings: ProviderToggleSettings = useSettings.getState()
): string[] {
  return modelIds.filter((modelId) => {
    const model = getModel(modelId);
    return model ? isApiProviderEnabled(model.apiProvider, settings) : false;
  });
}

// Like filterEnabledModelIds, but also drops model IDs whose family is no
// longer among the currently-available routes (e.g. stale cloud-Ollama models
// removed from settings) and collapses duplicate routes of the same family.
// This keeps the header count and the rendered columns in sync with the model
// picker, which only counts available families.
export function filterSelectableModelIds(
  modelIds: string[],
  settings: SettingsState = useSettings.getState()
): string[] {
  const availableFamilies = new Set(getEnabledRoutes(settings).map((route) => route.familyId));
  const enabled = modelIds.filter((modelId) => {
    const model = getModel(modelId);
    if (!model) return false;
    if (!isApiProviderEnabled(model.apiProvider, settings)) return false;
    return availableFamilies.has(model.familyId);
  });
  return dedupeModelIdsByFamily(enabled);
}

export function getEnabledRoutes(settings: SettingsState): ModelInfo[] {
  return [
    ...MODEL_CATALOG,
    ...(settings.bedrockEnabled ? getBedrockModelInfos(settings.bedrockModels) : []),
    ...(settings.opencodeEnabled ? getOpenCodeModelInfos(settings.opencodeModels) : []),
    ...(settings.groqEnabled ? getGroqExtraModelInfos(settings.groqExtraModels) : []),
    ...getCustomProviderModelInfos(settings.customProviders),
    ...(settings.cloudOllamaEnabled
      ? getCloudOllamaModelInfos(getCloudOllamaModelNames(settings.ollamaCloudModels))
      : []),
    ...(settings.localEnabled
      ? settings.availableLocalModels
          .filter((model) => !isRemovedModelName(model.name))
          .map((model) => getLocalOllamaModelInfo(model.name))
      : []),
  ].filter((route) => isApiProviderEnabled(route.apiProvider, settings));
}

function findReplacementRoute(
  modelId: string,
  removedProvider: ApiProviderKey,
  settings: SettingsState
): string | null {
  const familyId = getModelFamilyId(modelId);
  return (
    getEnabledRoutes(settings).find(
      (route) => route.apiProvider !== removedProvider && route.familyId === familyId
    )?.id ?? null
  );
}

function replaceProviderRoutes(
  modelIds: string[],
  removedProvider: ApiProviderKey,
  settings: SettingsState
): string[] {
  const next = modelIds.flatMap((modelId) => {
    const model = getModel(modelId);
    if (model?.apiProvider !== removedProvider) return [modelId];
    const replacement = findReplacementRoute(modelId, removedProvider, settings);
    return replacement ? [replacement] : [];
  });
  return dedupeModelIdsByFamily(Array.from(new Set(next)));
}

function ensureThreadsForSelectedModels(
  conversation: Conversation,
  selectedModels: string[]
): Record<string, ModelThread> {
  const threads = { ...conversation.threads };
  for (const modelId of selectedModels) {
    if (threads[modelId]) continue;
    const familyId = getModelFamilyId(modelId);
    const sourceThread = Object.values(threads).find(
      (thread) => getModelFamilyId(thread.modelId) === familyId
    );
    threads[modelId] = sourceThread
      ? {
          ...sourceThread,
          modelId,
          messages: sourceThread.messages.map((message) =>
            message.modelId ? { ...message, modelId } : message
          ),
        }
      : { modelId, messages: [] };
  }
  return threads;
}

type ChatState = {
  conversations: Record<string, Conversation>;
  activeId: string | null;
  lastUsedModels: string[];
  pruneOldData: () => void;
  newConversation: (selectedModels?: string[]) => string;
  setActive: (id: string) => void;
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  importConversations: (conversations: Record<string, Conversation>) => void;
  renameConversation: (id: string, title: string) => void;
  setChatMode: (id: string, mode: ChatMode) => void;
  setSelectedModels: (id: string, models: string[]) => void;
  setSingleModel: (id: string, modelId: string) => void;
  removeApiProviderModels: (apiProvider: ApiProviderKey) => void;
  removeOllamaModels: () => void;
  removeLocalOllamaModels: () => void;
  removeCloudOllamaModels: () => void;
  removeModelId: (modelId: string) => void;
  toggleModelEnabled: (convId: string, modelId: string) => void;
  setFocusedModel: (id: string, modelId: string | null) => void;
  addUserMessage: (id: string, content: string, modelIds?: string[]) => string;
  startAssistant: (convId: string, modelId: string, status?: Message["status"]) => string; // returns msg id
  setAssistantStatus: (
    convId: string,
    modelId: string,
    msgId: string,
    status?: Message["status"]
  ) => void;
  appendAssistant: (convId: string, modelId: string, msgId: string, delta: string) => void;
  finishAssistant: (
    convId: string,
    modelId: string,
    msgId: string,
    patch?: Partial<Message>
  ) => void;
  failAssistant: (convId: string, modelId: string, msgId: string, error: string) => void;
  saveConsensus: (convId: string, content: string, modelId: string) => void;
  startSharedResult: (
    convId: string,
    result: Omit<SharedResult, "id" | "createdAt" | "updatedAt">
  ) => string;
  appendSharedResultContent: (convId: string, resultId: string, delta: string) => void;
  finishSharedResult: (
    convId: string,
    resultId: string,
    patch?: Partial<
      Pick<
        SharedResult,
        "content" | "finalAnswer" | "error" | "confidence" | "decisionSummary" | "scores" | "judge"
      >
    >
  ) => void;
  setSharedResultJudge: (convId: string, resultId: string, judge: SharedResultJudge) => void;
  startCouncilRound: (convId: string, resultId: string, round: CouncilRoundEntry) => void;
  upsertCouncilStatus: (
    convId: string,
    resultId: string,
    status: Omit<CouncilStatusEntry, "updatedAt">
  ) => void;
  addCouncilNote: (
    convId: string,
    resultId: string,
    note: Omit<CouncilNoteEntry, "id" | "createdAt">
  ) => void;
};

function emptyConversation(selectedModels: string[], chatMode: ChatMode = "multi"): Conversation {
  const now = Date.now();
  const threads: Record<string, ModelThread> = {};
  for (const m of selectedModels) threads[m] = { modelId: m, messages: [] };
  return {
    id: uid(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    chatMode,
    selectedModels,
    threads,
    consensusMessages: [],
    sharedResults: [],
  };
}

const VALID_MODEL_IDS = new Set(MODEL_CATALOG.map((model) => model.id));

const MODEL_ID_ALIASES: Record<string, string> = {
  // Legacy :free suffix -> Groq IDs
  "openai/gpt-oss-120b:free": "openai/gpt-oss-120b",
  // Legacy hosted Ollama names -> direct Ollama API names
  "ollama-cloud/gpt-oss:120b-cloud": "ollama-cloud/gpt-oss:120b",
  "ollama-cloud/gemma4:31b-cloud": "ollama-cloud/gemma4:31b",
  // Removed legacy model IDs -> point to nothing
  "deepseek-chat": "",
  "deepseek-r1-distill-llama-70b": "",
  "deepseek-v4-flash": "",
  "ollama-cloud/gemini-3-flash-preview": "",
  "ollama-cloud/deepseek-v4-pro": "",
  // Legacy "-cloud" suffixed tags -> current suffix-less names (same pattern
  // as gpt-oss/gemma4 above). These were wrongly blacklisted entirely, which
  // silently dropped the model every time a user tried to select it.
  "ollama-cloud/qwen3-vl:235b-cloud": "ollama-cloud/qwen3-vl:235b",
  "ollama-cloud/glm-4.6:cloud": "ollama-cloud/glm-4.6",
  "ollama-cloud/minimax-m2.5:cloud": "ollama-cloud/minimax-m2.5",
  // Default hosted Qwen family moved from qwen3.5 to qwen3-coder.
  "ollama-cloud/qwen3.5:397b": "ollama-cloud/qwen3-coder:480b",
  // Gemini was removed as a provider; scrub any persisted Gemini selection.
  "gemini-2.0-flash": "",
  "gemini-2.5-flash": "",
  "gemini-2.5-pro": "",
  "gemini-2.5-flash-lite": "",
  "gemini-3.5-flash": "",
  "gemini-3.6-flash": "",
  "gemini-3.5-flash-lite": "",
  "gemma-4-31b-it": "",
  // Groq retired both Llama chat models (404 model_not_found as of 2026-08-28).
  "llama-3.3-70b-versatile": "qwen/qwen3.8-27b",
  // Deduped: same family and parameter size as qwen3.8-27b, one generation older.
  "qwen/qwen3.6-27b": "qwen/qwen3.8-27b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
};

function findLegacyModelIds(modelId: string): string[] {
  return Object.entries(MODEL_ID_ALIASES)
    .filter(([, currentId]) => currentId === modelId)
    .map(([legacyId]) => legacyId);
}

export function normalizeModelId(modelId: string): string | null {
  if (isRemovedModelName(modelId)) return null;

  const normalized = MODEL_ID_ALIASES[modelId] ?? modelId;
  if (isRemovedModelName(normalized)) return null;
  if (isCustomModelId(normalized)) return normalized;
  if (isOllamaModelId(normalized)) return normalized;
  if (isOpenCodeModelId(normalized)) return normalized;
  if (normalized.startsWith("groq/")) return normalized;  if (isCloudOllamaModelId(normalized)) return normalized;
  return VALID_MODEL_IDS.has(normalized) ? normalized : null;
}

function legacyConsensusToSharedResults(messages?: Message[]): SharedResult[] {
  return (messages ?? []).map((message) => ({
    id: message.id,
    type: message.modelId === "model-council" ? "council" : "consensus",
    title: message.modelId === "model-council" ? "Model council" : "Consensus answer",
    modelId: message.modelId ?? "consensus",
    content: message.content,
    finalAnswer: message.modelId === "model-council" ? message.content : undefined,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    pending: false,
  }));
}

function normalizeMessageModelId(modelId?: string): string | undefined {
  if (!modelId) return modelId;
  return normalizeModelId(modelId) ?? modelId;
}

function normalizeConversationThreads(
  conversation: Conversation
): Record<string, ModelThread> {
  const nextThreads: Record<string, ModelThread> = {};

  for (const [threadId, thread] of Object.entries(conversation.threads ?? {})) {
    const normalizedThreadId = normalizeModelId(threadId) ?? threadId;
    const normalizedMessages = (thread.messages ?? []).map((message) =>
      message.modelId
        ? { ...message, modelId: normalizeMessageModelId(message.modelId) ?? normalizedThreadId }
        : message
    );

    const existing = nextThreads[normalizedThreadId];
    if (existing) {
      existing.messages = [...existing.messages, ...normalizedMessages].sort(
        (a, b) => a.createdAt - b.createdAt
      );
      continue;
    }

    nextThreads[normalizedThreadId] = {
      modelId: normalizedThreadId,
      messages: normalizedMessages,
    };
  }

  return nextThreads;
}

function sanitizeConversation(conversation: Conversation): Conversation {
  const normalizedThreads = normalizeConversationThreads(conversation);
  const selectedModels = dedupeModelIdsByFamily(
    Array.from(
      new Set(
        conversation.selectedModels
          .map(normalizeModelId)
          .filter((modelId): modelId is string => Boolean(modelId))
      )
    )
  );

  const nextSelectedModels = selectedModels.length > 0 ? selectedModels : DEFAULT_SELECTED_MODELS;
  const threads: Record<string, ModelThread> = { ...normalizedThreads };

  for (const modelId of nextSelectedModels) {
    const sourceThread =
      normalizedThreads[modelId] ??
      findLegacyModelIds(modelId)
        .map((legacyId) => normalizedThreads[legacyId])
        .find(Boolean);
    threads[modelId] = sourceThread
      ? {
          ...sourceThread,
          modelId,
          messages: sourceThread.messages.map((message) =>
            message.modelId ? { ...message, modelId: normalizeMessageModelId(message.modelId) ?? modelId } : message
          ),
        }
      : { modelId, messages: [] };
  }

  const focusedModel = conversation.focusedModel ? normalizeModelId(conversation.focusedModel) : null;

  return pruneConversationPayload({
    ...conversation,
    // Legacy persisted "auto" mode is migrated to "multi".
    chatMode:
      conversation.chatMode === "single" || conversation.chatMode === "super"
        ? conversation.chatMode
        : "multi",
    selectedModels: nextSelectedModels,
    focusedModel: focusedModel && nextSelectedModels.includes(focusedModel) ? focusedModel : null,
    threads,
    consensusMessages: conversation.consensusMessages ?? [],
    sharedResults:
      conversation.sharedResults ??
      legacyConsensusToSharedResults(conversation.consensusMessages),
  });
}

function removeSelectedRoutes(
  state: ChatState,
  shouldRemove: (modelId: string) => boolean
): Pick<ChatState, "conversations" | "lastUsedModels"> {
  const conversations = Object.fromEntries(
    Object.entries(state.conversations).map(([id, conversation]) => [
      id,
      (() => {
        const selectedModels = conversation.selectedModels.filter((modelId) => !shouldRemove(modelId));
        return {
          ...conversation,
          chatMode: conversation.chatMode,
          selectedModels,
        disabledModels: (conversation.disabledModels ?? []).filter((modelId) => !shouldRemove(modelId)),
        focusedModel:
          conversation.focusedModel && shouldRemove(conversation.focusedModel)
            ? null
            : conversation.focusedModel,
        updatedAt: Date.now(),
        };
      })(),
    ])
  );

  return {
    conversations,
    lastUsedModels: state.lastUsedModels.filter((modelId) => !shouldRemove(modelId)),
  };
}

const MAX_STORED_CONVERSATIONS = 25;
const MAX_MESSAGES_PER_THREAD = 120;
const MAX_SHARED_RESULTS_PER_CONVERSATION = 24;
const MAX_CONSENSUS_MESSAGES_PER_CONVERSATION = 24;

function pruneMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES_PER_THREAD) return messages;
  return messages.slice(-MAX_MESSAGES_PER_THREAD);
}

function pruneConversationPayload(conversation: Conversation): Conversation {
  const threads = Object.fromEntries(
    Object.entries(conversation.threads).map(([modelId, thread]) => [
      modelId,
      {
        ...thread,
        messages: pruneMessages(thread.messages),
      },
    ])
  );

  return {
    ...conversation,
    threads,
    consensusMessages: (conversation.consensusMessages ?? []).slice(
      -MAX_CONSENSUS_MESSAGES_PER_CONVERSATION
    ),
    sharedResults: (conversation.sharedResults ?? []).slice(-MAX_SHARED_RESULTS_PER_CONVERSATION),
  };
}

function pruneConversationsByRecency(
  conversations: Record<string, Conversation>,
  maxCount = MAX_STORED_CONVERSATIONS
): Record<string, Conversation> {
  const entries = Object.entries(conversations).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  if (entries.length <= maxCount) return conversations;
  return Object.fromEntries(entries.slice(0, maxCount));
}

export function hasConversationSentMessages(conversation: Conversation): boolean {
  return Object.values(conversation.threads ?? {}).some((thread) =>
    (thread.messages ?? []).some(
      (message) => message.role === "user" && message.content.trim().length > 0
    )
  );
}

function filterPersistableConversations(
  conversations: Record<string, Conversation>
): Record<string, Conversation> {
  return Object.fromEntries(
    Object.entries(conversations).filter(([, conversation]) =>
      hasConversationSentMessages(conversation)
    )
  );
}

function pickActiveConversationId(
  preferredId: string | null,
  conversations: Record<string, Conversation>
): string | null {
  if (preferredId && conversations[preferredId]) return preferredId;
  return Object.keys(conversations)[0] ?? null;
}

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: {},
      activeId: null,
      lastUsedModels: DEFAULT_SELECTED_MODELS,
      pruneOldData: () =>
        set((s) => {
          const prunedConversations = pruneConversationsByRecency(
            filterPersistableConversations(
            Object.fromEntries(
              Object.entries(s.conversations).map(([id, conversation]) => [
                id,
                pruneConversationPayload(conversation),
              ])
            )
            )
          );
          return {
            conversations: prunedConversations,
            activeId: pickActiveConversationId(s.activeId, prunedConversations),
          };
        }),
      newConversation: (selectedModels) => {
        // If the active conversation is still blank (no messages), reuse it
        const { conversations, activeId, lastUsedModels } = get();
        const inheritedMode: ChatMode =
          (activeId && conversations[activeId]?.chatMode) || "multi";
        if (activeId) {
          const active = conversations[activeId];
          if (active) {
            const hasMessages = Object.values(active.threads).some(
              (t) => t.messages.length > 0
            );
            if (!hasMessages) return activeId;
          }
        }
        // Use explicitly passed models, or the last active provider-compatible models.
        const models =
          filterEnabledModelIds(selectedModels ?? lastUsedModels).length > 0
            ? filterEnabledModelIds(selectedModels ?? lastUsedModels)
            : selectedModels
              ? []
              : filterEnabledModelIds(DEFAULT_SELECTED_MODELS);
        const c = emptyConversation(
          inheritedMode === "single" ? models.slice(0, 1) : models,
          inheritedMode
        );
        set((s) => ({
          conversations: pruneConversationsByRecency({ ...s.conversations, [c.id]: c }),
          activeId: c.id,
        }));
        return c.id;
      },
      setActive: (id) => set({ activeId: id }),
      deleteConversation: (id) =>
        set((s) => {
          const next = { ...s.conversations };
          delete next[id];
          const remaining = Object.keys(next);
          return {
            conversations: next,
            activeId: s.activeId === id ? remaining[0] ?? null : s.activeId,
          };
        }),
      clearConversations: () => set({ conversations: {}, activeId: null }),
      importConversations: (incoming) =>
        set((s) => {
          const imported = Object.fromEntries(
            Object.entries(incoming).map(([id, conversation]) => [
              id,
              sanitizeConversation(conversation),
            ])
          );
          const conversations = pruneConversationsByRecency({ ...s.conversations, ...imported });
          const preferredActiveId = Object.keys(imported)[0] ?? s.activeId;
          return {
            conversations,
            activeId: pickActiveConversationId(preferredActiveId, conversations),
          };
        }),
      renameConversation: (id, title) =>
        set((s) => {
          const c = s.conversations[id];
          if (!c) return s;
          return {
            conversations: { ...s.conversations, [id]: { ...c, title, updatedAt: Date.now() } },
          };
        }),
      setChatMode: (id, mode) =>
        set((s) => {
          const c = s.conversations[id];
          if (!c || c.chatMode === mode) return s;
          // Single mode keeps just one model; other modes keep current selection.
          const selectedModels =
            mode === "single" ? c.selectedModels.slice(0, 1) : c.selectedModels;
          return {
            conversations: {
              ...s.conversations,
              [id]: {
                ...c,
                chatMode: mode,
                selectedModels,
                focusedModel: null,
                updatedAt: Date.now(),
              },
            },
          };
        }),
      setSelectedModels: (id, models) =>
        set((s) => {
          const c = s.conversations[id];
          if (!c) return s;
          const nextModels = dedupeModelIdsByFamily(
            Array.from(
              new Set(
                models
                  .map(normalizeModelId)
                  .filter((modelId): modelId is string => Boolean(modelId))
              )
            )
          );
          const threads = { ...c.threads };
          for (const m of nextModels) {
            if (!threads[m]) {
              const familyId = getModelFamilyId(m);
              const sourceThread = Object.values(threads).find(
                (thread) => getModelFamilyId(thread.modelId) === familyId
              );
              threads[m] = sourceThread
                ? {
                    ...sourceThread,
                    modelId: m,
                    messages: sourceThread.messages.map((message) =>
                      message.modelId ? { ...message, modelId: m } : message
                    ),
                  }
                : { modelId: m, messages: [] };
            }
          }
          // If focused model was deselected, clear focus
          const focusedModel = c.focusedModel && nextModels.includes(c.focusedModel) ? c.focusedModel : null;
          return {
            lastUsedModels: nextModels.length > 0 ? nextModels : s.lastUsedModels,
            conversations: {
              ...s.conversations,
              [id]: {
                ...c,
                chatMode: c.chatMode,
                selectedModels: nextModels,
                threads,
                focusedModel,
                updatedAt: Date.now(),
              },
            },
          };
        }),
      // Switch the single active model while carrying the conversation history
      // forward, so the new model continues the same chat with full context.
      setSingleModel: (id, modelId) =>
        set((s) => {
          const c = s.conversations[id];
          if (!c) return s;
          const normalized = normalizeModelId(modelId);
          if (!normalized) return s;
          const prevId = c.selectedModels[0];
          if (prevId === normalized) return s;
          const prevThread = prevId ? c.threads[prevId] : undefined;
          const carried = (prevThread?.messages ?? [])
            .filter((m) => !(m.role === "assistant" && m.pending))
            .map((m) => ({ ...m }));
          const threads = {
            ...c.threads,
            [normalized]: { modelId: normalized, messages: carried },
          };
          return {
            lastUsedModels: [normalized],
            conversations: {
              ...s.conversations,
              [id]: {
                ...c,
                selectedModels: [normalized],
                focusedModel: null,
                threads,
                updatedAt: Date.now(),
              },
            },
          };
        }),
      removeOllamaModels: () =>
        set((s) =>
          removeSelectedRoutes(
            s,
            (modelId) => isOllamaModelId(modelId) || isCloudOllamaModelId(modelId)
          )
        ),
      removeApiProviderModels: (apiProvider) =>
        set((s) => {
          const settings = useSettings.getState();
          const conversations = Object.fromEntries(
            Object.entries(s.conversations).map(([id, conversation]) => {
              const selectedModels = replaceProviderRoutes(
                conversation.selectedModels,
                apiProvider,
                settings
              );
              const focusedReplacement =
                conversation.focusedModel &&
                getModel(conversation.focusedModel)?.apiProvider === apiProvider
                  ? findReplacementRoute(conversation.focusedModel, apiProvider, settings)
                  : conversation.focusedModel;
              const focusedModel =
                focusedReplacement && selectedModels.includes(focusedReplacement)
                  ? focusedReplacement
                  : null;

              return [
                id,
                (() => {
                  const chatMode = conversation.chatMode;
                  return {
                    ...conversation,
                    chatMode,
                    selectedModels,
                  disabledModels: (conversation.disabledModels ?? []).filter(
                    (modelId) => getModel(modelId)?.apiProvider !== apiProvider
                  ),
                  focusedModel,
                  threads: ensureThreadsForSelectedModels(conversation, selectedModels),
                  updatedAt: Date.now(),
                  };
                })(),
              ];
            })
          );

          return {
            conversations,
            lastUsedModels: replaceProviderRoutes(s.lastUsedModels, apiProvider, settings),
          };
        }),
      removeLocalOllamaModels: () =>
        set((s) => removeSelectedRoutes(s, isOllamaModelId)),
      removeCloudOllamaModels: () =>
        set((s) => removeSelectedRoutes(s, isCloudOllamaModelId)),
      // Unchecking a single model in Settings' "browse & import" panels only
      // removed it from the availability list — it stayed selected (and kept
      // showing as "on") in any conversation that had already picked it. This
      // purges it from every conversation's selection the same way disabling
      // a whole provider already does.
      removeModelId: (modelId) =>
        set((s) => removeSelectedRoutes(s, (id) => id === modelId)),
      toggleModelEnabled: (convId, modelId) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const disabled = c.disabledModels ?? [];
          const isDisabled = disabled.includes(modelId);
          return {
            conversations: {
              ...s.conversations,
              [convId]: {
                ...c,
                disabledModels: isDisabled
                  ? disabled.filter((m) => m !== modelId)
                  : [...disabled, modelId],
                updatedAt: Date.now(),
              },
            },
          };
        }),
      setFocusedModel: (id, modelId) =>
        set((s) => {
          const c = s.conversations[id];
          if (!c) return s;
          return {
            conversations: {
              ...s.conversations,
              [id]: { ...c, focusedModel: modelId, updatedAt: Date.now() },
            },
          };
        }),
      addUserMessage: (id, content, modelIds) => {
        const msgId = uid();
        set((s) => {
          const c = s.conversations[id];
          if (!c) return s;
          const threads = { ...c.threads };
          // If focused, only add to focused model thread; else add to all selected
          const targets = modelIds ?? (c.focusedModel ? [c.focusedModel] : c.selectedModels);
          for (const m of targets) {
            const t = threads[m] ?? { modelId: m, messages: [] };
            threads[m] = {
              ...t,
              messages: pruneMessages([
                ...t.messages,
                { id: msgId, role: "user", content, createdAt: Date.now() },
              ]),
            };
          }
          const title =
            c.title === "New chat" ? content.slice(0, 60) || "New chat" : c.title;
          return {
            conversations: {
              ...s.conversations,
              [id]: { ...c, threads, title, updatedAt: Date.now() },
            },
          };
        });
        return msgId;
      },
      startAssistant: (convId, modelId, status = "thinking") => {
        const msgId = uid();
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const t = c.threads[modelId] ?? { modelId, messages: [] };
          const newT: ModelThread = {
            ...t,
            messages: pruneMessages([
              ...t.messages,
              {
                id: msgId,
                role: "assistant",
                content: "",
                modelId,
                pending: true,
                status,
                createdAt: Date.now(),
              },
            ]),
          };
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, threads: { ...c.threads, [modelId]: newT } },
            },
          };
        });
        return msgId;
      },
      setAssistantStatus: (convId, modelId, msgId, status) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const t = c.threads[modelId];
          if (!t) return s;
          const messages = t.messages.map((m) =>
            m.id === msgId ? { ...m, status } : m
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, threads: { ...c.threads, [modelId]: { ...t, messages } } },
            },
          };
        }),
      appendAssistant: (convId, modelId, msgId, delta) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const t = c.threads[modelId];
          if (!t) return s;
          const messages = t.messages.map((m) =>
            m.id === msgId ? { ...m, content: m.content + delta, status: undefined } : m
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, threads: { ...c.threads, [modelId]: { ...t, messages } } },
            },
          };
        }),
      finishAssistant: (convId, modelId, msgId, patch) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const t = c.threads[modelId];
          if (!t) return s;
          const finishedAt = Date.now();
          const messages = t.messages.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  pending: false,
                  status: undefined,
                  responseTimeMs:
                    patch?.responseTimeMs ??
                    m.responseTimeMs ??
                    Math.max(0, finishedAt - m.createdAt),
                  ...patch,
                }
              : m
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: {
                ...c,
                threads: { ...c.threads, [modelId]: { ...t, messages: pruneMessages(messages) } },
                updatedAt: Date.now(),
              },
            },
          };
        }),
      failAssistant: (convId, modelId, msgId, error) =>
        get().finishAssistant(convId, modelId, msgId, { error, pending: false }),
      saveConsensus: (convId, content, modelId) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const note: Message = {
            id: uid(),
            role: "assistant",
            content,
            modelId,
            createdAt: Date.now(),
          };
          return {
            conversations: {
              ...s.conversations,
              [convId]: {
                ...c,
                consensusMessages: [...(c.consensusMessages ?? []), note].slice(
                  -MAX_CONSENSUS_MESSAGES_PER_CONVERSATION
                ),
                updatedAt: Date.now(),
              },
            },
          };
        }),
      startSharedResult: (convId, result) => {
        const resultId = uid();
        const now = Date.now();
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const note: SharedResult = {
            ...result,
            id: resultId,
            content: result.content ?? "",
            createdAt: now,
            updatedAt: now,
          };
          return {
            conversations: {
              ...s.conversations,
              [convId]: {
                ...c,
                sharedResults: [...(c.sharedResults ?? []), note].slice(
                  -MAX_SHARED_RESULTS_PER_CONVERSATION
                ),
                updatedAt: now,
              },
            },
          };
        });
        return resultId;
      },
      appendSharedResultContent: (convId, resultId, delta) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const now = Date.now();
          const sharedResults = (c.sharedResults ?? []).map((result) =>
            result.id === resultId
              ? {
                  ...result,
                  content: result.content + delta,
                  finalAnswer:
                    result.type === "council"
                      ? (result.finalAnswer ?? "") + delta
                      : result.finalAnswer,
                  updatedAt: now,
                }
              : result
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, sharedResults, updatedAt: now },
            },
          };
        }),
      finishSharedResult: (convId, resultId, patch) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const now = Date.now();
          const sharedResults = (c.sharedResults ?? []).map((result) =>
            result.id === resultId
              ? { ...result, ...patch, pending: false, updatedAt: now }
              : result
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, sharedResults, updatedAt: now },
            },
          };
        }),
      setSharedResultJudge: (convId, resultId, judge) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const now = Date.now();
          const sharedResults = (c.sharedResults ?? []).map((result) =>
            result.id === resultId ? { ...result, judge, updatedAt: now } : result
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, sharedResults, updatedAt: now },
            },
          };
        }),
      startCouncilRound: (convId, resultId, round) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const now = Date.now();
          const sharedResults = (c.sharedResults ?? []).map((result) => {
            if (result.id !== resultId) return result;
            const rounds = result.rounds ?? [];
            return {
              ...result,
              rounds: rounds.some((entry) => entry.id === round.id)
                ? rounds.map((entry) => (entry.id === round.id ? { ...entry, ...round } : entry))
                : [...rounds, round],
              updatedAt: now,
            };
          });
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, sharedResults, updatedAt: now },
            },
          };
        }),
      upsertCouncilStatus: (convId, resultId, status) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const now = Date.now();
          const entry: CouncilStatusEntry = { ...status, updatedAt: now };
          const sharedResults = (c.sharedResults ?? []).map((result) => {
            if (result.id !== resultId) return result;
            const statuses = result.statuses ?? [];
            return {
              ...result,
              statuses: statuses.some((item) => item.modelId === entry.modelId)
                ? statuses.map((item) =>
                    item.modelId === entry.modelId ? { ...item, ...entry } : item
                  )
                : [...statuses, entry],
              updatedAt: now,
            };
          });
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, sharedResults, updatedAt: now },
            },
          };
        }),
      addCouncilNote: (convId, resultId, note) =>
        set((s) => {
          const c = s.conversations[convId];
          if (!c) return s;
          const now = Date.now();
          const entry: CouncilNoteEntry = { ...note, id: uid(), createdAt: now };
          const sharedResults = (c.sharedResults ?? []).map((result) =>
            result.id === resultId
              ? {
                  ...result,
                  notes: [...(result.notes ?? []), entry],
                  updatedAt: now,
                }
              : result
          );
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...c, sharedResults, updatedAt: now },
            },
          };
        }),
    }),
    {
      name: "alles-ai-chats",
      version: 21,
      partialize: (state) => {
        const conversations = pruneConversationsByRecency(
          filterPersistableConversations(
            Object.fromEntries(
              Object.entries(state.conversations).map(([id, conversation]) => [
                id,
                pruneConversationPayload(conversation),
              ])
            )
          )
        );
        return {
          conversations,
          activeId: pickActiveConversationId(state.activeId, conversations),
          lastUsedModels: state.lastUsedModels,
        };
      },
      migrate: (persistedState) => {
        const state = persistedState as Partial<ChatState> | undefined;
        const sanitizedConversations = Object.fromEntries(
          Object.entries(state?.conversations ?? {}).map(([id, conversation]) => [
            id,
            sanitizeConversation(conversation as Conversation),
          ])
        );
        const conversations = pruneConversationsByRecency(
          filterPersistableConversations(sanitizedConversations)
        );

        const lastUsedModels = dedupeModelIdsByFamily(
          Array.from(
            new Set(
              (state?.lastUsedModels ?? [])
                .map(normalizeModelId)
                .filter((modelId): modelId is string => Boolean(modelId))
            )
          )
        );

        return {
          ...state,
          conversations,
          lastUsedModels: lastUsedModels.length > 0 ? lastUsedModels : DEFAULT_SELECTED_MODELS,
          activeId: pickActiveConversationId(state?.activeId ?? null, conversations),
        } as ChatState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Always sanitize on load - don't rely solely on version-based migration
        const sanitizedConvs = Object.fromEntries(
          Object.entries(state.conversations).map(([id, conv]) => [
            id,
            sanitizeConversation(conv),
          ])
        );
        const conversations = pruneConversationsByRecency(
          filterPersistableConversations(sanitizedConvs)
        );
        const sanitizedLast = dedupeModelIdsByFamily(
          Array.from(
            new Set(
              state.lastUsedModels
                .map(normalizeModelId)
                .filter((id): id is string => Boolean(id))
            )
          )
        );
        useChat.setState({
          conversations,
          activeId: pickActiveConversationId(state.activeId, conversations),
          lastUsedModels: sanitizedLast.length > 0 ? sanitizedLast : DEFAULT_SELECTED_MODELS,
        });
      },
    }
  )
);
