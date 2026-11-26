export type TraceStatus =
  "running" | "succeeded" | "failed" | "interrupted" | "timed-out";
export type TraceRun = {
  id: string;
  parentId: string | null;
  rootId: string;
  role: string;
  kind: string;
  attemptId: string | null;
  subjectId: string | null;
  mode: "practice" | "test";
  model: string | null;
  effort: string | null;
  startedAt: number;
  endedAt: number | null;
  status: TraceStatus;
  error: string | null;
  threadId: string | null;
  usage: Record<string, number> | null;
};
export type TraceEvent = {
  seq: number;
  endSeq?: number;
  seqLabel?: string;
  at: number;
  endedAt?: number;
  kind: string;
  summary?: string;
  collapsedCount?: number;
  data: unknown;
};
export type TraceDetail = {
  run: TraceRun;
  family: TraceRun[];
  events: TraceEvent[];
  rawEventCount?: number;
  view?: "condensed" | "raw";
};
export type UsageTotals = {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs: number;
};
export type UsageBucket = UsageTotals & {
  key: string;
  label: string;
};
export type UsageWindowKey =
  "last5h" | "last24h" | "last7d" | "last30d" | "allTime";
export type UsageWindowSummary = UsageTotals & {
  windowKey: UsageWindowKey;
  label: string;
  sessions: number;
  avgCallsPerSession: number;
  avgTokensPerSession: number;
  byFeature: UsageBucket[];
  byStage: UsageBucket[];
};
export type UsageSummary = {
  generatedAt: number;
  mode: "practice" | "test" | "all";
  windows: UsageWindowSummary[];
};
