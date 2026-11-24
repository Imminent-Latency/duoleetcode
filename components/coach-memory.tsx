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
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { api } from "@/lib/browser";
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
    <div className="page-content">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">YOUR COACH, YOUR CONTEXT</span>
          <h1>Coach memory</h1>
          <p>
            See what your coach remembers, where it came from, and change what
            it uses.
          </p>
        </div>
      </div>
      <Stack gap="lg">
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
        <Text c="dimmed" size="sm">
          Active preferences guide the next reply. Suggested preferences need
          your approval. Skill evidence keeps its original context; it is not a
          mastery score.
        </Text>
        <Tabs defaultValue="preferences" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="preferences">Preferences</Tabs.Tab>
            <Tabs.Tab value="evidence">Skill evidence</Tabs.Tab>
            <Tabs.Tab value="used">What the coach used</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="preferences" pt="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={3}>How you want to be coached</Title>
                <Button onClick={() => openEditor()}>Add preference</Button>
              </Group>
              {!data && <Text c="dimmed">Loading memory…</Text>}
              {data?.preferences.length === 0 && (
                <Paper p="xl" withBorder>
                  <Text>
                    No coaching preferences yet. Add one in your own words.
                  </Text>
                </Paper>
              )}
              {data?.preferences.map((memory) => (
                <Paper key={memory.id} p="lg" withBorder radius="md">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Badge
                          color={memory.status === "active" ? "teal" : "yellow"}
                        >
                          {memory.status === "active"
                            ? "Active"
                            : "Suggested · not used yet"}
                        </Badge>
                        <Text size="sm" c="dimmed">
                          {scopes.find((s) => s.value === memory.scope)?.label}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        Revision {memory.revision}
                      </Text>
                    </Group>
                    <Text style={{ whiteSpace: "pre-wrap" }}>
                      {memory.text}
                    </Text>
                    <details>
                      <summary>Why this is here</summary>
                      <Stack gap="xs" mt="sm">
                        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                          “{memory.source.quote}”
                        </Text>
                        {sourceButton(memory.source)}
                        <Text size="xs" c="dimmed">
                          {memory.origin === "coach-suggestion"
                            ? "Suggested from a learner message. Approval is required before use."
                            : memory.origin === "project-preference"
                              ? "Seeded from an explicit preference you gave during project design."
                              : "Written by you."}{" "}
                          Updated {date(memory.updatedAt)}.
                        </Text>
                      </Stack>
                    </details>
                    <Group gap="sm">
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
                        {memory.status === "proposed" ? "Dismiss" : "Forget"}
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              ))}
              <Text size="xs" c="dimmed">
                Forgetting removes the preference and its revision history from
                current memory. Original conversations and existing backups
                still preserve their records.
              </Text>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="evidence" pt="lg">
            <Stack gap="md">
              <Title order={3}>What your practice has shown</Title>
              <Text c="dimmed" size="sm">
                Search observations across sessions. Correct an interpretation
                without rewriting your original answer. A correction is shown to
                the coach as your perspective, not silently converted into a new
                test result.
              </Text>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  void load()
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <Group align="end">
                  <TextInput
                    label="Search skill evidence"
                    placeholder="Map, comparator, time complexity…"
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <Button type="submit" loading={busy}>
                    Search
                  </Button>
                </Group>
              </form>
              <Checkbox
                label="Include earlier assessments"
                checked={older}
                onChange={(e) => {
                  const next = e.currentTarget.checked;
                  setOlder(next);
                  void load(query, next).catch((e) => setError(String(e)));
                }}
              />
              {data?.evidence.length === 0 && (
                <Paper withBorder p="xl">
                  <Text>
                    No matching evidence yet. Completed real practice adds
                    observations here automatically.
                  </Text>
                </Paper>
              )}
              {data?.evidence.map((evidence) => (
                <Paper key={evidence.id} withBorder radius="md" p="lg">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text fw={600}>{evidence.skill}</Text>
                      <Group gap="xs">
                        <Badge
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
                          <Badge color="gray">Earlier assessment</Badge>
                        )}
                      </Group>
                    </Group>
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                      {evidence.observation}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {evidence.outcome} · {evidence.support}
                    </Text>
                    {evidence.correction && (
                      <Alert color="yellow" title="Your correction">
                        {evidence.correction.text}
                      </Alert>
                    )}
                    <details>
                      <summary>Inspect evidence and source</summary>
                      <Stack mt="sm" gap="xs">
                        {evidence.source.quotes?.map((q, i) => (
                          <Text
                            key={i}
                            size="sm"
                            style={{ whiteSpace: "pre-wrap" }}
                          >
                            Learner: “{q.quote}”
                          </Text>
                        ))}
                        {evidence.source.events?.length ? (
                          <Text size="sm">
                            Recording events:{" "}
                            {evidence.source.events.join(", ")}
                          </Text>
                        ) : null}
                        {sourceButton(evidence.source)}
                        <Text size="xs" c="dimmed">
                          {date(evidence.at)}
                          {evidence.source.model
                            ? ` · ${evidence.source.model}`
                            : ""}
                          {evidence.source.policyVersion
                            ? ` · ${evidence.source.policyVersion}`
                            : ""}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Skill ID: {evidence.skillId}
                        </Text>
                      </Stack>
                    </details>
                    <Button
                      variant="light"
                      size="xs"
                      w="fit-content"
                      onClick={() => {
                        setCorrection(evidence);
                        setText(evidence.correction?.text ?? "");
                        setExcluded(evidence.correction?.excluded ?? false);
                        setError("");
                      }}
                    >
                      Correct this interpretation
                    </Button>
                  </Stack>
                </Paper>
              ))}
              {data && data.evidence.length >= 100 && (
                <Text size="sm" c="dimmed">
                  Showing the first 100 matches. Narrow your search to find
                  older evidence.
                </Text>
              )}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="used" pt="lg">
            <Stack gap="md">
              <Title order={3}>Context supplied to recent replies</Title>
              <Text size="sm" c="dimmed">
                These receipts show which preference revisions and evidence
                records were supplied. They do not prove how much each item
                influenced the reply.
              </Text>
              {data?.uses.length === 0 && (
                <Text c="dimmed">
                  No real coaching replies have used memory yet.
                </Text>
              )}
              {data?.uses.map((use) => (
                <Paper key={use.id} withBorder p="lg">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text fw={600}>{use.role}</Text>
                      <Text size="sm" c="dimmed">
                        {date(use.at)}
                      </Text>
                    </Group>
                    {use.preferences.length ? (
                      use.preferences.map((p) => (
                        <Text size="sm" key={p.id}>
                          {p.text ?? "Forgotten preference"} · revision{" "}
                          {p.revision}
                        </Text>
                      ))
                    ) : (
                      <Text size="sm" c="dimmed">
                        No active preferences supplied.
                      </Text>
                    )}
                    <Text size="sm">
                      {use.evidenceIds.length} historical evidence records
                      supplied
                    </Text>
                    <details>
                      <summary>Evidence record IDs</summary>
                      <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                        {use.evidenceIds.join(" · ") || "None"}
                      </Text>
                    </details>
                    {use.prescription && (
                      <Text size="sm">
                        Selected {use.prescription.title}:{" "}
                        {use.prescription.reason}
                      </Text>
                    )}
                    {use.attemptId && (
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        w="fit-content"
                        onClick={() => onOpen(use.attemptId!)}
                        disabled={
                          !data?.availableAttemptIds.includes(use.attemptId)
                        }
                      >
                        Open session
                      </Button>
                    )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Tabs.Panel>
        </Tabs>
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
                  <Stack>
                    {revisions.map((r) => (
                      <div key={r.revision}>
                        <Text size="sm" fw={600}>
                          Revision {r.revision} · {date(r.updatedAt)}
                        </Text>
                        <Text size="sm">{r.text}</Text>
                        <Text size="xs" c="dimmed">
                          {r.status === "proposed"
                            ? "Suggested, not active"
                            : "Active preference"}
                        </Text>
                      </div>
                    ))}
                    {edit && edit !== "new" && (
                      <>
                        <Text size="sm">
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
