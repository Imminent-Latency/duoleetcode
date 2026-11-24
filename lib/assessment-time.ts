import type { Attempt, EvidenceEvent } from "./types";

type Timing = Pick<Attempt, "createdAt" | "pauses"> &
  Partial<Pick<Attempt, "endedAt">>;

/** Wall-clock evidence is immutable; playback uses active solving time. */
export function solvingTime(a: Timing, at: number): number {
  const end = Math.max(a.createdAt, Math.min(at, a.endedAt ?? Infinity));
  let paused = 0,
    through = a.createdAt;
  for (const pause of [...a.pauses].sort((x, y) => x.start - y.start)) {
    const start = Math.max(a.createdAt, through, pause.start);
    const stop = Math.min(end, pause.end ?? end);
    if (stop > start) {
      paused += stop - start;
      through = stop;
    }
  }
  return Math.max(0, end - a.createdAt - paused);
}

export function pauseAt(a: Pick<Attempt, "pauses">, at: number) {
  return a.pauses.find((p) => at >= p.start && at < (p.end ?? Infinity));
}

/** Also used optimistically by the recovery buffer, before the network replies. */
export function applyPauseEvent(a: Attempt, e: EvidenceEvent) {
  if (
    e.type === "pause" &&
    e.at < a.deadline &&
    (a.phase === "active" ||
      (a.phase === "review" && !a.sealed && a.endedAt === a.deadline))
  ) {
    a.phase = "paused";
    delete a.endedAt;
    a.pauses = [
      ...a.pauses,
      {
        start: e.at,
        reason:
          e.origin === "window-blur" || e.origin === "tab-hidden"
            ? e.origin
            : "manual",
      },
    ];
  } else if (e.type === "resume" && a.phase === "paused") {
    const pause = a.pauses.at(-1)!;
    a.pauses = [...a.pauses.slice(0, -1), { ...pause, end: e.at }];
    a.deadline += e.at - pause.start;
    a.phase = "active";
  }
}

/** Pause metadata references the original events, so exports retain every observation. */
export function pauseMetadata(
  a: Pick<Attempt, "createdAt" | "pauses" | "events" | "endedAt">,
  now = Date.now(),
) {
  return a.pauses.map((pause, index) => ({
    ...pause,
    index,
    reason: pause.reason ?? "manual",
    elapsedMs: solvingTime(a, pause.start),
    durationMs: Math.max(0, (pause.end ?? a.endedAt ?? now) - pause.start),
    activity: a.events
      .filter(
        (e) =>
          ["focus", "pause-activity"].includes(e.type) &&
          e.at >= pause.start &&
          e.at < (pause.end ?? Infinity),
      )
      .map(({ seq, at, type, detail }) => ({
        seq,
        at,
        afterPauseMs: at - pause.start,
        type,
        detail,
      })),
  }));
}

export function timedEvidence(a: Attempt) {
  return a.events
    .filter(
      (e) =>
        !(["focus", "pause-activity"].includes(e.type) && pauseAt(a, e.at)),
    )
    .map(({ at, ...event }) => ({ ...event, elapsedMs: solvingTime(a, at) }));
}
