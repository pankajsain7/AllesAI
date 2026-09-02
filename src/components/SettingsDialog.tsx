"use client";

import { useMemo, useState } from "react";
import { useChat, useSettings, type LocalOllamaModel } from "@/lib/store";
import { planConsensusRun, type EffortOption } from "@/lib/consensus-plan";
import type { EffortLevel } from "@/lib/effort";
import {
  MODEL_CATALOG,
  OPENCODE_KNOWN_MODELS,
  PRESET_CLOUD_OLLAMA_MODELS,
  isFreeCloudOllamaModel,
  toCloudOllamaModelId,
  toOpenCodeModelId,
  type CustomProvider,
} from "@/lib/models";
import { isRemovedModelName } from "@/lib/model-rules";
import { uid } from "@/lib/utils";
import {
  ChevronDown,
  ExternalLink,
  Info,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

type BrowsableModel = { id: string; name?: string; model?: string };

type SettingsTab = "keys" | "preferences";

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  hint: string;
  icon: typeof KeyRound;
}> = [
  {
    id: "keys",
    label: "Providers & keys",
    hint: "Connect the APIs that serve models.",
    icon: KeyRound,
  },
  {
    id: "preferences",
    label: "Preferences",
    hint: "How runs behave once providers are connected.",
    icon: SlidersHorizontal,
  },
];

// Shared fetch/open/loading/error state for every "Browse models" panel
// (OpenCode, Groq, and each custom provider).
function useModelBrowser() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<BrowsableModel[]>([]);

  const browse = async (
    url: string,
    mapModels: (models: BrowsableModel[]) => BrowsableModel[] = (models) => models
  ) => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as { models?: BrowsableModel[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setModels(mapModels(data.models ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return { open, loading, error, models, browse };
}

// Compact, collapsible list of the free models that ship enabled by default
// for a provider. Purely informational (read-only) — actual selection for
// chat happens in the model picker.
function DefaultModelsDisclosure({
  count,
  models,
}: {
  count: number;
  models: Array<{ label: string; free?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium text-[var(--fg)]"
      >
        <span>Default models ({count})</span>
        <ChevronDown size={12} className={"transition " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 border-t border-[var(--border)] p-2">
          {models.map((m) => (
            <span
              key={m.label}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]"
            >
              {m.label}
              {m.free !== false && (
                <span className="text-emerald-600">· Free</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelBrowsePanel({
  models,
  selected,
  onToggle,
  loading,
  error,
  isFree,
  excludeIds,
}: {
  models: BrowsableModel[];
  selected: string[];
  onToggle: (id: string) => void;
  loading: boolean;
  error: string | null;
  isFree?: (id: string) => boolean;
  excludeIds?: string[];
}) {
  const [filter, setFilter] = useState("");
  const [hidePaid, setHidePaid] = useState(Boolean(isFree));
  const excluded = new Set(excludeIds ?? []);

  const setHidePaidAndDisablePaid = (nextHidePaid: boolean) => {
    setHidePaid(nextHidePaid);
    if (!nextHidePaid || !isFree) return;

    for (const modelId of selected) {
      if (!isFree(modelId)) onToggle(modelId);
    }
  };

  const filtered = models
    .filter((m) => !excluded.has(m.id))
    .filter((m) => !isRemovedModelName(m.id))
    .filter((m) => m.id.toLowerCase().includes(filter.trim().toLowerCase()))
    .filter((m) => !(isFree && hidePaid) || isFree(m.id))
    .sort((a, b) => {
      if (isFree) {
        const freeDiff = Number(isFree(b.id)) - Number(isFree(a.id));
        if (freeDiff !== 0) return freeDiff;
      }
      return a.id.localeCompare(b.id);
    });

  return (
    <div className="space-y-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="relative">
        <Search
          size={11}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter models"
          className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] py-1 pl-6 pr-2 text-[11px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
        />
      </div>
      {isFree && (
        <label className="flex cursor-pointer items-center gap-1.5 px-0.5 text-[11px] text-[var(--fg-muted)]">
          <input
            type="checkbox"
            checked={hidePaid}
            onChange={(e) => setHidePaidAndDisablePaid(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Hide paid models
        </label>
      )}
      {error && <div className="text-[11px] text-[var(--error)]">{error}</div>}
      {loading ? (
        <div className="py-3 text-center text-[11px] text-[var(--fg-muted)]">Loading models…</div>
      ) : filtered.length === 0 ? (
        <div className="py-2 text-center text-[11px] text-[var(--fg-muted)]">
          {models.length === 0
            ? "No models found."
            : hidePaid && isFree
              ? "No free models match. Uncheck \u201cHide paid models\u201d to see more."
              : "No models match."}
        </div>
      ) : (
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {filtered.map((model) => {
            const checked = selected.includes(model.id);
            const free = isFree?.(model.id);
            return (
              <label
                key={model.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-[var(--fg)] hover:bg-[var(--bg-soft)]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(model.id)}
                  className="accent-[var(--accent)]"
                />
                <span className="truncate font-mono">{model.id}</span>
                {free && (
                  <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                    Free
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-[10px] font-medium " +
        (ok ? "bg-emerald-500/10 text-emerald-600" : "bg-[var(--bg-soft)] text-[var(--fg-muted)]")
      }
    >
      {label}
    </span>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!on);
      }}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-2 text-left text-xs text-[var(--fg)] transition hover:border-[var(--border-strong)]"
      aria-pressed={on}
    >
      <span className="font-medium">{label}</span>
      <span
        className={
          "relative h-5 w-9 shrink-0 rounded-full transition " +
          (on ? "bg-emerald-500" : "bg-[var(--border-strong)]")
        }
      >
        <span
          className={
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition " +
            (on ? "left-[18px]" : "left-0.5")
          }
        />
      </span>
    </button>
  );
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("keys");
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const opencodeBrowser = useModelBrowser();
  const groqBrowser = useModelBrowser();
  const cloudOllamaBrowser = useModelBrowser();
  const s = useSettings();
  const removeApiProviderModels = useChat((state) => state.removeApiProviderModels);
  const removeModelId = useChat((state) => state.removeModelId);

  const groqDefaultModels = MODEL_CATALOG.filter((m) => m.apiProvider === "groq").map((m) => ({
    label: m.shortLabel ?? m.label,
    free: m.free,
  }));
  const opencodeDefaultModels = Object.values(OPENCODE_KNOWN_MODELS).map((m) => ({
    label: m.shortLabel ?? m.label,
    free: m.free,
  }));
  const ollamaCloudDefaultModels = PRESET_CLOUD_OLLAMA_MODELS.map((m) => ({
    label: m.shortLabel ?? m.label,
    free: m.free ?? isFreeCloudOllamaModel(m.name),
  }));
  const groqDefaultModelIds = MODEL_CATALOG
    .filter((m) => m.apiProvider === "groq")
    .map((m) => m.id);
  const opencodeDefaultModelIds = Object.keys(OPENCODE_KNOWN_MODELS);
  const ollamaCloudDefaultModelIds = PRESET_CLOUD_OLLAMA_MODELS.map((m) => m.name);

  const browseOpencodeModels = () => {
    const params = new URLSearchParams();
    if (s.opencodeApiKey) params.set("apiKey", s.opencodeApiKey);
    opencodeBrowser.browse(`/api/opencode/models?${params.toString()}`);
  };

  const toggleOpencodeModel = (id: string) => {
    const has = s.opencodeModels.includes(id);
    s.setOpencodeModels(has ? s.opencodeModels.filter((m) => m !== id) : [...s.opencodeModels, id]);
    if (has) removeModelId(toOpenCodeModelId(id));
  };

  const browseGroqModels = () => {
    const params = new URLSearchParams();
    if (s.apiKey) params.set("apiKey", s.apiKey);
    groqBrowser.browse(`/api/groq/models?${params.toString()}`);
  };

  const toggleGroqModel = (id: string) => {
    const has = s.groqExtraModels.includes(id);
    s.setGroqExtraModels(has ? s.groqExtraModels.filter((m) => m !== id) : [...s.groqExtraModels, id]);
    if (has) removeModelId(`groq/${id}`);
  };

  const browseCloudOllamaModels = () => {
    const params = new URLSearchParams();
    if (s.ollamaCloudBaseUrl) params.set("baseUrl", s.ollamaCloudBaseUrl);
    if (s.ollamaApiKey) params.set("apiKey", s.ollamaApiKey);
    cloudOllamaBrowser.browse(
      `/api/ollama/models?${params.toString()}`,
      (models) => models.map((model) => ({ id: model.id || model.name || model.model || "" })).filter((model) => model.id)
    );
  };

  const toggleCloudOllamaModel = (id: string) => {
    const has = s.ollamaCloudModels.includes(id);
    s.setOllamaCloudModels(has ? s.ollamaCloudModels.filter((m) => m !== id) : [...s.ollamaCloudModels, id]);
    if (has) removeModelId(toCloudOllamaModelId(id));
  };

  const refreshLocalModels = async () => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const params = new URLSearchParams({ baseUrl: s.ollamaBaseUrl });
      if (s.ollamaApiKey) params.set("apiKey", s.ollamaApiKey);
      const res = await fetch(`/api/ollama/models?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        models?: LocalOllamaModel[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      s.setAvailableLocalModels(data.models ?? []);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalLoading(false);
    }
  };

  const setLocalEnabled = (enabled: boolean) => {
    s.setLocalEnabled(enabled);
    setLocalError(null);
    if (!enabled) removeApiProviderModels("ollama-local");
  };

  const setGroqEnabled = (enabled: boolean) => {
    s.setGroqEnabled(enabled);
    if (!enabled) removeApiProviderModels("groq");
  };

  const setOpencodeEnabled = (enabled: boolean) => {
    s.setOpencodeEnabled(enabled);
    if (!enabled) removeApiProviderModels("opencode");
  };

  const setCloudOllamaEnabled = (enabled: boolean) => {
    s.setCloudOllamaEnabled(enabled);
    if (!enabled) removeApiProviderModels("ollama-cloud");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:border-[var(--border-strong)]"
      >
        <SettingsIcon size={14} /> Settings
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-sm shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--fg)]">Settings</h2>
                <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                  {SETTINGS_TABS.find((t) => t.id === tab)?.hint}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close settings"
                className="-mr-1 rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-soft)] hover:text-[var(--fg)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-[var(--border)] px-5 py-3">
              <div
                role="tablist"
                aria-label="Settings sections"
                className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1"
              >
                {SETTINGS_TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.id)}
                      className={
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition " +
                        (active
                          ? "bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm"
                          : "text-[var(--fg-muted)] hover:text-[var(--fg)]")
                      }
                    >
                      <Icon size={13} className="shrink-0" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {tab === "keys" && (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[var(--fg)]">API providers</div>
                    <div className="text-[11px] text-[var(--fg-muted)]">Hosted APIs that run cloud models.</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <StatusPill
                      label={s.groqEnabled ? (s.apiKey ? "Groq ready" : "Groq key missing") : "Groq off"}
                      ok={s.groqEnabled && Boolean(s.apiKey)}
                    />
                    <StatusPill
                      label={s.bedrockEnabled ? (s.bedrockApiKey ? "Bedrock ready" : "Bedrock key missing") : "Bedrock off"}
                      ok={s.bedrockEnabled && Boolean(s.bedrockApiKey)}
                    />
                    <StatusPill
                      label={s.opencodeEnabled ? (s.opencodeApiKey ? "OpenCode ready" : "OpenCode key missing") : "OpenCode off"}
                      ok={s.opencodeEnabled && Boolean(s.opencodeApiKey)}
                    />
                    <StatusPill
                      label={s.cloudOllamaEnabled ? (s.ollamaApiKey ? "Ollama ready" : "Ollama key missing") : "Ollama off"}
                      ok={s.cloudOllamaEnabled && Boolean(s.ollamaApiKey)}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Toggle on={s.groqEnabled} onChange={setGroqEnabled} label="Enable Groq hosted models" />
                    <div className="text-[11px] text-[var(--fg-muted)]">
                      Fast hosted routes for GPT-OSS and Qwen model families.
                    </div>
                    {s.groqEnabled && (
                      <>
                        <label className="block text-xs font-medium text-[var(--fg)]">
                          Groq API key{" "}
                          <a
                            href="https://console.groq.com"
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                          >
                            get key <ExternalLink size={10} />
                          </a>
                        </label>
                        <input
                          type="password"
                          value={s.apiKey}
                          onChange={(e) => s.setApiKey(e.target.value)}
                          placeholder="gsk_..."
                          className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                        />
                        <DefaultModelsDisclosure
                          count={groqDefaultModels.length}
                          models={groqDefaultModels}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-[var(--fg-muted)]">
                            {s.groqExtraModels.length} extra model{s.groqExtraModels.length === 1 ? "" : "s"} imported
                          </span>
                          <button
                            type="button"
                            onClick={browseGroqModels}
                            disabled={groqBrowser.loading || !s.apiKey}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)] disabled:opacity-60"
                          >
                            <RefreshCw size={11} className={groqBrowser.loading ? "animate-spin" : ""} />
                            Browse models
                          </button>
                        </div>
                        {groqBrowser.open && (
                          <ModelBrowsePanel
                            models={groqBrowser.models}
                            selected={s.groqExtraModels}
                            onToggle={toggleGroqModel}
                            loading={groqBrowser.loading}
                            error={groqBrowser.error}
                            excludeIds={groqDefaultModelIds}
                          />
                        )}
                      </>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-[var(--border)] pt-4">
                    <Toggle
                      on={s.bedrockEnabled}
                      onChange={s.setBedrockEnabled}
                      label="Enable Amazon Bedrock models"
                    />
                    <div className="text-[11px] text-[var(--fg-muted)]">
                      GLM, Kimi, DeepSeek, Mistral and Qwen via the Bedrock project endpoint.
                    </div>
                    {s.bedrockEnabled && (
                      <>
                        <label className="block text-xs font-medium text-[var(--fg)]">
                          Bedrock API key{" "}
                          <a
                            href="https://console.aws.amazon.com/bedrock"
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                          >
                            get key <ExternalLink size={10} />
                          </a>
                        </label>
                        <input
                          type="password"
                          value={s.bedrockApiKey}
                          onChange={(e) => s.setBedrockApiKey(e.target.value)}
                          placeholder="ABSK... (long-term Bedrock API key)"
                          className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                        />
                        {s.bedrockApiKey.trim() && !/^ABSK.*=$/.test(s.bedrockApiKey.trim()) && (
                          <div className="text-[11px] text-amber-600">
                            Bedrock keys start with ABSK and end with =. This one looks truncated.
                          </div>
                        )}
                        <span className="text-[11px] text-[var(--fg-muted)]">
                          {s.bedrockModels.length} model{s.bedrockModels.length === 1 ? "" : "s"} imported
                        </span>
                      </>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-[var(--border)] pt-4">
                    <Toggle on={s.opencodeEnabled} onChange={setOpencodeEnabled} label="Enable OpenCode Zen models" />
                    <div className="text-[11px] text-[var(--fg-muted)]">
                      Free and low-cost routes curated by the OpenCode Zen gateway.
                    </div>
                    {s.opencodeEnabled && (
                      <>
                        <label className="block text-xs font-medium text-[var(--fg)]">
                          OpenCode API key{" "}
                          <a
                            href="https://opencode.ai/auth"
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                          >
                            get key <ExternalLink size={10} />
                          </a>
                        </label>
                        <input
                          type="password"
                          value={s.opencodeApiKey}
                          onChange={(e) => s.setOpencodeApiKey(e.target.value)}
                          placeholder="Your OpenCode Zen API key"
                          className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                        />
                        <DefaultModelsDisclosure
                          count={opencodeDefaultModels.length}
                          models={opencodeDefaultModels}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-[var(--fg-muted)]">
                            {s.opencodeModels.length} model{s.opencodeModels.length === 1 ? "" : "s"} imported
                          </span>
                          <button
                            type="button"
                            onClick={browseOpencodeModels}
                            disabled={opencodeBrowser.loading}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)] disabled:opacity-60"
                          >
                            <RefreshCw size={11} className={opencodeBrowser.loading ? "animate-spin" : ""} />
                            Browse models
                          </button>
                        </div>
                        {opencodeBrowser.open && (
                          <ModelBrowsePanel
                            models={opencodeBrowser.models}
                            selected={s.opencodeModels}
                            onToggle={toggleOpencodeModel}
                            loading={opencodeBrowser.loading}
                            error={opencodeBrowser.error}
                            isFree={(id) => OPENCODE_KNOWN_MODELS[id]?.free ?? false}
                            excludeIds={opencodeDefaultModelIds}
                          />
                        )}
                      </>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-[var(--border)] pt-4">
                    <Toggle on={s.cloudOllamaEnabled} onChange={setCloudOllamaEnabled} label="Enable Ollama hosted models" />
                    <div className="text-[11px] text-[var(--fg-muted)]">
                      Hosted ollama.com API routes for optional cloud models. Every plan (including
                      Free) can call every model — usage is metered against your plan&apos;s
                      allowance, and larger models use more of it, so these aren&apos;t simply
                      &quot;free&quot;.
                    </div>

                    {s.cloudOllamaEnabled && (
                      <>
                        <label className="block text-xs font-medium text-[var(--fg)]">
                          Ollama API URL
                        </label>
                        <input
                          value={s.ollamaCloudBaseUrl}
                          onChange={(e) => s.setOllamaCloudBaseUrl(e.target.value)}
                          placeholder="https://ollama.com"
                          className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                        />
                        <label className="block text-xs font-medium text-[var(--fg)]">
                          Ollama API key{" "}
                          <a
                            href="https://ollama.com/settings/keys"
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                          >
                            get key <ExternalLink size={10} />
                          </a>
                        </label>
                        <input
                          type="password"
                          value={s.ollamaApiKey}
                          onChange={(e) => s.setOllamaApiKey(e.target.value)}
                          placeholder="Your ollama.com API key"
                          className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                        />
                        <DefaultModelsDisclosure
                          count={ollamaCloudDefaultModels.length}
                          models={ollamaCloudDefaultModels}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-[var(--fg-muted)]">
                            {s.ollamaCloudModels.length} hosted model{s.ollamaCloudModels.length === 1 ? "" : "s"} imported
                          </span>
                          <button
                            type="button"
                            onClick={browseCloudOllamaModels}
                            disabled={cloudOllamaBrowser.loading}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)] disabled:opacity-60"
                          >
                            <RefreshCw size={11} className={cloudOllamaBrowser.loading ? "animate-spin" : ""} />
                            Browse models
                          </button>
                        </div>
                        {cloudOllamaBrowser.open && (
                          <ModelBrowsePanel
                            models={cloudOllamaBrowser.models}
                            selected={s.ollamaCloudModels}
                            onToggle={toggleCloudOllamaModel}
                            loading={cloudOllamaBrowser.loading}
                            error={cloudOllamaBrowser.error}
                            isFree={isFreeCloudOllamaModel}
                            excludeIds={ollamaCloudDefaultModelIds}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </section>
              )}

              {tab === "preferences" && (
                <>
                  <p className="text-[11px] text-[var(--fg-muted)]">
                    Higher effort uses more models per run for better answers, at more time and cost.
                  </p>
                  <ConsensusEffortSection />
                  <CouncilEffortSection />
                </>
              )}

              {tab === "keys" && <CustomProvidersSection />}

              {tab === "keys" && (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[var(--fg)]">Web search</div>
                    <div className="text-[11px] text-[var(--fg-muted)]">Tavily MCP shared by all models.</div>
                  </div>
                  <StatusPill
                    label={s.tavilyApiKey ? "Ready" : "Env or key needed"}
                    ok={Boolean(s.tavilyApiKey)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-medium text-[var(--fg-muted)]">
                    Tavily API key{" "}
                    <a
                      href="https://app.tavily.com/home"
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                    >
                      get key <ExternalLink size={10} />
                    </a>
                  </label>
                  <input
                    type="password"
                    value={s.tavilyApiKey}
                    onChange={(e) => s.setTavilyApiKey(e.target.value)}
                    placeholder="tvly-..."
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                  />
                  <div className="text-[11px] text-[var(--fg-muted)]">
                    Leave blank to use `TAVILY_API_KEY`, `tavilyApiKey`, or `TAVILY_MCP_URL` from `.env.local`.
                  </div>
                </div>
              </section>
              )}

              {tab === "keys" && (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[var(--fg)]">Local Ollama</div>
                    <div className="text-[11px] text-[var(--fg-muted)]">Use models installed on this machine.</div>
                  </div>
                  <StatusPill
                    label={s.localEnabled ? `${s.availableLocalModels.length} found` : "Off"}
                    ok={s.localEnabled && s.availableLocalModels.length > 0}
                  />
                </div>

                <div className="space-y-2">
                  <Toggle on={s.localEnabled} onChange={setLocalEnabled} label="Enable local Ollama models" />

                  {s.localEnabled && (
                    <>
                      <label className="block text-[11px] font-medium text-[var(--fg-muted)]">
                        Ollama base URL
                      </label>
                      <input
                        value={s.ollamaBaseUrl}
                        onChange={(e) => s.setOllamaBaseUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[var(--fg-muted)]">
                          {s.availableLocalModels.length} installed model{s.availableLocalModels.length === 1 ? "" : "s"} detected
                        </span>
                        <button
                          type="button"
                          onClick={refreshLocalModels}
                          disabled={localLoading}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)] disabled:opacity-60"
                        >
                          <RefreshCw size={11} className={localLoading ? "animate-spin" : ""} />
                          Refresh
                        </button>
                      </div>
                      {localError && (
                        <div className="rounded border border-[var(--error)]/40 bg-[var(--bg-soft)] px-2 py-1.5 text-[11px] text-[var(--error)]">
                          {localError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Effort selector for one mode (consensus or council). Levels the current model
// pool cannot staff are rendered disabled with the reason, rather than hidden —
// otherwise a user who adds a provider key has no idea new tiers just unlocked.
function EffortPicker({
  value,
  onChange,
  options,
  poolSize,
  activeSummary,
  clamped,
}: {
  value: EffortLevel;
  onChange: (level: EffortLevel) => void;
  options: EffortOption[];
  poolSize: number;
  activeSummary: string;
  clamped: boolean;
}) {
  const [infoFor, setInfoFor] = useState<EffortLevel | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {options.map((option) => {
          const selected = option.level === value;
          return (
            <div key={option.level} className="flex-1">
              <button
                type="button"
                disabled={!option.available}
                onClick={() => onChange(option.level)}
                aria-pressed={selected}
                title={
                  option.available
                    ? option.summary
                    : `Needs ${option.minModels} eligible models — you have ${poolSize}.`
                }
                className={
                  "w-full rounded-md border px-2 py-1.5 text-[11px] font-medium transition " +
                  (selected
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--fg)]"
                    : "border-[var(--border)] bg-[var(--bg-soft)] text-[var(--fg-muted)] hover:border-[var(--border-strong)]") +
                  (option.available ? "" : " cursor-not-allowed opacity-45")
                }
              >
                {option.label}
              </button>
              <button
                type="button"
                onClick={() => setInfoFor((cur) => (cur === option.level ? null : option.level))}
                aria-expanded={infoFor === option.level}
                aria-label={`What ${option.label} changes`}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded text-[10px] text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]"
              >
                <Info size={10} />
                {option.available ? "details" : `needs ${option.minModels}`}
              </button>
            </div>
          );
        })}
      </div>

      {infoFor && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-2">
          <div className="mb-1 text-[11px] font-semibold text-[var(--fg)]">
            {options.find((o) => o.level === infoFor)?.label}
          </div>
          <ul className="space-y-0.5">
            {options
              .find((o) => o.level === infoFor)
              ?.details.map((line) => (
                <li key={line} className="text-[11px] leading-snug text-[var(--fg-muted)]">
                  • {line}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="text-[11px] text-[var(--fg-muted)]">
        {clamped ? (
          <span className="text-amber-600">
            Only {poolSize} eligible model{poolSize === 1 ? "" : "s"} available, so this run uses{" "}
            {activeSummary.charAt(0).toLowerCase() + activeSummary.slice(1)}
          </span>
        ) : (
          activeSummary
        )}
      </div>
    </div>
  );
}

// Consensus and council are tuned independently: they have different bottlenecks
// (one long-context synthesis pass vs. a many-round multi-model debate), so a
// single shared "effort" slider would over- or under-spend on one of them.
function EffortSection({
  title,
  description,
  poolSize,
  blocker,
  children,
}: {
  title: string;
  description: string;
  poolSize: number;
  blocker: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[var(--fg)]">{title}</div>
          <div className="text-[11px] text-[var(--fg-muted)]">{description}</div>
        </div>
        <StatusPill label={`${poolSize} eligible`} ok={poolSize > 0} />
      </div>

      {poolSize === 0 ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[11px] text-[var(--fg-muted)]">
          {blocker}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function ConsensusEffortSection() {
  const settings = useSettings((s) => s);
  const setConsensusEffort = useSettings((s) => s.setConsensusEffort);

  const plan = useMemo(() => planConsensusRun(settings), [settings]);
  const poolSize = plan.pool.length;

  return (
    <EffortSection
      title="Consensus effort"
      description="One synthesizer reads every answer and writes the final one."
      poolSize={poolSize}
      blocker={plan.blockers[0] ?? "Add a provider key to enable consensus."}
    >
      <EffortPicker
        value={settings.consensusEffort}
        onChange={setConsensusEffort}
        options={plan.consensusEffortOptions}
        poolSize={poolSize}
        activeSummary={plan.consensusEffort.summary}
        clamped={plan.consensusEffortClamped}
      />
    </EffortSection>
  );
}

function CouncilEffortSection() {
  const settings = useSettings((s) => s);
  const setCouncilEffort = useSettings((s) => s.setCouncilEffort);

  const plan = useMemo(() => planConsensusRun(settings), [settings]);
  const poolSize = plan.pool.length;

  return (
    <EffortSection
      title="Council effort"
      description="Models debate each other in rounds, then judges rule on it."
      poolSize={poolSize}
      blocker={plan.blockers[0] ?? "Add a provider key to enable council."}
    >
      <EffortPicker
        value={settings.councilEffort}
        onChange={setCouncilEffort}
        options={plan.councilEffortOptions}
        poolSize={poolSize}
        activeSummary={plan.councilEffort.summary}
        clamped={plan.councilEffortClamped}
      />
    </EffortSection>
  );
}

function CustomProvidersSection() {
  const customProviders = useSettings((s) => s.customProviders);
  const addCustomProvider = useSettings((s) => s.addCustomProvider);
  const updateCustomProvider = useSettings((s) => s.updateCustomProvider);
  const removeCustomProvider = useSettings((s) => s.removeCustomProvider);

  const addProvider = () =>
    addCustomProvider({
      id: uid(),
      name: "",
      baseUrl: "",
      apiKey: "",
      models: [],
    });

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[var(--fg)]">Custom providers</div>
          <div className="text-[11px] text-[var(--fg-muted)]">
            Add any OpenAI-compatible API (OpenRouter, Together, Mistral, vLLM…).
          </div>
        </div>
        <StatusPill label={`${customProviders.length} added`} ok={customProviders.length > 0} />
      </div>

      <div className="space-y-3">
        {customProviders.map((provider) => (
          <CustomProviderEditor
            key={provider.id}
            provider={provider}
            onChange={(patch) => updateCustomProvider(provider.id, patch)}
            onRemove={() => removeCustomProvider(provider.id)}
          />
        ))}

        <button
          type="button"
          onClick={addProvider}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)]"
        >
          <Plus size={12} /> Add custom provider
        </button>
      </div>
    </section>
  );
}

function CustomProviderEditor({
  provider,
  onChange,
  onRemove,
}: {
  provider: CustomProvider;
  onChange: (patch: Partial<CustomProvider>) => void;
  onRemove: () => void;
}) {
  const browser = useModelBrowser();

  const browseModels = () => {
    const params = new URLSearchParams({ baseUrl: provider.baseUrl });
    if (provider.apiKey) params.set("apiKey", provider.apiKey);
    browser.browse(`/api/custom/models?${params.toString()}`);
  };

  const toggleModel = (id: string) => {
    const has = provider.models.includes(id);
    onChange({ models: has ? provider.models.filter((m) => m !== id) : [...provider.models, id] });
  };

  const inputClass =
    "w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]";
  return (
    <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-2.5">
      <div className="flex items-center gap-2">
        <input
          value={provider.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Provider name (e.g. OpenRouter)"
          className={inputClass}
        />
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1.5 text-[var(--fg-muted)] hover:bg-[var(--bg)] hover:text-[var(--error)]"
          title="Remove provider"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <input
        value={provider.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder="Base URL (e.g. https://openrouter.ai/api/v1)"
        className={inputClass}
      />
      <input
        type="password"
        value={provider.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder="API key (optional for local servers)"
        className={inputClass}
      />
      <textarea
        value={provider.models.join("\n")}
        onChange={(e) =>
          onChange({
            models: e.target.value
              .split(/[\n,]+/)
              .map((m) => m.trim())
              .filter(Boolean),
          })
        }
        placeholder="Model IDs, one per line (e.g. gpt-4o-mini)"
        rows={2}
        className={inputClass + " resize-y font-mono"}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--fg-muted)]">
          {provider.models.length} model{provider.models.length === 1 ? "" : "s"} added
        </span>
        <button
          type="button"
          onClick={browseModels}
          disabled={browser.loading || !provider.baseUrl.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)] disabled:opacity-60"
        >
          <RefreshCw size={11} className={browser.loading ? "animate-spin" : ""} />
          Browse models
        </button>
      </div>
      {browser.open && (
        <ModelBrowsePanel
          models={browser.models}
          selected={provider.models}
          onToggle={toggleModel}
          loading={browser.loading}
          error={browser.error}
        />
      )}
    </div>
  );
}
