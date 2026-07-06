"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  Users,
} from "lucide-react";
import {
  useChat,
  type CouncilMemberStatus,
  type CouncilRoundId,
  type SharedResult,
  type SharedResultJudge,
  type SharedResultType,
} from "@/lib/store";
import { Markdown } from "./Markdown";

const ROUND_ORDER: CouncilRoundId[] = ["opening", "critique", "convergence"];
const ROUND_TITLES: Record<CouncilRoundId, string> = {
  opening: "Opening",
  critique: "Critique",
  convergence: "Convergence",
  synthesis: "Final synthesis",
};

export function SynthesisHistoryButton({
  convId,
  compact = false,
}: {
  convId: string;
  compact?: boolean;
}) {
  const conv = useChat((s) => s.conversations[convId]);
  const [tab, setTab] = useState<SharedResultType>("consensus");
  const [open, setOpen] = useState(false);

  const results = useMemo(
    () => [...(conv?.sharedResults ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [conv?.sharedResults]
  );
  const consensusCount = results.filter((result) => result.type === "consensus").length;
  const councilCount = results.filter((result) => result.type === "council").length;
  const activeTab =
    tab === "consensus" && consensusCount === 0 && councilCount > 0
      ? "council"
      : tab === "council" && councilCount === 0 && consensusCount > 0
        ? "consensus"
        : tab;
  const visibleResults = results.filter((result) => result.type === activeTab).slice(0, 3);

  if (!conv || results.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={
          "relative inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--fg)] shadow-sm transition hover:bg-[var(--bg)] hover:shadow-md " +
          (open ? "ring-2 ring-[var(--accent)]/25 " : "") +
          (compact ? "px-2.5" : "px-3")
        }
        title="Consensus and council results for this chat"
        aria-label="Open consensus and council results for this chat"
      >
        <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
          <Sparkles size={12} />
          <Users size={9} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[var(--bg-elevated)] p-px text-[var(--accent)]" />
        </span>
        {!compact && (
          <span className="flex flex-col items-start leading-none">
            <span>Results</span>
            <span className="mt-0.5 text-[9px] font-medium text-[var(--fg-muted)]">
              Consensus & council
            </span>
          </span>
        )}
        <span className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-1.5 py-0.5 text-[9px] leading-none text-[var(--fg-muted)]">
          {results.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(440px,calc(100vw-1rem))] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2">
            <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5">
              <TabButton
                active={activeTab === "consensus"}
                disabled={consensusCount === 0}
                icon={<Sparkles size={12} />}
                label={`Consensus ${consensusCount || ""}`.trim()}
                onClick={() => setTab("consensus")}
              />
              <TabButton
                active={activeTab === "council"}
                disabled={councilCount === 0}
                icon={<Users size={12} />}
                label={`Council ${councilCount || ""}`.trim()}
                onClick={() => setTab("council")}
              />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg)] hover:text-[var(--fg)]"
            >
              Close
            </button>
          </div>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            {visibleResults.map((result) => (
              <SharedResultCard key={result.id} result={result} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SharedResultCard({
  result,
  compact = false,
  noHeader = false,
}: {
  result: SharedResult;
  compact?: boolean;
  noHeader?: boolean;
}) {
  const isCouncil = result.type === "council";
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
      {!noHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-md bg-[var(--bg-soft)] p-1 text-[var(--fg-muted)]">
              {isCouncil ? <Users size={13} /> : <Sparkles size={13} />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[var(--fg)]">
                {result.title}
              </div>
              <div className="text-[10px] text-[var(--fg-muted)]">
                {formatTime(result.createdAt)}
              </div>
            </div>
          </div>
          <ResultState result={result} />
        </div>
      )}

      <div className={compact ? "space-y-3 px-3 py-2" : "space-y-3 p-3"}>
        {result.error && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--error)]/40 bg-[var(--bg-soft)] px-2 py-1.5 text-xs text-[var(--error)]">
            <AlertCircle size={13} />
            {result.error}
          </div>
        )}

        {isCouncil ? <CouncilDebate result={result} /> : <ConsensusResult result={result} />}
      </div>
    </article>
  );
}

function TabButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition " +
        (active
          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
          : "text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg)] disabled:opacity-40")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function ResultState({ result }: { result: SharedResult }) {
  if (result.pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
        <Loader2 size={10} className="animate-spin" />
        running
      </span>
    );
  }
  if (result.error) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[var(--error)]/40 px-1.5 py-0.5 text-[10px] text-[var(--error)]">
        <AlertCircle size={10} />
        issue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-600">
      <CheckCircle2 size={10} />
      done
    </span>
  );
}

function ConsensusResult({ result }: { result: SharedResult }) {
  if (!result.content.trim() && result.pending) {
    return <div className="text-xs text-[var(--fg-muted)]">Synthesizing best answer...</div>;
  }

  const divider = "\n---\n";
  const dividerIdx = result.content.indexOf(divider);
  const answerPart = dividerIdx >= 0 ? result.content.slice(0, dividerIdx).trim() : result.content;
  const detailsPart = dividerIdx >= 0 ? result.content.slice(dividerIdx + divider.length).trim() : "";

  const hasExtraDetails =
    result.confidence ||
    result.decisionSummary ||
    (result.scores?.length ?? 0) > 0 ||
    (result.participants?.length ?? 0) > 0 ||
    (result.judge?.rankings.length ?? 0) > 0;

  return (
    <>
      <Markdown source={answerPart} />
      {(detailsPart || hasExtraDetails) && (
        <details className="group mt-3 overflow-hidden rounded-lg border border-[var(--border)]">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg)] [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Show analysis details
          </summary>
          <div className="border-t border-[var(--border)] px-3 py-2 space-y-2 text-[11px] text-[var(--fg-muted)]">
            {detailsPart && <Markdown source={detailsPart} />}
            {detailsPart && hasExtraDetails && <hr className="border-[var(--border)]" />}
            {result.participants && result.participants.length > 0 && (
              <div>
                <span className="font-medium text-[var(--fg)]">Models: </span>
                <span className="text-[var(--fg-muted)]">{result.participants.join(", ")}</span>
              </div>
            )}
            {result.confidence && (
              <div>
                <span className="font-medium text-[var(--fg)]">Confidence: </span>
                <span className="text-emerald-600">{result.confidence}</span>
              </div>
            )}
            {result.decisionSummary && (
              <div>
                <span className="font-medium text-[var(--fg)]">Why this is best: </span>
                <span className="text-[var(--fg-muted)]">{result.decisionSummary}</span>
              </div>
            )}
            {result.scores && result.scores.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.scores.slice(0, 4).map((score, i) => (
                  <span key={`${score.label}-${i}`} className="rounded border border-[var(--border)] bg-[var(--bg-soft)] px-1.5 py-0.5" title={score.note}>
                    {score.label}: {score.value}
                  </span>
                ))}
              </div>
            )}
            {result.judge && result.judge.rankings.length > 0 && (
              <JudgeScorecard judge={result.judge} />
            )}
          </div>
        </details>
      )}
    </>
  );
}

function CouncilDebate({ result }: { result: SharedResult }) {
  const [showProcess, setShowProcess] = useState(false);
  const hasProcess =
    (result.statuses?.length ?? 0) > 0 ||
    (result.rounds?.length ?? 0) > 0 ||
    (result.notes?.length ?? 0) > 0;
  const showProcessDetails = result.pending || showProcess;

  return (
    <>
      {(result.content.trim() || result.pending) && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
            Final answer
          </div>
          <QualitySnapshot result={result} />
          {result.content.trim() ? (
            <Markdown source={result.content} />
          ) : (
            <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <Loader2 size={13} className="animate-spin" />
              Synthesizing final verdict...
            </div>
          )}
        </div>
      )}

      {!result.pending && hasProcess && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-[var(--fg-muted)]">
            {(result.notes ?? []).length} debate note{(result.notes ?? []).length === 1 ? "" : "s"}
          </div>
          <button
            type="button"
            onClick={() => setShowProcess((value) => !value)}
            className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg)]"
          >
            {showProcess ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showProcess ? "Hide process" : "How it decided"}
          </button>
        </div>
      )}

      {showProcessDetails && <CouncilProcess result={result} />}
    </>
  );
}

function QualitySnapshot({ result }: { result: SharedResult }) {
  const scores = result.scores ?? [];
  const hasSnapshot =
    result.confidence || result.decisionSummary || scores.length > 0 || (result.judge?.rankings.length ?? 0) > 0;
  if (!hasSnapshot) return null;

  return (
    <div className="mb-2 space-y-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] text-[var(--fg-muted)]">
      {result.confidence && (
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
          {result.confidence}
        </span>
      )}
      {result.decisionSummary && <div>{result.decisionSummary}</div>}
      {scores.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {scores.slice(0, 4).map((score, index) => (
            <span
              key={`${score.label}-${score.value}-${index}`}
              className="rounded border border-[var(--border)] bg-[var(--bg-soft)] px-1.5 py-0.5"
              title={score.note}
            >
              {score.label}: {score.value}
            </span>
          ))}
        </div>
      )}
      {result.judge && result.judge.rankings.length > 0 && <JudgeScorecard judge={result.judge} />}
    </div>
  );
}

const JUDGE_CRITERIA = ["accuracy", "relevance", "completeness", "clarity", "citations"] as const;

function JudgeScorecard({ judge }: { judge: SharedResultJudge }) {
  if (!judge.rankings.length) return null;
  const used = JUDGE_CRITERIA.filter((criterion) =>
    judge.rankings.some((ranking) => ranking.scores?.[criterion] !== undefined)
  );

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--fg)]">Judge scorecard</span>
        <span className="truncate text-[10px] text-[var(--fg-muted)]">
          {judge.model}
          {judge.confidence ? ` · ${judge.confidence} confidence` : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[10px] text-[var(--fg-muted)]">
              <th className="py-0.5 pr-2 font-medium">Model</th>
              {used.map((criterion) => (
                <th key={criterion} className="px-1 py-0.5 font-medium capitalize" title={criterion}>
                  {criterion.slice(0, 4)}
                </th>
              ))}
              <th className="px-1 py-0.5 font-medium">Overall</th>
            </tr>
          </thead>
          <tbody>
            {judge.rankings.map((ranking, index) => {
              const isWinner = Boolean(judge.winner && ranking.model === judge.winner);
              return (
                <tr
                  key={`${ranking.model}-${index}`}
                  className={isWinner ? "font-medium text-[var(--fg)]" : "text-[var(--fg-muted)]"}
                  title={ranking.rationale}
                >
                  <td className="py-0.5 pr-2 whitespace-nowrap">
                    {isWinner ? "★ " : ""}
                    {ranking.model}
                  </td>
                  {used.map((criterion) => (
                    <td key={criterion} className="px-1 py-0.5">
                      {ranking.scores?.[criterion] ?? "–"}
                    </td>
                  ))}
                  <td className="px-1 py-0.5">
                    {ranking.overall !== undefined ? `${ranking.overall}/10` : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CouncilProcess({ result }: { result: SharedResult }) {
  return (
    <>
      {(result.statuses?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.statuses!.map((status) => (
            <span
              key={status.modelId}
              className={
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] " +
                statusClass(status.status)
              }
              title={status.message}
            >
              {status.model}
              <span className="text-[var(--fg-subtle)]">{statusLabel(status.status)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {ROUND_ORDER.map((round) => (
          <CouncilRoundBlock key={round} result={result} round={round} />
        ))}
      </div>
    </>
  );
}

function CouncilRoundBlock({
  result,
  round,
}: {
  result: SharedResult;
  round: CouncilRoundId;
}) {
  const notes = (result.notes ?? []).filter((note) => note.round === round);
  const started = (result.rounds ?? []).some((entry) => entry.id === round);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5">
        <div className="text-[11px] font-semibold text-[var(--fg)]">
          {ROUND_TITLES[round]}
        </div>
        {started && result.pending && notes.length === 0 && (
          <Loader2 size={12} className="animate-spin text-[var(--fg-muted)]" />
        )}
      </div>
      <div className="space-y-2 px-2 py-2">
        {notes.length === 0 ? (
          <div className="text-[11px] text-[var(--fg-muted)]">
            {started ? "Waiting for council notes..." : "Not started yet."}
          </div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="border-l-2 border-[var(--border-strong)] pl-2">
              <div className="mb-1 text-[11px] font-semibold text-[var(--fg-muted)]">
                {note.model}
              </div>
              <div className="text-xs">
                <Markdown source={note.content} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function statusLabel(status: CouncilMemberStatus): string {
  if (status === "queued") return "queued";
  if (status === "running") return "reviewing";
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  return "replaced";
}

function statusClass(status: CouncilMemberStatus): string {
  if (status === "running") return "border-blue-500/30 bg-blue-500/10 text-blue-700";
  if (status === "done") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  if (status === "failed") return "border-[var(--error)]/40 bg-[var(--bg-soft)] text-[var(--error)]";
  if (status === "replaced") return "border-amber-500/40 bg-amber-500/10 text-amber-700";
  return "border-[var(--border)] bg-[var(--bg-soft)] text-[var(--fg-muted)]";
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
