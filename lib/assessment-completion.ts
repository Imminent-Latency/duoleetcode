import type { JudgeJob } from "./types";

// Run only checks supplied examples. Only the latest completed, accepted
// submission establishes that this attempt passed the full judge suite.
export function acceptedSubmission(jobs: JudgeJob[]) {
  const latest = jobs.findLast((job) => job.kind === "submit");
  if (
    latest?.state !== "complete" ||
    latest.summary?.verdict !== "Accepted" ||
    (latest.sourceVerification &&
      (!latest.sourceVerification.matches ||
        !latest.sourceVerification.questionMatches))
  )
    return;
  return latest;
}
