// Verifies the consensus/council EFFORT tiers (Default / Pro / Ultra):
//   - the shared tier table is internally consistent and monotonic
//   - the planner staffs each tier with the right number of models
//   - a tier is clamped down when the model pool cannot staff it
//   - the settings selector only offers tiers the pool can actually run
//   - the effort choice survives a persisted-settings round trip
//
// Usage: node --import tsx scripts/check-effort.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Minimal browser shims so importing the zustand store works under Node.
const memoryStore = new Map();
globalThis.localStorage ??= {
  getItem: (k) => memoryStore.get(k) ?? null,
  setItem: (k, v) => memoryStore.set(k, String(v)),
  removeItem: (k) => memoryStore.delete(k),
};
globalThis.window ??= { localStorage: globalThis.localStorage, addEventListener() {} };

const { planConsensusRun } = await import("../src/lib/consensus-plan.ts");
const { useSettings } = await import("../src/lib/store.ts");
const {
  CONSENSUS_EFFORT,
  COUNCIL_EFFORT,
  EFFORT_LEVELS,
  COUNCIL_ROUND_TITLES,
  resolveEffortLevel,
  maxAffordableLevel,
} = await import("../src/lib/effort.ts");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(resolve(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
  return { ...env, ...process.env };
}
const env = loadEnv();
const base = useSettings.getState();

const NO_KEYS = {
  apiKey: "",
  groqEnabled: false,
  opencodeApiKey: "",
  opencodeEnabled: false,
  bedrockApiKey: "",
  bedrockEnabled: false,
  ollamaApiKey: "",
  cloudOllamaEnabled: false,
  localEnabled: false,
};
const ALL_KEYS = {
  apiKey: env.GROQ_API_KEY ?? "",
  groqEnabled: true,
  opencodeApiKey: env.OpenCode_API_Key ?? "",
  opencodeEnabled: true,
  bedrockApiKey: env.AWS_Bedrock_API_Key ?? "",
  bedrockEnabled: true,
  ollamaApiKey: env.OLLAMA_API_KEY ?? "",
  cloudOllamaEnabled: true,
};

function settingsWith(overrides) {
  return { ...base, ...NO_KEYS, ...overrides };
}

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : `  ${detail}`}`);
  if (!condition) failures += 1;
}

// ---------------------------------------------------------------------------
console.log("=== 1. Tier table is coherent and monotonic ===\n");

check(
  "consensus Default reproduces the original pipeline (no separate judge)",
  CONSENSUS_EFFORT.default.judges === 0
);
check(
  "council Default reproduces the original pipeline (2 debaters, 3 rounds, 2 judges)",
  COUNCIL_EFFORT.default.debaters === 2 &&
    COUNCIL_EFFORT.default.rounds.length === 3 &&
    COUNCIL_EFFORT.default.judges === 2 &&
    COUNCIL_EFFORT.default.historyCap === 6,
  JSON.stringify({
    debaters: COUNCIL_EFFORT.default.debaters,
    rounds: COUNCIL_EFFORT.default.rounds,
    judges: COUNCIL_EFFORT.default.judges,
    historyCap: COUNCIL_EFFORT.default.historyCap,
  })
);
check(
  "Default is the floor tier for both modes — it must never become unselectable",
  CONSENSUS_EFFORT.default.minModels === 1 && COUNCIL_EFFORT.default.minModels === 1
);

for (let i = 1; i < EFFORT_LEVELS.length; i += 1) {
  const prev = EFFORT_LEVELS[i - 1];
  const cur = EFFORT_LEVELS[i];
  check(
    `consensus ${cur} costs at least as much as ${prev}`,
    CONSENSUS_EFFORT[cur].judges >= CONSENSUS_EFFORT[prev].judges &&
      CONSENSUS_EFFORT[cur].contextBudget >= CONSENSUS_EFFORT[prev].contextBudget &&
      CONSENSUS_EFFORT[cur].minModels > CONSENSUS_EFFORT[prev].minModels
  );
  check(
    `council ${cur} costs at least as much as ${prev}`,
    COUNCIL_EFFORT[cur].debaters >= COUNCIL_EFFORT[prev].debaters &&
      COUNCIL_EFFORT[cur].rounds.length >= COUNCIL_EFFORT[prev].rounds.length &&
      COUNCIL_EFFORT[cur].judges >= COUNCIL_EFFORT[prev].judges &&
      COUNCIL_EFFORT[cur].historyCap >= COUNCIL_EFFORT[prev].historyCap &&
      COUNCIL_EFFORT[cur].minModels > COUNCIL_EFFORT[prev].minModels
  );
  check(
    `council ${cur} rounds extend ${prev} rather than reordering them`,
    COUNCIL_EFFORT[prev].rounds.every((r) => COUNCIL_EFFORT[cur].rounds.includes(r))
  );
}

for (const level of EFFORT_LEVELS) {
  check(
    `council ${level} rounds all have a title`,
    COUNCIL_EFFORT[level].rounds.every((r) => Boolean(COUNCIL_ROUND_TITLES[r])),
    COUNCIL_EFFORT[level].rounds.join(",")
  );
  check(`consensus ${level} has info text`, CONSENSUS_EFFORT[level].details.length > 0);
  check(`council ${level} has info text`, COUNCIL_EFFORT[level].details.length > 0);
}

// Above the floor, minModels must actually cover the roles the tier staffs —
// otherwise the UI unlocks a tier that silently reuses models across roles.
for (const level of EFFORT_LEVELS.filter((l) => l !== "default")) {
  const c = CONSENSUS_EFFORT[level];
  check(
    `consensus ${level} minModels covers 1 synthesizer + ${c.judges} judge(s)`,
    c.minModels >= 1 + c.judges,
    `minModels=${c.minModels}`
  );
  const k = COUNCIL_EFFORT[level];
  check(
    `council ${level} minModels covers ${k.debaters} debaters + ${k.judges} judge(s)`,
    k.minModels >= k.debaters + k.judges,
    `minModels=${k.minModels}`
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Clamping: a tier is never promised without the models ===\n");

for (const [poolSize, wantConsensus, wantCouncil] of [
  [0, "default", "default"],
  [1, "default", "default"],
  [2, "pro", "default"],
  [3, "ultra", "default"],
  [6, "ultra", "pro"],
  [7, "ultra", "ultra"],
  [20, "ultra", "ultra"],
]) {  check(
    `pool of ${poolSize}: max consensus tier is ${wantConsensus}`,
    maxAffordableLevel(CONSENSUS_EFFORT, poolSize) === wantConsensus,
    maxAffordableLevel(CONSENSUS_EFFORT, poolSize)
  );
  check(
    `pool of ${poolSize}: max council tier is ${wantCouncil}`,
    maxAffordableLevel(COUNCIL_EFFORT, poolSize) === wantCouncil,
    maxAffordableLevel(COUNCIL_EFFORT, poolSize)
  );
}

check(
  "requesting ultra with a 1-model pool clamps to default, it does not throw",
  resolveEffortLevel(CONSENSUS_EFFORT, "ultra", 1) === "default"
);
check(
  "requesting an unknown level falls back to default",
  resolveEffortLevel(COUNCIL_EFFORT, "turbo", 99) === "default"
);
check(
  "a requested level below the maximum is respected, not upgraded",
  resolveEffortLevel(COUNCIL_EFFORT, "default", 99) === "default"
);

// ---------------------------------------------------------------------------
console.log("\n=== 3. Planner staffs each tier with the right model counts ===\n");

const fullPlan = planConsensusRun(settingsWith(ALL_KEYS));
const poolSize = fullPlan.pool.length;
console.log(`   eligible pool: ${poolSize} models\n`);
check("the test needs a real pool — add provider keys to .env.local", poolSize >= 3, `pool=${poolSize}`);

for (const level of EFFORT_LEVELS) {
  const plan = planConsensusRun(settingsWith({ ...ALL_KEYS, consensusEffort: level, councilEffort: level }));
  const cfgC = plan.consensusEffort;
  const cfgK = plan.councilEffort;

  console.log(`${level}`);
  console.log(`   consensus : ${cfgC.judges} judge(s) -> ${plan.consensusJudges.join(", ") || "(none)"}`);
  console.log(`   synthesizer: ${plan.synthesizer}`);
  console.log(`   council   : ${cfgK.debaters} debaters x ${cfgK.rounds.length} rounds, ${cfgK.judges} judge(s)`);
  console.log(`   debaters  : ${plan.debaters.join(" vs ")}`);
  console.log(`   judges    : ${plan.judges.join(", ")}`);

  if (poolSize >= CONSENSUS_EFFORT[level].minModels) {
    check(`${level}: consensus tier is honoured`, cfgC.level === level, cfgC.level);
    check(
      `${level}: exactly ${CONSENSUS_EFFORT[level].judges} consensus judge(s) staffed`,
      plan.consensusJudges.length === CONSENSUS_EFFORT[level].judges,
      `got ${plan.consensusJudges.length}`
    );
    check(
      `${level}: consensus judges never include the synthesizer`,
      !plan.consensusJudges.includes(plan.synthesizer),
      plan.synthesizer
    );
    check(
      `${level}: consensus judge list has no duplicates`,
      new Set(plan.consensusJudges).size === plan.consensusJudges.length
    );
  }

  if (poolSize >= COUNCIL_EFFORT[level].minModels) {
    check(`${level}: council tier is honoured`, cfgK.level === level, cfgK.level);
    check(
      `${level}: exactly ${COUNCIL_EFFORT[level].debaters} debaters staffed`,
      plan.debaters.length === COUNCIL_EFFORT[level].debaters,
      `got ${plan.debaters.length}`
    );
    check(
      `${level}: exactly ${COUNCIL_EFFORT[level].judges} council judge(s) staffed`,
      plan.judges.length === COUNCIL_EFFORT[level].judges,
      `got ${plan.judges.length}`
    );
    check(
      `${level}: judges stay off the debate floor`,
      plan.debaters.every((d) => !plan.judges.includes(d)),
      plan.debaters.filter((d) => plan.judges.includes(d)).join(",")
    );
    check(
      `${level}: no model plays two council roles`,
      new Set([...plan.debaters, ...plan.judges]).size === plan.debaters.length + plan.judges.length
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
console.log("=== 4. Selector only offers tiers the pool can run ===\n");

for (const [label, overrides] of [
  ["no keys", {}],
  ["all keys", ALL_KEYS],
]) {
  const plan = planConsensusRun(settingsWith(overrides));
  const size = plan.pool.length;
  for (const opt of plan.consensusEffortOptions) {
    check(
      `${label}: consensus "${opt.level}" availability matches pool (${size} models, needs ${opt.minModels})`,
      opt.available === size >= opt.minModels
    );
  }
  for (const opt of plan.councilEffortOptions) {
    check(
      `${label}: council "${opt.level}" availability matches pool (${size} models, needs ${opt.minModels})`,
      opt.available === size >= opt.minModels
    );
  }
  check(
    `${label}: Default is offered whenever any model exists`,
    size === 0 || (plan.consensusEffortOptions[0].available && plan.councilEffortOptions[0].available)
  );
}

// A stale "ultra" selection with no keys must degrade, and must say so.
const starved = planConsensusRun(settingsWith({ consensusEffort: "ultra", councilEffort: "ultra" }));
check("starved pool clamps consensus to default", starved.consensusEffort.level === "default");
check("starved pool clamps council to default", starved.councilEffort.level === "default");
check("starved pool reports that it clamped consensus", starved.consensusEffortClamped === true);
check("starved pool reports that it clamped council", starved.councilEffortClamped === true);

const healthy = planConsensusRun(settingsWith({ ...ALL_KEYS, consensusEffort: "default", councilEffort: "default" }));
check("an honoured selection is not reported as clamped", healthy.consensusEffortClamped === false);

// ---------------------------------------------------------------------------
console.log("\n=== 5. Effort choice persists across a reload ===\n");

useSettings.getState().setConsensusEffort("ultra");
useSettings.getState().setCouncilEffort("pro");
check("consensus effort is set in memory", useSettings.getState().consensusEffort === "ultra");
check("council effort is set in memory", useSettings.getState().councilEffort === "pro");

const persisted = JSON.parse(localStorage.getItem("alles-ai-settings") ?? "{}");
check(
  "consensus effort is written to storage",
  persisted.state?.consensusEffort === "ultra",
  JSON.stringify(persisted.state?.consensusEffort)
);
check(
  "council effort is written to storage",
  persisted.state?.councilEffort === "pro",
  JSON.stringify(persisted.state?.councilEffort)
);

// An older install that predates the setting must migrate to "default".
localStorage.setItem(
  "alles-ai-settings",
  JSON.stringify({ state: { apiKey: "", groqEnabled: true }, version: 13 })
);
const { useSettings: reloaded } = await import(`../src/lib/store.ts?effort=${Date.now()}`);
await new Promise((r) => setTimeout(r, 20));
check(
  "a pre-effort install migrates to default consensus effort",
  reloaded.getState().consensusEffort === "default",
  reloaded.getState().consensusEffort
);
check(
  "a pre-effort install migrates to default council effort",
  reloaded.getState().councilEffort === "default",
  reloaded.getState().councilEffort
);

console.log(failures === 0 ? "\nAll effort checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
