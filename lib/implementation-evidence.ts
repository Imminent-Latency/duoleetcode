import type { Attempt } from "./types";
import { replay } from "./recording";
import { pauseAt, solvingTime } from "./assessment-time";

/** Deterministic retrieval hints, not guesses about algorithms or learner intent. */
export function implementationEvidence(a: Attempt) {
  const edits = a.events.filter((e) => e.type === "edit" && !pauseAt(a, e.at));
  const changes = edits.filter(
    (e) => (e.edits?.reduce((n, c) => n + c.length, 0) ?? 0) >= 60,
  );
  const assistanceLinks = (a.javaHelp ?? []).map((h) => {
    const deliveredSeq = h.deliveredAt ? h.responseSeq : undefined;
    const nearby = changes.find(
      (e) =>
        e.seq > h.requestSeq &&
        solvingTime(a, e.at) - solvingTime(a, h.askedAt) <= 300000,
    );
    return {
      assistanceId: h.id,
      requestSeq: h.requestSeq,
      responseSeq: deliveredSeq ?? null,
      askedElapsedMs: solvingTime(a, h.askedAt),
      deliveredElapsedMs: h.deliveredAt ? solvingTime(a, h.deliveredAt) : null,
      previousEditSeq: edits.findLast((e) => e.seq < h.requestSeq)?.seq ?? null,
      nextEditSeq:
        edits.find((e) => e.seq > (deliveredSeq ?? h.requestSeq))?.seq ?? null,
      nearbyChangeSeq: nearby?.seq ?? null,
    };
  });
  // Prioritize changes linked to reference questions, then large edits. Full
  // history remains accessible through read_evidence; no synthetic events.
  const selected = [
    ...new Set([
      ...assistanceLinks
        .map((h) => h.nearbyChangeSeq)
        .filter((s): s is number => s !== null),
      ...changes.map((e) => e.seq),
    ]),
  ]
    .slice(0, 6)
    .sort((x, y) => x - y);
  return {
    meaning:
      "Temporal associations are retrieval hints, not intent or evidence that an answer was applied. Times exclude pauses. Use read_evidence for omitted or truncated source.",
    assistanceLinks,
    totalChanges: changes.length,
    checkpoints: selected.map((seq) => {
      const before = replay(a, seq - 1),
        after = replay(a, seq);
      return {
        seq,
        elapsedMs: solvingTime(a, a.events.find((e) => e.seq === seq)!.at),
        before: before.slice(0, 10000),
        after: after.slice(0, 10000),
        truncated: before.length > 10000 || after.length > 10000,
      };
    }),
  };
}
