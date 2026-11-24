import { test } from "node:test";
import assert from "node:assert/strict";
import { AttemptStore } from "../lib/store";
import {
  startPrescription,
  prescriptionStatus,
  answerCatalogRequest,
  savedPrescription,
} from "../lib/prescription";
import {
  captureSnapshot,
  parseSnapshot,
  replaceLibrary,
} from "../lib/snapshots";
import { demoProblem } from "../lib/demo";
import { recommend } from "../lib/recommendation";
import { AgentRuntime } from "../lib/agents";
import { lowSettings } from "../lib/agent-settings";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { advanceGeneration } from "../lib/data-environment";
const choice = { model: "fixture-planner", effort: "low" };
const candidate = {
  title: "Ransom Note",
  titleSlug: "ransom-note",
  difficulty: "Easy",
  isPaidOnly: false,
  topicTags: [{ name: "String" }],
};
const problem = {
  ...demoProblem,
  ...candidate,
  questionId: "383",
  questionFrontendId: "383",
  locked: false,
};

type Run = NonNullable<
  NonNullable<Parameters<typeof startPrescription>[2]>["run"]
>;
const validRun: Run = async (input: any, tools, selectedChoice) => {
  assert.deepEqual(selectedChoice, choice);
  await tools.handle("search_problems", {
    search: "ransom",
    difficulty: "EASY",
    skip: 0,
  });
  await tools.handle("inspect_problem", { slug: candidate.titleSlug });
  return {
    value: {
      slug: candidate.titleSlug,
      reason:
        "Revisit implementation fluency with a small new challenge and check independent recall.",
      kind: "new-challenge",
      minutes: 20,
      evidenceIds: input.evidence.slice(0, 1).map((e: any) => e.id),
    },
    ...choice,
  };
};
async function drive(
  db: AttemptStore,
  response: (op: string) => unknown = (op) =>
    op === "list" ? { totalNum: 1, questions: [candidate] } : problem,
) {
  for (let tick = 0; tick < 100; tick++) {
    const state = prescriptionStatus(db, choice);
    if (state.job?.state !== "running") return state;
    for (const request of state.job.requests)
      answerCatalogRequest(db, state.job.id, request.id, response(request.op));
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Fixture did not finish");
}

test("agent chooses from live catalog, verifies Java access, saves provenance and survives snapshot restore", async () => {
  const db = new AttemptStore(":memory:");
  const sandbox = new AttemptStore(":memory:", true);
  let calls = 0;
  startPrescription(db, false, {
    choice,
    run: async (...args) => {
      calls++;
      return validRun(...args);
    },
  });
  const status = await drive(db);
  assert.equal(status.job?.state, "complete", status.job?.error ?? "");
  assert.equal(status.prescription?.slug, "ransom-note");
  assert.equal(status.prescription?.minutes, 20);
  assert.ok(status.prescription?.evidence[0].url);
  assert.equal(db.memory.uses()[0].attemptId, undefined);
  assert.equal(db.history().length, 0);
  startPrescription(db, false, { choice, run: validRun });
  assert.equal(calls, 1);
  const snap = parseSnapshot(
    captureSnapshot(
      db,
      sandbox,
      { settings: null, browser: {}, pagesPreview: null },
      "Fixture",
    ),
  );
  const restored = new AttemptStore(":memory:");
  replaceLibrary(restored, snap.practice);
  assert.deepEqual(savedPrescription(restored, choice), status.prescription);
  db.db.close();
  sandbox.db.close();
  restored.db.close();
});

test("cold start has no invented skill deficit or hardcoded problem", async () => {
  const db = new AttemptStore(":memory:");
  db.db.exec(
    "DELETE FROM skill_evidence; DELETE FROM skill_evidence_search; DELETE FROM historical_evidence; DELETE FROM coaching_memories;",
  );
  assert.equal(recommend([]), null);
  startPrescription(db, false, { choice, run: validRun });
  const status = await drive(db);
  assert.equal(status.job?.state, "complete", status.job?.error ?? "");
  assert.deepEqual(status.prescription?.evidence, []);
  db.db.close();
});

test("unverified choices, invented evidence and inaccessible problems never become prescriptions", async () => {
  for (const kind of [
    "unverified",
    "invented",
    "locked",
    "no-java",
    "identity",
  ]) {
    const db = new AttemptStore(":memory:");
    const run: Run = async (...args) => {
      if (kind === "unverified")
        return {
          value: {
            slug: "invented",
            reason: "A manageable next challenge without actual verification.",
            kind: "new-challenge",
            minutes: 25,
            evidenceIds: [],
          },
          ...choice,
        };
      const r = await validRun(...args);
      if (kind === "invented")
        (r.value as any).evidenceIds = ["invented-record"];
      return r;
    };
    startPrescription(db, false, { choice, run });
    const result = await drive(db, (op) =>
      op === "list"
        ? { totalNum: 1, questions: [candidate] }
        : {
            ...problem,
            locked: kind === "locked",
            javaStarter: kind === "no-java" ? null : problem.javaStarter,
            titleSlug:
              kind === "identity" ? "other-problem" : problem.titleSlug,
          },
    );
    assert.equal(result.job?.state, "failed", kind);
    assert.equal(result.prescription, undefined);
    assert.equal(db.memory.uses().length, 0);
    db.db.close();
  }
});

test("only active preferences and nonexcluded corrected evidence reach the planner", async () => {
  const db = new AttemptStore(":memory:");
  const suggested = db.memory.list()[0];
  suggested.status = "proposed";
  db.db
    .prepare("UPDATE coaching_memories SET data=? WHERE id=?")
    .run(JSON.stringify(suggested), suggested.id);
  const [excluded, corrected] = db.memory.search();
  db.memory.correctEvidence(
    excluded.id,
    0,
    "Exclude this erroneous interpretation",
    true,
  );
  db.memory.correctEvidence(
    corrected.id,
    0,
    "This was explained independently",
  );
  const run: Run = async (input: any, tools, selectedChoice) => {
    assert.ok(
      input.activePreferences.every(
        (p: any) => db.memory.get(p.id)?.status === "active",
      ),
    );
    assert.ok(!input.activePreferences.some((p: any) => p.id === suggested.id));
    assert.ok(!input.evidence.some((e: any) => e.id === excluded.id));
    const { records } = (await tools.handle("find_skill_evidence", {
      query: "",
      skillId: null,
    })) as any;
    assert.ok(!records.some((e: any) => e.id === excluded.id));
    assert.equal(
      records.find((e: any) => e.id === corrected.id).correction.text,
      "This was explained independently",
    );
    return validRun(input, tools, selectedChoice);
  };
  startPrescription(db, false, { choice, run });
  const checked = await drive(db);
  assert.equal(checked.job?.state, "complete", checked.job?.error ?? "");
  db.memory.correctEvidence(
    corrected.id,
    1,
    "New evidence changes the interpretation",
  );
  assert.equal(savedPrescription(db, choice), undefined);
  db.db.close();
});

test("another choice excludes the prior suggestion, reuses concurrent work, and cannot change practice evidence", async () => {
  const db = new AttemptStore(":memory:");
  const before = db.memory.search();
  startPrescription(db, false, { choice, run: validRun });
  const first = await drive(db);
  let calls = 0;
  const next = startPrescription(db, true, {
    choice,
    run: async (input: any, tools) => {
      calls++;
      assert.deepEqual(input.skippedSlugs, [candidate.titleSlug]);
      const results = (await tools.handle("search_problems", {
        search: "",
        difficulty: "EASY",
        skip: 0,
      })) as any;
      assert.equal(results.questions.length, 0);
      await assert.rejects(
        tools.handle("inspect_problem", { slug: candidate.titleSlug }),
        /skipped/,
      );
      throw new Error("No suitable alternative in fixture");
    },
  });
  assert.equal(
    startPrescription(db, true, { choice, run: validRun }).job?.id,
    next.job?.id,
  );
  const state = await drive(db);
  assert.equal(calls, 1);
  assert.equal(state.job?.state, "failed");
  assert.deepEqual(state.prescription, first.prescription);
  assert.deepEqual(db.memory.search(), before);
  db.db.close();
});

test("history changes during generation cannot save stale advice; active attempts take precedence", async () => {
  const db = new AttemptStore(":memory:");
  startPrescription(db, false, {
    choice,
    run: async (...args) => {
      const result = await validRun(...args);
      db.memory.add({ text: "Prefer brief reasons", scope: "planning" });
      return result;
    },
  });
  const status = await drive(db);
  assert.equal(status.job?.state, "failed");
  assert.match(status.job!.error!, /changed/);
  const a = db.create({ ...problem, titleSlug: "ransom-note" }, 60000, false);
  assert.equal(recommend(db.history())?.basedOn, a.id);
  assert.throws(
    () => startPrescription(db, false, { choice, run: validRun }),
    /current learning session/,
  );
  db.db.close();
});

test("planner runtime exposes only scoped prescription tools, honors Low, and cleans up", async () => {
  const runtime = new AgentRuntime(() => lowSettings("fixture-planner"));
  runtime.connect = async () => {};
  runtime.status = async () => ({
    signedIn: true,
    plan: "test",
    model: "fixture-planner",
    provider: "test",
  });
  runtime.models = async () => [
    { model: "fixture-planner", name: "Fixture", efforts: ["low"] },
  ];
  const calls: any[] = [];
  runtime.rpc = async (method, params: any) => {
    calls.push({ method, params });
    if (method === "thread/start")
      return { thread: { id: "prescription-thread" }, model: params.model };
    if (method === "turn/start") {
      queueMicrotask(() => {
        runtime.receive({
          method: "item/completed",
          params: {
            threadId: "prescription-thread",
            item: { type: "agentMessage", text: "{}" },
          },
        });
        runtime.receive({
          method: "turn/completed",
          params: {
            threadId: "prescription-thread",
            turn: { status: "completed" },
          },
        });
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  await runtime.run("planner", "Select", {}, {}, undefined, choice, {
    tools: {
      definitions: [
        {
          type: "function",
          name: "search_problems",
          description: "Search",
          inputSchema: {},
        },
      ],
      handle: async () => ({}),
    },
  });
  assert.deepEqual(
    calls
      .find((c) => c.method === "thread/start")
      .params.dynamicTools.map((t: any) => t.name),
    ["search_problems"],
  );
  assert.equal(
    calls.find((c) => c.method === "turn/start").params.effort,
    "low",
  );
  assert.equal(runtime.toolContexts.size, 0);
  assert.equal(calls.filter((c) => c.method === "thread/start").length, 1);
});

test("a library reset cancels pending catalog work without saving stale prescriptions", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duo-prescription-"));
  const prior = process.env.DUO_DATABASE;
  process.env.DUO_DATABASE = path.join(dir, "practice.sqlite");
  const db = new AttemptStore(":memory:");
  try {
    startPrescription(db, false, { choice, run: validRun });
    assert.equal(prescriptionStatus(db, choice).job?.requests.length, 1);
    advanceGeneration();
    assert.equal(prescriptionStatus(db, choice).job?.state, "failed");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.memory.uses().length, 0);
    startPrescription(db, false, { choice, run: validRun });
    const state = await drive(db);
    assert.equal(state.job?.state, "complete", state.job?.error ?? "");
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
    if (prior === undefined) delete process.env.DUO_DATABASE;
    else process.env.DUO_DATABASE = prior;
  }
});

test("catalog failures are retryable and a successful retry leaves attempts untouched", async () => {
  const db = new AttemptStore(":memory:");
  startPrescription(db, false, { choice, run: validRun });
  const state = prescriptionStatus(db, choice);
  answerCatalogRequest(
    db,
    state.job!.id,
    state.job!.requests[0].id,
    undefined,
    "Browser bridge unavailable",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prescriptionStatus(db, choice).job?.state, "failed");
  assert.equal(db.memory.uses().length, 0);
  startPrescription(db, false, { choice, run: validRun });
  assert.equal((await drive(db)).job?.state, "complete");
  assert.equal(db.history().length, 0);
  db.db.close();
});

test("explicit revisit targets reach the planner after reflection completion and excluded targets do not", async () => {
  const { developmentFixture } = await import("../tools/reflection-fixture");
  for (const excluded of [false, true]) {
    const db = new AttemptStore(":memory:");
    const a = db.create(demoProblem, 60000, false);
    db.transition(a.id, "finish");
    const saved = db.get(a.id);
    saved.phase = "complete";
    saved.learningExit = { reason: "manual", at: Date.now() };
    const development = developmentFixture();
    development.approaches[0].focus = {
      startSeq: 0,
      endSeq: 0,
      mode: "snapshot",
      label: "Final draft",
      pauseSeq: 0,
    };
    development.revisits = [
      {
        id: "reimplement",
        approachId: "solution",
        skill: "Independent implementation",
        reason:
          "The discussed repair needs independent implementation in a later attempt.",
        kind: "implementation",
        status: "open",
        evidence: [0],
        learnerEvidence: [],
      },
    ];
    saved.evaluations = [
      {
        development,
        summary: "Reflection finished; later practice remains.",
        strengths: [],
        gaps: [],
        moments: [],
        exercise: { skill: "Recall", title: "Recall", prompt: "Recall" },
        version: "test",
        createdAt: Date.now(),
        evidenceThrough: saved.lastSeq,
      },
    ];
    db.save(saved);
    const target = db.memory
      .search({ attemptId: a.id })
      .find((e) => e.outcome === "revisit")!;
    if (excluded)
      db.memory.correctEvidence(target.id, 0, "Do not use this target.", true);
    db.memory.indexImported(
      Array.from({ length: 205 }, (_, i) => ({
        id: `newer-${i}`,
        skill: `Recent topic ${i}`,
        observation: "A newer unrelated observation.",
        date: new Date(Date.now() + 10000 + i).toISOString(),
      })),
    );
    assert.equal(
      db.memory.search({ limit: 200 }).some((e) => e.id === target.id),
      false,
    );

    let inspected = false;
    startPrescription(db, false, {
      choice,
      run: async (input: any, ...rest) => {
        inspected = true;
        assert.equal(
          input.outstandingRevisits.some((e: any) => e.id === target.id),
          !excluded,
        );
        assert.equal(
          input.evidence.some((e: any) => e.id === target.id),
          !excluded,
        );
        return validRun(input, ...rest);
      },
    });
    const status = await drive(db);
    assert.equal(status.job?.state, "complete", status.job?.error ?? "");
    assert.equal(inspected, true);
    db.db.close();
  }
});
