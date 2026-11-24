import type { Attempt } from "./types";
export function recommend(history: Attempt[]) {
  const active = history.find(
    (a) => a.phase === "active" || a.phase === "paused",
  );
  if (active)
    return {
      title: "Resume your assessment",
      slug: active.problem.titleSlug,
      reason:
        "Your current attempt is saved. Return to it before starting a new session.",
      kind: "continue",
      basedOn: active.id,
      revisitAt: Date.now(),
    };
  const unfinished = history.find(
    (a) => a.phase === "review" || a.phase === "learn",
  );
  if (unfinished)
    return {
      title: "Finish your learning loop",
      slug: unfinished.problem.titleSlug,
      reason:
        "Return to your saved review or conversation. You can also skip coaching and move on.",
      kind: "continue",
      basedOn: unfinished.id,
      revisitAt: Date.now(),
    };
  return null;
}
