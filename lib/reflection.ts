import { z } from "zod";
import type { Attempt, ReplayFocus } from "./types";
import { solvingTime } from "./assessment-time";
import { questionReviewSchema } from "./question-review";
import {
  latestDevelopment,
  reflectionDevelopmentSchema,
  reflectionDevelopmentOutputSchema,
} from "./reflection-development";

const citation = z.object({
  messageId: z.string(),
  quote: z.string().trim().min(1).max(3000),
});
const finding = z.object({
  skill: z.string().min(1),
  observation: z.string().min(1),
  evidence: z.array(z.number().int()).max(8),
  learnerEvidence: z.array(citation).max(6),
});
const check = z.object({
  status: z.enum(["open", "explained", "inferred", "needs-practice"]),
  evidence: z.array(citation).max(6),
  recordingEvidence: z.array(z.number().int().nonnegative()).max(8),
  assessment: z.string().trim().min(1).max(800),
  uncertainty: z.string().trim().min(1).max(800).nullable(),
});
export const replayFocusSchema = z.object({
  startSeq: z.number().int().nonnegative(),
  endSeq: z.number().int().nonnegative(),
  mode: z.enum(["snapshot", "range", "loop"]),
  label: z.string().min(1).max(160),
  pauseSeq: z.number().int().nonnegative().nullable().optional(),
});
export const reflectionResultSchema = z.object({
  askedQuestionIds: z.array(z.string()).max(4).optional(),
  surfacedQuestionIds: z.array(z.string()).max(12).optional(),
  coachingSelectionNote: z.string().trim().min(1).max(400).optional(),
  message: z.string().trim().min(1).max(10000),
  status: z.enum(["exploring", "ready"]),
  focus: replayFocusSchema.nullable(),
  checks: z.object({
    approach: check,
    timeComplexity: check,
    spaceComplexity: check,
  }),
  evaluation: z.object({
    questionReview: questionReviewSchema.optional(),
    development: reflectionDevelopmentSchema.optional(),
    summary: z.string().min(1).max(3000),
    strengths: z.array(finding).max(3),
    gaps: z.array(finding).max(2),
    moments: z
      .array(
        z.object({
          seq: z.number().int().nonnegative(),
          endSeq: z.number().int().nonnegative().nullable(),
          label: z.string(),
          observation: z.string(),
          interpretation: z.string(),
          question: z.string(),
          confidence: z.enum(["low", "medium", "high"]),
        }),
      )
      .max(5),
    exercise: z.object({
      skill: z.string(),
      title: z.string(),
      prompt: z.string(),
      rubric: z.string(),
    }),
  }),
});
export type ReflectionResult = z.infer<typeof reflectionResultSchema>;
// Inference requires all output keys, while saved/API focus objects remain
// compatible with earlier conversations that did not include a pause point.
// Keep persisted schemas permissive for older records; constrain new output to
// the same status/evidence relationships enforced by validateReflection.
const outputCheck = z.union([
  check.extend({
    status: z.literal("open"),
    uncertainty: z.string().trim().min(1).max(800),
  }),
  check.extend({
    status: z.literal("explained"),
    evidence: z.array(citation).min(1).max(6),
    uncertainty: z.null(),
  }),
  check.extend({
    status: z.literal("inferred"),
    evidence: z.array(citation).min(1).max(6),
    recordingEvidence: z.array(z.number().int().nonnegative()).min(1).max(8),
    uncertainty: z.null(),
  }),
  check.extend({
    status: z.literal("needs-practice"),
    evidence: z.array(citation).min(1).max(6),
  }),
]);
export const reflectionOutputSchema = reflectionResultSchema.extend({
  askedQuestionIds: z.array(z.string()).max(4),
  surfacedQuestionIds: z.array(z.string()).max(12),
  coachingSelectionNote: z.string().trim().min(1).max(400),
  evaluation: reflectionResultSchema.shape.evaluation
    .omit({ questionReview: true })
    .extend({
      development: reflectionDevelopmentOutputSchema,
    }),
  checks: z.object({
    approach: outputCheck,
    timeComplexity: outputCheck,
    spaceComplexity: outputCheck,
  }),
  focus: replayFocusSchema
    .extend({ pauseSeq: z.number().int().nonnegative().nullable() })
    .nullable(),
});
export const latestReflection = (a: Attempt) =>
  a.reflection?.messages.findLast((m) => m.role === "assistant");
export const pendingReflection = (a: Attempt) =>
  a.reflection?.messages.at(-1)?.role === "user"
    ? a.reflection.messages.at(-1)
    : undefined;
export const reflectionReady = (a: Attempt) =>
  !pendingReflection(a) && latestReflection(a)?.status === "ready";

export function validateReflection(a: Attempt, result: ReflectionResult) {
  const seqs = new Set([0, ...a.events.map((e) => e.seq)]);
  const learners = new Map([
    ...(a.reflection?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => [m.id, m.text] as const),
    ...(a.javaHelp ?? []).map((h) => [h.id, h.question] as const),
  ]);
  const validateCitations = (citations: z.infer<typeof citation>[]) => {
    for (const c of citations)
      if (!learners.get(c.messageId)?.includes(c.quote))
        throw new Error(
          "The reflection cited missing learner evidence. Retry the reply.",
        );
  };
  if (result.focus) validateReplayFocus(a, result.focus);
  const development = result.evaluation.development;
  if (development) {
    const ids = new Set(development.approaches.map((p) => p.id));
    const helpIds = new Set((a.javaHelp ?? []).map((h) => h.id));
    if (ids.size !== development.approaches.length)
      throw new Error("Approach IDs must be unique and stable.");
    for (const id of [
      development.baselineApproachId,
      development.activeApproachId,
      development.optimization.approachId,
      ...development.revisits.map((r) => r.approachId),
    ])
      if (id !== null && !ids.has(id))
        throw new Error("An approach reference is missing from development.");
    if (result.status === "ready" && !development.baselineApproachId)
      throw new Error(
        "Name the baseline approach supported by the ready checks.",
      );
    for (const p of development.approaches) {
      if (p.focus) validateReplayFocus(a, p.focus);
      if (p.origin === "recorded" && !p.focus)
        throw new Error("A recorded approach needs a replay anchor.");
      if (p.assistanceIds.some((id) => !helpIds.has(id)))
        throw new Error("An approach cited an unknown Java help question.");
      validateCitations(p.learnerEvidence);
      validateCitations(p.intent.evidence);
      if (p.origin === "learner-proposed" && !p.learnerEvidence.length)
        throw new Error("A proposed approach needs the learner's description.");
      if (
        ["confirmed", "corrected"].includes(p.intent.status) &&
        !p.intent.evidence.length
      )
        throw new Error(
          "Confirmed or corrected intent needs learner evidence; otherwise label it a hypothesis.",
        );
    }
    const revisits = new Map(development.revisits.map((r) => [r.id, r]));
    if (
      development.optimization.status === "demonstrated" &&
      !development.approaches.find(
        (p) => p.id === development.optimization.approachId,
      )?.learnerEvidence.length
    )
      throw new Error(
        "A demonstrated optimization needs learner evidence for that approach; a coach explanation alone is not demonstration.",
      );
    if (revisits.size !== development.revisits.length)
      throw new Error("Revisit IDs must be unique and stable.");
    for (const r of development.revisits) {
      validateCitations(r.learnerEvidence);
      if (
        (!r.evidence.length && !r.learnerEvidence.length) ||
        r.evidence.some((s) => !seqs.has(s))
      )
        throw new Error("A revisit needs valid recording or learner evidence.");
      if (r.status !== "open" && !r.learnerEvidence.length)
        throw new Error(
          "Resolving or dismissing a revisit requires learner evidence.",
        );
    }
    const previous =
      latestDevelopment(a) ?? a.reflection?.analysis?.development;
    for (const r of previous?.revisits ?? []) {
      if (r.status === "open" && !revisits.has(r.id))
        throw new Error(
          "Preserve outstanding revisit targets; resolve or dismiss them explicitly with evidence.",
        );
    }
    if (
      development.optimization.status === "offered" &&
      !development.revisits.some(
        (r) =>
          r.status === "open" &&
          ["optimization", "independent-recall"].includes(r.kind),
      )
    )
      throw new Error(
        "An optional optimization offer needs a saved future revisit target.",
      );
    validateCitations(development.baselineCorrection);
    const prior = latestReflection(a);
    if (
      prior?.status === "ready" &&
      previous &&
      (result.status !== "ready" ||
        development.baselineApproachId !== previous.baselineApproachId)
    ) {
      const newLearners = new Set(
        (a.reflection?.messages ?? [])
          .slice(
            (a.reflection?.messages ?? []).findIndex((m) => m.id === prior.id) +
              1,
          )
          .filter((m) => m.role === "user")
          .map((m) => m.id),
      );
      if (
        !development.baselineCorrection.some((c) =>
          newLearners.has(c.messageId),
        )
      )
        throw new Error(
          "Keep the established baseline ready during optional exploration; only new contradictory learner evidence can change it.",
        );
    }
  }
  for (const m of result.evaluation.moments)
    if (
      !seqs.has(m.seq) ||
      (m.endSeq !== null && (!seqs.has(m.endSeq) || m.endSeq < m.seq))
    )
      throw new Error("The coach flagged an unknown recording moment.");
  for (const f of [...result.evaluation.strengths, ...result.evaluation.gaps]) {
    if (!f.evidence.length && !f.learnerEvidence.length)
      throw new Error("A takeaway is missing evidence.");
    if (f.evidence.some((seq) => !seqs.has(seq)))
      throw new Error("A takeaway cited an unknown recording event.");
    validateCitations(f.learnerEvidence);
  }
  for (const [topic, c] of Object.entries(result.checks)) {
    validateCitations(c.evidence);
    if (c.recordingEvidence.some((seq) => !seqs.has(seq)))
      throw new Error("An explanation check cited an unknown recording event.");
    if (c.status !== "open" && !c.evidence.length)
      throw new Error("An explanation check needs learner evidence.");
    if (c.status === "inferred" && !c.recordingEvidence.length)
      throw new Error("An inference needs supporting recording evidence.");
    if (c.status === "open" && !c.uncertainty?.trim())
      throw new Error(
        `The ${topic} explanation check is open: name the material uncertainty that remains.`,
      );
    if (["explained", "inferred"].includes(c.status) && c.uncertainty !== null)
      throw new Error(
        `The ${topic} explanation check is ${c.status}: set uncertainty to null, or leave it open if material uncertainty remains.`,
      );
  }
  if (
    result.status === "ready" &&
    Object.values(result.checks).some(
      (c) => !["explained", "inferred"].includes(c.status),
    )
  )
    throw new Error("The reflection still has unanswered explanation checks.");
  return result;
}

// Playback excludes pauses without rewriting the original recording.
export function recordingDuration(a: Attempt) {
  return a.events.reduce(
    (end, e) => Math.max(end, solvingTime(a, e.at)),
    Math.max(1, solvingTime(a, a.endedAt ?? a.deadline)),
  );
}
export function timeAtSequence(a: Attempt, seq: number) {
  return seq === 0
    ? 0
    : solvingTime(a, a.events.find((e) => e.seq === seq)?.at ?? a.createdAt);
}
export function focusTimes(a: Attempt, focus: ReplayFocus): [number, number] {
  return [timeAtSequence(a, focus.startSeq), timeAtSequence(a, focus.endSeq)];
}
export function validateReplayFocus(a: Attempt, focus: ReplayFocus) {
  const seqs = new Set([0, ...a.events.map((e) => e.seq)]);
  if (
    !seqs.has(focus.startSeq) ||
    !seqs.has(focus.endSeq) ||
    focus.endSeq < focus.startSeq ||
    (focus.mode === "snapshot"
      ? focus.startSeq !== focus.endSeq
      : focus.startSeq === focus.endSeq)
  )
    throw new Error("The coach selected an invalid recording range.");
  if (
    focus.pauseSeq != null &&
    (!seqs.has(focus.pauseSeq) ||
      focus.pauseSeq < focus.startSeq ||
      focus.pauseSeq > focus.endSeq)
  )
    throw new Error(
      "The pause point must be a recorded snapshot within the selected range.",
    );
  return focus;
}
// Older replies did not nominate a pause point. Prefer the last changed code
// in their range, then the end snapshot if the range contains no edits.
export function replayPauseSequence(a: Attempt, focus: ReplayFocus) {
  if (
    focus.pauseSeq != null &&
    focus.pauseSeq >= focus.startSeq &&
    focus.pauseSeq <= focus.endSeq &&
    (focus.pauseSeq === 0 || a.events.some((e) => e.seq === focus.pauseSeq))
  )
    return focus.pauseSeq;
  return (
    a.events.findLast(
      (e) =>
        e.type === "edit" && e.seq >= focus.startSeq && e.seq <= focus.endSeq,
    )?.seq ?? focus.endSeq
  );
}
export function coachReplayState(a: Attempt, focus: ReplayFocus) {
  const range = focusTimes(a, focus),
    pauseSeq = replayPauseSequence(a, focus);
  const playing = focus.mode !== "snapshot" && range[1] > range[0];
  const seq = playing ? focus.startSeq : pauseSeq;
  return {
    range,
    pauseSeq,
    seq,
    at: timeAtSequence(a, seq),
    playing,
    loop: playing,
  };
}
export function playbackPosition(
  from: number,
  elapsed: number,
  start: number,
  end: number,
  loop: boolean,
) {
  if (end <= start) return { at: start, playing: false };
  const at = Math.max(start, from) + Math.max(0, elapsed);
  return loop
    ? {
        at: Math.min(end, start + ((at - start) % (end - start + 800))),
        playing: true,
      }
    : { at: Math.min(at, end), playing: at < end };
}
