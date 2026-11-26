// Head-to-head Option-2 (Monty snapshottable notebook) benchmark on the saved Stock recording.
// Reads baseline fixtures/reports read-only from main repo .local; writes all outputs into this worktree's .local.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { agent, reflect } from "../lib/agents";
import { validateReflection } from "../lib/reflection";
import type {
  NotebookBackend,
  NotebookCheckpoint,
} from "../lib/reflection-notebook";
import type { QuestionReview } from "../lib/question-review";
import type { Attempt } from "../lib/types";

if (process.env.DUO_DATABASE !== ":memory:")
  throw Error(
    "Run notebook-benchmark-eval with DUO_DATABASE=:memory: and an isolated DUO_TRACE_DATABASE.",
  );
if (!process.env.DUO_TRACE_DATABASE)
  throw Error(
    "Set DUO_TRACE_DATABASE to an isolated sqlite file (e.g. .local/notebook-benchmark.sqlite).",
  );
process.env.DUO_DISABLE_BROWSER_SYMBOLS ??= "1";

function resolveMainLocal(filename: string): string {
  const candidates = [
    path.resolve(process.cwd(), "../../../.local", filename),
    path.resolve(process.cwd(), "../../.local", filename),
    path.resolve(process.cwd(), ".local", filename),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Could not find ${filename} in ${candidates.join(" or ")}`);
}

const argValue = (prefix: string) =>
  process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);

const model = argValue("--model=") ?? "gpt-6-astra";
const effort = argValue("--effort=") ?? "low";
const mode = (argValue("--mode=") ?? "notebook") as "notebook" | "baseline";
if (mode !== "notebook" && mode !== "baseline") {
  throw new Error(`Invalid --mode=${mode}; expected notebook or baseline.`);
}
const backend = (argValue("--backend=") ?? "native") as NotebookBackend;
if (backend !== "native" && backend !== "wasm") {
  throw new Error(`Invalid --backend=${backend}; expected native or wasm.`);
}

const rawCapture = JSON.parse(
  readFileSync(resolveMainLocal("stock-conversation-review.json"), "utf8"),
) as Attempt;

const originalMessages = structuredClone(rawCapture.reflection?.messages ?? []);

const checkpoints = [
  {
    name: "opening-after-intake",
    throughIndex: 0,
    originalReplyIndex: 1,
    description:
      "Full 1,185-event recording + 6 Java-help entries + intake message, before any coach reply.",
  },
  {
    name: "after-repair-and-window-pivot",
    throughIndex: 8,
    originalReplyIndex: 9,
    description:
      "After placeholderPrices reuse [2], immediate-return counterexample [4..7], and exhaustive + sliding-window pivot [8].",
  },
  {
    name: "after-exhaustive-baseline",
    throughIndex: 16,
    originalReplyIndex: 17,
    description:
      "After clarifying exhaustive pairs [10..15] and stating O(n^2) time / O(1) space [16].",
  },
  {
    name: "full-completed-conversation",
    throughIndex: 24,
    originalReplyIndex: 25,
    description:
      "Full 25-message transcript through the final O(n log n) vs O(n) single-pass clarification.",
  },
] as const;

const selection =
  argValue("--checkpoint=") ??
  "opening-after-intake,after-repair-and-window-pivot,after-exhaustive-baseline";
const selected = checkpoints.filter((c) =>
  selection.split(",").includes(c.name),
);
if (!selected.length) throw Error(`Unknown checkpoint selection: ${selection}`);

const outDir = path.resolve(process.cwd(), ".local");
mkdirSync(outDir, { recursive: true });
const reportPath =
  process.env.DUO_EVAL_REPORT ??
  path.join(outDir, "notebook-benchmark-report.json");
const ipynbPath = path.join(outDir, "notebook-benchmark.ipynb");

function summarizeTraceDb(sqlitePath: string) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const runs = db
      .prepare(
        "SELECT id, role, kind, model, effort, startedAt, endedAt, status, usage FROM agent_runs ORDER BY startedAt",
      )
      .all() as Array<{
      id: string;
      role: string;
      kind: string;
      model: string | null;
      effort: string | null;
      startedAt: number;
      endedAt: number | null;
      status: string;
      usage: string | null;
    }>;
    let modelCalls = 0;
    let qrStages = 0;
    let totalIn = 0;
    let totalCached = 0;
    let totalOut = 0;
    let totalReasoning = 0;
    let sumModelSec = 0;
    const byKind: Record<
      string,
      { calls: number; inTok: number; outTok: number; sec: number }
    > = {};

    for (const r of runs) {
      if (r.kind === "question-review") qrStages++;
      if (r.kind === "workflow" || r.kind === "question-review") continue;
      modelCalls++;
      const sec = ((r.endedAt ?? r.startedAt) - r.startedAt) / 1000;
      sumModelSec += sec;
      const entry = (byKind[r.kind] ??= {
        calls: 0,
        inTok: 0,
        outTok: 0,
        sec: 0,
      });
      entry.calls++;
      entry.sec = +(entry.sec + sec).toFixed(2);
      if (r.usage) {
        try {
          const u = JSON.parse(r.usage);
          const inp = Number(u.inputTokens ?? u.input_tokens ?? 0);
          const cached = Number(
            u.cachedInputTokens ?? u.cached_input_tokens ?? 0,
          );
          const out = Number(u.outputTokens ?? u.output_tokens ?? 0);
          const reas = Number(
            u.reasoningOutputTokens ??
              u.reasoningTokens ??
              u.reasoning_tokens ??
              0,
          );
          totalIn += inp;
          totalCached += cached;
          totalOut += out;
          totalReasoning += reas;
          entry.inTok += inp;
          entry.outTok += out;
        } catch {}
      }
    }

    const reqRows = db
      .prepare("SELECT data FROM agent_events WHERE kind = 'request'")
      .all() as Array<{ data: string }>;
    const maxRequestKB = reqRows.length
      ? +(
          Math.max(...reqRows.map((r) => Buffer.byteLength(r.data, "utf8"))) /
          1024
        ).toFixed(1)
      : 0;

    const toolRows = db
      .prepare("SELECT data FROM agent_events WHERE kind = 'tool.started'")
      .all() as Array<{ data: string }>;
    const toolCalls: Record<string, number> = {};
    for (const t of toolRows) {
      try {
        const d = JSON.parse(t.data);
        const name = String(d.tool ?? "unknown");
        toolCalls[name] = (toolCalls[name] ?? 0) + 1;
      } catch {}
    }

    const auditRows = db
      .prepare("SELECT data FROM agent_events WHERE kind = 'audit.result'")
      .all() as Array<{ data: string }>;
    let auditOk = 0;
    let auditFail = 0;
    for (const a of auditRows) {
      try {
        const d = JSON.parse(a.data);
        if (d.ok) auditOk++;
        else auditFail++;
      } catch {}
    }

    return {
      modelCalls,
      qrStages,
      totalIn,
      totalCached,
      totalOut,
      totalReasoning,
      sumModelSec: +sumModelSec.toFixed(1),
      maxRequestKB,
      toolCalls,
      audit: { ok: auditOk, fail: auditFail },
      byKind,
    };
  } finally {
    db.close();
  }
}

const results: any[] = [];
let carriedReview: QuestionReview | undefined;
let carriedNotebook: NotebookCheckpoint | undefined;
const carriedEvaluations: Attempt["evaluations"] = [];
let lastIpynb: unknown;

try {
  const status = await agent().status();
  console.log(
    JSON.stringify({
      event: "runtime-status",
      signedIn: status.signedIn,
      provider: status.provider,
      targetChoice: { mode, model, effort, backend },
    }),
  );

  for (const cp of selected) {
    const attempt = structuredClone(rawCapture);
    attempt.phase = "review";
    attempt.sealed = true;
    attempt.evaluations = structuredClone(carriedEvaluations);
    attempt.reflection = {
      ...attempt.reflection,
      messages: structuredClone(originalMessages.slice(0, cp.throughIndex + 1)),
      analysis: undefined,
      questionReview: carriedReview ? structuredClone(carriedReview) : undefined,
    };

    const started = Date.now();
    const out = await reflect(
      attempt,
      { model, effort },
      "conversation",
      undefined,
      undefined,
      mode === "notebook"
        ? {
            enabled: true,
            backend,
            checkpoint: carriedNotebook,
            useCache: false,
          }
        : { enabled: false },
    );
    const elapsedMs = Date.now() - started;
    validateReflection(attempt, out.result);

    const review = out.result.evaluation.questionReview!;
    assert.ok(review, "Expected questionReview on evaluation");
    carriedReview = structuredClone(review);
    carriedNotebook =
      mode === "notebook" ? out.notebookCheckpoint : undefined;
    carriedEvaluations.push({
      ...structuredClone(out.result.evaluation),
      model: out.model,
      effort: out.effort,
      research: out.research,
      version: "retrospective",
      createdAt: Date.now(),
      evidenceThrough: attempt.lastSeq,
    });
    if (mode === "notebook" && out.notebookIpynb) {
      lastIpynb = out.notebookIpynb;
      writeFileSync(ipynbPath, JSON.stringify(lastIpynb, null, 2) + "\n");
    }

    const entry = {
      checkpoint: cp.name,
      description: cp.description,
      elapsedMs,
      model: out.model,
      effort: out.effort,
      status: out.result.status,
      askedQuestionIds: out.result.askedQuestionIds,
      surfacedQuestionIds: out.result.surfacedQuestionIds,
      coachingSelectionNote: out.result.coachingSelectionNote,
      message: out.result.message,
      focus: out.result.focus,
      checks: out.result.checks,
      totalQuestions: review.questions.length,
      notebookStats: out.notebookStats,
      notebookCellsExecutedTotal: out.notebookCheckpoint?.cells.length ?? 0,
      notebookDumpBytes: out.notebookCheckpoint?.dumpBytes ?? 0,
    };
    results.push(entry);

    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          completedAt: null,
          mode,
          backend: mode === "notebook" ? backend : null,
          model,
          effort,
          attemptId: rawCapture.id,
          eventsCount: rawCapture.events.length,
          checkpoints: results,
        },
        null,
        2,
      ) + "\n",
    );

    console.log(
      JSON.stringify({
        checkpoint: cp.name,
        elapsedMs,
        status: out.result.status,
        askedQuestionIds: out.result.askedQuestionIds,
        surfacedQuestionIds: out.result.surfacedQuestionIds,
        totalQuestions: review.questions.length,
        notebookStats: out.notebookStats,
        totalCells: out.notebookCheckpoint?.cells.length ?? 0,
      }),
    );
  }

  if (mode === "notebook" && lastIpynb) {
    writeFileSync(ipynbPath, JSON.stringify(lastIpynb, null, 2) + "\n");
  }

  const traceSummary = summarizeTraceDb(process.env.DUO_TRACE_DATABASE);

  let baselineComparison: unknown = null;
  try {
    const baseReport = JSON.parse(
      readFileSync(resolveMainLocal("stock-retrospective.json"), "utf8"),
    );
    const baseTrace = summarizeTraceDb(
      resolveMainLocal("stock-retrospective.sqlite"),
    );
    baselineComparison = {
      baselineReportFile: "stock-retrospective.json",
      baselineCheckpoints: (baseReport.checkpoints ?? []).map((c: any) => ({
        checkpoint: c.checkpoint,
        elapsedMs: c.elapsedMs,
        status: c.status,
        totalQuestions: c.bankSummary?.totalQuestions,
        askedQuestionIds: c.askedQuestionIds,
        surfacedQuestionIds: c.surfacedQuestionIds,
      })),
      baselineTraceSummary: baseTrace,
      deltas: {
        totalWallMsOption2: results.reduce((s, r) => s + r.elapsedMs, 0),
        totalWallMsBaseline: (baseReport.checkpoints ?? []).reduce(
          (s: number, c: any) => s + Number(c.elapsedMs ?? 0),
          0,
        ),
        inputTokensOption2: traceSummary.totalIn,
        inputTokensBaseline: baseTrace.totalIn,
        maxRequestKBOption2: traceSummary.maxRequestKB,
        maxRequestKBBaseline: baseTrace.maxRequestKB,
      },
    };
  } catch (e) {
    baselineComparison = {
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const report = {
    completedAt: new Date().toISOString(),
    mode,
    backend: mode === "notebook" ? backend : null,
    model,
    effort,
    attemptId: rawCapture.id,
    eventsCount: rawCapture.events.length,
    checkpoints: results,
    traceSummary,
    baselineComparison,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log("\n=== BENCHMARK COMPLETE ===");
  console.log(
    JSON.stringify(
      {
        mode,
        reportPath,
        ipynbPath: mode === "notebook" ? ipynbPath : null,
        traceSummary,
        baselineComparison,
      },
      null,
      2,
    ),
  );
} finally {
  agent().close();
}
