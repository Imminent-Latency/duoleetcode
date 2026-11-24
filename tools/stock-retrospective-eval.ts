// Isolated retrospective evaluation on the full saved Stock recording & conversation.
// Never opens or mutates live practice data, snapshots, or agent settings.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { resolveAgentChoice } from "../lib/agent-settings";
import {
  readAgentSettings,
  baselineAgentModel,
} from "../lib/agent-settings-store";
import { validateReflection } from "../lib/reflection";
import type { Attempt } from "../lib/types";
import type { QuestionReview } from "../lib/question-review";

if (process.env.DUO_DATABASE !== ":memory:")
  throw Error(
    "Run stock-retrospective-eval with DUO_DATABASE=:memory: and an isolated DUO_TRACE_DATABASE.",
  );

const rawCapture = JSON.parse(
  readFileSync(
    new URL("../.local/stock-conversation-review.json", import.meta.url),
    "utf8",
  ),
) as Attempt;

const originalMessages = structuredClone(rawCapture.reflection?.messages ?? []);
const originalEvaluations = structuredClone(rawCapture.evaluations ?? []);

const checkpoints = [
  {
    name: "opening-after-intake",
    throughIndex: 0,
    originalReplyIndex: 1,
    description:
      "Full 1,185-event recording + 6 Java-help entries + intake message, before any coach reply.",
  },
  {
    name: "after-repair-and-window-pivot",
    throughIndex: 8,
    originalReplyIndex: 9,
    description:
      "After placeholderPrices reuse [2], immediate-return counterexample [4..7], and exhaustive + sliding-window pivot [8].",
  },
  {
    name: "after-exhaustive-baseline",
    throughIndex: 16,
    originalReplyIndex: 17,
    description:
      "After clarifying exhaustive pairs [10..15] and stating O(n^2) time / O(1) space [16].",
  },
  {
    name: "full-completed-conversation",
    throughIndex: 24,
    originalReplyIndex: 25,
    description:
      "Full 25-message transcript through the final O(n log n) vs O(n) single-pass clarification.",
  },
] as const;

const selection = process.argv
  .find((a) => a.startsWith("--checkpoint="))
  ?.slice(13);
const selected = selection
  ? checkpoints.filter((c) => selection.split(",").includes(c.name))
  : checkpoints;
if (!selected.length) throw Error("Unknown checkpoint");

const choice = {
  ...resolveAgentChoice(
    readAgentSettings(),
    "reflection coach",
    baselineAgentModel(),
  ),
  effort: "low",
};

const reportPath =
  process.env.DUO_EVAL_REPORT ?? ".local/stock-retrospective.json";

function summarizeBank(review: QuestionReview) {
  const byDecision: Record<string, number> = {};
  const byDisposition: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  const byMissing: Record<string, number> = {};
  for (const { verdict } of review.questions) {
    byDecision[verdict.decision] = (byDecision[verdict.decision] ?? 0) + 1;
    byDisposition[verdict.disposition] =
      (byDisposition[verdict.disposition] ?? 0) + 1;
    const role = verdict.coachingRole ?? "unspecified";
    byRole[role] = (byRole[role] ?? 0) + 1;
    const missing = verdict.missingEvidence ?? "unspecified";
    byMissing[missing] = (byMissing[missing] ?? 0) + 1;
  }
  return {
    revision: review.revision,
    totalQuestions: review.questions.length,
    coverageComplete: review.coverageComplete,
    byDecision,
    byDisposition,
    byRole,
    byMissing,
    coachNote: review.coachNote,
    turnAskedIds: review.turnAskedIds,
    turnSurfacedIds: review.turnSurfacedIds,
    askUserQuestions: review.questions
      .filter((q) => q.verdict.disposition === "ask-user")
      .map((q) => ({
        id: q.question.id,
        role: q.verdict.coachingRole,
        question: q.question.question,
        uncertainty: q.verdict.uncertainty,
      })),
    worthSharingFindings: review.questions
      .filter((q) => q.verdict.coachingRole === "worth-sharing")
      .map((q) => ({
        id: q.question.id,
        topic: q.question.topic,
        question: q.question.question,
        answer: q.verdict.answer,
        surfaced: review.turnSurfacedIds?.includes(q.question.id) ?? false,
      })),
  };
}

const results: any[] = [];
let carriedReview: QuestionReview | undefined;
const carriedEvaluations: Attempt["evaluations"] = [];

try {
  for (const cp of selected) {
    const attempt = structuredClone(rawCapture);
    attempt.phase = "review";
    attempt.sealed = true;
    attempt.evaluations = structuredClone(carriedEvaluations);
    attempt.reflection = {
      ...attempt.reflection,
      messages: structuredClone(originalMessages.slice(0, cp.throughIndex + 1)),
      analysis: undefined,
      questionReview: carriedReview ? structuredClone(carriedReview) : undefined,
    };

    const started = Date.now();
    const out = await reflect(attempt, choice, "conversation");
    const elapsedMs = Date.now() - started;
    validateReflection(attempt, out.result);

    const review = out.result.evaluation.questionReview!;
    assert.ok(review, "Expected questionReview on evaluation");
    carriedReview = structuredClone(review);
    carriedEvaluations.push({
      ...structuredClone(out.result.evaluation),
      model: out.model,
      effort: out.effort,
      research: out.research,
      version: "retrospective",
      createdAt: Date.now(),
      evidenceThrough: attempt.lastSeq,
    });

    const originalReply = originalMessages[cp.originalReplyIndex];
    const summary = summarizeBank(review);
    const entry = {
      checkpoint: cp.name,
      description: cp.description,
      elapsedMs,
      model: out.model,
      effort: out.effort,
      status: out.result.status,
      askedQuestionIds: out.result.askedQuestionIds,
      surfacedQuestionIds: out.result.surfacedQuestionIds,
      coachingSelectionNote: out.result.coachingSelectionNote,
      message: out.result.message,
      originalCoachMessage: originalReply?.text ?? null,
      focus: out.result.focus,
      checks: out.result.checks,
      bankSummary: summary,
      evaluation: out.result.evaluation,
    };
    results.push(entry);
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          attemptId: rawCapture.id,
          eventsCount: rawCapture.events.length,
          javaHelpCount: rawCapture.javaHelp?.length ?? 0,
          originalMessagesCount: originalMessages.length,
          originalEvaluationsCount: originalEvaluations.length,
          checkpoints: results,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        checkpoint: cp.name,
        elapsedMs,
        status: out.result.status,
        askedQuestionIds: out.result.askedQuestionIds,
        surfacedQuestionIds: out.result.surfacedQuestionIds,
        coachingSelectionNote: out.result.coachingSelectionNote,
        totalQuestions: summary.totalQuestions,
        byRole: summary.byRole,
      }),
    );
  }
} finally {
  agent().close();
}
