import type { TraceStore } from "./agent-traces";
import type { TraceRun, TraceEvent } from "./agent-trace-types";
import type {
  AgentActivityData,
  AgentActivityStep,
} from "./agent-activity-types";
const names: Record<string, string> = {
  read_evidence: "Inspecting the recording",
  resolve_java_symbol: "Checking Java symbols",
  read_java_reference: "Reading Java documentation",
  read_java_source: "Reading Java source",
  search_java_reference: "Searching Java references",
  read_secondary_reference: "Reading a secondary reference",
  find_skill_evidence: "Reviewing practice evidence",
  suggest_coaching_preference: "Proposing a coaching preference",
  search_problems: "Searching problems",
  inspect_problem: "Checking a problem",
};
function readableToolResult(result: any) {
  if (!Array.isArray(result?.contentItems)) return result;
  const content = result.contentItems.map((item: any) => {
    if (item.type !== "inputText") return item;
    try {
      return JSON.parse(item.text);
    } catch {
      return item.text;
    }
  });
  return {
    success: result.success,
    result: content.length === 1 ? content[0] : content,
  };
}
export function projectActivity(
  runs: (TraceRun & { events: TraceEvent[] })[],
  details = true,
): AgentActivityData | null {
  if (!runs.length) return null;
  const root = runs.find((r) => r.id === r.rootId) ?? runs[0];
  const steps: AgentActivityStep[] = [];
  const audits = new Map(
    runs.flatMap((r) =>
      r.events
        .filter((e) => e.kind === "audit.result")
        .map((e) => {
          const d = e.data as any;
          return [d.traceId, { ok: d.ok, issues: d.issues }] as const;
        }),
    ),
  );
  for (const run of runs) {
    const reviewStage = (
      {
        "solving-analysis": "Recording solving progress",
        "question-generation": "Finding worthwhile questions",
        "question-analysis": "Answering questions from evidence",
        "question-judgment": "Verifying findings and coverage",
      } as Record<string, string>
    )[run.kind];
    if (reviewStage)
      steps.push({
        id: `${run.id}:stage`,
        kind: "audit",
        label: reviewStage,
        state:
          run.status === "running"
            ? "running"
            : run.status === "succeeded"
              ? "complete"
              : "failed",
        at: run.startedAt,
        durationMs: run.endedAt ? run.endedAt - run.startedAt : undefined,
      });
    if (run.kind === "audit")
      steps.push({
        id: `${run.id}:audit`,
        kind: "audit",
        label: "Checking the response",
        state:
          run.status === "running"
            ? "running"
            : run.status === "succeeded"
              ? "complete"
              : "failed",
        at: run.startedAt,
        ...(details && audits.has(run.id)
          ? { output: audits.get(run.id) }
          : {}),
        durationMs: run.endedAt ? run.endedAt - run.startedAt : undefined,
      });
    const tools = new Map<string, AgentActivityStep>();
    const reasoning = new Map<
      string,
      { step: AgentActivityStep; parts: Map<number, string> }
    >();
    for (const e of run.events) {
      const d = e.data as any;
      if (e.kind === "tool.started") {
        const step: AgentActivityStep = {
          id: `${run.id}:tool:${d.callId}`,
          kind: "tool",
          label: names[d.tool] ?? d.tool,
          state: "running",
          at: e.at,
          ...(details ? { input: d.arguments } : {}),
        };
        tools.set(String(d.callId), step);
        steps.push(step);
      } else if (e.kind === "tool.completed" || e.kind === "tool.abandoned") {
        const step = tools.get(String(d.callId));
        if (step) {
          step.state =
            e.kind === "tool.abandoned"
              ? "interrupted"
              : d.result?.success === false || d.error
                ? "failed"
                : "complete";
          step.durationMs = d.durationMs;
          if (details) step.output = readableToolResult(d.result ?? d.error);
        }
      } else if (e.kind === "search.started" || e.kind === "search.completed") {
        const id = `${run.id}:search:${d.item?.id}`;
        let step = steps.find((s) => s.id === id);
        if (!step) {
          step = {
            id,
            kind: "search",
            label: "Searching documentation",
            state: "running",
            at: e.at,
          };
          steps.push(step);
        }
        if (e.kind === "search.completed") {
          step.state = "complete";
          step.durationMs = e.at - step.at;
        }
        if (details) step.output = d.item;
      } else if (
        e.kind === "reasoning.summary.delta" ||
        e.kind === "reasoning.summary.completed"
      ) {
        const id = `${run.id}:reasoning:${d.itemId}`;
        let entry = reasoning.get(id);
        if (!entry) {
          entry = {
            step: {
              id,
              kind: "reasoning",
              label: "Thinking summary",
              state: "running",
              at: e.at,
            },
            parts: new Map(),
          };
          reasoning.set(id, entry);
          steps.push(entry.step);
        }
        if (e.kind === "reasoning.summary.completed") {
          entry.parts = new Map((d.summary as string[]).map((s, i) => [i, s]));
          entry.step.state = "complete";
        } else
          entry.parts.set(
            d.summaryIndex,
            (entry.parts.get(d.summaryIndex) ?? "") + d.delta,
          );
        if (details)
          entry.step.text = [...entry.parts]
            .sort((a, b) => a[0] - b[0])
            .map((p) => p[1])
            .join("\n\n");
      } else if (e.kind === "validation.failed") {
        steps.push({
          id: `${run.id}:${e.seq}`,
          kind: "revision",
          label: "Revising the response",
          state:
            run.status === "running"
              ? "running"
              : run.status === "succeeded"
                ? "complete"
                : "failed",
          at: e.at,
          ...(details ? { output: d.issues ?? d.stage } : {}),
        });
      } else if (e.kind === "runtime.error")
        steps.push({
          id: `${run.id}:${e.seq}`,
          kind: "error",
          label: d.willRetry
            ? "Retrying a request"
            : "Request encountered a problem",
          state: d.willRetry ? "running" : "failed",
          at: e.at,
          ...(details ? { output: d.error?.message } : {}),
        });
    }
    if (run.status !== "running")
      for (const step of steps.filter(
        (s) => s.id.startsWith(run.id) && s.state === "running",
      ))
        step.state = run.status === "succeeded" ? "complete" : "interrupted";
  }
  steps.sort((a, b) => a.at - b.at);
  const active = steps.findLast(
    (s) => s.state === "running" && s.kind !== "reasoning",
  );
  const status = runs.some((r) => r.status === "running")
    ? "running"
    : root.status;
  const label =
    status === "running"
      ? (active?.label ?? "Thinking…")
      : status === "succeeded"
        ? "Activity complete"
        : status === "timed-out"
          ? "Request timed out"
          : status === "interrupted"
            ? "Request interrupted"
            : "Request did not finish";
  return {
    traceId: root.id,
    status,
    label,
    startedAt: root.startedAt,
    endedAt: status === "running" ? null : root.endedAt,
    steps,
    detailsHidden: !details,
    hasReasoningSummary: steps.some((s) => s.kind === "reasoning"),
  };
}
export function readActivity(
  db: TraceStore,
  query: {
    traceId?: string;
    attemptId: string;
    feature: "reflection" | "coaching" | "java-help";
    subjectId?: string;
    since?: number;
    details?: boolean;
  },
  allowDetails = true,
) {
  db.recover();
  let row: any;
  const roles =
    query.feature === "reflection"
      ? ["prepare", "reflect"]
      : query.feature === "coaching"
        ? ["coach"]
        : ["java help"];
  if (query.traceId)
    row = db.db
      .prepare("SELECT * FROM agent_runs WHERE id=? AND attemptId=?")
      .get(query.traceId, query.attemptId);
  else {
    row = db.db
      .prepare(
        `SELECT * FROM agent_runs WHERE attemptId=? AND kind='workflow' AND role IN (${roles.map(() => "?").join(",")}) ${query.subjectId ? "AND subjectId=?" : ""} AND (status='running' OR startedAt>=?) ORDER BY startedAt DESC,rowid DESC LIMIT 1`,
      )
      .get(
        query.attemptId,
        ...roles,
        ...(query.subjectId ? [query.subjectId] : []),
        query.since ?? 0,
      );
  }
  if (!row) return null;
  const root = db.db
    .prepare("SELECT role,subjectId FROM agent_runs WHERE id=?")
    .get(row.rootId);
  const modelRole =
    query.feature === "reflection"
      ? "reflection coach"
      : query.feature === "java-help"
        ? "java reference"
        : "coach";
  if (
    !root ||
    ![...roles, modelRole].includes(String(root.role)) ||
    (query.subjectId && root.subjectId !== query.subjectId)
  )
    return null;
  const runs = db.db
    .prepare("SELECT * FROM agent_runs WHERE rootId=? ORDER BY startedAt,rowid")
    .all(row.rootId)
    .map((r) => ({
      ...db.decode(r),
      events: db.db
        .prepare(
          "SELECT seq,at,kind,data FROM agent_events WHERE runId=? AND (kind LIKE 'tool.%' OR kind LIKE 'search.%' OR kind LIKE 'reasoning.summary.%' OR kind IN ('validation.failed','runtime.error','audit.result')) ORDER BY seq",
        )
        .all(r.id)
        .map((e: any) => ({ ...e, data: JSON.parse(e.data) })),
    }));
  return projectActivity(runs, allowDetails && !!query.details);
}
