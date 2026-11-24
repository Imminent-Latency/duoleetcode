// Opt-in live calibration. Reads an optional saved attempt but never writes it.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { baselineAgentModel } from "../lib/agent-settings-store";
import { validateReflection } from "../lib/reflection";
import type { Attempt } from "../lib/types";
import { reflectionFixture } from "./reflection-fixture";
const effort =
  process.argv.find((a) => a.startsWith("--effort="))?.slice(9) ?? "low";
if (!["low", "medium", "high"].includes(effort))
  throw new Error("Choose --effort=low, medium, or high");
const chosenModel = process.argv
  .find((a) => a.startsWith("--model="))
  ?.slice(8);
const model = chosenModel ?? baselineAgentModel();
const report = chosenModel
  ? `.local/reflection-calibration-${model.replace(/[^a-zA-Z0-9-]/g, "_")}-${effort}.json`
  : `.local/reflection-calibration-${effort}.json`;
const original =
  "I wanted to improve the runtime of my solution. the sort operation meant my runtime was nlogn. but if I used a hashset it could be linear at the cost of n space complexity.";
const opening = "What were you aiming to improve by switching to the set?";
function answered(text?: string) {
  const a = reflectionFixture();
  a.reflection = {
    messages: [
      {
        id: "opening",
        role: "assistant",
        text: opening,
        createdAt: a.endedAt!,
      },
    ],
  };
  if (text)
    a.reflection.messages.push({
      id: "answer",
      role: "user",
      text,
      createdAt: a.endedAt! + 1,
    });
  return a;
}
const cases: {
  name: string;
  attempt: Attempt;
  ready: boolean;
  check?: (result: Awaited<ReturnType<typeof reflect>>["result"]) => void;
}[] = [];
const selected = process.argv
  .find((arg) => arg.startsWith("--attempt="))
  ?.slice("--attempt=".length);
if (selected) {
  const response = await fetch(
    "http://127.0.0.1:4318/api/attempts/" + encodeURIComponent(selected),
  );
  if (!response.ok) throw new Error("Cannot read selected attempt");
  const a = (await response.json()).attempt as Attempt;
  const first =
    a.reflection?.messages.findIndex((m) => m.role === "user") ?? -1;
  if (first < 0) throw new Error("Selected attempt has no learner response");
  a.reflection!.messages = a.reflection!.messages.slice(0, first + 1);
  const revision = a.reflection!.messages[0]?.evaluationRevision ?? -1;
  a.evaluations = a.evaluations.slice(0, revision + 1);
  delete a.followup;
  cases.push({
    name: "actual attempt, only original answer",
    attempt: a,
    ready: true,
  });
} else
  cases.push({
    name: "original answer, representative implementation",
    attempt: answered(original),
    ready: true,
  });
cases.push(
  {
    name: "equivalent informal reasoning",
    attempt: answered(
      "I dropped the sorting step so it is one linear scan with a set now. I am paying for that speed with storage that grows with the distinct numbers.",
    ),
    ready: true,
  },
  {
    name: "explicit space misconception",
    attempt: answered(
      "I replaced sorting with a HashSet for linear time and constant extra space; the set only stores whether I have seen a duplicate, so its memory does not grow.",
    ),
    ready: false,
  },
  {
    name: "preference without complexity evidence",
    attempt: answered("I used a set because I am familiar with it."),
    ready: false,
  },
  {
    name: "correct code without learner explanation",
    attempt: answered(),
    ready: false,
  },
);
const echo = answered("Yes, I understand.");
echo.reflection!.messages[0].text =
  "The set solution has expected O(n) time and O(n) space: one pass, constant-average operations, and up to n stored entries. Does that make sense?";
cases.push({
  name: "agreement after coach supplied the answer",
  attempt: echo,
  ready: false,
});
const contradictory = answered(original);
const nested =
  "import java.util.HashSet;\nclass Solution {\n  public boolean containsDuplicate(int[] nums) {\n    HashSet<Integer> seen = new HashSet<>();\n    for (int x : nums) {\n      for (int old : seen) if (old == x) return true;\n      seen.add(x);\n    }\n    return false;\n  }\n}";
contradictory.source = nested;
contradictory.events.find((e) => e.seq === 4)!.edits![0].text = nested;
contradictory.jobs.find((j) => j.kind === "submit")!.source = nested;
cases.push({
  name: "same claim contradicted by repeated scanning",
  attempt: contradictory,
  ready: false,
});
// A different implementation ensures this is not merely recognizing the set example.
const pairwise = answered(
  "I kept the direct pairwise check to avoid allocating extra storage. It can compare every pair, so worst-case time is quadratic and auxiliary space stays constant.",
);
const pairs =
  "class Solution {\n  public boolean containsDuplicate(int[] nums) {\n    for (int i=0;i<nums.length;i++)\n      for (int j=i+1;j<nums.length;j++)\n        if(nums[i]==nums[j]) return true;\n    return false;\n  }\n}";
pairwise.source = pairs;
pairwise.events.find((e) => e.seq === 4)!.edits![0].text = pairs;
pairwise.jobs.find((j) => j.kind === "submit")!.source = pairs;
cases.push({
  name: "sound trade-off on a different algorithm",
  attempt: pairwise,
  ready: true,
});
const outputs: unknown[] = [];
let failed = false;
async function check(entry: (typeof cases)[number]) {
  const start = Date.now();
  try {
    const { result, model: actualModel } = await reflect(entry.attempt, {
      model,
      effort,
    });
    validateReflection(entry.attempt, result);
    const pass = (result.status === "ready") === entry.ready;
    const output = {
      name: entry.name,
      model: actualModel,
      effort,
      pass,
      elapsedMs: Date.now() - start,
      result,
    };
    outputs.push(output);
    console.log(
      JSON.stringify({
        name: entry.name,
        pass,
        status: result.status,
        elapsedMs: output.elapsedMs,
        message: result.message,
        checks: result.checks,
      }),
    );
    assert.equal(pass, true, entry.name);
    if (entry.ready)
      assert.doesNotMatch(
        result.message,
        /\*\*Question\*\*|give a brief reason|to finish.*reasoning/i,
      );
    entry.check?.(result);
  } catch (error) {
    failed = true;
    outputs.push({ name: entry.name, error: String(error) });
    console.error(entry.name + ": " + String(error));
  }
}
try {
  // Independent fixtures; two bounded conversations share the existing harness.
  for (let i = 0; i < cases.length; i += 2)
    await Promise.all(cases.slice(i, i + 2).map(check));
} finally {
  mkdirSync(".local", { recursive: true });
  writeFileSync(report, JSON.stringify(outputs, null, 2));
  agent().close();
}
if (failed) process.exitCode = 1;
