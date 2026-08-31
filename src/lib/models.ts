// Models catalog. A model can have multiple API routes, but the picker groups
// those routes under one model family so users do not select duplicates.

import {
  API_PROVIDER_ORDER,
  PROVIDER_ORDER,
  type ApiProviderKey,
  type ProviderKey,
} from "./providers";
import { isRemovedModelName } from "./model-rules";

export type ModelInfo = {
  id: string;
  label: string;
  shortLabel?: string;
  provider: ProviderKey;
  apiProvider: ApiProviderKey;
  familyId: string;
  free: boolean;
  accessLabel?: string;
  accessHint?: string;
  context: number;
  category: string;
  vision?: boolean;
  thinking?: boolean;
  routeHint?: string;
  bestFor?: string;
  paramSize?: string;
};

export type ProviderGroup = {
  provider: ProviderKey;
  freeModel?: ModelInfo;
  paidModels: ModelInfo[];
};

export type ModelFamily = {
  familyId: string;
  label: string;
  shortLabel?: string;
  provider: ProviderKey;
  context: number;
  category: string;
  vision?: boolean;
  thinking?: boolean;
  routes: ModelInfo[];
};

export type CloudOllamaPreset = {
  name: string;
  label: string;
  shortLabel?: string;
  provider: ProviderKey;
  familyId: string;
  paramSize: string;
  bestFor: string;
  context: number;
  category: string;
  free?: boolean;
  accessLabel?: string;
  accessHint?: string;
  routeHint?: string;
  vision?: boolean;
  thinking?: boolean;
};

export const OLLAMA_MODEL_PREFIX = "ollama/";
export const CLOUD_OLLAMA_PREFIX = "ollama-cloud/";
export const CUSTOM_MODEL_PREFIX = "custom/";
export const OPENCODE_MODEL_PREFIX = "opencode/";
export const BEDROCK_MODEL_PREFIX = "bedrock/";

// User-defined OpenAI-compatible API provider.
export type CustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    shortLabel: "GPT-OSS 120B",
    provider: "openai",
    apiProvider: "groq",
    familyId: "gpt-oss-120b",
    free: true,
    context: 131072,
    category: "Reasoning",
    thinking: true,
    routeHint: "Groq hosted OpenAI open-weight model",
    bestFor: "Reasoning, agents",
    paramSize: "120B",
  },
  {
    // Groq retired llama-3.3-70b-versatile (404 model_not_found); Qwen 3.8 is
    // the closest live all-purpose replacement on Groq.
    id: "qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B",
    shortLabel: "Qwen 3.8 27B",
    provider: "qwen",
    apiProvider: "groq",
    familyId: "qwen3.8-27b",
    free: true,
    context: 131072,
    category: "General",
    thinking: true,
    routeHint: "Groq hosted Qwen model",
    bestFor: "All-purpose chat, code, reasoning",
    paramSize: "27B",
  },
  {
    // Groq retired llama-3.1-8b-instant (404 model_not_found); GPT-OSS 20B is
    // the closest live fast/small replacement on Groq.
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    shortLabel: "GPT-OSS 20B",
    provider: "openai",
    apiProvider: "groq",
    familyId: "gpt-oss-20b",
    free: true,
    context: 131072,
    category: "General",
    thinking: true,
    routeHint: "Groq hosted OpenAI open-weight model",
    bestFor: "Ultra-fast responses, mobile",
    paramSize: "20B",
  },
  {
    // Preferred over the newer gemini-3.6-flash: identical 1M context and 65k
    // output, but 2-4x faster to first token when streaming, which is what
    // chat and consensus synthesis actually do.
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    shortLabel: "Gemini 3.5 Flash",
    provider: "gemini",
    apiProvider: "gemini",
    familyId: "gemini-3.5-flash",
    free: true,
    context: 1048576,
    category: "General",
    vision: true,
    routeHint: "Google Gemini API",
    bestFor: "Fast, large-context general model",
  },
  {
    id: "gemma-4-31b-it",
    label: "Gemma 4 31B",
    shortLabel: "Gemma 4 31B",
    provider: "gemini",
    apiProvider: "gemini",
    familyId: "gemma-4-31b",
    free: true,
    context: 262144,
    category: "General",
    routeHint: "Google Gemini API",
    bestFor: "Open-weight general assistant",
    paramSize: "31B",
  },
];

// OpenCode Zen is an AI gateway offering dozens of models (most paid). Rather
// than statically listing all of them, users browse the live list (see
// getOpenCodeModelInfos) and pick which ones to import. A handful of known
// free models ship with curated metadata; anything else falls back to a
// generic entry built from the model id alone.
export const OPENCODE_KNOWN_MODELS: Record<
  string,
  {
    label: string;
    shortLabel?: string;
    provider: ProviderKey;
    category: string;
    context: number;
    thinking?: boolean;
    vision?: boolean;
    free: boolean;
    bestFor?: string;
  }
> = {
  "big-pickle": {
    label: "Big Pickle",
    provider: "opencode",
    category: "General",
    context: 128000,
    free: true,
    bestFor: "General chat",
  },
  "mimo-v2.5-free": {
    label: "MiMo 2.5 Free",
    shortLabel: "MiMo 2.5",
    provider: "opencode",
    category: "General",
    context: 128000,
    free: true,
    bestFor: "General chat",
  },
  "ling-3.0-flash-fin-free": {
    label: "Ling 3.0 Flash Fin Free",
    shortLabel: "Ling 3.0 Flash",
    provider: "opencode",
    category: "General",
    context: 128000,
    free: true,
    bestFor: "Very fast general chat",
  },
  "laguna-s-2.1-free": {
    label: "Laguna S 2.1 Free",
    shortLabel: "Laguna S 2.1",
    provider: "opencode",
    category: "General",
    context: 128000,
    free: true,
    bestFor: "General chat",
  },
};

// Imported by default so existing users keep the same free models they had
// before OpenCode model browsing existed.
export const DEFAULT_OPENCODE_MODEL_IDS = Object.keys(OPENCODE_KNOWN_MODELS);

// Amazon Bedrock via the project-scoped "mantle" endpoint. Every entry below
// was verified live: it streams, and it digests an ~82k-char / 20.5k-token
// payload representing consensus over ten long model answers.
// Latencies are seconds to first streamed token.
export const BEDROCK_KNOWN_MODELS: Record<
  string,
  {
    label: string;
    shortLabel?: string;
    provider: ProviderKey;
    category: string;
    context: number;
    thinking?: boolean;
    vision?: boolean;
    paramSize?: string;
    bestFor?: string;
  }
> = {
  "zai.glm-4.7-flash": {
    label: "GLM 4.7 Flash",
    shortLabel: "GLM 4.7 Flash",
    provider: "zhipu",
    category: "General",
    context: 200000,
    bestFor: "Fast all-purpose chat",
  },
  "moonshotai.kimi-k2.5": {
    label: "Kimi K2.5",
    shortLabel: "Kimi K2.5",
    provider: "moonshot",
    category: "Reasoning",
    context: 256000,
    thinking: true,
    bestFor: "Long-context reasoning",
  },
  "deepseek.v3.2": {
    label: "DeepSeek V3.2",
    shortLabel: "DeepSeek V3.2",
    provider: "deepseek",
    category: "Reasoning",
    context: 164000,
    thinking: true,
    bestFor: "Code and analysis",
  },
  "mistral.ministral-3-14b-instruct": {
    label: "Ministral 3 14B",
    shortLabel: "Ministral 14B",
    provider: "mistral",
    category: "General",
    context: 128000,
    paramSize: "14B",
    bestFor: "Fast general answers",
  },
  "mistral.mistral-large-3-675b-instruct": {
    label: "Mistral Large 3",
    shortLabel: "Mistral Large 3",
    provider: "mistral",
    category: "Reasoning",
    context: 256000,
    paramSize: "675B",
    bestFor: "Deep reasoning, synthesis",
  },
  "qwen.qwen3-235b-a22b-2507": {
    label: "Qwen 3 235B",
    shortLabel: "Qwen 3 235B",
    provider: "qwen",
    category: "Reasoning",
    context: 256000,
    thinking: true,
    paramSize: "235B",
    bestFor: "Reasoning and code",
  },
  "nvidia.nemotron-super-3-120b": {
    label: "Nemotron Super 3 120B",
    shortLabel: "Nemotron Super 3",
    provider: "nvidia",
    category: "Reasoning",
    context: 128000,
    thinking: true,
    paramSize: "120B",
    bestFor: "Analysis and reasoning",
  },
  "openai.gpt-oss-120b": {
    label: "GPT-OSS 120B (Bedrock)",
    shortLabel: "GPT-OSS 120B",
    provider: "openai",
    category: "Reasoning",
    context: 128000,
    thinking: true,
    paramSize: "120B",
    bestFor: "Reasoning, agents",
  },
  "zai.glm-4.7": {
    label: "GLM 4.7",
    shortLabel: "GLM 4.7",
    provider: "zhipu",
    category: "Reasoning",
    context: 200000,
    bestFor: "General reasoning",
  },
};

export const DEFAULT_BEDROCK_MODEL_IDS = [
  "zai.glm-4.7-flash",
  "moonshotai.kimi-k2.5",
  "deepseek.v3.2",
  "mistral.ministral-3-14b-instruct",
];

export function toBedrockModelId(modelName: string): string {
  return `${BEDROCK_MODEL_PREFIX}${modelName}`;
}

export function getBedrockModelName(id: string): string {
  return id.slice(BEDROCK_MODEL_PREFIX.length);
}

export function getBedrockModelInfo(modelName: string): ModelInfo {
  const known = BEDROCK_KNOWN_MODELS[modelName];
  const label = known?.label ?? humanizeModelSlug(modelName.replace(/^[a-z]+\./, ""));
  return {
    id: toBedrockModelId(modelName),
    label,
    shortLabel: known?.shortLabel ?? label,
    provider: known?.provider ?? "bedrock",
    apiProvider: "bedrock",
    familyId: `bedrock-${modelName}`,
    free: false,
    context: known?.context ?? 128000,
    category: known?.category ?? "Bedrock",
    thinking: known?.thinking,
    vision: known?.vision,
    paramSize: known?.paramSize,
    routeHint: "Amazon Bedrock",
    bestFor: known?.bestFor ?? "Amazon Bedrock model",
  };
}

export function getBedrockModelInfos(modelNames: string[]): ModelInfo[] {
  return uniqueActiveModelNames(modelNames).map(getBedrockModelInfo);
}

export function isBedrockModelId(id: string): boolean {
  return id.startsWith(BEDROCK_MODEL_PREFIX) && id.length > BEDROCK_MODEL_PREFIX.length;
}

// Turns a model id slug (e.g. "big-pickle", "llama-3.3-70b-versatile") into a
// readable label. Shared by every "browse and import" fallback below.
function humanizeModelSlug(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      /^[a-z0-9.]+$/i.test(part) && part.length <= 4
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

export function toOpenCodeModelId(modelName: string): string {
  return `${OPENCODE_MODEL_PREFIX}${modelName}`;
}

export function getOpenCodeModelName(id: string): string {
  return id.slice(OPENCODE_MODEL_PREFIX.length);
}

export function getOpenCodeModelInfo(modelName: string): ModelInfo {
  const known = OPENCODE_KNOWN_MODELS[modelName];
  const label = known?.label ?? humanizeModelSlug(modelName);
  return {
    id: toOpenCodeModelId(modelName),
    label,
    shortLabel: known?.shortLabel ?? label,
    provider: known?.provider ?? "opencode",
    apiProvider: "opencode",
    familyId: `opencode-${modelName}`,
    free: known?.free ?? false,
    context: known?.context ?? 0,
    category: known?.category ?? "OpenCode",
    thinking: known?.thinking,
    vision: known?.vision,
    routeHint: "OpenCode Zen gateway",
    bestFor: known?.bestFor ?? "OpenCode Zen model",
  };
}

export function getOpenCodeModelInfos(modelNames: string[]): ModelInfo[] {
  return uniqueActiveModelNames(modelNames).map(getOpenCodeModelInfo);
}

// Groq serves models from many different labs. Guess a brand tile from the
// model id so imported (non-core) Groq models still get a sensible icon.
function guessGroqProviderBrand(modelName: string): ProviderKey {
  const lower = modelName.toLowerCase();
  if (lower.includes("llama")) return "meta";
  if (lower.includes("qwen")) return "qwen";
  if (lower.includes("gemma")) return "gemini";
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("gpt-oss") || lower.includes("openai")) return "openai";
  if (lower.includes("nemotron")) return "nvidia";
  if (lower.includes("glm")) return "zhipu";
  if (lower.includes("minimax")) return "minimax";
  return "custom";
}

// Extra (non-core) Groq models a user imports via "Browse models". Uses the
// `groq/<name>` id scheme, which the chat/consensus routes already strip.
export function getGroqExtraModelInfo(modelName: string): ModelInfo {
  const label = humanizeModelSlug(modelName);
  return {
    id: `groq/${modelName}`,
    label,
    shortLabel: label,
    provider: guessGroqProviderBrand(modelName),
    apiProvider: "groq",
    familyId: `groq-extra-${modelName}`,
    free: true,
    context: 0,
    category: "Groq",
    routeHint: "Groq hosted model",
    bestFor: "Imported Groq model",
  };
}

export function getGroqExtraModelInfos(modelNames: string[]): ModelInfo[] {
  return uniqueActiveModelNames(modelNames).map(getGroqExtraModelInfo);
}

// Extra (non-core) Gemini models a user imports via "Browse models". Gemini
// model ids are already bare (e.g. "gemini-2.5-pro") and route correctly
// through the existing `id.startsWith("gemini")` checks with no prefix.
export function getGeminiExtraModelInfo(modelName: string): ModelInfo {
  const label = humanizeModelSlug(modelName);
  return {
    id: modelName,
    label,
    shortLabel: label,
    provider: "gemini",
    apiProvider: "gemini",
    familyId: `gemini-extra-${modelName}`,
    free: false,
    context: 0,
    category: "Gemini",
    routeHint: "Google Gemini API",
    bestFor: "Imported Gemini model",
  };
}

export function getGeminiExtraModelInfos(modelNames: string[]): ModelInfo[] {
  return uniqueActiveModelNames(modelNames).map(getGeminiExtraModelInfo);
}

// Imported by default: verified-working free Gemini models beyond the core
// catalog entries, so a Gemini-only user still has a consensus backup bench.
// One model per family generation — older same-family variants are omitted.
export const DEFAULT_GEMINI_EXTRA_MODEL_IDS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];


// Pre-defined hosted Ollama models (ollama.com API). All verified on the free
// tier. Only the strongest member of each family is listed — smaller or slower
// same-family variants add clutter without adding capability.
export const PRESET_CLOUD_OLLAMA_MODELS: CloudOllamaPreset[] = [
  {
    name: "gemma4:31b",
    label: "Gemma 4 31B",
    shortLabel: "Gemma 4",
    provider: "gemini",
    familyId: "gemma4-31b",
    paramSize: "31B",
    bestFor: "Fast general assistant",
    context: 256000,
    category: "General",
    vision: true,
    thinking: true,
  },
  {
    name: "nemotron-3-super",
    label: "Nemotron 3 Super",
    shortLabel: "Nemotron 3 Super",
    provider: "nvidia",
    familyId: "nemotron-3-super",
    paramSize: "Super",
    bestFor: "Reasoning & analysis",
    context: 131072,
    category: "Reasoning",
    thinking: true,
  },
  {
    name: "gpt-oss:120b",
    label: "GPT-OSS 120B (Ollama)",
    shortLabel: "GPT-OSS 120B",
    provider: "openai",
    familyId: "gpt-oss-120b",
    paramSize: "120B",
    bestFor: "Reasoning, agents",
    context: 131072,
    category: "Reasoning",
    thinking: true,
  },
];

export function isOllamaModelId(id: string): boolean {
  return id.startsWith(OLLAMA_MODEL_PREFIX) && id.length > OLLAMA_MODEL_PREFIX.length;
}

export function isCloudOllamaModelId(id: string): boolean {
  return id.startsWith(CLOUD_OLLAMA_PREFIX) && id.length > CLOUD_OLLAMA_PREFIX.length;
}

export function isCustomModelId(id: string): boolean {
  return id.startsWith(CUSTOM_MODEL_PREFIX) && id.split("/").length >= 3;
}

export function isOpenCodeModelId(id: string): boolean {
  return id.startsWith(OPENCODE_MODEL_PREFIX) && id.length > OPENCODE_MODEL_PREFIX.length;
}

// custom/<providerId>/<modelName> — modelName may itself contain slashes.
export function parseCustomModelId(id: string): { providerId: string; modelName: string } | null {
  if (!isCustomModelId(id)) return null;
  const rest = id.slice(CUSTOM_MODEL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash >= rest.length - 1) return null;
  return { providerId: rest.slice(0, slash), modelName: rest.slice(slash + 1) };
}

export function toCustomModelId(providerId: string, modelName: string): string {
  return `${CUSTOM_MODEL_PREFIX}${providerId}/${modelName}`;
}

export function getCustomProviderModelInfos(providers: CustomProvider[]): ModelInfo[] {
  return providers.flatMap((provider) =>
    provider.models.map((modelName) => customModelToInfo(provider, modelName))
  );
}

function customModelToInfo(provider: CustomProvider, modelName: string): ModelInfo {
  return {
    id: toCustomModelId(provider.id, modelName),
    label: modelName,
    shortLabel: modelName,
    provider: "custom",
    apiProvider: "custom",
    familyId: toCustomModelId(provider.id, modelName),
    free: true,
    context: 0,
    category: provider.name,
    routeHint: `${provider.name} (custom API)`,
    bestFor: provider.name,
  };
}

export function toOllamaModelId(modelName: string): string {
  return `${OLLAMA_MODEL_PREFIX}${modelName}`;
}

export function toCloudOllamaModelId(modelName: string): string {
  return `${CLOUD_OLLAMA_PREFIX}${modelName}`;
}

export function getOllamaModelName(id: string): string {
  return id.slice(OLLAMA_MODEL_PREFIX.length);
}

export function getCloudOllamaModelName(id: string): string {
  return id.slice(CLOUD_OLLAMA_PREFIX.length);
}

export function getPresetCloudOllamaModelInfos(): ModelInfo[] {
  return PRESET_CLOUD_OLLAMA_MODELS.map(cloudPresetToModel);
}

export function getCloudOllamaModelInfo(modelName: string): ModelInfo {
  const preset = PRESET_CLOUD_OLLAMA_MODELS.find((model) => model.name === modelName);
  return preset ? cloudPresetToModel(preset) : ollamaNameToModel(modelName, "ollama-cloud");
}

export function getCloudOllamaModelInfos(modelNames: string[]): ModelInfo[] {
  return uniqueActiveModelNames(modelNames).map(getCloudOllamaModelInfo);
}

// Settings shows PRESET_CLOUD_OLLAMA_MODELS as "Default models" for Ollama
// Cloud, implying they're available as soon as the provider is enabled. But
// every picker/composer only turned `ollamaCloudModels` (the user's manually
// browsed-and-imported list) into routes, so those presets never actually
// showed up unless a user separately found and re-imported the exact same
// model name. This merges the presets in so "default" actually means default.
export function getCloudOllamaModelNames(imported: string[]): string[] {
  return uniqueActiveModelNames([...PRESET_CLOUD_OLLAMA_MODELS.map((m) => m.name), ...imported]);
}

function uniqueActiveModelNames(modelNames: string[]): string[] {
  return Array.from(new Set(modelNames.map((name) => name.trim()).filter(Boolean))).filter(
    (name) => !isRemovedModelName(name)
  );
}

export function getLocalOllamaModelInfo(modelName: string): ModelInfo {
  return ollamaNameToModel(modelName, "ollama-local");
}

export function getModel(id: string): ModelInfo | undefined {
  if (isRemovedModelName(id)) return undefined;

  const catalogModel = MODEL_CATALOG.find((m) => m.id === id);
  if (catalogModel) return catalogModel;

  if (isOllamaModelId(id)) {
    return ollamaNameToModel(getOllamaModelName(id), "ollama-local");
  }

  if (isCloudOllamaModelId(id)) {
    const modelName = getCloudOllamaModelName(id);
    return getCloudOllamaModelInfo(modelName);
  }

  if (isOpenCodeModelId(id)) {
    return getOpenCodeModelInfo(getOpenCodeModelName(id));
  }

  if (id.startsWith("groq/")) {
    return getGroqExtraModelInfo(id.slice("groq/".length));
  }

  if (id.startsWith("gemini")) {
    return getGeminiExtraModelInfo(id);
  }

  if (isCustomModelId(id)) {
    const parsed = parseCustomModelId(id);
    if (!parsed) return undefined;
    return {
      id,
      label: parsed.modelName,
      shortLabel: parsed.modelName,
      provider: "custom",
      apiProvider: "custom",
      familyId: id,
      free: true,
      context: 0,
      category: "Custom",
      routeHint: "Custom API",
      bestFor: "Custom provider",
    };
  }

  return undefined;
}

export function getModelFamilyId(id: string): string {
  return getModel(id)?.familyId ?? id;
}

export function dedupeModelIdsByFamily(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    const familyId = getModelFamilyId(id);
    if (seen.has(familyId)) continue;
    seen.add(familyId);
    next.push(id);
  }
  return next;
}

export function modelSupportsVision(id: string): boolean {
  return Boolean(getModel(id)?.vision);
}

export function buildModelFamilies(models: ModelInfo[]): ModelFamily[] {
  const map = new Map<string, ModelFamily>();

  for (const model of models) {
    const existing = map.get(model.familyId);
    if (!existing) {
      map.set(model.familyId, {
        familyId: model.familyId,
        label: model.label,
        shortLabel: model.shortLabel,
        provider: model.provider,
        context: model.context,
        category: model.category,
        vision: model.vision,
        thinking: model.thinking,
        routes: [model],
      });
      continue;
    }

    existing.context = Math.max(existing.context, model.context);
    existing.vision = existing.vision || model.vision;
    existing.thinking = existing.thinking || model.thinking;
    existing.routes.push(model);
    existing.routes.sort(compareModelRoutes);
  }

  return Array.from(map.values()).sort(compareFamilies);
}

export function getProviderGroups(): ProviderGroup[] {
  const map = new Map<ProviderKey, ProviderGroup>();
  for (const model of MODEL_CATALOG) {
    let group = map.get(model.provider);
    if (!group) {
      group = { provider: model.provider, paidModels: [] };
      map.set(model.provider, group);
    }
    if (model.free) {
      group.freeModel = model;
    } else {
      group.paidModels.push(model);
    }
  }
  return PROVIDER_ORDER.map((provider) => map.get(provider)).filter(Boolean) as ProviderGroup[];
}

// Default selection: broad, non-duplicated hosted API coverage. Local and
// Ollama API routes are opt-in.
export const DEFAULT_SELECTED_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
  "gemini-3.5-flash",
];

// Preferred synthesis model. The UI falls through to the first eligible route
// when this provider is unavailable.
export const CONSENSUS_MODEL = "gemini-3.5-flash";

// ollama.com cloud models aren't per-model free/paid — every plan (including
// Free) can call every hosted model, but usage is metered against a plan's
// usage allowance (heavier models burn through it faster). So these get an
// accurate "Ollama plan" access label instead of a blanket Free badge.
const CLOUD_OLLAMA_ACCESS_LABEL = "Ollama plan";
const CLOUD_OLLAMA_ACCESS_HINT =
  "Metered by your ollama.com plan (Free/Pro/Max) — larger models use more of your usage allowance, not a separate fee.";

// A handful of ollama.com cloud model families are actually free to run (no
// plan-usage metering), unlike the rest of the cloud catalog. Matched by name
// prefix/substring so every size/variant in a free family is covered.
export function isFreeCloudOllamaModel(modelName: string): boolean {
  const name = stripLatestTag(modelName).toLowerCase();
  if (name.startsWith("gemma")) return true;
  // qwen3-coder is currently a paid subscription tier model on Ollama Cloud.
  if (name.startsWith("qwen3-coder")) return false;
  // qwen3.5 is currently a paid subscription tier model on Ollama Cloud.
  if (name.startsWith("qwen3.5")) return false;
  if (name.startsWith("qwen")) return true;
  if (name.startsWith("ministral")) return true;
  if (name.startsWith("minimax-m2.5") || name.startsWith("minimax-m3")) return true;
  if (name.startsWith("glm-4.7")) return true;
  if (name.startsWith("nemotron-3-super")) return true;
  if (name.startsWith("gpt-oss") && extractParamSize(name) === "20B") return true;
  return false;
}

function cloudPresetToModel(preset: CloudOllamaPreset): ModelInfo {
  const free = preset.free ?? isFreeCloudOllamaModel(preset.name);
  return {
    id: toCloudOllamaModelId(preset.name),
    label: preset.label,
    shortLabel: preset.shortLabel,
    provider: preset.provider,
    apiProvider: "ollama-cloud",
    familyId: preset.familyId,
    free,
    accessLabel: preset.accessLabel ?? (free ? undefined : CLOUD_OLLAMA_ACCESS_LABEL),
    accessHint: preset.accessHint ?? (free ? undefined : CLOUD_OLLAMA_ACCESS_HINT),
    context: preset.context,
    category: preset.category,
    vision: preset.vision,
    thinking: preset.thinking,
    routeHint: preset.routeHint ?? "Ollama API",
    bestFor: preset.bestFor,
    paramSize: preset.paramSize,
  };
}

function ollamaNameToModel(modelName: string, apiProvider: ApiProviderKey): ModelInfo {
  const inferred = inferOllamaModel(modelName);
  const id =
    apiProvider === "ollama-cloud"
      ? toCloudOllamaModelId(modelName)
      : toOllamaModelId(modelName);

  const isCloud = apiProvider === "ollama-cloud";
  // Local models run on your own hardware and are genuinely unlimited/free.
  // Cloud models are metered by your ollama.com plan, except a handful of
  // known-free families (Gemma, Qwen, Ministral, MiniMax M2.5/M3, GLM 4.7,
  // Nemotron 3 Super, GPT-OSS 20B).
  const free = !isCloud || isFreeCloudOllamaModel(modelName);

  return {
    id,
    label: inferred.label,
    shortLabel: inferred.shortLabel,
    provider: inferred.provider,
    apiProvider,
    familyId: inferred.familyId,
    free,
    accessLabel: isCloud && !free ? CLOUD_OLLAMA_ACCESS_LABEL : undefined,
    accessHint: isCloud && !free ? CLOUD_OLLAMA_ACCESS_HINT : undefined,
    context: inferred.context,
    category: isCloud ? inferred.category : inferred.category || "Local",
    vision: inferred.vision,
    thinking: inferred.thinking,
    routeHint: isCloud ? "Ollama API" : "Installed local Ollama model",
    bestFor: inferred.bestFor,
    paramSize: inferred.paramSize,
  };
}

function inferOllamaModel(modelName: string): Omit<ModelInfo, "id" | "apiProvider" | "free"> {
  const cleanName = stripLatestTag(modelName).trim();
  const lower = cleanName.toLowerCase();
  const size = extractParamSize(lower);

  if (lower.startsWith("gpt-oss")) {
    const paramSize = size ?? "Unknown";
    return {
      label: `GPT-OSS ${paramSize}`,
      shortLabel: `GPT-OSS ${paramSize}`,
      provider: "openai",
      familyId: `gpt-oss-${paramSize.toLowerCase()}`,
      context: 131072,
      category: "Reasoning",
      thinking: true,
      bestFor: "Reasoning, agents",
      paramSize,
    };
  }

  if (lower.startsWith("qwen3-coder")) {
    const paramSize = size;
    if (!paramSize) {
      return {
        label: "Qwen3 Coder",
        shortLabel: "Qwen3 Coder",
        provider: "qwen",
        familyId: "qwen3-coder",
        context: 0,
        category: "",
        bestFor: "Coding tasks",
      };
    }
    return {
      label: `Qwen3 Coder ${paramSize}`,
      shortLabel: "Qwen3 Coder",
      provider: "qwen",
      familyId: `qwen3-coder-${paramSize.toLowerCase()}`,
      context: 0,
      category: "Coding",
      thinking: true,
      bestFor: "Coding tasks",
      paramSize,
    };
  }

  if (lower.startsWith("qwen3-vl") || lower.includes("qwen2.5vl") || lower.includes("qwen2-vl")) {
    const paramSize = size ?? "Unknown";
    const series = lower.startsWith("qwen3-vl") ? "qwen3-vl" : "qwen-vl";
    const labelSeries = lower.startsWith("qwen3-vl") ? "Qwen3 VL" : "Qwen VL";
    return {
      label: `${labelSeries} ${paramSize}`,
      shortLabel: labelSeries,
      provider: "qwen",
      familyId: `${series}-${paramSize.toLowerCase()}`,
      context: 0,
      category: "Vision",
      vision: true,
      bestFor: "Vision-language",
      paramSize,
    };
  }

  if (lower.startsWith("qwen3.5")) {
    const paramSize = size ?? "Unknown";
    return {
      label: `Qwen3.5 ${paramSize}`,
      shortLabel: "Qwen3.5",
      provider: "qwen",
      familyId: `qwen3-5-${paramSize.toLowerCase()}`,
      context: 256000,
      category: "General",
      vision: true,
      thinking: true,
      bestFor: "Multimodal reasoning",
      paramSize,
    };
  }

  if (lower.startsWith("qwen3")) {
    const paramSize = size ?? "Unknown";
    return {
      label: `Qwen3 ${paramSize}`,
      shortLabel: `Qwen3 ${paramSize}`,
      provider: "qwen",
      familyId: `qwen3-${paramSize.toLowerCase()}`,
      context: 0,
      category: "General",
      thinking: true,
      bestFor: "General reasoning",
      paramSize,
    };
  }

  if (lower.startsWith("gemma4")) {
    const paramSize = size ?? "Unknown";
    return {
      label: `Gemma 4 ${paramSize}`,
      shortLabel: "Gemma 4",
      provider: "gemini",
      familyId: `gemma4-${paramSize.toLowerCase()}`,
      context: lower.includes("31b") || lower.includes("26b") ? 256000 : 128000,
      category: "Reasoning",
      vision: true,
      thinking: true,
      bestFor: "Reasoning, general Q&A",
      paramSize,
    };
  }

  if (lower.startsWith("deepseek")) {
    const label = humanizeModelName(cleanName).replace(/^Deepseek\b/, "DeepSeek");
    return {
      label,
      shortLabel: label,
      provider: "deepseek",
      familyId: normalizeFamilyId(cleanName),
      context: lower.includes("v4") ? 1048576 : 0,
      category: "Reasoning",
      thinking: true,
      bestFor: "Reasoning",
      paramSize: size ?? "Varies",
    };
  }

  if (lower.startsWith("nemotron")) {
    return {
      label: humanizeModelName(cleanName),
      shortLabel: "Nemotron",
      provider: "nvidia",
      familyId: normalizeFamilyId(cleanName),
      context: 256000,
      category: "Reasoning",
      thinking: true,
      bestFor: "Fast reasoning",
      paramSize: size ?? "Super",
    };
  }

  if (lower.startsWith("gemma3")) {
    const paramSize = size ?? "Unknown";
    return {
      label: `Gemma 3 ${paramSize}`,
      shortLabel: "Gemma 3",
      provider: "gemini",
      familyId: `gemma3-${paramSize.toLowerCase()}`,
      context: 0,
      category: "Vision",
      vision: true,
      bestFor: "Vision, general",
      paramSize,
    };
  }

  if (lower.startsWith("glm-")) {
    return {
      label: humanizeModelName(cleanName, true),
      shortLabel: humanizeModelName(cleanName, true),
      provider: "zhipu",
      familyId: normalizeFamilyId(cleanName),
      context: 0,
      category: "Reasoning",
      thinking: true,
      bestFor: "Reasoning, code",
      paramSize: size ?? "Varies",
    };
  }

  if (lower.startsWith("minimax")) {
    return {
      label: humanizeModelName(cleanName, true),
      shortLabel: humanizeModelName(cleanName, true),
      provider: "minimax",
      familyId: normalizeFamilyId(cleanName),
      context: 0,
      category: "Productivity",
      bestFor: "Coding, productivity",
      paramSize: size ?? "Varies",
    };
  }

  if (lower.includes("llama")) {
    return {
      label: humanizeModelName(cleanName),
      shortLabel: humanizeModelName(cleanName),
      provider: "meta",
      familyId: normalizeFamilyId(cleanName),
      context: 0,
      category: isLikelyOllamaVisionModel(cleanName) ? "Vision" : "General",
      vision: isLikelyOllamaVisionModel(cleanName),
      paramSize: size,
    };
  }

  return {
    label: humanizeModelName(cleanName),
    shortLabel: humanizeModelName(cleanName),
    provider: "ollama",
    familyId: normalizeFamilyId(cleanName),
    context: 0,
    category: isLikelyOllamaVisionModel(cleanName) ? "Vision" : "General",
    vision: isLikelyOllamaVisionModel(cleanName),
    paramSize: size,
  };
}

function compareModelRoutes(a: ModelInfo, b: ModelInfo) {
  return (
    API_PROVIDER_ORDER.indexOf(a.apiProvider) - API_PROVIDER_ORDER.indexOf(b.apiProvider) ||
    a.label.localeCompare(b.label)
  );
}

function compareFamilies(a: ModelFamily, b: ModelFamily) {
  return (
    PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider) ||
    familyFreeRank(a) - familyFreeRank(b) ||
    a.label.localeCompare(b.label)
  );
}

// Families with at least one free route sort ahead of fully paid families, so
// browsing a large imported catalog surfaces the free options first.
function familyFreeRank(family: ModelFamily): number {
  return family.routes.some((route) => route.free) ? 0 : 1;
}

function stripLatestTag(modelName: string): string {
  return modelName.replace(/:latest$/, "");
}

function normalizeFamilyId(modelName: string): string {
  return stripLatestTag(modelName)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/\./g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractParamSize(modelName: string): string | undefined {
  const match = modelName.match(/(?::|-)(\d+(?:\.\d+)?b)\b/);
  return match?.[1]?.toUpperCase();
}

function humanizeModelName(modelName: string, keepCaps = false): string {
  const spaced = stripLatestTag(modelName)
    .replace(/[/:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (keepCaps) {
    return spaced
      .replace(/\bglm\b/gi, "GLM")
      .replace(/\bm2\.5\b/gi, "M2.5");
  }

  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isLikelyOllamaVisionModel(modelName: string): boolean {
  const name = modelName.toLowerCase();
  return [
    "bakllava",
    "gemma3",
    "granite3.2-vision",
    "llava",
    "minicpm-v",
    "moondream",
    "qwen2.5vl",
    "qwen2-vl",
    "qwen3-vl",
  ].some((token) => name.includes(token));
}
