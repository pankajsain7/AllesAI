"use client";

import { useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Sparkles, Users, X } from "lucide-react";
import {
  filterEnabledModelIds,
  useChat,
  useSettings,
  type ProviderToggleSettings,
  type SharedResultJudge,
  type SharedResultScore,
} from "@/lib/store";
import { getModel } from "@/lib/models";
import {
  canUseModelForConsensus,
  getModelAlias,
  hasProviderAccessForConsensus,
} from "@/lib/model-rules";
import { planConsensusRun } from "@/lib/consensus-plan";
import { API_PROVIDERS } from "@/lib/providers";
import { Markdown } from "./Markdown";
import { SharedResultCard } from "./SharedResultsLane";

type ConsensusChoice = {
  id: string;
  model: NonNullable<ReturnType<typeof getModel>>;
};

// If the upstream provider stalls (no bytes at all for this long), abort and
// try the next fallback model.
const CONSENSUS_STALL_TIMEOUT_MS = 30_000; // single synthesizer — fast or fallback
const COUNCIL_STALL_TIMEOUT_MS = 60_000;  // council rounds can legitimately pause longer

type ConsensusMode = "single" | "council";


type ConsensusStreamEvent =
  | { type: "delta"; text?: string }
  | { type: "judge"; model?: string; winner?: string; confidence?: string; rankings?: SharedResultJudge["rankings"] }
  | { type: "judge_error"; message?: string }
  | { type: "status"; modelId?: string; model?: string; status?: string; round?: string; message?: string; replacementModelId?: string; replacementModel?: string }
  | { type: "round_start"; round?: string; title?: string }
  | { type: "council_note"; round?: string; roundTitle?: string; modelId?: string; model?: string; text?: string }
  | { type: "ping" }
  | { type: "error"; message?: string }
  | { type: "done" };

export function ConsensusButton({ convId }: { convId: string }) {
  const conv = useChat((s) => s.conversations[convId]);
  const saveConsensus = useChat((s) => s.saveConsensus);
  const startSharedResult = useChat((s) => s.startSharedResult);
  const appendSharedResultContent = useChat((s) => s.appendSharedResultContent);
  const finishSharedResult = useChat((s) => s.finishSharedResult);
  const startCouncilRound = useChat((s) => s.startCouncilRound);
  const upsertCouncilStatus = useChat((s) => s.upsertCouncilStatus);
  const addCouncilNote = useChat((s) => s.addCouncilNote);
  const setSharedResultJudge = useChat((s) => s.setSharedResultJudge);
  const apiKey = useSettings((s) => s.apiKey);
  const groqEnabled = useSettings((s) => s.groqEnabled);
  const geminiApiKey = useSettings((s) => s.geminiApiKey);
  const geminiEnabled = useSettings((s) => s.geminiEnabled);
  const opencodeApiKey = useSettings((s) => s.opencodeApiKey);
  const opencodeEnabled = useSettings((s) => s.opencodeEnabled);
  const ollamaBaseUrl = useSettings((s) => s.ollamaBaseUrl);
  const ollamaApiKey = useSettings((s) => s.ollamaApiKey);
  const ollamaCloudBaseUrl = useSettings((s) => s.ollamaCloudBaseUrl);
  const localEnabled = useSettings((s) => s.localEnabled);
  const webSearchEnabled = useSettings((s) => s.webSearch);
  const cloudOllamaEnabled = useSettings((s) => s.cloudOllamaEnabled);
  const saveConsensusToChat = useSettings((s) => s.saveConsensusToChat);

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
  const accessSettings = useMemo(
    () => ({
      apiKey,
      groqEnabled,
      geminiApiKey,
      geminiEnabled,
      opencodeApiKey,
      opencodeEnabled,
      ollamaApiKey,
      cloudOllamaEnabled,
      localEnabled,
    }),
    [apiKey, cloudOllamaEnabled, geminiApiKey, geminiEnabled, groqEnabled, localEnabled, ollamaApiKey, opencodeApiKey, opencodeEnabled]
  );

  const settingsSnapshot = useSettings((s) => s);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<ConsensusMode>("single");
  const [fullscreen, setFullscreen] = useState(false);

  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const activeResult = useChat((s) =>
    activeResultId
      ? s.conversations[convId]?.sharedResults?.find((result) => result.id === activeResultId)
      : undefined
  );
  const abortRef = useRef<AbortController | null>(null);

  // Single source of truth for "which providers have keys, which models are
  // usable, and who plays which role". See lib/consensus-plan.ts.
  const plan = useMemo(
    () => planConsensusRun({ ...settingsSnapshot, ...accessSettings }),
    [settingsSnapshot, accessSettings]
  );
  const modelCandidates = useMemo<ConsensusChoice[]>(
    () => plan.pool.map((entry) => ({ id: entry.id, model: entry.model })),
    [plan]
  );

  if (!conv) return null;

  const disabled = new Set(conv.disabledModels ?? []);
  const activeCandidateIds = (conv.focusedModel ? [conv.focusedModel] : conv.selectedModels).filter(
    (id) => !disabled.has(id)
  );
  const activeModelIds = filterEnabledModelIds(activeCandidateIds, enabledSettings);
  const hasPendingModels = activeModelIds.some((modelId) =>
    conv.threads[modelId]?.messages.some((message) => message.role === "assistant" && message.pending)
  );

  // Roles come straight from the plan: the synthesizer is the highest-tier
  // largest-context model the user actually has access to.
  const modelCandidateIds = new Set(modelCandidates.map((choice) => choice.id));
  const selectedConsensusModel = plan.synthesizer ?? "";
  const consensusInfo = getModel(selectedConsensusModel);
  const consensusSource = consensusInfo ? API_PROVIDERS[consensusInfo.apiProvider] : undefined;

  // Provider-diverse backup bench. The server walks it silently on failure,
  // stall, or context overflow so the user always gets an answer.
  const autoFallbackModels = plan.synthesizerBackups;

  const responses: { model: string; content: string }[] = [];
  const respondingModelIds: string[] = [];
  let latestPrompt = "";
  for (const modelId of activeModelIds) {
    const t = conv.threads[modelId];
    if (!t) continue;
    let lastUser = "";
    let lastAsst = "";
    for (const m of t.messages) {
      if (m.role === "user") lastUser = m.content;
      else if (m.role === "assistant" && !m.pending && !m.error && m.content.trim()) {
        lastAsst = m.content;
      }
    }
    if (lastUser && lastAsst) {
      latestPrompt = lastUser;
      const info = getModel(modelId);
      responses.push({ model: info ? getModelAlias(info) : getModelAlias(modelId), content: lastAsst });
      respondingModelIds.push(modelId);
    }
  }

  // Council roles from the plan: two provider-diverse debaters, an independent
  // judge panel kept off the debate floor, and everything else on the bench.
  const selectedDebaterIds = plan.debaters.filter((id) => modelCandidateIds.has(id));
  const selectedJudgeIds = plan.judges.filter((id) => modelCandidateIds.has(id));
  const councilFallbackModels = plan.councilBackups;

  const hasAnyResponse = responses.length >= 1;
  const hasConsensusSource = Boolean(
    consensusInfo &&
      hasProviderAccessForConsensus(consensusInfo.apiProvider, accessSettings) &&
      canUseModelForConsensus(consensusInfo)
  );
  const canRunConsensus = hasAnyResponse && hasConsensusSource && !hasPendingModels;
  const canRunCouncil =
    hasAnyResponse &&
    !hasPendingModels &&
    modelCandidates.length >= 1;
  const consensusDisabledReason = hasPendingModels
    ? "Waiting for all models to finish"
    : !hasAnyResponse
      ? "Need at least one completed answer"
      : !selectedConsensusModel
        ? plan.blockers[0] ?? "No eligible consensus model — add a provider key in Settings"
        : !hasConsensusSource && consensusSource
          ? `Add ${consensusSource.name} key or enable provider`
          : "Consensus unavailable";
  const councilDisabledReason = hasPendingModels
    ? "Waiting for all models to finish"
    : !hasAnyResponse
      ? "Need at least one completed answer as debate material"
      : modelCandidates.length < 1
        ? plan.blockers[0] ?? "No eligible models — add a provider key in Settings"
        : "Model council unavailable";

  const persistConsensus = (content: string) => {
    const modelId = runMode === "council" ? "model-council" : selectedConsensusModel;
    if (!content.trim() || saved || !modelId) return;
    saveConsensus(convId, content, modelId);
    setSaved(true);
  };

  const runConsensus = async (mode: ConsensusMode = "single") => {
    setRunMode(mode);
    setError(null);
    setText("");
    setSaved(false);
    setFullscreen(false);
    setOpen(true);

    if (hasPendingModels) {
      setError("Waiting for all models to finish.");
      return;
    }
    if (mode === "single" && !hasAnyResponse) {
      setError("Need at least one completed answer.");
      return;
    }
    if (mode === "council" && !hasAnyResponse) {
      setError("Model council needs at least one completed answer as debate material.");
      return;
    }
    if (mode === "single" && !selectedConsensusModel) {
      setError(
        plan.blockers[0] ??
          "No eligible consensus model is selected. Add a provider key in Settings."
      );
      return;
    }
    if (mode === "single" && !hasConsensusSource) {
      setError(
        consensusSource
          ? `Add ${consensusSource.name} key or enable it in Settings.`
          : "Consensus model is unavailable."
      );
      return;
    }
    // One debater is enough — the server runs it against itself. Zero is not.
    if (mode === "council" && selectedDebaterIds.length < 1) {
      setError(plan.blockers[0] ?? "No eligible council models. Add a provider key in Settings.");
      return;
    }
    if (mode === "council" && selectedJudgeIds.length < 1) {
      setError("No eligible judge model to conclude the council.");
      return;
    }

    setLoading(true);
    let output = "";
    let resultId: string | null = null;
    let streamError: string | null = null;
    const controller = new AbortController();
    abortRef.current = controller;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const stallMs = mode === "council" ? COUNCIL_STALL_TIMEOUT_MS : CONSENSUS_STALL_TIMEOUT_MS;
    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), stallMs);
    };
    try {
      resultId = startSharedResult(convId, {
        type: mode === "council" ? "council" : "consensus",
        title:
          mode === "council" ? "Model council" : "Consensus answer",
        modelId: mode === "council" ? "model-council" : selectedConsensusModel,
        content: "",
        qualityMode: "deep" as const,
        pending: true,
        participants: mode === "council" ? selectedDebaterIds.map((id) => getModelAlias(id)) : undefined,
        statuses:
          mode === "council"
            ? selectedDebaterIds.map((id) => ({
                modelId: id,
                model: getModelAlias(id),
                status: "queued",
                updatedAt: Date.now(),
              }))
            : undefined,
        rounds: mode === "council" ? [] : undefined,
        notes: mode === "council" ? [] : undefined,
      });
      setActiveResultId(resultId);

      resetWatchdog();
      const res = await fetch("/api/consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          qualityMode: "deep",
          prompt: latestPrompt,
          responses,
          consensusModel: selectedConsensusModel,
          candidateModels: mode === "council" ? selectedDebaterIds : undefined,
          moderatorModels: mode === "council" ? selectedJudgeIds : undefined,
          judgeModels: mode === "council" ? selectedJudgeIds : [],
          // Full fallback chain — server tries each silently on failure or
          // context overflow, so the user always gets a result.
          fallbackModels: mode === "council" ? councilFallbackModels : autoFallbackModels,
          apiKey,
          geminiApiKey,
          opencodeApiKey,
          ollamaBaseUrl,
          ollamaApiKey,
          ollamaCloudBaseUrl,
          webSearch: webSearchEnabled,
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(formatConsensusError(errText, res.status));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        resetWatchdog();
        const { value, done } = await reader.read();
        if (done) break;
        resetWatchdog();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as ConsensusStreamEvent;
            if (obj.type === "delta" && obj.text) {
              output += obj.text;
              setText((t) => t + obj.text);
              if (resultId) appendSharedResultContent(convId, resultId, obj.text);
            } else if (obj.type === "judge" && resultId && obj.model && obj.rankings?.length) {
              setSharedResultJudge(convId, resultId, {
                model: obj.model,
                winner: obj.winner,
                confidence: obj.confidence,
                rankings: obj.rankings,
              });
            } else if (obj.type === "round_start" && resultId && isCouncilRound(obj.round)) {
              startCouncilRound(convId, resultId, {
                id: obj.round,
                title: obj.title || roundTitle(obj.round),
                startedAt: Date.now(),
              });
            } else if (obj.type === "status" && resultId && obj.modelId && obj.model && isCouncilStatus(obj.status)) {
              upsertCouncilStatus(convId, resultId, {
                modelId: obj.modelId,
                model: obj.model,
                status: obj.status,
                round: isCouncilRound(obj.round) ? obj.round : undefined,
                message: obj.message,
                replacementModelId: obj.replacementModelId,
                replacementModel: obj.replacementModel,
              });
            } else if (
              obj.type === "council_note" &&
              resultId &&
              obj.modelId &&
              obj.model &&
              obj.text &&
              isCouncilRound(obj.round)
            ) {
              addCouncilNote(convId, resultId, {
                round: obj.round,
                roundTitle: obj.roundTitle || roundTitle(obj.round),
                modelId: obj.modelId,
                model: obj.model,
                content: obj.text,
              });
            } else if (obj.type === "judge_error") {
              // judge scoring failed — silent, synthesis continues without scorecard
            } else if (obj.type === "error") {
              streamError = obj.message || "Consensus stream failed.";
              setError(streamError);
              if (resultId) finishSharedResult(convId, resultId, { error: streamError });
            }
          } catch {
            // ignore malformed stream events
          }
        }
      }
      if (streamError) return;
      if (resultId) {
        const metadata = extractResultMetadata(output);
        finishSharedResult(convId, resultId, {
          content: output,
          finalAnswer: mode === "council" ? output : undefined,
          ...metadata,
        });
      }
      if (saveConsensusToChat) persistConsensus(output);
    } catch (e) {
      const message =
        e instanceof Error && e.name === "AbortError"
          ? `No response after ${Math.round(stallMs / 1000)}s — the selected model may be stalled or unreachable. Try a different synthesizer/judge.`
          : e instanceof Error
            ? e.message
            : String(e);
      setError(message);
      if (resultId) finishSharedResult(convId, resultId, { error: message });
    } finally {
      if (watchdog) clearTimeout(watchdog);
      abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-24 right-6 z-30">
        <button
          type="button"
          disabled={!canRunConsensus || loading}
          onClick={() => runConsensus("single")}
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg transition " +
            (canRunConsensus
              ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--fg)] shadow-black/15 hover:scale-105 hover:bg-[var(--bg)]"
              : "cursor-not-allowed border-transparent bg-[var(--fg-muted)] text-white opacity-70 shadow-black/10")
          }
          title={
            canRunConsensus
              ? `Synthesize with ${consensusInfo ? getModelAlias(consensusInfo) : "the consensus model"}`
              : consensusDisabledReason
          }
        >
          <Sparkles size={14} />
          Consensus
        </button>
      </div>

      <div className="fixed bottom-6 right-6 z-30">
        <button
          type="button"
          disabled={!canRunCouncil || loading}
          onClick={() => runConsensus("council")}
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg transition " +
            (canRunCouncil
              ? "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--fg)] shadow-black/15 hover:scale-105 hover:bg-[var(--bg)]"
              : "cursor-not-allowed border-transparent bg-[var(--fg-muted)] text-white opacity-70 shadow-black/10")
          }
          title={
            canRunCouncil
              ? "Run a multi-model council with a dedicated final moderator"
              : councilDisabledReason
          }
        >
          <Users size={14} />
          Council
        </button>
      </div>

      {open && (
        <div
          className={
            "fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm " +
            (fullscreen ? "items-stretch justify-stretch p-2" : "items-center justify-center p-4")
          }
          onClick={() => {
            abortRef.current?.abort();
            setFullscreen(false);
            setOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={
              "flex w-full flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl " +
              (fullscreen
                ? "max-h-[calc(100vh-1rem)] max-w-none rounded-xl"
                : "max-h-[85vh] max-w-2xl rounded-2xl")
            }
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 p-1.5 text-white">
                  {runMode === "council" ? <Users size={14} /> : <Sparkles size={14} />}
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    {runMode === "council" ? "Model council" : "Consensus answer"}
                  </div>
                  <div className="text-[11px] text-[var(--fg-muted)]">
                    {runMode === "council"
                      ? "Two models debate, then the judge decides"
                      : `Consensus from ${responses.length} answers`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFullscreen((value) => !value)}
                  className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-soft)]"
                  title={fullscreen ? "Exit fullscreen" : "Open fullscreen"}
                >
                  {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    abortRef.current?.abort();
                    setFullscreen(false);
                    setOpen(false);
                  }}
                  className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-soft)]"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-2">
                <button
                  type="button"
                  disabled={loading || !canRunConsensus}
                  onClick={() => runConsensus("single")}
                  className={
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 " +
                    (runMode === "single"
                      ? "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
                      : "border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] hover:border-[var(--border-strong)]")
                  }
                >
                  <Sparkles size={12} />
                  Consensus
                </button>
                <button
                  type="button"
                  disabled={loading || !canRunCouncil}
                  onClick={() => runConsensus("council")}
                  className={
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 " +
                    (runMode === "council"
                      ? "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
                      : "border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] hover:border-[var(--border-strong)]")
                  }
                  title={canRunCouncil ? "Run a multi-model council with a dedicated final moderator" : councilDisabledReason}
                >
                  <Users size={12} />
                  Council
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div className="rounded-lg border border-[var(--error)] bg-[var(--bg-soft)] p-3 text-sm text-[var(--error)]">
                  {error}
                </div>
              )}
              {!error && !text && loading && (
                <div className="text-sm text-[var(--fg-muted)]">
                  {runMode === "council" ? "Running model council..." : "Synthesizing best answer..."}
                </div>
              )}
              {activeResult ? (
                <SharedResultCard result={activeResult} compact noHeader />
              ) : (
                text && <Markdown source={text} />
              )}
              {loading && (text || activeResult) && (
                <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-[var(--fg)]" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}



function isCouncilRound(value: unknown): value is "opening" | "critique" | "convergence" | "synthesis" {
  return value === "opening" || value === "critique" || value === "convergence" || value === "synthesis";
}

function isCouncilStatus(value: unknown): value is "queued" | "running" | "done" | "failed" | "replaced" {
  return value === "queued" || value === "running" || value === "done" || value === "failed" || value === "replaced";
}

function roundTitle(round: "opening" | "critique" | "convergence" | "synthesis"): string {
  if (round === "opening") return "Opening";
  if (round === "critique") return "Critique";
  if (round === "convergence") return "Convergence";
  return "Final synthesis";
}

function extractApiError(raw: string): string {
  if (!raw) return "";
  try {
    const json = JSON.parse(raw);
    if (typeof json?.error === "string") return json.error;
    if (typeof json?.error?.message === "string") return json.error.message;
    if (typeof json?.message === "string") return json.message;
  } catch {
    // keep raw text
  }
  return raw;
}

function formatConsensusError(raw: string, status: number): string {
  const parsed = extractApiError(raw) || `HTTP ${status}`;
  if (/requires?\s+(an?\s+)?subscription|upgrade\s+for\s+access/i.test(parsed)) {
    return "Ollama says this model requires a subscription. Choose another model/source, or upgrade at https://ollama.com/upgrade.";
  }
  return parsed;
}

function extractResultMetadata(content: string): {
  confidence?: string;
  decisionSummary?: string;
  scores?: SharedResultScore[];
} {
  const sections = extractMarkdownSections(content);
  const confidence = firstMeaningfulLine(sections.get("confidence"));
  const decisionSummary = firstMeaningfulLine(sections.get("why this is best"));
  const scores = extractScores(sections.get("quality scorecard"));

  return {
    ...(confidence ? { confidence } : {}),
    ...(decisionSummary ? { decisionSummary } : {}),
    ...(scores.length > 0 ? { scores } : {}),
  };
}

function extractMarkdownSections(content: string): Map<string, string> {
  const headingPattern = /^\*\*([^*]+)\*\*\s*$/gm;
  const headings: Array<{ name: string; index: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(content)) !== null) {
    headings.push({
      name: match[1].trim().toLowerCase(),
      index: match.index,
      end: headingPattern.lastIndex,
    });
  }

  const sections = new Map<string, string>();
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    sections.set(current.name, content.slice(current.end, next?.index ?? content.length).trim());
  }
  return sections;
}

function firstMeaningfulLine(value?: string): string | undefined {
  return value
    ?.split("\n")
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .find(Boolean);
}

function extractScores(value?: string): SharedResultScore[] {
  if (!value) return [];
  const scores: SharedResultScore[] = [];
  const lines = value
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const detail = match[2].trim();
    const scoreMatch = detail.match(/\b(?:\d+(?:\.\d+)?\/(?:5|10)|high|medium|low)\b/i);
    const note = scoreMatch ? detail.replace(scoreMatch[0], "").replace(/^[-\s:]+/, "").trim() : "";
    scores.push({
      label: match[1].trim(),
      value: scoreMatch?.[0] ?? detail,
      ...(note ? { note } : {}),
    });
  }

  return scores;
}
