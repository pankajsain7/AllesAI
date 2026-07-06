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
import { ArrowUp, Globe, Loader2, Sparkles, X } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import {
  MODEL_CATALOG,
  buildModelFamilies,
  dedupeModelIdsByFamily,
  getCloudOllamaModelInfos,
  getGeminiExtraModelInfos,
  getGroqExtraModelInfos,
  getLocalOllamaModelInfo,
  getModel,
  getModelFamilyId,
  getOpenCodeModelInfos,
  getCustomProviderModelInfos,
} from "@/lib/models";
import { isRemovedModelName } from "@/lib/model-rules";

export function HeroComposer({ convId }: { convId: string }) {
  const conv = useChat((s) => s.conversations[convId]);
  const webSearch = useSettings((s) => s.webSearch);
  const setWebSearch = useSettings((s) => s.setWebSearch);
  const groqEnabled = useSettings((s) => s.groqEnabled);
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

  if (!conv) return null;
  const enabledSettings: ProviderToggleSettings = {
    groqEnabled,
    geminiEnabled,
    opencodeEnabled,
    cloudOllamaEnabled,
    localEnabled,
  };

  const availableFamilyIds = useMemo(() => {
    const baseRoutes = MODEL_CATALOG.filter((route) =>
      isApiProviderEnabled(route.apiProvider, enabledSettings)
    );
    const hostedOllamaRoutes = cloudOllamaEnabled
      ? getCloudOllamaModelInfos(ollamaCloudModels)
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

  const visibleSelectedModels = dedupeModelIdsByFamily(
    filterEnabledModelIds(conv.selectedModels, enabledSettings).filter((id) =>
      availableFamilyIds.has(getModelFamilyId(id))
    )
  );
  const isAuto = conv.chatMode === "auto";
  const isSingle = conv.chatMode === "single";
  const heading = isAuto
    ? "Auto-pick the best model"
    : isSingle
      ? "Ask a single model"
      : "Ask many minds at once";
  const subheading = isAuto
    ? "Type your question and the best model is chosen automatically."
    : isSingle
      ? "Chat one-on-one with your chosen model."
      : "Compare answers from top free AI models, side-by-side.";

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendPromptToAll(convId, t);
    setText("");
    const el = textareaRef.current;
    if (el) el.style.height = "";
  };

  // Auto-grow the input box vertically as a longer prompt is typed/pasted,
  // up to 3x its single-line height. Width stays fixed.
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const base = 38; // single-line height (px)
    el.style.height = `${Math.min(el.scrollHeight, base * 3)}px`;
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
      if (improved) setText(improved);
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

      <div className="relative z-10 flex w-full max-w-[119.7rem] flex-col items-center px-6">
        <div className="mb-8 w-full max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--fg)]">
            {heading}
          </h1>
          <p className="mt-3 text-base text-[var(--fg-muted)]">
            {subheading}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            {isAuto ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1.5 text-sm font-medium text-[var(--accent)]">
                <Sparkles size={15} />
                Best model chosen for you
              </div>
            ) : (
              <>
                {visibleSelectedModels.slice(0, 8).map((id) => {
                  const m = getModel(id);
                  if (!m) return null;
                  return (
                    <div key={id} className="rounded-full ring-2 ring-[var(--bg)]">
                      <ProviderIcon provider={m.provider} size={26} />
                    </div>
                  );
                })}
                {visibleSelectedModels.length > 8 && (
                  <span className="ml-1 text-sm text-[var(--fg-muted)]">
                    +{visibleSelectedModels.length - 8}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {enhanceError && (
          <div className="mb-2 flex w-full max-w-2xl items-center gap-2 rounded-md border border-[var(--error)]/40 bg-[var(--error)]/10 px-2.5 py-1 text-[11px] text-[var(--error)]">
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

        <form
          onSubmit={onSubmit}
          className="mx-auto w-full"
          style={{ maxWidth: `${42 * 1.25 * 0.95}rem` }}
        >
          <div className="flex items-center gap-2 rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 shadow-sm transition focus-within:border-[var(--border-strong)] focus-within:shadow-md">
            <button
              type="button"
              onClick={() => setWebSearch(!webSearch)}
              title={webSearch ? "Web search ON - click to disable" : "Enable web search for all models"}
              className={
                "shrink-0 rounded-full p-1.5 transition " +
                (webSearch ? "text-[var(--accent)]" : "text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]")
              }
            >
              <Globe size={15} />
            </button>
            <button
              type="button"
              onClick={onEnhance}
              disabled={!text.trim() || !enhanceModel || enhancing}
              title={
                enhanceModel
                  ? "Enhance prompt - let AI rewrite it for a better answer"
                  : "Select a model to enhance the prompt"
              }
              className="shrink-0 rounded-full p-1.5 text-[var(--fg-subtle)] transition hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--fg-subtle)]"
            >
              {enhancing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            </button>
            <textarea
              ref={textareaRef}
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                autoGrow(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Ask anything..."
              rows={1}
              className="block w-full flex-1 resize-none self-center overflow-y-auto bg-transparent py-1.5 text-sm leading-6 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              title="Send"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </form>

        <p className="mt-4 w-full max-w-2xl text-center text-xs text-[var(--fg-subtle)]">
          Press <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5">Enter</kbd> to send,{" "}
          <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5">Shift+Enter</kbd> for newline
        </p>
      </div>
    </div>
  );
}
