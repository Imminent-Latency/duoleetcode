import { developmentFixture } from "../tools/reflection-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AgentRuntime } from "../lib/agents";
import {
  AgentEvidence,
  evidenceAuditError,
  type AuditIssue,
} from "../lib/agent-evidence";
import { TraceStore } from "../lib/agent-traces";
import { lowSettings } from "../lib/agent-settings";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import type { Attempt } from "../lib/types";
import { reflectionOutputSchema, validateReflection } from "../lib/reflection";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/stock-recording-audit.json", import.meta.url),
    "utf8",
  ),
);
function attempt() {
  const db = new AttemptStore(":memory:");
  const base = db.create(
    demoProblem,
    1500000,
    true,
    fixture.snapshots[0].event.at - 1000,
  );
  db.db.close();
  return {
    ...base,
    id: "stock-audit-fixture",
    lastSeq: 697,
    initialSource: fixture.snapshots[0].before,
    source: fixture.snapshots.at(-1).after,
    events: fixture.snapshots.map((s: any) => s.event),
    checkpoints: fixture.snapshots.map((s: any) => ({
      seq: s.event.seq - 1,
      source: s.before,
    })),
  } as Attempt;
}

function harness(
  a: Attempt,
  turns: number[][],
  audit: (input: any, pass: number) => unknown,
  candidate?: (turn: number) => unknown,
) {
  const db = new TraceStore(":memory:");
  const r = new AgentRuntime(() => lowSettings("fixture"), db);
  r.connect = async () => {};
  r.status = async () => ({
    signedIn: true,
    plan: "test",
    model: "fixture",
    provider: "test",
  });
  r.models = async () => [
    { model: "fixture", name: "Fixture", efforts: ["low"] },
  ];
  const inputs: any[] = [],
    audits: any[] = [],
    replies: any[] = [],
    configs: any[] = [];
  const auditThreads = new Set<string>();
  let serial = 0,
    calls = 0;
  r.process = {
    stdin: { write: (data: string) => replies.push(JSON.parse(data)) },
  } as any;
  r.rpc = async (method, p: any) => {
    if (method === "thread/start") {
      const id = `thread-${++serial}`;
      configs.push(p);
      if (!p.dynamicTools.length) auditThreads.add(id);
      return { thread: { id }, model: p.model };
    }
    if (method === "turn/start") {
      const input = JSON.parse(p.input[0].text);
      queueMicrotask(() => {
        let value;
        if (auditThreads.has(p.threadId)) {
          audits.push(input);
          value = audit(input, audits.length);
        } else {
          inputs.push(input);
          for (const seq of turns[inputs.length - 1] ?? [])
            r.receive({
              id: ++calls,
              method: "item/tool/call",
              params: {
                threadId: p.threadId,
                tool: "read_evidence",
                arguments: { seq },
              },
            });
          value = candidate?.(inputs.length) ?? {
            message:
              "The sorting draft was removed; the incomplete loop was restored through undo.",
            technicalClaims: [],
          };
        }
        r.receive({
          method: "item/completed",
          params: {
            threadId: p.threadId,
            item: { type: "agentMessage", text: JSON.stringify(value) },
          },
        });
        r.receive({
          method: "turn/completed",
          params: { threadId: p.threadId, turn: { status: "completed" } },
        });
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const run = (validateOutput?: (value: unknown) => void) =>
    r.run(
      "reflection coach",
      "Inspect recorded changes.",
      {
        events: a.events.map(({ edits, ...e }) => ({
          ...e,
          removed: edits?.reduce((n, edit) => n + edit.length, 0),
          inserted: edits?.reduce((n, edit) => n + edit.text.length, 0),
        })),
      },
      { type: "object" },
      a,
      { model: "fixture" },
      { validateOutput },
    );
  return { r, db, run, inputs, audits, replies, configs };
}

const missing = (seq: number): AuditIssue => ({
  kind: "missing-evidence",
  domain: "recording",
  message: "Supply before/after code for this recorded event.",
  sequences: [seq],
});

test("failed Stock trace regression: verifier receives exact before/after snapshots, deduplicated and traceable", async () => {
  const h = harness(attempt(), [[364, 487, 666, 697, 364]], (input) => {
    const receipts = input.retrievedEvidence?.receipts ?? [];
    const missingEvidence = fixture.snapshots.filter(
      (s: any) =>
        !receipts.some(
          (r: any) =>
            r.result.event.seq === s.event.seq &&
            r.result.before === s.before &&
            r.result.after === s.after,
        ),
    );
    return {
      ok: !missingEvidence.length,
      issues: missingEvidence.map((s: any) => missing(s.event.seq)),
    };
  });
  try {
    const result = await h.run();
    assert.equal(h.inputs.length, 1);
    assert.equal(h.audits.length, 1);
    assert.equal(h.audits[0].retrievedEvidence.receipts.length, 4);
    assert.equal(h.audits[0].context.events[0].edits, undefined);
    assert.equal(
      h.replies.every((r) => r.result.success),
      true,
    );
    const receipts = h.replies.map(
      (r) => JSON.parse(r.result.contentItems[0].text).receiptId,
    );
    assert.equal(receipts[0], receipts[4]);
    assert.deepEqual(result.research?.audit, { passes: 1, revised: false });
    assert.ok(h.configs.every((c) => c.model === "fixture"));
    assert.equal(h.r.evidenceContexts.size, 0);
    const auditTrace = h.db
      .detail(result.traceId!)
      .family.find((r) => r.kind === "audit")!;
    assert.ok(
      h.db
        .detail(auditTrace.id)
        .events.some(
          (e) =>
            e.kind === "request" &&
            JSON.stringify(e.data).includes("retrievedEvidence"),
        ),
    );
  } finally {
    h.db.close();
  }
});

test("missing recording evidence is supplied by the harness and rechecked without rewriting the coach reply", async () => {
  const h = harness(attempt(), [[364]], (input) => {
    const found = input.retrievedEvidence.receipts.some(
      (r: any) => r.result.event.seq === 697,
    );
    return { ok: found, issues: found ? [] : [missing(697)] };
  });
  try {
    const result = await h.run();
    assert.equal(h.inputs.length, 1);
    assert.equal(h.audits.length, 2);
    assert.deepEqual(h.audits[0].candidate, h.audits[1].candidate);
    assert.deepEqual(result.research?.audit, { passes: 2, revised: false });
    assert.ok(
      h.db
        .detail(result.traceId!)
        .events.some(
          (e: any) =>
            e.kind === "audit.evidence-supplied" && e.data.supplied[0] === 697,
        ),
    );
  } finally {
    h.db.close();
  }
});

test("new snapshots fetched during a repair reach the next audit alongside earlier receipts", async () => {
  const issue: AuditIssue = {
    kind: "unsupported-interpretation",
    domain: "recording",
    message: "Do not describe the incomplete loop as completed.",
    sequences: [666],
  };
  const h = harness(
    attempt(),
    [
      [364, 666],
      [697, 364],
    ],
    (input, pass) => ({ ok: pass > 1, issues: pass === 1 ? [issue] : [] }),
  );
  try {
    const result = await h.run();
    assert.deepEqual(
      h.audits.map((a) =>
        a.retrievedEvidence.receipts.map((r: any) => r.input.seq),
      ),
      [
        [364, 666],
        [364, 666, 697],
      ],
    );
    assert.equal(h.inputs[1].retrievedEvidence.receipts.length, 2);
    assert.deepEqual(h.inputs[1].issues, [issue]);
    assert.deepEqual(result.research?.audit, { passes: 2, revised: true });
  } finally {
    h.db.close();
  }
});

test("contradictions still fail closed; unavailable events are reported without fabricated snapshots or retries forever", async () => {
  for (const issue of [
    missing(99999),
    {
      ...missing(364),
      kind: "contradicted-claim" as const,
      message: "The code contradicts this claim.",
    },
  ]) {
    const h = harness(attempt(), [[364], []], () => ({
      ok: false,
      issues: [issue],
    }));
    try {
      await assert.rejects(h.run(), (error: Error) => {
        assert.match(error.message, /observations about your recording/);
        assert.doesNotMatch(error.message, /technical claims/);
        assert.match(
          error.message,
          issue.kind === "missing-evidence"
            ? /evidence is missing/
            : /conflicts/,
        );
        return true;
      });
      assert.equal(h.inputs.length, 2);
      assert.equal(h.audits.length, 2);
      assert.equal(h.r.evidenceContexts.size, 0);
      if (issue.kind === "missing-evidence")
        assert.equal(h.inputs[1].unavailableEvidence[0].seq, 99999);
    } finally {
      h.db.close();
    }
  }
});

test("receipts stay scoped to their attempt, preserve fetched learner evidence, and omit repeated research excerpts", () => {
  const a = attempt();
  const aid = a.events.find((e) => e.seq === 487)!.assistanceId;
  a.javaHelp = [
    {
      id: aid,
      deliveredAt: 123,
      answer: "Delivered reference",
      research: { sources: [{ excerpt: "very long documentation" }] },
    },
  ] as any;
  const ledger = new AgentEvidence(a);
  const receipt = ledger.read(487);
  assert.equal(receipt.assistance?.answer, "Delivered reference");
  assert.equal("research" in receipt.assistance!, false);
  ledger.capture(
    "find_skill_evidence",
    { query: "loops" },
    { evidence: [{ id: "skill-evidence" }] },
  );
  assert.equal(ledger.bundle().receipts.length, 2);
  assert.equal(
    new AgentEvidence({ ...a, id: "another-attempt" }).bundle().receipts.length,
    0,
  );
  const other = new AgentEvidence({ ...a, id: "another-attempt" }).read(487);
  assert.notEqual(other.receiptId, receipt.receiptId);
  a.javaHelp![0].deliveredAt = undefined;
  assert.equal(new AgentEvidence(a).read(487).assistance?.answer, undefined);
  assert.throws(() => ledger.read(NaN), /No such/);
  assert.match(
    evidenceAuditError([{ ...missing(1), domain: "technical" }]).message,
    /technical claims/,
  );
});

test("reflection output validation repairs inconsistent fields before audit and stays bounded on repeated failure", async () => {
  for (const repeatFailure of [false, true]) {
    const a = attempt();
    const h = harness(
      a,
      [[364], []],
      () => ({ ok: true, issues: [] }),
      (turn) => {
        const check = {
          status: "open",
          evidence: [],
          recordingEvidence: [],
          assessment: "An explanation is pending.",
          uncertainty: "How the approach works is unresolved.",
        };
        return {
          message: "What did you intend?",
          askedQuestionIds: [],
          surfacedQuestionIds: [],
          coachingSelectionNote: "Ask about intended mechanics first.",
          status: "exploring",
          focus: null,
          checks: {
            approach: {
              ...check,
              uncertainty:
                turn === 1 || repeatFailure ? null : check.uncertainty,
            },
            timeComplexity: check,
            spaceComplexity: check,
          },
          evaluation: {
            development: {
              ...developmentFixture(),
              approaches: [],
              baselineApproachId: null,
              activeApproachId: null,
            },
            summary: "Explanation pending.",
            strengths: [],
            gaps: [],
            moments: [],
            exercise: { skill: "", title: "", prompt: "", rubric: "" },
          },
          technicalClaims: [],
        };
      },
    );
    try {
      const run = h.run((value) => {
        validateReflection(a, reflectionOutputSchema.parse(value));
      });
      if (repeatFailure) {
        await assert.rejects(run, /inconsistent response and could not repair/);
        assert.equal(h.audits.length, 0);
      } else {
        const result = await run;
        assert.equal(h.audits.length, 1);
        assert.deepEqual(result.research?.audit, { passes: 2, revised: true });
      }
      assert.equal(h.inputs.length, 2);
      assert.equal(h.inputs[1].issues[0].kind, "invalid-response");
      assert.equal(h.inputs[1].issues[0].domain, "response");
      assert.match(h.inputs[1].issues[0].message, /uncertainty/);
      assert.equal(h.inputs[1].retrievedEvidence.receipts[0].input.seq, 364);
      const model = h.db.list().runs.find((r) => r.kind === "model")!;
      assert.equal(
        h.db
          .detail(model.id)
          .events.filter(
            (e: any) =>
              e.kind === "validation.failed" &&
              e.data.stage === "response-validation",
          ).length,
        repeatFailure ? 2 : 1,
      );
      assert.equal(h.r.evidenceContexts.size, 0);
    } finally {
      h.db.close();
    }
  }
});
