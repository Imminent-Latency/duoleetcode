import type { Attempt } from "./types";
import { nextAssessmentGate } from "./skill-ratings";

export function recommend(history: Attempt[]) {
  const gate = nextAssessmentGate(history);
  if (gate.allowed || !gate.blockingAttemptId) return null;
  if (gate.reason === "active-attempt") {
    return {
      title: "Resume your assessment",
      slug: gate.slug ?? "",
      reason: gate.message!,
      kind: "continue" as const,
      gateReason: gate.reason,
      basedOn: gate.blockingAttemptId,
      revisitAt: Date.now(),
    };
  }
  if (gate.reason === "unsettled-checkin") {
    return {
      title: "Finish your quick check-in",
      slug: gate.slug ?? "",
      reason: gate.message!,
      kind: "continue" as const,
      gateReason: gate.reason,
      basedOn: gate.blockingAttemptId,
      revisitAt: Date.now(),
    };
  }
  return {
    title: "Finish your learning loop",
    slug: gate.slug ?? "",
    reason: gate.message!,
    kind: "continue" as const,
    gateReason: gate.reason,
    basedOn: gate.blockingAttemptId,
    revisitAt: Date.now(),
  };
}
