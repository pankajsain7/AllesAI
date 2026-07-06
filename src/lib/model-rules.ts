import type { ModelInfo } from "./models";
import type { ApiProviderKey } from "./providers";

const REMOVED_MODEL_TOKENS = ["mis" + "tral"];
const CONSENSUS_EXCLUDED_PROVIDERS = new Set<ModelInfo["provider"]>(["qwen"]);
const CONSENSUS_EXCLUDED_FAMILY_IDS = new Set(["gpt-oss-120b"]);

// Consensus works well with a small panel (2-3 answers). This priority list only
// feeds the synthesizer/judge dropdowns — the panel itself comes from the user's
// active columns.
export const CONSENSUS_PRIORITY_MODEL_IDS = [
  "gemini-2.5-flash-lite",
  "ollama-cloud/gemma4:31b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "ollama-cloud/cogito-2.1:671b",
  "ollama-cloud/nemotron-3-super",
] as const;

// A council debates best with a wider bench (4-5 members). Primaries seat the
// table; fallbacks backfill dropouts so the room stays quorate.
export const COUNCIL_PRIMARY_MODEL_IDS = [
  "gemini-2.5-flash-lite",
  "ollama-cloud/gemma4:31b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "ollama-cloud/cogito-2.1:671b",
] as const;

export const COUNCIL_FALLBACK_MODEL_IDS = [
  "ollama-cloud/nemotron-3-super",
  "meta-llama/llama-4-scout-17b-16e-instruct",
] as const;

// A dedicated judge should be an impartial, capable model. Ordered by preference;
// the client prefers a judge that is NOT one of the panel answers being scored.
export const JUDGE_MODEL_IDS = [
  "gemini-2.5-flash-lite",
  "ollama-cloud/cogito-2.1:671b",
  "ollama-cloud/gemma4:31b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
] as const;

// Council participants may include the user's active panel models even when the
// consensus synthesizer excludes them (e.g. qwen / gpt-oss). This is the looser
// gate used only to seat council members.
export function canUseModelForCouncil(model: ModelInfo): boolean {
  return !isRemovedModel(model);
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
  return (
    !isRemovedModel(model) &&
    !CONSENSUS_EXCLUDED_PROVIDERS.has(model.provider) &&
    !CONSENSUS_EXCLUDED_FAMILY_IDS.has(model.familyId)
  );
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
  if (haystack.includes("cogito")) return "Cogito";
  if (haystack.includes("nemotron")) return "Nemotron";
  if (haystack.includes("gpt-oss") || haystack.includes("gpt oss")) return "GPT";
  if (haystack.includes("qwen")) return "Qwen";

  return label
    .replace(/\bFlash Lite\b/g, "")
    .replace(/\bInstruct\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
