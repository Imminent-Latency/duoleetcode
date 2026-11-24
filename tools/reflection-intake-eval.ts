// Opt-in live evaluation. Synthetic copies only; no learner data is written.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { baselineAgentModel } from "../lib/agent-settings-store";
import { intakeMessage } from "../lib/reflection-intake";
import { validateReflection } from "../lib/reflection";
import { reflectionFixture } from "./reflection-fixture";
const fixture = reflectionFixture();
const config = { model: baselineAgentModel(), effort: "low" };
const reports: unknown[] = [];
let failed = false;
try {
  const preparation = await reflect(fixture, config, "preparation");
  validateReflection(fixture, preparation.result);
  assert.equal(preparation.result.status, "exploring");
  assert.equal(preparation.result.evaluation.gaps.length, 0);
  const analysis = {
    ...preparation.result.evaluation,
    model: preparation.model,
    effort: preparation.effort,
    version: "intake-test",
    createdAt: Date.now(),
    evidenceThrough: fixture.lastSeq,
  };
  reports.push({
    name: "private preparation before answers",
    pass: true,
    ...preparation,
  });
  const cases = [
    {
      name: "correct bounds provided up front",
      space: "O(n)",
      runtime: "O(n)",
      ready: true,
    },
    {
      name: "space misconception still needs clarification",
      space: "O(1), the set uses constant memory",
      runtime: "O(n)",
      ready: false,
    },
    {
      name: "explicit uncertainty is not a misconception",
      space: "I'm not sure",
      runtime: "I'm not sure",
      ready: false,
    },
  ];
  for (const entry of cases) {
    const a = structuredClone(fixture);
    const intake = {
      id: crypto.randomUUID(),
      familiarity: "solved" as const,
      spaceComplexity: entry.space,
      timeComplexity: entry.runtime,
      submittedAt: Date.now(),
    };
    a.exposure = "solved";
    a.exposureSource = "reported";
    a.reflection = {
      analysis,
      intake,
      messages: [
        {
          id: intake.id,
          role: "user",
          kind: "intake",
          text: intakeMessage(intake),
          createdAt: intake.submittedAt,
        },
      ],
    };
    const output = await reflect(a, config);
    validateReflection(a, output.result);
    const pass = (output.result.status === "ready") === entry.ready;
    reports.push({ name: entry.name, pass, ...output });
    console.log(
      JSON.stringify({
        name: entry.name,
        pass,
        status: output.result.status,
        message: output.result.message,
      }),
    );
    if (!pass) failed = true;
    if (entry.ready) {
      assert.doesNotMatch(
        output.result.message,
        /\*\*Question|what.*(time|space).*complexity|what trade.off were you aiming/i,
      );
      writeFileSync(
        ".local/reflection-intake-preview.json",
        JSON.stringify({ attempt: a, result: output.result }, null, 2),
      );
    }
    if (entry.name.includes("uncertainty"))
      assert.equal(output.result.evaluation.gaps.length, 0);
  }
} finally {
  writeFileSync(
    ".local/reflection-intake-eval.json",
    JSON.stringify(reports, null, 2),
  );
  agent().close();
}
if (failed) process.exitCode = 1;
