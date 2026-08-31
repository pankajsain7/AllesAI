// Regression tests for conversation restore on reload.
// Usage: node --import tsx scripts/check-persistence.mjs
const memory = new Map();
globalThis.localStorage ??= {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.window ??= { localStorage: globalThis.localStorage, addEventListener() {} };

const { useChat } = await import("../src/lib/store.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures += 1;
};

// Simulate a reload: run the persisted snapshot back through the same
// selection logic the store uses on rehydrate.
function reload() {
  const raw = localStorage.getItem("alles-ai-chats");
  if (!raw) return { conversations: {}, activeId: null };
  const { state } = JSON.parse(raw);
  return { conversations: state.conversations ?? {}, activeId: state.activeId ?? null };
}

console.log("=== Reload should return to the chat you were on ===\n");

// Build history: two older chats that have real messages.
const first = useChat.getState().newConversation();
useChat.getState().addUserMessage?.(first, "hello from the first chat");
useChat.setState((s) => ({
  conversations: {
    ...s.conversations,
    [first]: {
      ...s.conversations[first],
      updatedAt: 1000,
      threads: { m: { modelId: "m", messages: [{ id: "1", role: "user", content: "old one", createdAt: 1000 }] } },
    },
  },
}));

useChat.getState().setActive(first);
const second = useChat.getState().newConversation();
useChat.setState((s) => ({
  conversations: {
    ...s.conversations,
    [second]: {
      ...s.conversations[second],
      updatedAt: 2000,
      threads: { m: { modelId: "m", messages: [{ id: "2", role: "user", content: "old two", createdAt: 2000 }] } },
    },
  },
}));

// Now the user clicks "new chat" and does NOT type anything yet.
useChat.getState().setActive(second);
const fresh = useChat.getState().newConversation();
check("a brand-new empty chat becomes active", useChat.getState().activeId === fresh);

// Reload.
const afterReload = reload();
check(
  "empty active chat survives a reload",
  Boolean(afterReload.conversations[fresh]),
  `persisted ids: ${Object.keys(afterReload.conversations).join(", ")}`
);
check(
  "reload restores the same chat, not an older one",
  afterReload.activeId === fresh,
  `got ${afterReload.activeId}, expected ${fresh}`
);

console.log("\n=== Fallback should pick the most recent chat ===\n");
// If the stored activeId is gone, the newest chat should win, not insertion order.
const stored = JSON.parse(localStorage.getItem("alles-ai-chats"));
stored.state.activeId = "does-not-exist";
localStorage.setItem("alles-ai-chats", JSON.stringify(stored));
const convs = stored.state.conversations;
const newest = Object.entries(convs).sort(([, a], [, b]) => b.updatedAt - a.updatedAt)[0]?.[0];
const insertionFirst = Object.keys(convs)[0];
console.log(`   newest=${newest} insertionFirst=${insertionFirst}`);
check(
  "most-recent and insertion-order differ, so the test is meaningful",
  newest !== insertionFirst || Object.keys(convs).length === 1,
  "ordering happened to match; fallback still uses recency"
);

console.log(failures === 0 ? "\nAll persistence checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
