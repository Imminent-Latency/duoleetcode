"use client";
import { useState } from "react";
import { SegmentedControl } from "@mantine/core";
import { PageHeader, PageTabPanel, PageTabs, Panel } from "./ui";
import { ArrowUpRight, ChevronDown, Target } from "lucide-react";
import { ProgressSkillProfile, type RatingsProfileDto } from "./skill-profile";
import PracticeLibrary from "./practice-library";
import CoachText from "./coach-text";
import type { AttemptSummary } from "@/lib/types";

export type ProgressTab = "overview" | "sessions" | "evidence" | "earlier";
export const PROGRESS_TAB_LABELS: Record<ProgressTab, string> = {
  overview: "Overview",
  sessions: "Sessions",
  evidence: "Skill evidence",
  earlier: "Earlier practice",
};

const date = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export type ProgressViewProps = {
  state: any;
  tab: ProgressTab;
  onTabChange: (tab: ProgressTab) => void;
  onOpen: (id: string) => void;
  onRefresh: () => Promise<unknown>;
  onError: (err: unknown) => void;
};

const evidenceText = (s: any) =>
  !s.hasResponse && s.reflectionStatus === "ready"
    ? "Understanding explained during reflection"
    : s.understanding?.status === "sufficient"
      ? s.understanding.support === "independent"
        ? "Understanding demonstrated in the first response"
        : s.understanding.support === "coached"
          ? "Understanding demonstrated during coaching"
          : "Session understanding demonstrated; independent recall unassessed"
      : s.learningExit?.reason === "skipped"
        ? "Coaching skipped; understanding not checked"
        : s.learningExit?.reason === "manual"
          ? "Moved on manually; understanding check unfinished"
          : s.outcome === "independent"
            ? "Demonstrated on the first response"
            : s.outcome === "partial"
              ? "Partially demonstrated; coaching followed"
              : s.outcome === "unassessed"
                ? "Independent recall is not yet assessed"
                : "Needs another focused practice opportunity";

export default function ProgressView({
  state,
  tab,
  onTabChange,
  onOpen,
  onRefresh,
  onError,
}: ProgressViewProps) {
  const attempts: AttemptSummary[] = state?.attempts ?? [];
  const real = attempts.filter((a) => !a.demonstration);
  const accepted = real.filter((a) => a.verdict === "Accepted");
  const days = new Set(
    real.map((a) => new Date(a.createdAt).toLocaleDateString()),
  ).size;
  const followups: any[] = state?.followups ?? [];
  return (
    <div className="page-content">
      <PageHeader title="Progress" />
      <PageTabs
        aria-label="Progress sections"
        value={tab}
        onChange={onTabChange}
        tabs={[
          { value: "overview", label: PROGRESS_TAB_LABELS.overview },
          {
            value: "sessions",
            label: PROGRESS_TAB_LABELS.sessions,
            count: attempts.length,
          },
          {
            value: "evidence",
            label: PROGRESS_TAB_LABELS.evidence,
            count: state?.followups?.length ?? 0,
          },
          {
            value: "earlier",
            label: PROGRESS_TAB_LABELS.earlier,
            count: state?.importedHistory?.length ?? 0,
          },
        ]}
      >
        <PageTabPanel value="overview">
          <div className="stats-grid">
            <Panel className="panel">
              <span className="stat-label">Assessments</span>
              <strong>{real.length}</strong>
            </Panel>
            <Panel className="panel">
              <span className="stat-label">Accepted</span>
              <strong>{accepted.length}</strong>
            </Panel>
            <Panel className="panel">
              <span className="stat-label">Days practiced</span>
              <strong>{days}</strong>
            </Panel>
            <Panel className="panel">
              <span className="stat-label">Follow-ups</span>
              <strong>
                {state?.followups.filter((s: any) => s.hasResponse).length ?? 0}
              </strong>
            </Panel>
          </div>
          {state?.ratings && (
            <ProgressSkillProfile
              ratings={state.ratings as RatingsProfileDto}
              onRefresh={async () => {
                await onRefresh();
              }}
              onError={onError}
            />
          )}
        </PageTabPanel>
        <PageTabPanel value="sessions">
          <PracticeLibrary
            key={String(Boolean(state?.sandboxMode))}
            attempts={attempts}
            sandboxMode={Boolean(state?.sandboxMode)}
            onOpen={onOpen}
          />
        </PageTabPanel>
        <PageTabPanel value="evidence">
          <p className="progress-intro">Observations, not mastery scores.</p>
          {followups.length ? (
            <Panel className="panel evidence-list">
              {followups.map((s: any, i: number) => (
                <div className="evidence-row" key={i}>
                  <div className="evidence-row-main">
                    <h3>{s.skill}</h3>
                    <p>{evidenceText(s)}</p>
                  </div>
                  <span className="pill mint">
                    {s.hasResponse ? "FOCUSED RECALL" : "SESSION RECORD"}
                  </span>
                  <small>{date(s.date)} · One observation</small>
                </div>
              ))}
            </Panel>
          ) : (
            <Panel className="panel empty-skill">
              <Target size={22} />
              <p>
                Complete a focused follow-up to start building evidence of
                recall. Historical coaching notes will stay separate from newly
                observed performance.
              </p>
            </Panel>
          )}
        </PageTabPanel>
        <PageTabPanel value="earlier">
          <EarlierPractice items={state?.importedHistory ?? []} />
        </PageTabPanel>
      </PageTabs>
    </div>
  );
}

const FIRST_BATCH = 8;
// Plain-text preview for the clamped row; the expanded view renders Markdown.
const plain = (text: string) =>
  text
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
const kindLabel = (provenance: string) => {
  const label = provenance.replace(/^Imported\s+/i, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

function EarlierPractice({ items }: { items: any[] }) {
  const [kind, setKind] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const kinds = [...new Set(items.map((s) => String(s.provenance)))];
  const filtered =
    kind === "all" ? items : items.filter((s) => s.provenance === kind);
  const visible = showAll ? filtered : filtered.slice(0, FIRST_BATCH);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <div className="earlier-toolbar">
        <p className="progress-intro">
          A starting point from your earlier practice · Imported, not new
          assessments.
        </p>
        {kinds.length > 1 && (
          <SegmentedControl
            className="earlier-filter"
            size="xs"
            aria-label="Filter earlier practice"
            value={kind}
            onChange={setKind}
            data={[
              { value: "all", label: `All ${items.length}` },
              ...kinds.map((k) => ({
                value: k,
                label: `${kindLabel(k)} ${items.filter((s) => s.provenance === k).length}`,
              })),
            ]}
          />
        )}
      </div>
      {items.length ? (
        <Panel className="panel earlier-list">
          {visible.map((s) => {
            const open = expanded.has(s.id);
            const bodyId = `earlier-${String(s.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            return (
              <article
                className={open ? "earlier-row open" : "earlier-row"}
                key={s.id}
              >
                <div className="earlier-row-head">
                  <h3>{s.skill}</h3>
                  <span className="earlier-row-meta">
                    {s.date ?? "Date unknown"}
                    {s.profile ? ` · ${s.profile}` : ""}
                  </span>
                </div>
                {open ? (
                  <div className="earlier-row-body" id={bodyId}>
                    <CoachText>{s.observation}</CoachText>
                    <p className="earlier-row-support">{s.support}</p>
                  </div>
                ) : (
                  <p className="earlier-row-preview">{plain(s.observation)}</p>
                )}
                <div className="earlier-row-foot">
                  <span className="pill">{kindLabel(s.provenance)}</span>
                  <button
                    type="button"
                    className="earlier-row-toggle"
                    aria-expanded={open}
                    aria-controls={open ? bodyId : undefined}
                    onClick={() => toggle(s.id)}
                  >
                    {open ? "Show less" : "Show details"}
                    <ChevronDown size={14} />
                  </button>
                  <a
                    className="earlier-row-source"
                    href={s.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source notes <ArrowUpRight size={12} />
                  </a>
                </div>
              </article>
            );
          })}
          {filtered.length > FIRST_BATCH && (
            <button
              type="button"
              className="earlier-show-all"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? "Show fewer"
                : `Show all ${filtered.length} (${filtered.length - FIRST_BATCH} more)`}
            </button>
          )}
        </Panel>
      ) : (
        <Panel className="panel empty-skill">
          <Target size={22} />
          <p>No earlier practice has been imported on this device.</p>
        </Panel>
      )}
    </>
  );
}
