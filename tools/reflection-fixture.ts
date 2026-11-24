import type { Attempt } from "../lib/types";
export const starter =
  "class Solution {\n    public boolean containsDuplicate(int[] nums) {\n        \n    }\n}";
export const sorting =
  "import java.util.Arrays;\nclass Solution {\n    public boolean containsDuplicate(int[] nums) {\n        Arrays.sort(nums);\n        for (int i = 1; i < nums.length; i++) {\n            if (nums[i] == nums[i - 1]) return true;\n        }\n        return false;\n    }\n}";
export const hashing =
  "import java.util.HashSet;\nclass Solution {\n    public boolean containsDuplicate(int[] nums) {\n        HashSet<Integer> seen = new HashSet<>();\n        for (int num : nums) {\n            if (!seen.add(num)) return true;\n        }\n        return false;\n    }\n}";
export function reflectionFixture(): Attempt {
  const start = Date.now() - 120000;
  return {
    id: crypto.randomUUID(),
    problem: {
      questionId: "reflection-fixture",
      questionFrontendId: "TEST",
      title: "Contains Duplicate",
      titleSlug: "contains-duplicate",
      difficulty: "Easy",
      content:
        "Return true if any value in a nonempty integer array appears more than once; otherwise return false. The array has at most 100000 values.",
      javaStarter: starter,
      exampleInputs: { raw: "[1,2,3,1]" },
    },
    createdAt: start,
    budgetMs: 120000,
    deadline: start + 120000,
    endedAt: start + 100000,
    phase: "review",
    sealed: true,
    source: hashing,
    initialSource: starter,
    version: 3,
    lastSeq: 6,
    pauses: [],
    exposure: "new",
    exposureSource: "default",
    events: [
      {
        seq: 1,
        at: start + 10000,
        type: "edit",
        version: 1,
        edits: [{ offset: 0, length: starter.length, text: sorting }],
      },
      { seq: 2, at: start + 20000, type: "run", jobId: "fixture-run" },
      {
        seq: 3,
        at: start + 50000,
        type: "edit",
        version: 2,
        edits: [{ offset: 0, length: sorting.length, text: starter }],
      },
      {
        seq: 4,
        at: start + 55000,
        type: "edit",
        version: 3,
        edits: [{ offset: 0, length: starter.length, text: hashing }],
      },
      { seq: 5, at: start + 90000, type: "submit", jobId: "fixture-submit" },
      { seq: 6, at: start + 100000, type: "finish" },
    ],
    checkpoints: [],
    annotations: [],
    evaluations: [],
    demonstration: true,
    jobs: [
      {
        id: "fixture-run",
        kind: "run",
        state: "complete",
        source: sorting,
        seq: 2,
        createdAt: start + 20000,
        summary: { verdict: "Accepted" },
        result: { total_testcases: 3, total_correct: 3 },
      },
      {
        id: "fixture-submit",
        kind: "submit",
        state: "complete",
        source: hashing,
        seq: 5,
        createdAt: start + 90000,
        summary: { verdict: "Accepted" },
        result: { total_testcases: 80, total_correct: 80 },
      },
    ],
  };
}

export function developmentFixture(): import("../lib/reflection-development").ReflectionDevelopment {
  return {
    approaches: [
      {
        id: "solution",
        label: "Saved solution",
        origin: "recorded",
        observation: "The saved implementation.",
        focus: {
          startSeq: 4,
          endSeq: 4,
          mode: "snapshot",
          label: "Solution",
          pauseSeq: 4,
        },
        assistanceIds: [],
        learnerEvidence: [],
        intent: {
          status: "unknown",
          statement: "Intent has not been explained.",
          evidence: [],
        },
      },
    ],
    baselineApproachId: "solution",
    activeApproachId: "solution",
    baselineCorrection: [],
    optimization: { status: "not-discussed", approachId: null },
    revisits: [],
  };
}
