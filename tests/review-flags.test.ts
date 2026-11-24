import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TraceStore } from "../lib/agent-traces";
import { ReviewFlags } from "../lib/review-flags";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { POST, GET } from "../app/api/review-flags/route";
process.env.DUO_DATABASE = ":memory:";
function fixture() {
  const attempts = new AttemptStore(":memory:", true);
  const a = attempts.create(demoProblem, 60000, true);
  const log = new TraceStore(":memory:");
  const flags = new ReviewFlags(log);
  const deps = {
    attempt: () => a,
    mode: () => "test" as const,
    settings: () => ({ preset: "custom", cookie: "credential" }),
  };
  return { attempts, a, log, flags, deps };
}
test("a flag freezes the exact reply, conversation, code and entire trace family beyond expiry and clear", () => {
  const { attempts, a, log, flags, deps } = fixture();
  const parent = log.start({
    role: "reflect",
    kind: "workflow",
    attemptId: a.id,
    mode: "test",
  });
  const child = log.start({ role: "reflection coach" }, parent);
  child.event("tool.completed", { result: "reference", api_key: "secret" });
  child.finish("succeeded");
  parent.finish("succeeded");
  const messageId = randomUUID();
  a.reflection = {
    messages: [
      {
        id: messageId,
        role: "assistant",
        text: "Original response",
        createdAt: Date.now(),
        research: {
          traceId: child.id,
          sources: [],
          claims: [],
          lookups: [],
          symbols: [],
          runtime: { editorJava: 25, executionJava: null },
        },
      },
    ],
  };
  const input = {
    id: randomUUID(),
    category: "Incorrect information",
    note: "This claim was incorrect",
    target: { kind: "reflection", attemptId: a.id, messageId },
  };
  const f = flags.create(input, deps);
  assert.equal(f.mode, "test");
  assert.equal(f.traceCount, 2);
  a.reflection.messages[0].text = "Later replacement";
  a.source = "edited after flag";
  const context = f.bundle.context as any;
  assert.equal(context.selectedItem.text, "Original response");
  assert.notEqual(context.attempt.source, a.source);
  assert.ok(!JSON.stringify(f).includes('"secret"'));
  assert.equal((f.bundle.settingsAtCapture as any).cookie, "[REDACTED]");
  log.db.prepare("UPDATE agent_runs SET endedAt=1").run();
  assert.equal(log.prune(), 2);
  log.clear();
  assert.equal(flags.get(f.id).traceCount, 2);
  assert.deepEqual(
    flags.create(input, {
      attempt: () => {
        throw new Error("attempt now removed");
      },
    }),
    flags.get(f.id),
  );
  assert.throws(
    () => flags.create({ ...input, note: "changed" }, deps),
    /different content/,
  );
  assert.equal(flags.setStatus(f.id, "resolved").status, "resolved");
  assert.equal(flags.list("open").total, 0);
  assert.equal(flags.setStatus(f.id, "open").status, "open");
  assert.equal(attempts.get(a.id).source, demoProblem.javaStarter);
  assert.equal(attempts.memory.export().uses.length, 0);
  log.close();
  attempts.db.close();
});
test("editor flags preserve unsaved source and selection without changing the assessment, and reject false replay anchors", () => {
  const { attempts, a, log, flags, deps } = fixture();
  const source = "class Draft {}";
  const target = {
    kind: "editor",
    attemptId: a.id,
    source,
    editor: {
      file: "Solution.java",
      source: "recording",
      cursor: { line: 1, column: 7, lineText: source },
      selection: {
        startLine: 1,
        startColumn: 7,
        endLine: 1,
        endColumn: 12,
        text: "Draft",
      },
    },
  };
  const f = flags.create(
    {
      id: randomUUID(),
      category: "Editor issue",
      note: "Completion wrong",
      target,
    },
    deps,
  );
  assert.equal((f.bundle.context as any).visibleSource, source);
  assert.match((f.bundle.context as any).sourceOrigin, /unsaved/);
  assert.throws(
    () =>
      flags.create(
        {
          id: randomUUID(),
          category: "Editor issue",
          note: "",
          target: { ...target, editor: { ...target.editor, seq: 0 } },
        },
        deps,
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      flags.create(
        {
          id: randomUUID(),
          category: "Other",
          note: "",
          target: {
            ...target,
            editor: {
              ...target.editor,
              selection: { ...target.editor.selection, text: "fake" },
            },
          },
        },
        deps,
      ),
    /does not match/,
  );
  assert.equal(attempts.get(a.id).phase, "active");
  assert.equal(attempts.get(a.id).lastSeq, 0);
  assert.equal(attempts.get(a.id).source, demoProblem.javaStarter);
  log.close();
  attempts.db.close();
});
test("missing traces remain explicit, undelivered help cannot be flagged as delivered, and stale recommendations are preserved by identity", () => {
  const { attempts, a, log, flags, deps } = fixture();
  const id = randomUUID();
  a.javaHelp = [
    {
      id,
      question: "help",
      requestSeq: 0,
      askedAt: Date.now(),
      state: "ready",
      answer: "not delivered",
    },
  ];
  assert.throws(
    () =>
      flags.create(
        {
          id: randomUUID(),
          category: "Other",
          note: "",
          target: { kind: "java-help", attemptId: a.id, messageId: id },
        },
        deps,
      ),
    /no longer available/,
  );
  a.javaHelp[0].deliveredAt = Date.now();
  a.javaHelp[0].research = {
    traceId: randomUUID(),
    sources: [],
    claims: [],
    symbols: [],
    lookups: [],
    runtime: { editorJava: 25, executionJava: null },
  };
  const f = flags.create(
    {
      id: randomUUID(),
      category: "Other",
      note: "",
      target: { kind: "java-help", attemptId: a.id, messageId: id },
    },
    deps,
  );
  assert.equal(f.traceState, "unavailable");
  const prescriptionId = randomUUID();
  const p = {
    id: prescriptionId,
    title: "Old pick",
    slug: "old-pick",
    difficulty: "Easy",
    reason: "Practice",
    minutes: 20,
    kind: "new-challenge",
    evidence: [],
    model: "saved-model",
    effort: "low",
    createdAt: 1,
    contextKey: "old-context",
    skippedSlugs: [],
  };
  const old = flags.create(
    {
      id: randomUUID(),
      category: "Poor recommendation",
      note: "",
      target: { kind: "prescription", prescriptionId },
    },
    { ...deps, prescription: () => p },
  );
  assert.equal((old.bundle.context as any).prescription.model, "saved-model");
  assert.equal(old.traceState, "none");
  log.close();
  attempts.db.close();
});
test("flag endpoints reject cross-origin writes, invalid IDs, and excessive notes", async () => {
  const req = (body: unknown, origin = "http://127.0.0.1:4318") =>
    new Request("http://127.0.0.1:4318/api/review-flags", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4318",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await POST(req({ action: "create" }, "https://outside.example"))).status,
    400,
  );
  assert.equal(
    (await POST(req({ action: "status", id: "fake", status: "resolved" })))
      .status,
    400,
  );
  assert.equal(
    (
      await POST(
        req({
          action: "create",
          flag: {
            id: randomUUID(),
            category: "Other",
            note: "x".repeat(4001),
            target: { kind: "agent-run", traceId: randomUUID() },
          },
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await GET(
        new Request("http://127.0.0.1:4318/api/review-flags", {
          headers: {
            host: "127.0.0.1:4318",
            origin: "https://outside.example",
          },
        }),
      )
    ).status,
    400,
  );
});
