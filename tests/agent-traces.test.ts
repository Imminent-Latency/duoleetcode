import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRuntime } from "../lib/agents";
import {
  TraceStore,
  currentTrace,
  redact,
  traced,
  traceFile,
} from "../lib/agent-traces";
import { lowSettings } from "../lib/agent-settings";
import { GET, POST } from "../app/api/diagnostics/route";

function runtime(db: TraceStore) {
  const r = new AgentRuntime(() => lowSettings("test-model"), db);
  r.connect = async () => {};
  r.status = async () => ({
    signedIn: true,
    plan: "test",
    model: "test-model",
    provider: "test",
  });
  r.models = async () => [
    { model: "test-model", name: "Test", efforts: ["low"] },
  ];
  return r;
}
function output(
  r: AgentRuntime,
  threadId: string,
  text: string,
  status = "completed",
) {
  r.receive({
    method: "item/completed",
    params: { threadId, item: { type: "agentMessage", text } },
  });
  r.receive({
    method: "turn/completed",
    params: { threadId, turn: { status } },
  });
}
test("diagnostics persist incremental events, credentials are redacted, and test defaults are isolated", async () => {
  assert.equal(traceFile(), ":memory:");
  const dir = mkdtempSync(path.join(tmpdir(), "duo-traces-"));
  const file = path.join(dir, "diagnostics.sqlite");
  const db = new TraceStore(file);
  try {
    const run = db.start({ role: "coach", mode: "test" });
    run.event("input", {
      source: "class Solution {}",
      cookie: "private",
      inputTokens: 30,
      nested: { Authorization: "Bearer token" },
      payload: JSON.stringify({ api_key: "private" }),
    });
    const reader = new TraceStore(file);
    assert.equal(reader.detail(run.id).run.status, "running");
    const data: any = reader.detail(run.id).events[1].data;
    assert.equal(data.source, "class Solution {}");
    assert.equal(data.cookie, "[REDACTED]");
    assert.equal(data.inputTokens, 30);
    assert.equal(JSON.parse(data.payload).api_key, "[REDACTED]");
    run.finish("failed", "Bearer topsecret");
    assert.equal(reader.detail(run.id).run.status, "failed");
    assert.ok(!JSON.stringify(reader.export()).includes("topsecret"));
    assert.equal(
      redact("token sk-abcdefghijklmnopqrstuvwxyz"),
      "token [REDACTED]",
    );
    reader.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("run families preserve active calls, apply retention together, and recover crashed owners", async () => {
  const db = new TraceStore(":memory:");
  const parent = db.start({ role: "workflow", kind: "workflow" });
  const child = db.start({ role: "research" }, parent);
  parent.finish("succeeded");
  assert.throws(() => db.clear(parent.id), /finish/);
  assert.equal(db.clear(), 0);
  db.db.prepare("UPDATE agent_runs SET endedAt=1 WHERE id=?").run(parent.id);
  assert.equal(db.prune(), 0);
  child.finish("succeeded");
  assert.equal(db.prune(), 0); // recent child preserves old parent
  db.db.prepare("UPDATE agent_runs SET endedAt=1").run();
  assert.equal(db.prune(), 2);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) n FROM agent_events").get()!.n,
    0,
  );
  const interrupted = db.start({ role: "coach" });
  interrupted.event("message.delta", { text: "partial" });
  db.db
    .prepare(
      "UPDATE agent_runs SET ownerInstance='previous-process' WHERE id=?",
    )
    .run(interrupted.id);
  db.recover();
  assert.equal(db.detail(interrupted.id).run.status, "interrupted");
  assert.ok(JSON.stringify(db.export()).includes("partial"));
  db.setRetention(null);
  db.prune(Date.now() + 999999999999);
  assert.equal(db.list().total, 1);
  assert.equal(db.clear(interrupted.id), 1);
  db.close();
});
test("overlapping workflows and async tool-triggered research retain their own parent and exact tool receipts", async () => {
  const db = new TraceStore(":memory:");
  const r = runtime(db);
  let serial = 0;
  const pending = new Map<string, () => void>();
  r.rpc = async (method, p: any) => {
    if (method === "thread/start")
      return { thread: { id: `t${++serial}` }, model: p.model };
    if (method === "turn/start") {
      if (JSON.parse(p.input[0].text).nested) {
        queueMicrotask(() => output(r, p.threadId, '{"ok":true}'));
      } else
        pending.set(p.threadId, () =>
          r.receive({
            id: p.threadId,
            method: "item/tool/call",
            params: {
              threadId: p.threadId,
              tool: "lookup",
              arguments: { query: p.threadId, cookie: "secret" },
            },
          }),
        );
      return { turn: { id: `turn-${p.threadId}` } };
    }
    return {};
  };
  r.process = {
    stdin: {
      write: (data: string) => {
        const m = JSON.parse(data);
        if (m.result) queueMicrotask(() => output(r, m.id, '{"ok":true}'));
      },
    },
  } as any;
  const run = (id: string) =>
    traced(
      { role: "workflow", kind: "workflow", attemptId: id, mode: "test" },
      async () => {
        return r.run(
          "planner",
          "Exact instructions",
          { id },
          { type: "object" },
          undefined,
          { model: "test-model" },
          {
            tools: {
              definitions: [
                {
                  type: "function",
                  name: "lookup",
                  description: "Lookup",
                  inputSchema: {},
                },
              ],
              handle: async () => {
                const parent = currentTrace()!.id;
                await r.run(
                  "java reference",
                  "Nested research",
                  { nested: true },
                  {},
                  undefined,
                  { model: "test-model" },
                  { audit: true },
                );
                return { parent, answer: "reference", api_key: "secret" };
              },
            },
          },
        );
      },
      db,
    );
  const a = run("a"),
    b = run("b");
  while (pending.size < 2)
    await new Promise((resolve) => setImmediate(resolve));
  // Simulate delivery from the external readline callback, outside either scope.
  for (const invoke of pending.values()) invoke();
  const results = await Promise.all([a, b]);
  for (const [index, res] of results.entries()) {
    const d = db.detail(res.traceId!);
    assert.equal(d.run.attemptId, index === 0 ? "a" : "b");
    assert.equal(d.family.length, 3);
    assert.equal(
      d.family.find((r) => r.kind === "audit")!.parentId,
      res.traceId,
    );
    assert.equal(d.events.filter((e) => e.kind === "tool.started").length, 1);
    assert.equal(d.events.filter((e) => e.kind === "tool.completed").length, 1);
    assert.deepEqual(
      d.events.map((e) => e.seq),
      d.events.map((_, i) => i + 1),
    );
    assert.ok(!JSON.stringify(d).includes('"secret"'));
    assert.ok(JSON.stringify(d).includes("Exact instructions"));
  }
  db.close();
});
test("model failure, startup failure, interruption and timeout retain inputs and partial outputs", async () => {
  for (const behavior of ["startup", "json", "interrupt", "timeout"]) {
    const db = new TraceStore(":memory:");
    const r = runtime(db);
    r.turnTimeoutMs = behavior === "timeout" ? 15 : 1000;
    if (behavior === "startup")
      r.connect = async () => {
        throw new Error("startup failed");
      };
    r.rpc = async (method, p: any) => {
      if (method === "thread/start")
        return { thread: { id: "thread" }, model: p.model };
      if (method === "turn/start") {
        setImmediate(() => {
          r.receive({
            method: "item/agentMessage/delta",
            params: { threadId: "thread", delta: "partial output" },
          });
          r.receive({
            method: "item/completed",
            params: {
              threadId: "thread",
              item: { type: "reasoning", content: ["private reasoning"] },
            },
          });
          if (behavior === "json") output(r, "thread", "not JSON");
          if (behavior === "interrupt")
            output(r, "thread", "partial", "interrupted");
        });
        return { turn: { id: "turn" } };
      }
      return {};
    };
    await assert.rejects(
      r.run(
        "planner",
        "Task",
        { source: "code" },
        {},
        undefined,
        { model: "test-model" },
        { audit: true },
      ),
    );
    const run = db.list().runs[0];
    assert.equal(
      run.status,
      behavior === "timeout"
        ? "timed-out"
        : behavior === "interrupt"
          ? "interrupted"
          : "failed",
    );
    const data = JSON.stringify(db.detail(run.id));
    assert.ok(data.includes("code"));
    assert.ok(!data.includes("private reasoning"));
    if (behavior !== "startup") assert.ok(data.includes("partial output"));
    db.close();
  }
});
test("usage is latest cumulative total, audit repairs are linked, and application validation can fail after model success", async () => {
  const db = new TraceStore(":memory:");
  const r = runtime(db);
  let n = 0,
    audits = 0;
  const auditThreads = new Set<string>();
  r.rpc = async (method, p: any) => {
    if (method === "thread/start") {
      const id = `thread${++n}`;
      if (!p.dynamicTools.length) auditThreads.add(id);
      return { thread: { id }, model: p.model };
    }
    if (method === "turn/start") {
      queueMicrotask(() => {
        const isAudit = auditThreads.has(p.threadId);
        for (const total of [10, 20])
          r.receive({
            method: "thread/tokenUsage/updated",
            params: {
              threadId: p.threadId,
              turnId: "t",
              tokenUsage: {
                total: { totalTokens: total, inputTokens: 15, outputTokens: 5 },
                last: { totalTokens: 10 },
              },
            },
          });
        output(
          r,
          p.threadId,
          JSON.stringify(
            isAudit
              ? {
                  ok: ++audits > 1,
                  issues:
                    audits === 1
                      ? [
                          {
                            kind: "unsupported-interpretation",
                            domain: "technical",
                            message: "Support claim",
                            sequences: [],
                          },
                        ]
                      : [],
                }
              : { message: "Reply", technicalClaims: [] },
          ),
        );
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  await assert.rejects(
    traced(
      { role: "reflection", kind: "workflow" },
      async () => {
        await r.run(
          "reflection coach",
          "Coach",
          { answer: "Reasoning" },
          {},
          undefined,
          { model: "test-model" },
        );
        throw new Error("Application citation validation failed");
      },
      db,
    ),
    /citation/,
  );
  const all = db.list().runs;
  assert.equal(all.length, 4);
  assert.equal(all.find((r) => r.kind === "workflow")!.status, "failed");
  const model = all.find((r) => r.kind === "model")!;
  assert.equal(model.status, "succeeded");
  assert.equal(model.usage!.totalTokens, 20);
  const events = db.detail(model.id).events;
  assert.equal(events.filter((e) => e.kind === "audit.result").length, 2);
  assert.equal(events.filter((e) => e.kind === "turn.input").length, 2);
  assert.ok(events.some((e) => e.kind === "validation.failed"));
  assert.equal(db.export(model.id).runs.length, 4);
  db.close();
});
test("diagnostics API protects local data and requires explicit clear intent", async () => {
  const req = (method: string, origin: string, body?: unknown) =>
    new Request("http://127.0.0.1:4318/api/diagnostics", {
      method,
      headers: {
        host: "127.0.0.1:4318",
        origin,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await GET(req("GET", "https://other.example"))).status, 400);
  assert.equal(
    (
      await POST(
        req("POST", "https://other.example", {
          action: "clear",
          confirmed: true,
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await POST(req("POST", "http://127.0.0.1:4318", { action: "clear" })))
      .status,
    400,
  );
  assert.equal(
    (
      await POST(
        req("POST", "http://127.0.0.1:4318", { action: "retention", days: 0 }),
      )
    ).status,
    400,
  );
  assert.equal((await GET(req("GET", "http://127.0.0.1:4318"))).status, 200);
});
