"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useChat, useSettings, type Message } from "@/lib/store";
import { getModel } from "@/lib/models";
import { API_PROVIDERS, PROVIDERS } from "@/lib/providers";
import { Markdown } from "./Markdown";
import { ProviderIcon } from "./ProviderIcon";
import { AlertCircle, Focus, Square, Copy, Check, GripVertical, ChevronDown, ChevronRight, Brain, Globe, RotateCcw } from "lucide-react";
import { abortModel, streamModel } from "@/lib/chat-client";
import { streamDraftKey, useStreamDrafts } from "@/lib/stream-drafts";
import { getPromptSubmittedAt } from "@/lib/scroll-intent";

/** Split out <think>...</think> blocks from raw content. */
function parseThinking(content: string): { thinking: string; answer: string } {
  const thinkParts: string[] = [];
  // Remove every complete <think>...</think> block, wherever it appears.
  let answer = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    thinkParts.push(String(inner).trim());
    return "";
  });
  // Handle a trailing, still-streaming <think> that has no closing tag yet.
  const openIdx = answer.search(/<think>/i);
  if (openIdx !== -1) {
    thinkParts.push(answer.slice(openIdx + "<think>".length).trim());
    answer = answer.slice(0, openIdx);
  }
  return {
    thinking: thinkParts.filter(Boolean).join("\n\n").trim(),
    answer: answer.trim(),
  };
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg)] transition"
      >
        <Brain size={11} className="shrink-0" />
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {open ? "Hide thinking" : "Show thinking"}
      </button>
      {open && (
        <div className="mt-1.5 rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[12px] text-[var(--fg-muted)] italic">
          <Markdown source={text} />
        </div>
      )}
    </div>
  );
}

function StreamingThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg)] transition"
      >
        <Brain size={11} className="shrink-0" />
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {open ? "Hide thinking" : "Show thinking"}
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[12px] italic text-[var(--fg-muted)]">
          {text}
        </div>
      )}
    </div>
  );
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--fg-muted)]">
      <span className="typing-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

function StreamingContent({ content, pendingLabel }: { content: string; pendingLabel: string }) {
  const { thinking, answer } = parseThinking(content);

  return (
    <>
      {thinking && <StreamingThinkingBlock text={thinking} />}
      {answer && (
        <div className="whitespace-pre-wrap break-words leading-relaxed text-[var(--fg)]">
          {answer}
        </div>
      )}
      {!answer && <TypingIndicator label={pendingLabel} />}
    </>
  );
}

export function MessageBubble({
  msg,
  convId,
  modelId,
  compact,
  newTurn,
  onRetry,
}: {
  msg: Message;
  convId: string;
  modelId: string;
  compact: boolean;
  newTurn: boolean;
  onRetry: () => void;
}) {
  const isUser = msg.role === "user";
  const draftContent = useStreamDrafts((s) =>
    msg.role === "assistant" && msg.pending
      ? s.drafts[streamDraftKey(convId, modelId, msg.id)]
      : undefined
  );
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const showCopy =
    !isUser && !msg.pending && !msg.error && !!msg.content;
  const showMeta = !isUser && !msg.pending && typeof msg.responseTimeMs === "number";
  // Attribute each answer to the model that actually produced it, so prior
  // responses keep their original model name after switching models.
  const metaModel = getModel(msg.modelId ?? modelId);
  const metaModelLabel = metaModel?.shortLabel ?? metaModel?.label;
  const pendingLabel = msg.status === "searching" ? "searching..." : "thinking...";
  const visibleContent = msg.pending && msg.role === "assistant" ? draftContent ?? msg.content : msg.content;

  return (
    <div
      data-role={msg.role}
      className={
        "msg-in group relative border text-sm shadow-sm transition-colors " +
        (compact ? "px-2.5 py-1.5 " : "px-3.5 py-2.5 ") +
        (isUser ? "rounded-2xl rounded-tr-sm " : "rounded-2xl rounded-tl-sm ") +
        (newTurn ? "mt-4 " : "")
      }
      style={{
        background: isUser ? "var(--user-bubble)" : "var(--asst-bubble)",
        borderColor: isUser ? "var(--user-border)" : "var(--asst-border)",
      }}
    >
      {msg.error === "Stopped" ? (
        <>
          {visibleContent && <Markdown source={visibleContent} />}
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
            <Square size={10} fill="currentColor" /> stopped
          </div>
        </>
      ) : msg.error ? (
        <div className="space-y-2 text-[var(--error)]">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} /> {msg.error}
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded border border-[var(--error)]/40 px-2 py-1 text-[11px] hover:bg-[var(--bg-soft)]"
          >
            <RotateCcw size={11} /> Retry
          </button>
        </div>
      ) : msg.role === "assistant" && msg.pending ? (
        <StreamingContent content={visibleContent || ""} pendingLabel={pendingLabel} />
      ) : (
        (() => {
          const { thinking, answer } = parseThinking(visibleContent || "");
          return (
            <>
              {thinking && <ThinkingBlock text={thinking} />}
              {answer && <Markdown source={answer} />}
              {!answer && msg.pending && (
                <TypingIndicator label={pendingLabel} />
              )}
            </>
          );
        })()
      )}
      {showCopy && (
        <button
          onClick={onCopy}
          title={copied ? "Copied" : "Copy response"}
          className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--fg-muted)] opacity-0 transition hover:bg-[var(--bg-soft)] hover:text-[var(--fg)] group-hover:opacity-100"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
      {msg.grounding && msg.grounding.sources.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-[var(--fg-muted)]">
            <Globe size={10} /> Sources
          </div>
          {msg.grounding.sources.slice(0, 5).map((s, i) => (
            <a
              key={i}
              href={s.uri}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[11px] text-[var(--accent)] hover:underline"
            >
              [{i + 1}] {s.title || s.uri}
            </a>
          ))}
        </div>
      )}
      {showMeta && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fg-subtle)]">
          {metaModelLabel && <span className="font-medium text-[var(--fg-muted)]">{metaModelLabel}</span>}
          {typeof msg.responseTimeMs === "number" && (
            <span>{formatDuration(msg.responseTimeMs)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Remembers each column's scroll position so it survives unmount/remount
// (e.g. opening the model picker overlay or switching the single-chat model).
const scrollPositions = new Map<string, number>();

export function ModelColumn({
  convId,
  modelId,
  readOnly,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: {
  convId: string;
  modelId: string;
  readOnly?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  isDragOver?: boolean;
}) {
  const conv = useChat((s) => s.conversations[convId]);
  const setFocusedModel = useChat((s) => s.setFocusedModel);
  const toggleModelEnabled = useChat((s) => s.toggleModelEnabled);
  const compact = useSettings((s) => s.compactColumns);
  const info = getModel(modelId);
  const thread = conv?.threads[modelId];

  const isDisabled = (conv?.disabledModels ?? []).includes(modelId);
  const isPending = thread?.messages.some((m) => m.role === "assistant" && m.pending) ?? false;

  const isFocused = conv?.focusedModel === modelId;
  const isOtherFocused = !!conv?.focusedModel && !isFocused;

  const toggleFocus = () => {
    if (readOnly) return;
    if (!conv) return;
    setFocusedModel(convId, isFocused ? null : modelId);
  };

  const stopStream = () => {
    abortModel(convId, modelId);
  };

  // Toggle = on/off + collapse/expand merged into one action
  const handleToggle = () => {
    if (readOnly) return;
    if (!conv) return;
    toggleModelEnabled(convId, modelId);
  };

  const ownerName = info ? PROVIDERS[info.provider].name : "Custom";
  const sourceName = info ? API_PROVIDERS[info.apiProvider].shortName : "Custom";

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const prevConvId = useRef<string>(convId);

  // Stable key for remembering scroll position. In single chat the column is
  // remounted when switching models, so key by conversation only to carry the
  // position across model switches; otherwise key per model column.
  const scrollKey = conv?.chatMode === "single" ? `single:${convId}` : `${convId}:${modelId}`;

  // Restore the saved scroll position before paint so there is no visible
  // jump from the top — the column appears already at the right place.
  useLayoutEffect(() => {
    const saved = scrollPositions.get(scrollKey);
    if (saved == null) return;
    const c = scrollContainerRef.current;
    if (c) c.scrollTop = saved;
    // Run once on mount for this key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const c = scrollContainerRef.current;
    if (!c) return;
    scrollPositions.set(scrollKey, c.scrollTop);
    // Distinguish our own programmatic re-pinning from a real user scroll:
    // if the scrollTop is far from where we last pinned it, the user must
    // have scrolled manually, so stop fighting them.
    if (pinnedRef.current && Math.abs(c.scrollTop - pinnedTopRef.current) > 2) {
      pinnedRef.current = false;
    }
  };

  // Desired scrollTop after a new prompt is sent: only the LAST ~3 lines of
  // the latest user bubble stay visible at the top, with the answer filling
  // the rest of the column beneath it. Computed from the *actual* rendered
  // line boxes (via Range.getClientRects) rather than an approximate
  // line-height guess, so the cut lands exactly on a line boundary instead
  // of slicing through the middle of a line of text. Purely in terms of
  // this container's own scrollTop (never element.scrollIntoView), so it
  // can never drag a horizontally-scrolling ancestor (the multi-column row)
  // sideways.
  const PROMPT_TAIL_LINES = 3;
  const computeScrollTop = (container: HTMLElement): number | undefined => {
    const userBubbles = container.querySelectorAll("[data-role='user']");
    const lastUser = userBubbles[userBubbles.length - 1] as HTMLElement | undefined;
    if (!lastUser) return undefined;

    const containerRect = container.getBoundingClientRect();
    const bubbleRect = lastUser.getBoundingClientRect();

    // Group the text's line-box rects by their (rounded) viewport top so
    // wrapped lines - even across bold/link spans - collapse into one
    // entry per visual line.
    const range = document.createRange();
    range.selectNodeContents(lastUser);
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    let cutViewportTop = bubbleRect.top;
    if (rects.length > 0) {
      const tops = Array.from(new Set(rects.map((r) => Math.round(r.top)))).sort((a, b) => a - b);
      if (tops.length > PROMPT_TAIL_LINES) {
        cutViewportTop = tops[tops.length - PROMPT_TAIL_LINES];
      }
    }
    const delta = cutViewportTop - containerRect.top;
    return Math.max(0, container.scrollTop + delta);
  };

  // Find the ID of the latest user message
  const latestUserMsg = thread ? [...thread.messages].reverse().find((m) => m.role === "user") : undefined;
  const latestUserMsgId = latestUserMsg?.id ?? null;
  const canRegenerate = Boolean(latestUserMsg) && !isPending;
  const regenerate = () => {
    if (readOnly) return;
    if (!canRegenerate) return;
    void streamModel({ convId, modelId });
  };

  // Initialize with the current latest user message ID so the FIRST render
  // (page refresh / opening old chat) does not trigger a scroll.
  const lastUserMsgId = useRef<string | null>(latestUserMsgId);
  const lastHandledSubmissionAt = useRef<number>(0);
  // While true, the scroll position is actively being held at
  // computeScrollTop() on every content mutation (streaming tokens can
  // change wrapped-line heights repeatedly). Disengages the moment the user
  // scrolls manually, or once the answer finishes streaming.
  // pinnedRef coordinates imperative scroll pinning between an effect and the
  // wheel/touch handlers. react-hooks/immutability flags any ref written in
  // both places, but that is precisely what a ref is for here, so the rule is
  // suppressed at each write rather than restructuring working scroll logic.
  const pinnedRef = useRef(false);
  const pinnedTopRef = useRef(0);

  const pinScrollTop = (container: HTMLElement) => {
    const top = computeScrollTop(container);
    if (top == null) return;
    pinnedTopRef.current = top;
    container.scrollTop = top;
  };

  useEffect(() => {
    if (!thread) return;
    const latestSubmissionAt = getPromptSubmittedAt(convId);
    const hasFreshSubmission = latestSubmissionAt > lastHandledSubmissionAt.current;
    // Conversation switched - reset tracking to its current latest, don't scroll
    if (prevConvId.current !== convId) {
      prevConvId.current = convId;
      lastUserMsgId.current = latestUserMsgId;
      if (hasFreshSubmission) {
        lastHandledSubmissionAt.current = latestSubmissionAt;
      }
      return;
    }
    // Scroll when a NEW user message appears, or when this conversation just
    // received a submitted prompt (covers first render after hero submit).
    if (latestUserMsgId === lastUserMsgId.current && !hasFreshSubmission) return;
    lastUserMsgId.current = latestUserMsgId;
    if (hasFreshSubmission) lastHandledSubmissionAt.current = latestSubmissionAt;

    // Engage the pin, then snap (no animation — animating while the answer
    // is actively streaming/mutating fights the browser and causes the
    // "scrolls all the way, then jerks back" glitch). Two rAFs so layout
    // has settled for a long, freshly-wrapped prompt before we measure it.
    pinnedRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container || !pinnedRef.current) return;
        pinScrollTop(container);
      });
    });
  }, [convId, latestUserMsgId, thread]);

  // Dynamic spacer: reserves just enough room so the container can actually
  // scroll to that position, shrinking automatically as the assistant
  // response grows beneath it. While pinned, also re-asserts the exact
  // scrollTop on every mutation so streamed content can't drift the view.
  useEffect(() => {
    if (!thread) return;
    const container = scrollContainerRef.current;
    const spacer = spacerRef.current;
    if (!container || !spacer) return;

    const updateSpacer = () => {
      const top = computeScrollTop(container);
      if (top == null) {
        spacer.style.height = "0px";
        return;
      }
      spacer.style.height = "0px";
      let contentHeight = 0;
      Array.from(container.children).forEach((child) => {
        if (child === spacer) return;
        contentHeight += (child as HTMLElement).offsetHeight;
      });
      const contentBelow = contentHeight - top;
      const needed = container.clientHeight - contentBelow;
      spacer.style.height = `${Math.max(0, needed)}px`;
      if (pinnedRef.current) {
        pinnedTopRef.current = top;
        container.scrollTop = top;
      }
    };

    // Apply once immediately, while still pinned, so the final chunk of a
    // response (which can reflow line-wrapping/headers right as streaming
    // ends) still gets one last correction before we let go.
    updateSpacer();
    const ro = new ResizeObserver(updateSpacer);
    ro.observe(container);
    const mo = new MutationObserver(updateSpacer);
    mo.observe(container, { childList: true, subtree: true, characterData: true });

    // Only release the pin after a short grace period once streaming ends,
    // so any late, async reflow (markdown/code formatting, fonts) still gets
    // corrected instead of leaving the view mid-line.
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    if (!isPending) {
      releaseTimer = setTimeout(() => {
        pinnedRef.current = false;
      }, 400);
    }

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (releaseTimer) clearTimeout(releaseTimer);
    };
  }, [thread, isPending]);



  if (!conv || !thread) return null;

  // Toggle pill shared between collapsed strip and full header
  const TogglePill = (
    <button
      onClick={handleToggle}
      title={isDisabled ? "Enable - expand and receive prompts" : "Pause - collapse and stop receiving prompts"}
      className="flex items-center px-0.5"
    >
      <span
        className={
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
          (isDisabled
            ? "bg-[var(--border-strong)]"
            : "bg-[var(--accent)]")
        }
      >
        <span
          className={
            "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform " +
            (isDisabled ? "translate-x-0.5" : "translate-x-[18px]")
          }
        />
      </span>
    </button>
  );

  // Collapsed strip when paused
  if (isDisabled) {
    return (
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={
          "flex h-full w-11 shrink-0 flex-col items-center gap-2 overflow-hidden bg-[var(--bg-soft)] py-2 opacity-50 transition border-t-2 " +
          (isFocused ? "border-t-[var(--accent)]" : "border-t-transparent") +
          (isDragOver ? " ring-2 ring-inset ring-[var(--accent)]" : "")
        }
      >
        {/* Grip is the only draggable element */}
        {!readOnly && (
          <span
            draggable
            onDragStart={onDragStart}
            className="cursor-grab active:cursor-grabbing text-[var(--fg-subtle)] hover:text-[var(--fg-muted)] shrink-0"
            title="Drag to reorder"
          >
            <GripVertical size={14} />
          </span>
        )}
        {TogglePill}
        {info && <ProviderIcon provider={info.provider} size={26} />}
        <span
          className="mt-1 text-[10px] font-medium text-[var(--fg-muted)]"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {info?.shortLabel ?? info?.label ?? modelId}
        </span>
      </div>
    );
  }
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={
        "flex h-full flex-1 flex-col overflow-hidden transition border-t-2 " +
        (compact ? "min-w-[280px] " : "min-w-[320px] ") +
        (isFocused ? "border-t-[var(--accent)]" : "border-t-transparent") +
        (isOtherFocused ? " opacity-40" : "") +
        (isDragOver ? " ring-2 ring-inset ring-[var(--accent)]" : "")
      }
    >
      {/* Header */}
      <div className={"flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-soft)] " + (compact ? "px-3 py-2" : "px-3.5 py-2.5")}>
        <div className="flex min-w-0 items-center gap-2.5">
          {!readOnly && (
            <span
              draggable
              onDragStart={onDragStart}
              className="cursor-grab active:cursor-grabbing text-[var(--fg-subtle)] hover:text-[var(--fg-muted)] shrink-0"
              title="Drag to reorder"
            >
              <GripVertical size={14} />
            </span>
          )}
          {info && <ProviderIcon provider={info.provider} size={28} />}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--fg)]">
              {info?.label ?? modelId}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--fg-muted)]">
              <span className="truncate">{ownerName}</span>
              <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase leading-none text-[var(--fg-muted)]">
                {sourceName}
              </span>
              {readOnly && (
                <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase leading-none text-[var(--fg-muted)]">
                  Archive
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[var(--fg-muted)]">
          {!readOnly && TogglePill}
          {!readOnly && canRegenerate && (
            <button
              onClick={regenerate}
              className="rounded p-1.5 hover:bg-[var(--bg)] hover:text-[var(--fg)]"
              title="Regenerate this model"
            >
              <RotateCcw size={13} />
            </button>
          )}
          {/* Stop streaming button - only visible when pending */}
          {!readOnly && isPending && (
            <button
              onClick={stopStream}
              className="rounded p-1.5 text-[var(--error)] hover:bg-[var(--bg)]"
              title="Stop response"
            >
              <Square size={13} fill="currentColor" />
            </button>
          )}
          {!readOnly && (
            <button
              onClick={toggleFocus}
              className={
                "rounded p-1.5 hover:bg-[var(--bg)] hover:text-[var(--fg)] " +
                (isFocused ? "text-[var(--accent)]" : "")
              }
              title={isFocused ? "Exit focus mode" : "Focus on this model only"}
            >
              <Focus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onWheel={() => {
          // eslint-disable-next-line react-hooks/immutability
          pinnedRef.current = false;
        }}
        onTouchStart={() => {
          // eslint-disable-next-line react-hooks/immutability
          pinnedRef.current = false;
        }}
        className={"flex-1 overflow-y-auto " + (compact ? "space-y-2 p-2" : "space-y-3 p-3")}
      >
        {thread.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 pt-14 text-center">
            {info && (
              <div className="opacity-40">
                <ProviderIcon provider={info.provider} size={32} />
              </div>
            )}
            <div className="text-xs font-medium text-[var(--fg-muted)]">
              {info?.label ?? modelId}
            </div>
            <div className="max-w-[220px] text-xs text-[var(--fg-subtle)]">
              Send a prompt to see this model respond.
            </div>
          </div>
        )}
        {thread.messages.map((m, i) => {
          const prev = thread.messages[i - 1];
          const newTurn = i > 0 && m.role === "user" && prev?.role !== "user";
          return (
            <MessageBubble
              key={m.id}
              msg={m}
              convId={conv.id}
              modelId={modelId}
              compact={compact}
              newTurn={newTurn}
              onRetry={regenerate}
            />
          );
        })}
        {/* Dynamic spacer: only as tall as needed so latest user msg can reach top.
            Shrinks as assistant response grows; disappears once content fills view. */}
        <div ref={spacerRef} aria-hidden style={{ height: 0 }} />
      </div>

      {isOtherFocused && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-center text-[10px] text-[var(--fg-muted)]">
          read-only - another model is focused
        </div>
      )}
      {readOnly && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-center text-[10px] text-[var(--fg-muted)]">
          archived model history - model no longer available
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}
