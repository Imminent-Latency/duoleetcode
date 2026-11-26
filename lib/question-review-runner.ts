import { z } from "zod";
import { traceHash, traced, currentTrace } from "./agent-traces";
import type { Attempt } from "./types";
import type { ResearchBundle } from "./research-types";
import { timedEvidence, pauseMetadata } from "./assessment-time";
import { implementationEvidence } from "./implementation-evidence";
import { referenceEvidence } from "./java-help";
import {
  questionReviewVersion,
  reviewTopics,
  questionPlanSchema,
  questionAnswersSchema,
  questionJudgmentOutputSchema,
  reviewedQuestions,
  questionReviewSchema,
  type QuestionReview,
  type QuestionRefs,
  type QuestionAnswer,
  type ReviewQuestion,
} from "./question-review";
import {
  questionGeneratorPolicy,
  questionAnalystPolicy,
  questionJudgePolicy,
} from "./question-review-policy";
import {
  compactNotebookContext,
  type ReflectionNotebook,
} from "./reflection-notebook";

export type ReviewStage =
  "question-generation" | "question-analysis" | "question-judgment";
export type ReviewStageResult = {
  value: unknown;
  model: string;
  effort?: string;
  traceId?: string;
  research?: ResearchBundle;
  retrievedEvidence?: { receipts: unknown[] };
};
export type ReviewStageRunner = (
  stage: ReviewStage,
  policy: string,
  input: unknown,
  schema: unknown,
  validate: (value: unknown) => void,
  stageOpts?: { notebook?: ReflectionNotebook; branchId?: string },
) => Promise<ReviewStageResult>;

export function latestQuestionReview(a: Attempt) {
  return (
    a.reflection?.questionReview ??
    a.evaluations.findLast((e) => e.questionReview)?.questionReview ??
    a.reflection?.analysis?.questionReview
  );
}
export function validateQuestionRefs(
  a: Attempt,
  refs: QuestionRefs,
  urls?: Set<string>,
) {
  const seqs = new Set([0, ...a.events.map((e) => e.seq)]);
  if (refs.sequences.some((s) => !seqs.has(s)))
    throw Error("Question review cited an unknown recorded event.");
  for (const c of refs.learner)
    if (
      !a.reflection?.messages.some(
        (m) =>
          m.role === "user" && m.id === c.messageId && m.text.includes(c.quote),
      ) &&
      !a.javaHelp?.some(
        (h) => h.id === c.messageId && h.question.includes(c.quote),
      )
    )
      throw Error("Question review cited missing or non-learner evidence.");
  if (refs.assistanceIds.some((id) => !a.javaHelp?.some((h) => h.id === id)))
    throw Error("Question review cited unknown assistance.");
  if (urls && refs.sourceUrls.some((url) => !urls.has(url)))
    throw Error("Question review cited a source without a retrieval receipt.");
}
function hasEvidence(r: QuestionRefs) {
  return (
    r.sequences.length +
      r.learner.length +
      r.assistanceIds.length +
      r.sourceUrls.length >
    0
  );
}
export function validateQuestionAnswer(
  a: Attempt,
  q: ReviewQuestion,
  answer: QuestionAnswer,
  urls?: Set<string>,
) {
  if (q.id !== answer.questionId)
    throw Error("Question answer does not match its assigned question.");
  validateQuestionRefs(a, answer.supporting, urls);
  validateQuestionRefs(a, answer.conflicting, urls);
  if (
    ["observed", "supported-inference"].includes(answer.classification) &&
    !hasEvidence(answer.supporting)
  )
    throw Error("An observed or inferred answer needs supporting evidence.");
  if (
    ["plausible", "unresolved"].includes(answer.classification) &&
    !answer.uncertainty
  )
    throw Error("A provisional answer must state its uncertainty.");
  if (
    q.kind === "intent" &&
    answer.classification === "observed" &&
    !answer.supporting.learner.length
  )
    throw Error("Observed learner intent requires the learner's own evidence.");
}
function exactIds(actual: string[], expected: string[], label: string) {
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    expected.some((id) => !actual.includes(id))
  )
    throw Error(`${label} must cover exactly the assigned IDs, once each.`);
}
function validateCoverage(
  coverage: z.infer<typeof questionPlanSchema>["coverage"],
  ids: Set<string>,
) {
  exactIds(
    coverage.map((c) => c.topic),
    [...reviewTopics],
    "Coverage",
  );
  if (coverage.some((c) => c.questionIds.some((id) => !ids.has(id))))
    throw Error("Coverage refers to a missing question.");
}
export function questionInventory(a: Attempt) {
  return {
    problem: a.problem,
    finalSource: a.source,
    lastSeq: a.lastSeq,
    events: timedEvidence(a).map(({ edits, ...e }) => ({
      ...e,
      removed: edits?.reduce((n, c) => n + c.length, 0),
      inserted: edits?.reduce((n, c) => n + c.text.length, 0),
    })),
    implementation: implementationEvidence(a),
    jobs: a.jobs,
    annotations: a.annotations,
    javaAssistance: referenceEvidence(a),
    solvingChunks: a.solvingChunks ?? [],
    timing: {
      basis:
        "Active solving time; pauses are context, never inactivity or skill evidence.",
      pauses: pauseMetadata(a),
    },
    intake: a.reflection?.intake,
    conversation: a.reflection?.messages ?? [],
    optimizationDeferredAt: a.reflection?.optimizationDeferredAt,
  };
}

export function questionRecordingHash(a: Attempt) {
  const { conversation: _c, intake: _i, optimizationDeferredAt: _o, ...recording } =
    questionInventory(a);
  return traceHash({
    recording,
    policies: [
      questionGeneratorPolicy,
      questionAnalystPolicy,
      questionJudgePolicy,
    ],
  });
}

export async function reviewQuestions(
  a: Attempt,
  run: ReviewStageRunner,
  choice?: { model: string; effort: string },
  options?: { notebook?: ReflectionNotebook },
): Promise<QuestionReview> {
  const inventory = questionInventory(a);
  const { conversation, intake, optimizationDeferredAt, ...recording } =
    inventory;
  const recordingHash = traceHash({
    recording,
    policies: [
      questionGeneratorPolicy,
      questionAnalystPolicy,
      questionJudgePolicy,
    ],
  });
  const inputHash = traceHash({
    version: questionReviewVersion,
    inventory,
    choice,
    recordingHash,
  });
  const saved = latestQuestionReview(a);
  // Only immutable matching evidence can reuse an earlier reviewed bank.
  if (saved?.version === questionReviewVersion && saved.inputHash === inputHash)
    return structuredClone(saved);
  const previous =
    saved?.version === questionReviewVersion &&
    saved.recordingHash === recordingHash &&
    (!choice ||
      (saved.model === choice.model && saved.effort === choice.effort))
      ? saved
      : undefined;
  return traced(
    {
      role: "reflection coach",
      kind: "question-review",
      attemptId: a.id,
      ...(a.demonstration ? { mode: "test" as const } : {}),
    },
    async (trace) => {
      const revision = (saved?.revision ?? 0) + 1;
      const entries = new Map(
        (previous?.questions ?? []).map((e) => [
          e.question.id,
          structuredClone(e),
        ]),
      );
      const questions = new Map(
        [...entries].map(([id, e]) => [id, e.question]),
      );
      const nb = options?.notebook;
      const genInventory = nb
        ? {
            problem: inventory.problem,
            finalSource: inventory.finalSource,
            lastSeq: inventory.lastSeq,
            implementation: inventory.implementation,
            jobs: inventory.jobs,
            annotations: inventory.annotations,
            timing: inventory.timing,
            intake: inventory.intake,
            conversation: inventory.conversation,
            optimizationDeferredAt: inventory.optimizationDeferredAt,
            ...compactNotebookContext(a, nb),
          }
        : inventory;
      const planResult = await run(
        "question-generation",
        questionGeneratorPolicy,
        {
          topics: reviewTopics,
          inventory: genInventory,
          previous: reviewedQuestions(previous),
          newMessages: conversation.filter(
            (m) => !previous?.throughMessageIds.includes(m.id),
          ),
          remainingQuestionBudget: 48 - questions.size,
        },
        z.toJSONSchema(
          questionPlanSchema.extend({
            refreshIds: questions.size
              ? z
                  .array(z.enum([...questions.keys()] as [string, ...string[]]))
                  .max(48)
              : z.array(z.string()).max(0),
          }),
        ),
        (value) => {
          const p = questionPlanSchema.parse(value);
          const ids = new Set(questions.keys());
          for (const q of p.questions) {
            if (ids.has(q.id))
              throw Error(
                `Question ID "${q.id}" already exists; omit existing questions from questions[] and list "${q.id}" only in refreshIds.`,
              );
            ids.add(q.id);
            validateQuestionRefs(a, q.anchors, new Set());
          }
          if (ids.size > 48 || !ids.size)
            throw Error("Question budget is 1–48 distinct questions.");
          if (
            new Set(p.refreshIds).size !== p.refreshIds.length ||
            p.refreshIds.some((id) => !questions.has(id))
          )
            throw Error(
              "Refresh IDs must identify existing questions once each.",
            );
          validateCoverage(p.coverage, ids);
        },
        nb ? { notebook: nb } : undefined,
      );
      const plan = questionPlanSchema.parse(planResult.value);
      for (const q of plan.questions) questions.set(q.id, q);
      let pending = [...plan.questions.map((q) => q.id), ...plan.refreshIds];
      let coverage = plan.coverage;
      let coverageComplete = false;
      let limitations: string[] = [];
      const stageEvidence: ReviewStageResult[] = [planResult];
      let lastModel = planResult.model,
        lastEffort = planResult.effort ?? "low";
      // The judge can add overlooked questions and request one further evidence pass.
      // The second pass never loops indefinitely: remaining uncertainty is retained.
      for (let round = 0; round < 2; round++) {
        const candidates = new Map<
          string,
          { answer: QuestionAnswer; result: ReviewStageResult }
        >();
        const groups: ReviewQuestion[][] = [];
        for (let i = 0; i < pending.length; i += 4)
          groups.push(pending.slice(i, i + 4).map((id) => questions.get(id)!));
        for (let i = 0; i < groups.length; i += 2) {
          const batch = groups.slice(i, i + 2);
          const branches = nb
            ? await Promise.all(
                batch.map((_, offset) =>
                  nb.fork(
                    "question-analysis",
                    `r${round + 1}-b${i + offset + 1}`,
                  ),
                ),
              )
            : [];
          try {
            const results = await Promise.allSettled(
              batch.map(async (group, offset) => {
                const branch = branches[offset];
                const seqs = new Set(group.flatMap((q) => q.anchors.sequences));
                const helpIds = new Set(
                  group.flatMap((q) => q.anchors.assistanceIds),
                );
                const focusedAssistance = inventory.javaAssistance
                  .filter((h) => helpIds.has(h.id))
                  .map((h) =>
                    branch
                      ? (({ research: _r, ...rest }) => rest)(h)
                      : h,
                  );
                const analystInventory = branch
                  ? {
                      ...compactNotebookContext(a, branch),
                      jobs: a.jobs,
                      timing: inventory.timing,
                      assistanceLinks: inventory.implementation.assistanceLinks,
                      allAssistanceQuestions: inventory.javaAssistance.map(
                        (h) => ({ id: h.id, question: h.question }),
                      ),
                      availableCheckpointSequences:
                        inventory.implementation.checkpoints.map((p) => p.seq),
                    }
                  : {
                      events: inventory.events,
                      jobs: a.jobs,
                      timing: inventory.timing,
                      assistanceLinks: inventory.implementation.assistanceLinks,
                      allAssistanceQuestions: inventory.javaAssistance.map(
                        (h) => ({ id: h.id, question: h.question }),
                      ),
                      availableCheckpointSequences:
                        inventory.implementation.checkpoints.map((p) => p.seq),
                      solvingChunks: inventory.solvingChunks,
                    };
                const result = await run(
                  "question-analysis",
                  questionAnalystPolicy,
                  {
                    questions: group,
                    focusedEvidence: {
                      finalSource: a.source,
                      problem: a.problem,
                      intake,
                      conversation,
                      checkpoints: inventory.implementation.checkpoints.filter(
                        (p) => seqs.has(p.seq),
                      ),
                      assistance: focusedAssistance,
                      annotations: a.annotations,
                    },
                    inventory: analystInventory,
                    additionalEvidencePass: round > 0,
                  },
                  z.toJSONSchema(questionAnswersSchema),
                  (value) => {
                    const parsed = questionAnswersSchema.parse(value);
                    exactIds(
                      parsed.answers.map((x) => x.questionId),
                      group.map((q) => q.id),
                      "Answers",
                    );
                    for (const answer of parsed.answers)
                      validateQuestionAnswer(
                        a,
                        questions.get(answer.questionId)!,
                        answer,
                      );
                  },
                  branch
                    ? { notebook: branch, branchId: `r${round + 1}-b${i + offset + 1}` }
                    : undefined,
                );
                const parsed = questionAnswersSchema.parse(result.value);
                const urls = new Set([
                  ...(a.solvingChunks ?? []).flatMap(
                    (c) => c.sources?.map((s) => s.url) ?? [],
                  ),
                  ...(result.research?.sources.map((s) => s.url) ?? []),
                ]);
                for (const answer of parsed.answers)
                  validateQuestionAnswer(
                    a,
                    questions.get(answer.questionId)!,
                    answer,
                    urls,
                  );
                return { parsed, result };
              }),
            );
            for (const branch of branches) nb?.mergeBranch(branch);
            // Wait for siblings before throwing so diagnostics don't keep orphan work running.
            for (const result of results) {
              if (result.status === "rejected") throw result.reason;
              stageEvidence.push(result.value.result);
              for (const answer of result.value.parsed.answers)
                candidates.set(answer.questionId, {
                  answer,
                  result: result.value.result,
                });
            }
          } finally {
            await Promise.all(branches.map((b) => b.close()));
          }
        }
        const judgeBranch = nb
          ? await nb.fork("question-judgment", `r${round + 1}-judge`)
          : undefined;
        let judged: ReviewStageResult;
        try {
          const judgeInventory = judgeBranch
            ? {
                problem: inventory.problem,
                finalSource: inventory.finalSource,
                lastSeq: inventory.lastSeq,
                implementation: inventory.implementation,
                jobs: inventory.jobs,
                annotations: inventory.annotations,
                timing: inventory.timing,
                intake: inventory.intake,
                conversation: inventory.conversation,
                optimizationDeferredAt: inventory.optimizationDeferredAt,
                ...compactNotebookContext(a, judgeBranch),
              }
            : inventory;
          judged = await run(
            "question-judgment",
            questionJudgePolicy,
            {
              topics: reviewTopics,
              inventory: judgeInventory,
              questions: [...questions.values()],
              reviewIds: pending,
              candidates: [...candidates.values()].map(({ answer }) => answer),
              previousReviewed: reviewedQuestions(previous),
              currentReviewed: [...entries.values()].map(
                ({ question, verdict }) => ({ question, verdict }),
              ),
              coverage,
              evidence: stageEvidence.map((r) => ({
                traceId: r.traceId,
                research: r.research,
                retrievedEvidence: r.retrievedEvidence,
              })),
              remainingQuestionBudget: 48 - questions.size,
              finalCoveragePass: round === 1,
            },
            z.toJSONSchema(questionJudgmentOutputSchema),
            (value) => {
              const parsed = questionJudgmentOutputSchema.parse(value);
              if (
                new Set(parsed.refreshIds).size !== parsed.refreshIds.length ||
                parsed.refreshIds.some(
                  (id) => !entries.has(id) || pending.includes(id),
                )
              )
                throw Error(
                  "Judge refresh IDs must be existing questions outside the current review batch.",
                );
              exactIds(
                parsed.verdicts.map((v) => v.questionId),
                pending,
                "Judgments",
              );
              const ids = new Set(questions.keys());
              for (const q of parsed.missingQuestions) {
                if (ids.has(q.id))
                  throw Error("A missing question must have a new distinct ID.");
                ids.add(q.id);
                validateQuestionRefs(a, q.anchors, new Set());
              }
              if (ids.size > 48)
                throw Error(
                  "Question budget exceeded; report omitted scope in limitations.",
                );
              validateCoverage(parsed.coverage, ids);
              if (
                (parsed.missingQuestions.length || parsed.refreshIds.length) &&
                parsed.coverageComplete
              )
                throw Error(
                  "Coverage cannot be complete while material questions are missing.",
                );
              for (const v of parsed.verdicts) {
                const q = questions.get(v.questionId)!;
                validateQuestionAnswer(a, q, v);
                if (
                  ["reject", "needs-evidence"].includes(v.decision) &&
                  v.disposition === "resolved-internally"
                )
                  throw Error(
                    "An unverified answer cannot be resolved internally.",
                  );
                if (
                  v.decision === "needs-evidence" &&
                  v.missingEvidence === "none"
                )
                  throw Error(
                    "A needs-evidence verdict must identify the missing evidence.",
                  );
                if (v.decision === "accept" && v.missingEvidence !== "none")
                  throw Error(
                    "An accepted verdict cannot report blocking missing evidence.",
                  );
                if (
                  q.kind === "technical" &&
                  v.missingEvidence === "learner"
                )
                  throw Error(
                    "Technical questions cannot depend on unstated learner evidence.",
                  );
                if (
                  v.disposition === "ask-user" &&
                  (q.kind === "technical" ||
                    v.missingEvidence === "recording" ||
                    v.missingEvidence === "technical")
                )
                  throw Error(
                    "Research recording and technical uncertainty; do not ask the learner to settle it.",
                  );
                if (
                  (v.disposition === "superseded") !==
                  (v.coachingRole === "superseded")
                )
                  throw Error(
                    "coachingRole=superseded must match disposition=superseded.",
                  );
                if (
                  v.disposition === "resolved-internally" &&
                  !["worth-sharing", "background"].includes(v.coachingRole)
                )
                  throw Error(
                    "Resolved internal findings must use coachingRole worth-sharing or background.",
                  );
                if (
                  v.coachingRole === "worth-sharing" &&
                  (v.disposition !== "resolved-internally" ||
                    !["accept", "qualify"].includes(v.decision))
                )
                  throw Error(
                    "Only verified resolved-internally findings can be marked worth-sharing.",
                  );
                if (
                  v.disposition === "ask-user" &&
                  !["blocking-question", "context-question"].includes(
                    v.coachingRole,
                  )
                )
                  throw Error(
                    "ask-user verdicts must use coachingRole blocking-question or context-question.",
                  );
                if (
                  ["blocking-question", "context-question"].includes(
                    v.coachingRole,
                  ) &&
                  v.disposition !== "ask-user"
                )
                  throw Error(
                    "blocking-question and context-question require disposition=ask-user.",
                  );
                if (
                  v.disposition === "deferred" &&
                  v.coachingRole !== "background"
                )
                  throw Error(
                    "Deferred verdicts must use coachingRole=background.",
                  );
              }
            },
            judgeBranch
              ? { notebook: judgeBranch, branchId: `r${round + 1}-judge` }
              : undefined,
          );
          if (judgeBranch) nb?.mergeBranch(judgeBranch);
        } finally {
          await judgeBranch?.close();
        }
        stageEvidence.push(judged);
        const judgment = questionJudgmentOutputSchema.parse(judged.value);
        const urls = new Set([
          ...(a.solvingChunks ?? []).flatMap(
            (c) => c.sources?.map((s) => s.url) ?? [],
          ),
          ...stageEvidence.flatMap(
            (r) => r.research?.sources.map((s) => s.url) ?? [],
          ),
        ]);
        for (const verdict of judgment.verdicts) {
          const question = questions.get(verdict.questionId)!;
          validateQuestionAnswer(a, question, verdict, urls);
          entries.set(question.id, {
            question,
            candidate: candidates.get(question.id)!.answer,
            verdict,
            updatedRevision: revision,
            askedMessageIds: entries.get(question.id)?.askedMessageIds ?? [],
            surfacedMessageIds:
              entries.get(question.id)?.surfacedMessageIds ?? [],
            analystTraceId: candidates.get(question.id)?.result.traceId,
            judgeTraceId: judged.traceId,
          });
        }
        coverage = judgment.coverage;
        coverageComplete = judgment.coverageComplete;
        limitations = judgment.limitations;
        lastModel = judged.model;
        lastEffort = judged.effort ?? "low";
        trace.event("questions.coverage", { round: round + 1, ...judgment });
        if (round === 1) {
          for (const id of judgment.refreshIds) {
            const entry = entries.get(id)!;
            entry.verdict = {
              ...entry.verdict,
              decision: "needs-evidence",
              missingEvidence:
                entry.question.kind === "technical" ? "technical" : "recording",
              coachingRole: "background",
              classification: "unresolved",
              disposition: "deferred",
              answer:
                "A fresh evidence review is needed before reusing the earlier finding.",
              uncertainty: "The coverage judge requested renewed verification.",
              justification:
                "New evidence may affect this finding; the earlier verdict is retained in previous revisions.",
            };
            entry.updatedRevision = revision;
          }
          // Preserve uninvestigated questions explicitly without promoting an answer.
          for (const question of judgment.missingQuestions) {
            const empty = {
              sequences: [],
              learner: [],
              assistanceIds: [],
              sourceUrls: [],
            };
            const candidate: QuestionAnswer = {
              questionId: question.id,
              classification: "unresolved",
              answer:
                "Not investigated within this review's bounded evidence passes.",
              justification: question.purpose,
              supporting: empty,
              conflicting: empty,
              alternatives: [],
              uncertainty: "Further evidence review is needed.",
            };
            entries.set(question.id, {
              question,
              candidate,
              verdict: {
                ...candidate,
                decision: "needs-evidence",
                missingEvidence:
                  question.kind === "technical" ? "technical" : "recording",
                coachingRole: "background",
                disposition: "deferred",
              },
              updatedRevision: revision,
              askedMessageIds: [],
              surfacedMessageIds: [],
            });
          }
          if (judgment.missingQuestions.length)
            limitations.push(
              "Additional material questions were retained for a later review; coverage is incomplete.",
            );
          break;
        }
        for (const q of judgment.missingQuestions) questions.set(q.id, q);
        pending = [
          ...judgment.refreshIds,
          ...judgment.missingQuestions.map((q) => q.id),
          ...judgment.verdicts
            .filter(
              (v) =>
                v.decision === "needs-evidence" &&
                (v.missingEvidence === "recording" ||
                  v.missingEvidence === "technical"),
            )
            .map((v) => v.questionId),
        ];
        if (!pending.length) break;
      }
      const review: QuestionReview = {
        version: questionReviewVersion,
        revision,
        inputHash,
        recordingHash,
        throughMessageIds: conversation.map((m) => m.id),
        createdAt: Date.now(),
        model: lastModel,
        effort: lastEffort,
        traceId: trace.id,
        sources: [
          ...new Map(
            [
              ...(previous?.sources ?? []),
              ...(a.solvingChunks ?? []).flatMap((c) => c.sources ?? []),
              ...stageEvidence.flatMap((r) => r.research?.sources ?? []),
            ].map((s) => [`${s.url}:${s.digest}`, s]),
          ).values(),
        ],
        coverageComplete,
        coverage,
        limitations,
        questions: [...entries.values()],
      };
      questionReviewSchema.parse(review);
      trace.event("questions.review", review);
      currentTrace()?.update({ model: lastModel, effort: lastEffort });
      return review;
    },
  );
}
