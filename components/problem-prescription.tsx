"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Timer,
} from "lucide-react";
import { Button, Panel } from "./ui";
import ReviewFlagButton from "./review-flag";
import CoachText from "./coach-text";
import { api, bridge } from "@/lib/browser";
import { languageConfig, type LanguageId } from "@/lib/languages";
import type { BridgeConnection } from "@/lib/leetcode-bridge";
import type { PrescriptionStatus } from "@/lib/prescription-types";

export function useProblemPrescription(
  enabled: boolean,
  revision: number | undefined,
  connected: boolean,
  signedIn: boolean,
  language: LanguageId = "java",
) {
  const [status, setStatus] = useState<PrescriptionStatus>({});
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const automatic = useRef<string | undefined>(undefined);
  const handled = useRef(new Set<string>());
  const start = useCallback(
    async (another = false) => {
      setError("");
      setStarting(true);
      try {
        setStatus(
          await api("/api/prescription", { action: "start", another, language }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(false);
      }
    },
    [language],
  );
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void api(`/api/prescription?language=${language}`)
      .then((data: PrescriptionStatus) => {
        if (!live) return;
        setStatus(data);
        const key = `${revision}:${language}`;
        if (
          !data.prescription &&
          data.job?.state !== "running" &&
          connected &&
          signedIn &&
          automatic.current !== key
        ) {
          automatic.current = key;
          void start();
        }
      })
      .catch((e) => {
        if (live) setError(String(e.message ?? e));
      });
    return () => {
      live = false;
    };
  }, [enabled, revision, connected, signedIn, language, start]);

  // Runs at workspace level, so browsing other app views doesn't interrupt catalog tools.
  useEffect(() => {
    if (status.job?.state !== "running") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data: PrescriptionStatus = await api(
          `/api/prescription?language=${language}`,
        );
        if (!live) return;
        setStatus(data);
        for (const request of data.job?.requests ?? []) {
          if (handled.current.has(request.id)) continue;
          handled.current.add(request.id);
          try {
            if (!["list", "problem"].includes(request.op))
              throw new Error("Unsupported catalog operation.");
            const response = await bridge(request.op, request.args);
            await api("/api/prescription", {
              action: "catalog-result",
              jobId: data.job!.id,
              requestId: request.id,
              data: response,
            });
          } catch (e) {
            try {
              await api("/api/prescription", {
                action: "catalog-result",
                jobId: data.job!.id,
                requestId: request.id,
                error: String(e instanceof Error ? e.message : e).slice(
                  0,
                  2000,
                ),
              });
            } catch {
              handled.current.delete(request.id);
            }
          }
        }
        if (live && data.job?.state === "running")
          timer = setTimeout(poll, 900);
      } catch (e) {
        if (live) {
          setError(String(e instanceof Error ? e.message : e));
          timer = setTimeout(poll, 2500);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [status.job?.id, status.job?.state, language]);
  return {
    status,
    error: error || status.job?.error || "",
    busy: starting || status.job?.state === "running",
    start,
  };
}

export default function ProblemPrescription({
  controller,
  language = "java",
  continuation,
  ready,
  bridgeConnection,
  agentSignedIn,
  disabled,
  onOpen,
  onChoose,
  onBrowse,
  onConnect,
  onBridgeAction,
}: {
  controller: ReturnType<typeof useProblemPrescription>;
  language?: LanguageId;
  continuation?: { title: string; reason: string; basedOn: string } | null;
  ready: boolean;
  bridgeConnection?: BridgeConnection;
  agentSignedIn?: boolean;
  disabled: boolean;
  onOpen: (id: string) => void;
  onChoose: (slug: string, minutes: number) => void;
  onBrowse: () => void;
  onConnect: () => void;
  onBridgeAction?: () => void;
}) {
  const { status, error, busy, start } = controller;
  const p = status.prescription;
  const cfg = languageConfig(p?.language ?? language);
  const loading = busy && !continuation;
  const needsLeetCodeLogin =
    !ready &&
    agentSignedIn !== false &&
    (bridgeConnection?.kind === "signed-out" ||
      bridgeConnection?.kind === "verification-required");
  return (
    <Panel className="recommendation-card prescription-card">
      <div className="card-topline">
        <span className="pill mint">
          <Sparkles size={13} /> YOUR NEXT STEP
        </span>
        <span className="text-muted">01 / PRACTICE</span>
      </div>
      <h2>
        {continuation?.title ??
          (loading
            ? "Choosing your next challenge"
            : (p?.title ?? "A problem picked for you"))}
      </h2>
      <p className="recommendation-description">
        {continuation?.reason ??
          (loading
            ? "Matching your practice evidence with a manageable problem from LeetCode."
            : (p?.reason ??
              `Your practice history helps choose one useful, timed ${cfg.shortLabel} challenge.`))}
      </p>
      {loading ? (
        <p className="prescription-status" role="status">
          <LoaderCircle className="spin" size={17} />{" "}
          {status.job?.stage ?? "Starting your problem search"}…
        </p>
      ) : (
        !continuation &&
        p && (
          <>
            <div className="activity-meta">
              <span>
                <Code2 size={15} /> {cfg.shortLabel} · {p.difficulty}
              </span>
              <span>
                <Timer size={15} /> {p.minutes} min suggested
              </span>
              <span>
                {p.kind === "revisit" ? "Useful revisit" : "Next challenge"}
              </span>
            </div>
            <details className="prescription-evidence">
              <summary>Why this problem?</summary>
              <p>
                Chosen using your saved practice evidence. You can correct these
                observations in Coach memory.
              </p>
              {p.evidence.map((e) => (
                <div key={e.id} className="prescription-observation">
                  <strong>{e.skill}</strong>
                  <CoachText>{e.observation}</CoachText>
                  <p className="small">{e.support}</p>
                  {e.correction && <p>Your correction: {e.correction}</p>}
                  {e.url && /^https?:\/\//.test(e.url) ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      Open source · {e.source}
                    </a>
                  ) : e.attemptId ? (
                    <Button
                      className="text-button"

                      onClick={() => onOpen(e.attemptId!)}
                    >
                      View recorded attempt
                    </Button>
                  ) : (
                    <span className="small">{e.source}</span>
                  )}
                </div>
              ))}
              {!p.evidence.length && (
                <p>A starting assessment to collect your first evidence.</p>
              )}
              <p className="small">
                {p.model} · {p.effort} effort · {cfg.shortLabel} and access checked on
                LeetCode
              </p>
            </details>
          </>
        )
      )}
      {!continuation && error && (
        <p role="alert" className="prescription-error">
          {error}
        </p>
      )}
      {!continuation &&
        !loading &&
        !ready &&
        bridgeConnection &&
        bridgeConnection.kind !== "checking" && (
          <p className="small">
            {!bridgeConnection.isSignedIn
              ? `${bridgeConnection.label} — ${bridgeConnection.detail}`
              : !agentSignedIn && !p
                ? "ChatGPT sign-in needed to choose a personalized next problem."
                : ""}
          </p>
        )}
      <div className="recommendation-footer">
        {continuation ? (
          <Button
            className="button primary"
            disabled={disabled}
            onClick={() => onOpen(continuation.basedOn)}
          >
            Continue your session <ArrowRight size={17} />
          </Button>
        ) : p && !loading && bridgeConnection?.isSignedIn ? (
          <Button
            className="button primary"
            disabled={disabled}
            onClick={() => onChoose(p.slug, p.minutes)}
          >
            Prepare session <ArrowRight size={17} />
          </Button>
        ) : (
          !loading && (
            <Button
              className="button primary"
              disabled={disabled}
              onClick={() =>
                ready
                  ? void start()
                  : needsLeetCodeLogin && onBridgeAction
                    ? onBridgeAction()
                    : onConnect()
              }
            >
              {ready
                ? "Choose my next problem"
                : needsLeetCodeLogin
                  ? bridgeConnection?.actionLabel
                  : "Connect to choose a problem"}{" "}
              {needsLeetCodeLogin ? (
                <ArrowUpRight size={17} />
              ) : (
                <ArrowRight size={17} />
              )}
            </Button>
          )
        )}
        {!loading && <span>The clock starts when you’re ready.</span>}
      </div>
      {!continuation && (
        <div className="prescription-actions">
          {p && (
            <Button
              className="text-button"

              disabled={loading || disabled || !ready}
              onClick={() => void start(true)}
            >
              <RefreshCw size={14} /> Choose another
            </Button>
          )}
          <Button
            className="text-button"

            disabled={disabled}
            onClick={onBrowse}
          >
            <BookOpen size={14} /> Browse problems
          </Button>
          {error && !loading && ready && (
            <Button
              className="text-button"

              onClick={() => void start(!!p)}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      {!continuation && p && (
        <ReviewFlagButton
          target={{ kind: "prescription", prescriptionId: p.id }}
        />
      )}
      {(p?.traceId || status.job?.traceId) && (
        <a
          className="agent-trace-link"
          href={`/?trace=${p?.traceId ?? status.job?.traceId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Inspect problem selection
        </a>
      )}
    </Panel>
  );
}
