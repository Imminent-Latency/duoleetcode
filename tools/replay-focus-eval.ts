// Opt-in synthetic coach check. Does not write learner attempts or settings.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { reflectionFixture, hashing } from "./reflection-fixture";
import { validateReflection, coachReplayState } from "../lib/reflection";
import { replay } from "../lib/recording";
const a = reflectionFixture();
a.reflection = {
  messages: [
    {
      id: crypto.randomUUID(),
      role: "user",
      text: "Please show the transition from sorting to my HashSet implementation as a replay range. Choose a specific code state within it where pausing is most useful for inspecting the new implementation.",
      createdAt: Date.now(),
    },
  ],
};
try {
  const result = await reflect(a);
  validateReflection(a, result.result);
  const focus = result.result.focus;
  assert.ok(focus && focus.mode !== "snapshot");
  assert.ok(
    focus.pauseSeq != null,
    "Coach should nominate a key snapshot, not just rely on the fallback.",
  );
  assert.equal(replay(a, focus.pauseSeq), hashing);
  const playback = coachReplayState(a, focus);
  assert.equal(playback.playing, true);
  assert.equal(playback.loop, true);
  writeFileSync(
    ".local/replay-focus-eval.json",
    JSON.stringify({ pass: true, ...result, playback }, null, 2),
  );
  console.log(
    JSON.stringify({
      pass: true,
      focus,
      model: result.model,
      effort: result.effort,
    }),
  );
} finally {
  agent().close();
}
