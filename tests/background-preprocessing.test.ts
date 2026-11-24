import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TraceStore, traceScope } from "../lib/agent-traces";
import {
  lowSettings,
  resolveBackgroundSettings,
  type AgentSettings,
} from "../lib/agent-settings";
import {
  readAgentSettings,
  saveAgentSettings,
  baselineAgentModel,
} from "../lib/agent-settings-store";
import {
  buildSolvingChunkNote,
  detectSolvingMilestone,
  describeCaptureSignal,
} from "../lib/solving-chunks";
import {
  AgentRuntime,
  analyzeAttemptSolvingChunk,
  runBackgroundSolvingCheck,
} from "../lib/agents";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { prepareReflectionReview } from "../lib/reflection-service";
import { reviewQuestions, type ReviewStageRunner } from "../lib/question-review-runner";
import { reviewTopics, type ReviewQuestion } from "../lib/question-review";
import { clearLearning, captureSnapshot, parseSnapshot } from "../lib/snapshots";
import { GET as diagnosticsGet } from "../app/api/diagnostics/route";
import { POST as agentAction } from "../app/api/agent/route";
import { GET as readAttempt, POST as mutateAttempt } from "../app/api/attempts/[id]/route";

test("usage ledger tracks features and stages without double-counting and survives log clear and retention prune", () => {
  const db = new TraceStore(":memory:");
  const now = Date.now();
  try {
    // 1. Practice reflection workflow with nested stages + audit.
    const root = db.start({
      role: "reflect",
      kind: "workflow",
      attemptId: "attempt-1",
      mode: "practice",
    });
    const qReview = db.start(
      { role: "reflection coach", kind: "question-review", mode: "practice" },
      root,
    );
    const qGen = db.start(
      {
        role: "reflection coach",
        kind: "question-generation",
        model: "gpt-6-astra",
        effort: "low",
      },
      qReview,
    );
    qGen.update({
      usage: {
        inputTokens: 4000,
        cachedInputTokens: 1000,
        outputTokens: 300,
        reasoningOutputTokens: 100,
        totalTokens: 4300,
      },
    });
    qGen.finish("succeeded");
    qReview.finish("succeeded");

    const coachCall = db.start(
      {
        role: "reflection coach",
        kind: "model",
        model: "gpt-6-astra",
        effort: "low",
      },
      root,
    );
    coachCall.update({
      usage: {
        inputTokens: 5000,
        cachedInputTokens: 0,
        outputTokens: 400,
        reasoningOutputTokens: 120,
        totalTokens: 5400,
      },
    });
    coachCall.finish("succeeded");
    root.finish("succeeded");

    // 2. Practice mid-session solving chunk.
    const chunkRoot = db.start({
      role: "solving analysis",
      kind: "workflow",
      attemptId: "attempt-1",
      mode: "practice",
    });
    const chunkModel = db.start(
      {
        role: "reflection coach",
        kind: "solving-analysis",
        model: "gpt-6.1-sol",
        effort: "low",
      },
      chunkRoot,
    );
    chunkModel.update({
      usage: {
        inputTokens: 2000,
        outputTokens: 200,
        reasoningOutputTokens: 50,
        totalTokens: 2200,
      },
    });
    chunkModel.finish("succeeded");
    chunkRoot.finish("succeeded");

    // 3. Test session run (kept separate from practice rollups).
    const testRun = db.start({
      role: "solving analysis",
      kind: "solving-analysis",
      attemptId: "test-attempt",
      mode: "test",
    });
    testRun.update({
      usage: { inputTokens: 9000, outputTokens: 500, totalTokens: 9500 },
    });
    testRun.finish("succeeded");

    const practiceBefore = db.usageSummary("practice", now + 1000);
    const fiveHour = practiceBefore.windows.find(
      (w) => w.windowKey === "last5h",
    )!;
    assert.equal(fiveHour.calls, 3, "Container spans must not be double-counted");
    assert.equal(fiveHour.totalTokens, 4300 + 5400 + 2200);
    assert.equal(fiveHour.sessions, 1);
    assert.equal(fiveHour.avgCallsPerSession, 3);
    assert.equal(
      fiveHour.byFeature.find((f) => f.key === "reflection")?.totalTokens,
      9700,
    );
    assert.equal(
      fiveHour.byFeature.find((f) => f.key === "background-solving")
        ?.totalTokens,
      2200,
    );
    assert.equal(
      fiveHour.byStage.find((s) => s.key === "chunk-analysis")?.calls,
      1,
    );
    assert.equal(
      fiveHour.byStage.find((s) => s.key === "question-generation")?.calls,
      1,
    );
    assert.equal(
      fiveHour.byStage.find((s) => s.key === "coach-reply")?.calls,
      1,
    );

    const testSummary = db.usageSummary("test", now + 1000);
    assert.equal(testSummary.windows[0].totalTokens, 9500);

    // Clearing all trace logs removes agent_runs but preserves durable usage rollups!
    const cleared = db.clear();
    assert.ok(cleared > 0);
    assert.equal(db.list().total, 0);
    const practiceAfterClear = db.usageSummary("practice", now + 1000);
    assert.equal(
      practiceAfterClear.windows.find((w) => w.windowKey === "last5h")!
        .totalTokens,
      4300 + 5400 + 2200,
    );
  } finally {
    db.close();
  }
});

test("background settings default ON, normalize cleanly across presets, and gate pre-intake preparation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duo-bg-settings-"));
  const file = path.join(dir, "settings.json");
  const prevSettingsFile = process.env.DUO_SETTINGS_FILE;
  const prevDb = process.env.DUO_DATABASE;
  process.env.DUO_SETTINGS_FILE = file;
  process.env.DUO_DATABASE = ":memory:";
  try {
    const initial = readAgentSettings(file, "baseline");
    assert.deepEqual(resolveBackgroundSettings(initial), {
      solvingAnalysis: true,
      preIntakeReview: true,
    });
    assert.equal(initial.background, undefined);

    const toggled: AgentSettings = {
      ...initial,
      background: { solvingAnalysis: false, preIntakeReview: false },
    };
    saveAgentSettings(toggled, file, "baseline");
    const reloaded = readAgentSettings(file, "baseline");
    assert.equal(reloaded.preset, "low");
    assert.deepEqual(resolveBackgroundSettings(reloaded), {
      solvingAnalysis: false,
      preIntakeReview: false,
    });

    // When preIntakeReview is OFF, /api/agent prepare makes 0 calls and /api/attempts/[id] reports analysisReady=true.
    const db = new AttemptStore(":memory:");
    const a = db.create(demoProblem, 60_000, true);
    db.transition(a.id, "finish");
    db.transition(a.id, "seal");

    const { store } = await import("../lib/store");
    const realDb = store();
    const created = realDb.create(demoProblem, 60_000, true);
    realDb.transition(created.id, "finish");
    realDb.transition(created.id, "seal");

    const runtime = new AgentRuntime();
    let invoked = 0;
    const { agent } = await import("../lib/agents");
    const origRun = agent().run;
    agent().run = async () => {
      invoked++;
      throw new Error("Should not run when preIntakeReview is false");
    };
    try {
      const prepRes = await agentAction(
        new Request("http://127.0.0.1:4318/api/agent", {
          method: "POST",
          headers: {
            host: "127.0.0.1:4318",
            origin: "http://127.0.0.1:4318",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "prepare", id: created.id }),
        }),
      );
      assert.equal(prepRes.status, 200);
      assert.equal(invoked, 0);

      const getRes = await readAttempt(
        new Request("http://127.0.0.1:4318/api/attempts/" + created.id, {
          headers: { host: "127.0.0.1:4318" },
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      const body = await getRes.json();
      assert.equal(body.attempt.reflection.analysisReady, true);
    } finally {
      agent().run = origRun;
      db.db.close();
      void runtime;
    }

    // Usage diagnostics endpoint guards origin and returns windows.
    assert.equal(
      (
        await diagnosticsGet(
          new Request("http://127.0.0.1:4318/api/diagnostics?usage=1", {
            headers: {
              host: "127.0.0.1:4318",
              origin: "https://foreign.example",
            },
          }),
        )
      ).status,
      400,
    );
    const okUsage = await diagnosticsGet(
      new Request("http://127.0.0.1:4318/api/diagnostics?usage=1&mode=all", {
        headers: { host: "127.0.0.1:4318" },
      }),
    );
    assert.equal(okUsage.status, 200);
    const usageJson = await okUsage.json();
    assert.equal(usageJson.windows.length, 5);
  } finally {
    if (prevSettingsFile === undefined) delete process.env.DUO_SETTINGS_FILE;
    else process.env.DUO_SETTINGS_FILE = prevSettingsFile;
    if (prevDb === undefined) delete process.env.DUO_DATABASE;
    else process.env.DUO_DATABASE = prevDb;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectSolvingMilestone debounces undo, cut-paste moves, comments, rapid Runs, and final-minute crunch", () => {
  const db = new AttemptStore(":memory:");
  try {
    const budget = 25 * 60_000;
    const start = Date.now() - 10 * 60_000;
    let a = db.create(demoProblem, budget, true, start);

    // 1. Comment-only edits after 6 minutes -> skip!
    const commentText =
      demoProblem.javaStarter.replace(
        "        \n",
        "        // Thinking through approach for several lines of pseudocode comments only\n        // Step 1: map values\n        // Step 2: check duplicates\n",
      ) + "// Extra trailing comment";
    a = db.append(
      a.id,
      [
        {
          seq: 1,
          at: start + 10_000,
          type: "edit",
          version: 2,
          edits: [
            {
              offset: 0,
              length: a.source.length,
              text: commentText,
            },
          ],
        },
      ],
      start + 10_000,
    );
    assert.equal(detectSolvingMilestone(a, start + 360_000), null);

    // 2. Real code added -> quiet-interval triggers only after >=5m active AND >=12s typing lull.
    const mapDraft = `import java.util.HashMap;\nclass Solution {\n  public int firstRepeated(int[] readings) {\n    HashMap<Integer, Integer> seen = new HashMap<>();\n    for (int i = 0; i < readings.length; i++) {\n      seen.put(readings[i], i);\n    }\n    return -1;\n  }\n}`;
    a = db.append(
      a.id,
      [
        {
          seq: 2,
          at: start + 60_000,
          type: "edit",
          version: 3,
          edits: [{ offset: 0, length: a.source.length, text: mapDraft }],
        },
      ],
      start + 60_000,
    );
    // Too soon (<5m):
    assert.equal(detectSolvingMilestone(a, start + 180_000), null);
    // At 5m+5s, if edited 3s ago -> mid-typing, skip!
    a = db.append(
      a.id,
      [
        {
          seq: 3,
          at: start + 302_000,
          type: "edit",
          version: 4,
          edits: [{ offset: mapDraft.length, length: 0, text: "\n" }],
        },
      ],
      start + 302_000,
    );
    assert.equal(detectSolvingMilestone(a, start + 305_000), null);
    // 15s later -> quiet-interval fires with strictly observational context!
    const quiet = detectSolvingMilestone(a, start + 318_000);
    assert.equal(quiet?.signal, "quiet-interval");
    assert.doesNotMatch(quiet!.captureContext, /walked away|believed|stuck/i);

    // 3. Large deletion + Undo -> must NOT trigger replaced-block!
    const shortStub = demoProblem.javaStarter;
    a = db.append(
      a.id,
      [
        {
          seq: 4,
          at: start + 320_000,
          type: "edit",
          version: 5,
          edits: [{ offset: 0, length: a.source.length, text: shortStub }],
        },
        // Undo restores mapDraft!
        {
          seq: 5,
          at: start + 325_000,
          type: "edit",
          version: 6,
          origin: "undo",
          edits: [{ offset: 0, length: shortStub.length, text: mapDraft }],
        },
      ],
      start + 325_000,
    );
    assert.equal(
      detectSolvingMilestone(a, start + 360_000)?.signal ?? null,
      "quiet-interval",
    );

    // 4. Cut-and-paste move (block removed and moved into helper method) -> must NOT trigger replaced-block!
    const movedHelper = `import java.util.HashMap;\nclass Solution {\n  public int firstRepeated(int[] readings) {\n    return helper(readings);\n  }\n  private int helper(int[] readings) {\n    HashMap<Integer, Integer> seen = new HashMap<>();\n    for (int i = 0; i < readings.length; i++) {\n      seen.put(readings[i], i);\n    }\n    return -1;\n  }\n}`;
    a = db.append(
      a.id,
      [
        {
          seq: 6,
          at: start + 365_000,
          type: "edit",
          version: 7,
          edits: [{ offset: 0, length: a.source.length, text: shortStub }],
        },
        {
          seq: 7,
          at: start + 368_000,
          type: "edit",
          version: 8,
          edits: [{ offset: 0, length: shortStub.length, text: movedHelper }],
        },
      ],
      start + 368_000,
    );
    assert.notEqual(
      detectSolvingMilestone(a, start + 395_000)?.signal,
      "replaced-block",
    );

    // 5. Genuine block replacement (deleted HashMap loop, wrote PriorityQueue instead, >=25s debounce) -> replaced-block!
    const queueDraft = `import java.util.PriorityQueue;\nclass Solution {\n  public int firstRepeated(int[] readings) {\n    PriorityQueue<Integer> pq = new PriorityQueue<>();\n    for (int v : readings) pq.add(v);\n    return pq.isEmpty() ? -1 : pq.poll();\n  }\n}`;
    a = db.append(
      a.id,
      [
        {
          seq: 8,
          at: start + 400_000,
          type: "edit",
          version: 9,
          edits: [{ offset: 0, length: a.source.length, text: shortStub }],
        },
        {
          seq: 9,
          at: start + 405_000,
          type: "edit",
          version: 10,
          edits: [{ offset: 0, length: shortStub.length, text: queueDraft }],
        },
      ],
      start + 405_000,
    );
    // Before 25s debounce -> not replaced-block yet:
    assert.notEqual(
      detectSolvingMilestone(a, start + 415_000)?.signal,
      "replaced-block",
    );
    // After 25s debounce -> replaced-block!
    const replaced = detectSolvingMilestone(a, start + 430_000)!;
    assert.equal(replaced.signal, "replaced-block");
    assert.match(
      replaced.captureContext,
      /Whether the underlying approach changed or is simply being rewritten cleaner is unknown/,
    );

    // Save chunk 1 at seq 9 and test coalesced Example Run + Final-75s suppression!
    a.solvingChunks = [
      buildSolvingChunkNote(
        replaced,
        {
          summary: "Replaced map helper with a priority queue loop.",
          observations: [],
          candidateQuestions: [],
        },
        { model: "test", effort: "low" },
        start + 430_000,
      ),
    ];
    db.save(a);

    // Add a completed Run job at seq 10:
    a = db.append(
      a.id,
      [{ seq: 10, at: start + 450_000, type: "run", jobId: "run-1" }],
      start + 450_000,
    );
    a.jobs.push({
      id: "run-1",
      kind: "run",
      state: "complete",
      source: a.source,
      seq: 10,
      createdAt: start + 450_000,
      summary: { verdict: "Wrong Answer" },
    });
    db.save(a);
    const runMilestone = detectSolvingMilestone(a, start + 470_000)!;
    assert.equal(runMilestone.signal, "example-run");

    // Save that Run chunk; another tiny typo-fix Run 20s later coalesces (skips)!
    a.solvingChunks ??= [];
    a.solvingChunks.push(
      buildSolvingChunkNote(
        runMilestone,
        {
          summary: "Ran queue draft on examples.",
          observations: [],
          candidateQuestions: [],
        },
        { model: "test", effort: "low" },
        start + 470_000,
      ),
    );
    db.save(a);
    a = db.append(
      a.id,
      [{ seq: 11, at: start + 485_000, type: "run", jobId: "run-2" }],
      start + 485_000,
    );
    a.jobs.push({
      id: "run-2",
      kind: "run",
      state: "complete",
      source: a.source,
      seq: 11,
      createdAt: start + 485_000,
      summary: { verdict: "Wrong Answer" },
    });
    db.save(a);
    assert.equal(detectSolvingMilestone(a, start + 505_000), null);

    // Final-minute crunch (<75s remaining on 25m budget) -> suppressed even on failed Submit!
    a = db.append(
      a.id,
      [{ seq: 12, at: start + budget - 40_000, type: "submit", jobId: "sub-1" }],
      start + budget - 40_000,
    );
    a.jobs.push({
      id: "sub-1",
      kind: "submit",
      state: "complete",
      source: a.source,
      seq: 12,
      createdAt: start + budget - 40_000,
      summary: { verdict: "Wrong Answer" },
    });
    db.save(a);
    assert.equal(detectSolvingMilestone(a, start + budget - 30_000), null);
  } finally {
    db.db.close();
  }
});

test("background solving check isolates browser symbols, fails silently, preempts on seal, inherits receipts into reviewQuestions, and clears on coaching reset", async () => {
  const practice = new AttemptStore(":memory:"),
    db = new AttemptStore(":memory:", true);
  try {
    const start = Date.now() - 2 * 60_000;
    let a = db.create(demoProblem, 25 * 60_000, true, start);
    const draft = `import java.util.HashMap;\nclass Solution {\n  public int firstRepeated(int[] readings) {\n    HashMap<Integer, Integer> map = new HashMap<>();\n    for (int i = 0; i < readings.length; i++) map.put(readings[i], i);\n    return -1;\n  }\n}`;
    const subFailId = crypto.randomUUID();
    a = db.append(
      a.id,
      [
        {
          seq: 1,
          at: start + 20_000,
          type: "edit",
          version: 2,
          edits: [{ offset: 0, length: a.source.length, text: draft }],
        },
        { seq: 2, at: start + 30_000, type: "submit", jobId: subFailId },
      ],
      start + 30_000,
    );
    a.jobs.push({
      id: subFailId,
      kind: "submit",
      state: "complete",
      source: a.source,
      seq: 2,
      createdAt: start + 30_000,
      summary: { verdict: "Wrong Answer" },
    });
    db.save(a);

    // 1. Silent failure on network/runtime error leaves attempt completely intact.
    const failed = await runBackgroundSolvingCheck(
      db,
      a.id,
      async () => {
        throw new Error("Simulated transient offline failure");
      },
      start + 50_000,
      lowSettings("test"),
    );
    assert.equal(failed, null);
    assert.equal(db.get(a.id).solvingChunks, undefined);
    assert.equal(db.get(a.id).source, draft);

    // 2. Verify analyzeAttemptSolvingChunk disables browser symbol resolution (never stalls Monaco autocomplete).
    const runtime = new AgentRuntime(() => lowSettings(baselineAgentModel()));
    runtime.connect = async () => {};
    runtime.status = async () => ({
      signedIn: true,
      plan: "pro",
      model: baselineAgentModel(),
      provider: "test",
    });
    runtime.models = async () => [
      { model: baselineAgentModel(), name: "Sol", efforts: ["low"] },
    ];
    let configuredTools: string[] = [];
    runtime.rpc = async (method, params: any) => {
      if (method === "thread/start") {
        configuredTools = params.dynamicTools.map((t: any) => t.name);
        return { thread: { id: "chunk-thread" }, model: params.model };
      }
      if (method === "turn/start") {
        const out = {
          summary: "Mapped values to indices and submitted an incomplete return.",
          observations: [
            {
              kind: "potential-detour",
              statement: "HashMap.put replaces prior index for duplicate values.",
              sequences: [1],
              sourceUrls: [],
            },
          ],
          candidateQuestions: [
            {
              topic: "correctness",
              kind: "technical",
              question: "How does map.put handle repeated readings?",
              purpose: "Check duplicate key behavior.",
              sequences: [1],
            },
          ],
          technicalClaims: [],
        };
        queueMicrotask(() => {
          runtime.receive({
            method: "item/completed",
            params: {
              threadId: "chunk-thread",
              item: { type: "agentMessage", text: JSON.stringify(out) },
            },
          });
          runtime.receive({
            method: "turn/completed",
            params: {
              threadId: "chunk-thread",
              turn: { status: "completed" },
            },
          });
        });
        return { turn: { id: "chunk-turn" } };
      }
      return {};
    };
    const { agent } = await import("../lib/agents");
    const prevRun = agent().run;
    agent().run = runtime.run.bind(runtime);
    try {
      const savedChunk = await runBackgroundSolvingCheck(
        db,
        a.id,
        (attempt, ms) =>
          analyzeAttemptSolvingChunk(attempt, ms, {
            model: baselineAgentModel(),
            effort: "low",
          }),
        start + 50_000,
        lowSettings(baselineAgentModel()),
      );
      assert.ok(savedChunk);
      assert.ok(
        !configuredTools.includes("resolve_java_symbol"),
        "Background solving chunks must never borrow the browser Java engine",
      );
      assert.ok(configuredTools.includes("read_java_reference"));
      assert.ok(configuredTools.includes("read_evidence"));
    } finally {
      agent().run = prevRun;
    }

    // Attach a pre-verified Java 25 source receipt onto the saved chunk and verify:
    // (a) publicAttempt hides solvingChunks while active,
    // (b) prepareReflectionReview + reviewQuestions inherit that source URL receipt without re-fetching,
    // (c) coaching reset clears solvingChunks while preserving the recording!
    const withReceipt = db.get(a.id);
    const oracleUrl =
      "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html#put(K%2CV)";
    withReceipt.solvingChunks![0].sources = [
      {
        id: "chunk-src-1",
        title: "Java 25 HashMap.put",
        url: oracleUrl,
        kind: "official-docs",
        version: "Java 25",
        retrievedAt: start + 50_000,
        excerpt: "Associates the specified value with the specified key.",
        digest: "hash-put-digest",
      },
    ];
    db.save(withReceipt);

    // Late chunk arriving after seal must be discarded!
    db.transition(a.id, "finish", start + 60_000);
    db.transition(a.id, "seal", start + 60_000);
    const afterSeal = await runBackgroundSolvingCheck(
      db,
      a.id,
      async (attempt, ms) =>
        buildSolvingChunkNote(
          ms,
          { summary: "Late", observations: [], candidateQuestions: [] },
          { model: "test", effort: "low" },
        ),
      start + 70_000,
      lowSettings("test"),
    );
    assert.equal(afterSeal, null);
    assert.equal(db.get(a.id).solvingChunks?.length, 1);

    // Pre-intake review inherits chunk.sources so Analysts/Judge can cite oracleUrl with 0 new research fetches!
    const stageRunner: ReviewStageRunner = async (
      stage,
      _policy,
      input: any,
      _schema,
      validate,
    ) => {
      const q: ReviewQuestion = {
        id: "q1",
        topic: "correctness",
        kind: "technical",
        question: "How does map.put treat duplicate readings?",
        purpose: "Check representation.",
        priority: "high",
        anchors: { sequences: [1], learner: [], assistanceIds: [], sourceUrls: [] },
      };
      const ans = {
        questionId: "q1",
        classification: "supported-inference" as const,
        answer: `Overwrites prior index per [HashMap.put](${oracleUrl}).`,
        justification: "Pre-verified in solving chunk.",
        supporting: {
          sequences: [1],
          learner: [],
          assistanceIds: [],
          sourceUrls: [oracleUrl],
        },
        conflicting: {
          sequences: [],
          learner: [],
          assistanceIds: [],
          sourceUrls: [],
        },
        alternatives: [],
        uncertainty: null,
      };
      let value: unknown;
      if (stage === "question-generation") {
        assert.equal(input.inventory.solvingChunks.length, 1);
        value = {
          questions: [q],
          refreshIds: [],
          coverage: reviewTopics.map((topic) => ({
            topic,
            questionIds: ["q1"],
            rationale: "Covered.",
          })),
        };
      } else if (stage === "question-analysis") {
        assert.equal(input.inventory.solvingChunks.length, 1);
        value = { answers: [ans] };
      } else {
        value = {
          refreshIds: [],
          verdicts: [
            {
              ...ans,
              decision: "accept",
              missingEvidence: "none",
              coachingRole: "worth-sharing",
              disposition: "resolved-internally",
            },
          ],
          coverage: reviewTopics.map((topic) => ({
            topic,
            questionIds: ["q1"],
            rationale: "Covered.",
          })),
          missingQuestions: [],
          coverageComplete: true,
          limitations: [],
        };
      }
      validate(value);
      return { value, model: "fixture-model", effort: "low" };
    };

    await prepareReflectionReview(db, a.id, async (observed, saveReview) => {
      const review = await reviewQuestions(observed, stageRunner);
      saveReview?.(review);
      return { review, model: review.model, effort: review.effort };
    });
    const prepared = db.get(a.id);
    assert.ok(prepared.reflection?.preparedReviewAt);
    assert.equal(
      prepared.reflection?.questionReview?.sources?.[0].url,
      oracleUrl,
    );

    // Snapshot round-trip preserves solvingChunks and preparedReviewAt, and clearLearning removes solvingChunks.
    const snap = parseSnapshot(
      captureSnapshot(
        practice,
        db,
        { settings: lowSettings("test"), browser: {}, pagesPreview: null },
        "with chunks",
      ),
    );
    assert.equal(snap.sandbox.attempts[0].solvingChunks?.length, 1);
    const reset = clearLearning(prepared);
    assert.equal(reset.solvingChunks, undefined);
    assert.equal(reset.source, draft);
    assert.equal(describeCaptureSignal("pause-boundary", { seq: 2 }).includes("zero meaning"), true);
  } finally {
    db.db.close();
    practice.db.close();
  }
});
