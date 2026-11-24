// Opt-in live checks. Synthetic attempts only; no learner DB or judge requests.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { validateReflection } from "../lib/reflection";
import { reflectionFixture } from "./reflection-fixture";
const a = reflectionFixture();
a.reflection = { messages: [] };
const results: unknown[] = [];
async function turn(name: string) {
  const { result, model } = await reflect(a);
  validateReflection(a, result);
  a.evaluations.push({
    ...result.evaluation,
    model,
    version: "reflection-live-test",
    createdAt: Date.now(),
    evidenceThrough: a.lastSeq,
  });
  a.reflection!.messages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    text: result.message,
    createdAt: Date.now(),
    focus: result.focus,
    status: result.status,
    checks: result.checks,
    evaluationRevision: a.evaluations.length - 1,
  });
  results.push({ name, result });
  console.log(
    JSON.stringify({
      name,
      status: result.status,
      focus: result.focus,
      message: result.message,
      gaps: result.evaluation.gaps,
    }),
  );
  return result;
}
try {
  mkdirSync(".local", { recursive: true });
  const opening = await turn("immediate analysis before answers");
  assert.equal(opening.status, "exploring");
  assert.equal(
    opening.evaluation.gaps.length,
    0,
    "Unexplained trade-offs are questions, not deficits.",
  );
  assert.ok(opening.focus, "Opening should show relevant code.");
  writeFileSync(".local/reflection-preview.json", JSON.stringify(a, null, 2));
  a.reflection!.messages.push({
    id: "approach-answer",
    role: "user",
    createdAt: Date.now(),
    text: "I wanted to avoid changing the input, so I tried a set instead of sorting.",
  });
  const middle = await turn("ask for missing complexity reasoning");
  assert.equal(middle.status, "exploring");
  assert.match(middle.message, /space|memory|storage|complexity/i);
  a.reflection!.messages.push({
    id: "complexity-answer",
    role: "user",
    createdAt: Date.now(),
    text: "The set approach is expected O(n) time because each value is inserted once and insertion is average O(1). It uses O(n) extra space in the worst case when all values differ. Sorting is O(n log n) plus a linear scan, and Arrays.sort changes the input; preserving the input would require an O(n) copy. That time/space and mutation trade-off is why I chose the set.",
  });
  const final = await turn(
    "sufficient conceptual explanation without extra quizzes",
  );
  assert.equal(final.status, "ready");
  assert.equal(final.evaluation.gaps.length, 0);
} finally {
  writeFileSync(
    ".local/reflection-eval.json",
    JSON.stringify(results, null, 2),
  );
  agent().close();
}
