import { randomUUID } from "node:crypto";
import {
  CollectString,
  Monty,
  MontyCrashedError,
  MontyDisconnectError,
  MontyRuntimeError,
  MontyShutdown,
  MontySyntaxError,
  MontyTypingError,
  type MontySession,
} from "@pydantic/monty";
import { AgentEvidence } from "./agent-evidence";
import {
  pauseAt,
  pauseMetadata,
  solvingTime,
  timedEvidence,
} from "./assessment-time";
import { referenceEvidence } from "./java-help";
import { applyEdits, replay } from "./recording";
import type { Attempt } from "./types";

export type NotebookBackend = "native" | "wasm";

export type NotebookCell = {
  cellId: string;
  executionCount: number;
  stage: string;
  branchId?: string;
  purpose?: string;
  code: string;
  stdout: string;
  result?: unknown;
  resultText?: string;
  error?: { type: string; message: string };
  truncated: boolean;
  durationMs: number;
  receiptIds: string[];
  at: number;
};

export type NotebookCheckpoint = {
  version: "monty-notebook-1";
  backend: NotebookBackend;
  attemptId: string;
  recordingHash: string;
  executionCount: number;
  cells: NotebookCell[];
  sessionDump?: Buffer;
  dumpBytes: number;
  updatedAt: number;
};

export type NotebookStats = {
  cellsRun: number;
  cellErrors: number;
  helperCalls: Record<string, number>;
  dumpBytes: number;
  forkCount: number;
  restoredFromCheckpoint: boolean;
  restoreMs?: number;
};

export type CellExecutionResult = {
  ok: boolean;
  cellId: string;
  executionCount: number;
  stdout: string;
  result?: unknown;
  resultText?: string;
  error?: { type: string; message: string };
  recovered?: boolean;
  truncated: boolean;
  durationMs: number;
  receiptIds: string[];
};

const NOTEBOOK_LIMITS = {
  maxMemory: 64 * 1024 * 1024,
  maxFeedDurationSecs: 5,
  maxTurnDurationSecs: 2,
  maxRecursionDepth: 200,
  maxSuspensions: 100,
} as const;

const MAX_STDOUT_CHARS = 14000;
const MAX_RESULT_CHARS = 6000;
const MAX_DIFF_CHARS = 12000;

function resolvePythonArgs(
  rawArgs: unknown[],
  paramNames: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let positionalCount = rawArgs.length;
  const last = rawArgs.at(-1);
  // Monty passes Python keyword arguments as a trailing null-prototype object
  // (Python dicts arrive as JS Maps, so null-prototype plain objects are kwargs).
  if (
    last &&
    typeof last === "object" &&
    !Array.isArray(last) &&
    !(last instanceof Map) &&
    !(last instanceof Set) &&
    Object.getPrototypeOf(last) === null
  ) {
    positionalCount--;
    for (const [k, v] of Object.entries(last)) {
      out[k] = v;
    }
  }
  for (let i = 0; i < positionalCount && i < paramNames.length; i++) {
    out[paramNames[i]!] = rawArgs[i];
  }
  return out;
}

const MAX_CACHED_CHECKPOINTS = 32;

type PoolLike = Awaited<ReturnType<typeof Monty.create>>;

const poolState = globalThis as typeof globalThis & {
  duoNotebookPools?: Partial<Record<NotebookBackend, Promise<PoolLike>>>;
  duoNotebookCheckpoints?: Map<string, NotebookCheckpoint>;
};

export function reflectionNotebookEnabled(override?: boolean): boolean {
  return override ?? process.env.DUO_REFLECTION_NOTEBOOK !== "0";
}

function checkpointCacheKey(attemptId: string, recordingHash: string): string {
  return `${attemptId}:${recordingHash}`;
}

export function getCachedNotebookCheckpoint(
  attemptId: string,
  recordingHash: string,
): NotebookCheckpoint | undefined {
  const cache = poolState.duoNotebookCheckpoints;
  if (!cache) return undefined;
  const key = checkpointCacheKey(attemptId, recordingHash);
  const hit = cache.get(key);
  if (!hit) return undefined;
  // Refresh LRU order on read.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function cacheNotebookCheckpoint(cp: NotebookCheckpoint): void {
  const cache = (poolState.duoNotebookCheckpoints ??= new Map());
  const key = checkpointCacheKey(cp.attemptId, cp.recordingHash);
  cache.delete(key);
  cache.set(key, cp);
  while (cache.size > MAX_CACHED_CHECKPOINTS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearNotebookCheckpointCache(): void {
  poolState.duoNotebookCheckpoints?.clear();
}

async function getPool(backend: NotebookBackend): Promise<PoolLike> {
  const pools = (poolState.duoNotebookPools ??= {});
  if (!pools[backend]) {
    pools[backend] = (async () => {
      if (backend === "wasm") {
        const wasmMod = await import("@pydantic/monty/wasm");
        return (await wasmMod.Monty.create({
          minProcesses: 1,
          maxProcesses: 4,
          requestTimeout: 10,
        })) as unknown as PoolLike;
      }
      return await Monty.create({
        minProcesses: 1,
        maxProcesses: 4,
        requestTimeout: 10,
      });
    })().catch((err) => {
      delete pools[backend];
      throw err;
    });
  }
  return pools[backend]!;
}

export async function closeNotebookPools(): Promise<void> {
  const pools = poolState.duoNotebookPools;
  if (!pools) return;
  const entries = Object.entries(pools) as Array<
    [NotebookBackend, Promise<PoolLike> | undefined]
  >;
  for (const [key] of entries) delete pools[key];
  await Promise.all(
    entries.map(async ([, p]) => {
      if (!p) return;
      try {
        const pool = await p;
        await pool.close();
      } catch {}
    }),
  );
}

function truncateText(text: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text:
      text.slice(0, maxChars) +
      `\n... [truncated ${text.length - maxChars} chars; slice or filter in Python]`,
    truncated: true,
  };
}

function normalizeMontyValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      out[String(k)] = normalizeMontyValue(v, seen);
    }
    return out;
  }
  if (value instanceof Set) {
    return [...value].map((v) => normalizeMontyValue(v, seen));
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeMontyValue(v, seen));
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `<bytes:${value.length}>`;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = normalizeMontyValue(v, seen);
  }
  return out;
}

function formatResultValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(normalizeMontyValue(value), null, 2);
  } catch {
    return String(value);
  }
}

/** Pure TypeScript unified diff so the notebook exposes `diff()` without `difflib`. */
export function unifiedDiff(
  before: string,
  after: string,
  fromLabel = "before",
  toLabel = "after",
  contextLines = 3,
): string {
  if (before === after) return "";
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const ctx = Math.max(0, Math.min(10, Math.floor(contextLines)));

  type Op = { type: " " | "-" | "+"; line: string; aIdx: number; bIdx: number };
  const ops: Op[] = [];

  // Trim identical prefix/suffix before running LCS DP.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    ops.push({ type: " ", line: a[prefix]!, aIdx: prefix, bIdx: prefix });
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const m = aMid.length;
  const n = bMid.length;

  if (m === 0 && n === 0) return "";

  if (m * n <= 250_000) {
    const dp = new Int32Array((m + 1) * (n + 1));
    const width = n + 1;
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (aMid[i] === bMid[j]) {
          dp[i * width + j] = dp[(i + 1) * width + (j + 1)]! + 1;
        } else {
          const down = dp[(i + 1) * width + j]!;
          const right = dp[i * width + (j + 1)]!;
          dp[i * width + j] = down >= right ? down : right;
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (aMid[i] === bMid[j]) {
        ops.push({
          type: " ",
          line: aMid[i]!,
          aIdx: prefix + i,
          bIdx: prefix + j,
        });
        i++;
        j++;
      } else if (dp[(i + 1) * width + j]! >= dp[i * width + (j + 1)]!) {
        ops.push({
          type: "-",
          line: aMid[i]!,
          aIdx: prefix + i,
          bIdx: prefix + j,
        });
        i++;
      } else {
        ops.push({
          type: "+",
          line: bMid[j]!,
          aIdx: prefix + i,
          bIdx: prefix + j,
        });
        j++;
      }
    }
    while (i < m) {
      ops.push({
        type: "-",
        line: aMid[i]!,
        aIdx: prefix + i,
        bIdx: prefix + j,
      });
      i++;
    }
    while (j < n) {
      ops.push({
        type: "+",
        line: bMid[j]!,
        aIdx: prefix + i,
        bIdx: prefix + j,
      });
      j++;
    }
  } else {
    for (let i = 0; i < m; i++) {
      ops.push({
        type: "-",
        line: aMid[i]!,
        aIdx: prefix + i,
        bIdx: prefix,
      });
    }
    for (let j = 0; j < n; j++) {
      ops.push({
        type: "+",
        line: bMid[j]!,
        aIdx: prefix + m,
        bIdx: prefix + j,
      });
    }
  }

  for (let s = 0; s < suffix; s++) {
    const aIdx = a.length - suffix + s;
    const bIdx = b.length - suffix + s;
    ops.push({ type: " ", line: a[aIdx]!, aIdx, bIdx });
  }

  // Collect hunk ranges around non-context ops.
  const changeIndices: number[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx]!.type !== " ") changeIndices.push(idx);
  }
  if (!changeIndices.length) return "";

  const hunks: Array<{ start: number; end: number }> = [];
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - ctx);
    const end = Math.min(ops.length - 1, idx + ctx);
    const last = hunks.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      hunks.push({ start, end });
    }
  }

  const lines: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const h of hunks) {
    const slice = ops.slice(h.start, h.end + 1);
    const aStart = slice[0]!.aIdx + 1;
    const bStart = slice[0]!.bIdx + 1;
    const aCount = slice.filter((o) => o.type !== "+").length;
    const bCount = slice.filter((o) => o.type !== "-").length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const o of slice) {
      lines.push(`${o.type}${o.line}`);
    }
  }
  return lines.join("\n");
}

type IndexedEditEntry = {
  seq: number;
  elapsedMs: number;
  duringPause: boolean;
  origin?: string;
  removed: number;
  inserted: number;
  insertedText: string;
  removedText: string;
};

function buildEditIndex(attempt: Attempt): IndexedEditEntry[] {
  const entries: IndexedEditEntry[] = [];
  let source = attempt.initialSource;
  const sorted = [...attempt.events].sort((x, y) => x.seq - y.seq);
  for (const e of sorted) {
    if (e.type !== "edit" || !e.edits?.length) continue;
    const removedParts: string[] = [];
    const insertedParts: string[] = [];
    let removed = 0;
    let inserted = 0;
    for (const edit of e.edits) {
      removed += edit.length;
      inserted += edit.text.length;
      if (edit.length > 0) {
        removedParts.push(source.slice(edit.offset, edit.offset + edit.length));
      }
      if (edit.text.length > 0) {
        insertedParts.push(edit.text);
      }
    }
    source = applyEdits(source, e.edits);
    entries.push({
      seq: e.seq,
      elapsedMs: solvingTime(attempt, e.at),
      duringPause: Boolean(pauseAt(attempt, e.at)),
      origin: e.origin,
      removed,
      inserted,
      insertedText: insertedParts.join("\n"),
      removedText: removedParts.join("\n"),
    });
  }
  return entries;
}

function buildCompactEvents(attempt: Attempt) {
  return timedEvidence(attempt).map(({ edits, ...e }) => ({
    ...e,
    removed: edits?.reduce((s, c) => s + c.length, 0),
    inserted: edits?.reduce((s, c) => s + c.text.length, 0),
  }));
}

function buildCompactAssistance(attempt: Attempt) {
  return referenceEvidence(attempt).map(({ research: _research, ...rest }) => ({
    ...rest,
  }));
}

export function compactNotebookContext(
  attempt: Attempt,
  notebook?: Pick<ReflectionNotebook, "cells" | "stats">,
) {
  const timed = timedEvidence(attempt);
  const atBySeq = new Map(attempt.events.map((ev) => [ev.seq, ev.at]));
  let editCount = 0;
  const runsAndSubmits: Array<{
    seq: number;
    elapsedMs: number;
    type: string;
    jobId?: string;
    verdict?: string;
  }> = [];
  const editChanges: Array<{
    seq: number;
    elapsedMs: number;
    duringPause: boolean;
    origin?: string;
    removed: number;
    inserted: number;
  }> = [];

  for (const e of timed) {
    if (e.type === "edit") {
      editCount++;
      const removed = e.edits?.reduce((s, c) => s + c.length, 0) ?? 0;
      const inserted = e.edits?.reduce((s, c) => s + c.text.length, 0) ?? 0;
      if (removed >= 40 || inserted >= 60) {
        const rawAt = atBySeq.get(e.seq);
        editChanges.push({
          seq: e.seq,
          elapsedMs: e.elapsedMs,
          duringPause: Boolean(rawAt !== undefined && pauseAt(attempt, rawAt)),
          origin: e.origin,
          removed,
          inserted,
        });
      }
    } else if (e.type === "run" || e.type === "submit") {
      const job = attempt.jobs.find((j) => j.id === e.jobId);
      runsAndSubmits.push({
        seq: e.seq,
        elapsedMs: e.elapsedMs,
        type: e.type,
        jobId: e.jobId,
        verdict: job?.summary?.verdict ?? job?.state,
      });
    }
  }

  editChanges.sort((a, b) => b.removed + b.inserted - (a.removed + a.inserted));
  const largeDeletions = editChanges
    .slice(0, 15)
    .sort((a, b) => a.seq - b.seq);

  const assistanceMarkers = timed
    .filter((e) => e.type === "assistance")
    .map((e) => ({
      seq: e.seq,
      elapsedMs: e.elapsedMs,
      assistanceId: e.assistanceId,
      stage: e.assistanceStage,
    }));

  const activeSolvingMs = attempt.endedAt
    ? solvingTime(attempt, attempt.endedAt)
    : timed.at(-1)?.elapsedMs ?? 0;

  const assistanceIndex = referenceEvidence(attempt).map(
    ({ research: _research, answer, ...rest }) => ({
      ...rest,
      answerPreview: answer ? answer.slice(0, 180) : undefined,
      hasFullAnswer: Boolean(answer),
    }),
  );

  const solvingChunksSummary = (attempt.solvingChunks ?? []).map(
    ({ id, startSeq, endSeq, signal, summary, observations, candidateQuestions }) => ({
      id,
      startSeq,
      endSeq,
      signal,
      summary,
      observations,
      candidateQuestions,
    }),
  );

  const cells = notebook?.cells ?? [];
  const notebookState = {
    tool: "run_notebook",
    cellsExecuted: cells.length,
    priorCells: cells.slice(-10).map((c) => ({
      executionCount: c.executionCount,
      stage: c.stage,
      ...(c.branchId ? { branchId: c.branchId } : {}),
      ...(c.purpose ? { purpose: c.purpose } : {}),
      ...(c.error
        ? { error: c.error }
        : {
            stdoutPreview: c.stdout ? c.stdout.slice(0, 240) : "",
            resultPreview: c.resultText ? c.resultText.slice(0, 160) : "",
          }),
    })),
  };

  return {
    recordingSummary: {
      totalEvents: attempt.events.length,
      lastSeq: attempt.lastSeq,
      activeSolvingMs,
      editCount,
      pauseCount: attempt.pauses.length,
      runsAndSubmits,
      largeDeletions,
      checkpointSequences: attempt.checkpoints.map((c) => c.seq),
      assistanceMarkers,
    },
    assistanceIndex,
    solvingChunksSummary,
    notebookState,
  };
}

export const notebookToolDefinition = {
  type: "function" as const,
  name: "run_notebook",
  description:
    "Execute Python in a persistent, stateful sandboxed notebook pre-loaded with this attempt's full recording, edit search, replay, unified diff, and assistance helpers. Variables and helper functions persist across cells and stages. Use 1–2 concise cells instead of poking sequences one at a time.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "Python snippet to execute in the persistent Monty sandbox. Available modules: json, re, math. Pre-bound data variables: events, jobs, pauses, annotations, assistance, solving_chunks, conversation, intake, problem, initial_source, final_source, last_seq, cell_outputs. Pre-bound helper functions: search_edits(pattern, limit=20), replay(seq), diff(from_seq, to_seq, context_lines=3), code_lines(seq, start_line=1, end_line=200), read_evidence(seq), read_assistance(id).",
      },
      purpose: {
        type: "string",
        description: "Short note describing what this cell investigates.",
      },
    },
    required: ["code"],
    additionalProperties: false,
  },
};

export const notebookPolicy = `NOTEBOOK EXPLORATION MODE:
Instead of receiving all raw events and doc excerpts inline, you have a persistent stateful Python sandbox via \`run_notebook\`.
Pre-bound read-only variables (loaded lazily when referenced):
- \`events\`: list of all compact timed event dicts ({seq, type, elapsedMs, duringPause?, removed?, inserted?, origin?, jobId?, assistanceId?, assistanceStage?})
- \`jobs\`, \`pauses\`, \`annotations\`, \`assistance\`, \`solving_chunks\`, \`conversation\`, \`intake\`, \`problem\`, \`initial_source\`, \`final_source\`, \`last_seq\`, \`cell_outputs\`
Pre-bound helper functions (every call records an authoritative receipt shared with verification):
- \`search_edits(pattern, limit=20)\`: search actual inserted and deleted code text across the full recording (case-insensitive substring or regex) -> returns [{seq, elapsedMs, duringPause, origin, removed, inserted, matchedInserted, matchedRemoved}]
- \`replay(seq)\`: exact source string at event \`seq\` (0 = initial, \`last_seq\` = final)
- \`diff(from_seq, to_seq, context_lines=3)\`: unified diff string between two sequence numbers
- \`code_lines(seq, start_line=1, end_line=200)\`: 1-based line-numbered source slice at \`seq\`
- \`read_evidence(seq)\`: full event + pause + before/after snapshot + annotation + assistance receipt at \`seq\` (use sparingly when full before/after context is needed)
- \`read_assistance(id)\`: full Java help question, delivered answer, sources, and research excerpts for \`id\`

Sandbox rules & efficiency:
- Supported stdlib: \`json\`, \`re\`, \`math\` (no filesystem, network, subprocesses, or \`difflib\` — use \`diff()\` instead).
- Prefer 1–2 targeted Python cells that filter \`events\`, call \`search_edits()\` / \`diff()\` / \`replay()\`, store useful findings in Python variables, and \`print()\` only the concise summary you need.`;

export class ReflectionNotebook {
  readonly backend: NotebookBackend;
  readonly attempt: Attempt;
  readonly recordingHash: string;
  private pool: PoolLike;
  private session: MontySession;
  private lastGoodDump: Buffer | undefined;
  private cachedEvents?: ReturnType<typeof buildCompactEvents>;
  private cachedAssistance?: ReturnType<typeof buildCompactAssistance>;
  private cachedEditIndex?: IndexedEditEntry[];
  private cachedPauses?: ReturnType<typeof pauseMetadata>;
  private cachedConversation?: Array<{
    id: string;
    role: string;
    kind?: string;
    text: string;
    createdAt: number;
  }>;
  private sharedEvidence?: AgentEvidence;
  private closed = false;

  readonly cells: NotebookCell[];
  private branchCells: NotebookCell[] = [];
  private executionCount: number;
  readonly stats: NotebookStats;

  private constructor(args: {
    backend: NotebookBackend;
    attempt: Attempt;
    recordingHash: string;
    pool: PoolLike;
    session: MontySession;
    lastGoodDump?: Buffer;
    cells: NotebookCell[];
    executionCount: number;
    stats: NotebookStats;
    evidence?: AgentEvidence;
    sharedEvents?: ReturnType<typeof buildCompactEvents>;
    sharedAssistance?: ReturnType<typeof buildCompactAssistance>;
    sharedEditIndex?: IndexedEditEntry[];
    sharedPauses?: ReturnType<typeof pauseMetadata>;
  }) {
    this.backend = args.backend;
    this.attempt = args.attempt;
    this.recordingHash = args.recordingHash;
    this.pool = args.pool;
    this.session = args.session;
    this.lastGoodDump = args.lastGoodDump;
    this.cells = args.cells;
    this.executionCount = args.executionCount;
    this.stats = args.stats;
    this.sharedEvidence = args.evidence;
    this.cachedEvents = args.sharedEvents;
    this.cachedAssistance = args.sharedAssistance;
    this.cachedEditIndex = args.sharedEditIndex;
    this.cachedPauses = args.sharedPauses;
  }

  static async create(
    attempt: Attempt,
    options?: {
      recordingHash?: string;
      backend?: NotebookBackend;
      checkpoint?: NotebookCheckpoint;
      evidence?: AgentEvidence;
    },
  ): Promise<ReflectionNotebook> {
    const backend: NotebookBackend = options?.backend ?? "native";
    const recordingHash = options?.recordingHash ?? "";
    const pool = await getPool(backend);
    const session = await pool.checkout({ limits: { ...NOTEBOOK_LIMITS } });

    const cp = options?.checkpoint;
    const canRestore =
      Boolean(cp?.sessionDump) &&
      cp!.backend === backend &&
      (!recordingHash || cp!.recordingHash === recordingHash) &&
      cp!.attemptId === attempt.id;

    let restoredFromCheckpoint = false;
    let restoreMs: number | undefined;
    let cells: NotebookCell[] = [];
    let executionCount = 0;
    let lastGoodDump: Buffer | undefined;

    if (canRestore && cp?.sessionDump) {
      const t0 = Date.now();
      await session.loadSession(cp.sessionDump);
      restoreMs = Date.now() - t0;
      restoredFromCheckpoint = true;
      cells = structuredClone(cp.cells);
      executionCount = cp.executionCount;
      lastGoodDump = Buffer.from(cp.sessionDump);
    } else {
      lastGoodDump = await session.dump();
    }

    return new ReflectionNotebook({
      backend,
      attempt,
      recordingHash,
      pool,
      session,
      lastGoodDump,
      cells,
      executionCount,
      evidence: options?.evidence,
      stats: {
        cellsRun: 0,
        cellErrors: 0,
        helperCalls: {},
        dumpBytes: lastGoodDump?.length ?? 0,
        forkCount: 0,
        restoredFromCheckpoint,
        ...(restoreMs !== undefined ? { restoreMs } : {}),
      },
    });
  }

  setEvidence(evidence: AgentEvidence) {
    this.sharedEvidence = evidence;
  }

  private getEvents() {
    return (this.cachedEvents ??= buildCompactEvents(this.attempt));
  }

  private getAssistance() {
    return (this.cachedAssistance ??= buildCompactAssistance(this.attempt));
  }

  private getEditIndex() {
    return (this.cachedEditIndex ??= buildEditIndex(this.attempt));
  }

  private getPauses() {
    return (this.cachedPauses ??= pauseMetadata(this.attempt));
  }

  private getConversation() {
    return (this.cachedConversation ??= (
      this.attempt.reflection?.messages ?? []
    ).map((m) => ({
      id: m.id,
      role: m.role,
      ...(m.kind ? { kind: m.kind } : {}),
      text: m.text,
      createdAt: m.createdAt,
    })));
  }

  private assertValidSeq(seq: unknown): number {
    const n = Number(seq);
    if (!Number.isInteger(n) || n < 0 || n > this.attempt.lastSeq) {
      throw new Error(
        `Invalid sequence ${String(seq)}; valid range is 0..${this.attempt.lastSeq}.`,
      );
    }
    return n;
  }

  private buildExternalLookup(
    evidence: AgentEvidence,
    receiptIds: string[],
  ): Record<string, unknown> {
    const recordHelper = (
      name: string,
      args: unknown,
      data: unknown,
    ): string => {
      this.stats.helperCalls[name] = (this.stats.helperCalls[name] ?? 0) + 1;
      const id = evidence.capture(name, args, data);
      receiptIds.push(id);
      return id;
    };

    const self = this;
    return {
      problem: {
        title: this.attempt.problem.title,
        titleSlug: this.attempt.problem.titleSlug,
        difficulty: this.attempt.problem.difficulty,
        content: this.attempt.problem.content,
      },
      initial_source: this.attempt.initialSource,
      final_source: this.attempt.source,
      last_seq: this.attempt.lastSeq,
      events: this.getEvents(),
      jobs: this.attempt.jobs,
      pauses: this.getPauses(),
      annotations: this.attempt.annotations,
      assistance: this.getAssistance(),
      solving_chunks: this.attempt.solvingChunks ?? [],
      conversation: this.getConversation(),
      intake: this.attempt.reflection?.intake ?? null,
      cell_outputs: this.cells.map((c) => ({
        executionCount: c.executionCount,
        stage: c.stage,
        ...(c.branchId ? { branchId: c.branchId } : {}),
        ...(c.purpose ? { purpose: c.purpose } : {}),
        stdout: c.stdout,
        resultText: c.resultText,
        ...(c.error ? { error: c.error } : {}),
      })),

      replay(...rawArgs: unknown[]) {
        const { seq } = resolvePythonArgs(rawArgs, ["seq"]);
        const s = self.assertValidSeq(seq);
        const source = replay(self.attempt, s);
        recordHelper("replay", { seq: s }, { seq: s, source });
        return source;
      },

      diff(...rawArgs: unknown[]) {
        const {
          from_seq,
          to_seq,
          context_lines = 3,
        } = resolvePythonArgs(rawArgs, ["from_seq", "to_seq", "context_lines"]);
        const fromSeq = self.assertValidSeq(from_seq);
        const toSeq = self.assertValidSeq(to_seq);
        const ctx = Number(context_lines ?? 3);
        const before = replay(self.attempt, fromSeq);
        const after = replay(self.attempt, toSeq);
        const rawDiff =
          unifiedDiff(
            before,
            after,
            `seq-${fromSeq}`,
            `seq-${toSeq}`,
            ctx,
          ) || "(no differences)";
        const capped = truncateText(rawDiff, MAX_DIFF_CHARS);
        recordHelper(
          "diff",
          { from_seq: fromSeq, to_seq: toSeq, context_lines: ctx },
          {
            from_seq: fromSeq,
            to_seq: toSeq,
            diff: capped.text,
            truncated: capped.truncated,
          },
        );
        return capped.text;
      },

      code_lines(...rawArgs: unknown[]) {
        const {
          seq,
          start_line = 1,
          end_line = 200,
        } = resolvePythonArgs(rawArgs, ["seq", "start_line", "end_line"]);
        const s = self.assertValidSeq(seq);
        const start = Math.max(1, Math.floor(Number(start_line) || 1));
        const end = Math.max(start, Math.floor(Number(end_line) || start + 199));
        const allLines = replay(self.attempt, s).split(/\r?\n/);
        const sliced = allLines
          .slice(start - 1, end)
          .map((line, i) => `${String(start + i).padStart(4, " ")}: ${line}`)
          .join("\n");
        const capped = truncateText(sliced, MAX_DIFF_CHARS);
        recordHelper(
          "code_lines",
          { seq: s, start_line: start, end_line: end },
          {
            seq: s,
            start_line: start,
            end_line: Math.min(end, allLines.length),
            totalLines: allLines.length,
            snippet: capped.text,
          },
        );
        return capped.text;
      },

      read_evidence(...rawArgs: unknown[]) {
        const { seq } = resolvePythonArgs(rawArgs, ["seq"]);
        self.stats.helperCalls["read_evidence"] =
          (self.stats.helperCalls["read_evidence"] ?? 0) + 1;
        const result = evidence.read(Number(seq));
        receiptIds.push(result.receiptId);
        return result;
      },

      search_edits(...rawArgs: unknown[]) {
        const { pattern, limit = 20 } = resolvePythonArgs(rawArgs, [
          "pattern",
          "limit",
        ]);
        const pat = String(pattern ?? "");
        const maxResults = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
        if (!pat) throw new Error("search_edits requires a non-empty pattern.");
        let matcher: (text: string) => boolean;
        try {
          const rx = new RegExp(pat, "i");
          matcher = (text: string) => rx.test(text);
        } catch {
          const lower = pat.toLowerCase();
          matcher = (text: string) => text.toLowerCase().includes(lower);
        }
        const matches: Array<{
          seq: number;
          elapsedMs: number;
          duringPause: boolean;
          origin?: string;
          removed: number;
          inserted: number;
          matchedInserted: string;
          matchedRemoved: string;
        }> = [];
        for (const item of self.getEditIndex()) {
          const insHit = item.insertedText ? matcher(item.insertedText) : false;
          const remHit = item.removedText ? matcher(item.removedText) : false;
          if (!insHit && !remHit) continue;
          matches.push({
            seq: item.seq,
            elapsedMs: item.elapsedMs,
            duringPause: item.duringPause,
            origin: item.origin,
            removed: item.removed,
            inserted: item.inserted,
            matchedInserted: insHit ? item.insertedText.slice(0, 300) : "",
            matchedRemoved: remHit ? item.removedText.slice(0, 300) : "",
          });
          if (matches.length >= maxResults) break;
        }
        recordHelper(
          "search_edits",
          { pattern: pat, limit: maxResults },
          { pattern: pat, matchCount: matches.length, matches },
        );
        return matches;
      },

      read_assistance(...rawArgs: unknown[]) {
        const { id } = resolvePythonArgs(rawArgs, ["id"]);
        const targetId = String(id ?? "");
        const found = referenceEvidence(self.attempt).find(
          (h) => h.id === targetId,
        );
        if (!found) {
          throw new Error(`No assistance entry found with id "${targetId}".`);
        }
        const { research: _research, ...compact } = found;
        recordHelper("read_assistance", { id: targetId }, compact);
        return compact;
      },
    };
  }

  private async recoverWorkerFromDump(): Promise<void> {
    try {
      await this.session.close();
    } catch {}
    const fresh = await this.pool.checkout({ limits: { ...NOTEBOOK_LIMITS } });
    if (this.lastGoodDump) {
      await fresh.loadSession(this.lastGoodDump);
    }
    this.session = fresh;
  }

  async executeCell(
    code: string,
    opts: {
      stage: string;
      branchId?: string;
      purpose?: string;
      evidence?: AgentEvidence;
    },
  ): Promise<CellExecutionResult> {
    if (this.closed) {
      throw new Error("ReflectionNotebook session is already closed.");
    }
    const evidence =
      opts.evidence ?? this.sharedEvidence ?? new AgentEvidence(this.attempt);
    const cellId = randomUUID();
    const executionCount = ++this.executionCount;
    const receiptIds: string[] = [];
    const collector = new CollectString(512 * 1024);
    const externalLookup = this.buildExternalLookup(evidence, receiptIds);
    const startedAt = Date.now();

    let rawResult: unknown;
    let error: { type: string; message: string } | undefined;
    let recovered = false;

    try {
      rawResult = normalizeMontyValue(
        await this.session.feedRun(code, {
          externalLookup,
          printCallback: collector,
        }),
      );
      // Update snapshot checkpoint on every clean cell so rollback is exact.
      const dump = await this.session.dump();
      this.lastGoodDump = dump;
      this.stats.dumpBytes = dump.length;
    } catch (err) {
      this.stats.cellErrors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isLimitErr =
        err instanceof MontyCrashedError ||
        err instanceof MontyDisconnectError ||
        err instanceof MontyShutdown ||
        /TimeoutError|MemoryError|timed out|timeout|memory limit/i.test(errMsg);
      if (isLimitErr) {
        error = {
          type: "TimeoutOrMemoryLimit",
          message: errMsg || "Notebook cell exceeded time or memory limits.",
        };
        try {
          await this.recoverWorkerFromDump();
          recovered = true;
        } catch {}
      } else if (
        err instanceof MontySyntaxError ||
        err instanceof MontyRuntimeError ||
        err instanceof MontyTypingError
      ) {
        error = {
          type: err.constructor.name,
          message: err.message,
        };
      } else {
        error = {
          type: err instanceof Error ? err.constructor.name : "NotebookError",
          message: errMsg,
        };
      }
    }

    const durationMs = Date.now() - startedAt;
    const stdoutInfo = truncateText(collector.output, MAX_STDOUT_CHARS);
    const rawResultText = formatResultValue(rawResult);
    const resultInfo = rawResultText
      ? truncateText(rawResultText, MAX_RESULT_CHARS)
      : { text: undefined, truncated: false };
    const truncated = stdoutInfo.truncated || resultInfo.truncated;

    const cell: NotebookCell = {
      cellId,
      executionCount,
      stage: opts.stage,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.purpose ? { purpose: opts.purpose } : {}),
      code,
      stdout: stdoutInfo.text,
      ...(rawResult !== undefined && !resultInfo.truncated
        ? { result: rawResult }
        : {}),
      ...(resultInfo.text !== undefined ? { resultText: resultInfo.text } : {}),
      ...(error ? { error } : {}),
      truncated,
      durationMs,
      receiptIds,
      at: Date.now(),
    };

    this.cells.push(cell);
    this.branchCells.push(cell);
    this.stats.cellsRun++;

    const cellReceiptId = evidence.capture(
      "run_notebook",
      {
        executionCount,
        stage: opts.stage,
        ...(opts.purpose ? { purpose: opts.purpose } : {}),
        code,
      },
      {
        ok: !error,
        stdoutPreview: stdoutInfo.text.slice(0, 2000),
        ...(resultInfo.text !== undefined
          ? { resultPreview: resultInfo.text.slice(0, 2000) }
          : {}),
        ...(error ? { error } : {}),
        helperReceiptIds: receiptIds,
      },
    );

    return {
      ok: !error,
      cellId,
      executionCount,
      stdout: stdoutInfo.text,
      ...(rawResult !== undefined && !resultInfo.truncated
        ? { result: rawResult }
        : {}),
      ...(resultInfo.text !== undefined ? { resultText: resultInfo.text } : {}),
      ...(error ? { error } : {}),
      ...(recovered ? { recovered: true } : {}),
      truncated,
      durationMs,
      receiptIds: [cellReceiptId, ...receiptIds],
    };
  }

  async dumpState(): Promise<Buffer> {
    if (this.closed) {
      if (this.lastGoodDump) return Buffer.from(this.lastGoodDump);
      throw new Error("ReflectionNotebook session is closed.");
    }
    const dump = await this.session.dump();
    this.lastGoodDump = dump;
    this.stats.dumpBytes = dump.length;
    return dump;
  }

  async checkpoint(): Promise<NotebookCheckpoint> {
    const dump = await this.dumpState();
    return {
      version: "monty-notebook-1",
      backend: this.backend,
      attemptId: this.attempt.id,
      recordingHash: this.recordingHash,
      executionCount: this.executionCount,
      cells: structuredClone(this.cells),
      sessionDump: dump,
      dumpBytes: dump.length,
      updatedAt: Date.now(),
    };
  }

  async fork(
    stage: string,
    branchId: string,
    evidence?: AgentEvidence,
  ): Promise<ReflectionNotebook> {
    const dump = await this.dumpState();
    const session = await this.pool.checkout({
      limits: { ...NOTEBOOK_LIMITS },
    });
    await session.loadSession(dump);
    this.stats.forkCount++;
    return new ReflectionNotebook({
      backend: this.backend,
      attempt: this.attempt,
      recordingHash: this.recordingHash,
      pool: this.pool,
      session,
      lastGoodDump: Buffer.from(dump),
      cells: structuredClone(this.cells),
      executionCount: this.executionCount,
      evidence: evidence ?? this.sharedEvidence,
      sharedEvents: this.getEvents(),
      sharedAssistance: this.getAssistance(),
      sharedEditIndex: this.getEditIndex(),
      sharedPauses: this.getPauses(),
      stats: {
        cellsRun: 0,
        cellErrors: 0,
        helperCalls: {},
        dumpBytes: dump.length,
        forkCount: 0,
        restoredFromCheckpoint: true,
      },
    });
  }

  mergeBranch(child: ReflectionNotebook): void {
    const ordered = [...child.branchCells].sort((a, b) => a.at - b.at);
    for (const c of ordered) {
      const merged: NotebookCell = {
        ...structuredClone(c),
        executionCount: ++this.executionCount,
      };
      this.cells.push(merged);
      this.branchCells.push(merged);
    }
    this.stats.cellsRun += child.stats.cellsRun;
    this.stats.cellErrors += child.stats.cellErrors;
    for (const [k, v] of Object.entries(child.stats.helperCalls)) {
      this.stats.helperCalls[k] = (this.stats.helperCalls[k] ?? 0) + v;
    }
  }

  toIpynb() {
    const cells: Array<Record<string, unknown>> = [];
    for (const c of this.cells) {
      const header = [
        `### Cell ${c.executionCount} — \`${c.stage}\`${c.branchId ? ` (${c.branchId})` : ""}`,
        c.purpose ? `\n${c.purpose}` : "",
        `\n*Duration: ${c.durationMs}ms · Receipts: ${c.receiptIds.length}*`,
      ].join("");
      cells.push({
        cell_type: "markdown",
        id: `${c.cellId}-md`,
        metadata: {},
        source: header.split("\n").map((l, i, arr) =>
          i < arr.length - 1 ? `${l}\n` : l,
        ),
      });

      const outputs: Array<Record<string, unknown>> = [];
      if (c.stdout) {
        outputs.push({
          output_type: "stream",
          name: "stdout",
          text: c.stdout.split(/(?<=\n)/),
        });
      }
      if (c.resultText !== undefined) {
        outputs.push({
          output_type: "execute_result",
          execution_count: c.executionCount,
          metadata: {},
          data: {
            "text/plain": c.resultText.split(/(?<=\n)/),
          },
        });
      }
      if (c.error) {
        outputs.push({
          output_type: "error",
          ename: c.error.type,
          evalue: c.error.message,
          traceback: [`${c.error.type}: ${c.error.message}`],
        });
      }

      cells.push({
        cell_type: "code",
        id: c.cellId,
        execution_count: c.executionCount,
        metadata: {
          stage: c.stage,
          ...(c.branchId ? { branchId: c.branchId } : {}),
          durationMs: c.durationMs,
          receiptIds: c.receiptIds,
        },
        source: c.code.split(/(?<=\n)/),
        outputs,
      });
    }

    return {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          display_name: "DuoLeetCode Monty Python",
          language: "python",
          name: "monty-python",
        },
        language_info: {
          name: "python",
          version: "3.12",
        },
        duoleetcode: {
          attemptId: this.attempt.id,
          backend: this.backend,
          recordingHash: this.recordingHash,
          cellsRun: this.stats.cellsRun,
        },
      },
      cells,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.session.close();
    } catch {}
  }
}
