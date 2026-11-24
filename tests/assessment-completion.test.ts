import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedSubmission } from "../lib/assessment-completion";
import type { JudgeJob } from "../lib/types";
const accepted: JudgeJob = {
  id: "submission",
  kind: "submit",
  state: "complete",
  source: "class Solution {}",
  seq: 10,
  createdAt: 1000,
  summary: { verdict: "Accepted" },
  result: { status_code: 10, total_correct: 66, total_testcases: 66 },
};
test("only an accepted full submission ends an assessment, not passing example tests", () => {
  assert.equal(acceptedSubmission([]), undefined);
  assert.equal(acceptedSubmission([{ ...accepted, kind: "run" }]), undefined);
  assert.equal(
    acceptedSubmission([{ ...accepted, state: "judging" }]),
    undefined,
  );
  assert.equal(
    acceptedSubmission([{ ...accepted, summary: { verdict: "Wrong Answer" } }]),
    undefined,
  );
  assert.equal(acceptedSubmission([accepted]), accepted);
  assert.equal(
    acceptedSubmission([
      accepted,
      { ...accepted, id: "later-run", kind: "run" },
    ]),
    accepted,
  );
});
test("unknown newer submissions and mismatched source verification cannot cause automatic finish", () => {
  assert.equal(
    acceptedSubmission([
      accepted,
      { ...accepted, id: "later-submit", state: "unknown", summary: undefined },
    ]),
    undefined,
  );
  assert.equal(
    acceptedSubmission([
      {
        ...accepted,
        sourceVerification: { matches: false, questionMatches: true },
      },
    ]),
    undefined,
  );
  assert.equal(
    acceptedSubmission([
      {
        ...accepted,
        sourceVerification: { matches: true, questionMatches: false },
      },
    ]),
    undefined,
  );
});
