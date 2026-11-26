"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Group, Select, Tabs, TextInput } from "@mantine/core";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  History,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/browser";
import { replay } from "@/lib/recording";
import { timeAtSequence } from "@/lib/reflection";
import { buildTimelineProjection } from "@/lib/timeline-markers";
import { languageConfig } from "@/lib/languages";
import type { Attempt, AttemptSummary } from "@/lib/types";
import { Button, Panel } from "./ui";
import CoachText from "./coach-text";
import ResearchSources from "./research-sources";
import { JudgeResults } from "./test-workbench";
import {
  TimelineInspectorCard,
  TimelineOverlayTrack,
  useAttemptReviewFlags,
} from "./timeline-markers";

type Preview = {
  preparedAt: string;
  rows: {
    key: string;
    kind: string;
    title: string;
    source: string;
    date: string | null;
    summary: string;
    available: boolean;
    existingEvidence?: number;
  }[];
  sources: { title: string; url: string }[];
  fluency: {
    skill: string;
    title: string;
    source: string;
    support: string;
    observation: string;
  }[];
};
const sourceUrl = (url: string) =>
  /^https:\/\/chatgpt\.com\/space\/page_[a-f0-9]+$/.test(url) ? url : undefined;
const when = (value: number) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const kindNames: Record<string, string> = {
  coding: "Coding",
  repository: "Repository",
  "system-design": "System design",
  recall: "Pocket recall",
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function PracticeLibrary({
  attempts,
  sandboxMode,
  onOpen,
}: {
  attempts: AttemptSummary[];
  sandboxMode: boolean;
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = useState<string | null>(
    sandboxMode ? "sandbox" : "practice",
  );
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [selected, setSelected] = useState<Attempt>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backup, setBackup] = useState<{ at: number } | null>();
  useEffect(() => {
    if (!sandboxMode)
      void api("/api/library")
        .then((result) => setBackup(result.backup))
        .catch((e) => setError(errorText(e)));
  }, [sandboxMode]);
  const rows = attempts.filter(
    (a) =>
      Boolean(a.demonstration) === (tab === "sandbox") &&
      a.title.toLowerCase().includes(query.trim().toLowerCase()) &&
      (outcome === "all" ||
        (outcome === "accepted"
          ? a.verdict === "Accepted"
          : outcome === "pending"
            ? ["active", "paused", "review", "learn"].includes(a.phase)
            : a.verdict !== "Accepted")),
  );
  const open = async (a: AttemptSummary) => {
    if (a.phase === "active" || a.phase === "paused") return onOpen(a.id);
    setLoading(true);
    setError("");
    try {
      setSelected((await api("/api/attempts/" + a.id)).attempt);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  const takeBackup = async () => {
    setLoading(true);
    setError("");
    try {
      setBackup((await api("/api/library", { action: "backup" })).backup);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  if (selected)
    return (
      <SavedSession
        attempt={selected}
        onUpdated={setSelected}
        onBack={() => setSelected(undefined)}
        onContinue={() => onOpen(selected.id)}
      />
    );
  return (
    <section className="library-section">
      <div className="section-heading">
        <h2>Practice library</h2>
        <History size={19} />
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          {!sandboxMode && <Tabs.Tab value="practice">Practice</Tabs.Tab>}
          <Tabs.Tab value="sandbox">Test sessions</Tabs.Tab>
          {!sandboxMode && (
            <Tabs.Tab value="preview">Pages import preview</Tabs.Tab>
          )}
        </Tabs.List>
      </Tabs>
      {tab === "preview" ? (
        <ImportPreview />
      ) : (
        <>
          <div className="library-filters">
            <TextInput
              label="Search sessions"
              placeholder="Problem name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              label="Filter sessions"
              value={outcome}
              onChange={(v) => setOutcome(v ?? "all")}
              allowDeselect={false}
              data={[
                { value: "all", label: "All sessions" },
                { value: "accepted", label: "Accepted" },
                { value: "other", label: "No acceptance recorded" },
                { value: "pending", label: "In progress or review" },
              ]}
            />
          </div>
          {tab === "sandbox" && (
            <p className="small">
              Test sessions are kept in a separate database and excluded from
              your practice totals.
            </p>
          )}
          <Panel className="panel history-list">
            {rows.map((a) => (
              <Button
                className="history-row"
                key={a.id}
                disabled={loading}
                onClick={() => void open(a)}
              >
                <span className="history-icon">
                  <History size={18} />
                </span>
                <div>
                  <strong>{a.title}</strong>
                  <p>
                    {languageConfig(a.language).shortLabel} · {when(a.createdAt)}{" "}
                    · {Math.round(a.budgetMs / 60000)} min budget · {a.events}{" "}
                    events
                  </p>
                </div>
                <span className={a.verdict === "Accepted" ? "positive" : ""}>
                  {a.verdict}
                </span>
                <span className="pill">{a.phase}</span>
                <ChevronRight size={16} />
              </Button>
            ))}
            {!rows.length && (
              <div className="empty-state">
                <History size={24} />
                <h3>No matching sessions</h3>
                <p>Saved sessions will appear here.</p>
              </div>
            )}
          </Panel>
        </>
      )}
      {!sandboxMode && tab === "practice" && (
        <Panel className="panel library-storage">
          <div>
            <h3>
              <ShieldCheck size={17} /> Practice backups
            </h3>
            <p>
              {backup
                ? "Last verified snapshot: " + when(backup.at)
                : "No snapshot recorded yet."}
            </p>
          </div>
          <Group gap="sm">
            <Button
              className="button secondary"
              onClick={() => void takeBackup()}
              disabled={loading}
            >
              Back up now
            </Button>
            <a className="text-button" href="/api/library?kind=export" download>
              <ArrowDownToLine size={15} /> Export JSON
            </a>
          </Group>
        </Panel>
      )}
    </section>
  );
}

function ImportPreview() {
  const [data, setData] = useState<Preview | null>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void api("/api/library?kind=preview")
      .then((result) => {
        if (current) setData(result.preview);
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      });
    return () => {
      current = false;
    };
  }, []);
  if (error)
    return (
      <p role="alert" className="error-text">
        {error}
      </p>
    );
  if (data === undefined) return <p role="status">Loading import preview…</p>;
  if (!data)
    return <p>No Pages import preview has been staged on this device.</p>;
  return (
    <div className="library-preview">
      <Panel className="panel">
        <Badge variant="light">Preview only</Badge>
        <h3>{data.rows.length} proposed historical sessions</h3>
        <p>
          These records are not in your library. A future import will keep the
          original Pages links, mark these as imported, and leave missing
          replay, code, and timing unknown.
        </p>
        <Group gap="sm">
          {data.sources.map((s) => (
            <a
              className="text-button"
              key={s.url}
              href={sourceUrl(s.url)}
              target="_blank"
              rel="noreferrer"
            >
              {s.title} <ArrowUpRight size={13} />
            </a>
          ))}
        </Group>
      </Panel>
      <div className="library-preview-grid">
        {data.rows.map((r) => (
          <Panel className="panel" key={r.key}>
            <span className="eyebrow">
              {kindNames[r.kind] ?? r.kind} · {r.date ?? "Date unknown"}
            </span>
            <h3>{r.title}</h3>
            <p>{r.summary}</p>
            {!r.available && (
              <p>Full source unavailable; needs review before importing.</p>
            )}
            {!!r.existingEvidence && (
              <p className="small">
                {r.existingEvidence} observations already in DuoLeetCode; reuse
                their evidence links.
              </p>
            )}
            <a
              className="text-button"
              href={sourceUrl(r.source)}
              target="_blank"
              rel="noreferrer"
            >
              Original Page <ArrowUpRight size={13} />
            </a>
          </Panel>
        ))}
      </div>
      <Panel className="panel">
        <h3>{data.fluency.length} linked fluency observations</h3>
        <p>
          These are evidence from existing sessions, not additional attempts.
        </p>
        {data.fluency.map((f, i) => (
          <details className="library-evidence" key={i}>
            <summary>
              {f.skill} · {f.support}
            </summary>
            <p>{f.observation}</p>
            <a
              className="text-button"
              href={sourceUrl(f.source)}
              target="_blank"
              rel="noreferrer"
            >
              {f.title} <ArrowUpRight size={13} />
            </a>
          </details>
        ))}
      </Panel>
    </div>
  );
}

export function SavedSession({
  attempt: a,
  onUpdated,
  onBack,
  onContinue,
  readOnly = false,
}: {
  attempt: Attempt;
  onUpdated: (attempt: Attempt) => void;
  onBack: () => void;
  onContinue: () => void;
  readOnly?: boolean;
}) {
  const [seq, setSeq] = useState(a.lastSeq);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string>();
  const reviewFlags = useAttemptReviewFlags(a.id, !readOnly);
  const timeline = useMemo(
    () => buildTimelineProjection(a, a.evaluations.at(-1), reviewFlags),
    [a, reviewFlags],
  );
  const selectedTimelineItem = useMemo(
    () => timeline.chronologicalItems.find((x) => x.id === selectedTimelineId),
    [timeline.chronologicalItems, selectedTimelineId],
  );
  const activeMs =
    a.endedAt === undefined
      ? undefined
      : Math.max(
          0,
          a.endedAt -
            a.createdAt -
            a.pauses.reduce(
              (total, p) =>
                total +
                Math.max(
                  0,
                  Math.min(p.end ?? a.endedAt!, a.endedAt!) - p.start,
                ),
              0,
            ),
        );
  const minutes =
    activeMs === undefined
      ? "Active time unavailable"
      : `${Math.floor(activeMs / 60000)}m ${Math.floor(activeMs / 1000) % 60}s active`;
  const next = a.followup?.next;
  const reflection = a.reflection?.messages ?? [];
  const focused = a.followup?.messages ?? [];
  const help = a.javaHelp?.filter((h) => h.deliveredAt) ?? [];
  return (
    <section className="library-record">
      <div className="section-heading">
        <Button className="text-button" onClick={onBack}>
          ← Back to library
        </Button>
        {!readOnly && (
          <Button className="button secondary" onClick={onContinue}>
            {a.phase === "complete"
              ? "Open review workspace"
              : "Continue review"}
          </Button>
        )}
        {readOnly && <Badge variant="light">Saved snapshot · read only</Badge>}
      </div>
      <h2>{a.problem.title}</h2>
      <p>
        {languageConfig(a.language).profileLabel} · {when(a.createdAt)} ·{" "}
        {minutes} ·{" "}
        {a.demonstration ? "Test session" : "Recorded practice"}
      </p>
      <Tabs defaultValue="recording" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="recording">Recording</Tabs.Tab>
          <Tabs.Tab value="judge">Judge results ({a.jobs.length})</Tabs.Tab>
          <Tabs.Tab value="coaching">Coaching</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="recording">
          <Panel className="panel">
            <h3>
              {seq === a.lastSeq
                ? a.sealed
                  ? "Sealed independent solution"
                  : "Latest saved solution"
                : "Replay snapshot"}
            </h3>
            {a.lastSeq > 0 && (
              <label className="library-range">
                Replay event {seq} / {a.lastSeq}
                <input
                  type="range"
                  min={0}
                  max={a.lastSeq}
                  value={seq}
                  onChange={(e) => setSeq(Number(e.target.value))}
                />
              </label>
            )}
            <TimelineOverlayTrack
              projection={timeline}
              playheadPct={
                timeline.totalMs > 0
                  ? (timeAtSequence(a, seq) / timeline.totalMs) * 100
                  : a.lastSeq > 0
                    ? (seq / a.lastSeq) * 100
                    : 0
              }
              selectedId={selectedTimelineId}
              onSelect={(item) => {
                setSelectedTimelineId(item.id);
                setSeq(item.pauseSeq ?? item.endSeq);
              }}
            />
            {selectedTimelineItem && (
              <TimelineInspectorCard
                attempt={a}
                item={selectedTimelineItem}
                items={timeline.chronologicalItems}
                onSelectItem={(item) => {
                  setSelectedTimelineId(item.id);
                  setSeq(item.pauseSeq ?? item.endSeq);
                }}
                onJumpSeq={(targetSeq) =>
                  setSeq(Math.max(0, Math.min(a.lastSeq, targetSeq)))
                }
                onClose={() => setSelectedTimelineId(undefined)}
              />
            )}
            <pre className="library-code">
              {seq === a.lastSeq ? a.source : replay(a, seq)}
            </pre>
            {readOnly ? (
              <details className="library-evidence">
                <summary>Work segments ({a.workSegments?.length ?? 0})</summary>
                {a.workSegments?.map((segment) => (
                  <p key={segment.id}>
                    {segment.kind === "assessment"
                      ? `${when(segment.startedAt)} → ${segment.endedAt ? when(segment.endedAt) : "In progress at capture"}`
                      : `${segment.date} · ${segment.minutes ?? "Unspecified"} minutes · ${segment.note ?? ""}`}
                  </p>
                ))}
              </details>
            ) : (
              <WorkSegmentLog attempt={a} onUpdated={onUpdated} />
            )}
            {!!a.annotations.length && (
              <details className="library-evidence">
                <summary>Recorded annotations ({a.annotations.length})</summary>
                {a.annotations.map((n) => (
                  <p key={n.id}>
                    Event {n.seq}: {n.comment || n.judgement}
                  </p>
                ))}
              </details>
            )}
          </Panel>
        </Tabs.Panel>
        <Tabs.Panel value="judge">
          <Panel className="panel">
            {a.jobs.length ? (
              <JudgeResults jobs={a.jobs} problem={a.problem} />
            ) : (
              <p>No runs or submissions recorded.</p>
            )}
            {a.jobs.map((j, i) => (
              <details className="library-evidence" key={j.id}>
                <summary>
                  {j.kind === "run" ? "Run" : "Submission"} {i + 1} ·{" "}
                  {j.summary?.verdict ?? j.state} · event {j.seq} — exact code
                </summary>
                <pre className="library-code">{j.source}</pre>
              </details>
            ))}
          </Panel>
        </Tabs.Panel>
        <Tabs.Panel value="coaching">
          <Panel className="panel library-transcript">
            {a.evaluations.length > 0 && (
              <>
                <h3>Saved feedback</h3>
                {a.evaluations.map((e, i) => (
                  <details
                    className="library-evidence"
                    key={i}
                    open={i === a.evaluations.length - 1}
                  >
                    <summary>
                      Review {i + 1} · {when(e.createdAt)}
                    </summary>
                    <CoachText sources={e.research?.sources}>
                      {e.summary}
                    </CoachText>
                    {[...e.strengths, ...e.gaps].map((f, n) => (
                      <p key={n}>
                        <strong>{f.skill}:</strong> {f.observation}
                      </p>
                    ))}
                    <ResearchSources research={e.research} />
                  </details>
                ))}
              </>
            )}
            {a.reflection?.intake && (
              <>
                <h3>First reflection answers</h3>
                <p>
                  Familiarity: {a.reflection.intake.familiarity} · Space:{" "}
                  {a.reflection.intake.spaceComplexity} · Time:{" "}
                  {a.reflection.intake.timeComplexity}
                </p>
              </>
            )}
            {reflection.length > 0 && <h3>Reflection conversation</h3>}
            {reflection.map((m) => (
              <div className="library-message" key={m.id}>
                <strong>{m.role === "user" ? "You" : "Coach"}</strong>{" "}
                <small>{when(m.createdAt)}</small>
                <CoachText sources={m.research?.sources}>{m.text}</CoachText>
                <ResearchSources research={m.research} />
              </div>
            ))}
            {a.followup && (
              <>
                <h3>Focused practice</h3>
                <div className="library-message">
                  <strong>Your first response</strong>
                  <CoachText>{a.followup.answer}</CoachText>
                </div>
                {a.followup.feedback && (
                  <div className="library-message">
                    <strong>Initial feedback</strong>
                    <CoachText sources={a.followup.research?.sources}>
                      {a.followup.feedback}
                    </CoachText>
                    <ResearchSources research={a.followup.research} />
                  </div>
                )}
                {focused.map((m) => (
                  <div className="library-message" key={m.id}>
                    <strong>{m.role === "user" ? "You" : "Coach"}</strong>{" "}
                    <small>{when(m.createdAt)}</small>
                    <CoachText sources={m.research?.sources}>
                      {m.text}
                    </CoachText>
                    <ResearchSources research={m.research} />
                  </div>
                ))}
                {a.followup.coachedCode !== undefined && (
                  <details className="library-evidence">
                    <summary>Coached solution</summary>
                    <pre className="library-code">{a.followup.coachedCode}</pre>
                  </details>
                )}
              </>
            )}
            {!!help.length && <h3>Reference help during the assessment</h3>}
            {help.map((h) => (
              <div className="library-message" key={h.id}>
                <strong>{h.question}</strong>
                <CoachText sources={h.research?.sources}>
                  {h.answer ?? ""}
                </CoachText>
                <ResearchSources research={h.research} />
              </div>
            ))}
            {next && (
              <>
                <h3>Next practice: {next.title}</h3>
                <CoachText sources={next.research?.sources}>
                  {next.reason}
                </CoachText>
                <ResearchSources research={next.research} />
              </>
            )}
            {!a.evaluations.length &&
              !a.reflection?.intake &&
              !reflection.length &&
              !a.followup &&
              !help.length && <p>No coaching or reflection recorded.</p>}
          </Panel>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}

function WorkSegmentLog({
  attempt,
  onUpdated,
}: {
  attempt: Attempt;
  onUpdated: (attempt: Attempt) => void;
}) {
  const segments = attempt.workSegments ?? [];
  const [day, setDay] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<{ key: string; id: string } | undefined>(undefined);
  return (
    <details className="library-evidence">
      <summary>Work segments ({segments.length})</summary>
      <ul>
        {segments.map((s) => (
          <li key={s.id}>
            {s.kind === "assessment" ? (
              <>
                Timed assessment · {when(s.startedAt)}
                {s.endedAt === null ? "" : " → " + when(s.endedAt)}
                {s.endReason === "pause" ? " · Paused" : ""}
              </>
            ) : (
              <>
                Logged continuation · {s.date} ·{" "}
                {s.minutes === undefined
                  ? "Time unrecorded"
                  : s.minutes + " min reported"}
                {s.note && <p>{s.note}</p>}
              </>
            )}
          </li>
        ))}
      </ul>
      {attempt.endedAt !== undefined && (
        <form
          className="library-filters"
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving || !day) return;
            setSaving(true);
            setMessage("");
            const segment = {
              date: day,
              minutes: minutes ? Number(minutes) : undefined,
              note: note.trim() || undefined,
            };
            const key = JSON.stringify(segment);
            if (request.current?.key !== key)
              request.current = { key, id: crypto.randomUUID() };
            try {
              const result = await api("/api/attempts/" + attempt.id, {
                action: "record-continuation",
                segment: { ...segment, id: request.current.id },
              });
              onUpdated(result.attempt);
              request.current = undefined;
              setDay("");
              setMinutes("");
              setNote("");
              setMessage("Continuation saved.");
            } catch (error) {
              setMessage(errorText(error));
            } finally {
              setSaving(false);
            }
          }}
        >
          <TextInput
            type="date"
            label="Continuation date"
            required
            value={day}
            onChange={(e) => setDay(e.target.value)}
            disabled={saving}
          />
          <TextInput
            type="number"
            label="Minutes (optional)"
            min={1}
            max={1440}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            disabled={saving}
          />
          <TextInput
            label="Note (optional)"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving}
          />
          <Button
            type="submit"
            className="button secondary"
            disabled={saving || !day}
          >
            Log continuation
          </Button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
