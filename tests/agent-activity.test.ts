import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TraceStore, traces } from "../lib/agent-traces";
import { projectActivity, readActivity } from "../lib/agent-activity";
import { AgentRuntime } from "../lib/agents";
import { lowSettings } from "../lib/agent-settings";
import { GET } from "../app/api/agent/activity/route";
import { store } from "../lib/store";
import { demoProblem } from "../lib/demo";
process.env.DUO_DATABASE = ":memory:";
test("activity pairs tools, retains provider summaries without duplication, and reflects audit/revision state", () => {
  const db = new TraceStore(":memory:"),
    attemptId = randomUUID();
  const root = db.start({ role: "reflect", kind: "workflow", attemptId });
  const model = db.start({ role: "reflection coach" }, root);
  model.event("request", { instructions: "private harness prompt" });
  model.event("reasoning.summary.delta", {
    itemId: "r",
    summaryIndex: 0,
    delta: "Check ",
  });
  model.event("reasoning.summary.delta", {
    itemId: "r",
    summaryIndex: 0,
    delta: "the evidence.",
  });
  model.event("reasoning.summary.completed", {
    itemId: "r",
    summary: ["Check the evidence."],
  });
  model.event("tool.started", {
    callId: 1,
    tool: "read_evidence",
    arguments: { seq: 2 },
  });
  let activity = readActivity(db, {
    attemptId,
    feature: "reflection",
    details: true,
  })!;
  assert.equal(activity.label, "Inspecting the recording");
  assert.equal(
    activity.steps.find((s) => s.kind === "reasoning")!.text,
    "Check the evidence.",
  );
  assert.ok(!JSON.stringify(activity).includes("private harness"));
  model.event("tool.completed", {
    callId: 1,
    tool: "read_evidence",
    durationMs: 10,
    result: { success: true, contentItems: [{ text: "visible code" }] },
  });
  const audit = db.start({ role: "reflection coach", kind: "audit" }, model);
  activity = readActivity(db, {
    attemptId,
    feature: "reflection",
    details: true,
  })!;
  assert.equal(activity.label, "Checking the response");
  audit.finish("succeeded");
  model.event("audit.result", {
    traceId: audit.id,
    ok: false,
    issues: ["Clarify support"],
  });
  model.event("validation.failed", { issues: ["Revise claim"] });
  const hidden = readActivity(
    db,
    { attemptId, feature: "reflection", details: true },
    false,
  )!;
  assert.ok(
    hidden.steps.every(
      (s) =>
        s.input === undefined && s.output === undefined && s.text === undefined,
    ),
  );
  assert.equal(hidden.detailsHidden, true);
  model.finish("succeeded");
  root.finish("succeeded");
  activity = readActivity(db, {
    attemptId,
    feature: "reflection",
    traceId: model.id,
    details: true,
  })!;
  assert.equal(activity.status, "succeeded");
  assert.deepEqual(activity.steps.find((s) => s.kind === "audit")?.output, {
    ok: false,
    issues: ["Clarify support"],
  });
  assert.equal(
    readActivity(db, { attemptId, feature: "java-help", traceId: model.id }),
    null,
  );
  assert.ok(activity.steps.every((s) => s.state !== "running"));
  assert.equal(activity.steps.find((s) => s.kind === "tool")!.durationMs, 10);
  assert.equal(
    readActivity(db, {
      attemptId: randomUUID(),
      feature: "reflection",
      traceId: model.id,
    }),
    null,
  );
  db.close();
});
test("runtime requests public reasoning summaries and ignores raw reasoning even when both are emitted", async () => {
  const db = new TraceStore(":memory:"),
    r = new AgentRuntime(() => lowSettings("test"), db);
  r.connect = async () => {};
  r.status = async () => ({
    signedIn: true,
    plan: "test",
    model: "test",
    provider: "test",
  });
  r.models = async () => [{ model: "test", name: "test", efforts: ["low"] }];
  r.rpc = async (method, p: any) => {
    if (method === "thread/start")
      return { thread: { id: "thread" }, model: "test" };
    if (method === "turn/start") {
      assert.equal(p.summary, "auto");
      queueMicrotask(() => {
        r.receive({
          method: "item/reasoning/textDelta",
          params: { threadId: "thread", delta: "RAW SECRET REASONING" },
        });
        r.receive({
          method: "item/reasoning/summaryTextDelta",
          params: {
            threadId: "thread",
            turnId: "turn",
            itemId: "thought",
            summaryIndex: 0,
            delta: "Public summary",
          },
        });
        r.receive({
          method: "item/completed",
          params: {
            threadId: "thread",
            item: {
              type: "reasoning",
              id: "thought",
              summary: ["Public summary"],
              content: ["RAW SECRET REASONING"],
            },
          },
        });
        r.receive({
          method: "item/completed",
          params: {
            threadId: "thread",
            item: { type: "agentMessage", text: '{"ok":true}' },
          },
        });
        r.receive({
          method: "turn/completed",
          params: { threadId: "thread", turn: { status: "completed" } },
        });
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const result = await r.run(
    "planner",
    "Test",
    {},
    {},
    undefined,
    { model: "test" },
    {
      audit: true,
    },
  );
  const raw = JSON.stringify(db.export(result.traceId));
  assert.ok(raw.includes("Public summary"));
  assert.ok(!raw.includes("RAW SECRET"));
  db.close();
});
test("live Java activity exposes progress but withholds details until the saved answer has been delivered", async () => {
  const db = store(),
    a = db.create(demoProblem, 60000, true),
    id = randomUUID();
  a.javaHelp = [
    {
      id,
      question: "Reference question",
      requestSeq: 0,
      askedAt: Date.now(),
      state: "pending",
    },
  ];
  db.save(a);
  const root = traces().start({
    role: "java help",
    kind: "workflow",
    attemptId: a.id,
    subjectId: id,
  });
  const model = traces().start({ role: "java reference" }, root);
  model.event("tool.started", {
    callId: 1,
    tool: "read_java_reference",
    arguments: { query: "sensitive answer" },
  });
  model.event("reasoning.summary.completed", {
    itemId: "r",
    summary: ["sensitive answer"],
  });
  const req = (feature = "java-help", origin = "http://127.0.0.1:4318") =>
    new Request(
      `http://127.0.0.1:4318/api/agent/activity?attemptId=${a.id}&feature=${feature}&subjectId=${id}&details=1`,
      { headers: { host: "127.0.0.1:4318", origin } },
    );
  let response = await GET(req());
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.activity.detailsHidden, true);
  assert.ok(!JSON.stringify(data).includes("sensitive answer"));
  a.javaHelp![0].deliveredAt = Date.now();
  db.save(a);
  response = await GET(req());
  data = await response.json();
  assert.equal(data.activity.detailsHidden, false);
  assert.ok(JSON.stringify(data).includes("sensitive answer"));
  assert.equal((await GET(req("reflection"))).status, 400);
  assert.equal(
    (await GET(req("java-help", "https://other.example"))).status,
    400,
  );
  model.finish("succeeded");
  root.finish("succeeded");
});
