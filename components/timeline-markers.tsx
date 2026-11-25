"use client";
import { useCallback, useEffect, useState } from "react";
import { Tooltip } from "@mantine/core";
import {
  AlertCircle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  HelpCircle,
  Layers,
  MessageSquare,
  Play,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { api } from "@/lib/browser";
import type { AttemptReviewFlag } from "@/lib/review-flag-types";
import {
  formatSignalLabel,
  type TimelineFlagItem,
  type TimelineProjection,
  type TimelineSelection,
  type TimelineWindowItem,
} from "@/lib/timeline-markers";
import type { Attempt, ReplayFocus } from "@/lib/types";
import CoachText from "./coach-text";
import { Button } from "./ui";

const defaultFormatTime = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((Math.max(0, ms) / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;

export function useAttemptReviewFlags(attemptId?: string, enabled = true) {
  const [flags, setFlags] = useState<AttemptReviewFlag[]>([]);
  const load = useCallback(async () => {
    if (!attemptId || !enabled) {
      setFlags([]);
      return;
    }
    try {
      const res = await api(
        `/api/review-flags?attemptId=${encodeURIComponent(attemptId)}`,
      );
      setFlags(Array.isArray(res.flags) ? res.flags : []);
    } catch {
      // Diagnostic DB unavailability should never disrupt replay.
    }
  }, [attemptId, enabled]);

  useEffect(() => {
    void load();
    if (!enabled) return;
    const onChanged = () => void load();
    window.addEventListener("duo-review-flags-changed", onChanged);
    return () =>
      window.removeEventListener("duo-review-flags-changed", onChanged);
  }, [load, enabled]);

  return flags;
}

function FlagPinIcon({ kind }: { kind: TimelineFlagItem["kind"] }) {
  switch (kind) {
    case "java-help":
      return <HelpCircle size={11} />;
    case "review-flag":
      return <AlertCircle size={11} />;
    case "annotation":
      return <MessageSquare size={11} />;
    default:
      return <Flag size={11} />;
  }
}

function WindowHoverPreview({
  item,
  formatTime,
}: {
  item: TimelineWindowItem;
  formatTime: (ms: number) => string;
}) {
  return (
    <div className="timeline-tooltip-card">
      <div className="timeline-tooltip-head">
        <span className={`timeline-kind-pill ${item.kind}`}>
          {item.kind === "solving-window"
            ? `Solving window · ${item.signal ? formatSignalLabel(item.signal) : ""}`
            : "Evaluated approach"}
        </span>
        <span className="timeline-tooltip-time">
          {formatTime(item.startMs)}–{formatTime(item.endMs)} · #{item.startSeq}
          –#{item.endSeq}
        </span>
      </div>
      <strong className="timeline-tooltip-title">{item.label}</strong>
      <p className="timeline-tooltip-body">
        {item.summary.length > 210
          ? item.summary.slice(0, 207) + "…"
          : item.summary}
      </p>
      <div className="timeline-tooltip-meta">
        {item.kind === "solving-window" && (
          <>
            <span>{item.observations.length} observations</span>
            <span>{item.candidateQuestions.length} candidate questions</span>
            {item.sources.length > 0 && (
              <span>{item.sources.length} verified docs</span>
            )}
          </>
        )}
        {item.intentStatus && <span>Intent: {item.intentStatus}</span>}
        {item.linkedQuestions.length > 0 && (
          <span>{item.linkedQuestions.length} review verdicts</span>
        )}
        {item.model && (
          <span>
            {item.model} ({item.effort ?? "low"})
          </span>
        )}
      </div>
      <small className="timeline-tooltip-hint">
        Click to inspect platform assessment &amp; set replay range
      </small>
    </div>
  );
}

function FlagHoverPreview({
  item,
  formatTime,
}: {
  item: TimelineFlagItem;
  formatTime: (ms: number) => string;
}) {
  const spanText =
    item.endSeq > item.startSeq
      ? `${formatTime(item.startMs)}–${formatTime(item.endMs)} · #${item.startSeq}–#${item.endSeq}`
      : `${formatTime(item.startMs)} · #${item.startSeq}`;
  return (
    <div className="timeline-tooltip-card">
      <div className="timeline-tooltip-head">
        <span className={`timeline-kind-pill ${item.kind}`}>
          {item.badgeLabel}
        </span>
        <span className="timeline-tooltip-time">{spanText}</span>
      </div>
      <strong className="timeline-tooltip-title">{item.label}</strong>
      <p className="timeline-tooltip-body">
        {item.observation.length > 190
          ? item.observation.slice(0, 187) + "…"
          : item.observation}
      </p>
      {item.interpretation && (
        <p className="timeline-tooltip-sub">
          {item.interpretation.length > 165
            ? item.interpretation.slice(0, 162) + "…"
            : item.interpretation}
        </p>
      )}
      <div className="timeline-tooltip-meta">
        {item.confidence && <span>Confidence: {item.confidence}</span>}
        {item.reviewFlag && (
          <span>
            Traces: {item.reviewFlag.traceState}
            {item.reviewFlag.traceCount
              ? ` (${item.reviewFlag.traceCount})`
              : ""}
          </span>
        )}
        {item.linkedQuestions.length > 0 && (
          <span>{item.linkedQuestions.length} linked review verdicts</span>
        )}
      </div>
      <small className="timeline-tooltip-hint">
        Click to inspect details &amp; jump to moment
      </small>
    </div>
  );
}

export function TimelineOverlayTrack({
  projection,
  playheadPct,
  selectedId,
  onSelect,
  formatTime = defaultFormatTime,
}: {
  projection: TimelineProjection;
  playheadPct: number;
  selectedId?: string;
  onSelect: (item: TimelineSelection) => void;
  formatTime?: (ms: number) => string;
}) {
  const solvingWindows = projection.windows.filter(
    (w) => w.kind === "solving-window",
  );
  const approachWindows = projection.windows.filter(
    (w) => w.kind === "approach-window",
  );
  const clampedPlayhead = Math.max(0, Math.min(100, playheadPct));

  return (
    <div
      className="timeline-overlay"
      aria-label="Timeline markers and analysis windows"
    >
      <div className="timeline-overlay-header">
        <span className="timeline-legend-item">
          <Flag size={11} />
          Flags ({projection.flags.length})
        </span>
        <Tooltip
          withinPortal
          multiline
          w={320}
          openDelay={120}
          classNames={{ tooltip: "timeline-mantine-tooltip" }}
          label={
            solvingWindows.length
              ? `${solvingWindows.length} background solving ${solvingWindows.length === 1 ? "window" : "windows"} captured during active solving. Hover or click a window bar to inspect observations, candidate questions, and downstream review verdicts.`
              : "No background solving windows were captured on this attempt. Background windows fire automatically on meaningful solving stretches (replaced blocks, example runs, non-accepted submits, pauses, or 5m intervals) when enabled in Agent settings."
          }
        >
          <span className="timeline-legend-item interactive">
            <Layers size={11} />
            Solving windows ({solvingWindows.length})
          </span>
        </Tooltip>
        {approachWindows.length > 0 && (
          <span className="timeline-legend-item">
            <Compass size={11} />
            Approaches ({approachWindows.length})
          </span>
        )}
        <span className="timeline-legend-hint">
          Hover to preview · click to inspect
        </span>
      </div>

      {(projection.windows.length > 0 || projection.flags.length > 0) && (
        <div className="timeline-overlay-lanes">
          <div
            className="timeline-playhead-needle"
            style={{ left: `${clampedPlayhead}%` }}
            aria-hidden="true"
          />

          {solvingWindows.length > 0 && (
            <div
              className="timeline-window-lane"
              role="group"
              aria-label="Background solving analysis windows"
            >
              {solvingWindows.map((w) => {
                const active = selectedId === w.id;
                return (
                  <Tooltip
                    key={w.id}
                    withinPortal
                    multiline
                    w={350}
                    openDelay={80}
                    position="top"
                    classNames={{ tooltip: "timeline-mantine-tooltip" }}
                    label={
                      <WindowHoverPreview item={w} formatTime={formatTime} />
                    }
                  >
                    <button
                      type="button"
                      className={`timeline-window-bar solving ${active ? "active" : ""}`}
                      style={{
                        left: `${w.leftPct}%`,
                        width: `${w.displayWidthPct}%`,
                      }}
                      aria-pressed={active}
                      aria-label={`${w.label} (${formatTime(w.startMs)} to ${formatTime(w.endMs)})`}
                      onClick={() => onSelect(w)}
                    >
                      <span>{w.displayWidthPct >= 14 ? w.label : w.shortLabel}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {approachWindows.length > 0 && (
            <div
              className="timeline-window-lane approach"
              role="group"
              aria-label="Evaluated approach windows"
            >
              {approachWindows.map((w) => {
                const active = selectedId === w.id;
                return (
                  <Tooltip
                    key={w.id}
                    withinPortal
                    multiline
                    w={350}
                    openDelay={80}
                    position="top"
                    classNames={{ tooltip: "timeline-mantine-tooltip" }}
                    label={
                      <WindowHoverPreview item={w} formatTime={formatTime} />
                    }
                  >
                    <button
                      type="button"
                      className={`timeline-window-bar approach ${active ? "active" : ""}`}
                      style={{
                        left: `${w.leftPct}%`,
                        width: `${w.displayWidthPct}%`,
                      }}
                      aria-pressed={active}
                      aria-label={`${w.label} (${formatTime(w.startMs)} to ${formatTime(w.endMs)})`}
                      onClick={() => onSelect(w)}
                    >
                      <span>
                        {w.displayWidthPct >= 16 ? w.label : w.shortLabel}
                      </span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {projection.flags.length > 0 && (
            <div
              className={`timeline-flag-lane ${projection.flags.some((f) => f.row === 1) ? "two-rows" : ""}`}
              role="group"
              aria-label="Flagged timeline markers"
            >
              {projection.flags.map((f) => {
                const active = selectedId === f.id;
                return (
                  <div key={f.id} className="timeline-flag-anchor">
                    {f.widthPct > 0.8 && (
                      <div
                        className={`timeline-flag-span ${f.kind} ${active ? "active" : ""}`}
                        style={{
                          left: `${f.leftPct}%`,
                          width: `${f.widthPct}%`,
                          top: f.row === 1 ? "26px" : "10px",
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <Tooltip
                      withinPortal
                      multiline
                      w={350}
                      openDelay={80}
                      position="top"
                      classNames={{ tooltip: "timeline-mantine-tooltip" }}
                      label={
                        <FlagHoverPreview item={f} formatTime={formatTime} />
                      }
                    >
                      <button
                        type="button"
                        className={`timeline-flag-pin ${f.kind} ${active ? "active" : ""}`}
                        style={{
                          left: `${f.leftPct}%`,
                          top: f.row === 1 ? "18px" : "2px",
                        }}
                        aria-pressed={active}
                        aria-label={`${f.label} at ${formatTime(f.startMs)}`}
                        onClick={() => onSelect(f)}
                      >
                        <FlagPinIcon kind={f.kind} />
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="reflection-flags" aria-label="Flagged moments and windows">
        {projection.windows.map((w) => (
          <Button
            key={w.id}
            className={
              selectedId === w.id
                ? "button primary timeline-chip"
                : "button secondary timeline-chip window"
            }
            aria-pressed={selectedId === w.id}
            onClick={() => onSelect(w)}
          >
            {w.kind === "solving-window" ? (
              <Layers size={12} />
            ) : (
              <Compass size={12} />
            )}
            {w.label}
          </Button>
        ))}
        {projection.flags.map((f) => (
          <Button
            key={f.id}
            className={
              selectedId === f.id
                ? "button primary timeline-chip"
                : `button secondary timeline-chip ${f.kind}`
            }
            aria-pressed={selectedId === f.id}
            onClick={() => onSelect(f)}
          >
            <FlagPinIcon kind={f.kind} />
            {f.label}
          </Button>
        ))}
        {!projection.windows.length && !projection.flags.length && (
          <span>
            Flagged moments and analysis windows will appear here as your
            attempt is recorded and reviewed.
          </span>
        )}
      </div>
    </div>
  );
}

export function TimelineInspectorCard({
  attempt,
  item,
  items,
  diffActive = false,
  formatTime = defaultFormatTime,
  onSelectItem,
  onJumpSeq,
  onToggleDiff,
  onReplayRange,
  onClose,
}: {
  attempt: Attempt;
  item: TimelineSelection;
  items: TimelineSelection[];
  diffActive?: boolean;
  formatTime?: (ms: number) => string;
  onSelectItem: (item: TimelineSelection) => void;
  onJumpSeq: (seq: number) => void;
  onToggleDiff?: () => void;
  onReplayRange?: (focus: ReplayFocus) => void;
  onClose: () => void;
}) {
  const idx = items.findIndex((x) => x.id === item.id);
  const prevItem = idx > 0 ? items[idx - 1] : undefined;
  const nextItem = idx >= 0 && idx < items.length - 1 ? items[idx + 1] : undefined;
  const hasRange = item.endSeq > item.startSeq;
  const traceId =
    item.itemType === "window"
      ? item.traceId
      : (item.reviewFlag?.traceId ?? item.javaHelp?.traceId);

  return (
    <section
      className="timeline-inspector"
      aria-label="Selected timeline assessment details"
    >
      <header className="timeline-inspector-header">
        <span className={`timeline-kind-pill ${item.kind}`}>
          {item.itemType === "window"
            ? item.kind === "solving-window"
              ? `Solving window · ${item.signal ? formatSignalLabel(item.signal) : ""}`
              : "Evaluated approach"
            : item.badgeLabel}
        </span>
        <strong className="timeline-inspector-title">{item.label}</strong>
        <span className="timeline-inspector-span">
          {formatTime(item.startMs)}
          {hasRange ? `–${formatTime(item.endMs)}` : ""} · #{item.startSeq}
          {hasRange ? `–#${item.endSeq}` : ""}
        </span>
        <div className="timeline-inspector-nav">
          <button
            type="button"
            className="timeline-nav-btn"
            disabled={!prevItem}
            title={prevItem ? `Previous: ${prevItem.label}` : "First item"}
            aria-label="Previous timeline marker"
            onClick={() => prevItem && onSelectItem(prevItem)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="timeline-nav-btn"
            disabled={!nextItem}
            title={nextItem ? `Next: ${nextItem.label}` : "Last item"}
            aria-label="Next timeline marker"
            onClick={() => nextItem && onSelectItem(nextItem)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className="timeline-nav-btn"
            aria-label="Close inspector"
            title="Close assessment details"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="timeline-inspector-actions">
        <button
          type="button"
          className="timeline-action-chip"
          onClick={() => onJumpSeq(item.startSeq)}
        >
          {hasRange ? `Start (#${item.startSeq})` : `Snapshot (#${item.startSeq})`}
        </button>
        {hasRange && (
          <button
            type="button"
            className="timeline-action-chip"
            onClick={() => onJumpSeq(item.endSeq)}
          >
            End (#{item.endSeq})
          </button>
        )}
        {hasRange && onToggleDiff && (
          <button
            type="button"
            className={`timeline-action-chip ${diffActive ? "active" : ""}`}
            onClick={onToggleDiff}
          >
            <SplitSquareHorizontal size={12} />
            {diffActive ? "Showing diff" : "Compare start → end"}
          </button>
        )}
        {hasRange && onReplayRange && (
          <button
            type="button"
            className="timeline-action-chip"
            onClick={() =>
              onReplayRange({
                startSeq: item.startSeq,
                endSeq: item.endSeq,
                pauseSeq: item.pauseSeq ?? null,
                mode: "loop",
                label: item.label,
              })
            }
          >
            <Play size={11} /> Loop range
          </button>
        )}
        {traceId && (
          <a
            className="timeline-action-chip link"
            href={`/?trace=${encodeURIComponent(traceId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Inspect trace <ArrowUpRight size={11} />
          </a>
        )}
        {item.itemType === "flag" && item.reviewFlag && (
          <a
            className="timeline-action-chip link"
            href={`/?flag=${encodeURIComponent(item.reviewFlag.flagId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Review flag <ArrowUpRight size={11} />
          </a>
        )}
      </div>

      <div className="timeline-inspector-body">
        {item.itemType === "window" && item.kind === "solving-window" && (
          <>
            <div className="timeline-inspector-meta-line">
              {item.model && (
                <span>
                  Analyzer: <code>{item.model}</code> ({item.effort ?? "low"})
                </span>
              )}
              {item.capturedAtMs !== undefined && (
                <span>Captured at {formatTime(item.capturedAtMs)} active</span>
              )}
            </div>
            {item.captureContext && (
              <p className="timeline-guardrail-note">
                <strong>Capture guardrail:</strong> {item.captureContext}
              </p>
            )}
            <div className="timeline-prose-block">
              <CoachText sources={item.sources}>{item.summary}</CoachText>
            </div>
            {item.observations.length > 0 && (
              <div className="timeline-detail-group">
                <strong>
                  Recorded observations ({item.observations.length})
                </strong>
                <ul>
                  {item.observations.map((obs, i) => (
                    <li key={i}>
                      <span className="timeline-subtag">{obs.kind}</span>{" "}
                      {obs.statement}{" "}
                      {obs.sequences.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="timeline-seq-btn"
                          onClick={() => onJumpSeq(s)}
                        >
                          #{s}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.candidateQuestions.length > 0 && (
              <div className="timeline-detail-group">
                <strong>
                  Candidate review questions ({item.candidateQuestions.length})
                </strong>
                <ul>
                  {item.candidateQuestions.map((q, i) => (
                    <li key={i}>
                      <span className="timeline-subtag">
                        {q.topic} · {q.kind}
                      </span>{" "}
                      <strong>{q.question}</strong> —{" "}
                      <span className="muted-inline">{q.purpose}</span>{" "}
                      {q.sequences.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="timeline-seq-btn"
                          onClick={() => onJumpSeq(s)}
                        >
                          #{s}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.sources.length > 0 && (
              <div className="timeline-detail-group">
                <strong>
                  Pre-verified Java receipts ({item.sources.length})
                </strong>
                <div className="timeline-source-links">
                  {item.sources.map((src) => (
                    <a
                      key={src.id}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {src.title} ({src.version}) <ArrowUpRight size={11} />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {item.itemType === "window" && item.kind === "approach-window" && (
          <>
            <p>
              <strong>Observed stage:</strong> {item.summary}
            </p>
            {item.intentStatement && (
              <p>
                <strong>Intent ({item.intentStatus}):</strong>{" "}
                {item.intentStatement}
                {item.isBaseline ? " · Assessed baseline" : ""}
              </p>
            )}
          </>
        )}

        {item.itemType === "flag" &&
          (item.kind === "coach-moment" || item.kind === "heuristic-moment") && (
            <>
              <p>
                <strong>Observed:</strong> {item.observation}
                {item.confidence ? ` (confidence: ${item.confidence})` : ""}
              </p>
              {item.interpretation && (
                <p>
                  <strong>Platform assessment:</strong> {item.interpretation}
                </p>
              )}
              {item.question && <CoachText>{item.question}</CoachText>}
            </>
          )}

        {item.itemType === "flag" && item.javaHelp && (
          <>
            <p>
              <strong>Lookup question:</strong> {item.javaHelp.question}
            </p>
            <p>
              <strong>Platform treatment:</strong> {item.interpretation}
              {item.javaHelp.answerKind
                ? ` · Classified as ${item.javaHelp.answerKind}`
                : ""}
              {item.javaHelp.topics.length
                ? ` · Topics: ${item.javaHelp.topics.join(", ")}`
                : ""}
            </p>
            {item.javaHelp.editor && (
              <p className="muted-inline">
                Cursor line {item.javaHelp.editor.cursor.line}, col{" "}
                {item.javaHelp.editor.cursor.column}
                {item.javaHelp.editor.selection
                  ? ` · Attached lines ${item.javaHelp.editor.selection.startLine}–${item.javaHelp.editor.selection.endLine}`
                  : ""}
              </p>
            )}
          </>
        )}

        {item.itemType === "flag" && item.reviewFlag && (
          <>
            <p>
              <strong>{item.reviewFlag.category}</strong> ({item.reviewFlag.targetKind} ·{" "}
              {item.reviewFlag.status === "resolved" ? "Reviewed" : "Open"}) —{" "}
              {item.reviewFlag.note || "No note added."}
            </p>
            {item.reviewFlag.editor && (
              <p className="muted-inline">
                Captured cursor at line {item.reviewFlag.editor.cursor.line},
                column {item.reviewFlag.editor.cursor.column}
                {item.reviewFlag.editor.selection
                  ? ` · Selected lines ${item.reviewFlag.editor.selection.startLine}–${item.reviewFlag.editor.selection.endLine}`
                  : ""}
              </p>
            )}
            <p className="muted-inline">
              Trace snapshot: {item.reviewFlag.traceState}
              {item.reviewFlag.traceCount
                ? ` (${item.reviewFlag.traceCount} runs preserved)`
                : ""}
            </p>
          </>
        )}

        {item.itemType === "flag" && item.annotation && (
          <>
            <p>
              <strong>Learner annotation ({item.annotation.judgement}):</strong>{" "}
              {item.annotation.comment || "No comment text."}
            </p>
            {item.annotation.interpretation && (
              <p>
                <strong>Saved interpretation:</strong>{" "}
                {item.annotation.interpretation}
              </p>
            )}
          </>
        )}

        {item.linkedQuestions.length > 0 ? (
          <details className="timeline-linked-verdicts" open>
            <summary>
              Question &amp; evidence review verdicts at this span (
              {item.linkedQuestions.length})
            </summary>
            <ul>
              {item.linkedQuestions.map((v) => (
                <li key={v.id}>
                  <div className="timeline-verdict-head">
                    <span className={`timeline-decision-badge ${v.decision}`}>
                      {v.decision}
                    </span>
                    <span className="timeline-subtag">{v.classification}</span>
                    <span className="timeline-subtag">
                      {v.topic} · {v.kind}
                    </span>
                    {v.coachingRole && (
                      <span className="timeline-subtag">{v.coachingRole}</span>
                    )}
                    {v.askedInChat && (
                      <span className="timeline-subtag highlight">
                        asked in chat
                      </span>
                    )}
                    {v.surfacedInChat && (
                      <span className="timeline-subtag highlight">
                        surfaced insight
                      </span>
                    )}
                    {v.analystTraceId && (
                      <a
                        className="timeline-mini-link"
                        href={`/?trace=${encodeURIComponent(v.analystTraceId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        analyst ↗
                      </a>
                    )}
                  </div>
                  <p className="timeline-verdict-q">
                    <strong>{v.id}:</strong> {v.question}
                  </p>
                  <p className="timeline-verdict-a">{v.answer}</p>
                  {v.uncertainty && (
                    <p className="muted-inline">
                      Uncertainty: {v.uncertainty}
                    </p>
                  )}
                  {v.sequences.length > 0 && (
                    <div className="timeline-verdict-seqs">
                      {v.sequences.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="timeline-seq-btn"
                          onClick={() =>
                            onJumpSeq(s === 0 ? attempt.lastSeq : s)
                          }
                        >
                          #{s === 0 ? `${attempt.lastSeq} (final)` : s}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          !attempt.evaluations.length &&
          item.itemType === "window" && (
            <p className="muted-inline">
              Post-session question &amp; evidence review verdicts will link here
              once reflection runs.
            </p>
          )
        )}
      </div>
    </section>
  );
}
