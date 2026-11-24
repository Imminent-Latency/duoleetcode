import { test } from "node:test";
import assert from "node:assert/strict";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import type { EvidenceEvent } from "../lib/types";
const start = 1000000;
test("familiarity defaults to new and remembers only explicit non-test reflections", () => {
  const db = new AttemptStore(":memory:");
  const first = db.create(demoProblem, 60000, false, start);
  assert.equal(first.exposure, "new");
  assert.equal(first.exposureSource, "default");
  assert.throws(
    () => db.setExposure(first.id, "revisit", start + 1),
    /after the assessment/,
  );
  db.transition(first.id, "finish", start + 2);
  assert.equal(db.create(demoProblem, 60000, false, start + 3).exposure, "new");
  const seen = db.setExposure(first.id, "revisit", start + 4);
  assert.equal(seen.source, first.source);
  assert.deepEqual(seen.events, first.events);
  assert.equal(
    db.create(demoProblem, 60000, false, start + 5).exposure,
    "revisit",
  );
  db.setExposure(first.id, "solved", start + 6);
  const remembered = db.create(demoProblem, 60000, false, start + 7);
  assert.equal(remembered.exposure, "solved");
  assert.equal(remembered.exposureSource, "remembered");
  assert.equal(
    db.create(
      { ...demoProblem, titleSlug: "another-problem" },
      60000,
      false,
      start + 8,
    ).exposure,
    "new",
  );
  const demonstration = db.create(demoProblem, 60000, true, start + 9);
  assert.equal(demonstration.exposure, "new");
  db.transition(demonstration.id, "finish", start + 10);
  db.setExposure(demonstration.id, "new", start + 11);
  assert.equal(
    db.create(demoProblem, 60000, false, start + 12).exposure,
    "solved",
  );
  db.setExposure(first.id, "new", start + 13);
  db.setExposure(demonstration.id, "solved", start + 14);
  assert.equal(
    db.create(demoProblem, 60000, false, start + 15).exposure,
    "new",
  );
  assert.equal(db.get(first.id, start + 16).exposure, "new");
  assert.equal(db.get(remembered.id, start + 16).exposure, "solved");
  db.db.close();
});
test("finishing a long explicit pause keeps the real boundary timestamp", () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true, start);
  db.transition(a.id, "pause", start + 10000);
  db.append(
    a.id,
    [
      {
        seq: 1,
        at: start + 90000,
        type: "finish",
        detail: "finished while paused",
      },
    ],
    start + 90000,
  );
  const final = db.transition(a.id, "finish", start + 90000);
  assert.equal(final.endedAt, start + 90000);
  assert.equal(final.events[0].at, final.endedAt);
  assert.equal(final.source, a.initialSource);
  db.db.close();
});
test("recording retries are idempotent; conflicts and gaps roll back atomically", () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true, start);
  const e: EvidenceEvent = {
    seq: 1,
    at: start + 1,
    type: "edit",
    version: 2,
    edits: [{ offset: 0, length: 0, text: "// note\n" }],
  };
  db.append(a.id, [e], start + 2);
  db.append(a.id, [e], start + 3);
  assert.equal(db.get(a.id, start + 4).events.length, 1);
  assert.throws(
    () =>
      db.append(
        a.id,
        [
          { ...e, seq: 2, version: 3 },
          { ...e, seq: 4, version: 4 },
        ],
        start + 5,
      ),
    /gap/,
  );
  assert.equal(db.get(a.id, start + 6).lastSeq, 1);
  assert.throws(
    () => db.append(a.id, [{ ...e, origin: "changed" }], start + 6),
    /Conflicting/,
  );
  db.db.close();
});
test("explicit pause excludes editing and extends deadline; focus events do not", () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, false, start);
  db.append(
    a.id,
    [{ seq: 1, at: start + 1000, type: "focus", detail: "hidden" }],
    start + 1000,
  );
  assert.equal(db.get(a.id, start + 1000).deadline, start + 60000);
  db.transition(a.id, "pause", start + 10000);
  assert.equal(db.get(a.id, start + 100000).phase, "paused");
  assert.throws(
    () =>
      db.append(
        a.id,
        [{ seq: 2, at: start + 11000, type: "edit", version: 2, edits: [] }],
        start + 11000,
      ),
    /pause/,
  );
  const resumed = db.transition(a.id, "resume", start + 100000);
  assert.equal(resumed.deadline, start + 150000);
  assert.equal(db.get(a.id, start + 150001).phase, "review");
  db.db.close();
});
test("deadline survives reload; buffered pre-deadline edits recover before sealing", () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, false, start);
  assert.equal(db.get(a.id, start + 70000).endedAt, start + 60000);
  const e: EvidenceEvent = {
    seq: 1,
    at: start + 59000,
    type: "edit",
    version: 2,
    edits: [{ offset: 0, length: 0, text: "// last valid edit\n" }],
  };
  db.append(a.id, [e], start + 70001);
  assert.ok(
    db.get(a.id, start + 70002).source.startsWith("// last valid edit"),
  );
  assert.throws(
    () =>
      db.append(
        a.id,
        [{ seq: 2, at: start + 60001, type: "edit", version: 3, edits: [] }],
        start + 70002,
      ),
    /interval/,
  );
  db.transition(a.id, "seal", start + 70003);
  assert.throws(
    () =>
      db.append(
        a.id,
        [{ seq: 2, at: start + 59500, type: "edit", version: 3, edits: [] }],
        start + 70004,
      ),
    /sealed/,
  );
  db.db.close();
});
test("learning preserves independent work; sufficient completion requires evidence", () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true, start);
  assert.throws(
    () => db.transition(a.id, "learn", start + 100),
    /current phase/,
  );
  db.transition(a.id, "finish", start + 1000);
  db.transition(a.id, "learn", start + 1100);
  assert.throws(
    () => db.transition(a.id, "complete", start + 1200, "sufficient"),
    /not yet enough evidence/,
  );
  const learning = db.get(a.id, start + 1300);
  learning.followup = {
    answer: "initial response",
    answeredAt: start + 1300,
    feedback: "specific feedback",
    outcome: "partial",
    coachedCode: "other source",
  };
  db.save(learning);
  const completed = db.transition(a.id, "complete", start + 1400);
  assert.equal(completed.learningExit?.reason, "manual");
  assert.equal(completed.source, a.initialSource);
  assert.equal(completed.followup?.answer, "initial response");
  assert.equal(db.history().length, 0);
  db.db.close();
});

test("work segments preserve multi-day pauses and reported continuations without changing the attempt", () => {
  const db = new AttemptStore(":memory:");
  try {
    const initial = db.create(demoProblem, 60_000, false, start);
    const later = start + 2 * 86_400_000;
    const report = {
      id: crypto.randomUUID(),
      date: "2026-11-10",
      note: "Continued the repair after review.",
    };
    assert.throws(
      () => db.recordContinuation(initial.id, report, start + 1),
      /Finish the timed assessment/,
    );
    db.transition(initial.id, "pause", start + 10_000);
    db.transition(initial.id, "resume", later);
    const finished = db.get(initial.id, later + 60_000);
    assert.deepEqual(finished.workSegments, [
      {
        id: "assessment-1",
        kind: "assessment",
        startedAt: start,
        endedAt: start + 10_000,
        endReason: "pause",
      },
      {
        id: "assessment-2",
        kind: "assessment",
        startedAt: later,
        endedAt: later + 50_000,
        endReason: "assessment-ended",
      },
    ]);
    const saved = db.recordContinuation(initial.id, report, later + 80_000);
    assert.equal(saved.endedAt, finished.endedAt);
    assert.equal(saved.phase, finished.phase);
    assert.equal(saved.source, finished.source);
    assert.deepEqual(saved.events, finished.events);
    assert.deepEqual(
      db.recordContinuation(initial.id, report, later + 90_000).workSegments,
      saved.workSegments,
    );
    assert.throws(
      () =>
        db.recordContinuation(
          initial.id,
          { ...report, minutes: 20 },
          later + 100_000,
        ),
      /different details/,
    );
    assert.deepEqual(db.exportLibrary().attempts[0].workSegments?.at(-1), {
      ...report,
      kind: "continuation",
      recordedAt: later + 80_000,
    });

    const paused = db.create(demoProblem, 60_000, false, start);
    db.transition(paused.id, "pause", start + 5000);
    assert.deepEqual(db.transition(paused.id, "finish", later).workSegments, [
      {
        id: "assessment-1",
        kind: "assessment",
        startedAt: start,
        endedAt: start + 5000,
        endReason: "pause",
      },
    ]);
  } finally {
    db.db.close();
  }
});
