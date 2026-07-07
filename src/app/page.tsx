"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  filterSelectableModelIds,
  useChat,
  useSettings,
  SUPER_THREAD_ID,
} from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { ModelColumn } from "@/components/ModelColumn";
import { Composer } from "@/components/Composer";
import { HeroComposer } from "@/components/HeroComposer";
import { SuperColumn } from "@/components/SuperColumn";
import { ConsensusButton } from "@/components/ConsensusButton";
import { SynthesisHistoryButton } from "@/components/SharedResultsLane";
import { ModelPicker } from "@/components/ModelPicker";
import { ModeSelector } from "@/components/ModeSelector";
import { SingleModelPicker } from "@/components/SingleModelPicker";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import { KeyRound, ChevronDown } from "lucide-react";
import { getModel } from "@/lib/models";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

export default function Home() {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );

  const setSelectedModels = useChat((s) => s.setSelectedModels);
  const dragSrc = useRef<string | null>(null);
  const [singlePickerOpen, setSinglePickerOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const newConversation = useChat((s) => s.newConversation);
  const apiKey = useSettings((s) => s.apiKey);
  const groqEnabled = useSettings((s) => s.groqEnabled);
  const geminiApiKey = useSettings((s) => s.geminiApiKey);
  const geminiEnabled = useSettings((s) => s.geminiEnabled);
  const opencodeApiKey = useSettings((s) => s.opencodeApiKey);
  const opencodeEnabled = useSettings((s) => s.opencodeEnabled);
  const ollamaApiKey = useSettings((s) => s.ollamaApiKey);
  const localEnabled = useSettings((s) => s.localEnabled);
  const cloudOllamaEnabled = useSettings((s) => s.cloudOllamaEnabled);
  // Subscribed so the visible model list re-computes when the set of
  // available routes changes (added/removed cloud, local or custom models).
  const ollamaCloudModels = useSettings((s) => s.ollamaCloudModels);
  const availableLocalModels = useSettings((s) => s.availableLocalModels);
  const opencodeModels = useSettings((s) => s.opencodeModels);
  const groqExtraModels = useSettings((s) => s.groqExtraModels);
  const geminiExtraModels = useSettings((s) => s.geminiExtraModels);
  const customProviders = useSettings((s) => s.customProviders);

  const handleDragStart = (id: string) => {
    dragSrc.current = id;
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragSrc.current && dragSrc.current !== id) setDragOverId(id);
  };

  const handleDrop = (targetId: string) => {
    const src = dragSrc.current;
    dragSrc.current = null;
    setDragOverId(null);
    if (!src || src === targetId || !conv) return;
    const order = [...conv.selectedModels];
    const from = order.indexOf(src);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, src);
    setSelectedModels(conv.id, order);
  };

  // Auto-create a conversation if none exists.
  useEffect(() => {
    if (!mounted) return;
    if (!activeId || !conversations[activeId]) {
      newConversation();
    }
  }, [mounted, activeId, conversations, newConversation]);

  if (!mounted) return null;

  const conv = activeId ? conversations[activeId] : null;
  // Reference the provider settings so this render is subscribed to them;
  // filterSelectableModelIds reads the full settings state internally.
  void groqEnabled;
  void geminiEnabled;
  void opencodeEnabled;
  void cloudOllamaEnabled;
  void localEnabled;
  void ollamaCloudModels;
  void availableLocalModels;
  void opencodeModels;
  void groqExtraModels;
  void geminiExtraModels;
  void customProviders;
  const visibleSelectedModels = conv
    ? filterSelectableModelIds(conv.selectedModels)
    : [];
  const legacyHistoryModelIds = conv
    ? Object.entries(conv.threads)
        .filter(
          ([modelId, thread]) =>
            modelId !== SUPER_THREAD_ID &&
            !visibleSelectedModels.includes(modelId) && (thread.messages?.length ?? 0) > 0
        )
        .map(([modelId]) => modelId)
    : [];
  const visibleFocusedModel =
    conv?.focusedModel && visibleSelectedModels.includes(conv.focusedModel)
      ? conv.focusedModel
      : null;
  const activeSelectedHaveMessages = !!conv && visibleSelectedModels.some(
    (id) => (conv.threads[id]?.messages.length ?? 0) > 0
  );
  const baseColumnModelIds =
    legacyHistoryModelIds.length > 0 && !activeSelectedHaveMessages
      ? legacyHistoryModelIds
      : [...visibleSelectedModels, ...legacyHistoryModelIds];
  const columnModelIds = visibleFocusedModel
    ? [visibleFocusedModel]
    : Array.from(new Set(baseColumnModelIds));
  const selectedInfos = conv
    ? visibleSelectedModels.map(getModel).filter((model): model is NonNullable<typeof model> => Boolean(model))
    : [];
  const needsGroqKey =
    !!conv &&
    groqEnabled &&
    !apiKey &&
    selectedInfos.some((model) => model.apiProvider === "groq");
  const needsGeminiKey =
    !!conv &&
    geminiEnabled &&
    !geminiApiKey &&
    selectedInfos.some((model) => model.apiProvider === "gemini");
  const needsOpencodeKey =
    !!conv &&
    opencodeEnabled &&
    !opencodeApiKey &&
    selectedInfos.some((model) => model.apiProvider === "opencode");
  const needsLocalOllama =
    !!conv &&
    !localEnabled &&
    selectedInfos.some((model) => model.apiProvider === "ollama-local");
  const needsCloudOllama =
    !!conv &&
    selectedInfos.some((model) => model.apiProvider === "ollama-cloud") &&
    (!cloudOllamaEnabled || !ollamaApiKey);
  const setupNeeds = [
    needsGroqKey ? "Groq API key" : null,
    needsGeminiKey ? "Gemini API key" : null,
    needsOpencodeKey ? "OpenCode API key" : null,
    needsLocalOllama ? "enable Local Ollama" : null,
    needsCloudOllama
      ? cloudOllamaEnabled
        ? "Ollama API key"
        : "enable Ollama"
      : null,
  ].filter(Boolean);

  // Determine if the conversation has any messages yet - if not, show the hero
  const hasMessages = !!conv && Object.values(conv.threads).some(
    (thread) => (thread.messages?.length ?? 0) > 0
  );
  const isSingle = conv?.chatMode === "single";
  const isSuper = conv?.chatMode === "super";
  const hasSuperMessages = !!conv?.threads[SUPER_THREAD_ID]?.messages.length;
  const singleModel = isSingle ? getModel(visibleSelectedModels[0] ?? "") : undefined;
  // In single mode, show the model cards when explicitly opened or none chosen yet.
  const showSinglePicker = !!conv && isSingle && (singlePickerOpen || visibleSelectedModels.length === 0);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-soft)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <Logo />
          </div>
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-base font-semibold text-[var(--fg)]">
                {conv?.title ?? "Alles AI"}
              </h1>
              <span className="truncate text-xs text-[var(--fg-muted)]">
                {conv
                  ? isSuper
                    ? "- Super"
                    : visibleFocusedModel
                      ? "- Focused on 1 model"
                      : `- ${visibleSelectedModels.length} model${visibleSelectedModels.length === 1 ? "" : "s"}`
                : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conv && (
              <ModeSelector
                convId={conv.id}
                onSelect={(mode) => {
                  setSinglePickerOpen(mode === "single");
                }}
              />
            )}
            {conv && (
              <div className="hidden md:block">
                <SynthesisHistoryButton convId={conv.id} />
              </div>
            )}
            {conv && conv.chatMode === "multi" && <ModelPicker convId={conv.id} />}
            {conv && isSingle && (
              <Button
                onClick={() => setSinglePickerOpen((v) => !v)}
                size="sm"
                className="max-w-[200px]"
                title="Choose model"
              >
                {singleModel ? (
                  <>
                    <ProviderIcon provider={singleModel.provider} size={14} />
                    <span className="truncate">{singleModel.label}</span>
                  </>
                ) : (
                  <span>Choose model</span>
                )}
                <ChevronDown size={12} className="text-[var(--fg-muted)]" />
              </Button>
            )}
            {conv && (
              <div className="md:hidden">
                <SynthesisHistoryButton convId={conv.id} compact />
              </div>
            )}
            <div className="md:hidden">
              <SettingsDialog />
            </div>
          </div>
        </header>

        {setupNeeds.length > 0 && (
          <div className="flex items-center gap-2 border-b border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-2 text-xs text-[var(--warning)]">
            <KeyRound size={14} className="shrink-0" />
            <span className="text-[var(--fg)]">
              In Settings, add or enable: <strong className="font-semibold">{setupNeeds.join(", ")}</strong>.
            </span>
          </div>
        )}

        {conv && showSinglePicker && (
          <SingleModelPicker convId={conv.id} onPick={() => setSinglePickerOpen(false)} />
        )}

        {conv && !isSingle && !isSuper && visibleSelectedModels.length === 0 && legacyHistoryModelIds.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-soft)] px-6 py-5 text-center">
              <p className="text-sm text-[var(--fg-muted)]">
                No active models selected. Open <strong className="font-semibold text-[var(--fg)]">Models</strong> above or enable a provider in Settings.
              </p>
            </div>
          </div>
        )}

        {conv && !showSinglePicker && ((isSuper && !hasSuperMessages) || (!isSuper && visibleSelectedModels.length > 0 && !hasMessages)) && (
          <HeroComposer convId={conv.id} />
        )}

        {conv && !showSinglePicker && isSuper && hasSuperMessages && (
          <>
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <SuperColumn convId={conv.id} />
            </div>
            <Composer convId={conv.id} />
          </>
        )}

        {conv && !showSinglePicker && !isSuper && visibleSelectedModels.length > 0 && hasMessages && (
          <>
            <div className="flex min-h-0 flex-1 divide-x divide-[var(--border)] overflow-x-auto">
              {columnModelIds.map((id) => (
                <ModelColumn
                  key={isSingle ? "single-column" : id}
                  convId={conv.id}
                  modelId={id}
                  readOnly={legacyHistoryModelIds.includes(id)}
                  onDragStart={() => handleDragStart(id)}
                  onDragOver={(e) => handleDragOver(e, id)}
                  onDrop={() => handleDrop(id)}
                  isDragOver={dragOverId === id}
                />
              ))}
              {/* When focused, show ghost preview of others as small read-only column? Skip for now. */}
            </div>
            <Composer convId={conv.id} />
            {columnModelIds.length > 1 && <ConsensusButton convId={conv.id} />}
          </>
        )}
      </main>
    </div>
  );
}
