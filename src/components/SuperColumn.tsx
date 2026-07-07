"use client";

import { useEffect, useRef } from "react";
import { useChat, useSettings, SUPER_THREAD_ID } from "@/lib/store";
import { abortModel, sendPromptToAll } from "@/lib/chat-client";
import { MessageBubble } from "./ModelColumn";
import { Square } from "lucide-react";
import { getPromptSubmittedAt } from "@/lib/scroll-intent";

const ANSWER_TOP_OFFSET_PX = 2;

// Renders the "super" mode conversation: user turns plus a single synthesized
// best answer. The answer has no model attribution — the multi-agent
// orchestration behind it stays hidden by design.
export function SuperColumn({ convId }: { convId: string }) {
  const conv = useChat((s) => s.conversations[convId]);
  const compact = useSettings((s) => s.compactColumns);
  const thread = conv?.threads[SUPER_THREAD_ID];

  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  const messages = thread?.messages ?? [];
  const isPending = messages.some((m) => m.role === "assistant" && m.pending);
  const latestUserId = [...messages].reverse().find((m) => m.role === "user")?.id ?? null;
  const lastUserIdRef = useRef<string | null>(latestUserId);
  const lastHandledSubmissionAt = useRef<number>(0);

  const getScrollTarget = (container: HTMLElement): HTMLElement | undefined => {
    const userBubbles = container.querySelectorAll("[data-role='user']");
    const lastUser = userBubbles[userBubbles.length - 1] as HTMLElement | undefined;
    if (!lastUser) return undefined;
    const next = lastUser.nextElementSibling as HTMLElement | null;
    if (next && next.getAttribute("data-role") === "assistant") return next;
    return lastUser;
  };

  // Scroll so the answer (not the prompt) starts at the top on each new turn.
  useEffect(() => {
    const latestSubmissionAt = getPromptSubmittedAt(convId);
    const hasFreshSubmission = latestSubmissionAt > lastHandledSubmissionAt.current;
    if (latestUserId === lastUserIdRef.current && !hasFreshSubmission) return;
    lastUserIdRef.current = latestUserId;
    if (hasFreshSubmission) lastHandledSubmissionAt.current = latestSubmissionAt;
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const target = getScrollTarget(container);
      if (!target) return;
      container.scrollTo({
        top: Math.max(0, target.offsetTop - ANSWER_TOP_OFFSET_PX),
        behavior: "smooth",
      });
    });
  }, [convId, latestUserId]);

  // Dynamic spacer so the answer can scroll to the top.
  useEffect(() => {
    const container = scrollRef.current;
    const spacer = spacerRef.current;
    if (!container || !spacer) return;
    const update = () => {
      const target = getScrollTarget(container);
      if (!target) {
        spacer.style.height = "0px";
        return;
      }
      let contentBelow = 0;
      let found = false;
      Array.from(container.children).forEach((child) => {
        if (child === spacer) return;
        if (child === target) found = true;
        if (found) contentBelow += (child as HTMLElement).offsetHeight;
      });
      spacer.style.height = `${Math.max(0, container.clientHeight - contentBelow)}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    const mo = new MutationObserver(update);
    mo.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [thread]);

  if (!conv || !thread) return null;

  const retry = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content) sendPromptToAll(convId, lastUser.content);
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div
        ref={scrollRef}
        className={"relative mx-auto w-full max-w-3xl flex-1 overflow-y-auto " + (compact ? "space-y-2 p-2" : "space-y-3 p-4")}
      >
        {isPending && (
          <div className="sticky top-2 z-10 flex justify-end pr-1">
            <button
              onClick={() => abortModel(convId, SUPER_THREAD_ID)}
              className="rounded-full p-1.5 text-[var(--error)] bg-[var(--bg-elevated)] shadow-sm hover:bg-[var(--bg)] border border-[var(--border)]"
              title="Stop"
            >
              <Square size={13} fill="currentColor" />
            </button>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newTurn = i > 0 && m.role === "user" && prev?.role !== "user";
          return (
            <MessageBubble
              key={m.id}
              msg={m}
              convId={convId}
              modelId={SUPER_THREAD_ID}
              compact={compact}
              newTurn={newTurn}
              onRetry={retry}
            />
          );
        })}
        <div ref={spacerRef} />
      </div>
    </div>
  );
}
