"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Checkbox, RangeSlider, Select, Slider, Tabs } from "@mantine/core";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Flag,
  Pause,
  Play,
  Repeat2,
  Send,
  Sparkles,
} from "lucide-react";
import { Button, Textarea } from "./ui";
import { SplitPane } from "./split-pane";
import CoachText from "./coach-text";
import ReviewFlagButton from "./review-flag";
import AgentActivity from "./agent-activity";
import ResearchSources from "./research-sources";
import { JavaHelpLog } from "./java-help";
import { ApproachContext, DevelopmentSummary } from "./reflection-development";
import QuestionReviewDetails from "./question-review-details";
import { useEditorChat } from "./use-editor-chat";
import { ChatCodeContext, SavedCodeContext } from "./chat-code-context";
import {
  TimelineInspectorCard,
  TimelineOverlayTrack,
  useAttemptReviewFlags,
} from "./timeline-markers";
import {
  buildTimelineProjection,
  type TimelineSelection,
} from "@/lib/timeline-markers";
import ReflectionIntakeForm from "./reflection-intake";
import { needsReflectionIntake } from "@/lib/reflection-intake";
import type { CoachRequest } from "./focused-learning";
import type { Attempt, ReplayFocus } from "@/lib/types";
import { replay } from "@/lib/recording";
import { pauseMetadata, solvingTime } from "@/lib/assessment-time";
import {
  focusTimes,
  coachReplayState,
  replayPauseSequence,
  latestReflection,
  pendingReflection,
  playbackPosition,
  recordingDuration,
  reflectionReady,
  timeAtSequence,
} from "@/lib/reflection";
const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
const time = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;

export default function ReflectionWorkspace({
  attempt: a,
  busy,
  onAgent,
  onMutate,
  onHome,
  onLearn,
  onError,
}: {
  attempt: Attempt;
  busy: boolean;
  onAgent: (
    action: "evaluate" | "coach" | "reflect" | "prepare",
    message?: CoachRequest,
  ) => Promise<boolean>;
  onMutate: (body: unknown) => Promise<void>;
  onHome: () => void;
  onLearn: () => void;
  onError: (error: unknown) => void;
}) {
  const total = recordingDuration(a);
  const pauses = pauseMetadata(a);
  const eventTimes = useMemo(
    () =>
      a.events.map((e) => ({ seq: e.seq, elapsedMs: solvingTime(a, e.at) })),
    [a.events, a.pauses, a.endedAt],
  );
  const [playhead, setPlayhead] = useState(total);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(a.lastSeq);
  const [range, setRange] = useState<[number, number]>([0, total]);
  const [playing, setPlaying] = useState(false);
  const [playbackEpoch, setPlaybackEpoch] = useState(0);
  const [focusOwner, setFocusOwner] = useState<string>();
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState("2");
  const [diff, setDiff] = useState(false);
  const [follow, setFollow] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [tab, setTab] = useState<string | null>("conversation");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [savingIntake, setSavingIntake] = useState(false);
  const [focused, setFocused] = useState<ReplayFocus | null>(null);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string>();
  const started = useRef(new Set<string>());
  const followed = useRef<string | undefined>(undefined);
  const request = useRef<CoachRequest | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const last = latestReflection(a);
  const pending = pendingReflection(a);
  const messages = a.reflection?.messages ?? [];
  const ready = reflectionReady(a);
  const closed = a.phase === "complete";
  const needsIntake = needsReflectionIntake(a);
  const intakeActive = needsIntake && !closed;
  const preparing = !last && !a.reflection?.analysisReady;
  const waitingJudge = a.jobs.some((j) =>
    ["sending", "judging"].includes(j.state),
  );
  // Legacy reports remain preserved, but are not presented as the new reflection.
  const evaluation = last
    ? a.evaluations[last.evaluationRevision ?? a.evaluations.length - 1]
    : undefined;
  const reviewFlags = useAttemptReviewFlags(a.id);
  const timeline = useMemo(
    () => buildTimelineProjection(a, evaluation, reviewFlags),
    [a, evaluation, reviewFlags],
  );
  const selectedTimelineItem = useMemo(
    () => timeline.chronologicalItems.find((x) => x.id === selectedTimelineId),
    [timeline.chronologicalItems, selectedTimelineId],
  );
  const seq =
    selectedSeq ??
    eventTimes.findLast((e) => e.elapsedMs <= playhead)?.seq ??
    0;
  const code = useMemo(() => replay(a, seq), [a, seq]);
  const chatEditor = useEditorChat(code);
  useEffect(() => {
    if (chatEditor.focusRequest) input.current?.focus();
  }, [chatEditor.focusRequest]);
  const compareSeq =
    focused && focused.endSeq > focused.startSeq
      ? focused.startSeq
      : Math.max(0, seq - 1);
  const event = a.events.find((e) => e.seq === seq);
  const editedLine = event?.edits?.length
    ? code.slice(0, Math.min(code.length, event.edits[0].offset)).split("\n")
        .length
    : undefined;
  const safe = (fn: () => Promise<void>) => void fn().catch(onError);
  const seek = (at: number) => {
    setPlayhead(at);
    setSelectedSeq(null);
  };
  const showFocus = (focus: ReplayFocus, autoplay = true, owner?: string) => {
    const state = coachReplayState(a, focus);
    const [start, end] = state.range;
    setFocused(focus);
    setFocusOwner(owner);
    setSelectedTimelineId(undefined);
    setDiff(false);
    setPlaybackEpoch((n) => n + 1);
    setSelectedSeq(autoplay ? state.seq : focus.startSeq);
    setPlayhead(autoplay ? state.at : start);
    if (focus.startSeq !== focus.endSeq) {
      setRange([start, end]);
      setLoop(autoplay && state.loop);
      setPlaying(autoplay && state.playing);
    } else {
      setRange([0, total]);
      setLoop(false);
      setPlaying(false);
    }
  };
  const jumpToSeq = (targetSeq: number) => {
    const bounded = Math.max(0, Math.min(a.lastSeq, targetSeq));
    setPlaying(false);
    setDiff(false);
    setSelectedSeq(bounded);
    setPlayhead(timeAtSequence(a, bounded));
  };
  const selectTimelineItem = (item: TimelineSelection) => {
    const hasSpan = item.endSeq > item.startSeq;
    const focus: ReplayFocus = {
      startSeq: item.startSeq,
      endSeq: item.endSeq,
      pauseSeq: item.pauseSeq ?? null,
      mode: hasSpan ? "range" : "snapshot",
      label: item.label,
    };
    showFocus(focus, false);
    if (hasSpan) {
      const inspectSeq = item.pauseSeq ?? item.endSeq;
      setSelectedSeq(inspectSeq);
      setPlayhead(timeAtSequence(a, inspectSeq));
    }
    setSelectedTimelineId(item.id);
  };
  const pauseAtFocus = (focus: ReplayFocus) => {
    const seq = replayPauseSequence(a, focus);
    setPlaying(false);
    setDiff(false);
    setSelectedSeq(seq);
    setPlayhead(timeAtSequence(a, seq));
  };
  const isPlayingFocus = (id: string, focus: ReplayFocus) => {
    const [start, end] = focusTimes(a, focus);
    return (
      playing && focusOwner === id && range[0] === start && range[1] === end
    );
  };
  const canReplayFocus = (focus: ReplayFocus) =>
    coachReplayState(a, focus).playing;
  useEffect(() => {
    try {
      setFollow(localStorage.getItem("duo-reflection-follow") !== "false");
    } catch {}
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    if (busy || waitingJudge || closed || last) return;
    const action = preparing
      ? "prepare"
      : a.reflection?.intake
        ? "reflect"
        : undefined;
    if (!action || started.current.has(action)) return;
    started.current.add(action);
    void onAgent(action);
  }, [
    busy,
    waitingJudge,
    closed,
    last,
    preparing,
    a.reflection?.intake,
    onAgent,
  ]);
  useEffect(() => {
    if (
      !preferencesReady ||
      !follow ||
      !last?.focus ||
      followed.current === last.id
    )
      return;
    followed.current = last.id;
    showFocus(last.focus, true, last.id);
  }, [last?.id, follow, preferencesReady]);
  useEffect(() => {
    if (request.current && messages.some((m) => m.id === request.current!.id)) {
      setDraft("");
      request.current = undefined;
    }
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  useEffect(() => {
    if (!playing) return;
    const began = performance.now(),
      from = playhead;
    const timer = setInterval(() => {
      const next = playbackPosition(
        from,
        (performance.now() - began) * Number(speed),
        range[0],
        range[1],
        loop,
      );
      seek(next.at);
      if (!next.playing) setPlaying(false);
    }, 50);
    return () => clearInterval(timer);
  }, [playing, range[0], range[1], loop, speed, playbackEpoch]);
  const send = async (text = draft) => {
    if (!text.trim() || busy || sending || pending || closed) return;
    let context;
    try {
      context = chatEditor.context();
    } catch (e) {
      onError(e);
      return;
    }
    setPlaying(false);
    const message =
      request.current?.text === text.trim()
        ? request.current
        : {
            id: crypto.randomUUID(),
            text: text.trim(),
            editor: { ...context, source: "recording" as const, seq },
            focus: {
              startSeq: seq,
              endSeq: seq,
              mode: "snapshot" as const,
              label: "Learner's selected moment",
            },
          };
    request.current = message;
    setSending(true);
    try {
      if (await onAgent("reflect", message)) {
        setDraft("");
        chatEditor.clear();
        request.current = undefined;
      }
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };
  return (
    <section className="reflection-workspace" aria-label="Attempt reflection">
      <header className="reflection-toolbar">
        <Button
          className="icon-button"
          aria-label="Back to today"
          onClick={onHome}
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <strong>{a.problem.title}</strong>
          <span>
            {intakeActive ? "Initial reflection" : "Reflection"}
            {a.demonstration ? " · Demonstration" : ""}
          </span>
        </div>
        <div className="reflection-toolbar-actions">
          <Button
            className="button secondary"
            disabled={intakeActive || busy || !a.evaluations.length}
            onClick={onLearn}
          >
            Focused practice <ArrowRight size={14} />
          </Button>
          <Button
            className={ready ? "button primary" : "button secondary"}
            disabled={intakeActive && savingIntake}
            onClick={() =>
              safe(async () => {
                setPlaying(false);
                if (!closed) await onMutate({ action: "complete" });
                onHome();
              })
            }
          >
            {closed
              ? "Back to today"
              : ready
                ? "Move on"
                : messages.some((m) => m.role === "user")
                  ? "Move on anytime"
                  : "Skip reflection"}
          </Button>
        </div>
      </header>
      <SplitPane
        storageKey="duo-reflection-split"
        initial={65}
        label={
          intakeActive
            ? "Resize solution and reflection form"
            : "Resize replay and conversation"
        }
        first={
          <div className="reflection-recording">
            <div className="reflection-editor-heading">
              <Code2 size={16} />
              <strong>Solution.java</strong>
              <span>Recorded solution</span>
              <Button
                className={diff ? "toggle active" : "toggle"}
                onClick={() => {
                  setPlaying(false);
                  if (!diff && focused && focused.endSeq > focused.startSeq) {
                    setSelectedSeq(focused.endSeq);
                    setPlayhead(timeAtSequence(a, focused.endSeq));
                  }
                  setDiff(!diff);
                }}
              >
                {diff ? "Show code" : "Compare changes"}
              </Button>
            </div>
            {focused && (
              <div className="reflection-focus" role="status">
                <Flag size={14} />
                <span>{focused.label}</span>
                <small>
                  {time(timeAtSequence(a, focused.startSeq))}
                  {focused.startSeq !== focused.endSeq
                    ? "–" + time(timeAtSequence(a, focused.endSeq))
                    : ""}
                </small>
              </div>
            )}
            {selectedTimelineItem && (
              <TimelineInspectorCard
                attempt={a}
                item={selectedTimelineItem}
                items={timeline.chronologicalItems}
                diffActive={diff}
                formatTime={time}
                onSelectItem={selectTimelineItem}
                onJumpSeq={jumpToSeq}
                onToggleDiff={() => {
                  setPlaying(false);
                  if (!diff && selectedTimelineItem.endSeq > selectedTimelineItem.startSeq) {
                    setSelectedSeq(selectedTimelineItem.endSeq);
                    setPlayhead(timeAtSequence(a, selectedTimelineItem.endSeq));
                  }
                  setDiff(!diff);
                }}
                onReplayRange={(focus) => {
                  const keepId = selectedTimelineItem.id;
                  showFocus(focus, true, keepId);
                  setSelectedTimelineId(keepId);
                }}
                onClose={() => setSelectedTimelineId(undefined)}
              />
            )}
            <div className="reflection-editor">
              <CodeEditor
                value={code}
                reviewTarget={{ attemptId: a.id, source: "recording", seq }}
                selectionResetKey={playbackEpoch}
                readOnly
                onContextChange={(context) => {
                  chatEditor.onChange(context);
                  if (context.selection) setPlaying(false);
                }}
                onAskHelp={(context) => {
                  setPlaying(false);
                  setTab("conversation");
                  chatEditor.requestHelp(context);
                }}
                helpDisabled={
                  intakeActive || closed || busy || sending || !!pending
                }
                revealLine={editedLine}
                diffFrom={diff ? replay(a, compareSeq) : undefined}
              />
            </div>
            <div className="reflection-timeline">
              <div className="reflection-transport">
                <Button
                  className="icon-button"
                  aria-label={playing ? "Pause replay" : "Play replay"}
                  title={
                    playing
                      ? "Pause at the current replay position"
                      : "Continue from the current position"
                  }
                  onClick={() => {
                    if (!playing) setPlaybackEpoch((n) => n + 1);
                    if (
                      !playing &&
                      (playhead >= range[1] || playhead < range[0])
                    )
                      seek(range[0]);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </Button>
                <strong>
                  {time(playhead)} <span>/ {time(total)} solving</span>
                </strong>
                <Button
                  className={loop ? "toggle active" : "toggle"}
                  aria-pressed={loop}
                  onClick={() => setLoop(!loop)}
                >
                  <Repeat2 size={15} /> Loop
                </Button>
                <Select
                  aria-label="Replay speed"
                  value={speed}
                  onChange={(v) => setSpeed(v ?? "1")}
                  data={["1", "2", "4", "8"].map((value) => ({
                    value,
                    label: value + "×",
                  }))}
                  allowDeselect={false}
                  w={78}
                />
                <span className="reflection-event">
                  {seq === 0
                    ? "Initial source"
                    : seq === a.lastSeq
                      ? "Final source"
                      : event?.type}
                </span>
              </div>
              <Slider
                aria-label="Recording playhead"
                thumbLabel="Recording playhead"
                min={0}
                max={total}
                step={1}
                value={playhead}
                onChange={(value) => {
                  setPlaying(false);
                  seek(value);
                }}
                label={time}
              />
              <TimelineOverlayTrack
                projection={timeline}
                playheadPct={total > 0 ? (playhead / total) * 100 : 0}
                selectedId={selectedTimelineId}
                onSelect={selectTimelineItem}
                formatTime={time}
              />
              <div className="reflection-range-label">
                <span>
                  Replay range · {time(range[0])}–{time(range[1])}
                </span>
                <Button
                  className="text-button"
                  onClick={() => {
                    setPlaying(false);
                    setRange([Math.min(playhead, range[1]), range[1]]);
                  }}
                >
                  Set start here
                </Button>
                <Button
                  className="text-button"
                  onClick={() => {
                    setPlaying(false);
                    setRange([range[0], Math.max(playhead, range[0])]);
                  }}
                >
                  Set end here
                </Button>
                <Button
                  className="text-button"
                  onClick={() => {
                    setPlaying(false);
                    setRange([0, total]);
                    setFocused(null);
                    setSelectedTimelineId(undefined);
                  }}
                >
                  Full recording
                </Button>
              </div>
              <RangeSlider
                aria-label="Replay range"
                thumbFromLabel="Replay start"
                thumbToLabel="Replay end"
                min={0}
                max={total}
                step={1}
                minRange={1}
                value={range}
                label={time}
                onChange={(value) => {
                  setPlaying(false);
                  setRange(value);
                }}
              />
              {pauses.length > 0 && (
                <details className="reflection-pauses">
                  <summary>
                    {pauses.length} {pauses.length === 1 ? "pause" : "pauses"} ·{" "}
                    {time(pauses.reduce((total, p) => total + p.durationMs, 0))}{" "}
                    excluded from replay
                  </summary>
                  {pauses.map((pause) => (
                    <details key={pause.index}>
                      <summary>
                        At {time(pause.elapsedMs)} · paused for{" "}
                        {time(pause.durationMs)} ·{" "}
                        {pause.reason === "manual"
                          ? "Manual pause"
                          : "Left the window"}{" "}
                        · {pause.activity.length} observations
                      </summary>
                      <ul>
                        {pause.activity.map((event) => (
                          <li key={event.seq}>
                            +{time(event.afterPauseMs)} into pause ·{" "}
                            {event.detail}
                          </li>
                        ))}
                      </ul>
                      {!pause.activity.length && (
                        <p>No page activity was recorded during this pause.</p>
                      )}
                    </details>
                  ))}
                </details>
              )}
            </div>
          </div>
        }
        second={
          intakeActive ? (
            <ReflectionIntakeForm
              attempt={a}
              analyzing={busy || waitingJudge}
              onSave={async (body) => {
                setSavingIntake(true);
                try {
                  await onMutate(body);
                } finally {
                  setSavingIntake(false);
                }
              }}
              onRetry={() => {
                if (!busy && !waitingJudge) void onAgent("prepare");
              }}
              onError={onError}
            />
          ) : (
            <aside className="reflection-chat" aria-label="Reflection coach">
              <div className="reflection-chat-heading">
                <Sparkles size={17} />
                <strong>Think it through</strong>
                <Checkbox
                  label="Follow coach"
                  checked={follow}
                  onChange={(e) => {
                    setFollow(e.currentTarget.checked);
                    try {
                      localStorage.setItem(
                        "duo-reflection-follow",
                        String(e.currentTarget.checked),
                      );
                    } catch {}
                  }}
                />
              </div>
              <Tabs value={tab} onChange={setTab} className="reflection-tabs">
                <Tabs.List>
                  <Tabs.Tab value="conversation">Conversation</Tabs.Tab>
                  <Tabs.Tab value="takeaways">Takeaways</Tabs.Tab>
                  {!!a.javaHelp?.length && (
                    <Tabs.Tab value="java-help">
                      Java help · {a.javaHelp.length}
                    </Tabs.Tab>
                  )}
                </Tabs.List>
                <Tabs.Panel
                  value="conversation"
                  className="reflection-conversation"
                >
                  <div className="reflection-messages">
                    {a.reflection?.intake ? (
                      <details className="reflection-familiarity">
                        <summary>Your initial reflection</summary>
                        <CoachText>
                          {messages.find((m) => m.kind === "intake")?.text ??
                            ""}
                        </CoachText>
                        <small>Add any corrections in the conversation.</small>
                      </details>
                    ) : (
                      <div className="reflection-familiarity">
                        <strong>Did you recognize this problem?</strong>
                        <div>
                          {(
                            [
                              { value: "new", label: "New to me" },
                              { value: "revisit", label: "Seen before" },
                              { value: "solved", label: "Solved before" },
                            ] as const
                          ).map((option) => (
                            <Button
                              key={option.value}
                              className={
                                "button " +
                                (a.exposure === option.value
                                  ? "primary"
                                  : "secondary")
                              }
                              aria-pressed={a.exposure === option.value}
                              onClick={() =>
                                safe(() =>
                                  onMutate({
                                    action: "exposure",
                                    exposure: option.value,
                                  }),
                                )
                              }
                            >
                              {option.label}
                            </Button>
                          ))}
                        </div>
                        <small>
                          {a.exposureSource === "reported"
                            ? "Saved. You can change this anytime."
                            : "Treated as new unless you tell us otherwise."}
                        </small>
                      </div>
                    )}
                    {!messages.length && (
                      <div className="reflection-empty">
                        <Sparkles size={22} />
                        <h3>
                          {busy
                            ? "Reading your attempt…"
                            : waitingJudge
                              ? "Waiting for the judge…"
                              : closed
                                ? "Your recording is here."
                                : "Let’s look at your attempt."}
                        </h3>
                        <p>
                          You can explore the recording while the coach finds
                          moments worth discussing.
                        </p>
                        {!busy && !waitingJudge && !closed && (
                          <Button
                            className="button secondary"
                            onClick={() => onAgent("reflect")}
                          >
                            Start reflection
                          </Button>
                        )}
                      </div>
                    )}
                    {messages
                      .filter((m) => m.kind !== "intake")
                      .map((m) => (
                        <article
                          className={"reflection-message " + m.role}
                          key={m.id}
                        >
                          <span className="reflection-speaker">
                            {m.role === "user" ? "You" : "Coach"}
                          </span>
                          <CoachText sources={m.research?.sources}>
                            {m.text}
                          </CoachText>
                          <ResearchSources research={m.research} />
                          {m.role === "assistant" && (
                            <>
                              <AgentActivity
                                attemptId={a.id}
                                feature="reflection"
                                traceId={m.research?.traceId}
                              />
                              <ReviewFlagButton
                                target={{
                                  kind: "reflection",
                                  attemptId: a.id,
                                  messageId: m.id,
                                }}
                              />
                            </>
                          )}
                          <SavedCodeContext context={m.editor} />
                          {m.role === "assistant" && (
                            <ApproachContext
                              attempt={a}
                              development={
                                a.evaluations[m.evaluationRevision ?? -1]
                                  ?.development
                              }
                              onFocus={(focus) => showFocus(focus, true, m.id)}
                            />
                          )}
                          {m.role === "assistant" && m.focus && (
                            <Button
                              className="button secondary"
                              title={
                                isPlayingFocus(m.id, m.focus)
                                  ? `Pause at ${time(timeAtSequence(a, replayPauseSequence(a, m.focus)))} · Key moment for this question`
                                  : canReplayFocus(m.focus)
                                    ? "Loop this region of your recording"
                                    : "Show this recorded snapshot"
                              }
                              onClick={() =>
                                isPlayingFocus(m.id, m.focus!)
                                  ? pauseAtFocus(m.focus!)
                                  : showFocus(m.focus!, true, m.id)
                              }
                            >
                              {isPlayingFocus(m.id, m.focus) ? (
                                <Pause size={13} />
                              ) : (
                                <Play size={13} />
                              )}
                              {!canReplayFocus(m.focus)
                                ? "Show this moment"
                                : isPlayingFocus(m.id, m.focus)
                                  ? "Pause at key moment"
                                  : "Replay this range"}
                            </Button>
                          )}
                        </article>
                      ))}
                    {(busy || pending) && (
                      <AgentActivity
                        attemptId={a.id}
                        feature="reflection"
                        active={busy}
                      />
                    )}
                    {!busy && pending && (
                      <div className="reflection-retry">
                        <p>
                          Your answers are saved.{" "}
                          {preparing
                            ? "Recording analysis is still pending."
                            : "The reply is still pending."}
                        </p>
                        <Button
                          className="button secondary"
                          onClick={() =>
                            onAgent(preparing ? "prepare" : "reflect")
                          }
                        >
                          {preparing ? "Retry analysis" : "Retry reply"}
                        </Button>
                      </div>
                    )}
                    {ready && (
                      <div className="reflection-ready">
                        <Check size={16} /> Enough context for this debrief.
                        Move on or keep talking.
                      </div>
                    )}
                    {ready &&
                      !closed &&
                      evaluation?.development?.optimization.status ===
                        "offered" &&
                      (a.reflection?.optimizationDeferredAt ?? 0) <
                        (last?.createdAt ?? 0) && (
                        <div
                          className="reflection-optimization"
                          aria-label="Optional optimization"
                        >
                          <p>
                            Your baseline is established. Explore an improvement
                            now, or leave it for future practice.
                          </p>
                          <div className="reflection-choice-actions">
                            <Button
                              className="button secondary"
                              disabled={busy || sending || !!pending}
                              onClick={() =>
                                void send(
                                  "I'd like a hint for the optional optimization.",
                                )
                              }
                            >
                              Give me a hint
                            </Button>
                            <Button
                              className="button secondary"
                              disabled={busy || sending || !!pending}
                              onClick={() =>
                                void send(
                                  "Please explain the optional optimization with a small visual example.",
                                )
                              }
                            >
                              Show an explanation
                            </Button>
                            <Button
                              className="button primary"
                              disabled={busy || sending || !!pending}
                              onClick={() =>
                                safe(() =>
                                  onMutate({
                                    action: "complete",
                                    reason: "sufficient",
                                  }),
                                )
                              }
                            >
                              Move on · revisit later
                            </Button>
                          </div>
                        </div>
                      )}
                    <div ref={bottom} />
                  </div>
                  {closed ? (
                    <div className="reflection-composer">
                      <p>This reflection is saved.</p>
                      <Button
                        className="button secondary"
                        onClick={() =>
                          safe(async () => {
                            started.current.clear();
                            await onMutate({ action: "reflect" });
                          })
                        }
                      >
                        Continue reflection
                      </Button>
                    </div>
                  ) : (
                    <form
                      className="reflection-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <span className="small">
                        Looking at {time(playhead)} · Your answer or a question
                      </span>
                      <ChatCodeContext
                        current={chatEditor.current}
                        selection={chatEditor.selection}
                        onAttach={() => {
                          setPlaying(false);
                          chatEditor.attach();
                        }}
                        onRemove={chatEditor.clear}
                      />
                      <Textarea
                        ref={input}
                        aria-label="Message the reflection coach"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Explain your thinking, correct an interpretation, or ask a question…"
                        disabled={busy || sending || !!pending}
                        rows={3}
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
                        <small>
                          Enter to send · Shift+Enter for a new line
                        </small>
                        <Button
                          className="button primary"
                          type="submit"
                          disabled={
                            busy || sending || !!pending || !draft.trim()
                          }
                        >
                          <Send size={15} /> Send
                        </Button>
                      </div>
                    </form>
                  )}
                </Tabs.Panel>
                <Tabs.Panel value="java-help" className="reflection-takeaways">
                  <p className="small">
                    Reference questions and delivered answers from your
                    assessment. Delivery does not establish that an answer was
                    read or used.
                  </p>
                  <JavaHelpLog
                    attemptId={a.id}
                    entries={a.javaHelp ?? []}
                    onJump={(h) =>
                      showFocus(
                        {
                          startSeq: h.requestSeq,
                          endSeq: h.responseSeq ?? h.requestSeq,
                          mode: h.responseSeq ? "range" : "snapshot",
                          label: "Java reference lookup",
                        },
                        false,
                      )
                    }
                  />
                </Tabs.Panel>
                <Tabs.Panel value="takeaways" className="reflection-takeaways">
                  {evaluation ? (
                    <>
                      <CoachText sources={evaluation.research?.sources}>
                        {evaluation.summary}
                      </CoachText>
                      <ResearchSources research={evaluation.research} />
                      {evaluation.questionReview && (
                        <details className="diagnostic-event">
                          <summary>
                            Inspect the question and evidence review
                          </summary>
                          <QuestionReviewDetails
                            review={evaluation.questionReview}
                          />
                        </details>
                      )}
                      <DevelopmentSummary
                        attempt={a}
                        development={evaluation.development}
                        onFocus={(focus) => showFocus(focus)}
                        onCorrect={(text) => {
                          setDraft(text);
                          setTab("conversation");
                          input.current?.focus();
                        }}
                      />
                      <ReviewFlagButton
                        target={{
                          kind: "evaluation",
                          attemptId: a.id,
                          createdAt: evaluation.createdAt,
                        }}
                      />
                      <h3>What you demonstrated</h3>
                      {evaluation.strengths.map((f, i) => (
                        <div key={i} className="reflection-takeaway">
                          <strong>{f.skill}</strong>
                          <CoachText>{f.observation}</CoachText>
                        </div>
                      ))}
                      <h3>
                        {evaluation.gaps.length
                          ? "Worth practicing"
                          : "No learning gap established"}
                      </h3>
                      {evaluation.gaps.map((f, i) => (
                        <div key={i} className="reflection-takeaway">
                          <strong>{f.skill}</strong>
                          <CoachText>{f.observation}</CoachText>
                        </div>
                      ))}
                      <h3>Still to discuss</h3>
                      {Object.entries(last?.checks ?? {})
                        .filter(([, c]) => c.status === "open")
                        .map(([key]) => (
                          <p key={key}>
                            {key === "approach"
                              ? "Approach and trade-offs"
                              : key === "timeComplexity"
                                ? "Time complexity"
                                : "Space complexity"}
                          </p>
                        ))}
                      {ready && <p>We have enough context to move on.</p>}
                      <p className="small">
                        These takeaways update as you add context. One attempt
                        does not establish lasting mastery.
                      </p>
                    </>
                  ) : (
                    <p>
                      The coach will summarize what the attempt shows here.
                      Unanswered questions will guide the conversation.
                    </p>
                  )}
                </Tabs.Panel>
              </Tabs>
            </aside>
          )
        }
      />
    </section>
  );
}
