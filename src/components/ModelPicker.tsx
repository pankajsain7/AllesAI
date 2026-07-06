"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  MODEL_CATALOG,
  buildModelFamilies,
  getCustomProviderModelInfos,
  getCloudOllamaModelInfos,
  getCloudOllamaModelNames,
  getGeminiExtraModelInfos,
  getGroqExtraModelInfos,
  getLocalOllamaModelInfo,
  getModel,
  getModelFamilyId,
  getOpenCodeModelInfos,
  isCloudOllamaModelId,
  isOllamaModelId,
  type ModelFamily,
  type ModelInfo,
} from "@/lib/models";
import {
  API_PROVIDERS,
  PROVIDERS,
} from "@/lib/providers";
import { isRemovedModelName } from "@/lib/model-rules";
import {
  isApiProviderEnabled,
  useChat,
  useSettings,
  type ProviderToggleSettings,
} from "@/lib/store";
import { ApiProviderIcon, ProviderIcon } from "./ProviderIcon";
import {
  Check,
  ChevronDown,
  Search,
  Sliders,
  X,
} from "lucide-react";

export function ModelPicker({ convId }: { convId: string }) {
  const conv = useChat((s) => s.conversations[convId]);
  const setSelectedModels = useChat((s) => s.setSelectedModels);
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const enabledSettings = useMemo<ProviderToggleSettings>(
    () => ({
      groqEnabled,
      geminiEnabled,
      opencodeEnabled,
      cloudOllamaEnabled,
      localEnabled,
    }),
    [cloudOllamaEnabled, geminiEnabled, groqEnabled, localEnabled, opencodeEnabled]
  );

  const baseRoutes = useMemo(
    () =>
      MODEL_CATALOG.filter((route) =>
        isApiProviderEnabled(route.apiProvider, enabledSettings)
      ),
    [enabledSettings]
  );

  const hostedOllamaRoutes = useMemo(
    () =>
      cloudOllamaEnabled
        ? getCloudOllamaModelInfos(getCloudOllamaModelNames(ollamaCloudModels))
        : [],
    [cloudOllamaEnabled, ollamaCloudModels]
  );

  const localRoutes = useMemo(() => {
    if (!localEnabled) return [];
    return availableLocalModels
      .filter((model) => !isRemovedModelName(model.name))
      .map((model) => getLocalOllamaModelInfo(model.name));
  }, [availableLocalModels, localEnabled]);

  const customRoutes = useMemo(
    () => getCustomProviderModelInfos(customProviders),
    [customProviders]
  );

  const opencodeRoutes = useMemo(
    () => (opencodeEnabled ? getOpenCodeModelInfos(opencodeModels) : []),
    [opencodeEnabled, opencodeModels]
  );

  const groqExtraRoutes = useMemo(
    () => (groqEnabled ? getGroqExtraModelInfos(groqExtraModels) : []),
    [groqEnabled, groqExtraModels]
  );

  const geminiExtraRoutes = useMemo(
    () => (geminiEnabled ? getGeminiExtraModelInfos(geminiExtraModels) : []),
    [geminiEnabled, geminiExtraModels]
  );

  const families = useMemo(
    () =>
      buildModelFamilies([
        ...baseRoutes,
        ...opencodeRoutes,
        ...groqExtraRoutes,
        ...geminiExtraRoutes,
        ...hostedOllamaRoutes,
        ...localRoutes,
        ...customRoutes,
      ]),
    [baseRoutes, opencodeRoutes, groqExtraRoutes, geminiExtraRoutes, hostedOllamaRoutes, localRoutes, customRoutes]
  );

  const availableFamilyIds = useMemo(
    () => new Set(families.map((family) => family.familyId)),
    [families]
  );

  if (!conv) return null;

  const activeSelectedModels = conv.selectedModels.filter((id) => {
    const model = getModel(id);
    if (!model) return false;
    if (!isApiProviderEnabled(model.apiProvider, enabledSettings)) return false;
    return availableFamilyIds.has(getModelFamilyId(id));
  });

  const activeByFamily = new Map<string, string>();
  for (const id of activeSelectedModels) {
    activeByFamily.set(getModelFamilyId(id), id);
  }
  const activeSelectedFamilyCount = activeByFamily.size;

  const visibleFamilies = families.filter((family) => matchesQuery(family, query));
  const selectedLocalCount = activeSelectedModels.filter(isOllamaModelId).length;
  const selectedCloudCount = activeSelectedModels.filter(isCloudOllamaModelId).length;

  const setFamilyRoute = (family: ModelFamily, routeId: string | null) => {
    const next: string[] = [];
    let handled = false;

    for (const selectedId of conv.selectedModels) {
      if (getModelFamilyId(selectedId) !== family.familyId) {
        next.push(selectedId);
        continue;
      }

      if (!handled && routeId) next.push(routeId);
      handled = true;
    }

    if (!handled && routeId) next.push(routeId);
    // Keep at least one model selected via the picker UI.
    if (next.length === 0) return;
    setSelectedModels(convId, next);
  };

  const isRouteAvailable = (route: ModelInfo) => {
    return isApiProviderEnabled(route.apiProvider, enabledSettings);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--fg)] hover:border-[var(--border-strong)]"
      >
        <Sliders size={12} />
        <span className="hidden sm:inline">Models</span>
        <span className="rounded-full bg-[var(--bg-soft)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
          {activeSelectedFamilyCount}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl"
          >
            <div className="border-b border-[var(--border)] px-5 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Models</h2>
                  <p className="text-xs text-[var(--fg-muted)]">
                    Pick model families and choose where each one runs.
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-soft)]"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-subtle)]"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] py-2 pl-8 pr-2 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)]"
                  />
                </div>
                <span className="text-[11px] text-[var(--fg-muted)]">
                  {visibleFamilies.length} available
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-16 pt-2">
              {visibleFamilies.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--fg-muted)]">
                  No model families match your search.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {visibleFamilies.map((family) => {
                    const activeId = activeByFamily.get(family.familyId);
                    const activeRoute = activeId ? getModel(activeId) : undefined;
                    const enabled = Boolean(activeRoute);
                    const defaultRoute =
                      activeRoute ??
                      family.routes.find(isRouteAvailable) ??
                      family.routes[0];

                    return (
                      <ModelFamilyRow
                        key={family.familyId}
                        family={family}
                        activeId={activeId}
                        enabled={enabled}
                        disableToggleOff={enabled && activeSelectedFamilyCount <= 1}
                        defaultRoute={defaultRoute}
                        isRouteAvailable={isRouteAvailable}
                        routeUnavailableReason={(route) =>
                          routeUnavailableReason(route, localEnabled, cloudOllamaEnabled)
                        }
                        onRoutePick={(routeId) => setFamilyRoute(family, routeId)}
                        onToggle={(nextEnabled) => {
                          if (nextEnabled) {
                            const nextRoute =
                              family.routes.find(isRouteAvailable) ?? family.routes[0];
                            if (nextRoute && isRouteAvailable(nextRoute)) {
                              setFamilyRoute(family, nextRoute.id);
                            }
                          } else {
                            setFamilyRoute(family, null);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-soft)] px-5 py-3">
              <span className="text-xs text-[var(--fg-muted)]">
                {activeSelectedFamilyCount} model famil{activeSelectedFamilyCount === 1 ? "y" : "ies"} selected
                {selectedLocalCount > 0 && ` - ${selectedLocalCount} local`}
                {selectedCloudCount > 0 && ` - ${selectedCloudCount} Ollama`}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModelFamilyRow({
  family,
  activeId,
  enabled,
  disableToggleOff,
  defaultRoute,
  isRouteAvailable,
  routeUnavailableReason,
  onRoutePick,
  onToggle,
}: {
  family: ModelFamily;
  activeId?: string;
  enabled: boolean;
  disableToggleOff?: boolean;
  defaultRoute: ModelInfo;
  isRouteAvailable: (route: ModelInfo) => boolean;
  routeUnavailableReason: (route: ModelInfo) => string | null;
  onRoutePick: (routeId: string) => void;
  onToggle: (enabled: boolean) => void;
}) {
  const activeRoute = activeId ? getModel(activeId) : undefined;
  const routeForLabel = activeRoute ?? defaultRoute;
  const activeUnavailable = activeRoute && !isRouteAvailable(activeRoute);
  const contextLabel = formatContext(family.context);
  const detailParts = [
    contextLabel,
    family.category,
    family.vision ? "Vision" : null,
    family.thinking ? "Thinking" : null,
    activeUnavailable ? "Source unavailable" : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className={
        "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border bg-[var(--bg)] p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center " +
        (enabled
          ? "border-[var(--border-strong)]"
          : "border-[var(--border)]")
      }
    >
      <ProviderIcon provider={family.provider} size={34} />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-[var(--fg)]">
            {family.label}
          </span>
          {family.routes.length > 1 && (
            <span className="rounded bg-[var(--bg-soft)] px-1.5 py-0.5 text-[10px] text-[var(--fg-subtle)]">
              {family.routes.length} providers
            </span>
          )}
        </div>
        {detailParts.length > 0 && (
          <div className="mt-0.5 truncate text-[11px] text-[var(--fg-muted)]">
            {detailParts.join(" • ")}
          </div>
        )}
      </div>

      <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
        <RouteDropdown
          family={family}
          activeId={activeId}
          labelRoute={routeForLabel}
          isRouteAvailable={isRouteAvailable}
          routeUnavailableReason={routeUnavailableReason}
          onPick={onRoutePick}
        />

        <Toggle
          on={enabled}
          onChange={onToggle}
          disabled={(!enabled && !isRouteAvailable(defaultRoute)) || (enabled && disableToggleOff)}
        />
      </div>
    </div>
  );
}

function RouteDropdown({
  family,
  activeId,
  labelRoute,
  isRouteAvailable,
  routeUnavailableReason,
  onPick,
}: {
  family: ModelFamily;
  activeId?: string;
  labelRoute: ModelInfo;
  isRouteAvailable: (route: ModelInfo) => boolean;
  routeUnavailableReason: (route: ModelInfo) => string | null;
  onPick: (routeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const source = API_PROVIDERS[labelRoute.apiProvider];

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const button = buttonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(288, viewportWidth - 16);
      const left = Math.min(
        Math.max(8, rect.right - width),
        Math.max(8, viewportWidth - width - 8)
      );
      const estimatedHeight = Math.min(320, family.routes.length * 66 + 8);
      const spaceBelow = viewportHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(
        144,
        Math.min(estimatedHeight, placeAbove ? spaceAbove : spaceBelow)
      );
      const top = placeAbove
        ? Math.max(8, rect.top - availableHeight - 6)
        : Math.min(rect.bottom + 6, viewportHeight - availableHeight - 8);

      setMenuStyle({
        top,
        left,
        width,
        maxHeight: availableHeight,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [family.routes.length, open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 min-w-[108px] items-center justify-between gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[11px] text-[var(--fg)] hover:border-[var(--border-strong)]"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <ApiProviderIcon provider={labelRoute.apiProvider} size={16} />
          <span className="truncate">{source.shortName}</span>
        </span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[70] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-xl"
            style={menuStyle ?? { visibility: "hidden" }}
          >
            {family.routes.map((route) => {
              const available = isRouteAvailable(route);
              const selected = activeId === route.id;
              const providerInfo = API_PROVIDERS[route.apiProvider];
              const unavailable = routeUnavailableReason(route);

              return (
                <button
                  key={route.id}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    if (!available) return;
                    onPick(route.id);
                    setOpen(false);
                  }}
                  className={
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-soft)] disabled:cursor-not-allowed disabled:opacity-50 " +
                    (selected ? "bg-[var(--bg-soft)]" : "")
                  }
                >
                  <ApiProviderIcon provider={route.apiProvider} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--fg)]">{providerInfo.shortName}</span>
                      {selected && <Check size={12} className="text-[var(--accent)]" />}
                    </div>
                    <div className="truncate text-[10px] text-[var(--fg-muted)]">
                      {unavailable ?? (route.free ? "Free" : route.accessLabel ?? "Paid")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      disabled={disabled}
      className={
        "relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 " +
        (on ? "bg-emerald-500" : "bg-[var(--border-strong)]")
      }
      aria-pressed={on}
    >
      <span
        className={
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition " +
          (on ? "left-[18px]" : "left-0.5")
        }
      />
    </button>
  );
}

function routeUnavailableReason(
  route: ModelInfo,
  localEnabled: boolean,
  cloudOllamaEnabled: boolean
): string | null {
  if (route.apiProvider === "ollama-local" && !localEnabled) return "Enable local models";
  if (route.apiProvider === "ollama-cloud" && !cloudOllamaEnabled) return "Enable Ollama";
  return null;
}

function matchesQuery(family: ModelFamily, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const provider = PROVIDERS[family.provider];
  const haystack = [
    family.label,
    family.shortLabel,
    family.category,
    provider.name,
    ...family.routes.flatMap((route) => [
      route.id,
      route.label,
      route.bestFor,
      route.accessLabel,
      route.accessHint,
      route.paramSize,
      route.routeHint,
      API_PROVIDERS[route.apiProvider].name,
      API_PROVIDERS[route.apiProvider].shortName,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function formatContext(context: number): string | null {
  if (!context) return null;
  if (context >= 1_000_000) return `${Math.round(context / 1_000_000)}M context`;
  return `${Math.round(context / 1000)}K context`;
}
