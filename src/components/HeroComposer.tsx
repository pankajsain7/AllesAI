"use client";

import { useMemo, useRef, useState } from "react";
import { enhancePrompt, sendPromptToAll } from "@/lib/chat-client";
import {
  filterEnabledModelIds,
  isApiProviderEnabled,
  useChat,
  useSettings,
  type ProviderToggleSettings,
} from "@/lib/store";
import { ArrowUp, Globe, Loader2, Sparkles, X, Zap } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import {
  MODEL_CATALOG,
  buildModelFamilies,
  dedupeModelIdsByFamily,
  getCloudOllamaModelInfos,
  getCloudOllamaModelNames,
  getGeminiExtraModelInfos,
  getGroqExtraModelInfos,
  getLocalOllamaModelInfo,
  getModel,
  getModelFamilyId,
  getOpenCodeModelInfos,
  getCustomProviderModelInfos,
} from "@/lib/models";
import { isRemovedModelName } from "@/lib/model-rules";
import { IconButton } from "./Button";

export function HeroComposer({ convId }: { convId: string }) {
  const MIN_PROMPT_ROWS = 1;
  const MAX_PROMPT_ROWS = 8;
  const conv = useChat((s) => s.conversations[convId]);
  const webSearch = useSettings((s) => s.webSearch);
  const setWebSearch = useSettings((s) => s.setWebSearch);
  const groqEnabled = useSettings((s) => s.groqEnabled);
  const bedrockEnabled = useSettings((s) => s.bedrockEnabled);
  const geminiEnabled = useSettings((s) => s.geminiEnabled);
  const opencodeEnabled = useSettings((s) => s.opencodeEnabled);
  const localEnabled = useSettings((s) => s.localEnabled);
  const cloudOllamaEnabled = useSettings((s) => s.cloudOllamaEnabled);
  const ollamaCloudModels = useSettings((s) => s.ollamaCloudModels);
  const availableLocalModels = useSettings((s) => s.availableLocalModels);
  const customProviders = useSettings((s) => s.customProviders);
  const opencodeModels = useSettings((s) => s.opencodeModels);
  const groqExtraModels = useSettings((s) => s.groqExtraModels);
  const geminiExtraModels = useSettings((s) => s.geminiExtraModels);
  const [text, setText] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const enhanceCtrlRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const enabledSettings = useMemo<ProviderToggleSettings>(
    () => ({
      groqEnabled,
      bedrockEnabled,
      geminiEnabled,
      opencodeEnabled,
      cloudOllamaEnabled,
      localEnabled,
    }),
    [groqEnabled, bedrockEnabled, geminiEnabled, opencodeEnabled, cloudOllamaEnabled, localEnabled]
  );

  const availableFamilyIds = useMemo(() => {
    const baseRoutes = MODEL_CATALOG.filter((route) =>
      isApiProviderEnabled(route.apiProvider, enabledSettings)
    );
    const hostedOllamaRoutes = cloudOllamaEnabled
      ? getCloudOllamaModelInfos(getCloudOllamaModelNames(ollamaCloudModels))
      : [];
    const localRoutes = localEnabled
      ? availableLocalModels
          .filter((model) => !isRemovedModelName(model.name))
          .map((model) => getLocalOllamaModelInfo(model.name))
      : [];
    const customRoutes = getCustomProviderModelInfos(customProviders);
    const opencodeRoutes = opencodeEnabled ? getOpenCodeModelInfos(opencodeModels) : [];
    const groqExtraRoutes = groqEnabled ? getGroqExtraModelInfos(groqExtraModels) : [];
    const geminiExtraRoutes = geminiEnabled ? getGeminiExtraModelInfos(geminiExtraModels) : [];

    const families = buildModelFamilies([
      ...baseRoutes,
      ...opencodeRoutes,
      ...groqExtraRoutes,
      ...geminiExtraRoutes,
      ...hostedOllamaRoutes,
      ...localRoutes,
      ...customRoutes,
    ]);

    return new Set(families.map((family) => family.familyId));
  }, [
    enabledSettings,
    cloudOllamaEnabled,
    localEnabled,
    availableLocalModels,
    customProviders,
    opencodeEnabled,
    opencodeModels,
    groqEnabled,
    groqExtraModels,
    geminiEnabled,
    geminiExtraModels,
    ollamaCloudModels,
  ]);

  // Every hook must run before this point, otherwise deleting a conversation
  // changes the hook order and React tears the tree down.
  if (!conv) return null;

  const visibleSelectedModels = dedupeModelIdsByFamily(
    filterEnabledModelIds(conv.selectedModels, enabledSettings).filter((id) =>
      availableFamilyIds.has(getModelFamilyId(id))
    )
  );
  const isSingle = conv.chatMode === "single";
  const isSuper = conv.chatMode === "super";
  const heading = isSuper
    ? "Get the best answer"
    : isSingle
      ? "Ask a single model"
      : "Ask many minds at once";
  const subheading = isSuper
    ? "Your prompt is routed to multiple top models and merged into one refined answer."
    : isSingle
      ? "Pick a model below and start chatting."
      : "Compare responses from several models side by side, in one place.";
  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendPromptToAll(convId, t);
    setText("");
    requestAnimationFrame(() => syncTextareaHeight(""));
  };

  // Auto-grow the input box vertically as a longer prompt is typed/pasted,
  // from 2 visible rows up to 8 rows max.
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
    const paddingY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const borderY =
      (Number.parseFloat(styles.borderTopWidth) || 0) +
      (Number.parseFloat(styles.borderBottomWidth) || 0);
    const minHeight = lineHeight * MIN_PROMPT_ROWS + paddingY + borderY;
    const maxHeight = lineHeight * MAX_PROMPT_ROWS + paddingY + borderY;
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
  };

  const syncTextareaHeight = (nextText: string) => {
    const el = textareaRef.current;
    if (!el) return;

    if (!nextText) {
      el.style.height = "";
      return;
    }

    autoGrow(el);
  };

  const setTextAndResize = (nextText: string) => {
    setText(nextText);
    requestAnimationFrame(() => syncTextareaHeight(nextText));
  };

  const enhanceModel = visibleSelectedModels[0] ?? null;

  const onEnhance = async () => {
    const t = text.trim();
    if (!t || !enhanceModel || enhancing) return;
    setEnhanceError(null);
    setEnhancing(true);
    const ctrl = new AbortController();
    enhanceCtrlRef.current = ctrl;
    try {
      const improved = await enhancePrompt(enhanceModel, t, ctrl.signal);
      if (improved) setTextAndResize(improved);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setEnhanceError(err instanceof Error ? err.message : "Could not enhance prompt.");
      }
    } finally {
      if (enhanceCtrlRef.current === ctrl) enhanceCtrlRef.current = null;
      setEnhancing(false);
    }
  };

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-60" />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-[60%] rounded-full opacity-[0.15] blur-3xl"
        style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)" }}
      />

      <div className="relative z-10 flex w-full max-w-3xl -translate-y-[6vh] flex-col items-center px-6">
        {isSuper && (
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1 text-xs font-semibold tracking-wide text-[var(--accent)]">
            <Zap size={13} className="fill-current" />
            <span>SUPER MODE</span>
          </div>
        )}

        <div className="mb-8 w-full text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--fg)] sm:text-4xl">
            {heading}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--fg-muted)]">
            {subheading}
          </p>

          {!isSuper && visibleSelectedModels.length > 0 && (
            <div className="mt-5 flex items-center justify-center -space-x-1.5">
              {visibleSelectedModels.slice(0, 8).map((id) => {
                const m = getModel(id);
                if (!m) return null;
                return (
                  <div
                    key={id}
                    className="rounded-full bg-[var(--bg-elevated)] ring-2 ring-[var(--bg)] transition hover:z-10 hover:-translate-y-0.5"
                    title={m.label}
                  >
                    <ProviderIcon provider={m.provider} size={26} />
                  </div>
                );
              })}
              {visibleSelectedModels.length > 8 && (
                <span className="ml-3 text-sm font-medium text-[var(--fg-muted)]">
                  +{visibleSelectedModels.length - 8}
                </span>
              )}
            </div>
          )}
        </div>

        {enhanceError && (
          <div className="mb-3 flex w-full items-center gap-2 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1.5 text-xs text-[var(--error)]">
            <span className="font-medium">{enhanceError}</span>
            <button
              type="button"
              onClick={() => setEnhanceError(null)}
              className="ml-auto rounded p-0.5 hover:bg-[var(--bg)]"
              title="Dismiss"
            >
              <X size={11} />
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="w-full">
          <div
            className={
              "flex min-h-16 items-center gap-2 rounded-[var(--radius-lg)] border bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow-sm)] transition focus-within:shadow-[var(--shadow-md)] " +
              (isSuper
                ? "border-[var(--accent)]/25 focus-within:border-[var(--accent)]/60"
                : "border-[var(--border)] focus-within:border-[var(--border-strong)]")
            }
          >
            <IconButton
              onClick={() => setWebSearch(!webSearch)}
              title={webSearch ? "Web search ON - click to disable" : "Enable web search for all models"}
              active={webSearch}
              size="sm"
              className="self-center"
            >
              <Globe size={15} />
            </IconButton>
            <IconButton
              onClick={onEnhance}
              disabled={!text.trim() || !enhanceModel || enhancing}
              title={
                enhanceModel
                  ? "Enhance prompt - let AI rewrite it for a better answer"
                  : "Select a model to enhance the prompt"
              }
              size="sm"
              className="self-center hover:text-[var(--accent)]"
            >
              {enhancing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            </IconButton>
            <textarea
              ref={textareaRef}
              autoFocus
              value={text}
              onChange={(e) => setTextAndResize(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Ask anything..."
              rows={1}
              className="composer-input block w-full flex-1 resize-none self-center overflow-y-auto border-0 bg-transparent py-0 text-sm leading-6 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className={
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--accent-fg)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30 " +
                (isSuper ? "bg-[var(--accent)]" : "bg-[var(--accent)]")
              }
              title="Send"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--fg-subtle)]">
          Press <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-0.5">Enter</kbd> to send,{" "}
          <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-0.5">Shift+Enter</kbd> for newline
        </p>
      </div>
    </div>
  );
}
