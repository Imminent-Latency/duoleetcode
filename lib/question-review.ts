import { z } from "zod";

export const questionReviewVersion = "question-evidence-1" as const;
export const reviewTopics = [
  "correctness",
  "approach-evolution",
  "intent",
  "complexity",
  "assistance",
  "understanding",
  "strengths",
  "next-steps",
] as const;
const text = z.string().trim().min(1).max(1800);
const id = z.string().trim().min(1).max(100);
export const questionRefsSchema = z.object({
  sequences: z.array(z.number().int().nonnegative()).max(12),
  learner: z.array(z.object({ messageId: id, quote: text })).max(8),
  assistanceIds: z.array(id).max(8),
  // Provider strict schemas do not support format=uri; receipts validate URLs.
  sourceUrls: z.array(z.string().min(1).max(2000)).max(8),
});
export const reviewQuestionSchema = z.object({
  id,
  topic: z.enum(reviewTopics),
  kind: z.enum(["behavior", "intent", "understanding", "technical"]),
  question: text,
  purpose: text,
  priority: z.enum(["high", "medium", "low"]),
  anchors: questionRefsSchema.extend({
    sourceUrls: z.array(z.string()).max(0),
  }),
});
export const reviewCoverageSchema = z.object({
  topic: z.enum(reviewTopics),
  questionIds: z.array(id).max(48),
  rationale: text,
});
export const questionPlanSchema = z.object({
  questions: z.array(reviewQuestionSchema).max(24),
  refreshIds: z.array(id).max(48),
  coverage: z.array(reviewCoverageSchema).length(reviewTopics.length),
});
export const questionAnswerSchema = z.object({
  questionId: id,
  classification: z.enum([
    "observed",
    "supported-inference",
    "plausible",
    "unresolved",
    "contradicted",
  ]),
  answer: text,
  justification: text,
  supporting: questionRefsSchema,
  conflicting: questionRefsSchema,
  alternatives: z.array(text).max(4),
  uncertainty: text.nullable(),
});
export const questionAnswersSchema = z.object({
  answers: z.array(questionAnswerSchema).min(1).max(4),
});
export const missingEvidenceSchema = z.enum([
  "none",
  "recording",
  "technical",
  "learner",
]);
export const coachingRoleSchema = z.enum([
  "blocking-question",
  "context-question",
  "worth-sharing",
  "background",
  "superseded",
]);
export const questionVerdictSchema = questionAnswerSchema.extend({
  decision: z.enum(["accept", "qualify", "reject", "needs-evidence"]),
  missingEvidence: missingEvidenceSchema.optional(),
  coachingRole: coachingRoleSchema.optional(),
  disposition: z.enum([
    "resolved-internally",
    "ask-user",
    "deferred",
    "superseded",
  ]),
});
export const questionVerdictOutputSchema = questionVerdictSchema.extend({
  missingEvidence: missingEvidenceSchema,
  coachingRole: coachingRoleSchema,
});
export const questionJudgmentSchema = z.object({
  refreshIds: z.array(id).max(12),
  verdicts: z.array(questionVerdictSchema).max(48),
  coverage: z.array(reviewCoverageSchema).length(reviewTopics.length),
  missingQuestions: z.array(reviewQuestionSchema).max(6),
  coverageComplete: z.boolean(),
  limitations: z.array(text).max(8),
});
export const questionJudgmentOutputSchema = questionJudgmentSchema.extend({
  verdicts: z.array(questionVerdictOutputSchema).max(48),
});
export const questionReviewSchema = z.object({
  version: z.literal(questionReviewVersion),
  revision: z.number().int().positive(),
  inputHash: z.string(),
  recordingHash: z.string(),
  throughMessageIds: z.array(id),
  createdAt: z.number(),
  model: z.string(),
  effort: z.string(),
  traceId: z.string().optional(),
  coachNote: z.string().trim().min(1).max(400).optional(),
  turnAskedIds: z.array(id).max(4).optional(),
  turnSurfacedIds: z.array(id).max(6).optional(),
  sources: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        kind: z.enum(["official-docs", "official-source", "secondary"]),
        version: z.string(),
        retrievedAt: z.number(),
        excerpt: z.string(),
        digest: z.string(),
      }),
    )
    .optional(),
  coverageComplete: z.boolean(),
  coverage: z.array(reviewCoverageSchema),
  limitations: z.array(text),
  questions: z
    .array(
      z.object({
        question: reviewQuestionSchema,
        candidate: questionAnswerSchema,
        verdict: questionVerdictSchema,
        updatedRevision: z.number().int().positive(),
        askedMessageIds: z.array(id),
        surfacedMessageIds: z.array(id).optional(),
        analystTraceId: z.string().optional(),
        judgeTraceId: z.string().optional(),
      }),
    )
    .max(48),
});
export type QuestionReview = z.infer<typeof questionReviewSchema>;
export type ReviewQuestion = z.infer<typeof reviewQuestionSchema>;
export type QuestionRefs = z.infer<typeof questionRefsSchema>;
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;
export type MissingEvidence = z.infer<typeof missingEvidenceSchema>;
export type CoachingRole = z.infer<typeof coachingRoleSchema>;
export type QuestionVerdict = z.infer<typeof questionVerdictSchema>;

/** Never send rejected answers or drafts to the conversation coach. */
export function reviewedQuestions(review?: QuestionReview) {
  if (!review) return undefined;
  return {
    version: review.version,
    revision: review.revision,
    coverageComplete: review.coverageComplete,
    limitations: review.limitations,
    questions: review.questions.map(
      ({ question, verdict, askedMessageIds, surfacedMessageIds }) => ({
        ...question,
        askedMessageIds,
        surfacedMessageIds: surfacedMessageIds ?? [],
        disposition: verdict.disposition,
        coachingRole: verdict.coachingRole,
        missingEvidence: verdict.missingEvidence,
        ...(verdict.decision === "accept" || verdict.decision === "qualify"
          ? { finding: verdict }
          : verdict.decision === "needs-evidence" &&
              verdict.missingEvidence === "learner"
            ? {
                finding: null,
                verifiedContext: {
                  supporting: verdict.supporting,
                  conflicting: verdict.conflicting,
                  alternatives: verdict.alternatives,
                  uncertainty: verdict.uncertainty,
                },
                unresolved:
                  "Learner-specific uncertainty; recording and technical facts were checked. This is not a learner deficit.",
              }
            : {
                finding: null,
                unresolved:
                  "No verified answer is available. This is uncertainty, not a learner deficit.",
              }),
      }),
    ),
  };
}
