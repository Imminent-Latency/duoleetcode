import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AttemptStore } from "./store";
import type { Attempt } from "./types";
import { evidenceFromAttempt } from "./learner-memory";
import { workSegments } from "./work-segments";
import { lowSettings } from "./agent-settings";
import { validateSnapshot, operationSchema } from "./snapshot-schema";
import type {
  DataOperation,
  LibraryImage,
  LibrarySelection,
  SnapshotArchive,
  SnapshotData,
  SnapshotSummary,
} from "./snapshot-types";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function sealSnapshot(data: SnapshotData): SnapshotArchive {
  return { ...data, sha256: digest(data) };
}
export function parseSnapshot(raw: unknown): SnapshotArchive {
  if (!raw || typeof raw !== "object")
    throw new Error("Choose a DuoLeetCode snapshot file.");
  const legacy = raw as Record<string, any>;
  if (legacy.format === "duoleetcode-practice" && legacy.version === 1) {
    const emptyMemory: LibraryImage["memory"] = {
      version: 1,
      preferences: [],
      preferenceRevisions: [],
      forgotten: [],
      evidence: [],
      corrections: [],
      uses: [],
      suppressed: [],
    };
    const data: SnapshotData = {
      format: "duoleetcode-snapshot",
      version: 1,
      id: randomUUID(),
      name: "Imported practice export",
      createdAt: legacy.exportedAt,
      practice: {
        attempts: legacy.attempts,
        importedEvidence: legacy.importedEvidence ?? [],
        memory: {
          ...(legacy.learnerMemory ?? emptyMemory),
          suppressed: legacy.learnerMemory?.suppressed ?? [],
        },
      },
      sandbox: { attempts: [], importedEvidence: [], memory: emptyMemory },
      settings: null,
      browser: {},
      pagesPreview: null,
    };
    return sealSnapshot(validateSnapshot(data));
  }
  const { sha256, ...data } = raw as SnapshotArchive;
  if (typeof sha256 !== "string" || sha256 !== digest(data))
    throw new Error(
      "Snapshot checksum does not match. The file may be incomplete or edited.",
    );
  return sealSnapshot(validateSnapshot(data));
}
export function captureLibrary(store: AttemptStore): LibraryImage {
  return structuredClone({
    attempts: store.snapshotRecords(),
    importedEvidence: store.imported(),
    memory: store.memory.export() as unknown as LibraryImage["memory"],
  });
}
export function captureSnapshot(
  practice: AttemptStore,
  sandbox: AttemptStore,
  extras: Pick<SnapshotData, "settings" | "browser" | "pagesPreview">,
  name: string,
): SnapshotArchive {
  const data: SnapshotData = {
    format: "duoleetcode-snapshot",
    version: 1,
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    practice: captureLibrary(practice),
    sandbox: captureLibrary(sandbox),
    ...extras,
  };
  return sealSnapshot(validateSnapshot(data));
}
export function saveSnapshot(folder: string, snapshot: SnapshotArchive) {
  parseSnapshot(snapshot);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, snapshot.id + ".json");
  if (existsSync(file)) {
    if (digest(JSON.parse(readFileSync(file, "utf8"))) !== digest(snapshot))
      throw new Error("A different snapshot already has this ID.");
    return snapshot;
  }
  const temp = path.join(folder, ".snapshot-" + randomUUID());
  try {
    writeFileSync(temp, JSON.stringify(snapshot, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    linkSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
  return snapshot;
}
export function readSnapshot(folder: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid snapshot ID.");
  return parseSnapshot(
    JSON.parse(readFileSync(path.join(folder, id + ".json"), "utf8")),
  );
}
export function listSnapshots(folder: string): SnapshotSummary[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
    .map((n) => {
      const s = readSnapshot(folder, n.slice(0, -5));
      return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        practice: s.practice.attempts.length,
        sandbox: s.sandbox.attempts.length,
        bytes: statSync(path.join(folder, n)).size,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function clearLearning(input: Attempt): Attempt {
  const a = structuredClone(input);
  delete a.reflection;
  delete a.solvingChunks;
  delete a.followup;
  delete a.learningExit;
  delete a.previousLearningExits;
  a.evaluations = [];
  a.annotations = [];
  a.evidenceEpoch = randomUUID();
  if (a.endedAt !== undefined) a.phase = "review";
  a.exposure = "new";
  a.exposureSource = "default";
  delete a.exposureUpdatedAt;
  return a;
}
function restoredAttempt(input: Attempt, time: number, coaching: boolean) {
  const a = coaching ? structuredClone(input) : clearLearning(input);
  if (a.phase === "active") {
    if (a.deadline <= time) {
      a.phase = "review";
      a.endedAt = a.deadline;
      a.sealed = true;
    } else {
      a.phase = "paused";
      a.pauses.push({ start: time });
    }
  }
  for (const j of a.jobs)
    if (["sending", "judging"].includes(j.state)) {
      j.state = "unknown";
      j.error =
        "Restored an unfinished request. Its outcome is unknown; it has not been resent.";
    }
  for (const h of a.javaHelp ?? [])
    if (h.state === "pending") {
      h.state = "failed";
      h.error = "Request was pending when this snapshot was saved.";
    }
  a.workSegments = workSegments(a);
  return a;
}
type ChangeCounts = {
  added: number;
  replaced: number;
  removed: number;
  kept: number;
  coachingCleared: number;
};
export type DataPreview = {
  token: string;
  counts: Record<string, ChangeCounts>;
  notes: string[];
  changed: boolean;
};
const initialCounts = (): ChangeCounts => ({
  added: 0,
  replaced: 0,
  removed: 0,
  kept: 0,
  coachingCleared: 0,
});
function selectKnown(ids: string[], available: { id: string }[]) {
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !available.some((a) => a.id === id))
  )
    throw new Error(
      "Selection no longer matches the library. Refresh the preview.",
    );
}
function mergeRows<T extends { id: string }>(
  current: T[],
  incoming: T[],
  replace: boolean,
  counts: ChangeCounts,
  key = (r: T) => r.id,
): T[] {
  const result = new Map(current.map((r) => [key(r), r]));
  for (const row of incoming) {
    const previous = result.get(key(row));
    if (!previous) {
      result.set(key(row), row);
      counts.added++;
    } else if (!replace || canonical(previous) === canonical(row))
      counts.kept++;
    else {
      result.set(key(row), row);
      counts.replaced++;
    }
  }
  return [...result.values()];
}
function projectLibrary(
  current: LibraryImage,
  source: LibraryImage,
  selection: LibrarySelection,
  op: DataOperation,
  capturedAt: number,
  counts: Record<string, ChangeCounts>,
  prefix: string,
): LibraryImage {
  const out = structuredClone(current),
    m = out.memory,
    sm = source.memory;
  const restore = op.action === "restore",
    replace = op.conflicts === "replace";
  const selectedSource = restore ? source : current;
  selectKnown(selection.attempts, selectedSource.attempts);
  selectKnown(selection.evidence, selectedSource.memory.evidence);
  selectKnown(
    selection.imported,
    selectedSource.importedEvidence as { id: string }[],
  );
  const tally = (label: string) =>
    (counts[prefix + " · " + label] ??= initialCounts());
  const attemptIds = new Set(selection.attempts),
    evidenceIds = new Set(selection.evidence),
    importedIds = new Set(selection.imported);
  if (restore)
    out.attempts = mergeRows(
      out.attempts,
      source.attempts
        .filter((a) => attemptIds.has(a.id))
        .map((a) => restoredAttempt(a, capturedAt, selection.coaching)),
      replace,
      tally("sessions"),
    );
  else if (op.attemptMode === "coaching") {
    out.attempts = out.attempts.map((a) =>
      attemptIds.has(a.id)
        ? (tally("sessions").coachingCleared++, clearLearning(a))
        : a,
    );
  } else {
    out.attempts = out.attempts.filter((a) => !attemptIds.has(a.id));
    tally("sessions").removed = attemptIds.size;
  }
  if (restore) {
    out.importedEvidence = mergeRows(
      out.importedEvidence as { id: string }[],
      source.importedEvidence.filter((e) => importedIds.has(e.id)) as {
        id: string;
      }[],
      replace,
      tally("imported notes"),
    );
    const oldIds = new Set(m.evidence.map((e) => e.id));
    const incoming = sm.evidence.filter((e) => evidenceIds.has(e.id));
    m.evidence = mergeRows(
      m.evidence,
      incoming,
      replace,
      tally("skill evidence"),
    );
    const accepted = new Set(
      incoming.filter((e) => replace || !oldIds.has(e.id)).map((e) => e.id),
    );
    m.corrections = [
      ...m.corrections.filter((c) => !accepted.has(c.id)),
      ...sm.corrections.filter((c) => accepted.has(c.id)),
    ];
    m.suppressed = m.suppressed.filter((e) => !evidenceIds.has(e.id));
    // Suppression belongs to the evidence archive; it never deletes selected records.
    if (
      selection.evidence.length === sm.evidence.length &&
      selection.evidence.length > 0
    )
      m.suppressed = mergeRows(
        m.suppressed,
        sm.suppressed,
        false,
        initialCounts(),
      );
  } else {
    out.importedEvidence = out.importedEvidence.filter(
      (e) => !importedIds.has(e.id),
    );
    tally("imported notes").removed = importedIds.size;
    m.evidence = m.evidence.filter((e) => !evidenceIds.has(e.id));
    tally("skill evidence").removed = evidenceIds.size;
    m.corrections = m.corrections.filter((c) => !evidenceIds.has(c.id));
    m.suppressed = mergeRows(
      m.suppressed,
      [...evidenceIds].map((id) => ({ id })),
      false,
      initialCounts(),
    );
  }
  if (selection.preferences) {
    if (restore) {
      const existing = new Set(m.preferences.map((p) => p.id));
      const forgotten = new Set(m.forgotten.map((p) => p.id));
      const incoming = sm.preferences.filter(
        (p) => replace || !forgotten.has(p.id),
      );
      const accepted = new Set(
        incoming.filter((p) => replace || !existing.has(p.id)).map((p) => p.id),
      );
      m.preferences = mergeRows(
        m.preferences,
        incoming,
        replace,
        tally("coach preferences"),
      );
      m.preferenceRevisions = [
        ...m.preferenceRevisions.filter((p) => !accepted.has(p.id)),
        ...sm.preferenceRevisions.filter((p) => accepted.has(p.id)),
      ];
      const sourceForgotten = sm.forgotten.filter(
        (p) => replace || !existing.has(p.id),
      );
      const forgottenIds = new Set(sourceForgotten.map((p) => p.id));
      tally("coach preferences").removed += m.preferences.filter((p) =>
        forgottenIds.has(p.id),
      ).length;
      m.preferences = m.preferences.filter((p) => !forgottenIds.has(p.id));
      m.preferenceRevisions = m.preferenceRevisions.filter(
        (p) => !forgottenIds.has(p.id),
      );
      m.forgotten = mergeRows(
        m.forgotten.filter((p) => !accepted.has(p.id)),
        sourceForgotten,
        false,
        initialCounts(),
      );
    } else {
      tally("coach preferences").removed = m.preferences.length;
      m.preferences = [];
      m.preferenceRevisions = [];
      m.forgotten = [];
    }
  }
  if (selection.receipts) {
    if (restore)
      m.uses = mergeRows(m.uses, sm.uses, replace, tally("memory receipts"));
    else {
      tally("memory receipts").removed = m.uses.length;
      m.uses = [];
    }
  }
  // A restored attempt without its evidence must not silently repopulate that evidence on save.
  const present = new Set(m.evidence.map((e) => e.id));
  const skipped = out.attempts
    .flatMap(evidenceFromAttempt)
    .filter((e) => !present.has(e.id))
    .map(({ id }) => ({ id }));
  skipped.push(
    ...out.importedEvidence
      .filter((e) => !present.has("imported:" + e.id))
      .map((e) => ({ id: "imported:" + e.id })),
  );
  m.suppressed = mergeRows(
    m.suppressed,
    skipped,
    false,
    initialCounts(),
  ).filter((e) => !present.has(e.id));
  return out;
}
export function projectOperation(
  current: SnapshotData,
  source: SnapshotData,
  raw: DataOperation,
) {
  const operation = operationSchema.parse(raw),
    { selection } = operation;
  const counts: Record<string, ChangeCounts> = {};
  const projected = structuredClone(current);
  delete (projected as Partial<SnapshotArchive>).sha256;
  projected.practice = projectLibrary(
    current.practice,
    source.practice,
    selection.practice,
    operation,
    Date.parse(source.createdAt),
    counts,
    "Practice",
  );
  projected.sandbox = projectLibrary(
    current.sandbox,
    source.sandbox,
    selection.sandbox,
    operation,
    Date.parse(source.createdAt),
    counts,
    "Test",
  );
  const notes = [
    "Snapshots stay available after a reset. LeetCode submissions and sign-ins are unaffected.",
  ];
  if (selection.settings) {
    projected.settings =
      operation.action === "restore"
        ? source.settings
        : lowSettings("gpt-6.1-sol");
    notes.push(
      operation.action === "restore"
        ? "Agent settings will be replaced by this snapshot’s settings."
        : "Agent settings will return to the Low preset.",
    );
  }
  if (selection.browser) {
    projected.browser = operation.action === "restore" ? source.browser : {};
    notes.push(
      "Layout preferences and reflection drafts in this browser will be replaced.",
    );
  }
  if (selection.pagesPreview) {
    projected.pagesPreview =
      operation.action === "restore" ? source.pagesPreview : null;
    notes.push(
      "Only the saved Pages import proposal is affected; this does not import any Pages sessions.",
    );
  }
  if (operation.action === "reset" && operation.attemptMode === "coaching")
    notes.push(
      "Selected sessions keep code, replay, judge results, assessment help, and work segments. Feedback, reflection, familiarity answers, focused coaching, and learning completion are cleared. Skill evidence is selected separately.",
    );
  if (operation.action === "restore")
    notes.push(
      "Existing records follow your keep/replace choice. Active snapshots restore paused; unfinished judge requests are never resent.",
    );
  if (
    [projected.practice, projected.sandbox].some((l) =>
      l.memory.evidence.some(
        (e) => e.attempt_id && !l.attempts.some((a) => a.id === e.attempt_id),
      ),
    )
  )
    notes.push(
      "Some retained skill evidence has no session in the live library. Its saved excerpts remain available; the full recording stays in the snapshot.",
    );
  validateSnapshot(projected);
  const state = (s: SnapshotData) => ({
    practice: s.practice,
    sandbox: s.sandbox,
    settings: s.settings,
    browser: s.browser,
    pagesPreview: s.pagesPreview,
  });
  return {
    projected,
    preview: {
      token: digest({
        current: state(current),
        source: state(source),
        operation,
      }),
      counts,
      notes,
      changed: canonical(state(current)) !== canonical(state(projected)),
    } satisfies DataPreview,
  };
}
export function replaceLibrary(store: AttemptStore, image: LibraryImage) {
  const db = store.db;
  db.exec(
    "DELETE FROM events; DELETE FROM checkpoints; DELETE FROM attempts; DELETE FROM historical_evidence; DELETE FROM coaching_memories; DELETE FROM coaching_memory_revisions; DELETE FROM forgotten_memories; DELETE FROM skill_evidence; DELETE FROM skill_evidence_search; DELETE FROM evidence_corrections; DELETE FROM memory_uses; DELETE FROM evidence_suppression;",
  );
  for (const a of image.attempts) {
    const { events, checkpoints, ...record } = a;
    db.prepare("INSERT INTO attempts VALUES(?,?)").run(
      a.id,
      JSON.stringify(record),
    );
    for (const e of events)
      db.prepare("INSERT INTO events VALUES(?,?,?)").run(
        a.id,
        e.seq,
        JSON.stringify(e),
      );
    for (const c of checkpoints)
      db.prepare("INSERT INTO checkpoints VALUES(?,?,?)").run(
        a.id,
        c.seq,
        c.source,
      );
  }
  for (const row of image.importedEvidence)
    db.prepare("INSERT INTO historical_evidence VALUES(?,?)").run(
      row.id,
      JSON.stringify(row),
    );
  const m = image.memory;
  for (const p of m.preferences)
    db.prepare("INSERT INTO coaching_memories VALUES(?,?)").run(
      p.id,
      JSON.stringify(p),
    );
  for (const p of m.preferenceRevisions)
    db.prepare("INSERT INTO coaching_memory_revisions VALUES(?,?,?)").run(
      p.id,
      p.revision,
      p.data,
    );
  for (const p of m.forgotten)
    db.prepare("INSERT INTO forgotten_memories VALUES(?)").run(p.id);
  for (const e of m.evidence) {
    db.prepare("INSERT INTO skill_evidence VALUES(?,?,?,?,?,?)").run(
      e.id,
      e.attempt_id,
      e.skill_id,
      e.current,
      e.at,
      e.data,
    );
    const evidence = JSON.parse(e.data),
      correction = m.corrections
        .filter((c) => c.id === e.id)
        .sort((a, b) => b.revision - a.revision)[0];
    db.prepare("INSERT INTO skill_evidence_search VALUES(?,?,?)").run(
      e.id,
      evidence.skillId + " " + evidence.skill,
      evidence.observation +
        (correction ? " " + JSON.parse(correction.data).text : ""),
    );
  }
  for (const c of m.corrections)
    db.prepare("INSERT INTO evidence_corrections VALUES(?,?,?)").run(
      c.id,
      c.revision,
      c.data,
    );
  for (const u of m.uses)
    db.prepare("INSERT INTO memory_uses VALUES(?,?,?)").run(u.id, u.at, u.data);
  for (const e of m.suppressed)
    db.prepare("INSERT INTO evidence_suppression VALUES(?)").run(e.id);
}
export function assertIdle(practice: AttemptStore, sandbox: AttemptStore) {
  const shared = globalThis as typeof globalThis & {
    duoAgentLocks?: Set<string>;
    duoReferenceLocks?: Set<string>;
  };
  if (shared.duoAgentLocks?.size || shared.duoReferenceLocks?.size)
    throw new Error(
      "Wait for the current coach response before resetting or restoring data.",
    );
  const attempts = [
    ...practice.snapshotRecords(),
    ...sandbox.snapshotRecords(),
  ];
  if (attempts.some((a) => ["active", "paused"].includes(a.phase)))
    throw new Error(
      "Finish the active assessment before resetting or restoring data. You can save a snapshot now.",
    );
  if (
    attempts.some((a) =>
      a.jobs.some((j) => ["sending", "judging"].includes(j.state)),
    )
  )
    throw new Error(
      "Wait for the pending judge result before resetting or restoring data.",
    );
}

/** Recovery journal contains complete pre-operation data until both databases and settings commit. */
export function applyProjected(
  practice: AttemptStore,
  sandbox: AttemptStore,
  before: SnapshotArchive,
  projected: SnapshotData,
  journal: string,
  writeExtras: (s: SnapshotData) => void,
) {
  mkdirSync(path.dirname(journal), { recursive: true, mode: 0o700 });
  const temp = journal + ".tmp";
  writeFileSync(temp, JSON.stringify(before), { mode: 0o600 });
  renameSync(temp, journal);
  try {
    practice.transaction(() => replaceLibrary(practice, projected.practice));
    sandbox.transaction(() => replaceLibrary(sandbox, projected.sandbox));
    writeExtras(projected);
    rmSync(journal);
  } catch (error) {
    // Retain the journal if rollback itself fails so next startup can recover.
    practice.transaction(() => replaceLibrary(practice, before.practice));
    sandbox.transaction(() => replaceLibrary(sandbox, before.sandbox));
    writeExtras(before);
    rmSync(journal);
    throw error;
  }
}
