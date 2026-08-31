// Live health check for every model route the app can use.
// Usage: node scripts/check-models.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "..", ".env.local");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    /* no .env.local — fall back to process env */
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const GROQ_KEY = env.GROQ_API_KEY;
const GEMINI_KEY = env.GEMINI_API_KEY;
const OLLAMA_KEY = env.OLLAMA_API_KEY;
const OPENCODE_KEY = env.OpenCode_API_Key || env.OPENCODE_API_KEY;

const TIMEOUT_MS = 45_000;

async function withTimeout(fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenAiCompatible(url, key, model) {
  return withTimeout(async (signal) => {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: 512,
      }),
    });
    const text = await res.text();
    if (res.status !== 200) return { ok: false, status: res.status, detail: shorten(text) };
    let content = "";
    try {
      content = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
    } catch {
      return { ok: false, status: res.status, detail: "unparseable JSON" };
    }
    if (!content.trim()) return { ok: false, status: res.status, detail: "empty content" };
    return { ok: true, status: res.status, detail: shorten(content, 40) };
  });
}

async function probeGemini(model) {
  return withTimeout(async (signal) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word: ok" }] }] }),
    });
    const text = await res.text();
    if (res.status !== 200) return { ok: false, status: res.status, detail: shorten(text) };
    let content = "";
    try {
      const parts = JSON.parse(text)?.candidates?.[0]?.content?.parts ?? [];
      content = parts.map((p) => p.text ?? "").join("");
    } catch {
      return { ok: false, status: res.status, detail: "unparseable JSON" };
    }
    if (!content.trim()) return { ok: false, status: res.status, detail: "empty content" };
    return { ok: true, status: res.status, detail: shorten(content, 40) };
  });
}

async function probeOllamaCloud(model) {
  return withTimeout(async (signal) => {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        stream: false,
      }),
    });
    const text = await res.text();
    if (res.status !== 200) return { ok: false, status: res.status, detail: shorten(text) };
    let content = "";
    try {
      content = JSON.parse(text)?.message?.content ?? "";
    } catch {
      return { ok: false, status: res.status, detail: "unparseable JSON" };
    }
    if (!content.trim()) return { ok: false, status: res.status, detail: "empty content" };
    return { ok: true, status: res.status, detail: shorten(content, 40) };
  });
}

function shorten(value, max = 120) {
  const flat = String(value).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

// Every route the app ships by default. Keep in sync with src/lib/models.ts
// and the CONSENSUS_MODEL_ROSTER in src/lib/model-rules.ts.
const TARGETS = [
  ...["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "qwen/qwen3.6-27b"].map((m) => ({
    provider: "groq",
    model: m,
  })),
  ...["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"].map((m) => ({
    provider: "gemini",
    model: m,
  })),
  ...[
    "big-pickle",
    "mimo-v2.5-free",
    "ling-3.0-flash-fin-free",
    "laguna-s-2.1-free",
    "nemotron-3-ultra-free",
  ].map((m) => ({ provider: "opencode", model: m })),
  ...["gemma4:31b", "nemotron-3-super", "gpt-oss:120b", "gpt-oss:20b", "nemotron-3-nano:30b"].map((m) => ({
    provider: "ollama-cloud",
    model: m,
  })),
];

async function probe(target) {
  const { provider, model } = target;
  try {
    if (provider === "groq") {
      if (!GROQ_KEY) return { ...target, ok: false, detail: "no GROQ_API_KEY" };
      return { ...target, ...(await probeOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", GROQ_KEY, model)) };
    }
    if (provider === "gemini") {
      if (!GEMINI_KEY) return { ...target, ok: false, detail: "no GEMINI_API_KEY" };
      return { ...target, ...(await probeGemini(model)) };
    }
    if (provider === "opencode") {
      if (!OPENCODE_KEY) return { ...target, ok: false, detail: "no OpenCode_API_Key" };
      return { ...target, ...(await probeOpenAiCompatible("https://opencode.ai/zen/v1/chat/completions", OPENCODE_KEY, model)) };
    }
    if (!OLLAMA_KEY) return { ...target, ok: false, detail: "no OLLAMA_API_KEY" };
    return { ...target, ...(await probeOllamaCloud(model)) };
  } catch (err) {
    return { ...target, ok: false, detail: err?.name === "AbortError" ? `timeout >${TIMEOUT_MS}ms` : shorten(err?.message ?? err) };
  }
}

// Transient statuses recover in seconds. The app retries these once before
// falling back, so the health check must too or it reports false deaths.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

async function probeWithRetry(target) {
  let result = await probe(target);
  if (!result.ok && TRANSIENT_STATUSES.has(result.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    const retried = await probe(target);
    result = { ...retried, retried: true };
  }
  return result;
}

const results = [];
// Sequential per provider group, parallel across providers, to avoid rate limits.
const byProvider = new Map();
for (const t of TARGETS) {
  if (!byProvider.has(t.provider)) byProvider.set(t.provider, []);
  byProvider.get(t.provider).push(t);
}

await Promise.all(
  [...byProvider.values()].map(async (group) => {
    for (const target of group) {
      const result = await probeWithRetry(target);
      results.push(result);
      if (!process.argv.includes("--json")) {
        const mark = result.ok ? "PASS" : "FAIL";
        const note = result.retried ? " (after retry)" : "";
        console.log(
          `${mark}  ${result.provider.padEnd(13)} ${result.model.padEnd(32)} ${result.status ?? "-"}  ${result.detail ?? ""}${note}`
        );
      }
    }
  })
);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pass = results.filter((r) => r.ok);
  console.log(`\n${pass.length}/${results.length} routes healthy`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("\nFailing routes:");
    for (const f of failed) console.log(`  - ${f.provider}/${f.model}: ${f.status ?? ""} ${f.detail ?? ""}`);
  }
}
