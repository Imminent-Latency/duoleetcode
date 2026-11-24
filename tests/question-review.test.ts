import { test } from "node:test";
import assert from "node:assert/strict";
import { reflectionFixture } from "../tools/reflection-fixture";
import {
  reviewQuestions,
  validateQuestionAnswer,
  validateQuestionRefs,
  type ReviewStageRunner,
} from "../lib/question-review-runner";
import { z } from "zod";
import {
  reviewTopics,
  reviewedQuestions,
  questionReviewSchema,
  questionJudgmentOutputSchema,
  type ReviewQuestion,
  type QuestionAnswer,
  type QuestionReview,
} from "../lib/question-review";
import { TraceStore, traceScope } from "../lib/agent-traces";
import { evidenceFromAttempt } from "../lib/learner-memory";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { prepareReflection, continueReflection } from "../lib/reflection-service";
import { captureSnapshot, parseSnapshot } from "../lib/snapshots";
import { projectActivity } from "../lib/agent-activity";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import QuestionReviewDetails from "../components/question-review-details";

const empty = () => ({
  sequences: [],
  learner: [],
  assistanceIds: [],
  sourceUrls: [],
});
const question = (id: string): ReviewQuestion => ({
  id,
  topic: "correctness",
  kind: "behavior",
  question: `What does ${id} establish?`,
  purpose: "Check observable behavior without inventing intent.",
  priority: "high",
  anchors: { ...empty(), sequences: [0] },
});
const answer = (id: string): QuestionAnswer => ({
  questionId: id,
  classification: "observed",
  answer: "The saved source contains a set.",
  justification: "Directly visible in the source.",
  supporting: { ...empty(), sequences: [0] },
  conflicting: empty(),
  alternatives: [],
  uncertainty: null,
});
const coverage = (ids: string[]) =>
  reviewTopics.map((topic) => ({
    topic,
    questionIds: ids,
    rationale:
      "Considered the supplied evidence; no redundant learner check needed.",
  }));
function runner(
  options: {
    missing?: boolean;
    rejected?: boolean;
    incremental?: boolean;
    perpetual?: boolean;
  } = {},
) {
  const calls: { stage: string; input: any }[] = [];
  let judges = 0;
  const run: ReviewStageRunner = async (
    stage,
    _policy,
    input: any,
    _schema,
    validate,
  ) => {
    calls.push({ stage, input });
    let value: unknown;
    if (stage === "question-generation")
      value = options.incremental
        ? {
            questions: [],
            refreshIds: ["behavior"],
            coverage: coverage(["behavior"]),
          }
        : {
            questions: [question("behavior")],
            refreshIds: [],
            coverage: coverage(["behavior"]),
          };
    else if (stage === "question-analysis") {
      assert.ok(
        !("previous" in input) && !("candidates" in input),
        "Analyst must not be primed by previous candidate answers",
      );
      value = {
        answers: input.questions.map((q: ReviewQuestion) => answer(q.id)),
      };
    } else {
      judges++;
      const missing = options.perpetual
        ? [question(`missing-${judges}`)]
        : options.missing && judges === 1
          ? [question("missed-strength")]
          : [];
      value = {
        refreshIds: [],
        verdicts: input.reviewIds.map((id: string) => ({
          ...answer(id),
          decision: options.rejected ? "reject" : "accept",
          missingEvidence: "none",
          coachingRole: options.rejected ? "background" : "worth-sharing",
          disposition: options.rejected ? "deferred" : "resolved-internally",
        })),
        coverage: coverage([
          ...input.questions.map((q: ReviewQuestion) => q.id),
          ...missing.map((q) => q.id),
        ]),
        missingQuestions: missing,
        coverageComplete: !missing.length,
        limitations: [],
      };
    }
    validate(value);
    return {
      value,
      model: "fixture-model",
      effort: "low",
      traceId: `${stage}-${calls.length}`,
    };
  };
  return { run, calls };
}
test("independent answering, coverage expansion and review artifacts are bounded and traceable", async () => {
  const a = reflectionFixture(),
    original = structuredClone(a);
  const { run, calls } = runner({ missing: true });
  const db = new TraceStore(":memory:");
  const root = db.start({ role: "reflect", kind: "workflow", attemptId: a.id });
  try {
    const result = await traceScope.run(root, () => reviewQuestions(a, run));
    assert.deepEqual(a, original);
    assert.equal(result.questions.length, 2);
    assert.equal(result.coverageComplete, true);
    assert.equal(
      calls.filter((c) => c.stage === "question-generation").length,
      1,
    );
    assert.equal(
      calls.filter((c) => c.stage === "question-judgment").length,
      2,
    );
    assert.ok(
      db
        .detail(result.traceId!)
        .events.some((e) => e.kind === "questions.review"),
    );
    assert.deepEqual(questionReviewSchema.parse(result), result);
  } finally {
    root.finish("succeeded");
    db.close();
  }
});
test("a rejected candidate never reaches the coach and never becomes skill evidence", async () => {
  const a = reflectionFixture();
  a.demonstration = false;
  const { run } = runner({ rejected: true });
  const review = await reviewQuestions(a, run);
  review.questions[0].candidate.answer = "UNSUPPORTED LEARNER DEFICIT";
  review.questions[0].verdict.answer = "UNVERIFIED ALTERNATIVE";
  const projected = reviewedQuestions(review)!;
  assert.equal(projected.questions[0].finding, null);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /UNSUPPORTED|UNVERIFIED ALTERNATIVE/,
  );
  a.reflection = { messages: [], questionReview: review };
  assert.deepEqual(evidenceFromAttempt(a), []);
});
test("review reuse is exact; a new explanation updates selected questions while retaining history", async () => {
  const a = reflectionFixture();
  const initial = await reviewQuestions(a, runner().run);
  a.reflection = { messages: [], questionReview: initial };
  const cached = await reviewQuestions(a, async () => {
    throw Error("No model call expected");
  });
  assert.deepEqual(cached, initial);
  a.reflection.messages.push({
    id: "explanation",
    role: "user",
    text: "I wanted faster lookup.",
    createdAt: 99,
  });
  const update = runner({ incremental: true });
  const result = await reviewQuestions(a, update.run);
  assert.equal(result.revision, initial.revision + 1);
  assert.deepEqual(
    update.calls[0].input.newMessages.map((m: any) => m.id),
    ["explanation"],
  );
  assert.equal(
    update.calls.filter((c) => c.stage === "question-analysis").length,
    1,
  );
  assert.equal(initial.revision, 1);
  assert.deepEqual(initial.throughMessageIds, []);
});
test("remaining omissions are retained as deferred uncertainty after two passes", async () => {
  const { run, calls } = runner({ perpetual: true });
  const result = await reviewQuestions(reflectionFixture(), run);
  assert.equal(calls.filter((c) => c.stage === "question-judgment").length, 2);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.questions.at(-1)!.verdict.decision, "needs-evidence");
  assert.equal(result.questions.at(-1)!.verdict.disposition, "deferred");
  assert.ok(result.limitations.length);
});

test("coverage judge can reopen a finding the update planner missed", async () => {
  const a = reflectionFixture();
  a.reflection = {
    messages: [],
    questionReview: await reviewQuestions(a, runner().run),
  };
  a.reflection.messages.push({
    id: "correction",
    role: "user",
    text: "That was not my intended approach.",
    createdAt: 42,
  });
  let judged = 0,
    analyzed = 0;
  const fallback = runner().run;
  const result = await reviewQuestions(
    a,
    async (stage, policy, input: any, schema, validate) => {
      if (stage === "question-generation") {
        const value = {
          questions: [],
          refreshIds: [],
          coverage: coverage(["behavior"]),
        };
        validate(value);
        return { value, model: "fixture-model", effort: "low" };
      }
      if (stage === "question-judgment" && ++judged === 1) {
        assert.deepEqual(input.reviewIds, []);
        const value = {
          verdicts: [],
          refreshIds: ["behavior"],
          missingQuestions: [],
          coverage: coverage(["behavior"]),
          coverageComplete: false,
          limitations: [
            "The new learner correction affects an earlier finding.",
          ],
        };
        validate(value);
        return { value, model: "fixture-model", effort: "low" };
      }
      if (stage === "question-analysis") analyzed++;
      return fallback(stage, policy, input, schema, validate);
    },
  );
  assert.equal(analyzed, 1);
  assert.equal(judged, 2);
  assert.equal(result.questions[0].updatedRevision, 2);
});

test("a changed model choice rebuilds the bank even when evidence is unchanged", async () => {
  const a = reflectionFixture();
  a.reflection = {
    messages: [],
    questionReview: await reviewQuestions(a, runner().run, {
      model: "fixture-model",
      effort: "low",
    }),
  };
  const next = runner();
  await reviewQuestions(a, next.run, { model: "another-model", effort: "low" });
  assert.equal(next.calls[0].input.previous, undefined);
  assert.ok(next.calls.some((c) => c.stage === "question-analysis"));
});
test("references reject invented events, coach quotes, unobserved intent and fabricated sources", () => {
  const a = reflectionFixture();
  a.reflection = {
    messages: [
      {
        id: "coach",
        role: "assistant",
        text: "You wanted speed.",
        createdAt: 1,
      },
    ],
  };
  assert.throws(
    () => validateQuestionRefs(a, { ...empty(), sequences: [999] }),
    /unknown recorded/,
  );
  a.javaHelp = [
    {
      id: "lookup",
      question: "I want faster lookup; how do I declare a set?",
      answer: "A set can help.",
    },
  ] as any;
  assert.doesNotThrow(() =>
    validateQuestionRefs(a, {
      ...empty(),
      learner: [{ messageId: "lookup", quote: "I want faster lookup" }],
    }),
  );
  assert.throws(
    () =>
      validateQuestionRefs(a, {
        ...empty(),
        learner: [{ messageId: "lookup", quote: "A set can help." }],
      }),
    /non-learner/,
  );
  assert.throws(
    () =>
      validateQuestionRefs(a, {
        ...empty(),
        learner: [{ messageId: "coach", quote: "You wanted speed." }],
      }),
    /non-learner/,
  );
  assert.throws(
    () =>
      validateQuestionRefs(
        a,
        { ...empty(), sourceUrls: ["https://docs.oracle.com/invented"] },
        new Set(),
      ),
    /retrieval receipt/,
  );
  assert.throws(
    () =>
      validateQuestionAnswer(
        a,
        { ...question("intent"), kind: "intent" },
        answer("intent"),
      ),
    /learner's own/,
  );
  assert.throws(
    () =>
      validateQuestionAnswer(a, question("behavior"), {
        ...answer("behavior"),
        classification: "plausible",
      }),
    /uncertainty/,
  );
});
test("duplicate answers and uncovered topics fail before they can guide coaching", async () => {
  const a = reflectionFixture();
  const bad: ReviewStageRunner = async (
    stage,
    _policy,
    _input,
    _schema,
    validate,
  ) => {
    const value =
      stage === "question-generation"
        ? {
            questions: [question("q")],
            refreshIds: [],
            coverage: coverage(["q"]).map((c) => ({ ...c, topic: "intent" })),
          }
        : {};
    validate(value);
    return { value, model: "test" };
  };
  await assert.rejects(reviewQuestions(a, bad), /Coverage must cover/);
  const base = runner().run;
  await assert.rejects(
    reviewQuestions(a, async (stage, policy, input, schema, validate) => {
      if (stage !== "question-analysis")
        return base(stage, policy, input, schema, validate);
      const value = { answers: [answer("behavior"), answer("behavior")] };
      validate(value);
      return { value, model: "test" };
    }),
    /Answers must cover/,
  );
});
test("a completed investigation survives reply failure, snapshot export and concurrent intake", async () => {
  const db = new AttemptStore(":memory:"),
    sandbox = new AttemptStore(":memory:", true);
  try {
    const now = Date.now() - 2000;
    const a = db.create(demoProblem, 60000, false, now);
    db.transition(a.id, "finish", now + 1000);
    db.transition(a.id, "seal", now + 1000);
    let reviewed: QuestionReview | undefined;
    await assert.rejects(
      prepareReflection(db, a.id, async (observed, saveReview) => {
        reviewed = await reviewQuestions(observed, runner().run);
        reviewed.sources = [
          {
            id: "receipt",
            title: "Fixture reference",
            url: "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html",
            kind: "official-docs",
            version: "Java 25",
            retrievedAt: now,
            excerpt: "Preserved test excerpt",
            digest: "fixture-digest",
          },
        ];
        const current = db.get(a.id);
        current.reflection = {
          messages: [
            { id: "intake", role: "user", text: "O(n)", createdAt: now + 1100 },
          ],
        };
        db.save(current);
        saveReview!(reviewed);
        throw Error("Coach failed after review");
      }),
      /Coach failed/,
    );
    const saved = db.get(a.id);
    assert.equal(saved.reflection!.messages[0].id, "intake");
    assert.deepEqual(saved.reflection!.questionReview, reviewed);
    assert.equal(saved.evaluations.length, 0);
    const snap = parseSnapshot(
      captureSnapshot(
        db,
        sandbox,
        { settings: null, browser: {}, pagesPreview: null },
        "review checkpoint",
      ),
    );
    assert.deepEqual(
      snap.practice.attempts[0].reflection!.questionReview,
      reviewed,
    );
  } finally {
    db.db.close();
    sandbox.db.close();
  }
});
test("diagnostic review is readable and stage progress does not reveal raw prompts", async () => {
  const review = await reviewQuestions(reflectionFixture(), runner().run);
  const html = renderToStaticMarkup(
    createElement(QuestionReviewDetails, { review }),
  );
  assert.match(html, /Question and evidence review/);
  assert.match(html, /Original analyst answer/);
  assert.match(html, /Analyst trace/);
  const db = new TraceStore(":memory:");
  try {
    const run = db.start({
      role: "reflection coach",
      kind: "question-analysis",
    });
    const data = projectActivity(
      [{ ...db.detail(run.id).run, events: [] }],
      false,
    )!;
    assert.equal(data.label, "Answering questions from evidence");
    assert.equal(data.steps[0].output, undefined);
  } finally {
    db.close();
  }
});

const unresolvedAnswer = (id: string, uncertainty: string): QuestionAnswer => ({
  ...answer(id),
  classification: "unresolved",
  answer: "The available evidence does not settle this question.",
  uncertainty,
});

test("learner-only needs-evidence stops after round 1 without redundant retries", async () => {
  const a = reflectionFixture();
  const initialQuestions: ReviewQuestion[] = [
    { ...question("q1"), kind: "technical" },
    { ...question("q2"), topic: "approach-evolution", kind: "intent" },
    { ...question("q4"), topic: "intent", kind: "intent" },
  ];
  const calls: { stage: string; input: any }[] = [];
  const result = await reviewQuestions(
    a,
    async (stage, _policy, input: any, _schema, validate) => {
      calls.push({ stage, input });
      let value: unknown;
      if (stage === "question-generation")
        value = {
          questions: initialQuestions,
          refreshIds: [],
          coverage: coverage(initialQuestions.map((q) => q.id)),
        };
      else if (stage === "question-analysis") {
        assert.ok(
          !("previous" in input) && !("candidates" in input),
          "Analyst must remain unprimed",
        );
        value = {
          answers: input.questions.map((q: ReviewQuestion) =>
            q.id === "q1"
              ? answer(q.id)
              : unresolvedAnswer(q.id, "Unstated learner motivation or plan."),
          ),
        };
      } else
        value = {
          refreshIds: [],
          verdicts: [
            {
              ...answer("q1"),
              decision: "accept",
              missingEvidence: "none",
              coachingRole: "background",
              disposition: "resolved-internally",
            },
            {
              ...unresolvedAnswer(
                "q2",
                "No learner statement identifies the decisive motivation.",
              ),
              decision: "needs-evidence",
              missingEvidence: "learner",
              coachingRole: "context-question",
              disposition: "ask-user",
            },
            {
              ...unresolvedAnswer(
                "q4",
                "The intended preservation policy requires a learner explanation.",
              ),
              decision: "needs-evidence",
              missingEvidence: "learner",
              coachingRole: "blocking-question",
              disposition: "ask-user",
            },
          ],
          coverage: coverage(initialQuestions.map((q) => q.id)),
          missingQuestions: [],
          coverageComplete: true,
          limitations: [],
        };
      validate(value);
      return {
        value,
        model: "fixture-model",
        effort: "low",
        traceId: `${stage}-${calls.length}`,
      };
    },
  );
  assert.equal(calls.filter((c) => c.stage === "question-generation").length, 1);
  assert.equal(calls.filter((c) => c.stage === "question-analysis").length, 1);
  assert.equal(calls.filter((c) => c.stage === "question-judgment").length, 1);
  assert.equal(
    result.questions.find((q) => q.question.id === "q2")!.verdict
      .missingEvidence,
    "learner",
  );
  assert.equal(
    result.questions.find((q) => q.question.id === "q4")!.verdict
      .missingEvidence,
    "learner",
  );
  const html = renderToStaticMarkup(
    createElement(QuestionReviewDetails, { review: result }),
  );
  assert.match(html, /missing learner evidence/);
});

test("retrievable needs-evidence reruns only recording and technical items in round 2", async () => {
  const a = reflectionFixture();
  const initialQuestions: ReviewQuestion[] = [
    { ...question("resolved"), kind: "behavior" },
    { ...question("intent-gap"), topic: "intent", kind: "intent" },
    { ...question("recording-gap"), kind: "behavior" },
    { ...question("technical-gap"), kind: "technical" },
  ];
  const calls: { stage: string; input: any }[] = [];
  let judgeRound = 0;
  const result = await reviewQuestions(
    a,
    async (stage, _policy, input: any, _schema, validate) => {
      calls.push({ stage, input });
      let value: unknown;
      if (stage === "question-generation")
        value = {
          questions: initialQuestions,
          refreshIds: [],
          coverage: coverage(initialQuestions.map((q) => q.id)),
        };
      else if (stage === "question-analysis") {
        assert.ok(
          !("previous" in input) && !("candidates" in input),
          "Analyst must not receive previous candidate answers",
        );
        value = {
          answers: input.questions.map((q: ReviewQuestion) =>
            q.id === "resolved" || judgeRound > 0
              ? answer(q.id)
              : unresolvedAnswer(q.id, `Unchecked evidence for ${q.id}.`),
          ),
        };
      } else if (++judgeRound === 1)
        value = {
          refreshIds: [],
          verdicts: [
            {
              ...answer("resolved"),
              decision: "accept",
              missingEvidence: "none",
              coachingRole: "worth-sharing",
              disposition: "resolved-internally",
            },
            {
              ...unresolvedAnswer("intent-gap", "Learner intent was not stated."),
              decision: "needs-evidence",
              missingEvidence: "learner",
              coachingRole: "blocking-question",
              disposition: "ask-user",
            },
            {
              ...unresolvedAnswer(
                "recording-gap",
                "Earlier checkpoint was not yet inspected.",
              ),
              decision: "needs-evidence",
              missingEvidence: "recording",
              coachingRole: "background",
              disposition: "deferred",
            },
            {
              ...unresolvedAnswer(
                "technical-gap",
                "Official API specification was not yet verified.",
              ),
              decision: "needs-evidence",
              missingEvidence: "technical",
              coachingRole: "background",
              disposition: "deferred",
            },
          ],
          coverage: coverage(initialQuestions.map((q) => q.id)),
          missingQuestions: [],
          coverageComplete: true,
          limitations: [],
        };
      else {
        const lateTech: ReviewQuestion = {
          ...question("late-tech"),
          kind: "technical",
        };
        value = {
          refreshIds: [],
          verdicts: [
            {
              ...answer("recording-gap"),
              decision: "accept",
              missingEvidence: "none",
              coachingRole: "worth-sharing",
              disposition: "resolved-internally",
            },
            {
              ...unresolvedAnswer(
                "technical-gap",
                "Documentation lookup timed out.",
              ),
              decision: "needs-evidence",
              missingEvidence: "technical",
              coachingRole: "background",
              disposition: "deferred",
            },
          ],
          coverage: coverage([
            ...initialQuestions.map((q) => q.id),
            lateTech.id,
          ]),
          missingQuestions: [lateTech],
          coverageComplete: false,
          limitations: ["Late technical follow-up remained unverified."],
        };
      }
      validate(value);
      return {
        value,
        model: "fixture-model",
        effort: "low",
        traceId: `${stage}-${calls.length}`,
      };
    },
  );
  const analysisCalls = calls.filter((c) => c.stage === "question-analysis");
  assert.equal(analysisCalls.length, 2);
  assert.deepEqual(
    analysisCalls[0].input.questions.map((q: ReviewQuestion) => q.id),
    ["resolved", "intent-gap", "recording-gap", "technical-gap"],
  );
  assert.deepEqual(
    analysisCalls[1].input.questions.map((q: ReviewQuestion) => q.id),
    ["recording-gap", "technical-gap"],
  );
  const byId = new Map(result.questions.map((q) => [q.question.id, q]));
  assert.equal(byId.get("resolved")!.verdict.decision, "accept");
  assert.equal(byId.get("resolved")!.judgeTraceId, "question-judgment-3");
  assert.equal(byId.get("intent-gap")!.verdict.decision, "needs-evidence");
  assert.equal(byId.get("intent-gap")!.verdict.missingEvidence, "learner");
  assert.equal(byId.get("intent-gap")!.judgeTraceId, "question-judgment-3");
  assert.equal(byId.get("recording-gap")!.verdict.decision, "accept");
  assert.equal(byId.get("recording-gap")!.verdict.missingEvidence, "none");
  assert.equal(byId.get("recording-gap")!.judgeTraceId, "question-judgment-5");
  assert.equal(byId.get("technical-gap")!.verdict.decision, "needs-evidence");
  assert.equal(byId.get("technical-gap")!.verdict.missingEvidence, "technical");
  assert.equal(byId.get("late-tech")!.verdict.decision, "needs-evidence");
  assert.equal(byId.get("late-tech")!.verdict.missingEvidence, "technical");
});

test("strict judgment output schema and missing-evidence invariants reject invalid combinations", async () => {
  const jsonSchema = z.toJSONSchema(questionJudgmentOutputSchema) as Record<
    string,
    any
  >;
  const assertAllPropertiesRequired = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) assertAllPropertiesRequired(item);
      return;
    }
    const obj = node as Record<string, any>;
    if (obj.type === "object" && obj.properties) {
      assert.equal(obj.additionalProperties, false);
      assert.deepEqual(
        new Set(obj.required ?? []),
        new Set(Object.keys(obj.properties)),
      );
    }
    for (const child of Object.values(obj)) assertAllPropertiesRequired(child);
  };
  assertAllPropertiesRequired(jsonSchema);
  assert.equal(
    questionJudgmentOutputSchema.safeParse({
      refreshIds: [],
      verdicts: [
        {
          ...answer("q"),
          decision: "accept",
          disposition: "resolved-internally",
        },
      ],
      coverage: coverage(["q"]),
      missingQuestions: [],
      coverageComplete: true,
      limitations: [],
    }).success,
    false,
  );

  const a = reflectionFixture();
  const checkInvalid = (
    kind: ReviewQuestion["kind"],
    verdictOverride: Record<string, unknown>,
    pattern: RegExp,
  ) =>
    assert.rejects(
      reviewQuestions(a, async (stage, _policy, input: any, _schema, validate) => {
        const q: ReviewQuestion = { ...question("q"), kind };
        let value: unknown;
        if (stage === "question-generation")
          value = {
            questions: [q],
            refreshIds: [],
            coverage: coverage(["q"]),
          };
        else if (stage === "question-analysis")
          value = {
            answers: [unresolvedAnswer("q", "Pending check.")],
          };
        else
          value = {
            refreshIds: [],
            verdicts: [
              {
                ...unresolvedAnswer("q", "Pending check."),
                decision: "needs-evidence",
                missingEvidence: "recording",
                coachingRole: "background",
                disposition: "deferred",
                ...verdictOverride,
              },
            ],
            coverage: coverage(input.questions.map((x: ReviewQuestion) => x.id)),
            missingQuestions: [],
            coverageComplete: true,
            limitations: [],
          };
        validate(value);
        return { value, model: "fixture-model", effort: "low" };
      }),
      pattern,
    );

  await checkInvalid(
    "intent",
    { decision: "needs-evidence", missingEvidence: "none" },
    /identify the missing evidence/,
  );
  await checkInvalid(
    "technical",
    { decision: "needs-evidence", missingEvidence: "learner" },
    /Technical questions cannot depend/,
  );
  await checkInvalid(
    "intent",
    {
      decision: "needs-evidence",
      missingEvidence: "recording",
      coachingRole: "blocking-question",
      disposition: "ask-user",
    },
    /do not ask the learner to settle/,
  );
  await checkInvalid(
    "understanding",
    {
      decision: "qualify",
      missingEvidence: "technical",
      coachingRole: "blocking-question",
      disposition: "ask-user",
    },
    /do not ask the learner to settle/,
  );
  for (const missingEvidence of ["learner", "recording", "technical"] as const)
    await checkInvalid(
      "behavior",
      {
        ...answer("q"),
        decision: "accept",
        missingEvidence,
        coachingRole: "worth-sharing",
        disposition: "resolved-internally",
      },
      /cannot report blocking missing evidence/,
    );
  await checkInvalid(
    "intent",
    {
      decision: "needs-evidence",
      missingEvidence: "learner",
      coachingRole: "worth-sharing",
      disposition: "ask-user",
    },
    /Only verified resolved-internally findings can be marked worth-sharing/,
  );
  await checkInvalid(
    "intent",
    {
      decision: "needs-evidence",
      missingEvidence: "learner",
      coachingRole: "context-question",
      disposition: "deferred",
    },
    /require disposition=ask-user/,
  );
});

test("coaching roles, learner-only verified context, coach selection notes and surfaced insights persist cleanly", async () => {
  const a = reflectionFixture();
  const review = await reviewQuestions(
    a,
    async (stage, _policy, input: any, _schema, validate) => {
      const qs: ReviewQuestion[] = [
        { ...question("q2"), topic: "approach-evolution", kind: "intent" },
        { ...question("q3"), topic: "correctness", kind: "technical" },
      ];
      let value: unknown;
      if (stage === "question-generation")
        value = {
          questions: qs,
          refreshIds: [],
          coverage: coverage(["q2", "q3"]),
        };
      else if (stage === "question-analysis")
        value = {
          answers: [
            {
              ...unresolvedAnswer("q2", "Motivation not stated."),
              supporting: { ...empty(), sequences: [2, 4] },
              alternatives: ["Runtime improvement", "Key preservation"],
            },
            answer("q3"),
          ],
        };
      else
        value = {
          refreshIds: [],
          verdicts: [
            {
              ...unresolvedAnswer("q2", "Motivation is optional for baseline."),
              supporting: { ...empty(), sequences: [2, 4] },
              alternatives: ["Runtime improvement"],
              decision: "needs-evidence",
              missingEvidence: "learner",
              coachingRole: "context-question",
              disposition: "ask-user",
            },
            {
              ...answer("q3"),
              decision: "accept",
              missingEvidence: "none",
              coachingRole: "worth-sharing",
              disposition: "resolved-internally",
            },
          ],
          coverage: coverage(["q2", "q3"]),
          missingQuestions: [],
          coverageComplete: true,
          limitations: [],
        };
      validate(value);
      return { value, model: "fixture-model", effort: "low" };
    },
  );
  const projected = reviewedQuestions(review)!;
  const pq2 = projected.questions.find((q) => q.id === "q2") as any;
  const pq3 = projected.questions.find((q) => q.id === "q3") as any;
  assert.equal(pq2.coachingRole, "context-question");
  assert.equal(pq2.finding, null);
  assert.deepEqual(pq2.verifiedContext.supporting.sequences, [2, 4]);
  assert.equal(pq3.coachingRole, "worth-sharing");
  assert.ok(pq3.finding);

  const db = new AttemptStore(":memory:");
  try {
    const now = Date.now() - 2000;
    const created = db.create(demoProblem, 60000, true, now);
    db.transition(created.id, "finish", now + 500);
    db.transition(created.id, "seal", now + 500);
    await continueReflection(
      db,
      created.id,
      async () => ({
        model: "fixture-model",
        effort: "low",
        result: {
          askedQuestionIds: ["q2"],
          surfacedQuestionIds: ["q3"],
          coachingSelectionNote:
            "Opened with context question q2 on the transition; captured q3 in Takeaways without spoiling q2.",
          message: "What prompted your switch?",
          status: "exploring",
          focus: null,
          checks: {
            approach: {
              status: "open",
              evidence: [],
              recordingEvidence: [],
              assessment: "Pending.",
              uncertainty: "Pending.",
            },
            timeComplexity: {
              status: "open",
              evidence: [],
              recordingEvidence: [],
              assessment: "Pending.",
              uncertainty: "Pending.",
            },
            spaceComplexity: {
              status: "open",
              evidence: [],
              recordingEvidence: [],
              assessment: "Pending.",
              uncertainty: "Pending.",
            },
          },
          evaluation: {
            questionReview: {
              ...structuredClone(review),
              coachNote:
                "Opened with context question q2 on the transition; captured q3 in Takeaways without spoiling q2.",
              turnAskedIds: ["q2"],
              turnSurfacedIds: ["q3"],
            },
            summary: "Exploring transition.",
            strengths: [],
            gaps: [],
            moments: [],
            exercise: {
              skill: "Transfer",
              title: "Transfer",
              prompt: "Prompt",
              rubric: "Rubric",
            },
          },
        },
      }),
      { id: "intake", text: "New to me. O(n) and O(n)." },
    );
    const saved = db.get(created.id);
    const savedReview = saved.evaluations[0].questionReview!;
    const replyId = saved.reflection!.messages.at(-1)!.id;
    assert.deepEqual(
      savedReview.questions.find((q) => q.question.id === "q2")!
        .askedMessageIds,
      [replyId],
    );
    assert.deepEqual(
      savedReview.questions.find((q) => q.question.id === "q3")!
        .surfacedMessageIds,
      [replyId],
    );
    const html = renderToStaticMarkup(
      createElement(QuestionReviewDetails, { review: savedReview }),
    );
    assert.match(html, /Coach selection &amp; insights/);
    assert.match(html, /Opened with context question q2/);
    assert.match(html, /Insights used: q3/);
    assert.match(html, /context question/);
    assert.match(html, /worth sharing/);
    assert.match(html, /Used in coaching/);
  } finally {
    db.db.close();
  }
});

test("persisted questionReviewSchema and snapshots remain compatible when missingEvidence is omitted", async () => {
  const review = await reviewQuestions(reflectionFixture(), runner().run);
  const legacy = structuredClone(review);
  for (const entry of legacy.questions) delete entry.verdict.missingEvidence;
  assert.equal(legacy.questions[0].verdict.missingEvidence, undefined);
  assert.deepEqual(questionReviewSchema.parse(legacy), legacy);
  const html = renderToStaticMarkup(
    createElement(QuestionReviewDetails, { review: legacy }),
  );
  assert.doesNotMatch(html, /missing .* evidence/);

  const db = new AttemptStore(":memory:"),
    sandbox = new AttemptStore(":memory:", true);
  try {
    const now = Date.now() - 2000;
    const a = db.create(demoProblem, 60000, false, now);
    db.transition(a.id, "finish", now + 1000);
    db.transition(a.id, "seal", now + 1000);
    const saved = db.get(a.id);
    saved.reflection = { messages: [], questionReview: legacy };
    db.save(saved);
    const snap = parseSnapshot(
      captureSnapshot(
        db,
        sandbox,
        { settings: null, browser: {}, pagesPreview: null },
        "legacy review checkpoint",
      ),
    );
    assert.deepEqual(
      snap.practice.attempts[0].reflection!.questionReview,
      legacy,
    );
  } finally {
    db.db.close();
    sandbox.db.close();
  }
});
