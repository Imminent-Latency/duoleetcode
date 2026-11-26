import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AttemptStore } from "../lib/store";
import {
  continueReflection,
  prepareReflection,
  saveReflectionIntake,
} from "../lib/reflection-service";
import {
  playbackPosition,
  validateReflection,
  reflectionReady,
  validateReplayFocus,
  replayPauseSequence,
  coachReplayState,
  reflectionOutputSchema,
  reflectionResultSchema,
  type ReflectionResult,
} from "../lib/reflection";
import {
  reflectionFixture,
  developmentFixture,
} from "../tools/reflection-fixture";
import { replay } from "../lib/recording";
function fixture() {
  const source = reflectionFixture(),
    db = new AttemptStore(":memory:");
  const a = db.create(source.problem, 120000, true);
  db.append(
    a.id,
    source.events.map((e) => ({
      ...e,
      at: a.createdAt + e.seq * 100,
      version: e.version ? e.version + 1 : undefined,
    })),
  );
  db.transition(a.id, "finish");
  return { db, id: a.id };
}
function result(): { result: ReflectionResult; model: string } {
  return {
    model: "fixture",
    result: {
      message: "What prompted the change?",
      askedQuestionIds: [],
      surfacedQuestionIds: [],
      coachingSelectionNote: "Open with the strategy change before complexity.",
      status: "exploring",
      focus: {
        startSeq: 2,
        endSeq: 4,
        mode: "loop",
        label: "Changing approaches",
      },
      checks: {
        approach: {
          status: "open",
          evidence: [],
          recordingEvidence: [],
          assessment: "Learner explanation not yet available.",
          uncertainty: "No learner explanation for this topic yet.",
        },
        timeComplexity: {
          status: "open",
          evidence: [],
          recordingEvidence: [],
          assessment: "Learner explanation not yet available.",
          uncertainty: "No learner explanation for this topic yet.",
        },
        spaceComplexity: {
          status: "open",
          evidence: [],
          recordingEvidence: [],
          assessment: "Learner explanation not yet available.",
          uncertainty: "No learner explanation for this topic yet.",
        },
      },
      evaluation: {
        development: developmentFixture(),
        summary: "Two approaches are recorded; intent is not established.",
        strengths: [
          {
            skill: "Implementation",
            observation: "Two approaches implemented.",
            evidence: [2, 4],
            learnerEvidence: [],
          },
        ],
        gaps: [],
        moments: [
          {
            seq: 2,
            endSeq: 4,
            label: "Approach change",
            observation: "Sorting replaced with a set.",
            interpretation: "May avoid sorting.",
            question: "Was that the intention?",
            confidence: "low",
          },
        ],
        exercise: {
          skill: "Transfer",
          title: "Optional transfer",
          prompt: "Explain a trade-off.",
          rubric: "Accept equivalent reasoning.",
        },
      },
    },
  };
}
test("reflection starts before answers, preserves source and revisions, and deduplicates opening/replies", async () => {
  const { db, id } = fixture();
  const before = db.get(id);
  let calls = 0;
  const run = async () => {
    calls++;
    return result();
  };
  await continueReflection(db, id, run);
  await continueReflection(db, id, run);
  assert.equal(calls, 1);
  const message = {
    id: crypto.randomUUID(),
    text: "Avoid mutating the input.",
  };
  await continueReflection(db, id, run, message);
  await continueReflection(db, id, run, message);
  const saved = db.get(id);
  assert.equal(calls, 2);
  assert.equal(saved.evaluations.length, 2);
  assert.equal(saved.reflection?.messages.length, 3);
  assert.equal(saved.source, before.source);
  assert.deepEqual(saved.events, before.events);
  assert.equal(saved.followup, undefined);
  await assert.rejects(
    continueReflection(db, id, run, { ...message, text: "replacement" }),
    /cannot be replaced/,
  );
  db.db.close();
});
test("failed reflection preserves a pending message for retry after reload", async () => {
  const { db, id } = fixture(),
    message = { id: crypto.randomUUID(), text: "Why did you infer that?" };
  await assert.rejects(
    continueReflection(
      db,
      id,
      async () => {
        throw new Error("offline");
      },
      message,
    ),
    /offline/,
  );
  assert.equal(db.get(id).reflection?.messages[0].text, message.text);
  await assert.rejects(
    continueReflection(db, id, async () => result(), {
      id: crypto.randomUUID(),
      text: "new",
    }),
    /pending/,
  );
  await continueReflection(db, id, async () => result());
  assert.equal(db.get(id).reflection?.messages.at(-1)?.replyTo, message.id);
  db.db.close();
});
test("reflection validates replay bounds, learner quotes, and complexity evidence before readiness", () => {
  const a = reflectionFixture();
  const r = result().result;
  assert.doesNotThrow(() => validateReflection(a, r));
  assert.throws(
    () => validateReflection(a, { ...r, focus: { ...r.focus!, endSeq: 999 } }),
    /range/,
  );
  assert.throws(
    () =>
      validateReflection(a, { ...r, focus: { ...r.focus!, pauseSeq: 999 } }),
    /pause point/,
  );
  assert.throws(
    () => validateReflection(a, { ...r, focus: { ...r.focus!, pauseSeq: 1 } }),
    /pause point/,
  );
  assert.throws(
    () => validateReflection(a, { ...r, status: "ready" }),
    /unanswered/,
  );
  const claimed = structuredClone(r);
  claimed.checks.timeComplexity = {
    status: "explained",
    recordingEvidence: [],
    assessment: "Direct explanation.",
    uncertainty: null,
    evidence: [{ messageId: "coach", quote: "O(n)" }],
  };
  a.reflection = {
    messages: [{ id: "coach", role: "assistant", text: "O(n)", createdAt: 0 }],
  };
  assert.throws(() => validateReflection(a, claimed), /missing learner/);
  a.reflection.messages.push({
    id: "learner",
    role: "user",
    text: "O(n), each element once; O(n) space for distinct values.",
    createdAt: 1,
  });
  for (const key of ["approach", "timeComplexity", "spaceComplexity"] as const)
    claimed.checks[key] = {
      status: "explained",
      recordingEvidence: [],
      assessment: "Direct explanation.",
      uncertainty: null,
      evidence: [{ messageId: "learner", quote: "O(n)" }],
    };
  claimed.status = "ready";
  assert.doesNotThrow(() => validateReflection(a, claimed));
  claimed.checks.spaceComplexity.status = "needs-practice";
  claimed.checks.spaceComplexity.uncertainty = "A misconception remains.";
  assert.throws(() => validateReflection(a, claimed), /unanswered/);
});
test("manual exit and reopen discard a late reply without losing the learner message", async () => {
  const { db, id } = fixture();
  let release!: (v: ReturnType<typeof result>) => void;
  const pending = continueReflection(
    db,
    id,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { id: crypto.randomUUID(), text: "My reasoning" },
  );
  db.transition(id, "complete");
  db.transition(id, "reflect");
  release(result());
  await pending;
  const saved = db.get(id);
  assert.equal(saved.reflection?.messages.length, 1);
  assert.equal(saved.evaluations.length, 0);
  assert.equal(saved.previousLearningExits?.[0].reason, "manual");
  db.db.close();
});
test("supported inference can finish reflection but requires real learner and recording evidence without unresolved uncertainty", () => {
  const a = reflectionFixture();
  a.reflection = {
    messages: [
      {
        id: "learner",
        role: "user",
        text: "I traded sorting for a linear set scan with extra n storage.",
        createdAt: 1,
      },
    ],
  };
  const r = result().result;
  r.status = "ready";
  for (const key of [
    "approach",
    "timeComplexity",
    "spaceComplexity",
  ] as const) {
    r.checks[key] = {
      status: "inferred",
      evidence: [
        { messageId: "learner", quote: "linear set scan with extra n storage" },
      ],
      recordingEvidence: [4],
      assessment:
        "The stated trade-off matches the recorded scan and growing set.",
      uncertainty: null,
    };
  }
  assert.doesNotThrow(() => validateReflection(a, r));
  r.checks.approach.recordingEvidence = [];
  assert.throws(() => validateReflection(a, r), /supporting recording/);
  r.checks.approach.recordingEvidence = [999];
  assert.throws(() => validateReflection(a, r), /unknown recording/);
  r.checks.approach.recordingEvidence = [4];
  r.checks.approach.evidence = [];
  assert.throws(() => validateReflection(a, r), /learner evidence/);
  r.checks.approach.evidence = r.checks.timeComplexity.evidence;
  r.checks.approach.uncertainty = "Contradiction remains.";
  assert.throws(() => validateReflection(a, r), /material uncertainty/);
});
test("supported reflection completion allows moving on without a focused exercise", async () => {
  const { db, id } = fixture(),
    message = {
      id: crypto.randomUUID(),
      text: "A full conceptual explanation",
    };
  await continueReflection(
    db,
    id,
    async () => {
      const r = result();
      r.result.status = "ready";
      for (const c of Object.values(r.result.checks)) {
        c.status = "explained";
        c.uncertainty = null;
        c.assessment = "Direct learner explanation.";
        c.evidence = [{ messageId: message.id, quote: message.text }];
      }
      return r;
    },
    message,
  );
  assert.equal(reflectionReady(db.get(id)), true);
  assert.equal(
    db.transition(id, "complete").learningExit?.reason,
    "sufficient",
  );
  assert.equal(db.get(id).followup, undefined);
  db.db.close();
});

test("a demonstrated misconception may have no uncertainty, persists as feedback, and does not imply readiness", async () => {
  const { db, id } = fixture();
  const message = {
    id: crypto.randomUUID(),
    text: "The first valid pair is always optimal.",
  };
  const r = result().result;
  r.focus = null;
  r.checks.approach = {
    status: "needs-practice",
    evidence: [{ messageId: message.id, quote: message.text }],
    recordingEvidence: [4],
    assessment:
      "A valid pair need not be globally optimal; a counterexample establishes the misconception.",
    uncertainty: null,
  };
  try {
    assert.equal(reflectionOutputSchema.safeParse(r).success, true);
    await continueReflection(
      db,
      id,
      async () => ({ result: r, model: "fixture" }),
      message,
    );
    const saved = db.get(id);
    assert.equal(
      saved.reflection?.messages.at(-1)?.checks?.approach.status,
      "needs-practice",
    );
    assert.equal(
      saved.reflection?.messages.at(-1)?.checks?.approach.uncertainty,
      null,
    );
    assert.equal(reflectionReady(saved), false);
    assert.throws(
      () => validateReflection(saved, { ...r, status: "ready" }),
      /unanswered/,
    );
    r.checks.approach.uncertainty =
      "How the learner would revise the stopping rule remains open.";
    assert.doesNotThrow(() => validateReflection(saved, r));
    r.checks.approach.evidence = [];
    assert.throws(() => validateReflection(saved, r), /learner evidence/);
    assert.equal(reflectionOutputSchema.safeParse(r).success, false);
    r.checks.approach.evidence = [
      { messageId: message.id, quote: "invented evidence" },
    ];
    assert.throws(() => validateReflection(saved, r), /missing learner/);
  } finally {
    db.db.close();
  }
});

test("new reflection output constrains uncertainty by status without changing historical parsing", () => {
  const a = reflectionFixture();
  a.reflection = {
    messages: [
      {
        id: "learner",
        role: "user",
        text: "A stated explanation",
        createdAt: 1,
      },
    ],
  };
  const r = result().result;
  r.focus = null;
  const c = r.checks.approach;
  c.evidence = [{ messageId: "learner", quote: "A stated explanation" }];
  c.recordingEvidence = [4];
  for (const status of [
    "open",
    "explained",
    "inferred",
    "needs-practice",
  ] as const) {
    c.status = status;
    for (const uncertainty of [null, "A material uncertainty remains."]) {
      c.uncertainty = uncertainty;
      const valid =
        status === "needs-practice" ||
        (status === "open" ? uncertainty !== null : uncertainty === null);
      assert.equal(
        reflectionOutputSchema.safeParse(r).success,
        valid,
        `${status}/${uncertainty}`,
      );
      if (valid) assert.doesNotThrow(() => validateReflection(a, r));
      else
        assert.throws(() => validateReflection(a, r), /material uncertainty/);
      assert.doesNotThrow(() => reflectionResultSchema.parse(r));
    }
  }
  c.status = "open";
  c.uncertainty = "  ";
  assert.throws(() => validateReflection(a, r), /material uncertainty/);
  assert.equal(reflectionOutputSchema.safeParse(r).success, false);
  const schema = z.toJSONSchema(reflectionOutputSchema) as any;
  assert.equal(schema.properties.checks.properties.approach.anyOf.length, 4);
});
test("replay respects range ends, holds the final frame before looping, and handles empty ranges", () => {
  assert.deepEqual(playbackPosition(200, 500, 100, 600, false), {
    at: 600,
    playing: false,
  });
  assert.deepEqual(playbackPosition(100, 500, 100, 600, true), {
    at: 600,
    playing: true,
  });
  assert.deepEqual(playbackPosition(100, 1400, 100, 600, true), {
    at: 200,
    playing: true,
  });
  assert.deepEqual(playbackPosition(100, 500, 100, 100, true), {
    at: 100,
    playing: false,
  });
});

test("preparation starts without answers and merges an intake saved while analysis is running", async () => {
  const { db, id } = fixture();
  let release!: (value: ReturnType<typeof result>) => void;
  const pending = prepareReflection(db, id, async (a) => {
    assert.deepEqual(a.reflection?.messages, []);
    assert.equal(a.reflection?.intake, undefined);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const answers = {
    id: crypto.randomUUID(),
    familiarity: "solved",
    spaceComplexity: "O(n)",
    timeComplexity: "O(n)",
  };
  saveReflectionIntake(db, id, answers);
  assert.equal(db.get(id).reflection?.messages.length, 1);
  release(result());
  await pending;
  const saved = db.get(id);
  assert.equal(saved.reflection?.intake?.id, answers.id);
  assert.equal(saved.exposure, "solved");
  assert.equal(saved.exposureSource, "reported");
  assert.ok(saved.reflection?.analysis);
  assert.equal(saved.evaluations.length, 0);
  assert.equal(saved.reflection?.messages.length, 1);
  await prepareReflection(db, id, async () => {
    throw new Error("Duplicate analysis");
  });
  await continueReflection(db, id, async (a) => {
    assert.ok(a.reflection?.analysis);
    assert.equal(a.reflection?.intake?.spaceComplexity, "O(n)");
    assert.match(a.reflection!.messages[0].text, /Auxiliary space complexity/);
    return result();
  });
  assert.equal(db.get(id).reflection?.messages.length, 2);
  assert.equal(db.get(id).reflection?.messages[1].replyTo, answers.id);
  db.db.close();
});
test("intake rejects missing fields, preserves first answers, supports retry and explicit uncertainty", async () => {
  const { db, id } = fixture();
  const answers = {
    id: crypto.randomUUID(),
    familiarity: "new",
    spaceComplexity: "I am not sure",
    timeComplexity: "O(n)",
  };
  for (const change of [
    { familiarity: "" },
    { spaceComplexity: " " },
    { timeComplexity: "" },
  ])
    assert.throws(() =>
      saveReflectionIntake(db, id, { ...answers, ...change }),
    );
  const before = db.get(id);
  saveReflectionIntake(db, id, answers);
  saveReflectionIntake(db, id, answers);
  assert.equal(db.get(id).reflection?.messages.length, 1);
  assert.throws(
    () =>
      saveReflectionIntake(db, id, { ...answers, spaceComplexity: "changed" }),
    /already saved/,
  );
  await assert.rejects(
    prepareReflection(db, id, async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(db.get(id).reflection?.intake?.spaceComplexity, "I am not sure");
  await prepareReflection(db, id, async () => result());
  assert.deepEqual(db.get(id).events, before.events);
  assert.equal(db.get(id).source, before.source);
  db.db.close();
});
test("a preparation result cannot reopen an exited session or become learner-facing feedback", async () => {
  const { db, id } = fixture();
  let release!: (value: ReturnType<typeof result>) => void;
  const pending = prepareReflection(
    db,
    id,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  db.transition(id, "complete", Date.now(), "skipped");
  db.transition(id, "reflect");
  release(result());
  await pending;
  assert.equal(db.get(id).reflection?.analysis, undefined);
  assert.equal(db.get(id).reflection?.messages.length ?? 0, 0);
  assert.equal(db.get(id).evaluations.length, 0);
  db.db.close();
});

test("replay chat persists selected code and cursor from the referenced snapshot and rejects replacement", async () => {
  const { db, id } = fixture();
  const a = db.get(id),
    code = replay(a, 0),
    line = code.split(/\r\n|\r|\n/)[0];
  const message = {
    id: crypto.randomUUID(),
    text: "Why this line?",
    editor: {
      file: "Solution.java" as const,
      source: "recording" as const,
      seq: 0,
      cursor: { line: 1, column: 1, lineText: line },
      selection: {
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: line.length + 1,
        text: line,
      },
    },
  };
  let calls = 0;
  const run = async (attempt: import("../lib/types").Attempt) => {
    calls++;
    assert.deepEqual(
      attempt.reflection?.messages.at(-1)?.editor,
      message.editor,
    );
    return result();
  };
  await continueReflection(db, id, run, message);
  await continueReflection(db, id, run, message);
  assert.equal(calls, 1);
  assert.deepEqual(
    db.get(id).reflection?.messages.find((m) => m.id === message.id)?.editor,
    message.editor,
  );
  await assert.rejects(
    continueReflection(db, id, run, {
      ...message,
      editor: {
        ...message.editor,
        cursor: { ...message.editor.cursor, column: 2 },
      },
    }),
    /cannot be replaced/,
  );
  assert.equal(db.get(id).source, a.source);
  db.db.close();
});

test("coach ranges and legacy loop selections autoplay in a loop, with an exact inspection snapshot", () => {
  const a = reflectionFixture();
  const focus = {
    startSeq: 2,
    endSeq: 5,
    mode: "range" as const,
    label: "Change",
    pauseSeq: 4,
  };
  assert.equal(validateReplayFocus(a, focus), focus);
  const state = coachReplayState(a, focus);
  assert.equal(state.playing, true);
  assert.equal(state.loop, true);
  assert.equal(state.seq, 2);
  assert.equal(state.pauseSeq, 4);
  assert.deepEqual(state.range, [20000, 90000]);
  assert.equal(replayPauseSequence(a, { ...focus, pauseSeq: 3 }), 3);
  assert.equal(replayPauseSequence(a, { ...focus, pauseSeq: undefined }), 4);
  assert.equal(
    replayPauseSequence(a, {
      ...focus,
      startSeq: 5,
      endSeq: 6,
      pauseSeq: undefined,
    }),
    6,
  );
  assert.equal(coachReplayState(a, { ...focus, mode: "loop" }).playing, true);
  const snapshot = coachReplayState(a, {
    startSeq: 4,
    endSeq: 4,
    mode: "snapshot",
    label: "Point",
    pauseSeq: 4,
  });
  assert.equal(snapshot.playing, false);
  assert.equal(snapshot.seq, 4);
  assert.equal(snapshot.at, 55000);
  assert.throws(
    () =>
      validateReplayFocus(a, {
        ...focus,
        startSeq: 4,
        endSeq: 4,
        mode: "snapshot",
        pauseSeq: 3,
      }),
    /pause point/,
  );
});

test("simultaneous recording events retain the chosen inspection code without a zero-duration playback loop", () => {
  const a = reflectionFixture();
  for (const e of a.events) e.at = a.createdAt + 1000;
  const focus = {
    startSeq: 2,
    endSeq: 5,
    mode: "range" as const,
    label: "Same timestamp",
    pauseSeq: 3,
  };
  const state = coachReplayState(a, focus);
  assert.equal(state.playing, false);
  assert.equal(state.loop, false);
  assert.equal(state.seq, 3);
  assert.equal(state.at, 1000);
  assert.notEqual(replay(a, state.seq), replay(a, 5));
});

test("coach output requires the nullable pause field while older saved focuses remain readable", () => {
  const schema = z.toJSONSchema(reflectionOutputSchema) as any;
  const focus = schema.properties.focus.anyOf.find((s: any) => s.properties);
  assert.ok(focus.required.includes("pauseSeq"));
  assert.equal(
    reflectionResultSchema.parse(result().result).focus?.pauseSeq,
    undefined,
  );
});

test("retrieved source receipts persist with preparation, the exact assistant turn and its evaluation", async () => {
  const { db, id } = fixture();
  const research: import("../lib/research-types").ResearchBundle = {
    sources: [
      {
        id: "r-test",
        title: "Official test source",
        url: "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html",
        kind: "official-docs",
        version: "Java 25",
        retrievedAt: Date.now(),
        excerpt: "Retrieved text",
        digest: "test",
      },
    ],
    claims: [],
    symbols: [],
    lookups: [],
    runtime: { editorJava: 25, executionJava: null },
  };
  const run = async () => ({ ...result(), research });
  await prepareReflection(db, id, run);
  assert.deepEqual(db.get(id).reflection?.analysis?.research, research);
  await continueReflection(db, id, run);
  assert.deepEqual(db.get(id).reflection?.messages.at(-1)?.research, research);
  assert.deepEqual(db.get(id).evaluations.at(-1)?.research, research);
  db.db.close();
});

test("reflectionOutputSchema allows up to 12 surfacedQuestionIds and rejects >12", () => {
  const schema = reflectionOutputSchema.shape.surfacedQuestionIds;
  const eight = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"];
  assert.deepEqual(schema.parse(eight), eight);
  const thirteen = Array.from({ length: 13 }, (_, i) => `q${i + 1}`);
  assert.throws(() => schema.parse(thirteen));
});
