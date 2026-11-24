import { test } from "node:test";
import assert from "node:assert/strict";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { continueCoaching } from "../lib/coaching-service";
import {
  FIRST_RESPONSE,
  latestCoaching,
  readyToMoveOn,
  validateUnderstanding,
  type CoachingResult,
} from "../lib/coaching";

function fixture() {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000);
  db.transition(a.id, "finish");
  const learning = db.transition(a.id, "learn");
  learning.evaluations.push({
    summary: "A focused check",
    strengths: [],
    gaps: [],
    moments: [],
    exercise: {
      title: "Set invariant",
      skill: "reasoning",
      prompt: "Explain why check before insert matters.",
      rubric: "Explain previously seen values and false positives.",
    },
    version: "test",
    createdAt: Date.now(),
    evidenceThrough: 0,
  });
  learning.followup = {
    evaluationRevision: 0,
    answer:
      "The set contains earlier values, not the current one. Inserting first gives a false positive.",
    answeredAt: Date.now(),
  };
  db.save(learning);
  return { db, a: learning };
}
function response(
  id = FIRST_RESPONSE,
  quote = "The set contains earlier values",
): CoachingResult {
  return {
    feedback: "You explained the invariant. You can move on or keep talking.",
    outcome: "independent",
    understanding: {
      status: "sufficient",
      summary: "Invariant demonstrated",
      criteria: [
        {
          concept: "Previously seen values",
          status: "demonstrated",
          evidence: [{ messageId: id, quote }],
        },
      ],
    },
  };
}
const plan = async () => ({
  title: "Two Sum",
  slug: "two-sum",
  reason: "Transfer the idea",
  revisitAt: Date.now() + 86400000,
});

test("conceptual evidence can finish in one turn, with idempotent retries and immutable first response", async () => {
  const { db, a } = fixture();
  let calls = 0;
  const deps = {
    coach: async () => {
      calls++;
      return response();
    },
    plan,
  };
  await continueCoaching(db, a.id, deps);
  await continueCoaching(db, a.id, deps);
  assert.equal(calls, 1);
  const saved = db.get(a.id);
  assert.equal(
    saved.phase,
    "learn",
    "evidence offers completion; it doesn't navigate or finish automatically",
  );
  assert.equal(readyToMoveOn(saved), true);
  assert.equal(saved.followup!.messages!.length, 1);
  assert.equal(saved.followup!.answer, a.followup!.answer);
  assert.equal(saved.followup!.plannedAfter, latestCoaching(saved)!.id);
  assert.equal(
    db.transition(a.id, "complete", Date.now(), "sufficient").learningExit
      ?.reason,
    "sufficient",
  );
  assert.equal(
    db.transition(a.id, "complete", Date.now(), "manual").learningExit?.reason,
    "sufficient",
  );
  const resumed = db.transition(a.id, "learn");
  assert.equal(resumed.previousLearningExits?.[0].reason, "sufficient");
  assert.equal(resumed.followup!.answer, a.followup!.answer);
  db.db.close();
});

test("failed replies preserve user messages for retry; coached evidence does not rewrite baseline", async () => {
  const { db, a } = fixture();
  a.followup!.feedback = "Earlier feedback";
  a.followup!.outcome = "partial";
  db.save(a);
  const message = {
    id: crypto.randomUUID(),
    text: "The set contains only previously processed values; adding first matches itself.",
  };
  await assert.rejects(
    continueCoaching(
      db,
      a.id,
      {
        coach: async () => {
          throw new Error("offline");
        },
        plan,
      },
      message,
    ),
    /offline/,
  );
  assert.equal(db.get(a.id).followup!.messages!.at(-1)?.text, message.text);
  assert.equal(readyToMoveOn(db.get(a.id)), false);
  const deps = {
    coach: async () => response(message.id, "adding first matches itself"),
    plan,
  };
  await continueCoaching(db, a.id, deps); // refresh/retry without resending message
  await continueCoaching(db, a.id, deps, message); // lost HTTP response/retry same ID
  const saved = db.get(a.id);
  assert.equal(saved.followup!.messages!.length, 2);
  assert.equal(saved.followup!.feedback, "Earlier feedback");
  assert.equal(saved.followup!.outcome, "partial");
  assert.equal(latestCoaching(saved)?.understanding?.support, "coached");
  await assert.rejects(
    continueCoaching(db, a.id, deps, { ...message, text: "replacement" }),
    /cannot be replaced/,
  );
  db.db.close();
});

test("completion rejects invented citations, coach evidence, and unresolved concepts", () => {
  const { db, a } = fixture();
  assert.throws(
    () =>
      validateUnderstanding(
        a,
        response("coach-message", "The set contains earlier values"),
      ),
    /missing learner evidence/,
  );
  assert.throws(
    () => validateUnderstanding(a, response(FIRST_RESPONSE, "invented quote")),
    /missing learner evidence/,
  );
  const unresolved = response();
  unresolved.understanding.criteria[0].status = "open";
  assert.throws(
    () => validateUnderstanding(a, unresolved),
    /unresolved concept/,
  );
  const noEvidence = response();
  noEvidence.understanding.criteria[0].evidence = [];
  assert.throws(() => validateUnderstanding(a, noEvidence), /did not cite/);
  db.db.close();
});

test("skip and manual exit work without agent availability or a first response", async () => {
  const { db, a } = fixture();
  delete a.followup;
  db.save(a);
  const skipped = db.transition(a.id, "complete", Date.now(), "skipped");
  assert.equal(skipped.learningExit?.reason, "skipped");
  assert.equal(skipped.followup, undefined);
  db.transition(a.id, "learn");
  assert.equal(
    db.transition(a.id, "complete", Date.now(), "manual").learningExit?.reason,
    "manual",
  );
  db.db.close();
});

test("moving on during generation keeps the exit and discards the late reply", async () => {
  const { db, a } = fixture();
  let reply!: (r: CoachingResult) => void;
  let plans = 0;
  const working = continueCoaching(db, a.id, {
    coach: () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
    plan: async () => {
      plans++;
      return plan();
    },
  });
  db.transition(a.id, "complete", Date.now(), "skipped");
  reply(response());
  await working;
  assert.equal(db.get(a.id).learningExit?.reason, "skipped");
  assert.equal(db.get(a.id).followup!.feedback, undefined);
  assert.equal(plans, 0);
  db.db.close();
});

test("planning failure does not discard valid feedback or trigger a duplicate coach reply", async () => {
  const { db, a } = fixture();
  let calls = 0;
  const coach = async () => {
    calls++;
    return response();
  };
  await assert.rejects(
    continueCoaching(db, a.id, {
      coach,
      plan: async () => {
        throw new Error("planner unavailable");
      },
    }),
    /planner unavailable/,
  );
  assert.equal(readyToMoveOn(db.get(a.id)), true);
  await continueCoaching(db, a.id, { coach, plan });
  assert.equal(calls, 1);
  assert.ok(db.get(a.id).followup!.next);
  db.db.close();
});

test("revisiting a legacy partial result appends new understanding without rewriting old feedback", async () => {
  const { db, a } = fixture();
  a.followup!.feedback = "The requested traces are missing.";
  a.followup!.outcome = "partial";
  db.save(a);
  await continueCoaching(db, a.id, { coach: async () => response(), plan });
  const saved = db.get(a.id);
  assert.equal(saved.followup!.outcome, "partial");
  assert.equal(saved.followup!.feedback, "The requested traces are missing.");
  assert.equal(latestCoaching(saved)?.understanding?.support, "independent");
  assert.equal(readyToMoveOn(saved), true);
  db.db.close();
});

test("a late reply cannot attach to a reopened session", async () => {
  const { db, a } = fixture();
  let reply!: (r: CoachingResult) => void;
  const working = continueCoaching(db, a.id, {
    coach: () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
    plan,
  });
  db.transition(a.id, "complete", Date.now(), "skipped");
  db.transition(a.id, "learn");
  reply(response());
  await working;
  assert.equal(db.get(a.id).phase, "learn");
  assert.equal(db.get(a.id).followup!.messages?.length ?? 0, 0);
  assert.equal(db.get(a.id).previousLearningExits?.[0].reason, "skipped");
  db.db.close();
});

test("coaching preserves turn context across failed generation and later workspace edits", async () => {
  const { db, a } = fixture();
  a.followup!.feedback = "Earlier feedback";
  a.followup!.coachedCode = "class Coached {}";
  db.save(a);
  const message = {
    id: crypto.randomUUID(),
    text: "What is this declaration?",
    editor: {
      file: "Solution.java" as const,
      source: "coached" as const,
      cursor: { line: 1, column: 1, lineText: a.followup!.coachedCode },
      selection: {
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 17,
        text: a.followup!.coachedCode,
      },
    },
  };
  await assert.rejects(
    continueCoaching(
      db,
      a.id,
      {
        coach: async () => {
          throw new Error("offline");
        },
        plan,
      },
      message,
    ),
    /offline/,
  );
  const saved = db.get(a.id);
  saved.followup!.coachedCode = "class Later {}";
  db.save(saved);
  await continueCoaching(
    db,
    a.id,
    {
      coach: async (attempt) => {
        assert.deepEqual(
          attempt.followup!.messages!.at(-1)?.editor,
          message.editor,
        );
        return response();
      },
      plan,
    },
    message,
  );
  assert.deepEqual(
    db.get(a.id).followup!.messages!.find((m) => m.id === message.id)?.editor,
    message.editor,
  );
  assert.equal(db.get(a.id).source, a.source);
  db.db.close();
});

test("focused feedback retains source receipts on the preserved feedback and assistant message", async () => {
  const { db, a } = fixture();
  const research: import("../lib/research-types").ResearchBundle = {
    sources: [],
    claims: [],
    symbols: [],
    lookups: [],
    runtime: { editorJava: 25, executionJava: null },
  };
  await continueCoaching(db, a.id, {
    coach: async () => ({ ...response(), research }),
    plan,
  });
  assert.deepEqual(db.get(a.id).followup?.research, research);
  assert.deepEqual(db.get(a.id).followup?.messages?.[0].research, research);
  db.db.close();
});
