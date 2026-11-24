// Live Low-effort regression fixtures. No writes to practice, preferences or settings.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import {
  readAgentSettings,
  baselineAgentModel,
} from "../lib/agent-settings-store";
import { resolveAgentChoice } from "../lib/agent-settings";
import { reflectionFixture } from "./reflection-fixture";
import { validateReflection, type ReflectionResult } from "../lib/reflection";
import type { Attempt, ReflectionMessage } from "../lib/types";

const stock = () =>
  JSON.parse(
    readFileSync(
      new URL("../tests/fixtures/stock-development.json", import.meta.url),
      "utf8",
    ),
  ) as Attempt;
const msg = (
  id: string,
  role: "user" | "assistant",
  text: string,
): ReflectionMessage => ({ id, role, text, createdAt: Date.now() });
const cases: {
  name: string;
  attempt: Attempt;
  stage?: "preparation";
  check: (r: ReflectionResult) => void;
}[] = [];
cases.push({
  name: "stock-preparation",
  attempt: stock(),
  stage: "preparation",
  check: (r) => {
    assert.equal(r.status, "exploring");
    const d = r.evaluation.development!;
    assert.ok(d.approaches.length >= 2, "Retain the sorting and heap stages");
    assert.ok(
      d.approaches.some((p) => p.assistanceIds.length),
      "Connect the saved reference questions",
    );
    assert.ok(
      d.approaches.every(
        (p) => !["confirmed", "corrected"].includes(p.intent.status),
      ),
      "No invented learner intent",
    );
  },
});
const first = stock();
first.reflection = {
  messages: [
    msg(
      "intake",
      "user",
      "New to me. Runtime: O(n). Auxiliary space: O(nlogn).",
    ),
  ],
};
cases.push({
  name: "stock-first-question",
  attempt: first,
  check: (r) => {
    assert.equal(r.status, "exploring");
    assert.ok(r.focus, "Show evidence for the question");
    assert.ok(
      r.evaluation.development!.approaches.some((p) => p.assistanceIds.length),
    );
    assert.ok(r.message.includes("?"), "Ask a consequential clarification");
    const question = r.message.split(/\*\*Question:?\*\*:?/i).at(-1)!;
    assert.match(
      question,
      /sort|switch|chang|heap|approach|aim|trying|intend/i,
      "Opening question must explore the strategy decision",
    );
    assert.doesNotMatch(
      question,
      /placeholderPrices/,
      "Do not open by debugging the unfinished loop",
    );
  },
});
const concise = reflectionFixture();
concise.reflection = {
  messages: [
    msg(
      "concise",
      "user",
      "I wanted to improve the runtime of my solution. the sort operation meant my runtime was nlogn. but if I used a hashset it could be linear at the cost of n space complexity.",
    ),
  ],
};
cases.push({
  name: "sufficient-concise-explanation",
  attempt: concise,
  check: (r) => {
    assert.equal(r.status, "ready");
    assert.equal(r.evaluation.gaps.length, 0);
    assert.doesNotMatch(r.message, /\*\*Question\*\*/);
  },
});
const changed = stock();
changed.reflection = {
  messages: [
    msg(
      "old",
      "assistant",
      "For [3, 8, 1, 5], the first valid pair is not necessarily the most profitable. How would you repair your stopping rule?",
    ),
    msg(
      "repair",
      "user",
      "I would instead find the max possible profit for every buy day. and then return the max profit. sorting like I have doesn't necessarily help me with this. a sliding window would have likely been a better approach.",
    ),
  ],
};
cases.push({
  name: "ambiguous-new-approach",
  attempt: changed,
  check: (r) => {
    assert.equal(r.status, "exploring");
    assert.ok(
      r.evaluation.development!.approaches.some(
        (p) => p.origin === "learner-proposed",
      ),
    );
    assert.ok(r.message.includes("?"));
    assert.doesNotMatch(
      r.message,
      /your (?:one-pass|linear-time) (?:approach|solution)/i,
    );
  },
});
const baseline = stock();
const explanation =
  "I would check every later sell day for every buy day and keep the largest profit. it would be O(n^2) and O(1).";
const citation = { messageId: "baseline", quote: explanation };
const supported = {
  status: "explained" as const,
  evidence: [citation],
  recordingEvidence: [],
  assessment:
    "The learner explained exhaustive chronological pairs and their quadratic time and constant auxiliary space.",
  uncertainty: null,
};
const development = {
  approaches: [
    {
      id: "exhaustive",
      label: "Exhaustive chronological pairs",
      origin: "learner-proposed" as const,
      observation:
        "A conceptual repair; the saved heap draft remains unfinished.",
      focus: null,
      assistanceIds: [],
      learnerEvidence: [citation],
      intent: {
        status: "confirmed" as const,
        statement: "Compare all valid buy/sell pairs and keep the maximum.",
        evidence: [citation],
      },
    },
    {
      id: "one-pass",
      label: "Chronological scan",
      origin: "coach-introduced" as const,
      observation:
        "Coach explained keeping the cheapest earlier buy and best profit while scanning selling days.",
      focus: null,
      assistanceIds: [],
      learnerEvidence: [],
      intent: {
        status: "unknown" as const,
        statement: "Independent learner application is untested.",
        evidence: [],
      },
    },
  ],
  baselineApproachId: "exhaustive",
  activeApproachId: "one-pass",
  baselineCorrection: [],
  optimization: { status: "explained" as const, approachId: "one-pass" },
  revisits: [
    {
      id: "independent-repair",
      approachId: "exhaustive",
      skill: "Independent implementation",
      kind: "implementation" as const,
      status: "open" as const,
      reason:
        "Implement the conceptual repair independently; saved heap code is unfinished.",
      evidence: [1185],
      learnerEvidence: [citation],
    },
  ],
};
baseline.evaluations = [
  {
    development,
    summary: "Correct conceptual exhaustive repair.",
    strengths: [],
    gaps: [],
    moments: [],
    exercise: {
      skill: "Implementation",
      title: "Implement the repair",
      prompt: "Implement your repair.",
    },
    version: "fixture",
    createdAt: 1,
    evidenceThrough: 1185,
  },
];
baseline.reflection = {
  messages: [
    msg("baseline", "user", explanation),
    {
      ...msg(
        "ready",
        "assistant",
        "Your exhaustive approach is sound, and those bounds are correct.",
      ),
      status: "ready",
      checks: {
        approach: supported,
        timeComplexity: supported,
        spaceComplexity: supported,
      },
      evaluationRevision: 0,
    },
    msg(
      "teaching",
      "assistant",
      "An optional improvement scans selling days once, remembering the cheapest earlier buy and the best profit so far. When a cheaper price arrives, update the buy index; keep the best profit.",
    ),
    msg(
      "complexity-question",
      "user",
      "Wait wouldn't this actually be O(logn) not O(n)? because it would still require restarting the comparisons for the new buy date right?",
    ),
  ],
};
// The most recent coach reply carries the preserved baseline status, as the real harness does.
Object.assign(baseline.reflection.messages[2], {
  status: "ready",
  checks: {
    approach: supported,
    timeComplexity: supported,
    spaceComplexity: supported,
  },
  evaluationRevision: 0,
});
cases.push({
  name: "optional-complexity-question",
  attempt: baseline,
  check: (r) => {
    assert.equal(
      r.status,
      "ready",
      "New optimization confusion must not revoke baseline",
    );
    assert.equal(r.evaluation.development!.baselineApproachId, "exhaustive");
    assert.ok(
      r.message.includes("?"),
      "Probe the stated restart assumption before lecturing",
    );
    assert.ok(
      r.evaluation.development!.revisits.some((t) => t.status === "open"),
    );
  },
});
const offer = structuredClone(baseline);
offer.reflection!.messages = offer.reflection!.messages.slice(0, 2);
offer.evaluations[0].development!.optimization = {
  status: "not-discussed",
  approachId: null,
};
offer.evaluations[0].development!.approaches =
  offer.evaluations[0].development!.approaches.slice(0, 1);
offer.evaluations[0].development!.activeApproachId = "exhaustive";
offer.reflection!.messages.push(
  msg(
    "optimization",
    "user",
    "Is there a faster approach? I might leave that for another session.",
  ),
);
cases.push({
  name: "optional-optimization-choice",
  attempt: offer,
  check: (r) => {
    assert.equal(r.status, "ready");
    assert.ok(
      ["offered", "deferred"].includes(
        r.evaluation.development!.optimization.status,
      ),
    );
    assert.ok(
      r.evaluation.development!.revisits.some(
        (t) =>
          ["optimization", "independent-recall"].includes(t.kind) &&
          t.status === "open",
      ),
    );
  },
});
const selection = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
const selected = selection
  ? cases.filter((c) => selection.split(",").includes(c.name))
  : cases;
if (!selected.length) throw Error("Unknown case");
const choice = {
  ...resolveAgentChoice(
    readAgentSettings(),
    "reflection coach",
    baselineAgentModel(),
  ),
  effort: "low",
};
const outputs: any[] = [];
const report =
  process.env.DUO_EVAL_REPORT ?? ".local/reflection-development-eval.json";
async function checkCase(c: (typeof cases)[number]) {
  const started = Date.now();
  let output: Awaited<ReturnType<typeof reflect>> | undefined;
  try {
    output = await reflect(c.attempt, choice, c.stage ?? "conversation");
    validateReflection(c.attempt, output.result);
    c.check(output.result);
    outputs.push({
      name: c.name,
      pass: true,
      elapsedMs: Date.now() - started,
      ...output,
    });
    console.log(
      JSON.stringify({
        name: c.name,
        pass: true,
        model: output.model,
        effort: output.effort,
        message: output.result.message,
      }),
    );
  } catch (error) {
    outputs.push({
      name: c.name,
      pass: false,
      error: String(error),
      result: output?.result,
      elapsedMs: Date.now() - started,
    });
    console.error(c.name, String(error));
  }
  writeFileSync(report, JSON.stringify(outputs, null, 2) + "\n");
}
try {
  for (let i = 0; i < selected.length; i += 2)
    await Promise.all(selected.slice(i, i + 2).map(checkCase));
} finally {
  agent().close();
}
if (outputs.some((o) => !o.pass)) process.exitCode = 1;
