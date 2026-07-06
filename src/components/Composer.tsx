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
import { ArrowUp, Globe, Loader2, Sparkles, Square, X } from "lucide-react";
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

export function Composer({ convId }: { convId: string }) {
  const conv = useChat((s) => s.conversations[convId]);
  const setFocusedModel = useChat((s) => s.setFocusedModel);
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
  const ctrlRef = useRef<AbortController | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const enhanceCtrlRef = useRef<AbortController | null>(null);
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

  const visibleSelectedModels = conv
    ? dedupeModelIdsByFamily(
        filterEnabledModelIds(conv.selectedModels, enabledSettings).filter((id) =>
          availableFamilyIds.has(getModelFamilyId(id))
        )
      )
    : [];

  const focusedModel =
    conv?.focusedModel && visibleSelectedModels.includes(conv.focusedModel)
      ? conv.focusedModel
      : null;
  const anyPending = focusedModel
    ? !!conv?.threads[focusedModel]?.messages.some((msg) => msg.pending)
    : !!visibleSelectedModels.some((m) => conv?.threads[m]?.messages.some((msg) => msg.pending));
  const focusedInfo = focusedModel ? getModel(focusedModel) : undefined;

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || anyPending) return;
    ctrlRef.current = sendPromptToAll(convId, t);
    setText("");
  };

  const onStop = () => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
  };

  const enhanceModel = focusedModel ?? visibleSelectedModels[0] ?? null;

  const onEnhance = async () => {
    const t = text.trim();
    if (!t || !enhanceModel || enhancing || anyPending) return;
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
    <form onSubmit={onSubmit} className="border-t border-[var(--border)] bg-[var(--bg-soft)] px-4 pb-4 pt-3">
      {conv?.chatMode === "auto" && visibleSelectedModels[0] && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] text-[var(--accent)]">
          <Sparkles size={11} />
          <span className="font-medium">
            Auto chose {getModel(visibleSelectedModels[0])?.label ?? visibleSelectedModels[0]}
          </span>
          <span className="text-[var(--fg-muted)]">- start a new chat to re-pick</span>
        </div>
      )}
      {focusedModel && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] text-[var(--accent)]">
          <span className="font-medium">Focused on {focusedInfo?.label ?? focusedModel}</span>
          <span className="text-[var(--fg-muted)]">- prompts only go to this model</span>
          <button
            type="button"
            onClick={() => setFocusedModel(convId, null)}
            className="ml-auto rounded p-0.5 hover:bg-[var(--bg)]"
            title="Exit focus"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {enhanceError && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-md border border-[var(--error)]/40 bg-[var(--error)]/10 px-2.5 py-1 text-[11px] text-[var(--error)]">
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

      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 shadow-sm transition focus-within:border-[var(--border-strong)] focus-within:shadow-md">
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
          disabled={!text.trim() || !enhanceModel || enhancing || anyPending}
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={focusedModel ? "Continue chatting with the focused model..." : "Message all selected models..."}
          rows={1}
          className="block max-h-48 w-full flex-1 resize-none self-center bg-transparent py-1.5 text-sm leading-6 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
        />
        {anyPending ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--error)] text-white shadow-sm transition hover:opacity-90"
            title="Stop"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            title="Send"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}
