import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Attempt } from "./types";
import type {
  CoachingMemory,
  MemoryScope,
  MemorySource,
  MemoryUse,
  SkillEvidence,
} from "./learner-memory-types";

const textValue = z.string().trim().min(1).max(1500);
export const preferenceInput = z
  .object({
    text: textValue,
    scope: z.enum(["all", "reflection", "coaching", "planning"]),
  })
  .strict();
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);
const seeds = [
  {
    id: "pref-conversation",
    text: "Keep coaching conversational and leave room for my follow-up questions.",
    quote:
      "I feel like coaching should be more of a conversation. That way we can ask follow up questions, and it can feel more open.",
  },
  {
    id: "pref-formatting",
    text: "Format coach questions clearly. Use short paragraphs and readable code formatting.",
    quote:
      "We should also improve the formatting of the questions asked by the coach. They can be hard to read.",
  },
  {
    id: "pref-moving-on",
    text: "Let me move on when there is enough evidence, and let me skip or end coaching manually.",
    quote:
      "When there is enough evidence to finish the session we should then let the user move on, with a way to allow them to skip the coaching session or move on manually.",
  },
];

// Small explicit taxonomy, with stable identities for additional observed topics.
// Labels are searchable too; unfamiliar topics are not forced into a broad mastery score.
export function skillIdentity(label: string) {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (/^(runtime complexity|time complexity|algorithm runtime)$/.test(key))
    return "complexity.time";
  if (/^(auxiliary space complexity|space complexity)$/.test(key))
    return "complexity.space";
  if (/^(java map insertion|map insertion|map put)$/.test(key))
    return "java.map.put";
  if (/^(descending comparator syntax|reverse order comparator)$/.test(key))
    return "java.comparator.reverse-order";
  return "topic." + hash(key);
}

export function learnerMessages(a: Attempt) {
  return new Map([
    ...(a.javaHelp ?? []).map((h) => [h.id, h.question] as const),
    ...(a.followup ? [["first-response", a.followup.answer] as const] : []),
    ...(a.reflection?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => [m.id, m.text] as const),
    ...(a.followup?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => [m.id, m.text] as const),
  ]);
}

export function evidenceFromAttempt(a: Attempt): SkillEvidence[] {
  if (!a.sealed || ["active", "paused"].includes(a.phase) || a.demonstration)
    return [];
  const records: SkillEvidence[] = [];
  const learners = learnerMessages(a);
  const validQuotes = (quotes: { messageId: string; quote: string }[] = []) =>
    quotes.filter(
      (q) => q.quote && learners.get(q.messageId)?.includes(q.quote),
    );
  const source = { attemptId: a.id, label: a.problem.title };
  const developmentRevision = a.evaluations.findLastIndex((e) => e.development);
  for (const [revision, evaluation] of a.evaluations.entries()) {
    for (const p of evaluation.development?.approaches ?? []) {
      if (!["confirmed", "corrected"].includes(p.intent.status)) continue;
      records.push({
        id: `${a.id}:development:${revision}:${p.id}`,
        skillId: skillIdentity("Implementation decisions"),
        skill: "Implementation decisions",
        kind: "assessment",
        observation: `${p.label}: ${p.intent.statement}`,
        outcome: p.intent.status,
        support:
          "Learner-reported intent, linked to implementation and reference questions. Not proof of correctness or mastery.",
        at: evaluation.createdAt,
        current: revision === developmentRevision,
        source: {
          ...source,
          evaluationRevision: revision,
          approachId: p.id,
          quotes: validQuotes(p.intent.evidence),
          events: p.focus ? [p.focus.startSeq, p.focus.endSeq] : [],
          policyVersion: evaluation.version,
          model: evaluation.model,
        },
      });
    }
    for (const r of evaluation.development?.revisits ?? []) {
      records.push({
        id: `${a.id}:revisit:${revision}:${r.id}`,
        skillId: skillIdentity(r.skill),
        skill: r.skill,
        kind: "assessment",
        observation: r.reason,
        outcome: r.status === "open" ? "revisit" : `revisit-${r.status}`,
        support: `Future ${r.kind} practice, separate from session completion and not automatically a learning deficit.`,
        at: evaluation.createdAt,
        current: revision === developmentRevision && r.status === "open",
        source: {
          ...source,
          evaluationRevision: revision,
          revisitId: r.id,
          approachId: r.approachId ?? undefined,
          events: r.evidence,
          quotes: validQuotes(r.learnerEvidence),
          policyVersion: evaluation.version,
          model: evaluation.model,
        },
      });
    }
    for (const [kind, findings] of [
      ["strength", evaluation.strengths],
      ["needs-practice", evaluation.gaps],
    ] as const) {
      for (const [index, f] of findings.entries())
        records.push({
          id: `${a.id}:evaluation:${revision}:${kind}:${index}`,
          skillId: skillIdentity(f.skill),
          skill: f.skill,
          kind: "assessment",
          observation: f.observation,
          outcome: kind,
          support:
            "Coach interpretation; inspect the linked learner evidence and assistance. Not a mastery claim.",
          at: evaluation.createdAt,
          current: revision === a.evaluations.length - 1,
          source: {
            ...source,
            evaluationRevision: revision,
            events: f.evidence,
            quotes: validQuotes(f.learnerEvidence),
            policyVersion: evaluation.version,
            model: evaluation.model,
          },
        });
    }
  }
  const reflected = (a.reflection?.messages ?? []).filter(
    (m) => m.role === "assistant" && m.checks,
  );
  for (const m of reflected)
    for (const [topic, check] of Object.entries(m.checks!)) {
      const skill =
        topic === "timeComplexity"
          ? "Time complexity"
          : topic === "spaceComplexity"
            ? "Auxiliary space complexity"
            : "Approach reasoning";
      records.push({
        id: `${a.id}:reflection:${m.id}:${topic}`,
        skillId: skillIdentity(skill),
        skill,
        kind: "assessment",
        observation: check.assessment ?? check.uncertainty ?? m.text,
        outcome: check.status,
        support:
          "Post-assessment reasoning. Explained/inferred describes this session; delayed recall is untested.",
        at: m.createdAt,
        current: m.id === reflected.at(-1)?.id,
        source: {
          ...source,
          messageId: m.id,
          quotes: validQuotes(check.evidence),
          events: check.recordingEvidence,
          evaluationRevision: m.evaluationRevision,
          approachId:
            a.evaluations[m.evaluationRevision ?? -1]?.development
              ?.baselineApproachId ?? undefined,
        },
      });
    }
  if (a.followup) {
    const exercise =
      a.evaluations[a.followup.evaluationRevision ?? a.evaluations.length - 1]
        ?.exercise;
    const skill = exercise?.skill ?? "Focused practice";
    records.push({
      id: `${a.id}:first-response:${a.followup.outcome ?? "unassessed"}`,
      skillId: skillIdentity(skill),
      skill,
      kind: "first-response",
      observation: a.followup.answer,
      outcome: a.followup.outcome ?? "unassessed",
      support:
        "Preserved first response; its original assessment may be disputed. Prior teaching and assistance still apply.",
      at: a.followup.answeredAt,
      current: true,
      source: {
        ...source,
        messageId: "first-response",
        quotes: [{ messageId: "first-response", quote: a.followup.answer }],
      },
    });
    const replies = (a.followup.messages ?? []).filter(
      (m) => m.role === "assistant" && m.understanding,
    );
    for (const m of replies)
      for (const [i, criterion] of m.understanding!.criteria.entries())
        records.push({
          id: `${a.id}:coaching:${m.id}:${i}`,
          skillId: skillIdentity(skill),
          skill,
          kind: "assessment",
          observation: `${criterion.concept}: ${m.understanding!.summary}`,
          outcome: criterion.status,
          support: `Session understanding: ${m.understanding!.support}. This does not establish lasting mastery.`,
          at: m.createdAt,
          current: m.id === replies.at(-1)?.id,
          source: {
            ...source,
            messageId: m.id,
            quotes: validQuotes(criterion.evidence),
          },
        });
  }
  if (a.evidenceEpoch)
    for (const record of records) record.id += ":epoch:" + a.evidenceEpoch;
  return records;
}

export class LearnerMemory {
  constructor(
    readonly db: DatabaseSync,
    readonly sandbox = false,
  ) {}
  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS coaching_memories(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS coaching_memory_revisions(id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS forgotten_memories(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS skill_evidence(id TEXT PRIMARY KEY, attempt_id TEXT, skill_id TEXT NOT NULL, current INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS evidence_attempt ON skill_evidence(attempt_id);
      CREATE INDEX IF NOT EXISTS evidence_skill ON skill_evidence(skill_id,current,at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS skill_evidence_search USING fts5(id UNINDEXED, skill, observation);
      CREATE TABLE IF NOT EXISTS evidence_corrections(id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS memory_uses(id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence_suppression(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS library_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    `);
    if (
      !this.sandbox &&
      !this.db
        .prepare("SELECT 1 FROM library_meta WHERE key='preferences_seeded'")
        .get()
    )
      for (const seed of seeds) {
        if (!this.get(seed.id) && !this.forgotten(seed.id))
          this.write({
            id: seed.id,
            revision: 1,
            text: seed.text,
            scope: "all",
            status: "active",
            origin: "project-preference",
            source: {
              label: "Your explicit instructions in the project conversation",
              quote: seed.quote,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
      }
    this.db
      .prepare(
        "INSERT OR IGNORE INTO library_meta VALUES('preferences_seeded','true')",
      )
      .run();
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("SAVEPOINT learner_memory");
    try {
      const result = fn();
      this.db.exec("RELEASE learner_memory");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK TO learner_memory; RELEASE learner_memory");
      throw e;
    }
  }
  private forgotten(id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM forgotten_memories WHERE id=?")
      .get(id);
  }
  get(id: string): CoachingMemory | undefined {
    const row = this.db
      .prepare("SELECT data FROM coaching_memories WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  list(): CoachingMemory[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM coaching_memories ORDER BY json_extract(data,'$.updatedAt') DESC,id",
        )
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  private write(memory: CoachingMemory) {
    this.atomic(() => {
      this.db
        .prepare(
          "INSERT INTO coaching_memories VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(memory.id, JSON.stringify(memory));
      this.db
        .prepare("INSERT INTO coaching_memory_revisions VALUES(?,?,?)")
        .run(memory.id, memory.revision, JSON.stringify(memory));
    });
    return memory;
  }
  add(input: unknown) {
    const p = preferenceInput.parse(input);
    if (this.list().filter((m) => m.status === "active").length >= 20)
      throw new Error(
        "Keep up to 20 active preferences. Edit or forget an existing preference first.",
      );
    return this.write({
      ...p,
      id: randomUUID(),
      revision: 1,
      status: "active",
      origin: "user",
      source: { label: "Added by you in Coach memory", quote: p.text },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  edit(id: string, revision: number, input: unknown) {
    const p = preferenceInput.parse(input);
    return this.atomic(() => {
      const before = this.expect(id, revision);
      if (
        before.status !== "active" &&
        this.list().filter((m) => m.status === "active").length >= 20
      )
        throw new Error(
          "Keep up to 20 active preferences. Edit or forget an existing preference first.",
        );
      return this.write({
        ...before,
        ...p,
        revision: before.revision + 1,
        status: "active",
        updatedAt: Date.now(),
      });
    });
  }
  private expect(id: string, revision: number) {
    const memory = this.get(id);
    if (!memory || memory.revision !== revision)
      throw new Error("This memory changed. Refresh it before saving.");
    return memory;
  }
  forget(id: string, revision: number) {
    this.atomic(() => {
      this.expect(id, revision);
      this.db.prepare("DELETE FROM coaching_memories WHERE id=?").run(id);
      this.db
        .prepare("DELETE FROM coaching_memory_revisions WHERE id=?")
        .run(id);
      this.db
        .prepare("INSERT OR IGNORE INTO forgotten_memories VALUES(?)")
        .run(id);
    });
  }
  revisions(id: string): CoachingMemory[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM coaching_memory_revisions WHERE id=? ORDER BY revision DESC",
        )
        .all(id) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  propose(a: Attempt, input: unknown) {
    if (
      !a.sealed ||
      ["active", "paused"].includes(a.phase) ||
      a.demonstration ||
      this.sandbox
    )
      throw new Error(
        "Memory suggestions are available only after real assessments.",
      );
    const p = preferenceInput
      .extend({ messageId: z.string(), quote: textValue })
      .parse(input);
    if (!learnerMessages(a).get(p.messageId)?.includes(p.quote))
      throw new Error("A suggestion must quote a saved learner message.");
    const id =
      "suggestion-" + hash(`${a.id}:${p.messageId}:${p.quote.toLowerCase()}`);
    if (this.forgotten(id)) return { status: "dismissed" };
    if (this.get(id)) return this.get(id)!;
    if (this.list().some((m) => m.text.toLowerCase() === p.text.toLowerCase()))
      return { status: "already-recorded" };
    if (this.list().filter((m) => m.status === "proposed").length >= 20)
      return { status: "suggestion-limit" };
    return this.write({
      id,
      revision: 1,
      text: p.text,
      scope: p.scope,
      status: "proposed",
      origin: "coach-suggestion",
      source: {
        label: a.problem.title,
        attemptId: a.id,
        messageId: p.messageId,
        quote: p.quote,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  profile(scope: MemoryScope) {
    return this.list()
      .filter(
        (m) =>
          m.status === "active" && (m.scope === "all" || m.scope === scope),
      )
      .map(({ id, revision, text, scope }) => ({ id, revision, text, scope }));
  }
  indexAttempt(a: Attempt) {
    if (this.sandbox || a.demonstration) return;
    this.atomic(() => {
      this.db
        .prepare("UPDATE skill_evidence SET current=0 WHERE attempt_id=?")
        .run(a.id);
      for (const evidence of evidenceFromAttempt(a)) this.index(evidence);
    });
  }
  indexImported(rows: any[]) {
    if (this.sandbox) return;
    this.atomic(() => {
      for (const row of rows)
        this.index({
          id: "imported:" + row.id,
          skillId: skillIdentity(row.skill ?? "Historical practice"),
          skill: row.skill ?? "Historical practice",
          kind: "imported-note",
          observation: row.observation ?? "",
          outcome: "historical-note",
          support: row.support ?? "Unknown assistance",
          at: Date.parse(row.date) || 0,
          current: true,
          source: {
            label: row.provenance ?? "Imported coaching notes",
            url: row.source,
          },
        });
    });
  }
  private index(e: SkillEvidence) {
    if (
      this.db.prepare("SELECT 1 FROM evidence_suppression WHERE id=?").get(e.id)
    )
      return;
    const existing = this.db
      .prepare("SELECT data FROM skill_evidence WHERE id=?")
      .get(e.id);
    if (existing) {
      this.db
        .prepare("UPDATE skill_evidence SET current=? WHERE id=?")
        .run(+e.current, e.id);
      return;
    }
    this.db
      .prepare("INSERT INTO skill_evidence VALUES(?,?,?,?,?,?)")
      .run(
        e.id,
        e.source.attemptId ?? null,
        e.skillId,
        +e.current,
        e.at,
        JSON.stringify(e),
      );
    this.db
      .prepare("INSERT INTO skill_evidence_search VALUES(?,?,?)")
      .run(e.id, `${e.skillId} ${e.skill}`, e.observation);
  }
  correctEvidence(
    id: string,
    revision: number,
    text: string,
    excluded = false,
  ) {
    text = textValue.parse(text);
    this.atomic(() => {
      if (!this.db.prepare("SELECT 1 FROM skill_evidence WHERE id=?").get(id))
        throw new Error("Evidence not found.");
      const latest =
        this.db
          .prepare(
            "SELECT MAX(revision) AS revision FROM evidence_corrections WHERE id=?",
          )
          .get(id)?.revision ?? 0;
      if (latest !== revision)
        throw new Error("This correction changed. Refresh before saving.");
      this.db.prepare("INSERT INTO evidence_corrections VALUES(?,?,?)").run(
        id,
        revision + 1,
        JSON.stringify({
          revision: revision + 1,
          text,
          excluded,
          at: Date.now(),
        }),
      );
      const original = JSON.parse(
        (
          this.db
            .prepare("SELECT data FROM skill_evidence WHERE id=?")
            .get(id) as { data: string }
        ).data,
      ) as SkillEvidence;
      this.db.prepare("DELETE FROM skill_evidence_search WHERE id=?").run(id);
      this.db
        .prepare("INSERT INTO skill_evidence_search VALUES(?,?,?)")
        .run(
          id,
          `${original.skillId} ${original.skill}`,
          `${original.observation}\nLearner correction: ${text}`,
        );
    });
  }
  search(
    input: {
      query?: string;
      skillId?: string;
      limit?: number;
      includeSuperseded?: boolean;
      includeExcluded?: boolean;
      excludeAttempt?: string;
      attemptId?: string;
      outcome?: string;
      currentOnly?: boolean;
    } = {},
  ): SkillEvidence[] {
    const tokens =
      (input.query ?? "").match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
    const filters = ["1=1"];
    const args: (string | number)[] = [];
    if (input.currentOnly) filters.push("e.current=1");
    else if (!input.includeSuperseded)
      filters.push("(e.current=1 OR c.data IS NOT NULL)");
    if (input.outcome) {
      filters.push("json_extract(e.data,'$.outcome')=?");
      args.push(input.outcome);
    }
    if (input.skillId) {
      filters.push("e.skill_id=?");
      args.push(input.skillId);
    }
    if (input.excludeAttempt) {
      filters.push("(e.attempt_id IS NULL OR e.attempt_id!=?)");
      args.push(input.excludeAttempt);
    }
    if (input.attemptId) {
      filters.push("e.attempt_id=?");
      args.push(input.attemptId);
    }
    if (tokens.length) {
      filters.push(
        "e.id IN (SELECT id FROM skill_evidence_search WHERE skill_evidence_search MATCH ?)",
      );
      args.push(tokens.map((t) => '"' + t + '"*').join(" OR "));
    }
    if (!input.includeExcluded)
      filters.push("COALESCE(json_extract(c.data,'$.excluded'),0)=0");
    args.push(Math.max(1, Math.min(200, input.limit ?? 20)));
    const rows = this.db
      .prepare(
        `SELECT e.data,e.current,c.data AS correction FROM skill_evidence e
      LEFT JOIN evidence_corrections c ON c.id=e.id AND c.revision=(SELECT MAX(revision) FROM evidence_corrections WHERE id=e.id)
      WHERE ${filters.join(" AND ")} ORDER BY e.at DESC,e.id LIMIT ?`,
      )
      .all(...args) as { data: string; current: number; correction?: string }[];
    return rows.map((row) => ({
      ...JSON.parse(row.data),
      current: !!row.current,
      ...(row.correction ? { correction: JSON.parse(row.correction) } : {}),
    }));
  }
  uses(): MemoryUse[] {
    return (
      this.db
        .prepare("SELECT data FROM memory_uses ORDER BY at DESC LIMIT 30")
        .all() as { data: string }[]
    ).map((r) => {
      const use = JSON.parse(r.data) as MemoryUse;
      use.preferences = use.preferences.map((p) => ({
        ...p,
        text: this.revisions(p.id).find((m) => m.revision === p.revision)?.text,
      }));
      return use;
    });
  }
  recordUse(use: Omit<MemoryUse, "id" | "at">) {
    const record = { ...use, id: randomUUID(), at: Date.now() };
    this.db
      .prepare("INSERT INTO memory_uses VALUES(?,?,?)")
      .run(record.id, record.at, JSON.stringify(record));
  }
  export() {
    const rows = (table: string) =>
      this.db.prepare(`SELECT * FROM ${table}`).all();
    return {
      version: 1,
      preferences: this.list(),
      preferenceRevisions: rows("coaching_memory_revisions"),
      forgotten: rows("forgotten_memories"),
      evidence: rows("skill_evidence"),
      corrections: rows("evidence_corrections"),
      uses: rows("memory_uses"),
      suppressed: rows("evidence_suppression"),
    };
  }
}
