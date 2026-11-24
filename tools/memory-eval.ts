// Opt-in live checks. All learner state is in memory; no practice records are changed.
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { agent, reflect } from "../lib/agents";
import { AttemptStore } from "../lib/store";
import { LearnerContext } from "../lib/learner-context";
import {
  readAgentSettings,
  baselineAgentModel,
} from "../lib/agent-settings-store";
import { resolveAgentChoice } from "../lib/agent-settings";
import { reflectionFixture } from "./reflection-fixture";
import { validateReflection } from "../lib/reflection";
const results: unknown[] = [];
const choice = {
  ...resolveAgentChoice(
    readAgentSettings(),
    "reflection coach",
    baselineAgentModel(),
  ),
  effort: "low",
};
async function preferenceCase(name: string, text: string, expected: boolean) {
  const db = new AttemptStore(":memory:");
  const a = reflectionFixture();
  a.demonstration = false;
  a.reflection = {
    messages: [
      { id: "preference-message", role: "user", text, createdAt: Date.now() },
    ],
  };
  try {
    const learner = new LearnerContext(db.memory, "coach", a);
    const output = await agent().run(
      "coach",
      "Respond briefly to the learner. If and only if the learner explicitly states a durable preference for future coaching, use suggest_coaching_preference with their exact quote. Temporary state and ability claims are not coaching preferences. Do not ask a knowledge-check question. Return a short message.",
      { messages: a.reflection.messages },
      z.toJSONSchema(z.object({ message: z.string() })),
      a,
      choice,
      { learner },
    );
    const proposed = db.memory.list().filter((m) => m.status === "proposed");
    assert.equal(proposed.length > 0, expected);
    assert.equal(
      db.memory
        .profile("coaching")
        .some((m) => proposed.some((p) => p.id === m.id)),
      false,
    );
    const row = {
      name,
      pass: true,
      model: output.model,
      effort: output.effort,
      message: output.value.message,
      suggestions: proposed.map((p) => ({
        text: p.text,
        quote: p.source.quote,
      })),
    };
    results.push(row);
    console.log(JSON.stringify(row));
  } finally {
    db.db.close();
  }
}
async function reasoningCase(name: string, text: string, ready: boolean) {
  const db = new AttemptStore(":memory:");
  const a = reflectionFixture();
  a.demonstration = false;
  a.reflection = {
    messages: [{ id: "answer", role: "user", text, createdAt: Date.now() }],
  };
  db.memory.add({
    text: "Keep your answer to a brief paragraph unless I ask for details.",
    scope: "reflection",
  });
  try {
    const output = await reflect(a, choice, "conversation", db.memory);
    validateReflection(a, output.result);
    assert.equal(output.result.status === "ready", ready);
    if (ready) assert.doesNotMatch(output.result.message, /\*\*Question\*\*/);
    const row = {
      name,
      pass: true,
      model: output.model,
      effort: output.effort,
      status: output.result.status,
      message: output.result.message,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  } finally {
    db.db.close();
  }
}
let failed = false;
try {
  const cases = [
    () =>
      preferenceCase(
        "explicit preference stays pending approval",
        "For future coaching, please use one compact example instead of several tiny questions.",
        true,
      ),
    () =>
      preferenceCase(
        "temporary frustration is not durable memory",
        "I'm tired today and that last question was annoying.",
        false,
      ),
    () =>
      reasoningCase(
        "sufficient concise reasoning with memory",
        "I replaced sorting's nlogn runtime with a single linear scan and a HashSet, trading that speed for n extra storage for distinct numbers.",
        true,
      ),
    () =>
      reasoningCase(
        "brief style does not excuse a misconception",
        "My one-pass HashSet solution is linear time and constant extra space because the set only stores whether a duplicate exists.",
        false,
      ),
  ];
  for (let i = 0; i < cases.length; i += 2) {
    const pair = await Promise.allSettled(
      cases.slice(i, i + 2).map((run) => run()),
    );
    for (const r of pair)
      if (r.status === "rejected") {
        failed = true;
        results.push({ pass: false, error: String(r.reason) });
        console.error(String(r.reason));
      }
  }
} finally {
  mkdirSync(".local", { recursive: true });
  writeFileSync(".local/memory-eval.json", JSON.stringify(results, null, 2));
  agent().close();
}
if (failed) process.exitCode = 1;
