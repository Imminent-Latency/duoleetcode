"use client";
import { Button, Panel } from "./ui";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  FlaskConical,
  Link2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { BridgeConnection } from "@/lib/leetcode-bridge";

// Settings › Connections. Pure view: all state and side effects stay in Workspace.
export type ConnectionsViewProps = {
  connection: BridgeConnection;
  agentStatus: any;
  busy: boolean;
  javaStatus: string;
  cppStatus: string;
  cppDetail: string;
  onBridgeAction: () => void;
  onRecheckBridge: () => void;
  onRefreshRuntimes: () => void;
  onChooseModels: () => void;
  onWarmJava: () => void;
  onWarmCpp: () => void;
  onOpenDemo: () => void;
};

export default function ConnectionsView({
  connection,
  agentStatus,
  busy,
  javaStatus,
  cppStatus,
  cppDetail,
  onBridgeAction,
  onRecheckBridge,
  onRefreshRuntimes,
  onChooseModels,
  onWarmJava,
  onWarmCpp,
  onOpenDemo,
}: ConnectionsViewProps) {
  return (
    <div className="settings-subpage connections-page">
      <p className="subpage-description">
        LeetCode, AI runtimes, and editor toolchains this workspace uses.
      </p>
      <div className="connections-list">
        <Panel className="panel connection-card">
          <span className="connection-icon" aria-hidden="true">
            <Link2 size={18} />
          </span>
          <div className="connection-main">
            <h2>LeetCode</h2>
            <p>
              Fetches problem statements, starter code, and runs LeetCode tests
              through your browser.
            </p>
          </div>
          <div className="connection-status">
            <ConnectionLine
              ok={connection.isSignedIn}
              tone={
                connection.isSignedIn
                  ? "ok"
                  : connection.bridgeReachable
                    ? "warn"
                    : "pending"
              }
              label={connection.label}
              detail={connection.detail}
            />
          </div>
          <div className="connection-actions">
            <Button
              className="button primary"
              onClick={onBridgeAction}
              disabled={busy}
            >
              {connection.actionLabel}
              {connection.externalUrl ? (
                <ArrowUpRight size={16} />
              ) : (
                <ArrowRight size={16} />
              )}
            </Button>
            {connection.externalUrl && (
              <Button
                className="button secondary"
                onClick={onRecheckBridge}
                disabled={busy}
              >
                Check status <RotateCcw size={15} />
              </Button>
            )}
          </div>
          <details
            className="connection-setup"
            open={
              connection.kind === "extension-missing" ||
              connection.kind === "permissions-missing" ||
              connection.kind === "unsupported-browser" ||
              connection.kind === "untrusted-origin"
            }
          >
            <summary>Extension setup</summary>
            <p>
              Load the existing “DuoLeetCode Local Bridge” unpacked extension
              from the project’s spikes/leetcode/extension folder, then open
              http://127.0.0.1:4318/ in a normal (non-incognito) tab of that
              browser. Once signed in to LeetCode, no open LeetCode tab is
              needed.
            </p>
          </details>
        </Panel>
        <Panel className="panel connection-card">
          <span className="connection-icon" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <div className="connection-main">
            <h2>AI learning team</h2>
            <p>
              Codex and Claude (Claude Agent SDK · ACP). Choose models per
              feature in General.
            </p>
          </div>
          <div className="connection-status">
            {Array.isArray(agentStatus?.providers) &&
            agentStatus.providers.length > 0 ? (
              agentStatus.providers.map((p: any) => (
                <ConnectionLine
                  key={p.id}
                  ok={!!p.signedIn}
                  label={`${p.name} · ${p.signedIn ? "Connected" : "Sign-in needed"}`}
                  detail={p.detail}
                />
              ))
            ) : (
              <ConnectionLine
                ok={!!agentStatus?.signedIn}
                label={
                  agentStatus?.signedIn
                    ? "AI runtime connected"
                    : "AI sign-in needed"
                }
                detail={
                  agentStatus?.signedIn
                    ? "Using your connected local runtime."
                    : "Your assessment and recording work without AI."
                }
              />
            )}
          </div>
          <div className="connection-actions">
            <Button
              className="button secondary"
              disabled={busy}
              onClick={onRefreshRuntimes}
            >
              {agentStatus?.signedIn
                ? "Refresh runtimes"
                : "Sign in with ChatGPT"}
              <ArrowUpRight size={16} />
            </Button>
            <Button
              className="button secondary"
              disabled={busy}
              onClick={onChooseModels}
            >
              Choose models <ArrowRight size={16} />
            </Button>
          </div>
        </Panel>
        <Panel className="panel connection-card">
          <span className="connection-icon" aria-hidden="true">
            <Code2 size={18} />
          </span>
          <div className="connection-main">
            <h2>Java in your browser</h2>
            <p>
              Semantic completion from javacs, running in a browser JVM. No
              local language-server process required.
            </p>
          </div>
          <div className="connection-status">
            <ConnectionLine
              ok={javaStatus === "Java ready"}
              label={javaStatus}
              detail="Java 25 preview API profile · runtime downloaded on demand"
            />
            <p className="connection-note">
              The runtime currently needs an internet connection. Run and Submit
              use LeetCode’s judge.
            </p>
          </div>
          <div className="connection-actions">
            <Button className="button secondary" onClick={onWarmJava}>
              Warm up Java <RotateCcw size={15} />
            </Button>
          </div>
        </Panel>
        <Panel className="panel connection-card">
          <span className="connection-icon" aria-hidden="true">
            <Code2 size={18} />
          </span>
          <div className="connection-main">
            <h2>C++26 local toolchain</h2>
            <p>
              Semantic completion, hover signatures, and diagnostics from your
              local clangd process using -std=c++26.
            </p>
          </div>
          <div className="connection-status">
            <ConnectionLine
              ok={cppStatus === "C++26 ready"}
              tone={
                cppStatus === "C++26 ready"
                  ? "ok"
                  : cppStatus === "C++26 unavailable"
                    ? "warn"
                    : "pending"
              }
              label={cppStatus}
              detail={cppDetail}
            />
            <p className="connection-note">
              Requires clangd on this machine (or DUO_CLANGD_BIN). Run and
              Submit use LeetCode’s judge.
            </p>
          </div>
          <div className="connection-actions">
            <Button className="button secondary" onClick={onWarmCpp}>
              Warm up C++26 <RotateCcw size={15} />
            </Button>
          </div>
        </Panel>
        <Panel className="panel connection-card">
          <span className="connection-icon" aria-hidden="true">
            <FlaskConical size={18} />
          </span>
          <div className="connection-main">
            <h2>Local demo exercise</h2>
            <p>
              Offline exercise for testing the editor, timer, and review flow
              without LeetCode.
            </p>
          </div>
          <div className="connection-status">
            <p className="connection-note">
              Excluded from progress. Remote judging unavailable.
            </p>
          </div>
          <div className="connection-actions">
            <Button
              className="button secondary"
              disabled={busy}
              onClick={onOpenDemo}
            >
              Open a demo assessment <ArrowRight size={16} />
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function ConnectionLine({
  ok,
  tone,
  label,
  detail,
}: {
  ok: boolean;
  tone?: "ok" | "warn" | "pending";
  label: string;
  detail: string;
}) {
  const resolvedTone = tone ?? (ok ? "ok" : "pending");
  return (
    <div className="connection-line">
      <span
        className={
          resolvedTone === "ok"
            ? "connection-check"
            : resolvedTone === "warn"
              ? "connection-check warn"
              : "connection-check pending"
        }
      >
        {resolvedTone === "ok" ? <Check size={14} /> : <span />}
      </span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
