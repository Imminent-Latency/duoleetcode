"use client";
import { Button, PageHeader, Panel } from "./ui";
import { SegmentedControl } from "@mantine/core";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import ProblemPrescription, {
  type useProblemPrescription,
} from "./problem-prescription";
import WelcomeOnboarding from "./welcome-onboarding";
import { TodayRatingCard, type RatingsProfileDto } from "./skill-profile";
import { ConnectionLine } from "./connections-view";
import type { BridgeConnection } from "@/lib/leetcode-bridge";
import type { LanguageId } from "@/lib/languages";
import type { Prescription } from "@/lib/prescription-types";

// Today. Pure view: all state, effects and API calls stay in Workspace.
export type TodayViewProps = {
  now: number;
  state: any;
  language: LanguageId;
  onLanguageChange: (language: LanguageId) => void;
  prescription: ReturnType<typeof useProblemPrescription>;
  connection: BridgeConnection;
  agentStatus: any;
  busy: boolean;
  completedCount: number;
  onOpen: (id: string) => void;
  onChoosePrescribed: (
    slug: string,
    minutes: number,
    prescription?: Prescription,
  ) => void;
  onBrowse: () => void;
  onManageConnections: () => void;
  onBridgeAction: () => void;
  onViewProgress: () => void;
  onRetryDrain: () => Promise<void>;
  onWelcomeUpdated: () => Promise<void>;
  onError: (err: unknown) => void;
};

export default function TodayView({
  now,
  state,
  language,
  onLanguageChange,
  prescription,
  connection,
  agentStatus,
  busy,
  completedCount,
  onOpen,
  onChoosePrescribed,
  onBrowse,
  onManageConnections,
  onBridgeAction,
  onViewProgress,
  onRetryDrain,
  onWelcomeUpdated,
  onError,
}: TodayViewProps) {
  return (
    <div className="page-content">
      <PageHeader
        title="Today"
        actions={
          <>
            <div className="date-chip">
              <span>
                {new Date(now).toLocaleDateString(undefined, {
                  weekday: "long",
                })}
              </span>
              <strong>
                {new Date(now).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                })}
              </strong>
            </div>
            <SegmentedControl
              aria-label="Practice language"
              size="xs"
              value={language}
              onChange={(value) => onLanguageChange(value as LanguageId)}
              data={[
                { value: "java", label: "Java 25" },
                { value: "cpp", label: "C++26" },
              ]}
            />
          </>
        }
      />
      {!state?.sandboxMode && state?.ratings?.onboarding?.showWelcomePicker && (
        <WelcomeOnboarding onUpdated={onWelcomeUpdated} onError={onError} />
      )}
      <div className="home-grid">
        <ProblemPrescription
          controller={prescription}
          language={language}
          isPremium={Boolean(connection?.isPremium)}
          continuation={state?.recommendation}
          gate={state?.ratings?.gate}
          ready={
            !!connection?.isSignedIn &&
            !!agentStatus?.signedIn &&
            !state?.sandboxMode
          }
          bridgeConnection={connection}
          agentSignedIn={!!agentStatus?.signedIn}
          disabled={busy}
          onOpen={onOpen}
          onChoose={onChoosePrescribed}
          onBrowse={onBrowse}
          onConnect={onManageConnections}
          onBridgeAction={onBridgeAction}
        />
        <Panel className="panel setup-preview">
          <div className="section-heading">
            <h3>Connections</h3>
            <Button className="text-button" onClick={onManageConnections}>
              Manage connections <ArrowRight size={14} />
            </Button>
          </div>
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
          {!connection.isSignedIn && connection.externalUrl && (
            <Button
              className="text-button"
              disabled={busy}
              onClick={onBridgeAction}
            >
              {connection.actionLabel} <ArrowUpRight size={14} />
            </Button>
          )}
          <ConnectionLine
            ok={!!agentStatus?.signedIn}
            label="AI runtime"
            detail={
              agentStatus?.signedIn
                ? `Connected (${agentStatus.provider || "Local AI"})`
                : "Connect Codex or Claude"
            }
          />
        </Panel>
      </div>
      <div className="bottom-grid">
        {!state?.sandboxMode && state?.ratings && (
          <TodayRatingCard
            ratings={state.ratings as RatingsProfileDto}
            onRetryDrain={onRetryDrain}
            onOpenAttempt={onOpen}
          />
        )}
        <Panel className="panel progress-preview">
          <div className="section-heading">
            <h3>Progress</h3>
            <Button className="text-button" onClick={onViewProgress}>
              View progress <ArrowUpRight size={14} />
            </Button>
          </div>
          <div className="mini-stats">
            <div>
              <strong>{completedCount.toString().padStart(2, "0")}</strong>
              <span>assessments finished</span>
            </div>
            <div>
              <strong>
                {(
                  state?.followups.filter((s: any) => s.hasResponse).length ?? 0
                )
                  .toString()
                  .padStart(2, "0")}
              </strong>
              <span>follow-ups answered</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
