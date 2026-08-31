// Qualify Bedrock (mantle endpoint) models for chat and consensus roles.
// Tests: short latency, streaming first-token, and an ~85k-char payload that
// mimics synthesising 10 long model answers.
// Usage: node scripts/qualify-bedrock.mjs
import { readFileSync, writeFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const KEY = env.AWS_Bedrock_Short_Term_Key || env.AWS_Bedrock_API_Key;
const HOST = "https://bedrock-mantle.us-east-1.api.aws";
const PATH = "/v1/chat/completions";
const short = (v, n = 90) => String(v).replace(/\s+/g, " ").trim().slice(0, n);

const CANDIDATES = [
  // Requested
  "zai.glm-4.7-flash",
  "moonshotai.kimi-k2.5",
  "deepseek.v3.2",
  "mistral.ministral-3-14b-instruct",
  // Strong synthesiser / large-context candidates
  "zai.glm-5",
  "zai.glm-4.7",
  "anthropic.claude-sonnet-5",
  "anthropic.claude-haiku-4-5",
  "qwen.qwen3-235b-a22b-2507",
  "mistral.mistral-large-3-675b-instruct",
  "moonshotai.kimi-k2-thinking",
  "openai.gpt-oss-120b",
  "google.gemma-4-31b",
  "minimax.minimax-m2.5",
  "nvidia.nemotron-super-3-120b",
];

async function chat(model, content, maxTokens, stream = false) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 120_000);
  const t0 = Date.now();
  try {
    const r = await fetch(`${HOST}${PATH}`, {
      method: "POST",
      signal: c.signal,
      headers: { "x-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: maxTokens, stream }),
    });
    if (r.status !== 200) return { ok: false, status: r.status, s: (Date.now() - t0) / 1000, detail: short(await r.text()) };
    if (!stream) {
      const j = JSON.parse(await r.text());
      const text = j?.choices?.[0]?.message?.content ?? "";
      return { ok: Boolean(text.trim()), status: 200, s: (Date.now() - t0) / 1000, detail: short(text, 60), inTok: j?.usage?.prompt_tokens };
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let first = null;
    let text = "";
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const d = JSON.parse(p)?.choices?.[0]?.delta?.content;
          if (d) {
            if (first === null) first = (Date.now() - t0) / 1000;
            text += d;
          }
        } catch { /* partial frame */ }
      }
    }
    return { ok: text.trim().length > 0, status: 200, s: (Date.now() - t0) / 1000, firstToken: first, detail: short(text, 50) };
  } catch (e) {
    return { ok: false, status: 0, s: (Date.now() - t0) / 1000, detail: e.name };
  } finally {
    clearTimeout(timer);
  }
}

function longPrompt(targetChars) {
  const para =
    "Prime numbers are integers greater than one whose only positive divisors are one and themselves. " +
    "The prime number theorem gives their asymptotic density as x over the natural log of x. Euclid proved " +
    "there are infinitely many. Sieve methods enumerate small primes; Miller-Rabin tests large candidates. ";
  const parts = [];
  for (let i = 1; i <= 10; i += 1) {
    let body = "";
    while (body.length < targetChars / 10) body += para;
    parts.push(`--- Model ${i} ---\n${body}\nModel ${i} concludes that 97 is prime.`);
  }
  return `Synthesise the single best answer from these model answers.\n\nQuestion: Is 97 a prime number, and why?\n\n${parts.join("\n\n")}\n\nReply with ONE short paragraph starting with the word SYNTHESIS.`;
}

const LONG = longPrompt(80_000);
console.log(`Consensus payload: ${LONG.length} chars (~${Math.round(LONG.length / 4)} tokens)\n`);

const rows = [];
for (const model of CANDIDATES) {
  const s = await chat(model, "What is 2+2? Answer briefly.", 64);
  if (!s.ok) {
    rows.push({ model, ok: false, detail: `${s.status} ${s.detail}` });
    console.log(`FAIL ${model.padEnd(40)} ${s.status} ${s.detail}`);
    continue;
  }
  const st = await chat(model, "Write two sentences about prime numbers.", 256, true);
  const lg = await chat(model, LONG, 400);
  const digested = lg.ok && /synthesis|prime/i.test(lg.detail);
  rows.push({ model, ok: true, shortS: s.s, firstToken: st.firstToken, streamOk: st.ok, longOk: digested, longS: lg.s, inTok: lg.inTok, longErr: digested ? null : `${lg.status} ${lg.detail}` });
  console.log(
    `${digested ? "PASS" : "WARN"} ${model.padEnd(40)} short=${s.s.toFixed(1)}s ` +
      `first=${st.firstToken != null ? st.firstToken.toFixed(1) + "s" : "-"} ` +
      `long=${lg.status} ${lg.s.toFixed(1)}s ${lg.inTok ? `inTok=${lg.inTok}` : short(lg.detail, 40)}`
  );
}

writeFileSync("scripts/bedrock-qualified.json", JSON.stringify(rows, null, 2));

const qualified = rows.filter((r) => r.ok && r.streamOk && r.longOk).sort((a, b) => (a.firstToken ?? 99) - (b.firstToken ?? 99));
console.log(`\n=== QUALIFIED: streams AND digests 10 long answers (${qualified.length}) ===`);
for (const r of qualified) {
  console.log(`   first=${(r.firstToken ?? 0).toFixed(1).padStart(5)}s  long=${r.longS.toFixed(1).padStart(5)}s  inTok=${String(r.inTok ?? "?").padStart(6)}  ${r.model}`);
}
const failedLong = rows.filter((r) => r.ok && !r.longOk);
if (failedLong.length) {
  console.log("\n=== CANNOT handle the consensus payload ===");
  for (const r of failedLong) console.log(`   ${r.model}: ${r.longErr}`);
}
