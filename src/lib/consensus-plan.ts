import {
  canUseModelForConsensus,
  getConsensusRosterEntry,
  hasProviderAccessForConsensus,
} from "./model-rules";
import type { ModelInfo } from "./models";
import { API_PROVIDERS, type ApiProviderKey } from "./providers";
import { getEnabledRoutes } from "./store";

type PlanSettings = Parameters<typeof getEnabledRoutes>[0] &
  Parameters<typeof hasProviderAccessForConsensus>[1];

export type ProviderReadiness = {
  provider: ApiProviderKey;
  name: string;
  /** Provider toggle is on in Settings. */
  enabled: boolean;
  /** A credential is present (always true for local Ollama, which needs none). */
  hasKey: boolean;
  /** Enabled + credentialed, so its models may be used. */
  ready: boolean;
  /** How many consensus-eligible models this provider currently contributes. */
  eligibleModels: number;
};

export type PlannedModel = {
  id: string;
  model: ModelInfo;
  provider: ApiProviderKey;
  /** "primary" / "backup" for verified models, undefined for user-imported ones. */
  tier: "primary" | "backup" | undefined;
};

export type ConsensusPlan = {
  /** Which providers are usable right now, and why not when they aren't. */
  providers: ProviderReadiness[];
  /** Every eligible model, best first. */
  pool: PlannedModel[];
  /** Consensus mode: the model that reads everything and writes the answer. */
  synthesizer?: string;
  /** Ordered bench the server silently walks if the synthesizer fails. */
  synthesizerBackups: string[];
  /** Council mode: the two head-to-head debaters. */
  debaters: string[];
  /** Council mode: the independent judge panel (never a debater when avoidable). */
  judges: string[];
  /** Ordered bench used to replace any failed debater or judge. */
  councilBackups: string[];
  /** Human-readable reasons consensus/council cannot run, if any. */
  blockers: string[];
};

const PROVIDER_ORDER: ApiProviderKey[] = ["gemini", "groq", "ollama-cloud", "opencode", "ollama-local"];

function tierScore(tier: PlannedModel["tier"]): number {
  if (tier === "primary") return 0;
  if (tier === "backup") return 1;
  return 2; // user-imported / unverified — usable, but never preferred
}

/**
 * Interleaves models so consecutive picks come from different providers. A
 * provider-wide failure (revoked key, org rate limit, outage) then cannot wipe
 * out the whole bench in one go, and council debaters get genuinely different
 * viewpoints instead of two models from the same vendor.
 */
function diversify(models: PlannedModel[]): PlannedModel[] {
  const byProvider = new Map<ApiProviderKey, PlannedModel[]>();
  for (const model of models) {
    const bucket = byProvider.get(model.provider);
    if (bucket) bucket.push(model);
    else byProvider.set(model.provider, [model]);
  }
  const queues = [...byProvider.values()];
  const out: PlannedModel[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}

/**
 * Builds the full consensus/council run plan from current settings.
 *
 * Workflow:
 *  1. Read which provider keys are present and which providers are enabled.
 *  2. Collect every model those providers expose that is eligible for consensus.
 *  3. Rank them: verified primaries first, then backups, then imported models.
 *  4. Assign roles — synthesizer (largest context), debaters and judges
 *     (provider-diverse, judges kept off the debate floor).
 *  5. Put everything left over on a provider-diverse backup bench that the
 *     server walks whenever a model errors, stalls, or returns nothing.
 */
export function planConsensusRun(settings: PlanSettings): ConsensusPlan {
  const providers: ProviderReadiness[] = PROVIDER_ORDER.map((provider) => {
    const enabled =
      provider === "groq"
        ? settings.groqEnabled
        : provider === "gemini"
          ? settings.geminiEnabled
          : provider === "opencode"
            ? settings.opencodeEnabled
            : provider === "ollama-cloud"
              ? settings.cloudOllamaEnabled
              : settings.localEnabled;
    const hasKey =
      provider === "groq"
        ? Boolean(settings.apiKey?.trim())
        : provider === "gemini"
          ? Boolean(settings.geminiApiKey?.trim())
          : provider === "opencode"
            ? Boolean(settings.opencodeApiKey?.trim())
            : provider === "ollama-cloud"
              ? Boolean(settings.ollamaApiKey?.trim())
              : true; // local Ollama needs no credential
    return {
      provider,
      name: API_PROVIDERS[provider]?.name ?? provider,
      enabled,
      hasKey,
      ready: hasProviderAccessForConsensus(provider, settings),
      eligibleModels: 0,
    };
  });

  const seen = new Set<string>();
  const pool: PlannedModel[] = [];
  for (const model of getEnabledRoutes(settings)) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    if (!canUseModelForConsensus(model)) continue;
    if (!hasProviderAccessForConsensus(model.apiProvider, settings)) continue;
    pool.push({
      id: model.id,
      model,
      provider: model.apiProvider,
      tier: getConsensusRosterEntry(model.id)?.tier,
    });
  }

  for (const entry of providers) {
    entry.eligibleModels = pool.filter((m) => m.provider === entry.provider).length;
  }

  // Ranked best-first: verified tier, then measured latency, then context size.
  const ranked = [...pool].sort((a, b) => {
    const tierDelta = tierScore(a.tier) - tierScore(b.tier);
    if (tierDelta !== 0) return tierDelta;
    const latencyDelta =
      (getConsensusRosterEntry(a.id)?.latencyS ?? 99) - (getConsensusRosterEntry(b.id)?.latencyS ?? 99);
    if (latencyDelta !== 0) return latencyDelta;
    return b.model.context - a.model.context;
  });

  // The synthesizer reads the entire multi-model transcript, so context window
  // matters more than raw speed for this one role.
  const synthesizerRanked = [...ranked].sort((a, b) => {
    const tierDelta = tierScore(a.tier) - tierScore(b.tier);
    if (tierDelta !== 0) return tierDelta;
    return b.model.context - a.model.context;
  });
  const synthesizer = synthesizerRanked[0]?.id;
  const synthesizerBackups = diversify(synthesizerRanked.filter((m) => m.id !== synthesizer)).map(
    (m) => m.id
  );

  // Two debaters from different providers whenever possible.
  const debaters = diversify(ranked)
    .slice(0, 2)
    .map((m) => m.id);

  // Judges must be independent of the debate floor, so prefer non-debaters.
  const judgePool = diversify(ranked.filter((m) => !debaters.includes(m.id)));
  const judges = (judgePool.length > 0 ? judgePool : diversify(ranked)).slice(0, 2).map((m) => m.id);

  const councilBackups = diversify(
    ranked.filter((m) => !debaters.includes(m.id) && !judges.includes(m.id))
  ).map((m) => m.id);

  const blockers: string[] = [];
  if (pool.length === 0) {
    const enabledNoKey = providers.filter((p) => p.enabled && !p.hasKey);
    // Local Ollama needs no credential, so "has a key" is meaningless for it —
    // don't tell the user they already have one.
    const keyedNotEnabled = providers.filter(
      (p) => !p.enabled && p.hasKey && p.provider !== "ollama-local"
    );
    if (enabledNoKey.length > 0) {
      blockers.push(`Add an API key for ${enabledNoKey.map((p) => p.name).join(", ")} in Settings.`);
    }
    if (keyedNotEnabled.length > 0) {
      blockers.push(`Enable ${keyedNotEnabled.map((p) => p.name).join(", ")} in Settings.`);
    }
    if (blockers.length === 0) {
      blockers.push("No eligible consensus model — add a provider key in Settings.");
    }
  }

  return {
    providers,
    pool: ranked,
    synthesizer,
    synthesizerBackups,
    debaters,
    judges,
    councilBackups,
    blockers,
  };
}
