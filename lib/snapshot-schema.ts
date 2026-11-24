import { z } from "zod";
import { agentSettingsSchema } from "./agent-settings";
import { eventSchema, jobSchema, problemSchema } from "./validation";
import { applyEdits } from "./recording";
import { coachingResultSchema } from "./coaching";
import { replayFocusSchema } from "./reflection";
import { editorContextSchema } from "./editor-context";
import type { SnapshotData } from "./snapshot-types";
import { isBrowserDataKey } from "./snapshot-types";
import { prescriptionSchema } from "./prescription-types";
import { reflectionDevelopmentSchema } from "./reflection-development";
import { questionReviewSchema } from "./question-review";
import { solvingChunkNoteSchema } from "./solving-chunks";

const id = z.string().min(1).max(500);
const text = z.string().max(2_000_000);
const number = z.number().finite();
const seq = number.int().nonnegative();
const quote = z.object({ messageId: id, quote: text });
const findings = z.array(
  z
    .object({
      skill: text,
      observation: text,
      evidence: z.array(seq),
      learnerEvidence: z.array(quote).optional(),
    })
    .passthrough(),
);
const evaluation = z
  .object({
    development: reflectionDevelopmentSchema.optional(),
    questionReview: questionReviewSchema.optional(),
    summary: text,
    strengths: findings,
    gaps: findings,
    moments: z.array(
      z
        .object({
          seq,
          label: text,
          observation: text,
          interpretation: text,
          question: text,
        })
        .passthrough(),
    ),
    exercise: z
      .object({ skill: text, title: text, prompt: text })
      .passthrough(),
    createdAt: number,
    version: text,
    evidenceThrough: seq,
  })
  .passthrough();
const message = z
  .object({ id, role: z.enum(["user", "assistant"]), text, createdAt: number })
  .passthrough();
const exit = z.object({
  reason: z.enum(["sufficient", "skipped", "manual"]),
  at: number,
});
const attempt = z
  .object({
    id: z.string().uuid(),
    problem: problemSchema,
    createdAt: number,
    budgetMs: number.nonnegative(),
    deadline: number,
    phase: z.enum(["active", "paused", "review", "learn", "complete"]),
    initialSource: text,
    source: text,
    version: seq.positive(),
    lastSeq: seq,
    pauses: z.array(
      z.object({
        start: number,
        end: number.optional(),
        reason: z.enum(["manual", "window-blur", "tab-hidden"]).optional(),
      }),
    ),
    endedAt: number.optional(),
    sealed: z.boolean().optional(),
    exposure: z.enum(["new", "revisit", "solved", "unknown"]),
    events: z.array(eventSchema).max(1_000_000),
    checkpoints: z.array(z.object({ seq, source: text })),
    jobs: z.array(jobSchema),
    evaluations: z.array(evaluation),
    annotations: z.array(
      z
        .object({
          id,
          seq,
          judgement: z.enum(["agree", "correct", "unsure"]),
          comment: text,
          createdAt: number,
          interpretationVisible: z.boolean(),
        })
        .passthrough(),
    ),
    demonstration: z.boolean().optional(),
    evidenceEpoch: id.optional(),
    reflection: z
      .object({
        messages: z.array(message),
        intake: z
          .object({
            id,
            familiarity: z.enum(["new", "revisit", "solved"]),
            spaceComplexity: text,
            timeComplexity: text,
            submittedAt: number,
          })
          .optional(),
        analysis: evaluation.optional(),
        questionReview: questionReviewSchema.optional(),
        preparedReviewAt: number.optional(),
        analysisReady: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    solvingChunks: z.array(solvingChunkNoteSchema).max(16).optional(),
    followup: z
      .object({
        answer: text,
        answeredAt: number,
        messages: z.array(message).optional(),
        feedback: text.optional(),
        outcome: z
          .enum(["independent", "partial", "needs-practice", "unassessed"])
          .optional(),
        next: z
          .object({ title: text, slug: text, reason: text, revisitAt: number })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    javaHelp: z
      .array(
        z
          .object({
            id,
            question: text,
            requestSeq: seq,
            askedAt: number,
            state: z.enum(["pending", "ready", "failed"]),
            answer: text.optional(),
          })
          .passthrough(),
      )
      .optional(),
    learningExit: exit.optional(),
    previousLearningExits: z.array(exit).optional(),
    workSegments: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              id,
              kind: z.literal("assessment"),
              startedAt: number,
              endedAt: number.nullable(),
            })
            .passthrough(),
          z
            .object({
              id,
              kind: z.literal("continuation"),
              date: text,
              recordedAt: number,
              minutes: number.optional(),
              note: text.optional(),
            })
            .passthrough(),
        ]),
      )
      .optional(),
  })
  .passthrough();
const preference = z.object({
  id,
  revision: seq.positive(),
  text: z.string().max(1500),
  scope: z.enum(["all", "reflection", "coaching", "planning"]),
  status: z.enum(["active", "proposed"]),
  origin: z.enum(["user", "project-preference", "coach-suggestion"]),
  source: z.object({
    label: text,
    quote: text,
    attemptId: id.optional(),
    messageId: id.optional(),
    url: z.string().url().optional(),
  }),
  createdAt: number,
  updatedAt: number,
});
const revisionRow = z.object({ id, revision: seq, data: text });
const memory = z.object({
  version: z.literal(1),
  preferences: z.array(preference),
  preferenceRevisions: z.array(revisionRow),
  forgotten: z.array(z.object({ id })),
  evidence: z.array(
    z.object({
      id,
      attempt_id: id.nullable(),
      skill_id: id,
      current: z.union([z.literal(0), z.literal(1)]),
      at: number,
      data: text,
    }),
  ),
  corrections: z.array(revisionRow),
  uses: z.array(z.object({ id, at: number, data: text })),
  suppressed: z.array(z.object({ id })).default([]),
});
const library = z.object({
  attempts: z.array(attempt).max(10000),
  importedEvidence: z.array(
    z
      .object({
        id,
        skill: text,
        observation: text,
        support: text.optional(),
        source: z.string().url().optional(),
      })
      .passthrough(),
  ),
  memory,
});
const browser = z.record(
  z.string().refine(isBrowserDataKey, "Unrecognized browser preference"),
  z.string().max(50000),
);
export const snapshotSchema = z
  .object({
    format: z.literal("duoleetcode-snapshot"),
    version: z.literal(1),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    createdAt: z.string().datetime(),
    practice: library,
    sandbox: library,
    settings: agentSettingsSchema.nullable(),
    browser,
    pagesPreview: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
const selection = z
  .object({
    attempts: z.array(id),
    coaching: z.boolean(),
    preferences: z.boolean(),
    evidence: z.array(id),
    imported: z.array(id),
    receipts: z.boolean(),
  })
  .strict();
export const operationSchema = z
  .object({
    action: z.enum(["restore", "reset"]),
    selection: z
      .object({
        practice: selection,
        sandbox: selection,
        settings: z.boolean(),
        browser: z.boolean(),
        pagesPreview: z.boolean(),
      })
      .strict(),
    attemptMode: z.enum(["whole", "coaching"]),
    conflicts: z.enum(["keep", "replace"]),
  })
  .strict();
export const browserDataSchema = browser;

export function validateSnapshot(raw: unknown): SnapshotData {
  // Parse for validation while retaining optional fields from the app's evolving records.
  snapshotSchema.parse(raw);
  const s = structuredClone(raw) as SnapshotData;
  const checkSchema = z.object({
    status: z.enum(["open", "explained", "inferred", "needs-practice"]),
    evidence: z.array(quote),
    recordingEvidence: z.array(seq).optional(),
    assessment: text.optional(),
    uncertainty: text.nullable().optional(),
  });
  const researchSchema = z.object({
    traceId: z.string().uuid().optional(),
    sources: z.array(
      z.object({
        id,
        title: text,
        url: text,
        kind: z.enum(["official-docs", "official-source", "secondary"]),
        version: text,
        retrievedAt: number,
        excerpt: text,
        digest: text,
      }),
    ),
    claims: z.array(
      z.object({
        claim: text,
        basis: z.enum(["documented", "implementation-derived", "unverified"]),
        sourceIds: z.array(id),
        use: z.enum(["explanation", "assessment"]),
      }),
    ),
    symbols: z.array(z.unknown()),
    lookups: z.array(
      z.object({
        tool: text,
        target: text,
        ok: z.boolean(),
        reason: text.optional(),
      }),
    ),
    runtime: z.object({ editorJava: number, executionJava: number.nullable() }),
  });
  const validateResearch = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) validateResearch(item);
    } else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        if (key === "research" && item !== undefined)
          researchSchema.parse(item);
        else validateResearch(item);
      }
  };
  const unique = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length)
      throw new Error(`Duplicate ${what} in snapshot.`);
  };
  unique(
    [...s.practice.attempts, ...s.sandbox.attempts].map((a) => a.id),
    "attempt IDs",
  );
  for (const [kind, l] of [
    ["practice", s.practice],
    ["sandbox", s.sandbox],
  ] as const) {
    l.memory.suppressed ??= [];
    for (const a of l.attempts) {
      validateResearch(a);
      for (const m of [
        ...(a.reflection?.messages ?? []),
        ...(a.followup?.messages ?? []),
      ]) {
        const message = m as any;
        if (message.understanding)
          coachingResultSchema.shape.understanding.parse(message.understanding);
        if (message.checks)
          z.object({
            approach: checkSchema,
            timeComplexity: checkSchema,
            spaceComplexity: checkSchema,
          }).parse(message.checks);
        if (message.focus) {
          const f = replayFocusSchema.parse(message.focus);
          if (
            f.endSeq > a.lastSeq ||
            f.startSeq > f.endSeq ||
            (f.pauseSeq != null &&
              (f.pauseSeq < f.startSeq || f.pauseSeq > f.endSeq))
          )
            throw new Error("Replay focus is outside the recording.");
        }
        if (message.editor) editorContextSchema.parse(message.editor);
      }
      if (!!a.demonstration !== (kind === "sandbox"))
        throw new Error("Practice and test sessions must remain separate.");
      if (a.lastSeq !== a.events.length)
        throw new Error("Incomplete recording in snapshot.");
      let source = a.initialSource,
        version = 1,
        at = a.createdAt;
      const checkpoints = new Map(a.checkpoints.map((c) => [c.seq, c.source]));
      unique(
        a.checkpoints.map((c) => String(c.seq)),
        "checkpoints",
      );
      if (checkpoints.has(0) && checkpoints.get(0) !== source)
        throw new Error("Invalid initial checkpoint.");
      for (let i = 0; i < a.events.length; i++) {
        const e = a.events[i];
        if (e.seq !== i + 1 || e.at < at)
          throw new Error("Invalid recording order.");
        at = e.at;
        if (e.type === "edit") {
          if (e.version !== ++version)
            throw new Error("Invalid recording version.");
          source = applyEdits(source, e.edits ?? []);
        }
        if (checkpoints.has(e.seq) && checkpoints.get(e.seq) !== source)
          throw new Error("Checkpoint does not match recorded edits.");
      }
      if (
        source !== a.source ||
        a.version !== version ||
        a.checkpoints.some((c) => c.seq > a.lastSeq)
      )
        throw new Error("Solution does not match its recording.");
      unique(
        a.jobs.map((j) => j.id),
        "judge jobs",
      );
    }
    unique(
      l.importedEvidence.map((x) => x.id),
      "imported notes",
    );
    const m = l.memory;
    unique(
      m.preferences.map((x) => x.id),
      "preferences",
    );
    unique(
      m.evidence.map((x) => x.id),
      "evidence",
    );
    unique(
      m.preferenceRevisions.map((x) => x.id + ":" + x.revision),
      "preference revisions",
    );
    unique(
      m.corrections.map((x) => x.id + ":" + x.revision),
      "corrections",
    );
    unique(
      m.uses.map((x) => x.id),
      "usage receipts",
    );
    for (const row of m.preferenceRevisions) {
      const p = preference.parse(JSON.parse(row.data));
      if (p.id !== row.id || p.revision !== row.revision)
        throw new Error("Preference revision mismatch.");
    }
    for (const p of m.preferences)
      if (
        !m.preferenceRevisions.some(
          (r) =>
            r.id === p.id &&
            r.revision === p.revision &&
            JSON.stringify(JSON.parse(r.data)) === JSON.stringify(p),
        )
      )
        throw new Error("Missing preference revision.");
    for (const row of m.evidence) {
      const e = z
        .object({
          id,
          skillId: id,
          skill: text,
          kind: z.enum(["assessment", "first-response", "imported-note"]),
          observation: text,
          support: text,
          outcome: text,
          at: number,
          current: z.boolean(),
          source: z
            .object({
              label: text,
              attemptId: id.optional(),
              quotes: z.array(quote).optional(),
              events: z.array(seq).optional(),
              url: z.string().url().optional(),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(JSON.parse(row.data));
      if (
        e.id !== row.id ||
        e.skillId !== row.skill_id ||
        (e.source.attemptId ?? null) !== row.attempt_id
      )
        throw new Error("Evidence identity mismatch.");
    }
    for (const row of m.corrections) {
      const c = z
        .object({
          revision: seq,
          text: text,
          excluded: z.boolean(),
          at: number,
        })
        .parse(JSON.parse(row.data));
      if (
        c.revision !== row.revision ||
        !m.evidence.some((e) => e.id === row.id)
      )
        throw new Error("Correction has no matching evidence.");
    }
    for (const row of m.uses) {
      const u = z
        .object({
          id,
          at: number,
          role: text,
          attemptId: id.optional(),
          prescription: prescriptionSchema.optional(),
          preferences: z.array(z.object({ id, revision: seq })),
          evidenceIds: z.array(id),
        })
        .parse(JSON.parse(row.data));
      if (u.id !== row.id || u.at !== row.at)
        throw new Error("Usage receipt mismatch.");
    }
    if (
      kind === "sandbox" &&
      (m.preferences.length || m.evidence.length || l.importedEvidence.length)
    )
      throw new Error(
        "Test snapshots cannot contain personal memory or imported practice evidence.",
      );
  }
  return s;
}
