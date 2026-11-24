import { test } from "node:test";
import assert from "node:assert/strict";
import { POST as agentAction } from "../app/api/agent/route";
import { POST as change, GET as read } from "../app/api/attempts/[id]/route";
import { agent } from "../lib/agents";
import { store } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { reviewTopics } from "../lib/question-review";
process.env.DUO_DATABASE = ":memory:";
const request = (body: unknown) =>
  new Request("http://127.0.0.1:4318/api/agent", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4318",
      origin: "http://127.0.0.1:4318",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("reflection API prepares privately, requires intake before chat, and allows skip/reopen", async () => {
  const db = store(),
    a = db.create(demoProblem, 60000, true),
    ctx = { params: Promise.resolve({ id: a.id }) };
  assert.equal(
    (await agentAction(request({ action: "reflect", id: a.id }))).status,
    400,
  );
  db.transition(a.id, "finish");
  const runtime = agent(),
    run = runtime.run;
  let calls = 0;
  runtime.run = async (
    _role,
    _instructions,
    input,
    _schema,
    _attempt,
    choice,
    options,
  ) => {
    if (options?.traceKind?.startsWith("question-")) {
      const refs = {
        sequences: [0],
        learner: [],
        assistanceIds: [],
        sourceUrls: [],
      };
      const question = {
        id: "behavior",
        topic: "correctness",
        kind: "behavior",
        question: "What does the source establish?",
        purpose: "Check the source.",
        priority: "high",
        anchors: refs,
      };
      const answer = {
        questionId: "behavior",
        classification: "unresolved",
        answer: "Needs explanation.",
        justification: "Only a starter is present.",
        supporting: refs,
        conflicting: { ...refs, sequences: [] },
        alternatives: [],
        uncertainty: "Intended behavior needs context.",
      };
      const coverage = reviewTopics.map((topic) => ({
        topic,
        questionIds: ["behavior"],
        rationale: "Considered evidence.",
      }));
      const context = input as any;
      const value =
        options.traceKind === "question-generation"
          ? {
              questions: context.previous ? [] : [question],
              refreshIds: context.previous ? ["behavior"] : [],
              coverage,
            }
          : options.traceKind === "question-analysis"
            ? { answers: [answer] }
            : {
                verdicts: [
                  {
                    ...answer,
                    decision: "accept",
                    missingEvidence: "none",
                    coachingRole: "blocking-question",
                    disposition: "ask-user",
                  },
                ],
                refreshIds: [],
                missingQuestions: [],
                coverage,
                coverageComplete: true,
                limitations: [],
              };
      options.validateOutput?.(value);
      return {
        threadId: "question-test",
        model: choice?.model ?? "test",
        effort: choice?.effort ?? "low",
        value,
      };
    }
    calls++;
    const context = input as {
      stage: string;
      conversation: unknown[];
      initialReflection?: { spaceComplexity: string };
      questionReview?: unknown;
    };
    assert.equal(context.stage, "conversation");
    assert.equal(context.initialReflection?.spaceComplexity, "O(n)");
    assert.ok(context.questionReview);
    return {
      threadId: "test",
      model: "test",
      value: {
        askedQuestionIds: ["behavior"],
        surfacedQuestionIds: ["behavior"],
        coachingSelectionNote:
          "Ask for complexity on the recorded approach while crediting observed behavior.",
        message:
          "What is the time and auxiliary space complexity of your approach?",
        status: "exploring",
        focus: {
          startSeq: 0,
          endSeq: 0,
          mode: "snapshot",
          label: "Final solution",
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
          summary: "Explanation is still open.",
          strengths: [],
          gaps: [],
          moments: [],
          exercise: {
            skill: "Transfer",
            title: "Transfer",
            prompt: "Explain an alternative.",
            rubric: "Do not disclose this rubric",
          },
        },
      },
    };
  };
  try {
    assert.equal(
      (await agentAction(request({ action: "prepare", id: a.id }))).status,
      200,
    );
    assert.equal(
      (await agentAction(request({ action: "prepare", id: a.id }))).status,
      200,
    );
    assert.equal(calls, 0, "Pre-intake prepare runs reusable question review without a throwaway coach call");
    const response = await read(
      new Request("http://127.0.0.1:4318/api/attempts/" + a.id, {
        headers: { host: "127.0.0.1:4318" },
      }),
      ctx,
    );
    const body = await response.json();
    assert.equal(body.attempt.reflection.messages.length, 0);
    assert.equal(body.attempt.reflection.analysisReady, true);
    assert.equal(body.attempt.reflection.analysis, undefined);
    assert.equal(body.attempt.reflection.questionReview, undefined);
    assert.equal(body.attempt.evaluations.length, 0);
    assert.equal(
      (await agentAction(request({ action: "reflect", id: a.id }))).status,
      400,
    );
    const answers = {
      id: crypto.randomUUID(),
      familiarity: "solved",
      spaceComplexity: "O(n)",
      timeComplexity: "O(n)",
    };
    assert.equal(
      (
        await change(
          request({
            action: "reflection-intake",
            answers: { ...answers, spaceComplexity: " " },
          }),
          ctx,
        )
      ).status,
      400,
    );
    assert.equal(
      (await change(request({ action: "reflection-intake", answers }), ctx))
        .status,
      200,
    );
    assert.equal(
      (await agentAction(request({ action: "reflect", id: a.id }))).status,
      200,
    );
    assert.equal(calls, 1);
    assert.equal(db.get(a.id).reflection?.messages.length, 2);
    const reviewed = db.get(a.id);
    assert.deepEqual(
      reviewed.evaluations[0].questionReview!.questions[0].askedMessageIds,
      [reviewed.reflection!.messages[1].id],
    );
    const withReply = await read(
      new Request("http://127.0.0.1:4318/api/attempts/" + a.id, {
        headers: { host: "127.0.0.1:4318" },
      }),
      ctx,
    );
    assert.equal(
      (await withReply.json()).attempt.evaluations[0].exercise.rubric,
      undefined,
    );
    assert.equal(
      (await change(request({ action: "complete", reason: "sufficient" }), ctx))
        .status,
      400,
    );
    assert.equal(
      (await change(request({ action: "complete", reason: "skipped" }), ctx))
        .status,
      200,
    );
    assert.equal(
      (await change(request({ action: "reflect" }), ctx)).status,
      200,
    );
    assert.equal(db.get(a.id).phase, "review");
    assert.equal(db.get(a.id).previousLearningExits?.[0].reason, "skipped");
    assert.equal(
      (
        await agentAction(
          request({
            action: "reflect",
            id: a.id,
            message: {
              id: crypto.randomUUID(),
              text: "What about this?",
              focus: {
                startSeq: 999,
                endSeq: 999,
                mode: "snapshot",
                label: "invalid",
              },
            },
          }),
        )
      ).status,
      400,
    );
  } finally {
    runtime.run = run;
  }
});
