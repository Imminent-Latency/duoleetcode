import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendTestCase,
  submissionTestCase,
  testParameters,
  splitTestCases,
  resultCases,
} from "../lib/test-cases";
import { demoProblem } from "../lib/demo";
import type { JudgeJob } from "../lib/types";

test("test-case grouping preserves method argument order and falls back for custom input", () => {
  const p = {
    ...demoProblem,
    javaStarter:
      "class Solution { public int[] twoSum(int[] nums, int target) { } }",
  };
  const params = testParameters(p);
  assert.deepEqual(params, [
    { name: "nums", type: "int[]" },
    { name: "target", type: "int" },
  ]);
  const raw = "[2,7,11,15]\n9\n[3,3]\n6";
  const cases = splitTestCases(raw, params.length)!;
  assert.deepEqual(cases, [
    ["[2,7,11,15]", "9"],
    ["[3,3]", "6"],
  ]);
  assert.equal(cases.flat().join("\n"), raw);
  assert.equal(splitTestCases("[1,2]\n3\n[4,5]", 2), undefined);
  assert.equal(splitTestCases("[1,2]\n\n3", 1), undefined);
  assert.equal(splitTestCases("[1,2]\n", 1), undefined);
  assert.deepEqual(
    testParameters({ ...p, metadata: { systemdesign: true } }),
    [],
  );
  assert.deepEqual(
    testParameters({
      ...p,
      javaStarter: "public List<Integer> f(Map<String, Integer> map, int k) {}",
    }),
    [
      { name: "map", type: "Map<String, Integer>" },
      { name: "k", type: "int" },
    ],
  );
});

const failedSubmission: JudgeJob = {
  id: "failed-submission",
  kind: "submit",
  state: "complete",
  source: "fixture",
  seq: 1,
  createdAt: 1,
  summary: { verdict: "Wrong Answer" },
  result: { status_code: 11, last_testcase: '"badc"\n"baba"' },
};

test("only complete, exposed failing submission inputs can be reused", () => {
  assert.equal(submissionTestCase(failedSubmission, 2), '"badc"\n"baba"');
  for (const last_testcase of [
    undefined,
    null,
    [],
    "",
    "Hidden",
    "[1,2,...]",
    '"one argument"',
  ])
    assert.equal(
      submissionTestCase({ ...failedSubmission, result: { last_testcase } }, 2),
      undefined,
    );
  for (const job of [
    { ...failedSubmission, kind: "run" as const },
    { ...failedSubmission, state: "judging" },
    { ...failedSubmission, summary: { verdict: "Accepted" } },
    {
      ...failedSubmission,
      result: { ...failedSubmission.result, status_code: 10 },
    },
  ])
    assert.equal(submissionTestCase(job, 2), undefined);
  assert.equal(
    submissionTestCase(
      { ...failedSubmission, result: { last_testcase: '""\r\n"a\\nb"\r\n' } },
      2,
    ),
    '""\n"a\\nb"',
  );
  assert.equal(
    submissionTestCase(
      { ...failedSubmission, result: { last_testcase: "9007199254740993" } },
      1,
    ),
    "9007199254740993",
  );
});

test("adding a failure preserves existing cases, selects the new case and prevents duplicates", () => {
  const input = '"egg"\n"add"\n"foo"\n"bar"';
  const incoming = submissionTestCase(failedSubmission, 2)!;
  const added = appendTestCase(input, incoming, 2);
  assert.deepEqual(added, {
    input: input + "\n" + incoming,
    index: 2,
    existing: false,
  });
  assert.ok(!("error" in added));
  assert.deepEqual(appendTestCase(added.input, incoming, 2), {
    ...added,
    existing: true,
  });
  assert.deepEqual(appendTestCase("", incoming, 2), {
    input: incoming,
    index: 0,
    existing: false,
  });
  assert.deepEqual(appendTestCase(input + "\r\n", incoming, 2), added);
  assert.ok("error" in appendTestCase('"incomplete"', incoming, 2));
  assert.ok(
    "error" in
      appendTestCase(Array(50).fill('"egg"\n"add"').join("\n"), incoming, 2),
  );
  assert.ok(
    "error" in
      appendTestCase('"' + "a".repeat(100_000) + '"\n"b"', incoming, 2),
  );
});

test("per-case results use the original run input and exclude LeetCode's trailing sentinel", () => {
  const job: JudgeJob = {
    id: "fixture",
    kind: "run",
    state: "complete",
    source: "fixture",
    seq: 1,
    createdAt: 1,
    input: "[2,7]\n9\n[3,3]\n6",
    result: {
      total_testcases: 2,
      code_answer: ["[0,1]", "[1,0]", ""],
      expected_code_answer: ["[0,1]", "[0,1]", ""],
    },
  };
  const cases = resultCases(job, [
    { name: "nums", type: "int[]" },
    { name: "target", type: "int" },
  ]);
  assert.equal(cases.length, 2);
  assert.deepEqual(cases[1], {
    inputs: ["[3,3]", "6"],
    actual: "[1,0]",
    expected: "[0,1]",
  });
  assert.deepEqual(resultCases({ ...job, kind: "submit" }, []), []);
  assert.deepEqual(
    resultCases({ ...job, result: { compile_error: "missing return" } }, []),
    [],
  );
});
