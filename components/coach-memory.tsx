"use client";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { api } from "@/lib/browser";
import { PageHeader, PageTabPanel, PageTabs } from "./ui";
import CoachText from "./coach-text";
import type {
  CoachingMemory,
  MemoryScope,
  MemoryUse,
  SkillEvidence,
} from "@/lib/learner-memory-types";

type Data = {
  preferences: CoachingMemory[];
  evidence: SkillEvidence[];
  uses: MemoryUse[];
  sandbox: boolean;
  availableAttemptIds: string[];
};
const scopes = [
  { value: "all", label: "All coaching and planning" },
  { value: "reflection", label: "Reflection and assessment feedback" },
  { value: "coaching", label: "Focused coaching" },
  { value: "planning", label: "Choosing the next activity" },
];
const date = (value: number) => new Date(value).toLocaleString();
// Long lists render a first batch with a "Show all" control (same treatment as
// Progress › Earlier practice). Purely presentational; everything is fetched.
const FIRST_BATCH = 8;
function ShowAllToggle({
  total,
  open,
  onToggle,
}: {
  total: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (total <= FIRST_BATCH) return null;
  return (
    <li className="memory-list-more">
      <button
        type="button"
        className="earlier-show-all"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open
          ? "Show fewer"
          : `Show all ${total} (${total - FIRST_BATCH} more)`}
      </button>
    </li>
  );
}
export default function CoachMemory({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [older, setOlder] = useState(false);
  const [edit, setEdit] = useState<CoachingMemory | "new">();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<MemoryScope>("all");
  const [revisions, setRevisions] = useState<CoachingMemory[]>([]);
  const [correction, setCorrection] = useState<SkillEvidence>();
  const [excluded, setExcluded] = useState(false);
  const [allEvidence, setAllEvidence] = useState(false);
  const [allUses, setAllUses] = useState(false);
  const load = async (search = query, includeOlder = older) => {
    const result = await api(
      `/api/memory?q=${encodeURIComponent(search)}&older=${includeOlder}`,
    );
    setData(result);
  };
  useEffect(() => {
    void load("", false).catch((e) => setError(String(e)));
  }, []);
  const act = async (body: unknown, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/memory", body);
      await load();
      setNotice(success);
      setEdit(undefined);
      setCorrection(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const openEditor = (memory?: CoachingMemory) => {
    setEdit(memory ?? "new");
    setText(memory?.text ?? "");
    setScope(memory?.scope ?? "all");
    setRevisions([]);
    setError("");
    if (memory)
      void api("/api/memory?id=" + encodeURIComponent(memory.id))
        .then((r) => setRevisions(r.revisions))
        .catch((e) => setError(String(e)));
  };
  const sourceButton = (source: {
    attemptId?: string;
    url?: string;
    label: string;
  }) =>
    source.attemptId && data?.availableAttemptIds.includes(source.attemptId) ? (
      <Button
        variant="subtle"
        size="compact-sm"
        className="memory-source-button"
        onClick={() => onOpen(source.attemptId!)}
      >
        Open session · {source.label}
      </Button>
    ) : source.url ? (
      <Button
        component="a"
        href={source.url}
        target="_blank"
        rel="noreferrer"
        variant="subtle"
        size="compact-sm"
        className="memory-source-button"
      >
        View source · {source.label}
      </Button>
    ) : (
      <Text size="sm" c="dimmed">
        {source.label}
        {source.attemptId
          ? " · Full session is outside the current library; check saved snapshots."
          : ""}
      </Text>
    );
  return (
    <div className="page-content coach-memory-page">
      <PageHeader
        title="Coach memory"
        description="Preferences and skill evidence used by the coach."
      />
      <Stack gap="md">
        {error && (
          <Alert color="red" title="Could not save or load memory">
            {error}
            <Button
              variant="subtle"
              onClick={() =>
                load()
                  .then(() => setError(""))
                  .catch((e) => setError(String(e)))
              }
            >
              Refresh
            </Button>
          </Alert>
        )}
        {notice && (
          <Alert color="teal" role="status">
            {notice}
          </Alert>
        )}
        {data?.sandbox && (
          <Alert color="yellow">
            Test mode has its own memory. Real practice and personal preferences
            are separate.
          </Alert>
        )}
        <PageTabs
          aria-label="Coach memory sections"
          defaultValue="preferences"
          tabs={[
            { value: "preferences", label: "Preferences" },
            { value: "evidence", label: "Skill evidence" },
            { value: "used", label: "What the coach used" },
          ]}
        >
          <PageTabPanel value="preferences">
            <div className="memory-section">
              <div className="memory-section-header">
                <div className="memory-section-intro">
                  <h3>How you want to be coached</h3>
                  <p>
                    Active preferences guide the next reply. Suggested
                    preferences need your approval.
                  </p>
                </div>
                <Button onClick={() => openEditor()}>Add preference</Button>
              </div>
              {!data && <p className="memory-empty">Loading memory…</p>}
              {data?.preferences.length === 0 && (
                <p className="memory-empty">
                  No coaching preferences yet. Add one in your own words.
                </p>
              )}
              {!!data?.preferences.length && (
                <ul className="memory-list">
                  {data.preferences.map((memory) => (
                    <li key={memory.id} className="memory-row">
                      <div className="memory-row-meta">
                        <Badge
                          size="sm"
                          variant="light"
                          color={memory.status === "active" ? "teal" : "yellow"}
                        >
                          {memory.status === "active"
                            ? "Active"
                            : "Suggested · not used yet"}
                        </Badge>
                        <span>
                          {scopes.find((s) => s.value === memory.scope)?.label}
                        </span>
                        <span>Revision {memory.revision}</span>
                      </div>
                      <p className="memory-row-text">{memory.text}</p>
                      <div className="memory-row-footer">
                        <details className="memory-disclosure">
                          <summary>Why this is here</summary>
                          <div className="memory-disclosure-body">
                            <div className="memory-quote memory-prose">
                              <CoachText>{`“${memory.source.quote}”`}</CoachText>
                            </div>
                            {sourceButton(memory.source)}
                            <p className="memory-caption">
                              {memory.origin === "coach-suggestion"
                                ? "Suggested from a learner message. Approval is required before use."
                                : memory.origin === "project-preference"
                                  ? "Seeded from an explicit preference you gave during project design."
                                  : "Written by you."}{" "}
                              Updated {date(memory.updatedAt)}.
                            </p>
                          </div>
                        </details>
                        <Group gap="xs" className="memory-row-actions">
                          <Button
                            variant="light"
                            size="xs"
                            onClick={() => openEditor(memory)}
                          >
                            {memory.status === "proposed"
                              ? "Review suggestion"
                              : "Edit / history"}
                          </Button>
                          <Button
                            variant="subtle"
                            color="gray"
                            size="xs"
                            disabled={busy}
                            onClick={() =>
                              act(
                                {
                                  action: "forget",
                                  id: memory.id,
                                  revision: memory.revision,
                                },
                                "Forgotten. This preference will not be included in new coach replies.",
                              )
                            }
                          >
                            {memory.status === "proposed"
                              ? "Dismiss"
                              : "Forget"}
                          </Button>
                        </Group>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="memory-caption">
                Forgetting removes the preference and its revision history from
                current memory. Original conversations and existing backups
                still preserve their records.
              </p>
            </div>
          </PageTabPanel>
          <PageTabPanel value="evidence">
            <div className="memory-section">
              <div className="memory-section-intro">
                <h3>What your practice has shown</h3>
                <p>
                  Skill evidence keeps its original context; it is not a mastery
                  score. Search observations across sessions. Correct an
                  interpretation without rewriting your original answer. A
                  correction is shown to the coach as your perspective, not
                  silently converted into a new test result.
                </p>
              </div>
              <form
                className="memory-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setAllEvidence(false);
                  setBusy(true);
                  void load()
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <TextInput
                  aria-label="Search skill evidence"
                  placeholder="Search: map, comparator, time complexity…"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  className="memory-search-input"
                />
                <Button type="submit" variant="default" loading={busy}>
                  Search
                </Button>
                <Checkbox
                  label="Include earlier assessments"
                  checked={older}
                  onChange={(e) => {
                    const next = e.currentTarget.checked;
                    setOlder(next);
                    setAllEvidence(false);
                    void load(query, next).catch((e) => setError(String(e)));
                  }}
                />
              </form>
              {!data && <p className="memory-empty">Loading memory…</p>}
              {data?.evidence.length === 0 && (
                <p className="memory-empty">
                  No matching evidence yet. Completed real practice adds
                  observations here automatically.
                </p>
              )}
              {!!data?.evidence.length && (
                <ul className="memory-list">
                  {(allEvidence
                    ? data.evidence
                    : data.evidence.slice(0, FIRST_BATCH)
                  ).map((evidence) => (
                    <li key={evidence.id} className="memory-row">
                      <div className="memory-row-head">
                        <strong className="memory-row-title">
                          {evidence.skill}
                        </strong>
                        <Group gap={6} className="memory-row-badges">
                          <Badge
                            size="sm"
                            variant="light"
                            color={evidence.correction ? "yellow" : "gray"}
                          >
                            {evidence.correction?.excluded
                              ? "Excluded from coaching"
                              : evidence.correction
                                ? "Correction attached"
                                : evidence.kind === "first-response"
                                  ? "First response"
                                  : "Recorded interpretation"}
                          </Badge>
                          {!evidence.current && (
                            <Badge size="sm" variant="light" color="gray">
                              Earlier assessment
                            </Badge>
                          )}
                        </Group>
                      </div>
                      <div className="memory-row-text memory-prose">
                        <CoachText>{evidence.observation}</CoachText>
                      </div>
                      <p className="memory-caption">
                        {evidence.outcome} · {evidence.support}
                      </p>
                      {evidence.correction && (
                        <div className="memory-correction">
                          <strong>Your correction</strong>
                          <p>{evidence.correction.text}</p>
                        </div>
                      )}
                      <div className="memory-row-footer">
                        <details className="memory-disclosure">
                          <summary>Inspect evidence and source</summary>
                          <div className="memory-disclosure-body">
                            {evidence.source.quotes?.map((q, i) => (
                              <p key={i} className="memory-quote">
                                Learner: “{q.quote}”
                              </p>
                            ))}
                            {evidence.source.events?.length ? (
                              <p className="memory-quote">
                                Recording events:{" "}
                                {evidence.source.events.join(", ")}
                              </p>
                            ) : null}
                            {sourceButton(evidence.source)}
                            <p className="memory-caption">
                              {date(evidence.at)}
                              {evidence.source.model
                                ? ` · ${evidence.source.model}`
                                : ""}
                              {evidence.source.policyVersion
                                ? ` · ${evidence.source.policyVersion}`
                                : ""}
                            </p>
                            <p className="memory-caption">
                              Skill ID: {evidence.skillId}
                            </p>
                          </div>
                        </details>
                        <Button
                          variant="light"
                          size="xs"
                          className="memory-row-actions"
                          onClick={() => {
                            setCorrection(evidence);
                            setText(evidence.correction?.text ?? "");
                            setExcluded(evidence.correction?.excluded ?? false);
                            setError("");
                          }}
                        >
                          Correct this interpretation
                        </Button>
                      </div>
                    </li>
                  ))}
                  <ShowAllToggle
                    total={data.evidence.length}
                    open={allEvidence}
                    onToggle={() => setAllEvidence((v) => !v)}
                  />
                </ul>
              )}
              {data && data.evidence.length >= 100 && (
                <p className="memory-caption">
                  Showing the first 100 matches. Narrow your search to find
                  older evidence.
                </p>
              )}
            </div>
          </PageTabPanel>
          <PageTabPanel value="used">
            <div className="memory-section">
              <div className="memory-section-intro">
                <h3>Context supplied to recent replies</h3>
                <p>
                  These receipts show which preference revisions and evidence
                  records were supplied. They do not prove how much each item
                  influenced the reply.
                </p>
              </div>
              {!data && <p className="memory-empty">Loading memory…</p>}
              {data?.uses.length === 0 && (
                <p className="memory-empty">
                  No real coaching replies have used memory yet.
                </p>
              )}
              {!!data?.uses.length && (
                <ul className="memory-list">
                  {(allUses ? data.uses : data.uses.slice(0, FIRST_BATCH)).map(
                    (use) => (
                      <li key={use.id} className="memory-row">
                        <div className="memory-row-head">
                          <strong className="memory-row-title">
                            {use.role}
                          </strong>
                          <span className="memory-caption">{date(use.at)}</span>
                        </div>
                        {use.preferences.map((p) => (
                          <p className="memory-row-text" key={p.id}>
                            {p.text ?? "Forgotten preference"} · revision{" "}
                            {p.revision}
                          </p>
                        ))}
                        {use.prescription && (
                          <div className="memory-row-text memory-prose">
                            <CoachText>
                              {`Selected ${use.prescription.title}: ${use.prescription.reason}`}
                            </CoachText>
                          </div>
                        )}
                        <p className="memory-caption">
                          {use.preferences.length
                            ? ""
                            : "No active preferences supplied · "}
                          {use.evidenceIds.length} historical evidence records
                          supplied
                        </p>
                        <div className="memory-row-footer">
                          <details className="memory-disclosure">
                            <summary>Evidence record IDs</summary>
                            <div className="memory-disclosure-body">
                              <p className="memory-caption memory-ids">
                                {use.evidenceIds.join(" · ") || "None"}
                              </p>
                            </div>
                          </details>
                          {use.attemptId && (
                            <Button
                              variant="subtle"
                              size="compact-sm"
                              className="memory-row-actions"
                              onClick={() => onOpen(use.attemptId!)}
                              disabled={
                                !data?.availableAttemptIds.includes(
                                  use.attemptId,
                                )
                              }
                            >
                              Open session
                            </Button>
                          )}
                        </div>
                      </li>
                    ),
                  )}
                  <ShowAllToggle
                    total={data.uses.length}
                    open={allUses}
                    onToggle={() => setAllUses((v) => !v)}
                  />
                </ul>
              )}
            </div>
          </PageTabPanel>
        </PageTabs>
      </Stack>
      <Modal
        opened={!!edit}
        onClose={() => !busy && setEdit(undefined)}
        title={
          edit === "new"
            ? "Add coaching preference"
            : "Review coaching preference"
        }
        size="lg"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Use your own words. Changes apply to the next coach reply.
          </Text>
          <Textarea
            label="Preference"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={3}
            maxLength={1500}
          />
          <Select
            label="Use for"
            data={scopes}
            value={scope}
            allowDeselect={false}
            onChange={(v) => setScope(v as MemoryScope)}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="end">
            <Button
              variant="subtle"
              onClick={() => setEdit(undefined)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              disabled={!text.trim()}
              loading={busy}
              onClick={() =>
                act(
                  edit === "new"
                    ? { action: "add", text, scope }
                    : {
                        action: "edit",
                        id: edit!.id,
                        revision: edit!.revision,
                        text,
                        scope,
                      },
                  "Preference saved. Your coach will use it from the next reply.",
                )
              }
            >
              {edit !== "new" && edit?.status === "proposed"
                ? "Approve preference"
                : "Save preference"}
            </Button>
          </Group>
          {!!revisions.length && (
            <Accordion>
              <Accordion.Item value="history">
                <Accordion.Control>
                  Revision history and original source
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm" align="flex-start">
                    {revisions.map((r) => (
                      <div key={r.revision}>
                        <Text size="sm" fw={600} c="var(--text)">
                          Revision {r.revision} · {date(r.updatedAt)}
                        </Text>
                        <Text
                          size="sm"
                          c="var(--text)"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          {r.text}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {r.status === "proposed"
                            ? "Suggested, not active"
                            : "Active preference"}
                        </Text>
                      </div>
                    ))}
                    {edit && edit !== "new" && (
                      <>
                        <Text
                          size="sm"
                          c="var(--text)"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          Original source: “{edit.source.quote}”
                        </Text>
                        {sourceButton(edit.source)}
                      </>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </Stack>
      </Modal>
      <Modal
        opened={!!correction}
        onClose={() => !busy && setCorrection(undefined)}
        title="Correct an interpretation"
        size="lg"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            The original record is preserved. Your correction accompanies this
            evidence whenever the coach retrieves it.
          </Text>
          <Textarea
            label="What should the coach understand instead?"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={3}
            maxLength={1500}
          />
          <Checkbox
            label="Exclude this record from future coaching context"
            checked={excluded}
            onChange={(e) => setExcluded(e.currentTarget.checked)}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="end">
            <Button variant="subtle" onClick={() => setCorrection(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!text.trim()}
              loading={busy}
              onClick={() =>
                act(
                  {
                    action: "correct-evidence",
                    id: correction!.id,
                    revision: correction!.correction?.revision ?? 0,
                    text,
                    excluded,
                  },
                  "Correction saved. Future retrievals will respect it.",
                )
              }
            >
              Save correction
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
