// One-off full provider sweep: enumerate every model each provider exposes,
// test it with a real completion, and classify free / paid / dead.
// Usage: node scripts/audit-all-models.mjs
import { readFileSync, writeFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const GROQ = env.GROQ_API_KEY;
const GEMINI = env.GEMINI_API_KEY;
const OLLAMA = env.OLLAMA_API_KEY;
const OPENCODE = env.OpenCode_API_Key;

const TIMEOUT = 45_000;
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const SKIP = /whisper|tts|audio|guard|embed|moderation|imagen|veo|image|vision-only|rerank|safety|aqa|learnlm/i;

const short = (v, n = 90) => String(v).replace(/\s+/g, " ").trim().slice(0, n);

async function req(url, opts) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

async function probe(provider, model) {
  const t0 = Date.now();
  try {
    let res, content;
    const msg = [{ role: "user", content: "What is 2+2? Answer briefly." }];
    if (provider === "groq" || provider === "opencode") {
      const url =
        provider === "groq"
          ? "https://api.groq.com/openai/v1/chat/completions"
          : "https://opencode.ai/zen/v1/chat/completions";
      const key = provider === "groq" ? GROQ : OPENCODE;
      res = await req(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: msg, max_tokens: 512 }),
      });
      const txt = await res.text();
      if (res.status !== 200) return { status: res.status, s: (Date.now() - t0) / 1000, ok: false, detail: short(txt) };
      content = JSON.parse(txt)?.choices?.[0]?.message?.content ?? "";
    } else if (provider === "gemini") {
      res = await req(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "What is 2+2? Answer briefly." }] }] }) }
      );
      const txt = await res.text();
      if (res.status !== 200) return { status: res.status, s: (Date.now() - t0) / 1000, ok: false, detail: short(txt) };
      content = (JSON.parse(txt)?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    } else {
      res = await req("https://ollama.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA}` },
        body: JSON.stringify({ model, messages: msg, stream: false }),
      });
      const txt = await res.text();
      if (res.status !== 200) return { status: res.status, s: (Date.now() - t0) / 1000, ok: false, detail: short(txt) };
      content = JSON.parse(txt)?.message?.content ?? "";
    }
    const s = (Date.now() - t0) / 1000;
    if (!content.trim()) return { status: 200, s, ok: false, detail: "empty content" };
    return { status: 200, s, ok: true, detail: short(content, 40) };
  } catch (e) {
    return { status: 0, s: (Date.now() - t0) / 1000, ok: false, detail: e.name === "AbortError" ? `timeout>${TIMEOUT / 1000}s` : short(e.message) };
  }
}

async function probeRetry(provider, model) {
  let r = await probe(provider, model);
  if (!r.ok && (TRANSIENT.has(r.status) || r.status === 0)) {
    await new Promise((x) => setTimeout(x, 4000));
    r = { ...(await probe(provider, model)), retried: true };
  }
  return r;
}

async function listModels() {
  const out = {};
  const g = await req("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${GROQ}` } });
  out.groq = (await g.json()).data.map((m) => m.id);
  const ge = await req(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI}`);
  out.gemini = ((await ge.json()).models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  const oc = await req("https://opencode.ai/zen/v1/models", { headers: { Authorization: `Bearer ${OPENCODE}` } });
  out.opencode = ((await oc.json()).data ?? []).map((m) => m.id);
  const ol = await req("https://ollama.com/api/tags", { headers: { Authorization: `Bearer ${OLLAMA}` } });
  const olj = await ol.json();
  out["ollama-cloud"] = (olj.models ?? olj.data ?? []).map((m) => m.name ?? m.model ?? m.id);
  return out;
}

const lists = await listModels();
const results = [];

for (const [provider, models] of Object.entries(lists)) {
  const testable = models.filter((m) => !SKIP.test(m));
  const skipped = models.filter((m) => SKIP.test(m));
  console.log(`\n### ${provider.toUpperCase()} — ${models.length} listed, ${testable.length} testable, ${skipped.length} skipped`);
  if (skipped.length) console.log(`skipped: ${skipped.join(", ")}`);
  for (const model of testable) {
    const r = await probeRetry(provider, model);
    results.push({ provider, model, ...r });
    console.log(
      `${r.ok ? "PASS" : "FAIL"}  ${model.padEnd(38)} ${String(r.status).padEnd(4)} ${r.s.toFixed(1).padStart(5)}s  ${r.detail}${r.retried ? " (retry)" : ""}`
    );
  }
}

writeFileSync("scripts/audit-results.json", JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.ok);
console.log(`\n\n===== SUMMARY: ${ok.length}/${results.length} working =====`);
for (const p of Object.keys(lists)) {
  const w = ok.filter((r) => r.provider === p).sort((a, b) => a.s - b.s);
  console.log(`\n${p} WORKING (${w.length}), fastest first:`);
  for (const r of w) console.log(`   ${r.s.toFixed(1).padStart(5)}s  ${r.model}`);
  const paid = results.filter((r) => r.provider === p && [402, 403].includes(r.status));
  if (paid.length) console.log(`${p} PAID/FORBIDDEN (${paid.length}): ${paid.map((r) => r.model).join(", ")}`);
  const dead = results.filter((r) => r.provider === p && !r.ok && ![402, 403].includes(r.status));
  if (dead.length) console.log(`${p} DEAD (${dead.length}): ${dead.map((r) => `${r.model}[${r.status}]`).join(", ")}`);
}
