"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/lib/store";
import {
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2,
} from "lucide-react";
import { SettingsDialog } from "./SettingsDialog";

function dayBucket(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  if (ts >= todayStart) return "Today";
  if (ts >= yesterdayStart) return "Yesterday";
  if (ts >= weekStart) return "Previous 7 days";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function Sidebar() {
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const setActive = useChat((s) => s.setActive);
  const newConversation = useChat((s) => s.newConversation);
  const deleteConversation = useChat((s) => s.deleteConversation);
  const pruneOldData = useChat((s) => s.pruneOldData);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    pruneOldData();
  }, [pruneOldData]);

  const list = useMemo(() => {
    const arr = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query.trim()) return arr;
    const q = query.toLowerCase();
    return arr.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof list>();
    for (const c of list) {
      const k = dayBucket(c.updatedAt);
      const arr = map.get(k) ?? [];
      arr.push(c);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [list]);

  const confirmDelete = (id: string, title: string) => {
    if (window.confirm(`Delete "${title}"? This cannot be undone.`)) {
      deleteConversation(id);
    }
  };

  return (
    <aside
      className={
        "hidden shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-soft)] transition-all duration-200 md:flex " +
        (collapsed ? "w-12" : "w-72")
      }
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 py-3">
          <button
            onClick={() => setCollapsed(false)}
            className="rounded-md p-1.5 text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
          <button
            onClick={() => newConversation()}
            className="rounded-md p-1.5 text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
            title="New chat"
          >
            <MessageSquarePlus size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <img src="/AllesAI.png" alt="Alles AI" className="h-8 w-auto origin-left scale-[2.0] object-contain mix-blend-multiply" />
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCollapsed(true)}
                className="rounded-md p-1.5 text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>

          <div className="px-2 pt-2">
            <button
              onClick={() => newConversation()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition hover:border-[var(--border-strong)]"
            >
              <MessageSquarePlus size={13} /> New chat
            </button>
          </div>

          <div className="px-2 pt-2">
            <div className="relative">
              <Search
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] py-1.5 pl-7 pr-2 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 pt-3">
            {list.length === 0 && (
              <p className="px-2 py-4 text-center text-[11px] text-[var(--fg-subtle)]">
                {query ? "No matches" : "No chats yet"}
              </p>
            )}
            {grouped.map(([bucket, items]) => (
              <div key={bucket} className="mb-3">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                  {bucket}
                </div>
                {items.map((c) => (
                  <div
                    key={c.id}
                    className={
                      "group mb-0.5 flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-elevated)] " +
                      (activeId === c.id ? "bg-[var(--bg-elevated)]" : "")
                    }
                  >
                    <button
                      onClick={() => setActive(c.id)}
                      className="min-w-0 flex-1 truncate text-left text-xs text-[var(--fg)]"
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    <button
                      onClick={() => confirmDelete(c.id, c.title)}
                      className="rounded p-1 text-[var(--fg-subtle)] opacity-0 hover:bg-[var(--bg-soft)] hover:text-[var(--error)] group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--border)] px-3 py-3">
            <SettingsDialog />
          </div>
        </>
      )}
    </aside>
  );
}
