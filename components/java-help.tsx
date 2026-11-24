"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Textarea } from "./ui";
import { MessageCircle, Send, X } from "lucide-react";
import CoachText from "./coach-text";
import ReviewFlagButton from "./review-flag";
import AgentActivity from "./agent-activity";
import ResearchSources from "./research-sources";
import { api } from "@/lib/browser";
import type { JavaHelp, EvidenceEvent } from "@/lib/types";
import type { EditorChatBinding } from "./use-editor-chat";
import { ChatCodeContext, SavedCodeContext } from "./chat-code-context";
export type RecordHelp = (
  id: string,
  stage: "request" | "response",
  detail: string,
) => Promise<EvidenceEvent>;

export function JavaHelpLog({
  attemptId,
  entries,
  onJump,
}: {
  attemptId?: string;
  entries: JavaHelp[];
  onJump?: (h: JavaHelp) => void;
}) {
  return (
    <>
      {entries.map((h) => (
        <article className="java-help-exchange" key={h.id}>
          <span className="reflection-speaker">You · Java reference</span>
          <CoachText>{h.question}</CoachText>
          <SavedCodeContext context={h.editor} />
          {h.answer ? (
            <>
              <span className="reflection-speaker">
                Java help{h.kind === "redirect" ? " · Coaching deferred" : ""}
              </span>
              <CoachText sources={h.research?.sources}>{h.answer}</CoachText>
              <ResearchSources research={h.research} />
              {attemptId && (
                <>
                  <AgentActivity
                    attemptId={attemptId}
                    feature="java-help"
                    traceId={h.research?.traceId}
                    subjectId={h.id}
                  />
                  <ReviewFlagButton
                    target={{ kind: "java-help", attemptId, messageId: h.id }}
                  />
                </>
              )}
              {!!h.sources?.length && !h.research && (
                <div className="java-help-sources">
                  {h.sources.map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Java documentation
                      {h.sources!.length > 1 ? ` ${i + 1}` : ""}
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="small">
              {onJump
                ? "No answer was delivered during this assessment."
                : h.state === "pending"
                  ? "Looking up the Java reference…"
                  : h.state === "failed"
                    ? "The lookup did not finish. Your question is saved."
                    : "Reply ready to open."}
            </p>
          )}
          {onJump && (
            <Button className="text-button" onClick={() => onJump(h)}>
              Jump to this lookup
            </Button>
          )}
        </article>
      ))}
    </>
  );
}
export default function JavaHelpChat({
  attemptId,
  initial,
  open,
  disabled,
  onRecord,
  onClose,
  editor,
}: {
  attemptId: string;
  initial: JavaHelp[];
  open: boolean;
  disabled: boolean;
  onRecord: RecordHelp;
  onClose: () => void;
  editor: EditorChatBinding;
}) {
  const [entries, setEntries] = useState(initial);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [localRequest, setLocalRequest] = useState<{
    id: string;
    question: string;
    seq?: number;
    editor?: JavaHelp["editor"];
  }>();
  const attemptedDelivery = useRef(new Set<string>());
  const delivery = useRef(false);
  const enabled = useRef(false);
  enabled.current = open && !disabled;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, editor.focusRequest]);
  const key = `duo-java-help-${attemptId}`;
  const remember = (value: typeof localRequest) => {
    setLocalRequest(value);
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch {}
  };
  const refresh = async () => {
    const r = await api(`/api/java-help?id=${attemptId}`);
    setEntries(r.help);
    return r.help as JavaHelp[];
  };
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved?.id && saved.question) setLocalRequest(saved);
    } catch {}
  }, [key]);
  useEffect(() => {
    if (!open) return;
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [open, attemptId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, entries.at(-1)?.deliveredAt]);
  const showReply = async (h: JavaHelp) => {
    if (!enabled.current || delivery.current) return;
    delivery.current = true;
    attemptedDelivery.current.add(h.id);
    try {
      const e = await onRecord(
        h.id,
        "response",
        "Java reference reply requested for display",
      );
      if (!enabled.current) return;
      const r = await api("/api/java-help", {
        action: "deliver",
        attemptId,
        id: h.id,
        seq: e.seq,
      });
      setEntries(r.help);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      delivery.current = false;
    }
  };
  useEffect(() => {
    const ready = entries.find(
      (h) =>
        h.state === "ready" &&
        !h.deliveredAt &&
        !attemptedDelivery.current.has(h.id),
    );
    if (ready && open && !disabled) void showReply(ready);
    if (
      localRequest &&
      entries.some((h) => h.id === localRequest.id && h.state === "ready")
    )
      remember(undefined);
  }, [entries, open, disabled]);
  const ask = async (retry?: JavaHelp) => {
    if (working || !enabled.current) return;
    let request = retry
      ? {
          id: retry.id,
          question: retry.question,
          seq: retry.requestSeq,
          editor: retry.editor,
        }
      : (localRequest ?? {
          id: crypto.randomUUID(),
          question: draft.trim(),
          seq: undefined,
          editor: undefined as JavaHelp["editor"],
        });
    if (!request.question) return;
    setWorking(true);
    setError("");
    remember(request);
    try {
      if (!request.seq) {
        const context = editor.context();
        const event = await onRecord(
          request.id,
          "request",
          `Java help: ${request.question.slice(0, 2800)}`,
        );
        request = {
          ...request,
          seq: event.seq,
          editor: { ...context, source: "recording", seq: event.seq },
        };
        remember(request);
      }
      if (!enabled.current) return;
      const response = await api("/api/java-help", {
        action: "ask",
        attemptId,
        ...request,
      });
      setEntries(response.help);
      setDraft("");
      editor.clear();
      remember(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => {});
    } finally {
      setWorking(false);
    }
  };
  const pending = entries.findLast((h) => h.state === "pending");
  const failed =
    entries.at(-1)?.state === "failed" ? entries.at(-1) : undefined;
  const ready = entries.find((h) => h.state === "ready" && !h.deliveredAt);
  return (
    <aside className="java-help-chat" aria-label="Java reference chat">
      <div className="reflection-chat-heading">
        <MessageCircle size={17} />
        <strong>Java help</strong>
        <Button
          className="icon-button"
          aria-label="Close Java help"
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>
      <p className="java-help-note">
        API and syntax reference · Timer keeps running. Questions and delivered
        replies are saved with this attempt.
      </p>
      <div className="java-help-messages">
        {!entries.length && (
          <div className="reflection-empty">
            <p>
              Ask about a Java API, import, syntax rule, or compiler message.
            </p>
            <small>
              Try “What does HashSet.add return?” Your cursor line and any
              attached selection are included.
            </small>
          </div>
        )}
        <JavaHelpLog attemptId={attemptId} entries={entries} />
        {working && (
          <AgentActivity
            attemptId={attemptId}
            feature="java-help"
            active
            subjectId={localRequest?.id ?? pending?.id}
          />
        )}
        <div ref={bottom} />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {ready && (
          <Button
            className="button secondary"
            disabled={disabled}
            onClick={() => void showReply(ready)}
          >
            Open reply
          </Button>
        )}
        {(pending || failed || localRequest) && !working && (
          <Button
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void ask(pending ?? (localRequest ? undefined : failed))
            }
          >
            Retry saved question
          </Button>
        )}
        {localRequest && !working && !pending && !ready && (
          <Button
            className="text-button"
            disabled={disabled}
            onClick={() => {
              remember(undefined);
              setDraft("");
              setError("");
            }}
          >
            Ask a different question
          </Button>
        )}
      </div>
      <form
        className="reflection-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <ChatCodeContext
          current={editor.current}
          selection={editor.selection}
          onAttach={() => editor.attach()}
          onRemove={editor.clear}
        />
        <Textarea
          ref={input}
          aria-label="Ask about Java"
          placeholder={
            disabled
              ? "Resume the timer to ask a question"
              : "Ask about Java APIs or syntax…"
          }
          value={draft}
          maxLength={5000}
          disabled={
            disabled || working || !!pending || !!localRequest || !!ready
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <div>
          <span>Enter to send · Shift+Enter for a new line</span>
          <Button
            type="submit"
            className="button primary"
            disabled={
              disabled ||
              working ||
              !draft.trim() ||
              !!pending ||
              !!localRequest ||
              !!ready
            }
          >
            <Send size={14} /> {working ? "Looking up…" : "Ask"}
          </Button>
        </div>
      </form>
    </aside>
  );
}
