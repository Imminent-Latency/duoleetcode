import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { practiceHome, sandboxMode } from "./practice-storage.mjs";
import type {
  TraceRun,
  TraceStatus,
  TraceDetail,
  UsageSummary,
  UsageTotals,
  UsageBucket,
  UsageWindowKey,
} from "./agent-trace-types";

const featureLabels: Record<string, string> = {
  "background-solving": "Background analysis while solving",
  "pre-intake": "Prepare review during intake",
  reflection: "Reflection chat",
  "java-help": "Java help",
  coaching: "Focused coaching",
  evaluation: "Assessment feedback",
  planning: "Next-problem planner",
  other: "Connection & checks",
};
const stageLabels: Record<string, string> = {
  "chunk-analysis": "Solving chunk analyzer",
  "question-generation": "Question planner",
  "question-analysis": "Evidence analyst",
  "question-judgment": "Evidence & coverage judge",
  "coach-reply": "Coach reply",
  "java-help-reply": "Java reference answer",
  "evaluation-reply": "Assessment debrief",
  "planner-selection": "Problem selector",
  audit: "Verification audit",
  "doc-search": "Documentation search",
  "other-model": "Other model call",
};
const containerKinds = new Set(["workflow", "question-review"]);
function classifyUsage(
  role: string,
  kind: string,
  rootRole: string,
  rootKind: string,
) {
  let feature = "other";
  if (
    rootRole === "solving analysis" ||
    role === "solving analysis" ||
    kind === "solving-analysis" ||
    rootKind === "solving-analysis"
  )
    feature = "background-solving";
  else if (rootRole === "prepare") feature = "pre-intake";
  else if (rootRole === "reflect" || role === "reflection coach")
    feature = "reflection";
  else if (rootRole === "coach" || role === "coach") feature = "coaching";
  else if (rootRole === "evaluate" || role === "evaluator")
    feature = "evaluation";
  else if (rootRole === "prescription" || role === "planner")
    feature = "planning";
  else if (rootRole === "java help" || role === "java reference")
    feature = "java-help";

  let stage = "other-model";
  if (kind === "solving-analysis") stage = "chunk-analysis";
  else if (kind === "question-generation") stage = "question-generation";
  else if (kind === "question-analysis") stage = "question-analysis";
  else if (kind === "question-judgment") stage = "question-judgment";
  else if (kind === "audit") stage = "audit";
  else if (kind === "research") stage = "doc-search";
  else if (kind === "model") {
    if (role === "reflection coach" || role === "coach") stage = "coach-reply";
    else if (role === "java reference") stage = "java-help-reply";
    else if (role === "evaluator") stage = "evaluation-reply";
    else if (role === "planner") stage = "planner-selection";
  }
  return { feature, stage };
}
function extractTokens(usage: Record<string, any> | null | undefined) {
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  const inputTokens = num(usage?.inputTokens ?? usage?.input_tokens);
  const cachedInputTokens = num(
    usage?.cachedInputTokens ?? usage?.cached_input_tokens,
  );
  const outputTokens = num(usage?.outputTokens ?? usage?.output_tokens);
  const reasoningTokens = num(
    usage?.reasoningOutputTokens ??
      usage?.reasoningTokens ??
      usage?.reasoning_tokens,
  );
  const totalTokens =
    num(usage?.totalTokens ?? usage?.total_tokens) ||
    inputTokens + outputTokens;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

export type TraceMeta = {
  role: string;
  kind?: string;
  attemptId?: string;
  subjectId?: string;
  mode?: "practice" | "test";
  model?: string;
  effort?: string;
};
const shared = globalThis as typeof globalThis & {
  duoTraceScope?: AsyncLocalStorage<AgentTrace>;
  duoTraceStores?: Map<string, TraceStore>;
  duoTraceInstance?: string;
  duoTraceWarning?: string;
};
export const traceScope = (shared.duoTraceScope ??=
  new AsyncLocalStorage<AgentTrace>());
const instance = (shared.duoTraceInstance ??= randomUUID());
export const traceHealth = () => shared.duoTraceWarning ?? null;
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    shared.duoTraceWarning = `Some diagnostics could not be saved: ${redact(String(e))}`;
    return undefined;
  }
}
// Deliberately exclude credentials, account protocol, stderr and private reasoning.
// Token usage counters are numbers and are not credentials.
export function redact(value: unknown): any {
  if (typeof value === "string") {
    // Tool replies commonly contain a JSON string inside an inputText item.
    if (/^\s*[\[{]/.test(value)) {
      try {
        const parsed = JSON.parse(value);
        const clean = JSON.stringify(redact(parsed));
        if (clean !== JSON.stringify(parsed)) return clean;
      } catch {}
    }
    return value
      .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[REDACTED]")
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        "[REDACTED]",
      )
      .replace(
        /((?:LEETCODE_SESSION|csrftoken|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)\s*[=:]\s*)[^\s;,"'}]+/gi,
        "$1[REDACTED]",
      );
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(?:authorization|proxy-authorization|cookie|set-cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|credentials|LEETCODE_SESSION|csrftoken)$/i.test(
          k,
        )
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return value;
}
export const traceHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex");
function encode(value: unknown) {
  const text = JSON.stringify(redact(value)) ?? "null";
  const bytes = Buffer.byteLength(text);
  return bytes <= 16 * 1024 * 1024
    ? text
    : JSON.stringify({
        truncated: true,
        bytes,
        sha256: traceHash(value),
        preview: text.slice(0, 64000),
      });
}
export function traceFile() {
  return (
    process.env.DUO_TRACE_DATABASE ||
    (process.env.NODE_TEST_CONTEXT || process.env.DUO_DATABASE === ":memory:"
      ? ":memory:"
      : process.env.DUO_DATABASE
        ? `${path.resolve(process.env.DUO_DATABASE)}.diagnostics.sqlite`
        : path.join(
            practiceHome(),
            sandboxMode() ? "sandbox-diagnostics.sqlite" : "diagnostics.sqlite",
          ))
  );
}
export class TraceStore {
  db: DatabaseSync;
  constructor(public readonly file = traceFile()) {
    if (file !== ":memory:")
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, parentId TEXT, rootId TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
        attemptId TEXT, subjectId TEXT, mode TEXT NOT NULL, model TEXT, effort TEXT,
        startedAt INTEGER NOT NULL, endedAt INTEGER, status TEXT NOT NULL, error TEXT, threadId TEXT, usage TEXT,
        ownerPid INTEGER NOT NULL, ownerInstance TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_runs_root ON agent_runs(rootId);
      CREATE INDEX IF NOT EXISTS agent_runs_started ON agent_runs(startedAt DESC);
      CREATE TABLE IF NOT EXISTS agent_events (runId TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(runId,seq));
      CREATE TABLE IF NOT EXISTS diagnostic_settings (id INTEGER PRIMARY KEY CHECK(id=1), retentionDays INTEGER);
      INSERT OR IGNORE INTO diagnostic_settings VALUES(1,30);
      CREATE TABLE IF NOT EXISTS agent_usage_ledger (
        id TEXT PRIMARY KEY, rootId TEXT NOT NULL, parentId TEXT,
        feature TEXT NOT NULL, stage TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
        mode TEXT NOT NULL, attemptId TEXT, model TEXT, effort TEXT,
        startedAt INTEGER NOT NULL, endedAt INTEGER, status TEXT NOT NULL,
        inputTokens INTEGER NOT NULL DEFAULT 0, cachedInputTokens INTEGER NOT NULL DEFAULT 0,
        outputTokens INTEGER NOT NULL DEFAULT 0, reasoningTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS agent_usage_started ON agent_usage_ledger(startedAt DESC);`);
    this.recover();
    this.backfillUsage();
    this.prune();
  }
  syncUsage(id: string) {
    const row = this.db
      .prepare("SELECT * FROM agent_runs WHERE id=?")
      .get(id) as any;
    if (!row || containerKinds.has(String(row.kind))) return;
    const root =
      (this.db
        .prepare("SELECT role,kind FROM agent_runs WHERE id=?")
        .get(row.rootId) as any) ?? row;
    const { feature, stage } = classifyUsage(
      String(row.role),
      String(row.kind),
      String(root.role),
      String(root.kind),
    );
    const parsedUsage = row.usage ? JSON.parse(row.usage) : null;
    const tokens = extractTokens(parsedUsage);
    this.db
      .prepare(
        `INSERT INTO agent_usage_ledger (
          id, rootId, parentId, feature, stage, role, kind, mode, attemptId, model, effort,
          startedAt, endedAt, status, inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          feature=excluded.feature, stage=excluded.stage, model=excluded.model, effort=excluded.effort,
          endedAt=excluded.endedAt, status=excluded.status,
          inputTokens=excluded.inputTokens, cachedInputTokens=excluded.cachedInputTokens,
          outputTokens=excluded.outputTokens, reasoningTokens=excluded.reasoningTokens,
          totalTokens=excluded.totalTokens`,
      )
      .run(
        row.id,
        row.rootId,
        row.parentId ?? null,
        feature,
        stage,
        row.role,
        row.kind,
        row.mode,
        row.attemptId ?? null,
        row.model ?? null,
        row.effort ?? null,
        row.startedAt,
        row.endedAt ?? null,
        row.status,
        tokens.inputTokens,
        tokens.cachedInputTokens,
        tokens.outputTokens,
        tokens.reasoningTokens,
        tokens.totalTokens,
      );
  }
  backfillUsage() {
    const missing = this.db
      .prepare(
        `SELECT r.id FROM agent_runs r LEFT JOIN agent_usage_ledger u ON u.id = r.id
         WHERE u.id IS NULL AND r.kind NOT IN ('workflow','question-review')`,
      )
      .all() as { id: string }[];
    for (const row of missing) this.syncUsage(row.id);
  }
  start(meta: TraceMeta, parent?: AgentTrace) {
    this.prune();
    const id = randomUUID();
    const rootId = parent?.rootId ?? id;
    const mode =
      meta.mode ?? parent?.mode ?? (sandboxMode() ? "test" : "practice");
    const attemptId = meta.attemptId ?? parent?.attemptId;
    const subjectId = meta.subjectId ?? parent?.subjectId;
    this.db
      .prepare(
        `INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,'running',NULL,NULL,NULL,?,?)`,
      )
      .run(
        id,
        parent?.id ?? null,
        rootId,
        meta.role,
        meta.kind ?? "model",
        attemptId ?? null,
        subjectId ?? null,
        mode,
        meta.model ?? null,
        meta.effort ?? null,
        Date.now(),
        process.pid,
        instance,
      );
    this.event(id, "run.started", {
      harnessVersion: "agent-trace-v1",
      ...meta,
    });
    return new AgentTrace(this, id, rootId, mode, attemptId, subjectId);
  }
  event(id: string, kind: string, data: unknown) {
    // A single SQL statement allocates sequence numbers across concurrent writers.
    this.db
      .prepare(
        `INSERT INTO agent_events SELECT ?,COALESCE(MAX(seq),0)+1,?,?,? FROM agent_events WHERE runId=?`,
      )
      .run(id, Date.now(), kind, encode(data), id);
  }
  update(
    id: string,
    data: {
      model?: string;
      effort?: string;
      threadId?: string;
      usage?: Record<string, number>;
    },
  ) {
    for (const key of ["model", "effort", "threadId", "usage"] as const)
      if (data[key] !== undefined)
        this.db
          .prepare(`UPDATE agent_runs SET ${key}=? WHERE id=?`)
          .run(key === "usage" ? encode(data[key]) : (data[key] as string), id);
    if (data.usage !== undefined || data.model !== undefined || data.effort !== undefined)
      this.syncUsage(id);
  }
  finish(id: string, status: Exclude<TraceStatus, "running">, error?: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "UPDATE agent_runs SET status=?,endedAt=?,error=? WHERE id=? AND status='running'",
        )
        .run(status, Date.now(), error ? redact(error) : null, id);
      if (result.changes) {
        this.event(id, "run.finished", { status, error });
        this.syncUsage(id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  recover() {
    for (const r of this.db
      .prepare(
        "SELECT id,ownerPid,ownerInstance FROM agent_runs WHERE status='running'",
      )
      .all() as any[]) {
      let alive = true;
      try {
        process.kill(r.ownerPid, 0);
      } catch (e: any) {
        alive = e.code !== "ESRCH";
      }
      if (
        !alive ||
        (r.ownerPid === process.pid && r.ownerInstance !== instance)
      )
        this.finish(
          r.id,
          "interrupted",
          "The app stopped before this run finished. Earlier events were preserved.",
        );
    }
  }
  settings() {
    return this.db
      .prepare("SELECT retentionDays FROM diagnostic_settings WHERE id=1")
      .get() as { retentionDays: number | null };
  }
  setRetention(days: number | null) {
    if (days !== null && ![7, 30, 90, 365].includes(days))
      throw new Error("Choose an available retention period.");
    this.db
      .prepare("UPDATE diagnostic_settings SET retentionDays=? WHERE id=1")
      .run(days);
    return this.prune();
  }
  prune(now = Date.now()) {
    const days = this.settings().retentionDays;
    if (days === null) return 0;
    return Number(
      this.db
        .prepare(
          `DELETE FROM agent_runs WHERE rootId IN
      (SELECT rootId FROM agent_runs GROUP BY rootId HAVING SUM(status='running')=0 AND MAX(endedAt)<?)`,
        )
        .run(now - days * 86400000).changes,
    );
  }
  decode(row: any): TraceRun {
    const { ownerPid, ownerInstance, ...rest } = row;
    return { ...rest, usage: row.usage ? JSON.parse(row.usage) : null };
  }
  list(
    filters: {
      role?: string;
      status?: string;
      mode?: string;
      attemptId?: string;
      offset?: number;
    } = {},
  ) {
    this.recover();
    this.prune();
    const clauses: string[] = [],
      args: (string | number)[] = [];
    for (const key of ["role", "status", "mode", "attemptId"] as const)
      if (filters[key]) {
        clauses.push(`${key}=?`);
        args.push(filters[key]!);
      }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return {
      runs: this.db
        .prepare(
          `SELECT * FROM agent_runs ${where} ORDER BY startedAt DESC,rowid DESC LIMIT 50 OFFSET ?`,
        )
        .all(...args, filters.offset ?? 0)
        .map((r) => this.decode(r)),
      total: Number(
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM agent_runs ${where}`)
          .get(...args)!.n,
      ),
      roles: this.db
        .prepare("SELECT DISTINCT role FROM agent_runs ORDER BY role")
        .all()
        .map((r) => String(r.role)),
      ...this.settings(),
      warning: traceHealth(),
    };
  }
  detail(id: string): TraceDetail {
    this.recover();
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id=?").get(id);
    if (!row)
      throw new Error(
        "This trace is unavailable. It may predate tracing, have expired, or have been cleared.",
      );
    return {
      run: this.decode(row),
      family: this.db
        .prepare(
          "SELECT * FROM agent_runs WHERE rootId=? ORDER BY startedAt,rowid",
        )
        .all(row.rootId)
        .map((r) => this.decode(r)),
      events: this.db
        .prepare(
          "SELECT seq,at,kind,data FROM agent_events WHERE runId=? ORDER BY seq",
        )
        .all(id)
        .map((e: any) => ({ ...e, data: JSON.parse(e.data) })),
    };
  }
  export(id?: string) {
    this.recover();
    const root = id ? this.detail(id).run.rootId : undefined;
    // Consistent snapshot even while another server process is recording.
    this.db.exec("BEGIN");
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM agent_runs ${root ? "WHERE rootId=?" : ""} ORDER BY startedAt,rowid`,
        )
        .all(...(root ? [root] : []));
      return {
        format: "duoleetcode-agent-diagnostics",
        version: 1,
        exportedAt: Date.now(),
        retentionDays: this.settings().retentionDays,
        runs: rows.map((r) => ({
          ...this.decode(r),
          events: this.db
            .prepare(
              "SELECT seq,at,kind,data FROM agent_events WHERE runId=? ORDER BY seq",
            )
            .all(r.id)
            .map((e: any) => ({ ...e, data: JSON.parse(e.data) })),
        })),
      };
    } finally {
      this.db.exec("COMMIT");
    }
  }
  clear(id?: string) {
    this.recover();
    const root = id ? this.detail(id).run.rootId : undefined;
    if (
      root &&
      this.db
        .prepare("SELECT 1 FROM agent_runs WHERE rootId=? AND status='running'")
        .get(root)
    )
      throw new Error(
        "Wait for this run and its child calls to finish before clearing it.",
      );
    return Number(
      this.db
        .prepare(
          `DELETE FROM agent_runs WHERE rootId IN (SELECT rootId FROM agent_runs ${root ? "WHERE rootId=?" : ""} GROUP BY rootId HAVING SUM(status='running')=0)`,
        )
        .run(...(root ? [root] : [])).changes,
    );
  }
  usageSummary(
    mode: "practice" | "test" | "all" = "practice",
    now = Date.now(),
  ): UsageSummary {
    this.recover();
    this.backfillUsage();
    const rows = (
      mode === "all"
        ? this.db
            .prepare(
              "SELECT * FROM agent_usage_ledger WHERE status != 'running' ORDER BY startedAt DESC",
            )
            .all()
        : this.db
            .prepare(
              "SELECT * FROM agent_usage_ledger WHERE mode=? AND status != 'running' ORDER BY startedAt DESC",
            )
            .all(mode)
    ) as any[];
    const emptyTotals = (): UsageTotals => ({
      calls: 0,
      succeededCalls: 0,
      failedCalls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      durationMs: 0,
    });
    const addRow = (t: UsageTotals, r: any) => {
      t.calls++;
      if (r.status === "succeeded") t.succeededCalls++;
      else t.failedCalls++;
      t.inputTokens += Number(r.inputTokens ?? 0);
      t.cachedInputTokens += Number(r.cachedInputTokens ?? 0);
      t.outputTokens += Number(r.outputTokens ?? 0);
      t.reasoningTokens += Number(r.reasoningTokens ?? 0);
      t.totalTokens += Number(r.totalTokens ?? 0);
      if (r.endedAt && r.startedAt && r.endedAt >= r.startedAt)
        t.durationMs += Number(r.endedAt - r.startedAt);
    };
    const specs: { key: UsageWindowKey; label: string; since: number }[] = [
      { key: "last5h", label: "Last 5 hours", since: now - 5 * 3600_000 },
      { key: "last24h", label: "Last 24 hours", since: now - 24 * 3600_000 },
      { key: "last7d", label: "Last 7 days", since: now - 7 * 86400_000 },
      { key: "last30d", label: "Last 30 days", since: now - 30 * 86400_000 },
      { key: "allTime", label: "All recorded", since: 0 },
    ];
    return {
      generatedAt: now,
      mode,
      windows: specs.map((spec) => {
        const subset = rows.filter((r) => Number(r.startedAt) >= spec.since);
        const totals = emptyTotals();
        const features = new Map<string, UsageBucket>();
        const stages = new Map<string, UsageBucket>();
        const sessions = new Set<string>();
        for (const r of subset) {
          addRow(totals, r);
          if (r.attemptId) sessions.add(String(r.attemptId));
          const fk = String(r.feature);
          let fb = features.get(fk);
          if (!fb) {
            fb = {
              ...emptyTotals(),
              key: fk,
              label: featureLabels[fk] ?? fk,
            };
            features.set(fk, fb);
          }
          addRow(fb, r);
          const sk = String(r.stage);
          let sb = stages.get(sk);
          if (!sb) {
            sb = {
              ...emptyTotals(),
              key: sk,
              label: stageLabels[sk] ?? sk,
            };
            stages.set(sk, sb);
          }
          addRow(sb, r);
        }
        const sessionCount = sessions.size;
        return {
          ...totals,
          windowKey: spec.key,
          label: spec.label,
          sessions: sessionCount,
          avgCallsPerSession: sessionCount
            ? Math.round((totals.calls / sessionCount) * 10) / 10
            : 0,
          avgTokensPerSession: sessionCount
            ? Math.round(totals.totalTokens / sessionCount)
            : 0,
          byFeature: [...features.values()].sort(
            (a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls,
          ),
          byStage: [...stages.values()].sort(
            (a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls,
          ),
        };
      }),
    };
  }
  close() {
    this.db.close();
  }
}
export function traces(): TraceStore {
  const file = traceFile();
  const stores = (shared.duoTraceStores ??= new Map<string, TraceStore>());
  if (!stores.has(file)) stores.set(file, new TraceStore(file));
  return stores.get(file)!;
}
export class AgentTrace {
  constructor(
    public store: TraceStore | undefined,
    public id: string,
    public rootId: string,
    public mode: "practice" | "test",
    public attemptId?: string,
    public subjectId?: string,
  ) {}
  event(kind: string, data: unknown) {
    safe(() => this.store?.event(this.id, kind, data));
  }
  update(data: Parameters<TraceStore["update"]>[1]) {
    safe(() => this.store?.update(this.id, data));
  }
  finish(status: Exclude<TraceStatus, "running">, error?: string) {
    safe(() => this.store?.finish(this.id, status, error));
  }
}
export function currentTrace() {
  return traceScope.getStore();
}
export function startTrace(meta: TraceMeta, store?: TraceStore) {
  const parent = currentTrace();
  return (
    safe(() => (store ?? parent?.store ?? traces()).start(meta, parent)) ??
    new AgentTrace(
      undefined,
      randomUUID(),
      parent?.rootId ?? randomUUID(),
      meta.mode ?? parent?.mode ?? "practice",
      meta.attemptId ?? parent?.attemptId,
      meta.subjectId ?? parent?.subjectId,
    )
  );
}
export async function traced<T>(
  meta: TraceMeta,
  fn: (trace: AgentTrace) => Promise<T>,
  store?: TraceStore,
): Promise<T> {
  const trace = startTrace(meta, store);
  return traceScope.run(trace, async () => {
    try {
      const value = await fn(trace);
      trace.finish("succeeded");
      return value;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status =
        (e as any)?.traceStatus ??
        (/too long|did not respond in time/.test(message)
          ? "timed-out"
          : "failed");
      trace.finish(status, message);
      throw e;
    }
  });
}
