// Verifies the SSRF guard blocks internal targets in production mode while
// still allowing a user's own local Ollama in development.
// Usage: node --import tsx scripts/check-ssrf.mjs
const ATTACKS = [
  "http://169.254.169.254/latest/meta-data/", // cloud metadata
  "http://127.0.0.1:11434/api/tags",
  "http://localhost:11434/api/tags",
  "http://10.0.0.5:8080/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://[::1]:11434/",
  "http://0.0.0.0:8080/",
  "http://user:pass@example.com/", // embedded credentials
  "file:///etc/passwd",
  "gopher://127.0.0.1:11211/",
];
const ALLOWED = ["https://api.groq.com/openai/v1", "https://ollama.com", "https://opencode.ai/zen/v1"];

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) {
    failures += 1;
    console.log(`   FAIL  ${label} ${detail}`);
  }
};

async function load(nodeEnv, allowPrivate) {
  process.env.NODE_ENV = nodeEnv;
  if (allowPrivate === undefined) delete process.env.ALLOW_PRIVATE_NETWORK_UPSTREAM;
  else process.env.ALLOW_PRIVATE_NETWORK_UPSTREAM = allowPrivate;
  // Bust the module cache so privateNetworkAllowed() re-reads env.
  const mod = await import(`../src/lib/ssrf.ts?v=${nodeEnv}-${allowPrivate}-${Date.now()}`);
  return mod.assertSafeUpstreamUrl;
}

console.log("=== production: internal targets must be BLOCKED ===");
let assertSafe = await load("production", undefined);
for (const url of ATTACKS) {
  let blocked = false;
  let msg = "";
  try {
    await assertSafe(url);
  } catch (e) {
    blocked = true;
    msg = e.message;
  }
  console.log(`${blocked ? "BLOCKED" : "ALLOWED"}  ${url}${blocked ? `  (${msg.slice(0, 60)})` : ""}`);
  check(`must block ${url}`, blocked);
}

console.log("\n=== production: real provider endpoints must still work ===");
for (const url of ALLOWED) {
  let ok = true;
  let msg = "";
  try {
    await assertSafe(url);
  } catch (e) {
    ok = false;
    msg = e.message;
  }
  console.log(`${ok ? "ALLOWED" : "BLOCKED"}  ${url}${ok ? "" : `  (${msg})`}`);
  check(`must allow ${url}`, ok, msg);
}

console.log("\n=== development: local Ollama must still work ===");
assertSafe = await load("development", undefined);
for (const url of ["http://127.0.0.1:11434", "http://localhost:11434"]) {
  let ok = true;
  try {
    await assertSafe(url);
  } catch {
    ok = false;
  }
  console.log(`${ok ? "ALLOWED" : "BLOCKED"}  ${url}`);
  check(`dev must allow ${url}`, ok);
}

console.log("\n=== production + explicit opt-in: local Ollama must work ===");
assertSafe = await load("production", "true");
let optInOk = true;
try {
  await assertSafe("http://127.0.0.1:11434");
} catch {
  optInOk = false;
}
console.log(`${optInOk ? "ALLOWED" : "BLOCKED"}  http://127.0.0.1:11434 (ALLOW_PRIVATE_NETWORK_UPSTREAM=true)`);
check("opt-in must allow loopback", optInOk);

console.log(failures === 0 ? "\nAll SSRF checks passed." : `\n${failures} SSRF check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
