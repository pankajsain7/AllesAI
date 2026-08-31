// Reproduces the reload race: something creates a conversation before zustand
// finishes rehydrating, then the restore lands. The pre-restore chat must
// survive and stay active.
// Usage: node --import tsx scripts/check-hydration-race.mjs
// Node 26 ships its own localStorage that needs --localstorage-file, so
// override it outright rather than falling back to it.
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

// Seed storage with two older chats, as if from a previous session.
const older = {
  state: {
    conversations: {
      oldA: {
        id: "oldA",
        title: "old A",
        createdAt: 1000,
        updatedAt: 1000,
        chatMode: "multi",
        selectedModels: [],
        threads: { m: { modelId: "m", messages: [{ id: "1", role: "user", content: "hi", createdAt: 1000 }] } },
      },
      oldB: {
        id: "oldB",
        title: "old B",
        createdAt: 2000,
        updatedAt: 2000,
        chatMode: "multi",
        selectedModels: [],
        threads: { m: { modelId: "m", messages: [{ id: "2", role: "user", content: "hi", createdAt: 2000 }] } },
      },
    },
    activeId: "oldA",
    lastUsedModels: [],
  },
  version: 21,
};
localStorage.setItem("alles-ai-chats", JSON.stringify(older));

const { useChat, useChatHydrated } = await import("../src/lib/store.ts");

console.log("=== hydration gate ===\n");
check("useChatHydrated is exported", typeof useChatHydrated === "function");
check("persist exposes hasHydrated", typeof useChat.persist?.hasHydrated === "function");
check("persist exposes onFinishHydration", typeof useChat.persist?.onFinishHydration === "function");

// Wait for rehydration to settle.
await new Promise((r) => setTimeout(r, 50));
// hasHydrated only flips after zustand resolves its own restore, so it is not
// asserted here � and deliberately not used to gate rendering.
check(
  "restored the persisted active chat",
  useChat.getState().activeId === "oldA",
  `got ${useChat.getState().activeId}`
);

console.log("\n=== race: a chat created before the restore must survive ===\n");
// Simulate the pre-hydration state: a fresh chat exists in memory only.
const fresh = useChat.getState().newConversation();
useChat.getState().setActive(fresh);
const beforeIds = Object.keys(useChat.getState().conversations);

// Now force the restore to run again, as it would when hydration completes.
await useChat.persist.rehydrate();
const after = useChat.getState();

check(
  "the in-memory chat was not discarded",
  Boolean(after.conversations[fresh]),
  `ids now: ${Object.keys(after.conversations).join(", ")} (was ${beforeIds.join(", ")})`
);
check(
  "it is still the active chat after the restore",
  after.activeId === fresh,
  `got ${after.activeId}, expected ${fresh}`
);
check("older chats are still present", Boolean(after.conversations.oldA && after.conversations.oldB));

console.log(failures === 0 ? "\nAll hydration checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
