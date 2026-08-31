// Verifies enhancePrompt and pickBestModels/callModelOnce forward the
// client-entered Bedrock/OpenCode keys, simulating a deployed site with NO
// server-side env vars — only a Settings-entered key should make it work.
// Usage: node --import tsx scripts/check-client-key-forwarding.mjs
const memory = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  },
});
globalThis.window ??= { localStorage: globalThis.localStorage, addEventListener() {} };

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures += 1;
};

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const fs = await import("node:fs");
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim();
}

// Intercept fetch to assert the request body carries the client key, without
// needing a real deployed instance with env vars stripped.
const realFetch = globalThis.fetch;
let lastBody = null;
globalThis.fetch = async (url, opts) => {
  if (typeof url === "string" && url.includes("/api/chat") && opts?.body) {
    lastBody = JSON.parse(opts.body);
  }
  return realFetch(url, opts);
};

const { useSettings } = await import("../src/lib/store.ts");
useSettings.getState().setBedrockApiKey(env.AWS_Bedrock_API_Key);
useSettings.getState().setOpencodeApiKey(env.OpenCode_API_Key);

const { enhancePrompt, pickBestModels } = await import("../src/lib/chat-client.ts");

console.log("=== enhancePrompt forwards the client Bedrock/OpenCode key ===\n");
try {
  await enhancePrompt("bedrock/zai.glm-4.7-flash", "make this better: hi");
} catch (e) {
  console.log("   (network result ignored, only checking the outgoing body):", e.message.slice(0, 60));
}
check("request body included bedrockApiKey", lastBody?.bedrockApiKey === env.AWS_Bedrock_API_Key);
check("request body included opencodeApiKey", lastBody?.opencodeApiKey === env.OpenCode_API_Key);

console.log("\n=== pickBestModels' router call (callModelOnce) forwards the key ===\n");
lastBody = null;
try {
  await pickBestModels("what is 2+2", 1);
} catch (e) {
  console.log("   (ignored):", e.message.slice(0, 60));
}
check("router call included bedrockApiKey", lastBody?.bedrockApiKey === env.AWS_Bedrock_API_Key, JSON.stringify(lastBody));

globalThis.fetch = realFetch;
console.log(failures === 0 ? "\nAll key-forwarding checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
