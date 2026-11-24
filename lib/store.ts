import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { practiceFile, sandboxFile, sandboxMode } from "./practice-storage.mjs";
import { workSegments } from "./work-segments";
import { applyPauseEvent } from "./assessment-time";
import type { WorkContinuation } from "./types";
import { historySeed } from "./history-seed";
import { LearnerMemory } from "./learner-memory";
import { applyEdits, sameEvent } from "./recording";
import { closeLearning } from "./coaching";
import type { LearningExit } from "./types";
import type { Attempt, AttemptSummary, EvidenceEvent, Problem } from "./types";

export class AttemptStore {
  db: DatabaseSync;
  memory: LearnerMemory;
  constructor(
    filename = practiceFile(),
    private readonly isSandbox = false,
  ) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS historical_evidence(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS library_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(attempt_id TEXT NOT NULL REFERENCES attempts(id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(attempt_id,seq));
      CREATE TABLE IF NOT EXISTS checkpoints(attempt_id TEXT NOT NULL REFERENCES attempts(id),seq INTEGER NOT NULL,source TEXT NOT NULL,PRIMARY KEY(attempt_id,seq));`);
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (version > 3)
      throw new Error("This practice database requires a newer app version.");
    if (version < 1)
      this.transaction(() =>
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS attempts_created ON attempts(json_extract(data,'$.createdAt') DESC);
      CREATE INDEX IF NOT EXISTS attempts_problem ON attempts(json_extract(data,'$.problem.titleSlug'));
      PRAGMA user_version=1;
    `),
      );
    if (
      !this.db.prepare("SELECT 1 FROM library_meta WHERE key='seeded'").get()
    ) {
      for (const row of isSandbox ? [] : historySeed)
        this.db
          .prepare("INSERT OR IGNORE INTO historical_evidence VALUES(?,?)")
          .run(row.id, JSON.stringify(row));
      this.db.prepare("INSERT INTO library_meta VALUES('seeded','true')").run();
    }
    this.memory = new LearnerMemory(this.db, isSandbox);
    this.transaction(() => {
      this.memory.initialize();
      if (version < 3) {
        this.memory.indexImported(this.imported());
        for (const a of this.records()) this.memory.indexAttempt(a);
      }
      this.db.exec("PRAGMA user_version=3");
    });
  }
  imported() {
    return (
      this.db.prepare("SELECT data FROM historical_evidence").all() as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  has(id: string) {
    return !!this.db.prepare("SELECT 1 FROM attempts WHERE id=?").get(id);
  }
  exportLibrary() {
    // A single read transaction keeps attempts, replay events and checkpoints consistent.
    this.db.exec("BEGIN");
    try {
      const rows = this.records().filter((a) => !a.demonstration);
      const data = {
        format: "duoleetcode-practice",
        version: 1,
        exportedAt: new Date().toISOString(),
        attempts: rows.map((a) => this.loadRecording(a)),
        importedEvidence: this.imported(),
        learnerMemory: this.memory.export(),
      };
      this.db.exec("COMMIT");
      return data;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  snapshotRecords() {
    return this.records().map((a) => this.loadRecording(a));
  }
  save(a: Attempt) {
    if (this.isSandbox && !a.demonstration)
      throw new Error("Only test sessions can be saved to the sandbox.");
    a.workSegments = workSegments(a);
    const { events, checkpoints, ...data } = a;
    this.db.exec("SAVEPOINT save_attempt");
    try {
      this.db
        .prepare(
          "INSERT INTO attempts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(a.id, JSON.stringify(data));
      this.memory.indexAttempt(a);
      this.db.exec("RELEASE save_attempt");
    } catch (error) {
      this.db.exec("ROLLBACK TO save_attempt; RELEASE save_attempt");
      throw error;
    }
  }
  get(id: string, now = Date.now()): Attempt {
    const row = this.db
      .prepare("SELECT data FROM attempts WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new Error("Attempt not found");
    return this.expire(this.loadRecording(JSON.parse(row.data)), now);
  }
  private loadRecording(a: Attempt) {
    const { id } = a;
    a.workSegments = workSegments(a);
    a.events = (
      this.db
        .prepare("SELECT data FROM events WHERE attempt_id=? ORDER BY seq")
        .all(id) as { data: string }[]
    ).map((x) => JSON.parse(x.data));
    a.checkpoints = this.db
      .prepare(
        "SELECT seq,source FROM checkpoints WHERE attempt_id=? ORDER BY seq",
      )
      .all(id) as { seq: number; source: string }[];
    return a;
  }
  private expire(a: Attempt, now: number) {
    if (a.phase === "active" && now >= a.deadline) {
      a.phase = "review";
      a.endedAt = a.deadline;
      this.save(a);
    }
    return a;
  }
  create(
    problem: Problem,
    budgetMs: number,
    demonstration = false,
    now = Date.now(),
  ): Attempt {
    demonstration ||= this.isSandbox;
    // Only explicit reflections establish prior familiarity. Merely opening or
    // attempting a problem (especially in a test session) must not establish it.
    const previous = demonstration
      ? undefined
      : (
          this.db.prepare("SELECT data FROM attempts").all() as {
            data: string;
          }[]
        )
          .map(({ data }) => JSON.parse(data) as Attempt)
          .filter(
            (a) =>
              !a.demonstration &&
              a.problem.questionId === problem.questionId &&
              a.problem.titleSlug === problem.titleSlug &&
              a.exposureSource === "reported" &&
              (a.exposureUpdatedAt ?? 0) <= now,
          )
          .sort(
            (a, b) => (b.exposureUpdatedAt ?? 0) - (a.exposureUpdatedAt ?? 0),
          )[0];
    const remembered =
      previous?.exposure === "revisit" || previous?.exposure === "solved";
    const a: Attempt = {
      id: randomUUID(),
      problem,
      budgetMs,
      createdAt: now,
      deadline: now + budgetMs,
      phase: "active",
      initialSource: problem.javaStarter,
      source: problem.javaStarter,
      version: 1,
      lastSeq: 0,
      pauses: [],
      exposure: remembered ? previous.exposure : "new",
      exposureSource: remembered ? "remembered" : "default",
      events: [],
      checkpoints: [],
      jobs: [],
      evaluations: [],
      annotations: [],
      demonstration,
    };
    this.save(a);
    return a;
  }
  recordContinuation(
    id: string,
    report: Pick<WorkContinuation, "id" | "date" | "minutes" | "note">,
    now = Date.now(),
  ) {
    return this.transaction(() => {
      const a = this.get(id, now);
      if (a.endedAt === undefined)
        throw new Error(
          "Finish the timed assessment before logging a continuation.",
        );
      const prior = a.workSegments?.find((s) => s.id === report.id);
      if (prior) {
        if (
          prior.kind !== "continuation" ||
          prior.date !== report.date ||
          prior.minutes !== report.minutes ||
          prior.note !== report.note
        )
          throw new Error(
            "This work segment has already been saved with different details.",
          );
        return a;
      }
      (a.workSegments ??= []).push({
        ...report,
        kind: "continuation",
        recordedAt: now,
      });
      this.save(a);
      return a;
    });
  }
  setExposure(
    id: string,
    exposure: Exclude<Attempt["exposure"], "unknown">,
    now = Date.now(),
  ) {
    return this.transaction(() => {
      const a = this.get(id, now);
      if (!["review", "learn", "complete"].includes(a.phase))
        throw new Error("Add prior familiarity after the assessment.");
      a.exposure = exposure;
      a.exposureSource = "reported";
      a.exposureUpdatedAt = now;
      this.save(a);
      return a;
    });
  }
  append(id: string, events: EvidenceEvent[], now = Date.now()): Attempt {
    return this.transaction(() => {
      const a = this.get(id, now);
      let source = a.source,
        version = a.version,
        seq = a.lastSeq;
      for (const e of events) {
        if (e.seq <= a.lastSeq) {
          if (
            !sameEvent(
              a.events.find((x) => x.seq === e.seq),
              e,
            )
          )
            throw new Error(
              "Conflicting recording event. Reload to recover this attempt.",
            );
          continue;
        }
        if (a.sealed)
          throw new Error(
            "This assessment is already sealed. Coaching edits belong in the learning workspace.",
          );
        if (e.seq !== seq + 1)
          throw new Error(
            "Recording gap. Keep this page open while recovery completes.",
          );
        if (
          e.at < a.createdAt ||
          e.at > (a.endedAt ?? (a.phase === "paused" ? now : a.deadline)) ||
          e.at > now + 5000 ||
          e.at < (a.events.at(-1)?.at ?? a.createdAt)
        )
          throw new Error("Event is outside the assessment interval.");
        if (e.type === "edit") {
          if (
            a.pauses.some((p) => e.at > p.start && e.at < (p.end ?? Infinity))
          )
            throw new Error("Code cannot change during a pause.");
          if (e.version !== version + 1)
            throw new Error("Document version mismatch.");
          source = applyEdits(source, e.edits ?? []);
          version = e.version;
          if (source.length > 200000)
            throw new Error(
              "This POC supports solution files up to 200,000 characters.",
            );
        }
        applyPauseEvent(a, e);
        this.db
          .prepare("INSERT INTO events VALUES(?,?,?)")
          .run(id, e.seq, JSON.stringify(e));
        a.events.push(e);
        seq = e.seq;
        if (seq % 50 === 0) {
          this.db
            .prepare("INSERT INTO checkpoints VALUES(?,?,?)")
            .run(id, seq, source);
          a.checkpoints.push({ seq, source });
        }
      }
      a.source = source;
      a.version = version;
      a.lastSeq = seq;
      this.save(a);
      return a;
    });
  }
  transition(
    id: string,
    action:
      "pause" | "resume" | "finish" | "seal" | "learn" | "complete" | "reflect",
    now = Date.now(),
    exitReason?: LearningExit["reason"],
  ): Attempt {
    return this.transaction(() => {
      const a = this.get(id, now);
      if (action === "pause" && a.phase === "active") {
        a.phase = "paused";
        a.pauses.push({ start: now, reason: "manual" });
      } else if (action === "resume" && a.phase === "paused") {
        const pause = a.pauses.at(-1)!;
        pause.end = now;
        a.deadline += now - pause.start;
        a.phase = "active";
      } else if (
        action === "finish" &&
        (a.phase === "active" || a.phase === "paused")
      ) {
        if (a.phase === "paused") {
          const pause = a.pauses.at(-1)!;
          pause.end = now;
          a.deadline += now - pause.start;
        }
        a.endedAt = Math.min(now, a.deadline);
        a.phase = "review";
        a.sealed = true;
      } else if (action === "seal" && a.phase === "review") {
        a.sealed = true;
      } else if (
        action === "reflect" &&
        ["complete", "learn", "review"].includes(a.phase)
      ) {
        if (a.phase === "complete" && a.learningExit) {
          (a.previousLearningExits ??= []).push(a.learningExit);
          delete a.learningExit;
        }
        a.phase = "review";
      } else if (action === "learn" && a.phase === "review") {
        a.sealed = true;
        a.phase = "learn";
      } else if (action === "learn" && a.phase === "complete") {
        if (a.learningExit)
          (a.previousLearningExits ??= []).push(a.learningExit);
        delete a.learningExit;
        a.phase = "learn";
      } else if (action === "complete") {
        closeLearning(a, exitReason, now);
      } else if (!(
        (action === "pause" && a.phase === "paused") ||
        (action === "resume" && a.phase === "active") ||
        (["finish", "seal"].includes(action) &&
          ["review", "learn", "complete"].includes(a.phase))
      ))
        throw new Error("This action is not available in the current phase.");
      this.save(a);
      return a;
    });
  }
  private records(): Attempt[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM attempts ORDER BY json_extract(data,'$.createdAt') DESC, rowid DESC",
        )
        .all() as { data: string }[]
    ).map(({ data }) => JSON.parse(data));
  }
  list(): AttemptSummary[] {
    const now = Date.now();
    return this.records().map((row) => {
      const a = this.expire(row, now);
      return {
        id: a.id,
        title: a.problem.title,
        slug: a.problem.titleSlug,
        difficulty: a.problem.difficulty,
        createdAt: a.createdAt,
        phase: a.phase,
        budgetMs: a.budgetMs,
        endedAt: a.endedAt,
        exposure: a.exposure,
        verdict:
          a.jobs.filter((j) => j.kind === "submit").at(-1)?.summary?.verdict ??
          "Not submitted",
        events: a.lastSeq,
        gap: a.evaluations.at(-1)?.gaps[0]?.skill,
        demonstration: a.demonstration,
      };
    });
  }
  history() {
    const now = Date.now();
    return this.records()
      .filter((a) => !a.demonstration)
      .map((a) => this.expire(a, now));
  }
}
const globalStore = globalThis as typeof globalThis & {
  duoPracticeStores?: Map<string, AttemptStore>;
};
export function database(kind: "practice" | "sandbox" = "practice") {
  const isolated = kind === "sandbox" || sandboxMode();
  const filename = isolated ? sandboxFile() : practiceFile();
  if (
    filename !== ":memory:" &&
    !sandboxMode() &&
    path.resolve(sandboxFile()) === path.resolve(practiceFile())
  )
    throw new Error("Practice and sandbox must use separate database files.");
  const stores = (globalStore.duoPracticeStores ??= new Map<
    string,
    AttemptStore
  >());
  const key = (isolated ? "sandbox:" : "practice:") + filename;
  let db = stores.get(key);
  if (db && Object.getPrototypeOf(db) !== AttemptStore.prototype) {
    db.db.close();
    stores.delete(key);
    db = undefined;
  }
  if (!db) stores.set(key, (db = new AttemptStore(filename, isolated)));
  return db;
}
export function store(id?: string) {
  const primary = database();
  if (!id || primary.has(id) || sandboxMode()) return primary;
  const test = database("sandbox");
  return test.has(id) ? test : primary;
}
