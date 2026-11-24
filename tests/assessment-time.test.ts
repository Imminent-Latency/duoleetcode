import { test } from "node:test";
import assert from "node:assert/strict";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import {
  solvingTime,
  pauseMetadata,
  timedEvidence,
} from "../lib/assessment-time";
import { candidateMoments, clockRemaining } from "../lib/recording";
import {
  recordingDuration,
  timeAtSequence,
  focusTimes,
} from "../lib/reflection";

const start = 1700000000000;
test("a forty-minute pause collapses in replay while retaining timestamped pause metadata", () => {
  const db = new AttemptStore(":memory:");
  try {
    const a = db.create(demoProblem, 300000, true, start);
    db.append(
      a.id,
      [
        { seq: 1, at: start + 10000, type: "edit", version: 2, edits: [] },
        { seq: 2, at: start + 20000, type: "pause", origin: "manual" },
        { seq: 3, at: start + 30000, type: "focus", detail: "hidden" },
        {
          seq: 4,
          at: start + 2400000,
          type: "focus",
          detail: "window focused",
        },
        {
          seq: 5,
          at: start + 2410000,
          type: "pause-activity",
          detail: "Pointer interaction",
        },
        { seq: 6, at: start + 2420000, type: "resume" },
        { seq: 7, at: start + 2430000, type: "edit", version: 3, edits: [] },
      ],
      start + 2430000,
    );
    const done = db.transition(a.id, "finish", start + 2440000);
    assert.equal(recordingDuration(done), 40000);
    assert.equal(timeAtSequence(done, 7), 30000);
    assert.deepEqual(
      focusTimes(done, {
        startSeq: 1,
        endSeq: 7,
        mode: "range",
        label: "change",
      }),
      [10000, 30000],
    );
    assert.equal(timeAtSequence(done, 3), timeAtSequence(done, 5));
    assert.deepEqual(candidateMoments(done.events, done), []);
    assert.deepEqual(
      pauseMetadata(done)[0].activity.map((e) => e.seq),
      [3, 4, 5],
    );
    assert.equal(pauseMetadata(done)[0].durationMs, 2400000);
    assert.equal(pauseMetadata(done)[0].activity[1].afterPauseMs, 2380000);
    assert.deepEqual(
      timedEvidence(done).map((e) => e.seq),
      [1, 2, 6, 7],
    );
    assert.equal(done.events[3].at, start + 2400000);
  } finally {
    db.db.close();
  }
});

test("legacy pause boundaries and open pauses use the same active clock; genuine active gaps still flag", () => {
  const a = {
    createdAt: start,
    pauses: [
      { start: start + 10000, end: start + 1810000 },
      { start: start + 1820000 },
    ],
  };
  assert.equal(solvingTime(a, start + 4000000), 20000);
  assert.equal(solvingTime(a, start - 1), 0);
  assert.equal(
    solvingTime(
      {
        createdAt: start,
        pauses: [
          { start: start + 10, end: start + 50 },
          { start: start + 30, end: start + 60 },
        ],
      },
      start + 100,
    ),
    50,
  );
  const events = [
    { seq: 1, at: start + 1000, type: "edit" as const, edits: [] },
    { seq: 2, at: start + 1820000, type: "edit" as const, edits: [] },
  ];
  assert.deepEqual(
    candidateMoments(events, { ...a, pauses: a.pauses.slice(0, 1) }),
    [],
  );
  assert.equal(
    candidateMoments(events, { ...a, pauses: [] })[0].label,
    "Work resumed",
  );
});

test("pause events recover after the original deadline, remain idempotent and only explicit resume restarts the clock", () => {
  const db = new AttemptStore(":memory:");
  try {
    const a = db.create(demoProblem, 60000, true, start);
    const pause = {
      seq: 1,
      at: start + 10000,
      type: "pause" as const,
      origin: "window-blur",
    };
    db.append(a.id, [pause], start + 2000000);
    db.append(a.id, [pause], start + 2000000);
    db.append(
      a.id,
      [
        {
          seq: 2,
          at: start + 2000000,
          type: "focus",
          detail: "window focused",
        },
      ],
      start + 2000000,
    );
    const paused = db.get(a.id, start + 2000000);
    assert.equal(paused.phase, "paused");
    assert.equal(paused.pauses.length, 1);
    assert.equal(paused.pauses[0].reason, "window-blur");
    assert.equal(clockRemaining(paused, start + 2000000), 50000);
    const resumed = db.append(
      a.id,
      [{ seq: 3, at: start + 2005000, type: "resume" }],
      start + 2005000,
    );
    assert.equal(resumed.phase, "active");
    assert.equal(clockRemaining(resumed, start + 2010000), 45000);
    assert.equal(
      pauseMetadata(resumed)[0].activity[0].detail,
      "window focused",
    );
  } finally {
    db.db.close();
  }
});
