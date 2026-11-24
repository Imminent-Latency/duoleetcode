import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Attempt } from "./types";
import type { AgentSettings } from "./agent-settings";
import { resolveBackgroundSettings } from "./agent-settings";
import { pauseAt, solvingTime } from "./assessment-time";
import { replay } from "./recording";
import { reviewTopics } from "./question-review";
import type { ResearchBundle } from "./research-types";

export const chunkCaptureSignals = [
  "replaced-block",
  "example-run",
  "judge-submit",
  "quiet-interval",
  "pause-boundary",
] as const;
export type CaptureSignal = (typeof chunkCaptureSignals)[number];

const text = z.string().trim().min(1).max(1600);
const seq = z.number().int().nonnegative();

export const solvingChunkObservationSchema = z.object({
  kind: z.enum(["representation-fact", "execution-outcome", "potential-detour"]),
  statement: text,
  sequences: z.array(seq).min(1).max(8),
  sourceUrls: z.array(z.string().min(1).max(2000)).max(6),
});

export const solvingChunkQuestionSchema = z.object({
  topic: z.enum(reviewTopics),
  kind: z.enum(["behavior", "intent", "understanding", "technical"]),
  question: z.string().trim().min(1).max(600),
  purpose: z.string().trim().min(1).max(600),
  sequences: z.array(seq).min(1).max(8),
});

export const solvingChunkOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1600),
  observations: z.array(solvingChunkObservationSchema).max(4),
  candidateQuestions: z.array(solvingChunkQuestionSchema).max(3),
});

export const solvingChunkNoteSchema = solvingChunkOutputSchema.extend({
  id: z.string().min(1).max(100),
  startSeq: seq,
  endSeq: seq,
  elapsedMs: z.number().nonnegative(),
  createdAt: z.number(),
  signal: z.enum(chunkCaptureSignals),
  captureContext: z.string().min(1).max(1200),
  model: z.string(),
  effort: z.string(),
  traceId: z.string().optional(),
  sources: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        kind: z.enum(["official-docs", "official-source", "secondary"]),
        version: z.string(),
        retrievedAt: z.number(),
        excerpt: z.string(),
        digest: z.string(),
      }),
    )
    .optional(),
});
export type SolvingChunkNote = z.infer<typeof solvingChunkNoteSchema>;
export type SolvingChunkOutput = z.infer<typeof solvingChunkOutputSchema>;

export type SolvingMilestone = {
  signal: CaptureSignal;
  startSeq: number;
  endSeq: number;
  anchorSeq: number;
  elapsedMs: number;
  captureContext: string;
  jobId?: string;
};

export function stripCommentsAndSpace(javaSource: string) {
  return javaSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "");
}

function normalizedCodeLines(javaSource: string): string[] {
  return javaSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ""))
    .filter((line) => line.length >= 10 && !/^import/.test(line));
}

function codeChangeCount(a: string, b: string) {
  const na = stripCommentsAndSpace(a);
  const nb = stripCommentsAndSpace(b);
  if (na === nb) return 0;
  let prefix = 0;
  const minLen = Math.min(na.length, nb.length);
  while (prefix < minLen && na[prefix] === nb[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    na[na.length - 1 - suffix] === nb[nb.length - 1 - suffix]
  )
    suffix++;
  return Math.max(na.length, nb.length) - prefix - suffix;
}

export function describeCaptureSignal(
  signal: CaptureSignal,
  details: { seq: number; verdict?: string },
): string {
  switch (signal) {
    case "replaced-block":
      return `Code present before event ${details.seq} was removed and followed by new edits without undo or paste-move within the debounce window. Whether the underlying approach changed or is simply being rewritten cleaner is unknown.`;
    case "example-run":
      return `Executed against sample or custom cases at event ${details.seq} with outcome "${details.verdict ?? "completed"}". The editor text may contain partial logic or diagnostic scaffolding; there is no claim of completeness.`;
    case "judge-submit":
      return `Submitted to the full judge at event ${details.seq} with non-accepted outcome "${details.verdict ?? "completed"}". Why it was submitted (thought complete, testing constraints, time pressure, or accidental click) is unknown.`;
    case "quiet-interval":
      return `Captured during a typing lull at event ${details.seq} after elapsed active solving time; no user action marked this code as a finished thought. Ignore mid-construction syntax incompleteness, missing returns, or unused variables.`;
    case "pause-boundary":
      return `Captured when the timer paused at event ${details.seq}; pause reason and duration carry zero meaning about difficulty, attention, or intent. Ignore mid-construction incompleteness.`;
  }
}

export const MAX_SOLVING_CHUNKS = 4;

export function detectSolvingMilestone(
  a: Attempt,
  now = Date.now(),
  settings?: AgentSettings | null,
): SolvingMilestone | null {
  if (!resolveBackgroundSettings(settings).solvingAnalysis) return null;
  if (!["active", "paused"].includes(a.phase) || a.sealed) return null;
  const existing = a.solvingChunks ?? [];
  if (existing.length >= MAX_SOLVING_CHUNKS) return null;

  const currentElapsed = solvingTime(a, now);
  // Suppress new background chunks in the final 75s when the session is about to seal.
  if (a.budgetMs - currentElapsed < 75_000) return null;

  const lastChunk = existing.at(-1);
  const startSeq = lastChunk?.endSeq ?? 0;
  const lastChunkElapsed = lastChunk?.elapsedMs ?? 0;
  if (a.lastSeq <= startSeq) return null;

  // Skip reading / comment-only / boilerplate starts.
  if (codeChangeCount(a.initialSource, a.source) < 40) return null;

  const previousChunkSource = startSeq === 0 ? a.initialSource : replay(a, startSeq);
  const deltaCodeChars = codeChangeCount(previousChunkSource, a.source);
  const completedJobsSince = a.jobs.filter(
    (j) =>
      j.seq > startSeq &&
      j.seq <= a.lastSeq &&
      !["sending", "judging", "unknown"].includes(j.state),
  );
  if (deltaCodeChars < 25 && !completedJobsSince.length) return null;

  const activeEdits = a.events.filter(
    (e) => e.type === "edit" && e.seq > startSeq && !pauseAt(a, e.at),
  );
  const lastEdit = activeEdits.at(-1);
  const lastEditElapsed = lastEdit
    ? solvingTime(a, lastEdit.at)
    : lastChunkElapsed;

  // 1. Non-accepted full Judge Submit.
  const failedSubmit = completedJobsSince.findLast(
    (j) =>
      j.kind === "submit" &&
      !/^accepted$/i.test(String(j.summary?.verdict ?? "")),
  );
  if (failedSubmit) {
    const verdict = String(failedSubmit.summary?.verdict ?? failedSubmit.state);
    return {
      signal: "judge-submit",
      startSeq,
      endSeq: a.lastSeq,
      anchorSeq: failedSubmit.seq,
      elapsedMs: currentElapsed,
      jobId: failedSubmit.id,
      captureContext: describeCaptureSignal("judge-submit", {
        seq: failedSubmit.seq,
        verdict,
      }),
    };
  }

  // 2. Coalesced Example Run (filters rapid Run-fix-Run typo loops).
  const completedRun = completedJobsSince.findLast((j) => j.kind === "run");
  const hasPendingRun = a.jobs.some(
    (j) => j.kind === "run" && ["sending", "judging"].includes(j.state),
  );
  if (completedRun && !hasPendingRun) {
    const runEvent = a.events.find((e) => e.seq === completedRun.seq);
    const runElapsed = runEvent ? solvingTime(a, runEvent.at) : currentElapsed;
    const settledAfterRun = currentElapsed - runElapsed >= 15_000;
    const coalescedFromPrevRun =
      lastChunk?.signal !== "example-run" ||
      currentElapsed - lastChunkElapsed >= 90_000 ||
      deltaCodeChars >= 80;
    if (settledAfterRun && coalescedFromPrevRun) {
      const verdict = String(completedRun.summary?.verdict ?? completedRun.state);
      return {
        signal: "example-run",
        startSeq,
        endSeq: a.lastSeq,
        anchorSeq: completedRun.seq,
        elapsedMs: currentElapsed,
        jobId: completedRun.id,
        captureContext: describeCaptureSignal("example-run", {
          seq: completedRun.seq,
          verdict,
        }),
      };
    }
  }

  // 3. Debounced Replaced Block (filters slip + Undo and cut-and-paste moves).
  const currentNormalized = stripCommentsAndSpace(a.source);
  for (let i = activeEdits.length - 1; i >= 0; i--) {
    const ev = activeEdits[i];
    if (ev.origin === "undo") continue;
    const removedChars = ev.edits?.reduce((n, c) => n + c.length, 0) ?? 0;
    if (removedChars < 60) continue;
    const delElapsed = solvingTime(a, ev.at);
    if (currentElapsed - delElapsed < 25_000) continue;
    if (a.lastSeq <= ev.seq) continue;
    if (currentElapsed - lastEditElapsed < 5_000) continue;

    const beforeDelete = replay(a, ev.seq - 1);
    if (codeChangeCount(a.initialSource, beforeDelete) < 40) continue;
    const afterDelete = replay(a, ev.seq);
    const afterLines = new Set(normalizedCodeLines(afterDelete));
    const starterLines = new Set(normalizedCodeLines(a.initialSource));
    const removedLines = normalizedCodeLines(beforeDelete).filter(
      (line) => !afterLines.has(line) && !starterLines.has(line),
    );
    const totalRemovedChars = removedLines.reduce((n, l) => n + l.length, 0);
    if (totalRemovedChars < 30) continue;

    // If >=50% of the removed logic lines reappeared via Undo or cut-paste move, skip.
    const isRestoredIn = (src: string) => {
      const norm = stripCommentsAndSpace(src);
      const count = removedLines
        .filter((line) => norm.includes(line))
        .reduce((n, l) => n + l.length, 0);
      return count >= totalRemovedChars * 0.5;
    };
    if (isRestoredIn(a.source)) continue;

    // Ensure the code stayed absent across the entire 25s active debounce window
    // (e.g. if it was cut-pasted back and only deleted again <25s ago, wait for debounce).
    const recentRestore = activeEdits.some(
      (later) =>
        later.seq > ev.seq &&
        currentElapsed - solvingTime(a, later.at) < 25_000 &&
        isRestoredIn(replay(a, later.seq - 1)),
    );
    if (recentRestore) continue;

    return {
      signal: "replaced-block",
      startSeq,
      endSeq: a.lastSeq,
      anchorSeq: ev.seq,
      elapsedMs: currentElapsed,
      captureContext: describeCaptureSignal("replaced-block", { seq: ev.seq }),
    };
  }

  // 4. Pause Boundary (once per stretch of meaningful new work).
  if (
    a.phase === "paused" &&
    (currentElapsed - lastChunkElapsed >= 180_000 || deltaCodeChars >= 120)
  ) {
    return {
      signal: "pause-boundary",
      startSeq,
      endSeq: a.lastSeq,
      anchorSeq: a.lastSeq,
      elapsedMs: currentElapsed,
      captureContext: describeCaptureSignal("pause-boundary", {
        seq: a.lastSeq,
      }),
    };
  }

  // 5. Quiet Interval (~5+ active min since last chunk + >=12s typing lull).
  if (
    a.phase === "active" &&
    currentElapsed - lastChunkElapsed >= 300_000 &&
    currentElapsed - lastEditElapsed >= 12_000
  ) {
    return {
      signal: "quiet-interval",
      startSeq,
      endSeq: a.lastSeq,
      anchorSeq: a.lastSeq,
      elapsedMs: currentElapsed,
      captureContext: describeCaptureSignal("quiet-interval", {
        seq: a.lastSeq,
      }),
    };
  }

  return null;
}

export const solvingChunkPolicy = `You record a private, strictly observational background note for one stretch of an active coding session so post-assessment reflection starts faster and preserves meaningful solving history.
Respect captureContext strictly: state ONLY what was observed in the code, edits, and execution results—NEVER assume or state why the user deleted, rewrote, ran, submitted, or paused.
Noise versus teachable detours:
- DISCARD transient construction noise: when signal is quiet-interval or pause-boundary (or mid-edit scaffolding), completely ignore dangling conditionals, missing return statements, unused variables, temporary placeholders, and quick typo fixes.
- PRESERVE meaningful solving detours and facts: record concrete representation properties (representation-fact, such as a map overwriting duplicate keys), test/judge results (execution-outcome), and substantive detours (potential-detour, such as logic built around a missed constraint or edge case), even if the user later modifies or fixes that code. Frame potential-detour items neutrally as observable properties and open questions, never as confirmed misconceptions or final-solution defects.
Verify substantive Java API/library behavior with official Java 25 documentation tools and cite actual retrieved URLs in sourceUrls and Markdown links. Keep summary to 1–3 sentences, observations to at most 4 concise items, and candidateQuestions to at most 3 neutral questions without assumed motives.`;

export function validateSolvingChunkOutput(
  a: Attempt,
  endSeq: number,
  raw: unknown,
  urls?: Set<string>,
): SolvingChunkOutput {
  const parsed = solvingChunkOutputSchema.parse(raw);
  const validSeqs = new Set([
    0,
    ...a.events.filter((e) => e.seq <= endSeq).map((e) => e.seq),
  ]);
  for (const obs of parsed.observations) {
    if (obs.sequences.some((s) => !validSeqs.has(s)))
      throw new Error("Chunk observation cited an out-of-range event sequence.");
    if (urls && obs.sourceUrls.some((u) => !urls.has(u)))
      throw new Error("Chunk observation cited a URL without a retrieval receipt.");
  }
  for (const q of parsed.candidateQuestions) {
    if (q.sequences.some((s) => !validSeqs.has(s)))
      throw new Error("Candidate question cited an out-of-range event sequence.");
  }
  return parsed;
}

export function buildSolvingChunkNote(
  milestone: SolvingMilestone,
  output: SolvingChunkOutput,
  meta: {
    model: string;
    effort: string;
    traceId?: string;
    research?: ResearchBundle;
  },
  now = Date.now(),
): SolvingChunkNote {
  return solvingChunkNoteSchema.parse({
    id: randomUUID(),
    startSeq: milestone.startSeq,
    endSeq: milestone.endSeq,
    elapsedMs: milestone.elapsedMs,
    createdAt: now,
    signal: milestone.signal,
    captureContext: milestone.captureContext,
    summary: output.summary,
    observations: output.observations,
    candidateQuestions: output.candidateQuestions,
    model: meta.model,
    effort: meta.effort,
    traceId: meta.traceId,
    sources: meta.research?.sources,
  });
}
