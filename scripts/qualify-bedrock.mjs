// Bedrock candidate qualification: short latency, streaming first-token, and a
// long-context summarisation test that mimics consensus over 10 model answers.
import { readFileSync, writeFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const KEY = env.AWS_Bedrock_API_Key;
const REGION = "us-east-1";
const short = (v, n = 100) => String(v).replace(/\s+/g, " ").trim().slice(0, n);

const CANDIDATES = [
  // Explicitly requested
  "zai.glm-4.7-flash",
  "moonshotai.kimi-k2.5",
  "deepseek.v3.2",
  "mistral.ministral-3-14b-instruct",
  // Large-context / strong synthesiser candidates
  "zai.glm-4.7",
  "zai.glm-5",
  "qwen.qwen3-235b-a22b-2507-v1:0",
  "qwen.qwen3-next-80b-a3b",
  "mistral.mistral-large-3-675b-instruct",
  "moonshot.kimi-k2-thinking",
  "openai.gpt-oss-120b-1:0",
  "amazon.nova-pro-v1:0",
  "amazon.nova-lite-v1:0",
];

// ~10 model answers of substantial length, like a real consensus payload.
function buildLongPrompt(targetChars) {
  const para =
    "Prime numbers are integers greater than one whose only positive divisors are one and themselves. " +
    "The distribution of primes is governed by the prime number theorem, which states that the number of " +
    "primes below x is asymptotically x divided by the natural logarithm of x. Euclid proved there are " +
    "infinitely many primes by contradiction. Sieve methods such as the Sieve of Eratosthenes enumerate " +
    "them efficiently for small bounds, while probabilistic tests like Miller-Rabin are used for large ones. ";
  const answers = [];
  for (let i = 1; i <= 10; i += 1) {
    let body = "";
    while (body.length < targetChars / 10) body += para;
    answers.push(`--- Model ${i} ---\n${body}\nModel ${i} concludes that 97 is prime.`);
  }
  return (
    "You are synthesising the single best answer from several model answers.\n\n" +
    "User question: Is 97 a prime number, and why?\n\nModel answers:\n" +
    answers.join("\n\n") +
    "\n\nWrite one short paragraph giving the definitive answer. Start your reply with the word SYNTHESIS."
  );
}

async function converse(modelId, text, maxTokens, stream = false) {
  const t0 = Date.now();
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 90_000);
  try {
    const op = stream ? "converse-stream" : "converse";
    const r = await fetch(
      `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(modelId)}/${op}`,
      {
        method: "POST",
        signal: c.signal,
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: [{ text }] }],
          inferenceConfig: { maxTokens },
        }),
      }
    );
    if (r.status !== 200) {
      return { ok: false, status: r.status, s: (Date.now() - t0) / 1000, detail: short(await r.text(), 130) };
    }
    if (!stream) {
      const j = await r.json();
      const content = (j?.output?.message?.content ?? []).map((x) => x.text ?? "").join("").trim();
      return {
        ok: Boolean(content),
        status: 200,
        s: (Date.now() - t0) / 1000,
        detail: short(content, 70) || "empty",
        inputTokens: j?.usage?.inputTokens,
      };
    }
    // Streaming: measure time to first text chunk (event stream is binary-framed).
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let first = null;
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      const s = dec.decode(value, { stream: true });
      if (first === null && /contentBlockDelta|"text"/.test(s)) first = (Date.now() - t0) / 1000;
    }
    return { ok: bytes > 0, status: 200, s: (Date.now() - t0) / 1000, firstToken: first, detail: `${bytes}B` };
  } catch (e) {
    return { ok: false, status: 0, s: (Date.now() - t0) / 1000, detail: e.name };
  } finally {
    clearTimeout(timer);
  }
}

const LONG = buildLongPrompt(80_000);
console.log(`Long-context probe payload: ${LONG.length} chars (~${Math.round(LONG.length / 4)} tokens)\n`);

const rows = [];
for (const model of CANDIDATES) {
  const shortRes = await converse(model, "What is 2+2? Answer briefly.", 64);
  const streamRes = shortRes.ok ? await converse(model, "Write two sentences about prime numbers.", 256, true) : null;
  const longRes = shortRes.ok ? await converse(model, LONG, 400) : null;
  const summarised = Boolean(longRes?.ok && /SYNTHESIS|prime/i.test(longRes.detail));
  rows.push({ model, shortRes, streamRes, longRes, summarised });
  console.log(
    `${shortRes.ok ? "PASS" : "FAIL"} ${model.padEnd(40)} ` +
      `short=${shortRes.s.toFixed(1)}s ` +
      `first=${streamRes?.firstToken != null ? streamRes.firstToken.toFixed(1) + "s" : "-"} ` +
      `long=${longRes ? (longRes.ok ? longRes.s.toFixed(1) + "s ok" : `${longRes.status} ${longRes.detail}`) : "-"} ` +
      `${longRes?.inputTokens ? `inTok=${longRes.inputTokens}` : ""}`
  );
}

writeFileSync("scripts/bedrock-qualified.json", JSON.stringify(rows, null, 2));

console.log("\n=== QUALIFIED (works + handles 80k-char consensus payload) ===");
for (const r of rows.filter((x) => x.summarised).sort((a, b) => (a.streamRes?.firstToken ?? 99) - (b.streamRes?.firstToken ?? 99))) {
  console.log(
    `   firstToken=${(r.streamRes?.firstToken ?? 0).toFixed(1)}s  long=${r.longRes.s.toFixed(1)}s  ${r.model}`
  );
}
console.log("\n=== FAILED LONG CONTEXT ===");
for (const r of rows.filter((x) => x.shortRes.ok && !x.summarised)) {
  console.log(`   ${r.model}: ${r.longRes?.status} ${r.longRes?.detail}`);
}
console.log("\n=== DEAD ===");
for (const r of rows.filter((x) => !x.shortRes.ok)) {
  console.log(`   ${r.model}: ${r.shortRes.status} ${r.shortRes.detail}`);
}
