export type AgentActivityStep = {
  id: string;
  kind: "tool" | "search" | "reasoning" | "audit" | "revision" | "error";
  label: string;
  state: "running" | "complete" | "failed" | "interrupted";
  at: number;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  text?: string;
};
export type AgentActivityData = {
  traceId: string;
  status: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  steps: AgentActivityStep[];
  detailsHidden: boolean;
  hasReasoningSummary: boolean;
};
