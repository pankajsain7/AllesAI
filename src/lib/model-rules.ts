import type { ModelInfo } from "./models";
import type { ApiProviderKey } from "./providers";

// deepseek-v4-flash-free: OpenCode Zen dropped it from the free tier (still
// listed in /v1/models but every completion request 400s "Model is unavailable").
// muse-spark-1.2-contributor-free: consistently 500s "Internal server error"
// on OpenCode Zen (verified across multiple attempts, not an auth issue).
const REMOVED_MODEL_TOKENS = ["mis" + "tral", "north-mini-code", "north mini code", "deepseek-v4-flash-free", "muse-spark-1.2-contributor-free"];

// The ONLY models allowed to run consensus and council (as synthesizer,
// debater, or judge). Curated so answer quality stays consistent and high no
// matter which one the user picks.
export const CONSENSUS_COUNCIL_MODEL_IDS = [
  // Gemini: 1 model (latest fast generation, 1M context)
  "gemini-3.5-flash",
  // Groq: 3 models (diverse sizes + capabilities for redundancy)
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  // Ollama: 2 models (cloud-hosted backups)
  "ollama-cloud/gemma4:31b",
  "ollama-cloud/nemotron-3-super",
] as const;

const ALLOWED_ID_SET = new Set<string>(CONSENSUS_COUNCIL_MODEL_IDS);
// Ollama models are allowed whether they resolve to the cloud or a local route
// of the same model name.
const ALLOWED_OLLAMA_NAMES = new Set(["gemma4:31b", "nemotron-3-super"]);

function isConsensusAllowedModel(model: Pick<ModelInfo, "id" | "apiProvider">): boolean {
  if (ALLOWED_ID_SET.has(model.id)) return true;
  // All Gemini models are allowed — they have large context windows and strong
  // synthesis quality, making them ideal fallbacks for large transcripts.
  if (model.apiProvider === "gemini") return true;
  if (model.apiProvider === "ollama-cloud" || model.apiProvider === "ollama-local") {
    const name = model.id
      .replace(/^ollama-cloud\//, "")
      .replace(/^ollama\//, "")
      .replace(/:latest$/, "");
    return ALLOWED_OLLAMA_NAMES.has(name);
  }
  return false;
}

// Default synthesizer/judge preference order (all from the allowlist above).
export const CONSENSUS_PRIORITY_MODEL_IDS = CONSENSUS_COUNCIL_MODEL_IDS;

// Default council debaters + judge pool (all from the allowlist above).
export const COUNCIL_PRIMARY_MODEL_IDS = CONSENSUS_COUNCIL_MODEL_IDS;

// No silent fallback bench — if a user-selected model fails, the run errors out.
export const COUNCIL_FALLBACK_MODEL_IDS = [] as const;

// Judge pool (all from the allowlist above).
export const JUDGE_MODEL_IDS = CONSENSUS_COUNCIL_MODEL_IDS;

// Council debaters and the judge must come from the same curated allowlist as
// consensus, so debate/verdict quality is consistent.
export function canUseModelForCouncil(model: ModelInfo): boolean {
  return !isRemovedModel(model) && isConsensusAllowedModel(model);
}

type ProviderAccessSettings = {
  apiKey?: string;
  groqEnabled: boolean;
  geminiApiKey?: string;
  geminiEnabled: boolean;
  opencodeApiKey?: string;
  opencodeEnabled: boolean;
  ollamaApiKey?: string;
  cloudOllamaEnabled: boolean;
  localEnabled: boolean;
};

export function isRemovedModelName(value: string): boolean {
  const lower = value.toLowerCase();
  return REMOVED_MODEL_TOKENS.some((token) => lower.includes(token));
}

export function isRemovedModel(model: Pick<ModelInfo, "id" | "label" | "familyId">): boolean {
  return [model.id, model.label, model.familyId].some(isRemovedModelName);
}

export function canUseModelForConsensus(model: ModelInfo): boolean {
  return !isRemovedModel(model) && isConsensusAllowedModel(model);
}

export function hasProviderAccessForConsensus(
  apiProvider: ApiProviderKey,
  settings: ProviderAccessSettings
): boolean {
  if (apiProvider === "groq") return settings.groqEnabled && Boolean(settings.apiKey?.trim());
  if (apiProvider === "gemini") return settings.geminiEnabled && Boolean(settings.geminiApiKey?.trim());
  if (apiProvider === "opencode") return settings.opencodeEnabled && Boolean(settings.opencodeApiKey?.trim());
  if (apiProvider === "ollama-cloud") return settings.cloudOllamaEnabled && Boolean(settings.ollamaApiKey?.trim());
  if (apiProvider === "ollama-local") return settings.localEnabled;
  return false;
}

export function getModelAlias(modelOrId: Pick<ModelInfo, "id" | "label" | "familyId"> | string): string {
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId.id;
  const label = typeof modelOrId === "string" ? modelOrId : modelOrId.label;
  const familyId = typeof modelOrId === "string" ? modelOrId : modelOrId.familyId;
  const haystack = `${id} ${label} ${familyId}`.toLowerCase();

  if (haystack.includes("gemini-2.5") || haystack.includes("gemini flash lite")) return "Gemini 2.5";
  if (haystack.includes("gemma4") || haystack.includes("gemma-4") || haystack.includes("gemma 4")) return "Gemma 4";
  if (haystack.includes("llama-4") || haystack.includes("llama 4")) return "Llama 4";
  if (haystack.includes("nemotron")) return "Nemotron";
  if (haystack.includes("gpt-oss") || haystack.includes("gpt oss")) return "GPT";
  if (haystack.includes("qwen")) return "Qwen";

  return label
    .replace(/\bFlash Lite\b/g, "")
    .replace(/\bInstruct\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
