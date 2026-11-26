"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
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
    <Paper withBorder radius="md" p="lg">
      <Stack gap="sm">
        <div>
          <Title order={4}>{title}</Title>
          <Text size="sm" c="dimmed">
            {subtitle}
          </Text>
        </div>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No completed model calls recorded in this window yet.
          </Text>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <Table striped highlightOnHover>
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
                        <strong>{r.label}</strong>
                        {r.failedCalls > 0 && (
                          <Badge ml="xs" color="red" variant="light" size="xs">
                            {r.failedCalls} failed
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{fmt(r.calls)}</Table.Td>
                      <Table.Td ta="right">{fmt(r.totalTokens)}</Table.Td>
                      <Table.Td ta="right">{share}%</Table.Td>
                      <Table.Td ta="right">
                        {fmt(r.inputTokens)}
                        {r.cachedInputTokens > 0
                          ? ` (${fmt(r.cachedInputTokens)})`
                          : ""}
                      </Table.Td>
                      <Table.Td ta="right">
                        {fmt(r.outputTokens)}
                        {r.reasoningTokens > 0
                          ? ` (${fmt(r.reasoningTokens)})`
                          : ""}
                      </Table.Td>
                      <Table.Td ta="right">{fmtDuration(r.durationMs)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </Paper>
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
    <Stack gap="lg" mt="md">
      <Group justify="space-between" wrap="wrap" gap="md">
        <div>
          <Title order={3}>Model &amp; feature usage</Title>
          <Text size="sm" c="dimmed">
            Compact token and call totals across rolling plan windows. Clearing
            raw diagnostic logs preserves these usage totals.
          </Text>
        </div>
        <Group gap="sm" wrap="wrap">
          <SegmentedControl
            aria-label="Usage session mode"
            value={mode}
            onChange={(v) => setMode(v as "practice" | "test" | "all")}
            data={[
              { label: "Practice", value: "practice" },
              { label: "Test", value: "test" },
              { label: "All", value: "all" },
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
        </Group>
      </Group>

      {error && <Text c="red">{error}</Text>}

      <SegmentedControl
        aria-label="Usage time window"
        value={windowKey}
        onChange={(v) => setWindowKey(v as UsageWindowKey)}
        data={[
          { label: "Last 5 hours", value: "last5h" },
          { label: "Last 24 hours", value: "last24h" },
          { label: "Last 7 days", value: "last7d" },
          { label: "Last 30 days", value: "last30d" },
          { label: "All recorded", value: "allTime" },
        ]}
      />

      {current && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
            <Paper withBorder radius="md" p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Calls ({current.label})
              </Text>
              <Title order={2} mt={4}>
                {fmt(current.calls)}
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {fmt(current.succeededCalls)} succeeded
                {current.failedCalls > 0
                  ? ` · ${fmt(current.failedCalls)} failed`
                  : ""}
              </Text>
            </Paper>
            <Paper withBorder radius="md" p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Total tokens
              </Text>
              <Title order={2} mt={4}>
                {fmt(current.totalTokens)}
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {fmt(current.inputTokens)} in · {fmt(current.outputTokens)} out
              </Text>
            </Paper>
            <Paper withBorder radius="md" p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Average per session
              </Text>
              <Title order={2} mt={4}>
                {current.sessions
                  ? `${current.avgCallsPerSession} calls`
                  : "-"}
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {current.sessions
                  ? `${fmt(current.avgTokensPerSession)} tokens · ${fmt(current.sessions)} session${current.sessions === 1 ? "" : "s"}`
                  : "No session-linked calls in window"}
              </Text>
            </Paper>
            <Paper withBorder radius="md" p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Cumulative runtime
              </Text>
              <Title order={2} mt={4}>
                {fmtDuration(current.durationMs)}
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {fmt(current.reasoningTokens)} reasoning ·{" "}
                {fmt(current.cachedInputTokens)} cached in
              </Text>
            </Paper>
          </SimpleGrid>

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
    </Stack>
  );
}
