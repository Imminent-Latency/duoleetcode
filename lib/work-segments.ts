import type { Attempt, WorkSegment } from "./types";

// The assessment timer is authoritative. Do not count browser focus, review
// visits, or the time between coaching messages as work.
export function workSegments(a: Attempt): WorkSegment[] {
  const segments: WorkSegment[] = [];
  let start = a.createdAt;
  const append = (
    endedAt: number | null,
    endReason?: "pause" | "assessment-ended",
  ) => {
    segments.push({
      id: "assessment-" + (segments.length + 1),
      kind: "assessment",
      startedAt: start,
      endedAt,
      ...(endReason ? { endReason } : {}),
    });
  };
  let stopped = false;
  for (const pause of a.pauses) {
    if (a.endedAt !== undefined && pause.start >= a.endedAt) break;
    append(pause.start, "pause");
    if (
      pause.end === undefined ||
      (a.endedAt !== undefined && pause.end >= a.endedAt)
    ) {
      stopped = true;
      break;
    }
    start = pause.end;
  }
  if (!stopped) {
    if (a.endedAt !== undefined) append(a.endedAt, "assessment-ended");
    else if (a.phase === "active") append(null);
  }
  return [
    ...segments,
    ...(a.workSegments ?? []).filter((s) => s.kind === "continuation"),
  ];
}
