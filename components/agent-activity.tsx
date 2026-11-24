"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  Wrench,
  AlertCircle,
  Brain,
} from "lucide-react";
import { api } from "@/lib/browser";
import type { AgentActivityData } from "@/lib/agent-activity-types";
export default function AgentActivity({
  attemptId,
  feature,
  traceId,
  subjectId,
  active = false,
}: {
  attemptId: string;
  feature: "reflection" | "coaching" | "java-help";
  traceId?: string;
  subjectId?: string;
  active?: boolean;
}) {
  const [opened, setOpened] = useState(false),
    [data, setData] = useState<AgentActivityData | null>(null),
    [error, setError] = useState("");
  const since = useRef(Date.now() - 2000);
  useEffect(() => {
    if (!traceId && !active && !subjectId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError("");
    const poll = async () => {
      try {
        const p = new URLSearchParams({
          attemptId,
          feature,
          details: opened ? "1" : "0",
        });
        if (traceId) p.set("traceId", traceId);
        else {
          p.set("since", String(since.current));
          if (subjectId) p.set("subjectId", subjectId);
        }
        const result = await api(`/api/agent/activity?${p}`);
        if (!live) return;
        setData(result.activity);
        setError("");
        if (active || result.activity?.status === "running")
          timer = setTimeout(poll, 1200);
      } catch {
        if (live) {
          setError("Activity is temporarily unavailable.");
          if (active) timer = setTimeout(poll, 3000);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [attemptId, feature, traceId, subjectId, active, opened]);
  if (!traceId && !active && !subjectId) return null;
  if (!data && !active && !error) return null;
  const working = data?.status === "running" || (!data && active);
  return (
    <div className="agent-chat-activity">
      <button
        type="button"
        className="agent-activity-toggle"
        aria-label={`Agent activity: ${data?.label ?? (active ? "Starting agent" : "View activity")}`}
        aria-expanded={opened}
        onClick={() => setOpened(!opened)}
      >
        {working ? (
          <LoaderCircle size={13} className="spin" />
        ) : data && data.status !== "succeeded" ? (
          <AlertCircle size={13} />
        ) : (
          <Check size={13} />
        )}
        <span role="status">
          {data?.label ?? (active ? "Starting agent…" : "Agent activity")}
        </span>
        {!!data?.steps.length && <small>{data.steps.length} steps</small>}
        <ChevronDown size={13} className={opened ? "rotated" : ""} />
      </button>
      {opened && (
        <div className="agent-activity-content">
          {error && <p className="small">{error}</p>}
          {data?.detailsHidden && feature === "java-help" && (
            <p className="small">
              Tool details and thinking summaries become available when the
              reference reply is delivered.
            </p>
          )}
          {data?.steps.map((step) => (
            <details className="agent-activity-step" key={step.id}>
              <summary>
                {step.kind === "reasoning" ? (
                  <Brain size={12} />
                ) : (
                  <Wrench size={12} />
                )}
                <span>{step.label}</span>
                <small>
                  {step.state}
                  {step.durationMs !== undefined
                    ? ` · ${(step.durationMs / 1000).toFixed(1)}s`
                    : ""}
                </small>
              </summary>
              {step.text && (
                <p className="agent-thinking-summary">{step.text}</p>
              )}
              {step.input !== undefined && (
                <>
                  <strong>Input</strong>
                  <pre>{JSON.stringify(step.input, null, 2)}</pre>
                </>
              )}
              {step.output !== undefined && (
                <>
                  <strong>Result</strong>
                  <pre>{JSON.stringify(step.output, null, 2)}</pre>
                </>
              )}
            </details>
          ))}
          {data &&
            !data.hasReasoningSummary &&
            data.status !== "running" &&
            !data.detailsHidden && (
              <p className="small">
                This run did not provide a thinking summary.
              </p>
            )}
          {data && !(feature === "java-help" && data.detailsHidden) && (
            <a
              className="agent-trace-link"
              href={`/?trace=${data.traceId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open full diagnostics
            </a>
          )}
        </div>
      )}
    </div>
  );
}
