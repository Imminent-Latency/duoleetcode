// End-to-end live verification of role-paired Low-effort ACP teams:
// 1. Claude Team (Low): Opus 5.5 for coaching & reflection v10 + Sonnet 5.5 for Java help
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  agent,
  answerJavaReference,
  coach,
  reflect,
} from "../lib/agents";
import { availableTeamProfiles } from "../lib/agent-settings";
import { validateUnderstanding } from "../lib/coaching";
import { demoProblem } from "../lib/demo";
import type { Attempt } from "../lib/types";
import { reflectionFixture } from "./reflection-fixture";

if (process.env.DUO_DATABASE !== ":memory:") {
  throw new Error(
    "Run tools/acp-workflow-eval.ts with DUO_DATABASE=:memory: and DUO_TRACE_DATABASE=.local/acp-workflow-eval.sqlite",
  );
}

function makeCoachingAttempt(answer: string): Attempt {
  return {
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
  };
}

const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  teams: {},
};

try {
  agent().includeAcpModels = true;
  const catalog = await agent().models();
  const profiles = availableTeamProfiles(catalog).filter(
    (p) => p.id === "claude-low",
  );
  assert.equal(
    profiles.length,
    1,
    "claude-low role-paired team profile must be discovered",
  );

  for (const team of profiles) {
    console.log(
      `\n=== Testing ${team.label}: deep=${team.features.reflection.model} (${team.features.reflection.effort}), fast=${team.features.reference.model} (${team.features.reference.effort}) ===`,
    );
    const entry: Record<string, any> = {
      deepModel: team.features.reflection,
      fastModel: team.features.reference,
    };
    report.teams[team.id] = entry;

    // 1. Fast lookup tier (`reference`): Java 25 API reference lookup + official doc verification + audit
    const tRef = Date.now();
    const refAns = await answerJavaReference(
      "What does HashMap.put(K key, V value) return in Java 25 when the key already had a mapping?",
      [],
      undefined,
      team.features.reference,
    );
    assert.equal(refAns.kind, "reference", `${team.id}: Java help kind=reference`);
    assert.ok(
      refAns.sources.some((u) => u.includes("docs.oracle.com") && u.includes("HashMap")),
      `${team.id}: Java help must verify official Oracle HashMap Javadoc`,
    );
    entry.javaHelpFastTier = {
      model: refAns.model,
      effort: refAns.effort,
      elapsedMs: Date.now() - tRef,
      sources: refAns.sources,
      auditPasses: refAns.research?.audit?.passes ?? null,
      answerPreview: refAns.answer.slice(0, 220),
    };
    console.log(
      `[PASS] Java help (${team.features.reference.model}): ${(entry.javaHelpFastTier.elapsedMs / 1000).toFixed(1)}s`,
    );

    // 2. Deep coaching tier (`coaching`): sound invariant explanation -> sufficient / independent
    const tCoach1 = Date.now();
    const soundAttempt = makeCoachingAttempt(
      "seenInts should contain all previously seen ints, not the element currently being checked. If we add(i) before contains(i), contains(i) matches the element we just added, returning true even for [7] with no duplicate.",
    );
    const coachSound = await coach(soundAttempt, undefined, team.features.coaching);
    const soundUnderstanding = validateUnderstanding(soundAttempt, coachSound);
    assert.equal(
      soundUnderstanding.status,
      "sufficient",
      `${team.id}: sound invariant should mark sufficient`,
    );
    assert.equal(
      coachSound.outcome,
      "independent",
      `${team.id}: first response should be independent`,
    );
    entry.coachingSufficient = {
      model: team.features.coaching.model,
      elapsedMs: Date.now() - tCoach1,
      status: soundUnderstanding.status,
      outcome: coachSound.outcome,
      auditPasses: coachSound.research?.audit?.passes ?? null,
      feedbackPreview: coachSound.feedback.slice(0, 240),
    };
    console.log(
      `[PASS] Focused coaching sound (${team.features.coaching.model}): ${(entry.coachingSufficient.elapsedMs / 1000).toFixed(1)}s`,
    );

    // 3. Deep coaching tier (`coaching`): misconception -> needs-evidence
    const tCoach2 = Date.now();
    const miscAttempt = makeCoachingAttempt(
      "If we put seenInts.add(i) before seenInts.contains(i), on [7] add(7) runs and contains(7) returns false because 7 only appeared once.",
    );
    const coachMisc = await coach(miscAttempt, undefined, team.features.coaching);
    const miscUnderstanding = validateUnderstanding(miscAttempt, coachMisc);
    assert.equal(
      miscUnderstanding.status,
      "needs-evidence",
      `${team.id}: misconception should require evidence`,
    );
    entry.coachingMisconception = {
      model: team.features.coaching.model,
      elapsedMs: Date.now() - tCoach2,
      status: miscUnderstanding.status,
      outcome: coachMisc.outcome,
      auditPasses: coachMisc.research?.audit?.passes ?? null,
      feedbackPreview: coachMisc.feedback.slice(0, 240),
    };
    console.log(
      `[PASS] Focused coaching misconception (${team.features.coaching.model}): ${(entry.coachingMisconception.elapsedMs / 1000).toFixed(1)}s`,
    );

    // 4. Deep reflection tier (`reflection`): full multi-stage v10 Reflection pipeline
    const tReflect = Date.now();
    const reflAttempt = reflectionFixture();
    reflAttempt.demonstration = true;
    reflAttempt.reflection = {
      messages: [
        {
          id: "tradeoff",
          role: "user",
          text: "I wanted to improve runtime. Sorting was O(n log n), whereas checking and adding into a HashSet runs in O(n) average time using O(n) extra space for up to n distinct elements.",
          createdAt: Date.now(),
        },
      ],
    };
    const refl = await reflect(reflAttempt, team.features.reflection);
    const qr = refl.result.evaluation.questionReview;
    assert.ok(
      qr && qr.questions.length > 0,
      `${team.id}: questionReview populated`,
    );
    assert.equal(
      refl.result.status,
      "ready",
      `${team.id}: supported tradeoff reflection should complete ready`,
    );
    entry.reflectionV10 = {
      model: refl.model,
      elapsedMs: Date.now() - tReflect,
      status: refl.result.status,
      questionCount: qr.questions.length,
      revision: qr.revision,
      sourcesRetrieved: refl.research?.sources.length ?? 0,
      auditPasses: refl.research?.audit?.passes ?? null,
      messagePreview: refl.result.message.slice(0, 280),
    };
    console.log(
      `[PASS] Reflection v10 (${team.features.reflection.model}): ${(entry.reflectionV10.elapsedMs / 1000).toFixed(1)}s (${qr.questions.length} questions, status=${refl.result.status})`,
    );
  }

  report.completedAt = new Date().toISOString();
  mkdirSync(path.join(process.cwd(), ".local"), { recursive: true });
  writeFileSync(
    path.join(process.cwd(), ".local", "acp-workflow-eval.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log("\nALL ROLE-PAIRED ACP TEAM WORKFLOW CHECKS PASSED!");
} finally {
  agent().close();
}
