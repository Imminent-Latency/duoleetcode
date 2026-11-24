import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { LearnerContext, canUseLearnerContext } from "../lib/learner-context";
import { snapshot } from "../lib/practice-storage.mjs";
import { AgentRuntime } from "../lib/agents";
import { lowSettings } from "../lib/agent-settings";
import { baselineAgentModel } from "../lib/agent-settings-store";
import { GET, POST } from "../app/api/memory/route";

function attempt(db: AttemptStore, demo = false) {
  const created = db.create(
    { ...demoProblem, titleSlug: "memory-fixture" },
    60_000,
    demo,
  );
  const a = db.transition(created.id, "finish");
  a.evaluations.push({
    summary: "Recorded observation",
    strengths: [],
    gaps: [
      {
        skill: "Java Map insertion",
        observation: "Used add instead of put.",
        evidence: [0],
      },
    ],
    moments: [],
    exercise: {
      skill: "Java Map insertion",
      title: "Map insertion",
      prompt: "Explain insertion",
    },
    createdAt: Date.now(),
    version: "fixture-v1",
    evidenceThrough: 0,
  });
  a.reflection = {
    messages: [
      {
        id: "learner-pref",
        role: "user",
        text: "Please use compact examples when explaining Java APIs.",
        createdAt: Date.now(),
      },
    ],
  };
  db.save(a);
  return a;
}

test("preferences are source-linked, versioned, scoped, and truly forgotten on reopening", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duo-memory-"));
  const filename = path.join(dir, "practice.sqlite");
  let db = new AttemptStore(filename);
  try {
    const original = db.memory.list().find((m) => m.id === "pref-formatting")!;
    const changed = db.memory.edit(original.id, original.revision, {
      text: "Use a compact table for index/value comparisons.",
      scope: "coaching",
    });
    assert.equal(changed.revision, 2);
    assert.equal(changed.source.quote, original.source.quote);
    assert.equal(db.memory.revisions(original.id)[1].text, original.text);
    assert.throws(
      () => db.memory.edit(original.id, 1, { text: "stale", scope: "all" }),
      /changed/,
    );
    assert.equal(
      db.memory.profile("reflection").some((m) => m.id === original.id),
      false,
    );
    assert.equal(
      db.memory.profile("coaching").find((m) => m.id === original.id)?.text,
      changed.text,
    );
    db.memory.recordUse({
      role: "coach",
      attemptId: "receipt-only",
      preferences: [{ id: original.id, revision: 1 }],
      evidenceIds: [],
    });
    assert.equal(
      db.memory.uses()[0].preferences[0].text,
      original.text,
      "receipts resolve the actual revision, not the current text",
    );
    db.memory.forget(original.id, 2);
    assert.equal(db.memory.revisions(original.id).length, 0);
    db.db.close();
    db = new AttemptStore(filename);
    assert.equal(
      db.memory.get(original.id),
      undefined,
      "seed cannot recreate forgotten preference",
    );
    assert.equal(db.memory.uses()[0].preferences[0].text, undefined);
    const restored = path.join(dir, "restored.sqlite");
    await snapshot(filename, restored);
    const copy = new AttemptStore(restored);
    assert.equal(copy.memory.get(original.id), undefined);
    assert.deepEqual(copy.memory.list(), db.memory.list());
    copy.db.close();
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only approved preferences enter prompts; fabricated and assistant sources are rejected", () => {
  const db = new AttemptStore(":memory:");
  try {
    const a = attempt(db);
    const context = new LearnerContext(db.memory, "coach", a);
    const suggestion = {
      text: "Use compact API examples.",
      scope: "coaching",
      messageId: "learner-pref",
      quote: "Please use compact examples when explaining Java APIs.",
    };
    assert.throws(
      () =>
        context.handle("suggest_coaching_preference", {
          ...suggestion,
          messageId: "coach-message",
        }),
      /learner message/,
    );
    context.handle("suggest_coaching_preference", suggestion);
    assert.equal(
      db.memory.list().filter((m) => m.status === "proposed").length,
      0,
      "staged until successful output",
    );
    context.finish();
    const pending = db.memory.list().find((m) => m.status === "proposed")!;
    assert.ok(pending);
    assert.equal(
      db.memory.profile("coaching").some((m) => m.id === pending.id),
      false,
    );
    db.memory.propose(a, suggestion);
    assert.equal(
      db.memory.list().filter((m) => m.status === "proposed").length,
      1,
      "retry does not duplicate suggestion",
    );
    db.memory.edit(pending.id, pending.revision, {
      text: "Use one compact API example when helpful.",
      scope: "coaching",
    });
    const next = new LearnerContext(db.memory, "coach", a);
    assert.equal(
      next.profile.find((m) => m.id === pending.id)?.text,
      "Use one compact API example when helpful.",
    );
    const active = db.memory.get(pending.id)!;
    db.memory.forget(active.id, active.revision);
    assert.deepEqual(db.memory.propose(a, suggestion), { status: "dismissed" });
  } finally {
    db.db.close();
  }
});

test("evidence is searchable, revisions and corrections survive reindexing, exports retain provenance", () => {
  const db = new AttemptStore(":memory:");
  try {
    const a = attempt(db);
    const original = db.memory
      .search({ query: "Map", excludeAttempt: "none" })
      .find((e) => e.source.attemptId === a.id)!;
    const count = db.memory.search({
      includeSuperseded: true,
      limit: 200,
    }).length;
    db.save(a);
    db.save(a);
    assert.equal(
      db.memory.search({ includeSuperseded: true, limit: 200 }).length,
      count,
    );
    db.memory.correctEvidence(
      original.id,
      0,
      "This was a typo, not forgotten API knowledge.",
    );
    assert.throws(
      () => db.memory.correctEvidence(original.id, 0, "stale"),
      /changed/,
    );
    a.evaluations.push({
      ...a.evaluations[0],
      createdAt: Date.now() + 1,
      gaps: [],
      strengths: [
        {
          skill: "Java Map insertion",
          observation: "Learner clarified the typo.",
          evidence: [0],
        },
      ],
    });
    db.save(a);
    const matches = db.memory.search({ query: "typo" });
    assert.equal(matches.find((e) => e.id === original.id)?.current, false);
    assert.equal(
      matches.find((e) => e.id === original.id)?.correction?.text,
      "This was a typo, not forgotten API knowledge.",
    );
    const context = new LearnerContext(db.memory, "reflection coach", a);
    assert.equal(
      context.input().currentAssessmentCorrections[0].evidenceId,
      original.id,
    );
    db.memory.correctEvidence(
      original.id,
      1,
      "Exclude this misleading assessment.",
      true,
    );
    assert.equal(
      db.memory.search({ query: "Map" }).some((e) => e.id === original.id),
      false,
    );
    assert.equal(
      db.memory
        .search({ includeExcluded: true })
        .some((e) => e.id === original.id),
      true,
    );
    assert.doesNotThrow(() => db.memory.search({ query: '" OR 1=1 -- *' }));
    const exported = db.exportLibrary();
    assert.ok(exported.learnerMemory.corrections.length);
    assert.equal(
      db.get(a.id).evaluations[0].gaps[0].observation,
      "Used add instead of put.",
      "original interpretation preserved",
    );
    assert.equal(exported.attempts.length, 1);
  } finally {
    db.db.close();
  }
});

test("assessment help and sandbox cannot retrieve real history or propose real memory", () => {
  const db = new AttemptStore(":memory:");
  const sandbox = new AttemptStore(":memory:", true);
  try {
    const active = db.create(
      { ...demoProblem, titleSlug: "active-memory" },
      60_000,
    );
    assert.equal(canUseLearnerContext("coach", active), false);
    const a = attempt(db);
    assert.equal(canUseLearnerContext("java reference", a), false);
    assert.throws(
      () => new LearnerContext(db.memory, "java reference", a),
      /unavailable/,
    );
    assert.throws(
      () => new LearnerContext(sandbox.memory, "coach", a),
      /unavailable/,
    );
    assert.equal(sandbox.memory.list().length, 0);
    assert.equal(sandbox.memory.search().length, 0);
    const demo = attempt(sandbox, true);
    assert.equal(canUseLearnerContext("coach", demo), false);
    assert.equal(sandbox.memory.search().length, 0);
    assert.equal(
      db.memory.search().some((e) => e.source.attemptId === active.id),
      false,
    );
    assert.equal(
      db.memory.search().some((e) => e.source.attemptId === demo.id),
      false,
    );
  } finally {
    db.db.close();
    sandbox.db.close();
  }
});

test("unassessed first response and later baseline assessment remain distinct, without duplicate attempts", () => {
  const db = new AttemptStore(":memory:");
  try {
    const a = attempt(db);
    a.followup = { answer: "Use put", answeredAt: Date.now() };
    db.save(a);
    a.followup.feedback = "Correct API";
    a.followup.outcome = "independent";
    db.save(a);
    const current = db.memory
      .search({ query: "insertion" })
      .filter((e) => e.kind === "first-response");
    assert.equal(current.length, 1);
    assert.equal(current[0].outcome, "independent");
    assert.equal(
      db.memory
        .search({ includeSuperseded: true })
        .filter((e) => e.kind === "first-response").length,
      2,
    );
    assert.equal(db.list().length, 1);
  } finally {
    db.db.close();
  }
});

test("memory API applies optimistic updates and rejects foreign origins", async () => {
  const old = process.env.DUO_DATABASE;
  process.env.DUO_DATABASE = ":memory:";
  const req = (body?: unknown, origin = "http://127.0.0.1:4318") =>
    new Request("http://127.0.0.1:4318/api/memory", {
      method: body ? "POST" : "GET",
      headers: {
        host: "127.0.0.1:4318",
        origin,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (await GET(req(undefined, "https://example.org"))).status,
      400,
    );
    assert.equal(
      (
        await POST(
          req(
            { action: "add", text: "Prefer short answers", scope: "all" },
            "https://example.org",
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await POST(
          req({
            action: "add",
            text: "Prefer short answers",
            scope: "coaching",
          }),
        )
      ).status,
      200,
    );
    const data = await (await GET(req())).json();
    const m = data.preferences.find(
      (m: any) => m.text === "Prefer short answers",
    );
    assert.ok(m);
    assert.equal(
      (
        await POST(
          req({
            action: "edit",
            id: m.id,
            revision: m.revision,
            text: "Use a worked example when I ask why",
            scope: "coaching",
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await POST(req({ action: "forget", id: m.id, revision: m.revision })))
        .status,
      400,
    );
    assert.equal(
      (
        await POST(
          req({ action: "forget", id: m.id, revision: m.revision + 1 }),
        )
      ).status,
      200,
    );
  } finally {
    if (old === undefined) delete process.env.DUO_DATABASE;
    else process.env.DUO_DATABASE = old;
  }
});

test("runtime injects approved context and tools at Low, audits it, and records the exact revisions", async () => {
  const db = new AttemptStore(":memory:");
  const a = attempt(db);
  const runtime = new AgentRuntime(() => lowSettings(baselineAgentModel()));
  runtime.connect = async () => {};
  runtime.status = async () => ({
    signedIn: true,
    plan: "fixture",
    model: "fixture",
    provider: "fixture",
  });
  runtime.models = async () => [
    { model: baselineAgentModel(), name: "fixture", efforts: ["low"] },
  ];
  const starts: any[] = [];
  const inputs: any[] = [];
  let n = 0;
  runtime.rpc = async (method, params: any) => {
    if (method === "thread/start") {
      starts.push(params);
      return { thread: { id: `t-${++n}` }, model: params.model };
    }
    if (method === "turn/start") {
      assert.equal(params.effort, "low");
      inputs.push(JSON.parse(params.input[0].text));
      const output =
        params.threadId === "t-1"
          ? { message: "A concise response", technicalClaims: [] }
          : { ok: true, issues: [] };
      queueMicrotask(() => {
        if (params.threadId === "t-1")
          runtime.receive({
            id: "learner-evidence-read",
            method: "item/tool/call",
            params: {
              threadId: params.threadId,
              tool: "find_skill_evidence",
              arguments: { query: "Java", skillId: null },
            },
          });
        runtime.receive({
          method: "item/completed",
          params: {
            threadId: params.threadId,
            item: { type: "agentMessage", text: JSON.stringify(output) },
          },
        });
        runtime.receive({
          method: "turn/completed",
          params: { threadId: params.threadId, turn: { status: "completed" } },
        });
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  try {
    const learner = new LearnerContext(db.memory, "coach", a);
    await runtime.run(
      "coach",
      "test",
      { question: "Explain" },
      {},
      a,
      undefined,
      { learner },
    );
    assert.ok(
      starts[0].dynamicTools.some((t: any) => t.name === "find_skill_evidence"),
    );
    assert.ok(inputs[0].learnerContext.preferences.length);
    assert.ok(
      inputs[1].context.learnerContext.preferences.length,
      "audit receives the same context",
    );
    assert.equal(
      inputs[1].retrievedEvidence.receipts[0].tool,
      "find_skill_evidence",
    );
    assert.deepEqual(inputs[1].retrievedEvidence.receipts[0].input, {
      query: "Java",
      skillId: null,
    });
    assert.equal(
      db.memory.uses()[0].preferences.length,
      learner.profile.length,
    );
    assert.equal(runtime.learnerContexts.size, 0);
  } finally {
    db.db.close();
  }
});
