"use client";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  FileButton,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Archive, Download, Upload, RotateCcw } from "lucide-react";
import { api } from "@/lib/browser";
import { captureBrowserData, finishDataChange } from "@/lib/browser-data";
import {
  emptySelection,
  selectEverything,
  type DataOperation,
  type DataSelection,
  type LibraryImage,
  type LibrarySelection,
  type SnapshotArchive,
  type SnapshotSummary,
} from "@/lib/snapshot-types";
import type { DataPreview } from "@/lib/snapshots";
import type { Attempt } from "@/lib/types";
import { SavedSession } from "./practice-library";
import { SectionSwitch } from "./ui";
const when = (s: string | number) => new Date(s).toLocaleString();
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function DataManagement({
  beforeSnapshot,
}: {
  beforeSnapshot?: () => Promise<unknown>;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"restore" | "reset">("restore");
  const [source, setSource] = useState<SnapshotArchive>();
  const [selection, setSelection] = useState<DataSelection>(emptySelection);
  const [attemptMode, setAttemptMode] = useState<"whole" | "coaching">("whole");
  const [conflicts, setConflicts] = useState<"keep" | "replace">("keep");
  const [preview, setPreview] = useState<DataPreview>();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [inspect, setInspect] = useState<Attempt>();
  const load = async () => setSnapshots((await api("/api/data")).snapshots);
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    setPreview(undefined);
    setConfirmation("");
  }, [source, selection, attemptMode, conflicts, mode]);
  const task = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (s: SnapshotArchive, nextMode: "restore" | "reset") => {
    setSource(s);
    setMode(nextMode);
    setSelection(emptySelection());
    setInspect(undefined);
    setAttemptMode("whole");
  };
  const create = () =>
    task(async () => {
      await beforeSnapshot?.();
      const { snapshot } = await api("/api/data", {
        action: "snapshot",
        name:
          name.trim() || `Practice snapshot · ${new Date().toLocaleString()}`,
        browser: captureBrowserData(),
      });
      setName("");
      await load();
      pick(snapshot, "restore");
      setNotice("Snapshot saved. Review it here or download a portable copy.");
    });
  const upload = (file: File | null) => {
    if (!file) return;
    void task(async () => {
      if (file.size > 64 * 1024 * 1024)
        throw new Error("Choose a snapshot under 64 MB.");
      const archive = JSON.parse(await file.text());
      const { snapshot } = await api("/api/data", {
        action: "upload",
        archive,
      });
      await load();
      pick(snapshot, "restore");
      setNotice(
        "Snapshot validated and added to the shelf. Nothing has been restored to your live library.",
      );
    });
  };
  const operation: DataOperation = {
    action: mode,
    selection,
    attemptMode,
    conflicts,
  };
  const makePreview = () =>
    task(async () => {
      const browser = captureBrowserData();
      const result = await api("/api/data", {
        action: "preview",
        operation,
        sourceId: mode === "restore" ? source?.id : undefined,
        browser,
      });
      setPreview(result.preview);
    });
  const apply = () =>
    task(async () => {
      const result = await api("/api/data", {
        action: "apply",
        operation,
        sourceId: mode === "restore" ? source?.id : undefined,
        browser: captureBrowserData(),
        token: preview!.token,
        confirmation: "APPLY",
      });
      if (result.unchanged) {
        setPreview(undefined);
        setNotice("No data needed changing.");
        return;
      }
      try {
        await finishDataChange(result.browser, result.affectedAttempts);
      } catch {
        setNotice(
          "Library updated. Browser preferences could not all be restored; reload before continuing.",
        );
        setPreview(undefined);
        return;
      }
      window.location.reload();
    });
  if (inspect)
    return (
      <div className="settings-subpage">
        <SavedSession
          key={inspect.id}
          attempt={inspect}
          readOnly
          onUpdated={() => {}}
          onBack={() => setInspect(undefined)}
          onContinue={() => {}}
        />
      </div>
    );
  return (
    <div className="settings-subpage data-page">
      <p className="subpage-description">
        Export, restore, or reset local practice data.
      </p>
      <Stack gap="md">
        {error && (
          <Alert color="red" title="Could not complete this action">
            {error}
          </Alert>
        )}
        {notice && <Alert color="teal">{notice}</Alert>}
        <Paper withBorder className="settings-card">
          <div className="settings-card-heading">
            <Title order={3} className="settings-section-title">
              Save everything as a snapshot
            </Title>
            <Text className="settings-help">
              Includes practice and test sessions, recordings, results,
              coaching, skill evidence and corrections, coach preferences, agent
              settings, and this browser’s layouts and reflection drafts.
              Sign-ins stay connected and are never exported.
            </Text>
          </div>
          <div className="snapshot-create">
            <TextInput
              className="snapshot-name"
              label="Snapshot name"
              placeholder="Before trying a different coaching approach"
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <div className="snapshot-create-actions">
              <Button
                leftSection={<Archive size={16} />}
                loading={busy}
                onClick={create}
              >
                Save snapshot
              </Button>
              <FileButton accept="application/json,.json" onChange={upload}>
                {(props) => (
                  <Button
                    {...props}
                    variant="default"
                    disabled={busy}
                    leftSection={<Upload size={16} />}
                  >
                    Open snapshot file
                  </Button>
                )}
              </FileButton>
            </div>
          </div>
          <Text className="settings-caption">
            Captures the last saved state. Copies stay on this device. Download
            a snapshot to keep it elsewhere. Browser recovery queues and live
            connection handles are temporary state, not snapshot contents.
          </Text>
        </Paper>
        <SectionSwitch
          aria-label="Snapshot actions"
          value={mode}
          onChange={(v) => {
            if (v === "reset")
              void task(async () => {
                const { snapshot } = await api("/api/data", {
                  action: "current",
                  browser: captureBrowserData(),
                });
                pick(snapshot, "reset");
              });
            else {
              setMode("restore");
              setSource(undefined);
            }
          }}
          data={[
            { value: "restore", label: "Saved snapshots" },
            { value: "reset", label: "Start fresh" },
          ]}
        />
        {mode === "restore" && (
          <Paper withBorder className="settings-card">
            <Title order={3} className="settings-section-title">
              Your snapshot shelf
            </Title>
            {!snapshots.length && (
              <Text className="settings-help">
                Save your first snapshot before trying a different setup.
              </Text>
            )}
            {snapshots.length > 0 && (
              <div className="snapshot-shelf">
                {snapshots.map((s) => (
                  <div key={s.id} className="snapshot-row">
                    <div className="snapshot-row-text">
                      <Text fw={600} className="snapshot-row-name">
                        {s.name}
                      </Text>
                      <Text className="settings-caption">
                        {when(s.createdAt)} · {s.practice} practice ·{" "}
                        {s.sandbox} test · {(s.bytes / 1024).toFixed(0)} KB
                      </Text>
                    </div>
                    <Group
                      gap="xs"
                      wrap="nowrap"
                      className="snapshot-row-actions"
                    >
                      <Button
                        variant="light"
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          task(async () =>
                            pick(
                              (await api(`/api/data?id=${s.id}`)).snapshot,
                              "restore",
                            ),
                          )
                        }
                      >
                        Review & restore
                      </Button>
                      <Button
                        component="a"
                        href={`/api/data?id=${s.id}&download=1`}
                        variant="subtle"
                        size="xs"
                        leftSection={<Download size={15} />}
                      >
                        Download
                      </Button>
                    </Group>
                  </div>
                ))}
              </div>
            )}
          </Paper>
        )}
        {source && (
          <Paper withBorder className="settings-card">
            <div className="settings-card-heading">
              <Group gap="sm">
                <Badge color={mode === "reset" ? "orange" : "teal"}>
                  {mode === "reset" ? "Live library" : "Read-only snapshot"}
                </Badge>
                <Text size="sm" c="dimmed">
                  {when(source.createdAt)}
                </Text>
              </Group>
              <Title
                order={3}
                className="settings-section-title snapshot-source-title"
              >
                {mode === "reset" ? "Choose what to clear" : source.name}
              </Title>
              <Text className="settings-help">
                {mode === "reset"
                  ? "Only selected data will be removed. Saved snapshots remain available. A recovery snapshot is also saved before applying."
                  : "Review any session without importing it. Select only the parts you want back in your live library."}
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="light"
                size="xs"
                onClick={() => setSelection(selectEverything(source))}
              >
                Select everything
              </Button>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setSelection(emptySelection())}
              >
                Clear selection
              </Button>
            </Group>
            {mode === "reset" ? (
              <Select
                className="data-select"
                comboboxProps={{
                  classNames: { dropdown: "settings-dropdown" },
                }}
                label="For selected sessions"
                value={attemptMode}
                allowDeselect={false}
                onChange={(v) => setAttemptMode(v as typeof attemptMode)}
                data={[
                  { value: "whole", label: "Remove entire sessions" },
                  {
                    value: "coaching",
                    label:
                      "Clear coaching only (keep solutions, recordings, and judge results)",
                  },
                ]}
              />
            ) : (
              <Select
                className="data-select"
                comboboxProps={{
                  classNames: { dropdown: "settings-dropdown" },
                }}
                label="If a selected record already exists"
                value={conflicts}
                allowDeselect={false}
                onChange={(v) => setConflicts(v as typeof conflicts)}
                data={[
                  { value: "keep", label: "Keep my current version" },
                  {
                    value: "replace",
                    label: "Replace it with the snapshot version",
                  },
                ]}
              />
            )}
            <LibraryChoices
              title="Practice"
              library={source.practice}
              value={selection.practice}
              onChange={(practice) => setSelection({ ...selection, practice })}
              onInspect={setInspect}
              restoring={mode === "restore"}
            />
            <LibraryChoices
              title="Test sessions"
              library={source.sandbox}
              value={selection.sandbox}
              onChange={(sandbox) => setSelection({ ...selection, sandbox })}
              onInspect={setInspect}
              restoring={mode === "restore"}
              sandbox
            />
            <Checkbox
              label="Agent settings"
              description={
                mode === "reset"
                  ? "Return all features to the Low preset."
                  : "Use the model and effort choices saved in this snapshot."
              }
              checked={selection.settings}
              disabled={!source.settings}
              onChange={(e) =>
                setSelection({
                  ...selection,
                  settings: e.currentTarget.checked,
                })
              }
            />
            {!!source.settings && (
              <Text className="settings-caption data-settings-summary">
                {Object.entries(source.settings.features)
                  .map(([role, s]) => `${role}: ${s.model} / ${s.effort}`)
                  .join(" · ")}
              </Text>
            )}
            <Checkbox
              label="This browser’s layouts and reflection drafts"
              description={`${Object.keys(source.browser).length} saved values. Other browsers keep their own layout preferences.`}
              checked={selection.browser}
              onChange={(e) =>
                setSelection({
                  ...selection,
                  browser: e.currentTarget.checked,
                })
              }
            />
            <Checkbox
              label="Staged Pages import preview"
              description="The saved proposal only. Does not import historical Pages sessions."
              checked={selection.pagesPreview}
              disabled={!source.pagesPreview}
              onChange={(e) =>
                setSelection({
                  ...selection,
                  pagesPreview: e.currentTarget.checked,
                })
              }
            />
            <Text className="settings-caption">
              Skill evidence and coaching are selected separately. Keeping
              evidence after clearing its session preserves the observation and
              source excerpts; the full recording remains available in your
              snapshot. Progress totals continue to reflect the sessions in your
              live library.
            </Text>
            <Group justify="flex-end">
              <Button
                loading={busy}
                color={mode === "reset" ? "orange" : "teal"}
                leftSection={<RotateCcw size={16} />}
                onClick={makePreview}
              >
                {mode === "reset" ? "Preview reset" : "Preview restore"}
              </Button>
            </Group>
          </Paper>
        )}
      </Stack>
      <Modal
        opened={!!preview}
        onClose={() => !busy && setPreview(undefined)}
        title={mode === "reset" ? "Review your reset" : "Review your restore"}
        size="lg"
      >
        <Stack>
          {preview && (
            <>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Data</Table.Th>
                    <Table.Th>Add</Table.Th>
                    <Table.Th>Replace</Table.Th>
                    <Table.Th>Remove</Table.Th>
                    <Table.Th>Keep</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(preview.counts)
                    .filter(([, c]) => Object.values(c).some(Boolean))
                    .map(([label, c]) => (
                      <Table.Tr key={label}>
                        <Table.Td>
                          {label}
                          {c.coachingCleared > 0 && (
                            <Text size="xs">
                              Clear coaching in {c.coachingCleared} sessions
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>{c.added}</Table.Td>
                        <Table.Td>{c.replaced}</Table.Td>
                        <Table.Td>{c.removed}</Table.Td>
                        <Table.Td>{c.kept}</Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
              {preview.notes.map((n) => (
                <Text key={n} size="sm">
                  {n}
                </Text>
              ))}
              {!preview.changed && (
                <Alert>
                  No changes selected, or the selected records are already
                  present.
                </Alert>
              )}
              {mode === "reset" && preview.changed && (
                <TextInput
                  label="Type RESET to apply these removals"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.currentTarget.value)}
                />
              )}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => setPreview(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  color={mode === "reset" ? "red" : "teal"}
                  loading={busy}
                  disabled={
                    !preview.changed ||
                    (mode === "reset" && confirmation !== "RESET")
                  }
                  onClick={apply}
                >
                  {mode === "reset" ? "Apply reset" : "Restore selected data"}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </div>
  );
}

function LibraryChoices({
  title,
  library,
  value,
  onChange,
  onInspect,
  restoring,
  sandbox = false,
}: {
  title: string;
  library: LibraryImage;
  value: LibrarySelection;
  onChange: (v: LibrarySelection) => void;
  onInspect: (a: Attempt) => void;
  restoring: boolean;
  sandbox?: boolean;
}) {
  const [query, setQuery] = useState("");
  const toggle = (
    field: "attempts" | "evidence" | "imported",
    id: string,
    checked: boolean,
  ) =>
    onChange({
      ...value,
      [field]: checked
        ? [...value[field], id]
        : value[field].filter((x) => x !== id),
    });
  const group = (
    field: "attempts" | "evidence" | "imported",
    ids: string[],
    label: string,
  ) => (
    <Checkbox
      label={`${label} (${ids.length})`}
      checked={ids.length > 0 && value[field].length === ids.length}
      indeterminate={
        value[field].length > 0 && value[field].length < ids.length
      }
      disabled={!ids.length}
      onChange={(e) =>
        onChange({ ...value, [field]: e.currentTarget.checked ? ids : [] })
      }
    />
  );
  return (
    <Paper withBorder radius="md" className="library-choices">
      <Stack gap="sm">
        <Title order={4} className="library-choices-title">
          {title}
        </Title>
        {group(
          "attempts",
          library.attempts.map((a) => a.id),
          "Sessions",
        )}
        {restoring && (
          <Checkbox
            ml="lg"
            label="Include saved reflection, feedback, and focused coaching"
            checked={value.coaching}
            onChange={(e) =>
              onChange({ ...value, coaching: e.currentTarget.checked })
            }
          />
        )}
        {library.attempts.length > 0 && (
          <>
            <TextInput
              aria-label={`Search ${title.toLowerCase()} sessions`}
              placeholder="Filter sessions by problem"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            {library.attempts
              .filter((a) =>
                a.problem.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((a) => (
                <Group
                  key={a.id}
                  justify="space-between"
                  wrap="nowrap"
                  gap="sm"
                  ml="lg"
                  className="library-session-row"
                >
                  <Checkbox
                    checked={value.attempts.includes(a.id)}
                    onChange={(e) =>
                      toggle("attempts", a.id, e.currentTarget.checked)
                    }
                    label={a.problem.title}
                    description={`${when(a.createdAt)} · ${a.phase} · ${a.events.length} events`}
                  />
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => onInspect(a)}
                  >
                    View recording & chat
                  </Button>
                </Group>
              ))}
          </>
        )}
        {!sandbox && (
          <>
            <Checkbox
              label={`Coach preferences (${library.memory.preferences.length})`}
              description="Includes sources, revision history, pending suggestions, and forgotten-preference records."
              checked={value.preferences}
              onChange={(e) =>
                onChange({ ...value, preferences: e.currentTarget.checked })
              }
            />
            <Accordion
              variant="contained"
              radius="sm"
              className="library-accordion"
            >
              <Accordion.Item value="preferences">
                <Accordion.Control>Inspect saved preferences</Accordion.Control>
                <Accordion.Panel>
                  <Stack>
                    {library.memory.preferences.map((p) => (
                      <div key={p.id}>
                        <Text size="sm">{p.text}</Text>
                        <Text size="xs" c="dimmed">
                          {p.scope} · {p.status} · revision {p.revision}
                        </Text>
                        <Text size="xs">Source: {p.source.quote}</Text>
                      </div>
                    ))}
                    {!library.memory.preferences.length && (
                      <Text size="sm">No saved preferences.</Text>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
            {group(
              "evidence",
              library.memory.evidence.map((e) => e.id),
              "Skill evidence and corrections",
            )}
            <Accordion
              variant="contained"
              radius="sm"
              className="library-accordion"
            >
              <Accordion.Item value="evidence">
                <Accordion.Control>
                  Choose individual skill observations
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack>
                    {library.memory.evidence.map((row) => {
                      const e = JSON.parse(row.data),
                        correction = library.memory.corrections
                          .filter((c) => c.id === row.id)
                          .sort((a, b) => b.revision - a.revision)[0];
                      return (
                        <Checkbox
                          key={row.id}
                          checked={value.evidence.includes(row.id)}
                          onChange={(ev) =>
                            toggle("evidence", row.id, ev.currentTarget.checked)
                          }
                          label={`${e.skill} · ${e.outcome}`}
                          description={
                            <>
                              {e.observation}
                              {correction && (
                                <Text size="xs">
                                  Your correction:{" "}
                                  {JSON.parse(correction.data).text}
                                </Text>
                              )}
                            </>
                          }
                        />
                      );
                    })}
                    {!library.memory.evidence.length && (
                      <Text size="sm">No recorded observations.</Text>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
            {group(
              "imported",
              library.importedEvidence.map((e) => e.id),
              "Imported historical notes",
            )}
            <Accordion
              variant="contained"
              radius="sm"
              className="library-accordion"
            >
              <Accordion.Item value="notes">
                <Accordion.Control>Choose imported notes</Accordion.Control>
                <Accordion.Panel>
                  <Stack>
                    {library.importedEvidence.map((e) => (
                      <Checkbox
                        key={e.id}
                        label={e.skill}
                        description={e.observation}
                        checked={value.imported.includes(e.id)}
                        onChange={(ev) =>
                          toggle("imported", e.id, ev.currentTarget.checked)
                        }
                      />
                    ))}
                    {!library.importedEvidence.length && (
                      <Text size="sm">No imported notes.</Text>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
            <Checkbox
              label={`Memory usage receipts (${library.memory.uses.length})`}
              description="The record of which preferences and evidence were supplied to earlier replies."
              checked={value.receipts}
              onChange={(e) =>
                onChange({ ...value, receipts: e.currentTarget.checked })
              }
            />
          </>
        )}
      </Stack>
    </Paper>
  );
}
