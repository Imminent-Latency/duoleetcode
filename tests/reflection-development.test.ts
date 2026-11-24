import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { implementationEvidence } from "../lib/implementation-evidence";
import {
  validateReflection,
  reflectionOutputSchema,
  reflectionReady,
  type ReflectionResult,
} from "../lib/reflection";
import {
  reflectionFixture,
  developmentFixture,
} from "../tools/reflection-fixture";
import { evidenceFromAttempt } from "../lib/learner-memory";
import { AttemptStore } from "../lib/store";
import {
  continueReflection,
  prepareReflection,
} from "../lib/reflection-service";
import {
  captureSnapshot,
  parseSnapshot,
  replaceLibrary,
} from "../lib/snapshots";
import type { Attempt } from "../lib/types";

function response(): ReflectionResult {
  const check = {
    status: "open" as const,
    evidence: [],
    recordingEvidence: [],
    assessment: "Intent remains unknown.",
    uncertainty: "What was the goal?",
  };
  return {
    message: "What were you aiming to improve?",
    askedQuestionIds: [],
    surfacedQuestionIds: [],
    coachingSelectionNote: "Explore the approach pivot first.",
    status: "exploring",
    focus: null,
    checks: {
      approach: { ...check },
      timeComplexity: { ...check },
      spaceComplexity: { ...check },
    },
    evaluation: {
      summary: "Approach changed; intention needs context.",
      strengths: [],
      gaps: [],
      moments: [],
      development: developmentFixture(),
      exercise: {
        skill: "Transfer",
        title: "Transfer",
        prompt: "Explain.",
        rubric: "Sound explanation.",
      },
    },
  };
}
const quote = {
  messageId: "learner",
  quote: "I was preserving the day while ordering by price.",
};
function withLearner() {
  const a = reflectionFixture();
  a.version++;
  for (const e of a.events) if (e.version) e.version++;
  for (const j of a.jobs) {
    const old = j.id;
    j.id = crypto.randomUUID();
    for (const e of a.events) if (e.jobId === old) e.jobId = j.id;
  }
  a.reflection = {
    messages: [
      {
        id: quote.messageId,
        role: "user",
        text: quote.quote,
        createdAt: a.endedAt! + 1,
      },
    ],
  };
  return a;
}
function revisit(r: ReflectionResult) {
  r.evaluation.development!.revisits.push({
    id: "independent-implementation",
    approachId: "solution",
    skill: "Independent implementation",
    kind: "implementation",
    status: "open",
    reason: "Implement the explained repair independently in a later attempt.",
    evidence: [4],
    learnerEvidence: [],
  });
}
function ready(r: ReflectionResult) {
  r.status = "ready";
  for (const c of Object.values(r.checks))
    Object.assign(c, {
      status: "explained",
      uncertainty: null,
      evidence: [quote],
    });
}

test("learner reasoning inside Java questions is usable evidence; delivered assistant prose is not", () => {
  const a = withLearner(),
    r = response();
  a.demonstration = false;
  a.javaHelp = [
    {
      id: "lookup",
      question:
        "I want to preserve the original day while ordering by price. How do I declare a record?",
      answer: "The comparator orders by price.",
    },
  ] as any;
  const cited = {
    messageId: "lookup",
    quote: "I want to preserve the original day while ordering by price.",
  };
  r.evaluation.development!.approaches[0].intent = {
    status: "confirmed",
    statement: "Preserve days while ordering prices.",
    evidence: [cited],
  };
  assert.doesNotThrow(() => validateReflection(a, r));
  a.evaluations = [
    {
      ...r.evaluation,
      version: "test",
      createdAt: 1,
      evidenceThrough: a.lastSeq,
    },
  ];
  assert.ok(
    evidenceFromAttempt(a).some((e) => e.outcome === "confirmed" && e.current),
  );
  cited.quote = "The comparator orders by price.";
  assert.throws(() => validateReflection(a, r), /missing learner evidence/);
});

function saveRecording(db: AttemptStore, a: Attempt) {
  db.save(a);
  for (const e of a.events)
    db.db
      .prepare("INSERT INTO events VALUES(?,?,?)")
      .run(a.id, e.seq, JSON.stringify(e));
  for (const c of a.checkpoints)
    db.db
      .prepare("INSERT INTO checkpoints VALUES(?,?,?)")
      .run(a.id, c.seq, c.source);
}

test("real stock excerpt links timestamped reference questions to the later sorting deletion without asserting intent", () => {
  const a = JSON.parse(
    readFileSync(
      new URL("./fixtures/stock-development.json", import.meta.url),
      "utf8",
    ),
  ) as Attempt;
  const evidence = implementationEvidence(a);
  assert.equal(evidence.assistanceLinks[0].requestSeq, 274);
  assert.equal(evidence.assistanceLinks[0].nearbyChangeSeq, 364);
  assert.equal(
    Math.floor(evidence.assistanceLinks[0].askedElapsedMs / 1000),
    522,
  );
  const change = evidence.checkpoints.find((c) => c.seq === 364)!;
  assert.match(change.before, /Arrays.sort\(prices\)/);
  assert.doesNotMatch(change.after, /Arrays.sort\(prices\)/);
  assert.equal(change.truncated, false);
  assert.match(evidence.meaning, /not intent/);
  a.javaHelp![0].deliveredAt = undefined;
  assert.equal(implementationEvidence(a).assistanceLinks[0].responseSeq, null);
});

test("development requires real references and learner evidence for confirmed intent", () => {
  const a = withLearner(),
    r = response(),
    p = r.evaluation.development!.approaches[0];
  assert.equal(reflectionOutputSchema.safeParse(r).success, true);
  p.intent = {
    status: "confirmed",
    statement: "Preserve day information.",
    evidence: [],
  };
  assert.throws(
    () => validateReflection(a, r),
    /intent needs learner evidence/,
  );
  p.intent.evidence = [quote];
  assert.doesNotThrow(() => validateReflection(a, r));
  r.evaluation.development!.optimization = {
    status: "demonstrated",
    approachId: "solution",
  };
  assert.throws(
    () => validateReflection(a, r),
    /demonstrated optimization needs learner evidence/,
  );
  p.learnerEvidence = [quote];
  assert.doesNotThrow(() => validateReflection(a, r));
  r.evaluation.development!.optimization = {
    status: "not-discussed",
    approachId: null,
  };
  p.learnerEvidence = [];
  p.assistanceIds = ["invented"];
  assert.throws(() => validateReflection(a, r), /unknown Java help/);
  p.assistanceIds = [];
  p.origin = "learner-proposed";
  assert.throws(() => validateReflection(a, r), /learner.s description/);
  p.learnerEvidence = [quote];
  p.focus = null;
  assert.doesNotThrow(() => validateReflection(a, r));
  p.intent.evidence = [{ ...quote, quote: "Invented intention" }];
  assert.throws(() => validateReflection(a, r), /missing learner evidence/);
});

test("optional optimization preserves a ready baseline; a new contradictory baseline quote may reopen it", () => {
  const a = withLearner(),
    r = response();
  ready(r);
  revisit(r);
  a.evaluations = [
    {
      ...r.evaluation,
      version: "test",
      createdAt: 10,
      evidenceThrough: a.lastSeq,
    },
  ];
  a.reflection!.messages.push({
    id: "baseline-reply",
    role: "assistant",
    text: "Baseline established.",
    createdAt: 11,
    status: "ready",
    checks: r.checks,
    evaluationRevision: 0,
  });
  a.reflection!.messages.push({
    id: "new-question",
    role: "user",
    text: "Would the new approach restart its comparisons?",
    createdAt: 12,
  });
  r.evaluation.development!.approaches.push({
    id: "one-pass",
    label: "Chronological scan",
    origin: "coach-introduced",
    observation: "A different, taught approach.",
    focus: null,
    assistanceIds: [],
    learnerEvidence: [],
    intent: {
      status: "unknown",
      statement: "Learner understanding remains open.",
      evidence: [],
    },
  });
  r.evaluation.development!.activeApproachId = "one-pass";
  r.evaluation.development!.optimization = {
    status: "exploring",
    approachId: "one-pass",
  };
  assert.doesNotThrow(() => validateReflection(a, r));
  assert.equal(reflectionReady(a), false); // pending learner question remains pending until answered
  r.status = "exploring";
  r.checks.timeComplexity = {
    status: "open",
    evidence: [],
    recordingEvidence: [],
    assessment: "New concept unclear.",
    uncertainty: "Does the scan restart?",
  };
  assert.throws(
    () => validateReflection(a, r),
    /Keep the established baseline/,
  );
  r.evaluation.development!.baselineCorrection = [quote];
  assert.throws(
    () => validateReflection(a, r),
    /new contradictory learner evidence/,
  );
  // Host validates a new citation; the evidence auditor must additionally judge its meaning.
  r.evaluation.development!.baselineCorrection = [
    {
      messageId: "new-question",
      quote: "Would the new approach restart its comparisons?",
    },
  ];
  assert.doesNotThrow(() => validateReflection(a, r));
});

test("outstanding revisit targets cannot silently disappear and resolving one needs learner evidence", () => {
  const a = withLearner(),
    r = response();
  revisit(r);
  a.evaluations = [
    {
      ...structuredClone(r.evaluation),
      version: "test",
      createdAt: 1,
      evidenceThrough: 6,
    },
  ];
  r.evaluation.development!.revisits = [];
  assert.throws(() => validateReflection(a, r), /Preserve outstanding/);
  revisit(r);
  r.evaluation.development!.revisits[0].status = "resolved";
  assert.throws(() => validateReflection(a, r), /requires learner evidence/);
  r.evaluation.development!.revisits[0].learnerEvidence = [quote];
  assert.doesNotThrow(() => validateReflection(a, r));
});

test("offering optimization requires an explicit future target while remaining ready", () => {
  const a = withLearner(),
    r = response();
  ready(r);
  r.evaluation.development!.optimization.status = "offered";
  assert.throws(() => validateReflection(a, r), /saved future revisit/);
  revisit(r);
  r.evaluation.development!.revisits[0].kind = "optimization";
  assert.doesNotThrow(() => validateReflection(a, r));
});

test("current corrections and open revisits are searchable separately from historical interpretations and survive snapshots", () => {
  const a = withLearner(),
    r = response();
  a.demonstration = false;
  revisit(r);
  r.evaluation.development!.approaches[0].intent = {
    status: "confirmed",
    statement: "Preserve dates.",
    evidence: [quote],
  };
  a.evaluations = [
    {
      ...structuredClone(r.evaluation),
      version: "v9",
      createdAt: 1,
      evidenceThrough: 6,
    },
  ];
  r.evaluation.development!.approaches[0].intent = {
    status: "corrected",
    statement: "Correction: preserve day information.",
    evidence: [quote],
  };
  a.evaluations.push({
    ...r.evaluation,
    version: "v9",
    createdAt: 2,
    evidenceThrough: 6,
  });
  const records = evidenceFromAttempt(a);
  assert.equal(
    records.filter((e) => e.outcome === "confirmed" && e.current).length,
    0,
  );
  assert.equal(
    records.filter((e) => e.outcome === "corrected" && e.current).length,
    1,
  );
  assert.equal(
    records.filter((e) => e.outcome === "revisit" && e.current).length,
    1,
  );
  assert.equal(
    records.some((e) => e.outcome === "needs-practice"),
    false,
  );
  const db = new AttemptStore(":memory:"),
    sandbox = new AttemptStore(":memory:", true),
    restored = new AttemptStore(":memory:");
  try {
    saveRecording(db, a);
    assert.equal(
      db.memory
        .search({ attemptId: a.id })
        .filter((e) => e.outcome === "revisit").length,
      1,
    );
    const snap = parseSnapshot(
      captureSnapshot(
        db,
        sandbox,
        { settings: null, browser: {}, pagesPreview: null },
        "Development fixture",
      ),
    );
    replaceLibrary(restored, snap.practice);
    assert.deepEqual(restored.get(a.id).evaluations, a.evaluations);
    assert.equal(
      restored.memory
        .search({ attemptId: a.id })
        .filter((e) => e.outcome === "revisit").length,
      1,
    );
    const updated = restored.get(a.id);
    const next = structuredClone(updated.evaluations.at(-1)!);
    next.createdAt = 3;
    next.development!.revisits[0].status = "dismissed";
    next.development!.revisits[0].learnerEvidence = [quote];
    updated.evaluations.push(next);
    restored.save(updated);
    assert.equal(
      restored.memory
        .search({ attemptId: a.id })
        .filter((e) => e.outcome === "revisit").length,
      0,
    );
    assert.ok(
      restored.memory
        .search({ attemptId: a.id, includeSuperseded: true })
        .some((e) => e.outcome === "revisit-dismissed"),
    );
  } finally {
    db.db.close();
    sandbox.db.close();
    restored.db.close();
  }
});

test("private preparation and subsequent replies retain development with immutable earlier revisions", async () => {
  const a = withLearner();
  a.reflection = { messages: [] };
  const db = new AttemptStore(":memory:", true);
  saveRecording(db, a);
  const r = response();
  revisit(r);
  try {
    await prepareReflection(db, a.id, async () => ({
      result: r,
      model: "fixture",
    }));
    assert.equal(
      db.get(a.id).reflection?.analysis?.development?.revisits.length,
      1,
    );
    await continueReflection(db, a.id, async () => ({
      result: r,
      model: "fixture",
    }));
    const before = structuredClone(db.get(a.id).evaluations[0]);
    const updated = structuredClone(r);
    updated.evaluation.development!.approaches[0].intent = {
      status: "corrected",
      statement: "Preserve day information.",
      evidence: [quote],
    };
    await continueReflection(
      db,
      a.id,
      async () => ({ result: updated, model: "fixture" }),
      { id: quote.messageId, text: quote.quote },
    );
    assert.deepEqual(db.get(a.id).evaluations[0], before);
    assert.equal(
      db.get(a.id).evaluations[1].development?.approaches[0].intent.status,
      "corrected",
    );
  } finally {
    db.db.close();
  }
});

test("moving on from an optimization offer saves deferral without rewriting the coach evaluation", async () => {
  const { closeLearning } = await import("../lib/coaching");
  const a = withLearner(),
    r = response();
  ready(r);
  revisit(r);
  r.evaluation.development!.optimization.status = "offered";
  r.evaluation.development!.revisits[0].kind = "optimization";
  a.evaluations = [
    { ...r.evaluation, version: "test", createdAt: 1, evidenceThrough: 6 },
  ];
  a.reflection!.messages.push({
    id: "reply",
    role: "assistant",
    text: "Optional exploration.",
    createdAt: 2,
    status: "ready",
    checks: r.checks,
    evaluationRevision: 0,
  });
  const before = structuredClone(a.evaluations);
  closeLearning(a, "sufficient", 50);
  assert.equal(a.reflection?.optimizationDeferredAt, 50);
  assert.equal(a.phase, "complete");
  assert.deepEqual(a.evaluations, before);
  closeLearning(a, "sufficient", 100);
  assert.equal(a.reflection?.optimizationDeferredAt, 50);
});
