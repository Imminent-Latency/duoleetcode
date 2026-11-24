import { test } from "node:test";
import assert from "node:assert/strict";
import { POST as create } from "../app/api/state/route";
import { POST as change, GET as read } from "../app/api/attempts/[id]/route";
import { demoProblem } from "../lib/demo";
import { database, store } from "../lib/store";
process.env.DUO_DATABASE = ":memory:";
const request = (body: unknown, origin = "http://127.0.0.1:4318") =>
  new Request("http://127.0.0.1:4318/api/state", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4318",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("API preserves first response and judge snapshot across phase changes", async () => {
  const created = await (
    await create(
      request({
        problem: demoProblem,
        budgetMs: 60000,
        demonstration: true,
      }),
    )
  ).json();
  assert.ok(created.attempt?.id);
  const a = created.attempt;
  assert.equal(a.exposure, "new");
  assert.equal(a.exposureSource, "default");
  const ctx = { params: Promise.resolve({ id: a.id }) };
  assert.equal(
    (await change(request({ action: "exposure", exposure: "solved" }), ctx))
      .status,
    400,
  );
  const job = {
    id: crypto.randomUUID(),
    kind: "run",
    state: "sending",
    source: a.source,
    seq: 0,
    createdAt: a.createdAt,
  };
  assert.equal(
    (
      await change(
        request({ action: "job", job: { ...job, source: "wrong source" } }),
        ctx,
      )
    ).status,
    400,
  );
  assert.equal(
    (await change(request({ action: "job", job }), ctx)).status,
    200,
  );
  assert.equal((await change(request({ action: "finish" }), ctx)).status, 200);
  assert.equal(
    (await change(request({ action: "exposure", exposure: "solved" }), ctx))
      .status,
    200,
  );
  assert.equal(
    (await change(request({ action: "exposure", exposure: "invalid" }), ctx))
      .status,
    400,
  );
  assert.equal(
    (
      await change(
        request({
          action: "job",
          job: {
            ...job,
            state: "complete",
            summary: { verdict: "Accepted" },
            remoteId: "runcode_123.45_test",
          },
        }),
        ctx,
      )
    ).status,
    200,
  );
  const frozen = store(a.id).get(a.id);
  frozen.evaluations.push({
    summary: "fixture",
    strengths: [],
    gaps: [],
    moments: [],
    exercise: {
      skill: "Set.add",
      title: "Recall",
      prompt: "Explain add",
      rubric: "private answer",
    },
    version: "fixture",
    createdAt: Date.now(),
    evidenceThrough: 0,
  });
  store(a.id).save(frozen);
  await change(request({ action: "learn" }), ctx);
  assert.equal(
    (
      await change(
        request({ action: "answer", answer: "my first response" }),
        ctx,
      )
    ).status,
    200,
  );
  assert.equal(
    (await change(request({ action: "answer", answer: "replacement" }), ctx))
      .status,
    400,
  );
  const get = new Request("http://127.0.0.1:4318/api/attempts/" + a.id, {
    headers: { host: "127.0.0.1:4318" },
  });
  const data = await (await read(get, ctx)).json();
  assert.equal(data.attempt.source, a.source);
  assert.equal(data.attempt.exposure, "solved");
  assert.equal(data.attempt.exposureSource, "reported");
  assert.equal(data.attempt.followup.answer, "my first response");
  assert.equal(data.attempt.evaluations[0].exercise.rubric, undefined);
  assert.equal(data.attempt.jobs[0].remoteId, "runcode_123.45_test");
});
test("mutations reject foreign origins and locked exercises", async () => {
  assert.equal(
    (
      await create(
        request(
          { problem: demoProblem, budgetMs: 60000, exposure: "new" },
          "https://example.com",
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await create(
        request({
          problem: { ...demoProblem, locked: true },
          budgetMs: 60000,
          exposure: "new",
        }),
      )
    ).status,
    400,
  );
});

test("API lets learners skip and return, without claiming sufficient evidence", async () => {
  const a = database("sandbox").create(demoProblem, 60000, true);
  const ctx = { params: Promise.resolve({ id: a.id }) };
  assert.equal(
    (await change(request({ action: "complete", reason: "skipped" }), ctx))
      .status,
    400,
  );
  await change(request({ action: "finish" }), ctx);
  assert.equal(
    (await change(request({ action: "complete", reason: "sufficient" }), ctx))
      .status,
    400,
  );
  const skipped = await (
    await change(request({ action: "complete", reason: "skipped" }), ctx)
  ).json();
  assert.equal(skipped.attempt.phase, "complete");
  assert.equal(skipped.attempt.learningExit.reason, "skipped");
  assert.equal(skipped.attempt.followup, undefined);
  const reopened = await (
    await change(request({ action: "learn" }), ctx)
  ).json();
  assert.equal(reopened.attempt.phase, "learn");
  assert.equal(reopened.attempt.previousLearningExits[0].reason, "skipped");
  assert.equal(reopened.attempt.learningExit, undefined);
});

test("a saved continuation can be reopened without changing the recorded assessment", async () => {
  const db = database("sandbox");
  const attempt = db.create(demoProblem, 60_000, true);
  const ctx = { params: Promise.resolve({ id: attempt.id }) };
  db.transition(attempt.id, "finish");
  const report = {
    id: crypto.randomUUID(),
    date: "2026-11-10",
    note: "Picked up the same exercise later.",
  };
  const invalid = await change(
    request({
      action: "record-continuation",
      segment: { ...report, date: "2026-02-30" },
    }),
    ctx,
  );
  assert.equal(invalid.status, 400);
  const response = await change(
    request({ action: "record-continuation", segment: report }),
    ctx,
  );
  assert.equal(response.status, 200);
  const reopened = await read(
    new Request("http://127.0.0.1:4318/api/attempts/" + attempt.id, {
      headers: { host: "127.0.0.1:4318" },
    }),
    ctx,
  );
  const data = (await reopened.json()).attempt;
  assert.equal(data.phase, "review");
  assert.equal(data.sealed, true);
  assert.equal(data.source, attempt.source);
  assert.deepEqual(data.workSegments.at(-1), {
    ...report,
    kind: "continuation",
    recordedAt: data.workSegments.at(-1).recordedAt,
  });
});
