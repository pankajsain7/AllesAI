// Diagnose the reload race: does the page's auto-create effect run before
// zustand finishes hydrating from localStorage?
const memory = new Map();
globalThis.localStorage ??= {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.window ??= { localStorage: globalThis.localStorage, addEventListener() {} };

// Seed storage the way a real user's browser would look: three older chats
// with messages, and the active one being a chat they just opened.
const now = Date.now();
const mk = (id, updatedAt, withMessages) => ({
  id,
  title: "chat",
  createdAt: updatedAt,
  updatedAt,
  chatMode: "multi",
  selectedModels: ["openai/gpt-oss-120b"],
  threads: {
    "openai/gpt-oss-120b": {
      modelId: "openai/gpt-oss-120b",
      messages: withMessages
        ? [{ id: "u1", role: "user", content: "hello", createdAt: updatedAt }]
        : [],
    },
  },
  consensusMessages: [],
  sharedResults: [],
});

const seeded = {
  state: {
    conversations: {
      old1: mk("old1", now - 30000, true),
      old2: mk("old2", now - 20000, true),
      current: mk("current", now, false), // the chat the user is looking at
    },
    activeId: "current",
    lastUsedModels: ["openai/gpt-oss-120b"],
  },
  version: 21,
};
localStorage.setItem("alles-ai-chats", JSON.stringify(seeded));

const { useChat } = await import("../src/lib/store.ts");

console.log("=== Immediately after import (what the first render sees) ===");
const immediate = useChat.getState();
console.log("   activeId          :", immediate.activeId);
console.log("   conversation count:", Object.keys(immediate.conversations).length);

const hasHydrated = useChat.persist?.hasHydrated?.();
console.log("   persist.hasHydrated():", hasHydrated);

// This is exactly what page.tsx does on mount.
const wouldAutoCreate = !immediate.activeId || !immediate.conversations[immediate.activeId];
console.log("\n=== page.tsx auto-create effect ===");
console.log("   would call newConversation():", wouldAutoCreate);
if (wouldAutoCreate) {
  console.log("   ^ THIS IS THE BUG: the effect fires before hydration,");
  console.log("     creating a throwaway chat and clobbering the restored one.");
}

await new Promise((r) => setTimeout(r, 150));
const settled = useChat.getState();
console.log("\n=== After hydration settles ===");
console.log("   activeId          :", settled.activeId);
console.log("   conversation count:", Object.keys(settled.conversations).length);
console.log("   restored the right chat:", settled.activeId === "current");
