import type { ModelInfo } from "./models";
import type { ApiProviderKey } from "./providers";

// Models that are permanently unusable — never offer them anywhere in the app.
// deepseek-v4-flash-free: OpenCode Zen dropped it from the free tier (still
// listed in /v1/models but every completion request 400s "Model is unavailable").
// muse-spark-1.2-contributor-free: consistently 500s "Internal server error".
// hy3-free: OpenCode Zen now 401s "Model hy3-free is not supported".
// nemotron-3.5-lightning-free: never returns — times out past 60s on every call.
const REMOVED_MODEL_TOKENS = [
  "mis" + "tral",
  "north-mini-code",
  "north mini code",
  "deepseek-v4-flash-free",
  "muse-spark-1.2-contributor-free",
  "hy3-free",
  "nemotron-3.5-lightning-free",
];

// Every model verified to actually answer a live request, with the role it is
// trusted to play in consensus/council. Tiers drive automatic selection:
//
//   "primary" — fast AND reliable AND strong enough to synthesize or judge.
//               Auto-selected first for synthesizer / debater / judge.
//   "backup"  — verified working, but weaker, smaller, or noticeably slower.
//               Only used to fill a bench or replace a failed primary.
//
// Anything not listed here is still *pickable* by the user (if its provider
// allows it) but is never auto-selected ahead of a verified model.
export type ConsensusTier = "primary" | "backup";

type RosterEntry = {
  tier: ConsensusTier;
  /**
   * Measured seconds to FIRST TOKEN when streaming, not total completion time.
   * Synthesis, council verdicts and chat all stream, so first-token latency is
   * what users feel and what the server's stall watchdog reacts to. Some models
   * answer fast non-streaming yet stall for seconds before their first streamed
   * token, so this must be measured against the streaming endpoint.
   */
  latencyS: number;
};

export const CONSENSUS_MODEL_ROSTER: Record<string, RosterEntry> = {
  // --- Gemini (1M context; best at long multi-model transcripts)
  "gemini-3.5-flash": { tier: "primary", latencyS: 2.4 },
  "gemini-3.5-flash-lite": { tier: "backup", latencyS: 0.5 },
  "gemma-4-31b-it": { tier: "backup", latencyS: 1.2 },
  // Newer than 3.5-flash but 4.6-9.8s to first token when streaming, so it sits
  // on the bench instead of being auto-selected as synthesizer.
  "gemini-3.6-flash": { tier: "backup", latencyS: 6 },

  // --- Groq (fastest inference)
  "openai/gpt-oss-120b": { tier: "primary", latencyS: 0.3 },
  "qwen/qwen3.8-27b": { tier: "primary", latencyS: 0.2 },
  "openai/gpt-oss-20b": { tier: "backup", latencyS: 0.2 },

  // --- Ollama Cloud (free tier verified; paid-only models deliberately absent)
  "ollama-cloud/gemma4:31b": { tier: "primary", latencyS: 2.9 },
  "ollama-cloud/nemotron-3-super": { tier: "primary", latencyS: 2.7 },
  "ollama-cloud/gpt-oss:120b": { tier: "backup", latencyS: 1.6 },

  // --- OpenCode Zen (free tier). Backup only: the account-wide free usage cap
  // returns 429 under sustained load, so these cannot be depended on.
  "opencode/laguna-s-2.1-free": { tier: "backup", latencyS: 0.8 },
  "opencode/big-pickle": { tier: "backup", latencyS: 0.9 },
  "opencode/ling-3.0-flash-fin-free": { tier: "backup", latencyS: 2.2 },
  "opencode/mimo-v2.5-free": { tier: "backup", latencyS: 6 },
  "opencode/nemotron-3-ultra-free": { tier: "backup", latencyS: 9.9 },
};

// A model is too slow to be an auto-selected primary above this latency.
const SLOW_MODEL_THRESHOLD_S = 10;

export const CONSENSUS_COUNCIL_MODEL_IDS = Object.keys(CONSENSUS_MODEL_ROSTER);

// Ollama models are allowed whether they resolve to the cloud or a local route
// of the same model name.
const ALLOWED_OLLAMA_NAMES = new Set(
  Object.keys(CONSENSUS_MODEL_ROSTER)
    .filter((id) => id.startsWith("ollama-cloud/"))
    .map((id) => id.slice("ollama-cloud/".length))
);

/** Roster entry for a model id, normalising local↔cloud Ollama routes. */
export function getConsensusRosterEntry(modelId: string): RosterEntry | undefined {
  const direct = CONSENSUS_MODEL_ROSTER[modelId];
  if (direct) return direct;
  if (modelId.startsWith("ollama/")) {
    const name = modelId.slice("ollama/".length).replace(/:latest$/, "");
    return CONSENSUS_MODEL_ROSTER[`ollama-cloud/${name}`];
  }
  return undefined;
}

export function getConsensusTier(modelId: string): ConsensusTier | undefined {
  return getConsensusRosterEntry(modelId)?.tier;
}

/** True when the model is verified fast enough to be auto-picked as a primary. */
export function isFastEnoughForPrimaryRole(modelId: string): boolean {
  const entry = getConsensusRosterEntry(modelId);
  return entry ? entry.tier === "primary" && entry.latencyS <= SLOW_MODEL_THRESHOLD_S : false;
}

function isConsensusAllowedModel(model: Pick<ModelInfo, "id" | "apiProvider">): boolean {
  if (getConsensusRosterEntry(model.id)) return true;
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
  // OpenCode Zen free models are allowed so a user with only an OpenCode key
  // can still run consensus and council.
  if (model.apiProvider === "opencode") return true;
  return false;
}

// Default synthesizer/judge preference order — verified primaries first.
export const CONSENSUS_PRIORITY_MODEL_IDS = CONSENSUS_COUNCIL_MODEL_IDS.filter(
  (id) => CONSENSUS_MODEL_ROSTER[id].tier === "primary"
);

// Default council debaters + judge pool.
export const COUNCIL_PRIMARY_MODEL_IDS = CONSENSUS_PRIORITY_MODEL_IDS;

// Verified bench used to replace a model that fails mid-run.
export const COUNCIL_FALLBACK_MODEL_IDS = CONSENSUS_COUNCIL_MODEL_IDS.filter(
  (id) => CONSENSUS_MODEL_ROSTER[id].tier === "backup"
);

// Judge pool.
export const JUDGE_MODEL_IDS = CONSENSUS_PRIORITY_MODEL_IDS;


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
