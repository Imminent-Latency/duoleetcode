import "fake-indexeddb/auto";
import { openDB } from "idb";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Recorder } from "../lib/browser";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { acceptedSubmission } from "../lib/assessment-completion";
test("recording timestamps include sleep-sized wall-clock jumps and never move backward", (t) => {
  const db = new AttemptStore(":memory:");
  try {
    let wall = Date.now();
    const a = db.create(demoProblem, 60000, true, wall);
    t.mock.method(Date, "now", () => wall);
    const recorder = new Recorder(a, wall, () => {});
    const before = recorder.now();
    wall += 40 * 60000;
    assert.equal(recorder.now() - before, 40 * 60000);
    wall -= 1000;
    assert.equal(recorder.now() - before, 40 * 60000);
  } finally {
    db.db.close();
  }
});
test("an older save acknowledgement cannot undo a new automatic pause", async () => {
  const db = new AttemptStore(":memory:");
  const originalFetch = globalThis.fetch;
  const start = Date.now(),
    a = db.create(demoProblem, 60000, true, start);
  try {
    globalThis.fetch = async (_url, init) =>
      Response.json({
        attempt: db.append(
          a.id,
          JSON.parse(String(init?.body)).events,
          start + 7000,
        ),
      });
    const r = new Recorder(a, start, () => {});
    r.now = () => start + 5000;
    r.record({ type: "pause", origin: "manual" });
    const earlier = db.append(a.id, r.events, start + 5000);
    r.now = () => start + 6000;
    r.record({ type: "resume" });
    r.now = () => start + 7000;
    r.record({ type: "pause", origin: "window-blur" });
    r.acceptAttempt(earlier);
    assert.equal(r.attempt.phase, "paused");
    assert.equal(r.attempt.pauses.length, 2);
    assert.equal(r.attempt.pauses[1].start, start + 7000);
    await r.flush();
    assert.equal(db.get(a.id, start + 8000).phase, "paused");
  } finally {
    globalThis.fetch = originalFetch;
    db.db.close();
  }
});
test("offline auto-pause is immediate and survives recovery beyond the original deadline", async () => {
  const db = new AttemptStore(":memory:");
  const start = Date.now(),
    a = db.create(demoProblem, 60000, true, start);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    const first = new Recorder(a, start, () => {});
    first.now = () => start + 10000;
    first.record({ type: "pause", origin: "tab-hidden" });
    assert.equal(first.attempt.phase, "paused");
    first.now = () => start + 1900000;
    first.record({ type: "focus", detail: "visible" });
    await assert.rejects(first.flush(), /Offline/);
    globalThis.fetch = async (_url, init) =>
      Response.json({
        attempt: db.append(
          a.id,
          JSON.parse(String(init?.body)).events,
          start + 1900000,
        ),
      });
    const recovered = new Recorder(
      db.get(a.id, start + 1900000),
      start + 1900000,
      () => {},
    );
    await recovered.recover();
    assert.equal(recovered.attempt.phase, "paused");
    assert.equal(recovered.attempt.pauses[0].start, start + 10000);
    assert.equal(recovered.attempt.events.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    db.db.close();
  }
});
test("accepted submission finishing flushes later edits and preserves the accepted source", async () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        attempt: db.append(a.id, body.events),
        serverTime: Date.now(),
      });
    };
    const recorder = new Recorder(a, Date.now(), () => {});
    const saved = db.get(a.id);
    saved.jobs.push({
      id: "accepted-submit",
      kind: "submit",
      state: "complete",
      source: a.source,
      seq: 0,
      createdAt: Date.now(),
      summary: { verdict: "Accepted" },
    });
    db.save(saved);
    recorder.record({
      type: "edit",
      edits: [
        {
          offset: 0,
          length: 0,
          text: "// Edited while the judge was running\n",
        },
      ],
    });
    const accepted = acceptedSubmission(db.get(a.id).jobs)!;
    recorder.record({
      type: "finish",
      detail: "submission accepted",
      jobId: accepted.id,
    });
    await recorder.flush();
    const finished = db.transition(a.id, "finish");
    assert.equal(finished.phase, "review");
    assert.equal(finished.sealed, true);
    assert.ok(
      finished.source.startsWith("// Edited while the judge was running"),
    );
    assert.equal(finished.jobs[0].source, a.source);
    assert.equal(finished.events.at(-1)?.jobId, "accepted-submit");
    assert.equal(finished.events.at(-1)?.detail, "submission accepted");
    await new Recorder(db.get(a.id), Date.now(), () => {}).recover();
    assert.equal(db.get(a.id).events.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    db.db.close();
  }
});
test("offline edits survive recorder replacement and recover once after reconnect", async () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    const first = new Recorder(a, Date.now(), () => {});
    first.record({
      type: "edit",
      edits: [{ offset: 0, length: 0, text: "// offline 😀\n" }],
    });
    await assert.rejects(first.flush(), /Offline/);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        attempt: db.append(a.id, body.events),
        serverTime: Date.now(),
      });
    };
    const recovered = new Recorder(db.get(a.id), Date.now(), () => {});
    await recovered.recover();
    assert.ok(recovered.attempt.source.startsWith("// offline 😀"));
    assert.equal(recovered.attempt.events.length, 1);
    const browserDB = await openDB("duoleetcode-recovery", 1);
    assert.equal(
      (await browserDB.getAll("events")).filter((e) => e.attemptId === a.id)
        .length,
      0,
    );
    browserDB.close();
    const again = new Recorder(db.get(a.id), Date.now(), () => {});
    await again.recover();
    assert.equal(db.get(a.id).events.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.db.close();
  }
});
test("a crash after server acknowledgement is reconciled; conflicting buffer is preserved", async () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(demoProblem, 60000, true);
  const e = {
    seq: 1,
    at: Date.now(),
    type: "focus" as const,
    detail: "hidden",
  };
  db.append(a.id, [e]);
  const browserDB = await openDB("duoleetcode-recovery", 1);
  await browserDB.put("events", { ...e, attemptId: a.id });
  await new Recorder(db.get(a.id), Date.now(), () => {}).recover();
  assert.equal(await browserDB.get("events", [a.id, 1]), undefined);
  await browserDB.put("events", {
    ...e,
    detail: "different source event",
    attemptId: a.id,
  });
  await assert.rejects(
    new Recorder(db.get(a.id), Date.now(), () => {}).recover(),
    /conflicts/,
  );
  assert.ok(await browserDB.get("events", [a.id, 1]));
  browserDB.close();
  db.db.close();
});
