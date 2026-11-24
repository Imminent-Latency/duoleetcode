"use client";
import type { Attempt, ReplayFocus } from "@/lib/types";
import type { ReflectionDevelopment } from "@/lib/reflection-development";
import { solvingTime } from "@/lib/assessment-time";
import CoachText from "./coach-text";
import { JavaHelpLog } from "./java-help";
import { Button } from "./ui";

type Props = {
  attempt: Attempt;
  development?: ReflectionDevelopment;
  onFocus: (focus: ReplayFocus) => void;
};
const time = (n: number) =>
  `${Math.floor(n / 60000)}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")}`;

export function ApproachContext({ attempt, development, onFocus }: Props) {
  const approach = development?.approaches.find(
    (p) => p.id === development.activeApproachId,
  );
  if (!approach) return null;
  const help = (attempt.javaHelp ?? []).filter((h) =>
    approach.assistanceIds.includes(h.id),
  );
  return (
    <details className="reflection-evidence-context">
      <summary>
        Context · {approach.label}
        {help.length
          ? ` · ${help.length} Java ${help.length === 1 ? "question" : "questions"}`
          : ""}
      </summary>
      <p className="small">
        {approach.origin === "recorded"
          ? "Recorded implementation"
          : approach.origin === "learner-proposed"
            ? "Your proposed approach"
            : "Coach-introduced approach"}
      </p>
      <CoachText>{approach.observation}</CoachText>
      {approach.focus && (
        <Button
          className="text-button"
          onClick={() => onFocus(approach.focus!)}
        >
          Show this approach
        </Button>
      )}
      {help.map((h) => (
        <details key={h.id} className="reflection-linked-help">
          <summary>
            {time(solvingTime(attempt, h.askedAt))} · {h.question}
          </summary>
          <p className="small">
            {h.deliveredAt
              ? `Answer available at ${time(solvingTime(attempt, h.deliveredAt))}`
              : "No answer delivered"}{" "}
            · Active solving time
          </p>
          <JavaHelpLog
            attemptId={attempt.id}
            entries={[h]}
            onJump={() =>
              onFocus({
                startSeq: h.requestSeq,
                endSeq: h.responseSeq ?? h.requestSeq,
                mode:
                  h.responseSeq && h.responseSeq > h.requestSeq
                    ? "range"
                    : "snapshot",
                label: "Java reference question",
                pauseSeq: h.requestSeq,
              })
            }
          />
        </details>
      ))}
    </details>
  );
}

export function DevelopmentSummary({
  attempt,
  development,
  onFocus,
  onCorrect,
}: Props & { onCorrect: (text: string) => void }) {
  if (!development) return null;
  return (
    <section
      className="reflection-development"
      aria-label="Approach history and future practice"
    >
      <h3>How your approach evolved</h3>
      {development.approaches.map((p) => (
        <details key={p.id} className="reflection-evidence-context">
          <summary>
            {p.label}
            {p.id === development.baselineApproachId
              ? " · Debrief baseline"
              : ""}
          </summary>
          <CoachText>{p.observation}</CoachText>
          <p className="small">
            {p.intent.status === "hypothesis"
              ? "Possible interpretation"
              : p.intent.status === "unknown"
                ? "Still unclear"
                : p.intent.status === "corrected"
                  ? "Corrected with your context"
                  : "Your reported intention"}
          </p>
          <CoachText>{p.intent.statement}</CoachText>
          {p.intent.evidence.map((q) => (
            <blockquote key={q.messageId + q.quote}>{q.quote}</blockquote>
          ))}
          <div className="reflection-choice-actions">
            {p.focus && (
              <Button className="text-button" onClick={() => onFocus(p.focus!)}>
                Replay this stage
              </Button>
            )}
            <Button
              className="text-button"
              onClick={() => onCorrect(`About the ${p.label} interpretation: `)}
            >
              Add context or correct
            </Button>
          </div>
          <ApproachContext
            attempt={attempt}
            development={{ ...development, activeApproachId: p.id }}
            onFocus={onFocus}
          />
        </details>
      ))}
      {!!development.revisits.length && (
        <>
          <h3>Practice to return to</h3>
          <p className="small">
            Saved for future problem selection. You can finish this reflection
            with these still open.
          </p>
          {development.revisits.map((r) => (
            <div className="reflection-takeaway" key={r.id}>
              <strong>{r.skill}</strong>
              <span className="small">
                {" "}
                ·{" "}
                {r.status === "open"
                  ? "To revisit"
                  : r.status === "resolved"
                    ? "Resolved"
                    : "Dismissed"}
              </span>
              <CoachText>{r.reason}</CoachText>
              <Button
                className="text-button"
                onClick={() => onCorrect(`About revisiting ${r.skill}: `)}
              >
                Discuss or correct
              </Button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
