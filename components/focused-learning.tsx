"use client";
import { Button, Panel, TextInput, Textarea } from "./ui";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  MessageCircle,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import type { Attempt, ReplayFocus } from "@/lib/types";
import { latestCoaching, pendingCoaching, readyToMoveOn } from "@/lib/coaching";
import CoachText from "./coach-text";
import ReviewFlagButton from "./review-flag";
import AgentActivity from "./agent-activity";
import ResearchSources from "./research-sources";
import type { EditorChatBinding } from "./use-editor-chat";
import { ChatCodeContext, SavedCodeContext } from "./chat-code-context";

export type CoachRequest = {
  id: string;
  text: string;
  focus?: ReplayFocus;
  editor?: import("@/lib/types").EditorChatContext;
};
export default function FocusedLearning({
  attempt: a,
  busy,
  onMutate,
  onAgent,
  onHome,
  onError,
  editor,
  saveWorkspace,
}: {
  attempt: Attempt;
  busy: boolean;
  onMutate: (body: unknown) => Promise<void>;
  onAgent: (
    action: "evaluate" | "coach",
    message?: CoachRequest,
  ) => Promise<boolean>;
  onHome: () => void;
  onError: (error: unknown) => void;
  editor?: EditorChatBinding;
  saveWorkspace?: () => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const draftRequest = useRef<CoachRequest | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editor?.focusRequest) {
      input.current?.focus();
      input.current?.scrollIntoView({ block: "center" });
    }
  }, [editor?.focusRequest]);
  const followup = a.followup;
  const evaluation =
    a.evaluations[followup?.evaluationRevision ?? a.evaluations.length - 1];
  const messages = followup?.messages ?? [];
  const lastCoach = latestCoaching(a);
  const understanding = lastCoach?.understanding;
  const pending = pendingCoaching(a);
  const sufficient = readyToMoveOn(a);
  const closed = a.phase === "complete";
  const started = Boolean(followup?.feedback || lastCoach);
  useEffect(() => {
    if (
      draftRequest.current &&
      messages.some((m) => m.id === draftRequest.current!.id)
    ) {
      setDraft("");
      draftRequest.current = undefined;
    }
  }, [a]);
  const safe = async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };
  const moveOn = () =>
    safe(async () => {
      if (!closed)
        await onMutate({
          action: "complete",
          reason: sufficient ? "sufficient" : started ? "manual" : "skipped",
        });
      onHome();
    });
  const send = async () => {
    if (!draft.trim() || busy || saving || pending || closed) return;
    setSaving(true);
    try {
      const request =
        draftRequest.current?.text === draft.trim()
          ? draftRequest.current
          : {
              id: crypto.randomUUID(),
              text: draft.trim(),
              editor: editor?.current
                ? { ...editor.context(), source: "coached" as const }
                : undefined,
            };
      if (!draftRequest.current) await saveWorkspace?.();
      draftRequest.current = request;
      if (await onAgent("coach", request)) {
        setDraft("");
        editor?.clear();
        draftRequest.current = undefined;
      }
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
      input.current?.focus();
    }
  };
  return (
    <div className="learning-grid conversational-learning">
      <Panel className="panel exercise-card">
        <div className="card-topline">
          <span className="pill mint">
            <Target size={14} /> FOCUSED PRACTICE
          </span>
          <span className="text-muted">UNTIMED · ABOUT 2–5 MIN</span>
        </div>
        <h2>{evaluation?.exercise.title ?? "Your learning session"}</h2>
        {evaluation && (
          <CoachText prompt>{evaluation.exercise.prompt}</CoachText>
        )}
        {!followup ? (
          closed ? (
            <p className="small">
              You moved on without a focused response. Your assessment is saved.
            </p>
          ) : (
            <>
              <label htmlFor="first-answer" className="field-label">
                Your first response
              </label>
              <Textarea
                id="first-answer"
                className="answer-input"
                placeholder="Explain your reasoning or write a small Java snippet…"
                value={answer}
                maxLength={20000}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <p className="small">
                One independent response, preserved before the conversation
                begins.
              </p>
              <Button
                className="button primary"
                disabled={busy || saving || !answer.trim() || !evaluation}
                onClick={() =>
                  void safe(async () => {
                    await onMutate({ action: "answer", answer });
                  })
                }
              >
                Save my first response <ArrowRight size={16} />
              </Button>
            </>
          )
        ) : (
          <>
            <span className="stat-label">First response</span>
            <pre className="answer-snapshot">{followup.answer}</pre>
            {followup.feedback &&
              followup.feedback !==
                messages.find(
                  (m) =>
                    m.role === "assistant" && m.replyTo === "first-response",
                )?.text && (
                <details className="earlier-feedback">
                  <summary>
                    Earlier feedback · {followup.outcome?.replaceAll("-", " ")}
                  </summary>
                  <CoachText sources={followup.research?.sources}>
                    {followup.feedback}
                  </CoachText>
                  <ResearchSources research={followup.research} />
                  <ReviewFlagButton
                    target={{
                      kind: "coaching",
                      attemptId: a.id,
                      messageId: "legacy-feedback",
                    }}
                  />
                  <p className="small">
                    This earlier assessment is preserved. You can discuss or
                    challenge it below.
                  </p>
                </details>
              )}
            <div className="coaching-conversation">
              <div className="conversation-heading">
                <MessageCircle size={17} />
                <h3>Talk it through</h3>
                <span>Ask. Explain. Challenge.</span>
              </div>
              {!messages.length && (
                <p className="small">
                  The coach looks for understanding in your reasoning. You can
                  ask follow-ups or question its interpretation.
                </p>
              )}
              <div
                className="coach-messages"
                aria-label="Coaching conversation"
                aria-live="polite"
                aria-relevant="additions"
              >
                {messages.map((m) => (
                  <article
                    className={`coach-message ${m.role}`}
                    key={m.id}
                    id={`message-${m.id}`}
                  >
                    <span className="message-author">
                      {m.role === "assistant" ? (
                        <>
                          <Sparkles size={13} /> Coach
                        </>
                      ) : (
                        "You"
                      )}
                    </span>
                    <CoachText sources={m.research?.sources}>
                      {m.text}
                    </CoachText>
                    <ResearchSources research={m.research} />
                    {m.role === "assistant" && (
                      <>
                        <AgentActivity
                          attemptId={a.id}
                          feature="coaching"
                          traceId={m.research?.traceId}
                        />
                        <ReviewFlagButton
                          target={{
                            kind: "coaching",
                            attemptId: a.id,
                            messageId: m.id,
                          }}
                        />
                      </>
                    )}
                    <SavedCodeContext context={m.editor} />
                  </article>
                ))}
              </div>
              {(busy || pending) && (
                <AgentActivity
                  attemptId={a.id}
                  feature="coaching"
                  active={busy}
                />
              )}
              {!closed && (
                <>
                  {!lastCoach && !pending && (
                    <Button
                      className="button primary"
                      disabled={busy || saving}
                      onClick={() => void onAgent("coach")}
                    >
                      <Sparkles size={15} />
                      {followup.feedback
                        ? "Revisit this feedback with the coach"
                        : "Get focused feedback"}
                    </Button>
                  )}
                  {pending && !busy && (
                    <div className="pending-reply" role="status">
                      <p>
                        Your message is saved. The coach’s reply hasn’t arrived
                        yet.
                      </p>
                      <Button
                        className="button secondary"
                        disabled={saving}
                        onClick={() => void onAgent("coach")}
                      >
                        Retry coach reply
                      </Button>
                    </div>
                  )}
                  {started && (
                    <form
                      className="coach-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <label htmlFor="coach-message">
                        {sufficient
                          ? "Keep talking, if you’d like"
                          : "Your reply or question"}
                      </label>
                      {editor && (
                        <ChatCodeContext
                          current={editor.current}
                          selection={editor.selection}
                          onAttach={() => editor.attach()}
                          onRemove={editor.clear}
                        />
                      )}
                      <Textarea
                        ref={input}
                        id="coach-message"
                        value={draft}
                        maxLength={20000}
                        placeholder="Ask a follow-up, explain your reasoning, or challenge the feedback…"
                        disabled={busy || saving || Boolean(pending)}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <div>
                        <span className="small">
                          Enter to send · Shift + Enter for a new line
                        </span>
                        <Button
                          type="submit"
                          className="button primary"
                          disabled={
                            busy || saving || Boolean(pending) || !draft.trim()
                          }
                        >
                          <Send size={14} /> Send
                        </Button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </Panel>
      <aside className="learning-side">
        <Panel
          className={`panel session-check ${sufficient ? "ready" : ""}`}
          aria-live="polite"
        >
          <span className="stat-label">
            {closed ? "Session ended" : "This session"}
          </span>
          <h3>
            {closed
              ? a.learningExit?.reason === "sufficient"
                ? "Understanding demonstrated"
                : a.learningExit?.reason === "skipped"
                  ? "Coaching skipped"
                  : "You chose to move on"
              : sufficient
                ? "Enough evidence to move on"
                : "Working through the concept"}
          </h3>
          {understanding ? (
            <>
              <p>{understanding.summary}</p>
              <ul className="concept-checks">
                {understanding.criteria.map((c, index) => (
                  <li key={index}>
                    <span
                      className={c.status === "demonstrated" ? "met" : "open"}
                    >
                      {c.status === "demonstrated" ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <MessageCircle size={16} />
                      )}
                      {c.concept}
                    </span>
                    {c.evidence.length > 0 && (
                      <details>
                        <summary>See the evidence</summary>
                        {c.evidence.map((e, i) => (
                          <blockquote key={i}>
                            <p>{e.quote}</p>
                            <cite>
                              {e.messageId === "first-response"
                                ? "Your first response"
                                : "Your conversation response"}
                            </cite>
                          </blockquote>
                        ))}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              <p className="small">
                {understanding.support === "independent"
                  ? "Evidence from your first response."
                  : understanding.support === "coached"
                    ? "Evidence includes your reasoning during coaching."
                    : "Exploratory evidence; independent recall is unassessed."}{" "}
                A future revisit will check retention.
              </p>
            </>
          ) : (
            <p>
              {closed
                ? "Your recorded work is saved. Moving on does not count as demonstrating this concept."
                : "Explain the idea in your own way. The coach will ask about any real gaps and recognize when you’ve shown enough."}
            </p>
          )}
          <Button
            className={`button ${sufficient || closed ? "primary" : "secondary"} full`}
            disabled={saving && !busy}
            onClick={() => void moveOn()}
          >
            {closed
              ? "Back to today"
              : sufficient
                ? "Move on"
                : started
                  ? "Move on for now"
                  : "Skip coaching"}{" "}
            <ArrowRight size={16} />
          </Button>
          {closed && evaluation && (
            <Button
              className="button secondary full"
              disabled={saving || busy}
              onClick={() =>
                void safe(async () => {
                  await onMutate({ action: "learn" });
                })
              }
            >
              {followup ? "Continue coaching" : "Try focused practice"}
            </Button>
          )}
          {!closed && !sufficient && (
            <p className="small exit-note">
              You can leave whenever you’re ready. This won’t count as a
              completed understanding check.
            </p>
          )}
          {!closed && sufficient && (
            <p className="small exit-note">
              You’re ready for the next activity. More conversation is optional.
            </p>
          )}
        </Panel>
        {closed && (
          <Panel className="panel next-card">
            <span className="stat-label">Next step</span>
            <h3>A problem chosen from your practice</h3>
            <p>
              Return to Today for a timed problem selected using your latest
              evidence.
            </p>
            <Button className="button secondary" onClick={onHome}>
              Choose my next problem <ArrowRight size={16} />
            </Button>
          </Panel>
        )}
        <Panel className="panel">
          <span className="stat-label">Focus skill</span>
          <h3>{evaluation?.exercise.skill}</h3>
          <p>
            {evaluation?.gaps[0]?.observation ??
              "Reinforce a skill from this assessment with a smaller, focused question."}
          </p>
        </Panel>
      </aside>
    </div>
  );
}
