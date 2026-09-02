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

const { useChat, useSettings } = await import("../src/lib/store.ts");
useSettings.getState().setBedrockApiKey(env.AWS_Bedrock_API_Key);
useSettings.getState().setOpencodeApiKey(env.OpenCode_API_Key);

const { enhancePrompt, pickBestModels, streamModel } = await import("../src/lib/chat-client.ts");

console.log("=== enhancePrompt forwards the client Bedrock/OpenCode key ===\n");
try {
  await enhancePrompt("bedrock/zai.glm-5", "make this better: hi");
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

console.log("\n=== retries omit failed empty assistant turns ===\n");
const modelId = "bedrock/mistral.mistral-large-3-675b-instruct";
const convId = useChat.getState().newConversation([modelId]);
useChat.getState().addUserMessage(convId, "hi", [modelId]);
for (let attempt = 0; attempt < 2; attempt += 1) {
  const msgId = useChat.getState().startAssistant(convId, modelId);
  useChat.getState().failAssistant(convId, modelId, msgId, "failed");
}
lastBody = null;
await streamModel({ convId, modelId });
check(
  "request body omitted empty assistant messages",
  lastBody?.messages?.filter((message) => message.role === "assistant" && !message.content.trim()).length === 0,
  JSON.stringify(lastBody?.messages)
);

console.log("\n=== multi-chat forwards the client Bedrock key internally ===\n");
let forwardedBody = null;
globalThis.fetch = async (_url, opts) => {
  forwardedBody = JSON.parse(opts.body);
  return new Response('{"type":"done"}\n', {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
};
const { POST: multiChat } = await import("../src/app/api/chat/multi/route.ts");
const multiResponse = await multiChat({
  json: async () => ({
    items: [{ id: modelId, model: modelId, messages: [{ role: "user", content: "hi" }] }],
    bedrockApiKey: env.AWS_Bedrock_API_Key,
  }),
  nextUrl: new URL("http://localhost/api/chat/multi"),
  signal: new AbortController().signal,
});
await multiResponse.text();
check(
  "internal chat request included bedrockApiKey",
  forwardedBody?.bedrockApiKey === env.AWS_Bedrock_API_Key
);

globalThis.fetch = realFetch;
console.log(failures === 0 ? "\nAll key-forwarding checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
