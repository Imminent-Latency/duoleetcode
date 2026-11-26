"use client";
import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "./ui";
import { api } from "@/lib/browser";
import type { LanguageId } from "@/lib/languages";
import type { PrescriptionOverrideInput } from "@/lib/skill-ratings";

export default function PrescriptionCoachDrawer({
  language,
  isPremium,
  currentSlug,
  disabled,
  onQuickOverride,
  onCoachApplied,
}: {
  language: LanguageId;
  isPremium: boolean;
  currentSlug?: string;
  disabled: boolean;
  onQuickOverride: (override: PrescriptionOverrideInput) => Promise<void>;
  onCoachApplied: (status: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const sendCoach = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await api("/api/prescription", {
        action: "coach",
        message: text,
        language,
        isPremium,
      });
      setReply(res.reply ?? "");
      setDraft("");
      onCoachApplied(res);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        className="text-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Sparkles size={14} /> Adjust with coach
      </Button>
    );
  }

  return (
    <div className="prescription-coach-drawer">
      <div className="prescription-coach-head">
        <strong>Adjust today’s problem</strong>
        <Button className="text-button" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <div className="prescription-coach-chips">
        <Button
          className="text-button"
          disabled={disabled || busy}
          onClick={() =>
            void onQuickOverride({ maxMinutes: 15, excludeSlug: currentSlug })
          }
        >
          15 min or less
        </Button>
        <Button
          className="text-button"
          disabled={disabled || busy}
          onClick={() =>
            void onQuickOverride({
              slotOverride: "easy-reinforcement",
              excludeSlug: currentSlug,
            })
          }
        >
          Easier win
        </Button>
        <Button
          className="text-button"
          disabled={disabled || busy}
          onClick={() =>
            void onQuickOverride({
              slotOverride: "stretch",
              excludeSlug: currentSlug,
            })
          }
        >
          Stretch challenge
        </Button>
        <Button
          className="text-button"
          disabled={disabled || busy}
          onClick={() =>
            void onQuickOverride({
              domainPoolOverride: [
                "graphs-search",
                "dynamic-programming",
                "binary-search",
              ],
              excludeSlug: currentSlug,
            })
          }
        >
          Graphs / DP / BS pool
        </Button>
      </div>
      <div className="prescription-coach-input-row">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void sendCoach();
            }
          }}
          placeholder="e.g. Give me Graphs or DP under 20 minutes"
          disabled={disabled || busy}
        />
        <Button
          className="button secondary compact"
          disabled={disabled || busy || !draft.trim()}
          onClick={() => void sendCoach()}
        >
          <Send size={14} /> {busy ? "Applying…" : "Apply"}
        </Button>
      </div>
      {reply && <p className="small">{reply}</p>}
    </div>
  );
}
