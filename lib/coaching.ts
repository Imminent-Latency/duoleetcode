import { z } from "zod";
import type { Attempt, LearningExit, Understanding } from "./types";
import { reflectionReady } from "./reflection";
import { latestDevelopment } from "./reflection-development";

export const FIRST_RESPONSE = "first-response";
export const coachingResultSchema = z.object({
  feedback: z.string().trim().min(1).max(12000),
  // Applies only to the preserved first response, never to later coached work.
  outcome: z.enum(["independent", "partial", "needs-practice", "unassessed"]),
  understanding: z.object({
    status: z.enum(["sufficient", "needs-evidence"]),
    summary: z.string().trim().min(1).max(2000),
    criteria: z
      .array(
        z.object({
          concept: z.string().trim().min(1).max(500),
          status: z.enum(["demonstrated", "open"]),
          evidence: z
            .array(
              z.object({
                messageId: z.string(),
                quote: z.string().trim().min(1).max(3000),
              }),
            )
            .max(6),
        }),
      )
      .min(1)
      .max(4),
  }),
});
export type CoachingResult = z.infer<typeof coachingResultSchema> & {
  research?: import("./research-types").ResearchBundle;
};

export function latestCoaching(a: Attempt) {
  return a.followup?.messages?.findLast((m) => m.role === "assistant");
}
export function pendingCoaching(a: Attempt) {
  const last = a.followup?.messages?.at(-1);
  return last?.role === "user" ? last : undefined;
}
export function readyToMoveOn(a: Attempt) {
  return (
    !pendingCoaching(a) &&
    latestCoaching(a)?.understanding?.status === "sufficient"
  );
}

// A model can judge the reasoning; the harness checks that its evidence really
// exists in learner-authored messages, rather than in the coach's own lesson.
export function validateUnderstanding(
  a: Attempt,
  result: CoachingResult,
): Understanding {
  const learnerText = new Map([
    [FIRST_RESPONSE, a.followup!.answer],
    ...(a.followup?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => [m.id, m.text] as [string, string]),
  ]);
  for (const criterion of result.understanding.criteria) {
    if (criterion.status === "demonstrated" && !criterion.evidence.length)
      throw new Error(
        "The coach did not cite learner evidence. Retry the reply.",
      );
    for (const evidence of criterion.evidence) {
      if (!learnerText.get(evidence.messageId)?.includes(evidence.quote))
        throw new Error(
          "The coach cited missing learner evidence. Retry the reply.",
        );
    }
  }
  if (
    result.understanding.status === "sufficient" &&
    result.understanding.criteria.some((c) => c.status !== "demonstrated")
  )
    throw new Error(
      "The coach marked an unresolved concept complete. Retry the reply.",
    );
  const laterEvidence = result.understanding.criteria.some((c) =>
    c.evidence.some((e) => e.messageId !== FIRST_RESPONSE),
  );
  return {
    ...result.understanding,
    support:
      a.demonstration || result.outcome === "unassessed"
        ? "unassessed"
        : laterEvidence
          ? "coached"
          : "independent",
  };
}

export function closeLearning(
  a: Attempt,
  reason?: LearningExit["reason"],
  now = Date.now(),
) {
  if (a.phase === "complete") return; // retries preserve the original exit reason
  if (!["review", "learn"].includes(a.phase) || !a.sealed)
    throw new Error("Finish and save the assessment before moving on.");
  const resolved =
    reason ??
    (readyToMoveOn(a) || (a.phase === "review" && reflectionReady(a))
      ? "sufficient"
      : a.followup?.feedback ||
          latestCoaching(a) ||
          a.reflection?.messages.some((m) => m.role === "user")
        ? "manual"
        : "skipped");
  if (
    resolved === "sufficient" &&
    !readyToMoveOn(a) &&
    !(a.phase === "review" && reflectionReady(a))
  )
    throw new Error(
      "There is not yet enough evidence. You can still move on manually.",
    );
  if (resolved === "skipped" && (a.followup?.feedback || latestCoaching(a)))
    throw new Error("Coaching has already started. Choose move on manually.");
  a.learningExit = { reason: resolved, at: now };
  if (
    a.phase === "review" &&
    a.reflection &&
    latestDevelopment(a)?.optimization.status === "offered"
  )
    a.reflection.optimizationDeferredAt = now;
  a.phase = "complete";
}
