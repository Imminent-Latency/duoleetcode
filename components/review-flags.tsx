"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Group, Select } from "@mantine/core";
import CoachText from "./coach-text";
import { api } from "@/lib/browser";
import type { ReviewFlag, ReviewFlagSummary } from "@/lib/review-flag-types";
export default function ReviewFlags({ initialId }: { initialId?: string }) {
  const [flags, setFlags] = useState<ReviewFlagSummary[]>([]),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState(initialId ?? "");
  const [detail, setDetail] = useState<ReviewFlag>(),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const d = await api(
      `/api/review-flags?offset=${offset}${status ? `&status=${status}` : ""}`,
    );
    setFlags(d.flags);
    setTotal(d.total);
  }, [status, offset]);
  useEffect(() => {
    const refresh = () => {
      void load().catch((e) => setError(e.message));
    };
    refresh();
    window.addEventListener("duo-review-flags-changed", refresh);
    return () =>
      window.removeEventListener("duo-review-flags-changed", refresh);
  }, [load]);
  useEffect(() => {
    let live = true;
    setDetail(undefined);
    setError("");
    if (selected)
      void api(`/api/review-flags?id=${selected}`)
        .then((d) => {
          if (live) setDetail(d);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selected]);
  async function update() {
    if (!detail) return;
    setBusy(true);
    try {
      setDetail(
        await api("/api/review-flags", {
          action: "status",
          id: detail.id,
          status: detail.status === "open" ? "resolved" : "open",
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!detail) return;
    const { bundle, ...flag } = detail;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...bundle, flag }, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `duoleetcode-review-${detail.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const captured = detail?.bundle.context as
    | {
        visibleSource?: string;
        selectedItem?: { text?: string; answer?: string; summary?: string };
        prescription?: { reason: string };
      }
    | undefined;
  const capturedText =
    captured?.selectedItem?.text ??
    captured?.selectedItem?.answer ??
    captured?.selectedItem?.summary ??
    captured?.prescription?.reason;
  return (
    <section className="diagnostics-page">
      <h1>Flagged for review</h1>
      <p>
        Your notes and captured context stay here until you revisit them. Copies
        of traces are kept even after normal diagnostic logs expire or are
        cleared.
      </p>
      <p className="small">
        These are product feedback, separate from coach memory and skill
        evidence. They are not included in practice snapshots; download a review
        bundle to keep a portable copy.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Group my="lg">
        <Select
          label="Show"
          data={[
            { value: "", label: "All flags" },
            { value: "open", label: "Open" },
            { value: "resolved", label: "Reviewed" },
          ]}
          value={status}
          allowDeselect={false}
          onChange={(v) => {
            setStatus(v ?? "");
            setOffset(0);
          }}
        />
        <Button
          variant="default"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh flags
        </Button>
      </Group>
      <div className="diagnostics-grid">
        <aside className="diagnostic-list">
          <p>{total} flags</p>
          {!flags.length && (
            <p>
              Use “Flag for review” beside a reply or recommendation, or in the
              editor.
            </p>
          )}
          {flags.map((f) => (
            <button
              className={`diagnostic-run ${selected === f.id ? "selected" : ""}`}
              key={f.id}
              onClick={() => setSelected(f.id)}
            >
              <strong>{f.title}</strong>
              <span>
                {f.category} · {f.status === "resolved" ? "Reviewed" : "Open"}
              </span>
              <small>
                {f.mode} · {new Date(f.createdAt).toLocaleString()}
              </small>
              {f.note && <span>{f.note.slice(0, 120)}</span>}
            </button>
          ))}
          <Group justify="space-between">
            <Button
              variant="subtle"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </Button>
            <Button
              variant="subtle"
              disabled={offset + 50 >= total}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </Button>
          </Group>
        </aside>
        <article className="diagnostic-detail">
          {!detail ? (
            <p>
              {selected
                ? "Loading flag…"
                : "Select a flag to inspect its preserved context."}
            </p>
          ) : (
            <>
              <Group justify="space-between">
                <h2>{detail.title}</h2>
                <Badge color={detail.status === "open" ? "yellow" : "teal"}>
                  {detail.status === "open" ? "Open" : "Reviewed"}
                </Badge>
              </Group>
              <p>
                {detail.category} · {detail.mode} ·{" "}
                {new Date(detail.createdAt).toLocaleString()}
              </p>
              <p className="review-flag-note">
                {detail.note || "No note added."}
              </p>
              <p>{detail.bundle.traceNote}</p>
              <Group my="md">
                <Button variant="default" onClick={download}>
                  Download review bundle
                </Button>
                <Button
                  variant="light"
                  loading={busy}
                  onClick={() => void update()}
                >
                  {detail.status === "open" ? "Mark reviewed" : "Reopen flag"}
                </Button>
              </Group>
              {capturedText && (
                <div className="review-captured-message">
                  <h3>Flagged content</h3>
                  <CoachText>{capturedText}</CoachText>
                </div>
              )}
              {captured?.visibleSource !== undefined && (
                <details className="diagnostic-event">
                  <summary>Captured solution</summary>
                  <pre>{captured.visibleSource}</pre>
                </details>
              )}
              <details className="diagnostic-event">
                <summary>Captured item, solution & conversation</summary>
                <pre>
                  {JSON.stringify(
                    {
                      target: detail.bundle.target,
                      context: detail.bundle.context,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <details className="diagnostic-event">
                <summary>Agent settings at capture</summary>
                <pre>
                  {JSON.stringify(detail.bundle.settingsAtCapture, null, 2)}
                </pre>
              </details>
              {detail.traceState === "captured" && (
                <details className="diagnostic-event">
                  <summary>Preserved traces · {detail.traceCount} runs</summary>
                  <pre>{JSON.stringify(detail.bundle.traces, null, 2)}</pre>
                </details>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
