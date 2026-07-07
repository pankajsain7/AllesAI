"use client";

import { useEffect, useRef, useState } from "react";
import { useChat, type ChatMode } from "@/lib/store";
import { Check, ChevronDown, Columns3, MessageSquare, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type ModeMeta = {
  id: ChatMode;
  label: string;
  description: string;
  icon: LucideIcon;
};

const MODES: ModeMeta[] = [
  {
    id: "super",
    label: "Super",
    description: "Multiple agents collaborate under the hood for one best answer",
    icon: Zap,
  },
  {
    id: "multi",
    label: "Multi Chat",
    description: "Compare answers from several models side-by-side",
    icon: Columns3,
  },
  {
    id: "single",
    label: "Single Chat",
    description: "Chat with one specific model you choose",
    icon: MessageSquare,
  },
];

export function ModeSelector({
  convId,
  onSelect,
}: {
  convId: string;
  onSelect?: (mode: ChatMode) => void;
}) {
  const conv = useChat((s) => s.conversations[convId]);
  const setChatMode = useChat((s) => s.setChatMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!conv) return null;

  const current = MODES.find((m) => m.id === conv.chatMode) ?? MODES[0];
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Chat mode"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] hover:border-[var(--border-strong)]"
      >
        <CurrentIcon size={14} className="text-[var(--accent)]" />
        <span>{current.label}</span>
        <ChevronDown
          size={13}
          className={"text-[var(--fg-muted)] transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-2xl"
        >
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const active = mode.id === conv.chatMode;
            return (
              <button
                key={mode.id}
                role="option"
                aria-selected={active}
                onClick={() => {
                  setChatMode(convId, mode.id);
                  setOpen(false);
                  onSelect?.(mode.id);
                }}
                className={
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition " +
                  (active ? "bg-[var(--bg-soft)]" : "hover:bg-[var(--bg-soft)]")
                }
              >
                <Icon size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--fg)]">
                    {mode.label}
                    {active && <Check size={13} className="text-[var(--accent)]" />}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--fg-muted)]">
                    {mode.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
