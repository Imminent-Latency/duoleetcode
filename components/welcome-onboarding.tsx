"use client";
import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Panel } from "./ui";
import { api } from "@/lib/browser";
import {
  DEFAULT_STARTING_TIER,
  STARTING_TIER_BANDS,
  type StartingTier,
} from "@/lib/skill-ratings";

export default function WelcomeOnboarding({
  onUpdated,
  onError,
}: {
  onUpdated: () => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState<StartingTier | "skip" | null>(null);
  const tiers: StartingTier[] = ["foundations", "interview-prep", "experienced"];

  const pick = async (tier: StartingTier) => {
    setBusy(tier);
    try {
      await api("/api/ratings", {
        action: "set-onboarding",
        startingTier: tier,
        welcomeDismissed: true,
      });
      await onUpdated();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    setBusy("skip");
    try {
      await api("/api/ratings", {
        action: "set-onboarding",
        startingTier: DEFAULT_STARTING_TIER,
        welcomeDismissed: true,
      });
      await onUpdated();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className="panel welcome-onboarding-card">
      <div className="card-topline">
        <span className="pill mint">
          <Sparkles size={13} /> WELCOME TO YOUR PRACTICE
        </span>
        <Button
          className="text-button"
          disabled={!!busy}
          onClick={() => void skip()}
        >
          Skip (default: Foundations)
        </Button>
      </div>
      <h2>Where should Session #1 begin?</h2>
      <p className="recommendation-description">
        Pick a starting comfort band for your first problem. We calibrate your real
        baseline across 4 adaptive sessions without inflating or penalizing your
        prior rating.
      </p>
      <div className="tier-picker-grid">
        {tiers.map((tier) => {
          const cfg = STARTING_TIER_BANDS[tier];
          const isDefault = tier === DEFAULT_STARTING_TIER;
          return (
            <div key={tier} className="tier-option-card">
              <div className="tier-option-head">
                <strong>{cfg.label}</strong>
                {isDefault && <span className="pill mint">Recommended</span>}
              </div>
              <p className="small">{cfg.description}</p>
              <div className="tier-option-meta">
                <span>
                  Band {cfg.band[0]}–{cfg.band[1]}
                </span>
                <span>
                  {cfg.minutes[0]}–{cfg.minutes[1]} min
                </span>
              </div>
              <Button
                className={isDefault ? "button primary full" : "button secondary full"}
                disabled={!!busy}
                onClick={() => void pick(tier)}
              >
                {busy === tier ? "Saving…" : `Start with ${cfg.label}`}{" "}
                <ArrowRight size={15} />
              </Button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
