import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, replay, candidateMoments } from "../lib/recording";
import type { EvidenceEvent } from "../lib/types";

test("atomic multi-cursor changes use original UTF-16 offsets, including emoji and CRLF", () => {
  const before = "a😀b\r\nsecond\r\n";
  assert.equal(
    applyEdits(before, [
      { offset: 6, length: 6, text: "第二" },
      { offset: 1, length: 2, text: "🌱" },
    ]),
    "a🌱b\r\n第二\r\n",
  );
  assert.throws(
    () =>
      applyEdits("abcd", [
        { offset: 0, length: 3, text: "" },
        { offset: 2, length: 1, text: "" },
      ]),
    /Overlapping/,
  );
});
test("recorded undo, redo, IME composition outcomes, paste and reset reconstruct the document", () => {
  let source = "class Solution {}";
  const events: EvidenceEvent[] = [];
  for (const [origin, text] of [
    ["paste", "class Solution { // 😀\n}"],
    ["editor", "class Solution { // 日本語\n}"],
    ["undo", "class Solution { // 😀\n}"],
    ["redo", "class Solution { // 日本語\n}"],
    ["editor", "class Solution {}"],
  ]) {
    const edits = [{ offset: 0, length: source.length, text }];
    events.push({
      seq: events.length + 1,
      at: events.length * 100,
      type: "edit",
      origin,
      edits,
    });
    source = applyEdits(source, edits);
  }
  const a = {
    initialSource: "class Solution {}",
    events,
    checkpoints: [{ seq: 2, source: "class Solution { // 日本語\n}" }],
  };
  assert.equal(replay(a, 0), "class Solution {}");
  assert.equal(replay(a, 3), "class Solution { // 😀\n}");
  assert.equal(replay(a, 5), "class Solution {}");
});
test("60 minute synthetic recording seeks from checkpoints without changing timestamps", () => {
  const events: EvidenceEvent[] = [];
  const checkpoints: { seq: number; source: string }[] = [];
  let source = "";
  for (let i = 1; i <= 18000; i++) {
    const e: EvidenceEvent = {
      seq: i,
      at: i * 200,
      type: "edit",
      edits: [{ offset: source.length, length: 0, text: i % 5 ? "x" : "😀" }],
    };
    events.push(e);
    source = applyEdits(source, e.edits!);
    if (i % 50 === 0) checkpoints.push({ seq: i, source });
  }
  const start = performance.now();
  assert.equal(
    replay({ initialSource: "", events, checkpoints }, 17999),
    source.slice(0, -2),
  );
  assert.ok(performance.now() - start < 250);
  assert.equal(events.at(-1)!.at, 3600000);
});
test("flags are bounded and observations are separate from uncertain interpretations", () => {
  const flags = candidateMoments([
    { seq: 1, at: 0, type: "focus", detail: "hidden" },
    {
      seq: 2,
      at: 100,
      type: "edit",
      edits: [{ offset: 0, length: 100, text: "new" }],
    },
    { seq: 3, at: 200, type: "run" },
    { seq: 4, at: 300, type: "submit" },
  ]);
  assert.equal(flags.length, 3);
  assert.ok(
    flags.every((f) => f.observation && f.interpretation && f.question),
  );
});
