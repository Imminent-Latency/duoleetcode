"use client";
import { useState } from "react";
import { MultiSelect, NumberInput, Progress as MantineProgress } from "@mantine/core";
import { RefreshCw, ShieldCheck, Sliders, Sparkles } from "lucide-react";
import { Button, Panel } from "./ui";
import { api } from "@/lib/browser";
import {
  DOMAIN_LABELS,
  DOMAINS,
  type DirectorPreferences,
  type DomainId,
} from "@/lib/skill-ratings";

export type RatingsProfileDto = {
  revealed: boolean;
  prescribedCount: number;
  prescribedGradedCount: number;
  calibrationTarget: number;
  revealText: string;
  globalMu: number;
  globalSigma: number;
  consecutiveMisses: number;
  complexityCalibration: {
    time: { accurate: number; inaccurate: number; unsure: number; formatted: string };
    space: { accurate: number; inaccurate: number; unsure: number; formatted: string };
  };
  domains: Array<{
    id: DomainId;
    label: string;
    implDisplay: number;
    implLatent: number;
    implSigma: number;
    implProvisional: boolean;
    selDisplay: number;
    selLatent: number;
    selSigma: number;
    selProvisional: boolean;
    rusty: boolean;
    implAttempts: number;
    lastDay: number | null;
  }>;
  concepts: Array<{
    order: number;
    slug: string;
    label: string;
    domain: DomainId;
    domainLabel: string;
    minGlobalMu: number;
    state: "unseen" | "probed" | "coached" | "applied";
    stabilityDays: number;
    retrievability: number | null;
    reps: number;
    lapses: number;
    probeCount: number;
  }>;
  preferences: DirectorPreferences;
  onboarding: {
    startingTier: "foundations" | "interview-prep" | "experienced";
    welcomeDismissed: boolean;
    showWelcomePicker: boolean;
  };
  pendingJobCount: number;
  failedJobCount: number;
  gate: {
    allowed: boolean;
    reason?: "active-attempt" | "unsettled-checkin" | "active-coaching";
    blockingAttemptId?: string;
    title?: string;
    slug?: string;
    message?: string;
  };
  deferredReflections: Array<{
    attemptId: string;
    title: string;
    slug: string;
    createdAt: number;
  }>;
  catalogSync: {
    catalogCount: number;
    totalNum: number | null;
    nextSkip: number;
    lastCompletedAt: number | null;
    needsRefresh: boolean;
    consecutiveErrors: number;
    backoffUntil: number | null;
  };
};

export function TodayRatingCard({
  ratings,
  onRetryDrain,
  onOpenAttempt,
}: {
  ratings: RatingsProfileDto;
  onRetryDrain: () => Promise<void>;
  onOpenAttempt: (id: string) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const progressPct = Math.min(
    100,
    Math.round((ratings.prescribedGradedCount / ratings.calibrationTarget) * 100),
  );
  const syncedText =
    ratings.catalogSync.totalNum && ratings.catalogSync.lastCompletedAt === null
      ? `Syncing catalog (${ratings.catalogSync.catalogCount}/${ratings.catalogSync.totalNum})`
      : `${ratings.catalogSync.catalogCount} problems cached`;

  return (
    <Panel className="panel rating-summary-card">
      <div className="section-heading">
        <div>
          <h3>
            {ratings.revealed
              ? `Skill rating: ${ratings.revealText}`
              : `Rating calibration (${ratings.prescribedGradedCount} of ${ratings.calibrationTarget})`}
          </h3>
        </div>
        <span className="small text-muted">{syncedText}</span>
      </div>
      {!ratings.revealed ? (
        <>
          <MantineProgress value={progressPct} size="sm" radius="xl" mb="xs" />
          <p className="small">
            Complete {Math.max(0, ratings.calibrationTarget - ratings.prescribedGradedCount)} more
            prescribed timed sessions to reveal your hierarchical rating profile.
          </p>
        </>
      ) : (
        <div className="mini-stats">
          <div>
            <strong>{ratings.globalMu}</strong>
            <span>global rating (±{ratings.globalSigma})</span>
          </div>
          <div>
            <strong>{ratings.complexityCalibration.time.formatted}</strong>
            <span>Time complexity accuracy</span>
          </div>
          <div>
            <strong>{ratings.complexityCalibration.space.formatted}</strong>
            <span>Space complexity accuracy</span>
          </div>
        </div>
      )}
      {ratings.failedJobCount > 0 && (
        <div className="rating-retry-banner">
          <span className="small">
            {ratings.failedJobCount} rating update
            {ratings.failedJobCount > 1 ? "s" : ""} paused due to AI timeout/outage.
          </span>
          <Button
            className="text-button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetryDrain();
              } finally {
                setRetrying(false);
              }
            }}
          >
            <RefreshCw size={13} /> {retrying ? "Retrying…" : "Retry rating update"}
          </Button>
        </div>
      )}
      {ratings.deferredReflections.length > 0 && (
        <div className="deferred-reflections-list">
          <span className="stat-label">Pending reflections</span>
          {ratings.deferredReflections.map((item) => (
            <Button
              key={item.attemptId}
              className="text-button"
              onClick={() => onOpenAttempt(item.attemptId)}
            >
              Finish reflection: {item.title}
            </Button>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ProgressSkillProfile({
  ratings,
  onRefresh,
  onError,
}: {
  ratings: RatingsProfileDto;
  onRefresh: () => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [focusDomains, setFocusDomains] = useState<string[]>(
    ratings.preferences.focusDomains,
  );
  const [mutedDomains, setMutedDomains] = useState<string[]>(
    ratings.preferences.mutedDomains,
  );
  const [maxMinutes, setMaxMinutes] = useState<number | string>(
    ratings.preferences.maxMinutes ?? "",
  );
  const [saving, setSaving] = useState(false);

  const domainOptions = DOMAINS.map((id) => ({
    value: id,
    label: DOMAIN_LABELS[id],
  }));

  const savePrefs = async () => {
    setSaving(true);
    try {
      await api("/api/ratings", {
        action: "set-preferences",
        preferences: {
          focusDomains: focusDomains as DomainId[],
          mutedDomains: mutedDomains as DomainId[],
          ...(typeof maxMinutes === "number" && Number.isFinite(maxMinutes)
            ? { maxMinutes }
            : {}),
        },
      });
      await onRefresh();
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="skill-profile-section">
      <div className="section-heading">
        <h2>Skill ratings &amp; complexity calibration</h2>
        <span>
          {ratings.revealed
            ? `Global ${ratings.revealText}`
            : `Calibrating (${ratings.prescribedGradedCount}/4)`}
        </span>
      </div>
      <div className="stats-grid">
        <Panel className="panel">
          <span className="stat-label">Global skill</span>
          <strong>{ratings.revealed ? ratings.revealText : "Calibrating"}</strong>
          <p>{ratings.prescribedGradedCount} prescribed attempts graded</p>
        </Panel>
        <Panel className="panel">
          <span className="stat-label">Time complexity</span>
          <strong>{ratings.complexityCalibration.time.formatted}</strong>
          <p>Separate from domain ratings</p>
        </Panel>
        <Panel className="panel">
          <span className="stat-label">Space complexity</span>
          <strong>{ratings.complexityCalibration.space.formatted}</strong>
          <p>Counts exclude unsure answers</p>
        </Panel>
      </div>

      <Panel className="panel">
        <div className="section-heading">
          <h3>
            <Sliders size={16} /> Practice focus &amp; time cap
          </h3>
        </div>
        <div className="director-prefs-grid">
          <MultiSelect
            label="Focus domains (up to 3)"
            description="Slot 0 Growth dedicates priority turns to eligible pinned domains."
            data={domainOptions}
            value={focusDomains}
            onChange={(vals) => setFocusDomains(vals.slice(0, 3))}
            maxValues={3}
            clearable
          />
          <MultiSelect
            label="Muted domains"
            description="Keep at least 4 Easy-backed domains active."
            data={domainOptions}
            value={mutedDomains}
            onChange={setMutedDomains}
            clearable
          />
          <NumberInput
            label="Max session minutes (10–45)"
            description="Filters problem difficulty to fit your clock."
            min={10}
            max={45}
            value={maxMinutes}
            onChange={setMaxMinutes}
            placeholder="No cap"
            allowDecimal={false}
          />
        </div>
        <Button
          className="button secondary"
          disabled={saving}
          onClick={() => void savePrefs()}
        >
          {saving ? "Saving preferences…" : "Save curriculum preferences"}
        </Button>
      </Panel>

      <Panel className="panel">
        <div className="section-heading">
          <h3>13 Domain Ratings</h3>
          <span>Implementation &amp; selection</span>
        </div>
        <div className="domain-ratings-table">
          {ratings.domains.map((d) => (
            <div key={d.id} className="domain-rating-row">
              <div>
                <strong>{d.label}</strong>
                {d.rusty && <span className="pill warn">Rusty</span>}
                {d.implProvisional && <span className="pill">Provisional</span>}
              </div>
              <div className="domain-rating-metrics">
                <span>
                  Impl: <strong>{ratings.revealed ? d.implDisplay : "-"}</strong>{" "}
                  <small>(±{d.implSigma})</small>
                </span>
                <span>
                  Select: <strong>{ratings.revealed ? d.selDisplay : "-"}</strong>{" "}
                  <small>(±{d.selSigma})</small>
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="panel">
        <div className="section-heading">
          <h3>
            <ShieldCheck size={16} /> Track B Concept Retention (24 Concepts)
          </h3>
          <span>Stability in days</span>
        </div>
        <div className="concept-stability-grid">
          {ratings.concepts.map((c) => (
            <div key={c.slug} className="concept-card-mini">
              <div className="concept-card-head">
                <strong>{c.label}</strong>
                <span className="pill">{c.state}</span>
              </div>
              <small>
                {c.domainLabel} · Stability: {c.stabilityDays}d
                {c.retrievability !== null ? ` · Recall ${Math.round(c.retrievability * 100)}%` : ""}
              </small>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
