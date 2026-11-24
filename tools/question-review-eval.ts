// Detached live check of targeted updates. Never opens the practice database.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { resolveAgentChoice } from "../lib/agent-settings";
import {
  readAgentSettings,
  baselineAgentModel,
} from "../lib/agent-settings-store";
import { reflectionFixture } from "./reflection-fixture";

if (process.env.DUO_DATABASE !== ":memory:")
  throw Error(
    "Run this fixture with DUO_DATABASE=:memory: and a separate trace database.",
  );
const a = reflectionFixture();
const choice = {
  ...resolveAgentChoice(
    readAgentSettings(),
    "reflection coach",
    baselineAgentModel(),
  ),
  effort: "low",
};
a.reflection = {
  messages: [
    {
      id: "tradeoff",
      role: "user",
      text: "I wanted to improve runtime. Sorting was nlogn, but with a hashset it can be linear at the cost of n space.",
      createdAt: Date.now(),
    },
  ],
};
const report: any[] = [];
const path =
  process.env.DUO_EVAL_REPORT ?? ".local/question-review-update.json";
try {
  let started = Date.now();
  const first = await reflect(a, choice);
  const original = structuredClone(first.result.evaluation.questionReview!);
  report.push({ stage: "initial", elapsedMs: Date.now() - started, ...first });
  writeFileSync(path, JSON.stringify(report, null, 2));
  assert.equal(first.result.status, "ready", "Concise tradeoff is sufficient");
  a.evaluations.push({
    ...first.result.evaluation,
    model: first.model,
    effort: first.effort,
    version: "live-fixture",
    createdAt: Date.now(),
    evidenceThrough: a.lastSeq,
  });
  a.reflection.questionReview = original;
  a.reflection.messages.push({
    id: "coach",
    role: "assistant",
    text: first.result.message,
    createdAt: Date.now(),
    status: first.result.status,
    checks: first.result.checks,
    evaluationRevision: 0,
  });
  a.reflection.messages.push({
    id: "space-detail",
    role: "user",
    text: "By n space, I mean up to n distinct values stored in the set. There isn't another n-sized structure in my code.",
    createdAt: Date.now(),
  });
  started = Date.now();
  const second = await reflect(a, choice);
  report.push({ stage: "update", elapsedMs: Date.now() - started, ...second });
  writeFileSync(path, JSON.stringify(report, null, 2));
  const updated = second.result.evaluation.questionReview!;
  assert.equal(second.result.status, "ready");
  assert.equal(updated.revision, original.revision + 1);
  assert.ok(
    updated.questions.some((q) => q.updatedRevision < updated.revision),
    "Do not re-answer every unrelated question",
  );
  assert.deepEqual(
    a.evaluations[0].questionReview,
    original,
    "Previous evaluation remains unchanged",
  );
  console.log(
    JSON.stringify({
      pass: true,
      model: second.model,
      effort: second.effort,
      questions: updated.questions.length,
      refreshed: updated.questions.filter(
        (q) => q.updatedRevision === updated.revision,
      ).length,
      message: second.result.message,
    }),
  );
} finally {
  agent().close();
}
