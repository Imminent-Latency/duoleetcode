"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Select, Table } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/browser";
import type {
  UsageBucket,
  UsageSummary,
  UsageWindowKey,
} from "@/lib/agent-trace-types";

const fmt = (n: number) => n.toLocaleString();
const fmtDuration = (ms: number) =>
  ms < 1000
    ? `${ms}ms`
    : ms < 60_000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${(ms / 60_000).toFixed(1)}m`;

function BucketTable({
  title,
  subtitle,
  rows,
  windowTotalTokens,
}: {
  title: string;
  subtitle: string;
  rows: UsageBucket[];
  windowTotalTokens: number;
}) {
  return (
    <section className="usage-panel">
      <div className="usage-panel-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="usage-empty">
          No completed model calls recorded in this window yet.
        </p>
      ) : (
        <div className="usage-table-scroll">
          <Table
            className="usage-table"
            striped
            highlightOnHover
            verticalSpacing={6}
            horizontalSpacing="sm"
          >
            <colgroup>
              <col />
              <col className="usage-col-calls" />
              <col className="usage-col-num" />
              <col className="usage-col-share" />
              <col className="usage-col-wide" />
              <col className="usage-col-wide" />
              <col className="usage-col-time" />
            </colgroup>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th ta="right">Calls</Table.Th>
                <Table.Th ta="right">Total tokens</Table.Th>
                <Table.Th ta="right">Share</Table.Th>
                <Table.Th ta="right">Input (cached)</Table.Th>
                <Table.Th ta="right">Output (reasoning)</Table.Th>
                <Table.Th ta="right">Time</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => {
                const share =
                  windowTotalTokens > 0
                    ? Math.round((r.totalTokens / windowTotalTokens) * 100)
                    : 0;
                return (
                  <Table.Tr key={r.key}>
                    <Table.Td>
                      <span className="usage-name">{r.label}</span>
                      {r.failedCalls > 0 && (
                        <Badge ml="xs" color="red" variant="light" size="sm">
                          {r.failedCalls} failed
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{fmt(r.calls)}</Table.Td>
                    <Table.Td ta="right">{fmt(r.totalTokens)}</Table.Td>
                    <Table.Td ta="right">{share}%</Table.Td>
                    <Table.Td ta="right">
                      {fmt(r.inputTokens)}
                      {r.cachedInputTokens > 0 && (
                        <span className="usage-sub">
                          {" "}
                          ({fmt(r.cachedInputTokens)})
                        </span>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {fmt(r.outputTokens)}
                      {r.reasoningTokens > 0 && (
                        <span className="usage-sub">
                          {" "}
                          ({fmt(r.reasoningTokens)})
                        </span>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{fmtDuration(r.durationMs)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="usage-stat">
      <span className="usage-stat-label">{label}</span>
      <strong className="usage-stat-value">{value}</strong>
      <span className="usage-stat-detail">{detail}</span>
    </div>
  );
}

export default function UsageDiagnostics() {
  const [mode, setMode] = useState<"practice" | "test" | "all">("practice");
  const [windowKey, setWindowKey] = useState<UsageWindowKey>("last5h");
  const [summary, setSummary] = useState<UsageSummary>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setSummary(await api(`/api/diagnostics?usage=1&mode=${mode}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const current =
    summary?.windows.find((w) => w.windowKey === windowKey) ??
    summary?.windows[0];

  return (
    <div className="diag-view">
      <div className="diag-view-header">
        <div className="diag-view-intro">
          <h3>Model &amp; feature usage</h3>
          <p>
            Compact token and call totals across rolling plan windows. Clearing
            raw diagnostic logs preserves these usage totals.
          </p>
        </div>
        <div className="diag-filters">
          <Select
            aria-label="Usage time window"
            className="diag-filter diag-filter-wide"
            value={windowKey}
            allowDeselect={false}
            onChange={(v) => v && setWindowKey(v as UsageWindowKey)}
            data={[
              { label: "Last 5 hours", value: "last5h" },
              { label: "Last 24 hours", value: "last24h" },
              { label: "Last 7 days", value: "last7d" },
              { label: "Last 30 days", value: "last30d" },
              { label: "All recorded", value: "allTime" },
            ]}
          />
          <Select
            aria-label="Usage session mode"
            className="diag-filter"
            value={mode}
            allowDeselect={false}
            onChange={(v) => v && setMode(v as "practice" | "test" | "all")}
            data={[
              { label: "Practice", value: "practice" },
              { label: "Test", value: "test" },
              { label: "All modes", value: "all" },
            ]}
          />
          <Button
            variant="default"
            leftSection={<RefreshCw size={14} />}
            onClick={load}
            loading={busy}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {!current && !error && (
        <p className="diag-empty-line">
          {busy ? "Loading usage…" : "No usage recorded yet."}
        </p>
      )}

      {current && (
        <>
          <div className="usage-stats">
            <Stat
              label={`Calls (${current.label})`}
              value={fmt(current.calls)}
              detail={`${fmt(current.succeededCalls)} succeeded${
                current.failedCalls > 0
                  ? ` · ${fmt(current.failedCalls)} failed`
                  : ""
              }`}
            />
            <Stat
              label="Total tokens"
              value={fmt(current.totalTokens)}
              detail={`${fmt(current.inputTokens)} in · ${fmt(current.outputTokens)} out`}
            />
            <Stat
              label="Average per session"
              value={
                current.sessions ? `${current.avgCallsPerSession} calls` : "-"
              }
              detail={
                current.sessions
                  ? `${fmt(current.avgTokensPerSession)} tokens · ${fmt(current.sessions)} session${current.sessions === 1 ? "" : "s"}`
                  : "No session-linked calls in window"
              }
            />
            <Stat
              label="Cumulative runtime"
              value={fmtDuration(current.durationMs)}
              detail={`${fmt(current.reasoningTokens)} reasoning · ${fmt(current.cachedInputTokens)} cached in`}
            />
          </div>

          <BucketTable
            title="By user-facing feature"
            subtitle="See how much usage goes to background solving analysis, pre-intake review, live chat, and Java help."
            rows={current.byFeature}
            windowTotalTokens={current.totalTokens}
          />

          <BucketTable
            title="By internal agent stage"
            subtitle="See which harness stages account for calls, tokens, and latency."
            rows={current.byStage}
            windowTotalTokens={current.totalTokens}
          />
        </>
      )}
    </div>
  );
}
