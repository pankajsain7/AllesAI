// Reproduces the exact "select a new Bedrock model" interaction and confirms
// it no longer wipes out other selected Bedrock models.
// Usage: node --import tsx scripts/check-bedrock-selection.mjs
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

const { useChat } = await import("../src/lib/store.ts");

const convId = useChat.getState().newConversation();
// Matches the default hero selection.
useChat.getState().setSelectedModels(convId, [
  "bedrock/zai.glm-5",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "bedrock/deepseek.v3.2",
]);

console.log("=== Selecting a new Bedrock model (ModelPicker's setFamilyRoute) ===\n");
// Reproduces ModelPicker.setFamilyRoute exactly: keep everything not in the
// target family, then append the newly picked route.
function setFamilyRoute(selectedModels, familyId, routeId) {
  const { getModelFamilyId } = require("../src/lib/models.ts");
  const next = [];
  let handled = false;
  for (const id of selectedModels) {
    if (getModelFamilyId(id) !== familyId) {
      next.push(id);
      continue;
    }
    if (!handled && routeId) next.push(routeId);
    handled = true;
  }
  if (!handled && routeId) next.push(routeId);
  return next;
}

const { getModelFamilyId } = await import("../src/lib/models.ts");
const before = useChat.getState().conversations[convId].selectedModels;
const kimiId = "bedrock/moonshotai.kimi-k2.5";
const next = [];
let handled = false;
for (const id of before) {
  if (getModelFamilyId(id) !== getModelFamilyId(kimiId)) {
    next.push(id);
    continue;
  }
  if (!handled) next.push(kimiId);
  handled = true;
}
if (!handled) next.push(kimiId);

useChat.getState().setSelectedModels(convId, next);
const after = useChat.getState().conversations[convId].selectedModels;

console.log("   before:", before);
console.log("   after :", after);

check("still has GLM 5", after.includes("bedrock/zai.glm-5"));
check("still has DeepSeek V3.2", after.includes("bedrock/deepseek.v3.2"));
check("still has the Groq models", after.includes("openai/gpt-oss-120b") && after.includes("qwen/qwen3.8-27b"));
check("newly picked Kimi K2.5 was added", after.includes(kimiId));
check("ends up with 5 selected models, not 2", after.length === 5, `got ${after.length}`);

console.log(failures === 0 ? "\nAll Bedrock selection checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
