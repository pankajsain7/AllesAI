// Verifies the consensus/council planner picks sane roles for every
// combination of provider keys, and that the /api/consensus route survives a
// real single + council run.
//
// Usage:
//   node --import tsx scripts/check-consensus.mjs            # planner only
//   node --import tsx scripts/check-consensus.mjs --live      # + live API run (needs `npm run dev`)
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

function settingsWith(overrides) {
  return { ...base, ...overrides };
}

const KEYS = {
  groq: { apiKey: env.GROQ_API_KEY ?? "", groqEnabled: true },  opencode: { opencodeApiKey: env.OpenCode_API_Key ?? "", opencodeEnabled: true },
  bedrock: { bedrockApiKey: env.AWS_Bedrock_API_Key ?? "", bedrockEnabled: true },
  ollama: { ollamaApiKey: env.OLLAMA_API_KEY ?? "", cloudOllamaEnabled: true },
};
const NO_KEYS = {
  apiKey: "",
  groqEnabled: false,  opencodeApiKey: "",
  opencodeEnabled: false,
  bedrockApiKey: "",
  bedrockEnabled: false,
  ollamaApiKey: "",
  cloudOllamaEnabled: false,
  localEnabled: false,
};

const SCENARIOS = [
  ["no keys at all", {}],
  ["groq only", KEYS.groq],  ["opencode only", KEYS.opencode],
  ["bedrock only", KEYS.bedrock],
  ["ollama cloud only", KEYS.ollama],  ["bedrock + groq", { ...KEYS.bedrock, ...KEYS.groq }],
  ["all providers", { ...KEYS.bedrock, ...KEYS.groq, ...KEYS.opencode, ...KEYS.ollama }],
];

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) {
    failures += 1;
    console.log(`   FAIL  ${label} ${detail}`);
  }
}

console.log("=== Planner: role assignment per API-key combination ===\n");
for (const [label, overrides] of SCENARIOS) {
  const plan = planConsensusRun(settingsWith({ ...NO_KEYS, ...overrides }));
  const ready = plan.providers.filter((p) => p.ready).map((p) => p.name);
  console.log(`${label}`);
  console.log(`   ready providers : ${ready.join(", ") || "(none)"}`);
  console.log(`   pool            : ${plan.pool.length} models`);
  console.log(`   synthesizer     : ${plan.synthesizer ?? "(none)"}`);
  console.log(`   backups         : ${plan.synthesizerBackups.slice(0, 4).join(", ") || "(none)"}`);
  console.log(`   debaters        : ${plan.debaters.join(" vs ") || "(none)"}`);
  console.log(`   judges          : ${plan.judges.join(", ") || "(none)"}`);
  console.log(`   council bench   : ${plan.councilBackups.slice(0, 4).join(", ") || "(none)"}`);
  if (plan.blockers.length) console.log(`   blockers        : ${plan.blockers.join(" | ")}`);

  if (Object.keys(overrides).length === 0) {
    check("no-keys must yield an empty pool", plan.pool.length === 0);
    check("no-keys must explain why", plan.blockers.length > 0);
  } else {
    check(`${label}: pool must be non-empty`, plan.pool.length > 0);
    check(`${label}: must pick a synthesizer`, Boolean(plan.synthesizer));
    check(`${label}: must pick at least one debater`, plan.debaters.length > 0);
    check(`${label}: must pick at least one judge`, plan.judges.length > 0);
    check(`${label}: must have no blockers`, plan.blockers.length === 0, plan.blockers.join(" | "));
    const overlap = plan.debaters.filter((d) => plan.judges.includes(d));
    if (plan.pool.length >= 4) {
      check(`${label}: judges must be independent of debaters`, overlap.length === 0, overlap.join(","));
      const dupes = new Set([...plan.debaters, ...plan.judges, ...plan.councilBackups]);
      check(
        `${label}: no model may appear in two council roles`,
        dupes.size === plan.debaters.length + plan.judges.length + plan.councilBackups.length
      );
    }
  }
  console.log("");
}

// Provider diversity is the whole point of the backup bench.
const allPlan = planConsensusRun(
  settingsWith({ ...NO_KEYS, ...KEYS.bedrock, ...KEYS.groq, ...KEYS.opencode, ...KEYS.ollama })
);
const debaterProviders = new Set(
  allPlan.debaters.map((id) => allPlan.pool.find((m) => m.id === id)?.provider)
);
check("debaters must come from different providers", debaterProviders.size === 2, [...debaterProviders].join(","));
const firstTwoBackupProviders = allPlan.synthesizerBackups
  .slice(0, 2)
  .map((id) => allPlan.pool.find((m) => m.id === id)?.provider);
check(
  "first two synthesizer backups must not share a provider",
  new Set(firstTwoBackupProviders).size === 2,
  firstTwoBackupProviders.join(",")
);

if (process.argv.includes("--live")) {
  console.log("=== Live /api/consensus run ===\n");
  const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
  const payload = {
    prompt: "Is 97 a prime number? Answer in one sentence.",
    responses: [
      { model: "Model A", content: "Yes, 97 is prime." },
      { model: "Model B", content: "No, 97 is divisible by 7." },
    ],
    apiKey: env.GROQ_API_KEY,    opencodeApiKey: env.OpenCode_API_Key,
    bedrockApiKey: env.AWS_Bedrock_API_Key,
    ollamaApiKey: env.OLLAMA_API_KEY,
  };

  for (const mode of ["single", "council"]) {
    const plan = allPlan;
    const body =
      mode === "single"
        ? {
            ...payload,
            mode,
            qualityMode: "deep",
            consensusModel: plan.synthesizer,
            fallbackModels: plan.synthesizerBackups,
            judgeModels: [],
          }
        : {
            ...payload,
            mode,
            qualityMode: "deep",
            consensusModel: plan.synthesizer,
            candidateModels: plan.debaters,
            moderatorModels: plan.judges,
            judgeModels: plan.judges,
            fallbackModels: plan.councilBackups,
          };

    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/consensus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      failures += 1;
      console.log(`   FAIL  ${mode}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    let answer = "";
    const events = new Map();
    let streamError = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        events.set(evt.type, (events.get(evt.type) ?? 0) + 1);
        if (evt.type === "delta" && evt.text) answer += evt.text;
        if (evt.type === "error") streamError = evt.message;
      }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${mode}: ${secs}s, ${answer.length} chars`);
    console.log(`   events: ${[...events].map(([k, v]) => `${k}x${v}`).join(" ")}`);
    console.log(`   answer: ${answer.slice(0, 160).replace(/\s+/g, " ")}\n`);
    check(`${mode}: no stream error`, !streamError, streamError ?? "");
    check(`${mode}: produced an answer`, answer.trim().length > 20);
    if (mode === "council") {
      check("council: ran debate rounds", (events.get("round_start") ?? 0) >= 3);
      check("council: produced debate notes", (events.get("council_note") ?? 0) >= 3);
    }
  }

  // Fault injection: the chosen model is dead. The server must fall through to
  // the backup bench and still deliver an answer instead of erroring out.
  console.log("=== Fault injection: dead primary must fall back ===\n");
  const FAULTS = [
    ["dead synthesizer", "openai/this-model-does-not-exist", allPlan.synthesizerBackups],
    ["dead provider (bad key)", allPlan.synthesizer, allPlan.synthesizerBackups],
  ];
  for (const [label, deadModel, bench] of FAULTS) {
    const faultBody = {
      ...payload,
      mode: "single",
      qualityMode: "deep",
      consensusModel: deadModel,
      fallbackModels: bench,
      judgeModels: [],
      // Second scenario knocks out Bedrock entirely by sending a bad key.
      ...(label.includes("bad key") ? { bedrockApiKey: "invalid-key-for-fault-test" } : {}),
    };
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/consensus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(faultBody),
    });
    let answer = "";
    let streamError = null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "delta" && evt.text) answer += evt.text;
        if (evt.type === "error") streamError = evt.message;
      }
    }
    console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${answer.length} chars recovered`);
    console.log(`   answer: ${answer.slice(0, 120).replace(/\s+/g, " ")}\n`);
    check(`${label}: recovered via backup bench`, answer.trim().length > 20, streamError ?? "");
  }

  // Input validation must reject abusive payloads before any upstream fan-out.
  console.log("=== Input validation: abusive payloads must be rejected ===\n");
  const BAD_PAYLOADS = [
    ["oversized prompt", { ...payload, prompt: "x".repeat(250_000) }],
    ["too many responses", { ...payload, responses: Array.from({ length: 50 }, () => ({ model: "m", content: "c" })) }],
    ["oversized response content", { ...payload, responses: [{ model: "m", content: "x".repeat(500_000) }] }],
    ["too many candidate models", { ...payload, mode: "council", candidateModels: Array.from({ length: 40 }, (_, i) => `m${i}`) }],
    ["too many judge models", { ...payload, judgeModels: Array.from({ length: 40 }, (_, i) => `m${i}`) }],
  ];
  for (const [label, bad] of BAD_PAYLOADS) {
    const res = await fetch(`${BASE}/api/consensus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bad),
    });
    const text = await res.text();
    console.log(`${label}: HTTP ${res.status} — ${text.slice(0, 80)}`);
    check(`${label}: must be rejected with 400`, res.status === 400, `got ${res.status}`);
  }
  console.log("");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
