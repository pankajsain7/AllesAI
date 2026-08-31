"use client";

import { useMemo } from "react";
import {
  MODEL_CATALOG,
  buildModelFamilies,
  getCustomProviderModelInfos,
  getCloudOllamaModelInfos,
  getCloudOllamaModelNames,
  getGroqExtraModelInfos,
  getLocalOllamaModelInfo,
  getModelFamilyId,
  getOpenCodeModelInfos,
  type ModelFamily,
} from "@/lib/models";
import { isRemovedModelName } from "@/lib/model-rules";
import {
  isApiProviderEnabled,
  useChat,
  useSettings,
  type ProviderToggleSettings,
} from "@/lib/store";
import { ProviderIcon } from "./ProviderIcon";
import { Check } from "lucide-react";

export function SingleModelPicker({
  convId,
  onPick,
}: {
  convId: string;
  onPick?: () => void;
}) {
  const conv = useChat((s) => s.conversations[convId]);
  const setSingleModel = useChat((s) => s.setSingleModel);
  const groqEnabled = useSettings((s) => s.groqEnabled);
  const bedrockEnabled = useSettings((s) => s.bedrockEnabled);
  const opencodeEnabled = useSettings((s) => s.opencodeEnabled);
  const localEnabled = useSettings((s) => s.localEnabled);
  const cloudOllamaEnabled = useSettings((s) => s.cloudOllamaEnabled);
  const ollamaCloudModels = useSettings((s) => s.ollamaCloudModels);
  const availableLocalModels = useSettings((s) => s.availableLocalModels);
  const customProviders = useSettings((s) => s.customProviders);
  const opencodeModels = useSettings((s) => s.opencodeModels);
  const groqExtraModels = useSettings((s) => s.groqExtraModels);

  const enabledSettings = useMemo<ProviderToggleSettings>(
    () => ({ groqEnabled, bedrockEnabled, opencodeEnabled, cloudOllamaEnabled, localEnabled }),
    [bedrockEnabled, cloudOllamaEnabled, groqEnabled, localEnabled, opencodeEnabled]
  );

  const families = useMemo(() => {
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
    return buildModelFamilies([
      ...baseRoutes,
      ...opencodeRoutes,
      ...groqExtraRoutes,
      ...hostedOllamaRoutes,
      ...localRoutes,
      ...customRoutes,
    ]);
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
    ollamaCloudModels,
  ]);

  if (!conv) return null;

  const selectedId = conv.selectedModels[0];

  const pick = (family: ModelFamily) => {
    const route =
      family.routes.find((r) => isApiProviderEnabled(r.apiProvider, enabledSettings)) ??
      family.routes[0];
    if (!route) return;
    setSingleModel(convId, route.id);
    onPick?.();
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="text-xl font-semibold text-[var(--fg)]">Choose a model</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Pick one model to chat with. You can switch any time.
        </p>

        {families.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-[var(--border)] px-3 py-10 text-center text-sm text-[var(--fg-muted)]">
            No models available. Enable a provider in Settings.
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {families.map((family) => {
              const route =
                family.routes.find((r) => isApiProviderEnabled(r.apiProvider, enabledSettings)) ??
                family.routes[0];
              const capability = route?.bestFor || family.category;
              const active = selectedId
                ? getModelFamilyId(selectedId) === family.familyId
                : false;
              return (
                <button
                  key={family.familyId}
                  type="button"
                  onClick={() => pick(family)}
                  className={
                    "group flex items-center gap-3 rounded-xl border p-3 text-left transition " +
                    (active
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-soft)]")
                  }
                >
                  <div className="shrink-0 rounded-lg">
                    <ProviderIcon provider={family.provider} size={30} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-[var(--fg)]">
                        {family.label}
                      </span>
                      {active && <Check size={14} className="shrink-0 text-[var(--accent)]" />}
                    </div>
                    {capability && (
                      <p className="mt-0.5 truncate text-xs text-[var(--fg-muted)]">{capability}</p>
                    )}
                  </div>
                  {family.thinking && (
                    <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]">
                      Reasoning
                    </span>
                  )}
                  {family.vision && !family.thinking && (
                    <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]">
                      Vision
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
