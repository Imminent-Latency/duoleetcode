import type { Attempt, Edit, EvidenceEvent, Moment } from "./types";
import { pauseAt, solvingTime } from "./assessment-time";

export function sameEvent(
  a: EvidenceEvent | undefined,
  b: EvidenceEvent,
): boolean {
  const canonical = (e: EvidenceEvent) =>
    JSON.stringify([
      e.seq,
      e.at,
      e.type,
      e.version,
      e.origin,
      e.detail,
      e.jobId,
      e.assistanceId,
      e.assistanceStage,
      e.edits?.map((c) => [c.offset, c.length, c.text]),
    ]);
  return !!a && canonical(a) === canonical(b);
}

// Monaco offsets and JS string offsets are both UTF-16 code units. A change event
// is atomic: every offset refers to the same pre-change document.
export function applyEdits(source: string, edits: Edit[]): string {
  let boundary = source.length;
  for (const edit of [...edits].sort((a, b) => b.offset - a.offset)) {
    if (
      !Number.isInteger(edit.offset) ||
      !Number.isInteger(edit.length) ||
      edit.offset < 0 ||
      edit.length < 0 ||
      edit.offset + edit.length > boundary
    )
      throw new Error("Overlapping or invalid document change");
    source =
      source.slice(0, edit.offset) +
      edit.text +
      source.slice(edit.offset + edit.length);
    boundary = edit.offset;
  }
  return source;
}
export function replay(
  attempt: Pick<Attempt, "initialSource" | "events" | "checkpoints">,
  seq: number,
): string {
  const checkpoint = [...attempt.checkpoints]
    .reverse()
    .find((c) => c.seq <= seq);
  let source = checkpoint?.source ?? attempt.initialSource;
  for (const e of attempt.events)
    if (e.seq > (checkpoint?.seq ?? 0) && e.seq <= seq && e.type === "edit")
      source = applyEdits(source, e.edits ?? []);
  return source;
}
export function candidateMoments(
  events: EvidenceEvent[],
  timing?: Pick<Attempt, "createdAt" | "pauses">,
): Moment[] {
  const candidates: { score: number; moment: Moment }[] = [];
  let previous: EvidenceEvent | undefined;
  for (const e of events) {
    if (
      e.type === "pause" ||
      e.type === "resume" ||
      e.type === "pause-activity" ||
      (timing && pauseAt(timing, e.at))
    ) {
      previous = undefined;
      continue;
    }
    const gap = previous
      ? timing
        ? solvingTime(timing, e.at) - solvingTime(timing, previous.at)
        : e.at - previous.at
      : 0;
    const removed = e.edits?.reduce((s, c) => s + c.length, 0) ?? 0;
    const added = e.edits?.reduce((s, c) => s + c.text.length, 0) ?? 0;
    if (removed >= 60)
      candidates.push({
        score: 4,
        moment: {
          seq: e.seq,
          label: "Implementation changed",
          observation: `${removed} characters removed; ${added} inserted in one edit.`,
          interpretation:
            "This may reflect a change in approach, cleanup, or a replacement paste.",
          question: "What prompted this change?",
          confidence: "low",
        },
      });
    else if (e.type === "edit" && previous && gap >= 90000)
      candidates.push({
        score: 2,
        moment: {
          seq: e.seq,
          label: "Work resumed",
          observation: `${Math.round(gap / 1000)} seconds of active solving time between observed events.`,
          interpretation:
            "The recording does not establish what happened during this interval.",
          question:
            "Were you thinking through the approach, interrupted, or working elsewhere?",
          confidence: "low",
        },
      });
    if (e.type === "focus" && e.detail === "hidden")
      candidates.push({
        score: 1,
        moment: {
          seq: e.seq,
          label: "Page left view",
          observation: "The page reported that it was hidden.",
          interpretation:
            "This may have been a reference check or an interruption; the destination is unknown.",
          question: "Was this relevant to your solution?",
          confidence: "low",
        },
      });
    if (e.type === "run" || e.type === "submit")
      candidates.push({
        score: 3,
        moment: {
          seq: e.seq,
          label:
            e.type === "run" ? "Testing a snapshot" : "Submitting a snapshot",
          observation:
            "The exact source at this point was saved with the judge request.",
          interpretation:
            "The result can help locate the transition from implementation to validation.",
          question: "What were you trying to validate here?",
          confidence: "medium",
        },
      });
    previous = e;
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.moment)
    .sort((a, b) => a.seq - b.seq);
}
export function clockRemaining(
  a: Pick<Attempt, "phase" | "deadline" | "pauses">,
  now = Date.now(),
) {
  return Math.max(
    0,
    a.deadline - (a.phase === "paused" ? (a.pauses.at(-1)?.start ?? now) : now),
  );
}
