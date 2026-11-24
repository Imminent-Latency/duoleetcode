// Isolated end-to-end live check of Phase A (usage ledger), Phase B (pre-intake review),
// and Phase C (mid-session milestone chunks) on the full 1,185-event Stock recording.
// Never opens or modifies live practice data, snapshots, or settings.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  agent,
  analyzeAttemptSolvingChunk,
  prepareQuestionReview,
  reflect,
} from "../lib/agents";
import { traces } from "../lib/agent-traces";
import { resolveAgentChoice } from "../lib/agent-settings";
import {
  baselineAgentModel,
  readAgentSettings,
} from "../lib/agent-settings-store";
import { detectSolvingMilestone } from "../lib/solving-chunks";
import { replay } from "../lib/recording";
import { pauseAt } from "../lib/assessment-time";
import { validateReflection } from "../lib/reflection";
import type { Attempt } from "../lib/types";

if (process.env.DUO_DATABASE !== ":memory:")
  throw Error(
    "Run solving-chunks-eval with DUO_DATABASE=:memory: and an isolated DUO_TRACE_DATABASE.",
  );

const rawCapture = JSON.parse(
  readFileSync(
    new URL("../.local/stock-conversation-review.json", import.meta.url),
    "utf8",
  ),
) as Attempt;

const choice = {
  ...resolveAgentChoice(
    readAgentSettings(),
    "reflection coach",
    baselineAgentModel(),
  ),
  effort: "low",
};

const reportPath =
  process.env.DUO_EVAL_REPORT ?? ".local/solving-chunks-eval.json";

function sliceAttemptAtSeq(full: Attempt, seq: number, now: number): Attempt {
  const paused = pauseAt(full, now);
  return {
    ...structuredClone(full),
    phase: paused ? "paused" : "active",
    sealed: false,
    endedAt: undefined,
    lastSeq: seq,
    source: replay(full, seq),
    events: full.events.filter((e) => e.seq <= seq),
    checkpoints: full.checkpoints.filter((c) => c.seq <= seq),
    jobs: full.jobs.filter((j) => j.seq <= seq),
    javaHelp: (full.javaHelp ?? []).filter((h) => h.requestSeq <= seq),
    evaluations: [],
    reflection: undefined,
    solvingChunks: [],
  };
}

try {
  // Simulate stepping through the real 1,185-event Stock recording every ~15s of wall time
  // to trigger natural milestone chunks just like the live server does.
  const carriedChunks: NonNullable<Attempt["solvingChunks"]> = [];
  const chunkTimings: { signal: string; startSeq: number; endSeq: number; elapsedMs: number }[] = [];

  const startAt = rawCapture.createdAt;
  const endAt = rawCapture.events.at(-1)!.at;
  for (let t = startAt + 30_000; t <= endAt; t += 15_000) {
    const seqAtT =
      rawCapture.events.findLast((e) => e.at <= t)?.seq ?? 0;
    if (!seqAtT) continue;
    const partial = sliceAttemptAtSeq(rawCapture, seqAtT, t);
    partial.solvingChunks = structuredClone(carriedChunks);
    const milestone = detectSolvingMilestone(partial, t);
    if (!milestone) continue;
    const t0 = Date.now();
    const note = await traces().start({
      role: "solving analysis",
      kind: "workflow",
      attemptId: partial.id,
      mode: "practice",
    });
    let saved;
    try {
      const { traceScope } = await import("../lib/agent-traces");
      saved = await traceScope.run(note, () =>
        analyzeAttemptSolvingChunk(partial, milestone, choice),
      );
      note.finish("succeeded");
    } catch (e) {
      note.finish("failed", String(e));
      throw e;
    }
    const wallMs = Date.now() - t0;
    carriedChunks.push(saved);
    chunkTimings.push({
      signal: saved.signal,
      startSeq: saved.startSeq,
      endSeq: saved.endSeq,
      elapsedMs: wallMs,
    });
    console.log(
      JSON.stringify({
        stage: "solving-chunk",
        signal: saved.signal,
        range: [saved.startSeq, saved.endSeq],
        wallMs,
        summary: saved.summary,
      }),
    );
  }

  assert.ok(
    carriedChunks.length >= 1,
    "Expected at least one natural milestone chunk during the 25-minute Stock session",
  );

  // Seal the session and run Phase B (Prepare review during intake — no draft Coach call!).
  const sealed: Attempt = {
    ...structuredClone(rawCapture),
    phase: "review",
    sealed: true,
    evaluations: [],
    solvingChunks: structuredClone(carriedChunks),
    reflection: { messages: [] },
  };

  const prepStart = Date.now();
  const prepTrace = traces().start({
    role: "prepare",
    kind: "workflow",
    attemptId: sealed.id,
    mode: "practice",
  });
  const { traceScope } = await import("../lib/agent-traces");
  const prepared = await traceScope.run(prepTrace, () =>
    prepareQuestionReview(sealed, choice),
  );
  prepTrace.finish("succeeded");
  const preIntakeWallMs = Date.now() - prepStart;
  sealed.reflection!.questionReview = structuredClone(prepared.review);
  sealed.reflection!.preparedReviewAt = Date.now();

  // Now submit the 3-question intake form and measure post-Continue wait time!
  const intakeMsg = structuredClone(rawCapture.reflection!.messages[0]);
  sealed.reflection!.intake = {
    id: intakeMsg.id,
    familiarity: "new",
    spaceComplexity: "O(nlogn)",
    timeComplexity: "O(n)",
    submittedAt: Date.now(),
  };
  sealed.reflection!.messages = [intakeMsg];

  const continueStart = Date.now();
  const reflectTrace = traces().start({
    role: "reflect",
    kind: "workflow",
    attemptId: sealed.id,
    mode: "practice",
  });
  const firstTurn = await traceScope.run(reflectTrace, () =>
    reflect(sealed, choice, "conversation"),
  );
  reflectTrace.finish("succeeded");
  const postContinueWallMs = Date.now() - continueStart;
  validateReflection(sealed, firstTurn.result);

  const usage = traces().usageSummary("practice");
  const fiveHour = usage.windows.find((w) => w.windowKey === "last5h")!;

  const report = {
    chunksCount: carriedChunks.length,
    chunkTimings,
    chunks: carriedChunks,
    preIntakeWallMs,
    postContinueWallMs,
    firstTurnStatus: firstTurn.result.status,
    askedQuestionIds: firstTurn.result.askedQuestionIds,
    surfacedQuestionIds: firstTurn.result.surfacedQuestionIds,
    coachingSelectionNote: firstTurn.result.coachingSelectionNote,
    message: firstTurn.result.message,
    usageFiveHour: fiveHour,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      pass: true,
      chunksCount: carriedChunks.length,
      preIntakeWallMs,
      postContinueWallMs,
      totalCalls: fiveHour.calls,
      totalTokens: fiveHour.totalTokens,
      byFeature: fiveHour.byFeature.map((f) => ({
        feature: f.key,
        calls: f.calls,
        tokens: f.totalTokens,
      })),
    }),
  );
} finally {
  agent().close();
}
