"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Tabs,
} from "@mantine/core";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import ReviewFlags from "./review-flags";
import ReviewFlagButton from "./review-flag";
import UsageDiagnostics from "./usage-diagnostics";
import { api } from "@/lib/browser";
import type { TraceRun, TraceDetail } from "@/lib/agent-trace-types";
import QuestionReviewDetails from "./question-review-details";
import { questionReviewSchema } from "@/lib/question-review";

type Listing = {
  runs: TraceRun[];
  total: number;
  roles: string[];
  retentionDays: number | null;
  warning: string | null;
};
const time = (at: number) => new Date(at).toLocaleString();
const elapsed = (r: TraceRun) =>
  `${(((r.endedAt ?? Date.now()) - r.startedAt) / 1000).toFixed(1)}s`;
function State({ run }: { run: TraceRun }) {
  return (
    <Badge
      color={
        run.status === "succeeded"
          ? "teal"
          : run.status === "running"
            ? "blue"
            : "red"
      }
      variant="light"
    >
      {run.status}
    </Badge>
  );
}
export default function AgentDiagnostics({
  initialId,
  initialFlag,
  onSelect,
}: {
  initialId?: string;
  initialFlag?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <Tabs
      defaultValue={initialFlag ? "flags" : "runs"}
      keepMounted={false}
      className="diagnostic-tabs"
    >
      <Tabs.List>
        <Tabs.Tab value="runs">Agent runs</Tabs.Tab>
        <Tabs.Tab value="usage">Usage</Tabs.Tab>
        <Tabs.Tab value="flags">Review flags</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="runs">
        <TraceDiagnostics initialId={initialId} onSelect={onSelect} />
      </Tabs.Panel>
      <Tabs.Panel value="usage">
        <UsageDiagnostics />
      </Tabs.Panel>
      <Tabs.Panel value="flags">
        <ReviewFlags initialId={initialFlag} />
      </Tabs.Panel>
    </Tabs>
  );
}
function TraceDiagnostics({
  initialId,
  onSelect,
}: {
  initialId?: string;
  onSelect?: (id: string) => void;
}) {
  const [listing, setListing] = useState<Listing>();
  const [detail, setDetail] = useState<TraceDetail>();
  const [selected, setSelectedState] = useState(initialId ?? "");
  useEffect(() => setSelectedState(initialId ?? ""), [initialId]);
  function setSelected(id: string) {
    setSelectedState(id);
    onSelect?.(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("trace", id);
    else url.searchParams.delete("trace");
    url.searchParams.delete("flag");
    window.history.replaceState(null, "", url);
  }
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"all" | "selected" | null>(null);
  const [retention, setRetention] = useState<string | null>(null);
  const load = useCallback(async () => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    if (mode) params.set("mode", mode);
    setListing(await api(`/api/diagnostics?${params}`));
  }, [offset, role, status, mode]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void load().catch((e) => {
        if (live) setError(e.message);
      });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    if (!selected) {
      setDetail(undefined);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setDetail(undefined);
    setError("");
    const refresh = async () => {
      try {
        const data: TraceDetail = await api(`/api/diagnostics?id=${selected}`);
        if (!live) return;
        setDetail(data);
        if (data.family.some((r) => r.status === "running"))
          timer = setTimeout(refresh, 2500);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selected]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(id?: string) {
    const data = await api(`/api/diagnostics?export=1${id ? `&id=${id}` : ""}`);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `duoleetcode-agent-traces-${id ?? new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const activeFamily = detail?.family.some((r) => r.status === "running");
  return (
    <section className="diagnostics-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LOCAL DEVELOPMENT</span>
          <h1>Agent diagnostics</h1>
          <p>
            Inspect what each agent received, the tools it used, and how its
            result was checked.
          </p>
        </div>
      </div>
      <div className="diagnostic-notice">
        These logs include code and conversations. They are separate from your
        practice history and snapshots. Authentication details and private model
        reasoning are excluded. Earlier activity cannot be reconstructed.
      </div>
      {(error || listing?.warning) && (
        <div className="banner error" role="alert">
          {error || listing?.warning}
        </div>
      )}
      <Group justify="space-between" align="end" my="lg">
        <Group align="end">
          <Select
            label="Agent"
            value={role || null}
            placeholder="All agents"
            clearable
            data={listing?.roles ?? []}
            onChange={(v) => {
              setRole(v ?? "");
              setOffset(0);
            }}
          />
          <Select
            label="Status"
            value={status || null}
            placeholder="All statuses"
            clearable
            data={[
              "running",
              "succeeded",
              "failed",
              "interrupted",
              "timed-out",
            ]}
            onChange={(v) => {
              setStatus(v ?? "");
              setOffset(0);
            }}
          />
          <Select
            label="Data"
            value={mode || null}
            placeholder="Practice & test"
            clearable
            data={["practice", "test"]}
            onChange={(v) => {
              setMode(v ?? "");
              setOffset(0);
            }}
          />
        </Group>
        <Group>
          <Button
            variant="default"
            leftSection={<RefreshCw size={15} />}
            onClick={() => void action(load)}
            disabled={busy}
          >
            Refresh
          </Button>
          <Button
            variant="default"
            leftSection={<Download size={15} />}
            onClick={() => void action(() => download())}
            disabled={busy}
          >
            Export all
          </Button>
        </Group>
      </Group>
      <div className="diagnostics-grid">
        <aside className="diagnostic-list" aria-label="Agent runs">
          <p className="diagnostic-count">
            {listing?.total ?? 0} runs · newest first
          </p>
          {listing?.runs.length === 0 && (
            <p>
              No runs recorded yet. The next agent request will appear here.
            </p>
          )}
          {listing?.runs.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`diagnostic-run ${selected === r.id ? "selected" : ""}`}
              onClick={() => setSelected(r.id)}
            >
              <span>
                <strong>{r.role}</strong>
                <State run={r} />
              </span>
              <small>
                {r.kind} · {r.mode} · {elapsed(r)}
              </small>
              <small>{time(r.startedAt)}</small>
              <small>
                {r.model ?? "Workflow"}
                {r.effort ? ` · ${r.effort}` : ""}
              </small>
            </button>
          ))}
          <Group justify="space-between" mt="md">
            <Button
              variant="subtle"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </Button>
            <Button
              variant="subtle"
              disabled={offset + 50 >= (listing?.total ?? 0)}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </Button>
          </Group>
        </aside>
        <article className="diagnostic-detail" aria-label="Run details">
          {!detail ? (
            <p>
              {selected && !error
                ? "Loading run…"
                : "Select a run to inspect its inputs, events, and outcome."}
            </p>
          ) : (
            <>
              <Group justify="space-between">
                <h2>{detail.run.role}</h2>
                <State run={detail.run} />
              </Group>
              <p>
                {detail.run.kind} · {detail.run.mode} · {elapsed(detail.run)} ·{" "}
                {time(detail.run.startedAt)}
              </p>
              <p>
                {detail.run.model ?? "Application workflow"}
                {detail.run.effort ? ` · ${detail.run.effort} effort` : ""}
              </p>
              <small className="diagnostic-id">
                Run {detail.run.id}
                {detail.run.attemptId
                  ? ` · Attempt ${detail.run.attemptId}`
                  : ""}
                {detail.run.subjectId
                  ? ` · Request ${detail.run.subjectId}`
                  : ""}
              </small>
              {detail.run.error && (
                <p className="diagnostic-error">{detail.run.error}</p>
              )}
              {detail.run.usage ? (
                <p>
                  {detail.run.usage.totalTokens.toLocaleString()} tokens ·{" "}
                  {detail.run.usage.inputTokens.toLocaleString()} input ·{" "}
                  {detail.run.usage.outputTokens.toLocaleString()} output.
                  Latest cumulative total for this model run; child calls are
                  separate.
                </p>
              ) : (
                <p className="text-muted">
                  Token usage{" "}
                  {detail.run.kind === "workflow"
                    ? "is recorded on its model calls."
                    : "was not reported by the runtime."}
                </p>
              )}
              <Group my="md">
                <Button
                  variant="default"
                  size="xs"
                  onClick={() => void action(() => download(detail.run.id))}
                >
                  Export run & related calls
                </Button>
                <Button
                  color="red"
                  variant="subtle"
                  size="xs"
                  disabled={activeFamily || busy}
                  onClick={() => setConfirm("selected")}
                >
                  Clear this run family
                </Button>
              </Group>
              <ReviewFlagButton
                target={{ kind: "agent-run", traceId: detail.run.id }}
              />
              <h3>Related calls</h3>
              <div className="diagnostic-family">
                {detail.family.map((r) => (
                  <Button
                    key={r.id}
                    size="xs"
                    variant={r.id === selected ? "light" : "subtle"}
                    onClick={() => setSelected(r.id)}
                  >
                    {r.parentId ? "↳ " : ""}
                    {r.role} · {r.kind} · {r.status}
                  </Button>
                ))}
              </div>
              <h3>Recorded events</h3>
              {detail.events
                .filter((e) => e.kind === "questions.review")
                .map((e) => {
                  const parsed = questionReviewSchema.safeParse(e.data);
                  return parsed.success ? (
                    <QuestionReviewDetails key={e.seq} review={parsed.data} />
                  ) : null;
                })}
              {detail.events.map((e) => (
                <details className="diagnostic-event" key={e.seq}>
                  <summary>
                    <span>
                      {e.seq}. {e.kind}
                    </span>
                    <small>
                      +{((e.at - detail.run.startedAt) / 1000).toFixed(2)}s
                    </small>
                  </summary>
                  <pre>{JSON.stringify(e.data, null, 2)}</pre>
                </details>
              ))}
            </>
          )}
        </article>
      </div>
      <div className="diagnostic-storage">
        <div>
          <h2>Log storage</h2>
          <p>
            Expired runs are removed as complete families. Running requests are
            preserved. Clearing logs does not change learning evidence,
            conversations, settings, or saved snapshots.
          </p>
        </div>
        <Group align="end">
          <Select
            label="Keep completed logs"
            value={listing ? String(listing.retentionDays ?? "forever") : null}
            data={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "365", label: "1 year" },
              { value: "forever", label: "Until I clear them" },
            ]}
            onChange={(v) => {
              if (v) setRetention(v);
            }}
          />
          <Button
            color="red"
            variant="light"
            leftSection={<Trash2 size={15} />}
            disabled={busy}
            onClick={() => setConfirm("all")}
          >
            Clear completed logs
          </Button>
        </Group>
      </div>
      <Modal
        opened={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Clear diagnostic logs?"
        centered
      >
        <Stack>
          <p>
            {confirm === "selected"
              ? "Remove this entire run family, including related research and audit calls?"
              : "Remove all completed run families? Active runs will stay."}{" "}
            Export first if you want to revisit these logs. Your practice data
            stays intact.
          </p>
          <Group justify="end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={busy}
              onClick={() =>
                void action(async () => {
                  await api("/api/diagnostics", {
                    action: "clear",
                    confirmed: true,
                    ...(confirm === "selected" ? { id: selected } : {}),
                  });
                  setSelected("");
                  setDetail(undefined);
                  setOffset(0);
                  setConfirm(null);
                })
              }
            >
              Clear logs
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={retention !== null}
        onClose={() => setRetention(null)}
        title="Change log retention?"
        centered
      >
        <Stack>
          <p>
            {retention === "forever"
              ? "Keep future diagnostic logs until you clear them."
              : `Completed run families older than ${retention} days will be deleted now and automatically in the future.`}{" "}
            Practice history and snapshots are unaffected.
          </p>
          <Group justify="end">
            <Button variant="default" onClick={() => setRetention(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                void action(async () => {
                  await api("/api/diagnostics", {
                    action: "retention",
                    days: retention === "forever" ? null : Number(retention),
                  });
                  setSelected("");
                  setDetail(undefined);
                  setRetention(null);
                })
              }
            >
              Save retention
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}
