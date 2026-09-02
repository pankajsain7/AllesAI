// Effort tiers for consensus and council.
//
// This module is the SINGLE source of truth shared by the client (settings UI,
// ConsensusButton, planner) and the server (api/consensus/route.ts). Changing a
// number here changes the pipeline on both sides, so the UI can never promise
// an effort level the server does not actually run.
//
// Consensus and council are tuned independently: consensus is one expert model
// reading every answer, so its levers are how many independent judges pre-score
// the answers and how much of each answer the synthesizer gets to read. Council
// is a live debate, so its levers are how many models argue, for how many
// rounds, and how many judges rule on it.

export type EffortLevel = "default" | "pro" | "ultra";

export const EFFORT_LEVELS: EffortLevel[] = ["default", "pro", "ultra"];

/** Debate rounds, in the order they run. "synthesis" is the verdict, not a round. */
export type CouncilDebateRoundId =
  | "opening"
  | "critique"
  | "rebuttal"
  | "convergence"
  | "closing";

export const COUNCIL_ROUND_TITLES: Record<CouncilDebateRoundId, string> = {
  opening: "Opening",
  critique: "Critique",
  rebuttal: "Rebuttal",
  convergence: "Convergence",
  closing: "Closing",
};

export type ConsensusEffortConfig = {
  level: EffortLevel;
  label: string;
  /** One-line description shown next to the selector. */
  summary: string;
  /** Independent models that score every answer before synthesis. 0 = the
   *  synthesizer silently judges the answers itself in the same pass. */
  judges: number;
  /** Characters of model answers the synthesizer is allowed to read. */
  contextBudget: number;
  /** Smallest eligible model pool that can actually run this level. Default is
   *  always 1: it is the floor tier and must stay selectable, degrading to
   *  whatever models exist rather than becoming unavailable. */
  minModels: number;
  /** Bullet points for the info popover. */
  details: string[];
};

export type CouncilEffortConfig = {
  level: EffortLevel;
  label: string;
  summary: string;
  /** Models that argue head-to-head. */
  debaters: number;
  /** Debate rounds, in order. */
  rounds: CouncilDebateRoundId[];
  /** Models that score the debate; the first also writes the verdict. */
  judges: number;
  /** Debate notes each debater is shown per turn. */
  historyCap: number;
  minModels: number;
  details: string[];
};

// "default" reproduces the pipeline exactly as it shipped, so upgrading the app
// never silently changes cost or latency for an existing user.
export const CONSENSUS_EFFORT: Record<EffortLevel, ConsensusEffortConfig> = {
  default: {
    level: "default",
    label: "Default",
    summary: "One expert model judges and writes the answer in a single pass.",
    judges: 0,
    contextBudget: 280_000,
    minModels: 1,
    details: [
      "1 model total — it silently scores every answer, then synthesizes.",
      "No separate judging call, so this is the fastest and cheapest option.",
      "Reads up to ~280k characters of model answers.",
    ],
  },
  pro: {
    level: "pro",
    label: "Pro",
    summary: "A separate judge scores every answer first, then a synthesizer writes it.",
    judges: 1,
    contextBudget: 400_000,
    minModels: 2,
    details: [
      "2 models total — 1 independent judge, then 1 synthesizer.",
      "The synthesizer receives the judge's scorecard, so weak answers carry less weight.",
      "Reads up to ~400k characters of model answers.",
      "Roughly one extra model call versus Default.",
    ],
  },
  ultra: {
    level: "ultra",
    label: "Ultra",
    summary: "Two judges score independently and their verdicts are merged before synthesis.",
    judges: 2,
    contextBudget: 600_000,
    minModels: 3,
    details: [
      "3 models total — 2 independent judges (scores averaged, winner by majority), then 1 synthesizer.",
      "Disagreement between judges lowers the reported confidence, so the score is more honest.",
      "Reads up to ~600k characters of model answers.",
      "Roughly two extra model calls versus Default; judges run in parallel.",
    ],
  },
};

export const COUNCIL_EFFORT: Record<EffortLevel, CouncilEffortConfig> = {
  default: {
    level: "default",
    label: "Default",
    summary: "Two models debate for three rounds, then two judges rule.",
    debaters: 2,
    rounds: ["opening", "critique", "convergence"],
    judges: 2,
    historyCap: 6,
    minModels: 1,
    details: [
      "2 debaters × 3 rounds (Opening, Critique, Convergence) + 2 judges.",
      "About 8 model calls.",
      "Each debater sees the last 6 debate notes.",
      "Runs with whatever models you have — roles are reused when the pool is small.",
    ],
  },
  pro: {
    level: "pro",
    label: "Pro",
    summary: "Three models debate for four rounds, then three judges rule.",
    debaters: 3,
    rounds: ["opening", "critique", "rebuttal", "convergence"],
    judges: 3,
    historyCap: 10,
    minModels: 6,
    details: [
      "3 debaters × 4 rounds (adds Rebuttal, where each model defends against the critique) + 3 judges.",
      "About 16 model calls, so expect noticeably longer runs.",
      "A third voice breaks the two-model deadlock when neither concedes.",
      "Each debater sees the last 10 debate notes.",
    ],
  },
  ultra: {
    level: "ultra",
    label: "Ultra",
    summary: "Four models debate for five rounds, then three judges rule.",
    debaters: 4,
    rounds: ["opening", "critique", "rebuttal", "convergence", "closing"],
    judges: 3,
    historyCap: 14,
    minModels: 7,
    details: [
      "4 debaters × 5 rounds (adds Rebuttal and Closing) + 3 judges.",
      "About 24 model calls — this is by far the slowest and most expensive option.",
      "Closing forces each model to commit to a final position the judges rule on.",
      "Each debater sees the last 14 debate notes.",
    ],
  },
};

/**
 * Highest level the given pool of eligible models can actually run.
 *
 * Levels are gated on real capacity rather than hidden in the UI: a user who
 * picks Ultra and later loses a provider key still gets a working run at the
 * best level their remaining models support, instead of a hard failure.
 */
export function maxAffordableLevel(
  table: Record<EffortLevel, { minModels: number }>,
  poolSize: number
): EffortLevel {
  let best: EffortLevel = "default";
  for (const level of EFFORT_LEVELS) {
    if (poolSize >= table[level].minModels) best = level;
  }
  return best;
}

/** Clamps a requested level down to what the pool supports. */
export function resolveEffortLevel(
  table: Record<EffortLevel, { minModels: number }>,
  requested: EffortLevel | undefined,
  poolSize: number
): EffortLevel {
  const wanted: EffortLevel = requested && table[requested] ? requested : "default";
  const affordable = maxAffordableLevel(table, poolSize);
  return EFFORT_LEVELS.indexOf(wanted) <= EFFORT_LEVELS.indexOf(affordable) ? wanted : affordable;
}

export function consensusEffortConfig(
  requested: EffortLevel | undefined,
  poolSize: number
): ConsensusEffortConfig {
  return CONSENSUS_EFFORT[resolveEffortLevel(CONSENSUS_EFFORT, requested, poolSize)];
}

export function councilEffortConfig(
  requested: EffortLevel | undefined,
  poolSize: number
): CouncilEffortConfig {
  return COUNCIL_EFFORT[resolveEffortLevel(COUNCIL_EFFORT, requested, poolSize)];
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return value === "default" || value === "pro" || value === "ultra";
}
