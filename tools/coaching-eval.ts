// Opt-in live regression check using the existing ChatGPT-backed harness.
// No learner database writes and no LeetCode calls.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { agent, coach } from "../lib/agents";
import { validateUnderstanding, type CoachingResult } from "../lib/coaching";
import type { Attempt } from "../lib/types";
import { demoProblem } from "../lib/demo";

const original =
  "seenInts should contain all previously seen ints not the currently seen int. We risk returning true for any array of nums";
const fixture = (answer: string): Attempt => ({
  id: crypto.randomUUID(),
  problem: {
    ...demoProblem,
    title: "Contains Duplicate",
    titleSlug: "contains-duplicate",
  },
  createdAt: Date.now(),
  budgetMs: 1200000,
  deadline: Date.now(),
  phase: "learn",
  sealed: true,
  initialSource: "",
  source:
    "class Solution { public boolean containsDuplicate(int[] nums) { Set<Integer> seenInts = new HashSet<>(); for (int i : nums) { if (seenInts.contains(i)) return true; seenInts.add(i); } return false; } }",
  version: 0,
  lastSeq: 0,
  pauses: [],
  exposure: "new",
  events: [],
  checkpoints: [],
  jobs: [],
  annotations: [],
  evaluations: [
    {
      summary:
        "Assess the check-before-insert invariant for a nonempty integer array.",
      strengths: [],
      gaps: [],
      moments: [],
      version: "live-eval",
      createdAt: Date.now(),
      evidenceThrough: 0,
      exercise: {
        skill: "Set invariants",
        title: "Check-before-insert reasoning",
        prompt:
          "Spend 2–3 minutes reasoning in Java without running code. Suppose seenInts.add(i) is moved immediately before the contains check in your solution. Trace both versions on [7] and [7, 7]. State each result and explain what seenInts should contain just before processing an element.",
        rubric:
          "Explain that the set contains previously processed values only. Original returns false for [7] and true for [7, 7]. Inserting first returns true in both because the current value matches itself.",
      },
    },
  ],
  followup: { answer, answeredAt: Date.now(), evaluationRevision: 0 },
});
const outputs: { name: string; result: CoachingResult }[] = [];
async function check(
  name: string,
  a: Attempt,
  expected: "sufficient" | "needs-evidence",
) {
  const result = await coach(a);
  const understanding = validateUnderstanding(a, result);
  outputs.push({ name, result });
  console.log({
    name,
    status: understanding.status,
    firstResponseOutcome: result.outcome,
    feedback: result.feedback,
  });
  assert.equal(understanding.status, expected, name);
  return { result, understanding };
}
try {
  const a = fixture(original);
  const first = await check(
    "screenshot: sound general reasoning without redundant traces",
    a,
    "sufficient",
  );
  assert.equal(first.result.outcome, "independent");
  a.followup!.feedback = first.result.feedback;
  a.followup!.outcome = first.result.outcome;
  a.followup!.messages = [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: first.result.feedback,
      replyTo: "first-response",
      createdAt: Date.now(),
      understanding: first.understanding,
    },
  ];
  // This is only a visual fixture, separate from real learning history.
  mkdirSync(".local", { recursive: true });
  writeFileSync(".local/coaching-preview.json", JSON.stringify(a, null, 2));

  const b = fixture(
    "I would add first, then contains tells me whether it was already there earlier.",
  );
  const second = await check(
    "actual misconception needs a focused follow-up",
    b,
    "needs-evidence",
  );
  b.followup!.feedback = second.result.feedback;
  b.followup!.outcome = second.result.outcome;
  b.followup!.messages = [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: second.result.feedback,
      replyTo: "first-response",
      createdAt: Date.now(),
      understanding: second.understanding,
    },
    {
      id: crypto.randomUUID(),
      role: "user",
      text: "Yes, I get it now.",
      createdAt: Date.now(),
    },
  ];
  const third = await check(
    "agreement alone is not understanding evidence",
    b,
    "needs-evidence",
  );
  b.followup!.messages.push(
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: third.result.feedback,
      replyTo: b.followup!.messages.at(-1)!.id,
      createdAt: Date.now(),
      understanding: third.understanding,
    },
    {
      id: crypto.randomUUID(),
      role: "user",
      text: "For [9, 2], adding 9 first makes contains(9) true even though no earlier 9 exists, so that version wrongly returns true. Checking first sees an empty set for 9, then {9} for 2, finds no match and returns false. The set should hold only elements from earlier iterations.",
      createdAt: Date.now(),
    },
  );
  const fourth = await check(
    "application during conversation establishes understanding",
    b,
    "sufficient",
  );
  assert.equal(fourth.understanding.support, "coached");
  assert.notEqual(fourth.result.outcome, "independent");
} finally {
  mkdirSync(".local", { recursive: true });
  writeFileSync(".local/coaching-eval.json", JSON.stringify(outputs, null, 2));
  agent().close();
}
