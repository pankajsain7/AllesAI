// End-to-end chat checks against a running dev server:
//   1. streaming works per provider
//   2. prior turns are actually carried into the next request
//   3. history growth is bounded (or flagged if not)
// Usage: npm run dev, then node scripts/check-chat.mjs
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}
const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) {
    failures += 1;
    console.log(`   FAIL  ${label} ${detail}`);
  }
};

const keys = {
  apiKey: env.GROQ_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
  opencodeApiKey: env.OpenCode_API_Key,
  ollamaApiKey: env.OLLAMA_API_KEY,
};

async function chat(model, messages) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...keys }),
  });
  if (!res.ok || !res.body) {
    return { ok: false, status: res.status, text: (await res.text()).slice(0, 160), s: (Date.now() - t0) / 1000 };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let firstToken = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        const delta = evt.text ?? evt.delta ?? (evt.type === "delta" ? evt.text : "");
        if (delta) {
          if (firstToken === null) firstToken = (Date.now() - t0) / 1000;
          text += delta;
        }
      } catch {
        /* non-JSON frame */
      }
    }
  }
  return { ok: text.trim().length > 0, status: 200, text, firstToken, s: (Date.now() - t0) / 1000 };
}

const MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "gemini-3.5-flash",
  "ollama-cloud/gemma4:31b",
  "opencode/laguna-s-2.1-free",
];

console.log("=== 1. Single-turn streaming per provider ===");
for (const model of MODELS) {
  const r = await chat(model, [{ role: "user", content: "Reply with exactly: ok" }]);
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${model.padEnd(30)} ${String(r.status).padEnd(4)} ` +
      `first=${r.firstToken != null ? r.firstToken.toFixed(1) + "s" : "-"} total=${r.s.toFixed(1)}s  ` +
      `${(r.text ?? "").replace(/\s+/g, " ").slice(0, 50)}`
  );
  check(`${model} single turn`, r.ok, r.text ?? "");
}

console.log("\n=== 2. Multi-turn: is prior context actually sent? ===");
// Turn 2 includes turn 1's exchange. A model that receives history can answer;
// one that does not will have no idea what the number was.
for (const model of MODELS) {
  const history = [
    { role: "user", content: "My favourite number is 73 and my dog is called Pixel. Acknowledge briefly." },
    { role: "assistant", content: "Got it — your favourite number is 73 and your dog is called Pixel." },
    { role: "user", content: "What is my favourite number and what is my dog called? Answer in one short sentence." },
  ];
  const r = await chat(model, history);
  const recalled = /73/.test(r.text ?? "") && /pixel/i.test(r.text ?? "");
  console.log(
    `${recalled ? "PASS" : "FAIL"}  ${model.padEnd(30)} ${(r.text ?? "").replace(/\s+/g, " ").slice(0, 80)}`
  );
  check(`${model} carries prior turns`, recalled, (r.text ?? "").slice(0, 80));
}

console.log("\n=== 3. Long-history behaviour (10 prior turns) ===");
const longHistory = [];
for (let i = 1; i <= 10; i += 1) {
  longHistory.push({ role: "user", content: `Fact ${i}: the code word for item ${i} is ALPHA${i}.` });
  longHistory.push({ role: "assistant", content: `Noted, item ${i} is ALPHA${i}.` });
}
longHistory.push({ role: "user", content: "What is the code word for item 3? Reply with just the code word." });
for (const model of MODELS.slice(0, 3)) {
  const r = await chat(model, longHistory);
  const ok = /ALPHA3/i.test(r.text ?? "");
  console.log(`${ok ? "PASS" : "FAIL"}  ${model.padEnd(30)} ${(r.text ?? "").replace(/\s+/g, " ").slice(0, 60)}`);
  check(`${model} recalls fact from 10 turns back`, ok);
}

console.log(failures === 0 ? "\nAll chat checks passed." : `\n${failures} chat check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
