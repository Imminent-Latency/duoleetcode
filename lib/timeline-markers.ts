import { solvingTime } from "./assessment-time";
import { candidateMoments } from "./recording";
import { recordingDuration, timeAtSequence } from "./reflection";
import type { AttemptReviewFlag } from "./review-flag-types";
import type { CaptureSignal, SolvingChunkNote } from "./solving-chunks";
import type {
  Attempt,
  EditorChatContext,
  Evaluation,
  Moment,
  ReplayFocus,
} from "./types";

export type LinkedQuestionVerdict = {
  id: string;
  topic: string;
  kind: string;
  priority: "high" | "medium" | "low";
  question: string;
  purpose: string;
  decision: "accept" | "qualify" | "reject" | "needs-evidence";
  classification:
    | "observed"
    | "supported-inference"
    | "plausible"
    | "unresolved"
    | "contradicted";
  coachingRole?: string;
  disposition: string;
  missingEvidence?: string;
  answer: string;
  uncertainty: string | null;
  sequences: number[];
  askedInChat: boolean;
  surfacedInChat: boolean;
  analystTraceId?: string;
  judgeTraceId?: string;
};

export type LinkedApproachStage = {
  id: string;
  label: string;
  origin: "recorded" | "learner-proposed" | "coach-introduced";
  observation: string;
  intentStatus: string;
  intentStatement: string;
  isBaseline: boolean;
  isActive: boolean;
  focus: ReplayFocus | null;
};

export type TimelineWindowItem = {
  itemType: "window";
  id: string;
  kind: "solving-window" | "approach-window";
  index: number;
  shortLabel: string;
  label: string;
  startSeq: number;
  endSeq: number;
  pauseSeq?: number | null;
  startMs: number;
  endMs: number;
  capturedAtMs?: number;
  leftPct: number;
  widthPct: number;
  displayWidthPct: number;
  signal?: CaptureSignal;
  captureContext?: string;
  summary: string;
  observations: SolvingChunkNote["observations"];
  candidateQuestions: SolvingChunkNote["candidateQuestions"];
  sources: NonNullable<SolvingChunkNote["sources"]>;
  model?: string;
  effort?: string;
  traceId?: string;
  intentStatus?: string;
  intentStatement?: string;
  isBaseline?: boolean;
  linkedQuestions: LinkedQuestionVerdict[];
  linkedApproaches: LinkedApproachStage[];
};

export type TimelineFlagItem = {
  itemType: "flag";
  id: string;
  kind:
    | "coach-moment"
    | "heuristic-moment"
    | "java-help"
    | "review-flag"
    | "annotation";
  label: string;
  badgeLabel: string;
  startSeq: number;
  endSeq: number;
  pauseSeq?: number | null;
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
  row: 0 | 1;
  confidence?: Moment["confidence"];
  observation: string;
  interpretation?: string;
  question?: string;
  javaHelp?: {
    id: string;
    question: string;
    delivered: boolean;
    answerKind?: string;
    topics: string[];
    sources: string[];
    editor?: EditorChatContext;
    model?: string;
    effort?: string;
    traceId?: string;
  };
  reviewFlag?: {
    flagId: string;
    status: "open" | "resolved";
    category: string;
    note: string;
    targetKind: AttemptReviewFlag["kind"];
    createdAt: number;
    editor?: EditorChatContext | null;
    traceState: AttemptReviewFlag["traceState"];
    traceCount: number;
    traceId?: string;
  };
  annotation?: {
    annotationId: string;
    judgement: "agree" | "correct" | "unsure";
    comment: string;
    interpretation?: string;
  };
  linkedQuestions: LinkedQuestionVerdict[];
  linkedApproaches: LinkedApproachStage[];
};

export type TimelineSelection = TimelineWindowItem | TimelineFlagItem;

export type TimelineProjection = {
  totalMs: number;
  windows: TimelineWindowItem[];
  flags: TimelineFlagItem[];
  chronologicalItems: TimelineSelection[];
};

export function formatSignalLabel(signal: CaptureSignal): string {
  switch (signal) {
    case "replaced-block":
      return "Replaced block";
    case "example-run":
      return "Example run";
    case "judge-submit":
      return "Judge submit";
    case "quiet-interval":
      return "Quiet interval";
    case "pause-boundary":
      return "Pause boundary";
  }
}

function pct(ms: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.max(0, Math.min(100, (ms / totalMs) * 100));
}

function spanGeometry(startMs: number, endMs: number, totalMs: number, minWidthPct = 2) {
  if (totalMs <= 0) {
    return { leftPct: 0, widthPct: 100, displayWidthPct: 100 };
  }
  const rawLeft = pct(startMs, totalMs);
  const rawRight = Math.max(rawLeft, pct(endMs, totalMs));
  const widthPct = Math.max(0, rawRight - rawLeft);
  const displayWidthPct = Math.min(100, Math.max(widthPct, minWidthPct));
  const leftPct =
    rawLeft + displayWidthPct > 100
      ? Math.max(0, 100 - displayWidthPct)
      : rawLeft;
  return { leftPct, widthPct, displayWidthPct };
}

function extractQuestionVerdicts(evaluation?: Evaluation): {
  verdict: LinkedQuestionVerdict;
  allSeqs: Set<number>;
  assistanceIds: Set<string>;
}[] {
  const entries = evaluation?.questionReview?.questions ?? [];
  return entries.map((entry) => {
    const seqs = new Set<number>([
      ...entry.question.anchors.sequences,
      ...entry.candidate.supporting.sequences,
      ...entry.verdict.supporting.sequences,
    ]);
    const assistanceIds = new Set<string>([
      ...entry.question.anchors.assistanceIds,
      ...entry.candidate.supporting.assistanceIds,
      ...entry.verdict.supporting.assistanceIds,
    ]);
    return {
      verdict: {
        id: entry.question.id,
        topic: entry.question.topic,
        kind: entry.question.kind,
        priority: entry.question.priority,
        question: entry.question.question,
        purpose: entry.question.purpose,
        decision: entry.verdict.decision,
        classification: entry.verdict.classification,
        coachingRole: entry.verdict.coachingRole,
        disposition: entry.verdict.disposition,
        missingEvidence: entry.verdict.missingEvidence,
        answer: entry.verdict.answer,
        uncertainty: entry.verdict.uncertainty,
        sequences: [...seqs].sort((a, b) => a - b),
        askedInChat: entry.askedMessageIds.length > 0,
        surfacedInChat: (entry.surfacedMessageIds?.length ?? 0) > 0,
        analystTraceId: entry.analystTraceId,
        judgeTraceId: entry.judgeTraceId,
      },
      allSeqs: seqs,
      assistanceIds,
    };
  });
}

function extractApproachStages(evaluation?: Evaluation): LinkedApproachStage[] {
  const dev = evaluation?.development;
  if (!dev) return [];
  return dev.approaches.map((app) => ({
    id: app.id,
    label: app.label,
    origin: app.origin,
    observation: app.observation,
    intentStatus: app.intent.status,
    intentStatement: app.intent.statement,
    isBaseline: dev.baselineApproachId === app.id,
    isActive: dev.activeApproachId === app.id,
    focus: app.focus,
  }));
}

function overlapsRange(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  inclusiveStart = true,
): boolean {
  const loA = Math.min(aStart, aEnd);
  const hiA = Math.max(aStart, aEnd);
  const loB = Math.min(bStart, bEnd);
  const hiB = Math.max(bStart, bEnd);
  if (!inclusiveStart && loA < hiA) {
    return hiB > loA && loB <= hiA;
  }
  return loB <= hiA && hiB >= loA;
}

export function buildTimelineProjection(
  attempt: Attempt,
  evaluation?: Evaluation,
  reviewFlags: AttemptReviewFlag[] = [],
): TimelineProjection {
  const totalMs = recordingDuration(attempt);
  const verdicts = extractQuestionVerdicts(evaluation);
  const approaches = extractApproachStages(evaluation);

  const matchVerdictsForRange = (
    startSeq: number,
    endSeq: number,
    exclusiveStart = false,
    assistanceId?: string,
  ): LinkedQuestionVerdict[] =>
    verdicts
      .filter(({ allSeqs, assistanceIds }) => {
        if (assistanceId && assistanceIds.has(assistanceId)) return true;
        for (const s of allSeqs) {
          if (s === 0 && endSeq >= attempt.lastSeq && attempt.lastSeq > 0) {
            return true;
          }
          if (exclusiveStart && startSeq < endSeq) {
            if (s > startSeq && s <= endSeq) return true;
          } else if (s >= startSeq && s <= endSeq) {
            return true;
          }
        }
        return false;
      })
      .map((x) => x.verdict);

  const matchApproachesForRange = (
    startSeq: number,
    endSeq: number,
    exclusiveStart = false,
  ): LinkedApproachStage[] =>
    approaches.filter(
      (app) =>
        app.focus &&
        overlapsRange(
          startSeq,
          endSeq,
          app.focus.startSeq,
          app.focus.endSeq,
          !exclusiveStart,
        ),
    );

  // 1. Windowed analysis items: background solving chunks + recorded approach spans
  const solvingWindows: TimelineWindowItem[] = (attempt.solvingChunks ?? []).map(
    (chunk, idx) => {
      const startMs =
        chunk.startSeq <= 0 ? 0 : timeAtSequence(attempt, chunk.startSeq);
      const rawEndMs = timeAtSequence(attempt, chunk.endSeq);
      const endMs = Math.max(startMs, rawEndMs);
      const geom = spanGeometry(startMs, endMs, totalMs, 2.4);
      const sig = formatSignalLabel(chunk.signal);
      return {
        itemType: "window",
        id: `solving-window-${chunk.id}`,
        kind: "solving-window",
        index: idx + 1,
        shortLabel: `W${idx + 1}`,
        label: `W${idx + 1} · ${sig}`,
        startSeq: chunk.startSeq,
        endSeq: chunk.endSeq,
        startMs,
        endMs,
        capturedAtMs: chunk.elapsedMs,
        ...geom,
        signal: chunk.signal,
        captureContext: chunk.captureContext,
        summary: chunk.summary,
        observations: chunk.observations,
        candidateQuestions: chunk.candidateQuestions,
        sources: chunk.sources ?? [],
        model: chunk.model,
        effort: chunk.effort,
        traceId: chunk.traceId,
        linkedQuestions: matchVerdictsForRange(
          chunk.startSeq,
          chunk.endSeq,
          true,
        ),
        linkedApproaches: matchApproachesForRange(
          chunk.startSeq,
          chunk.endSeq,
          true,
        ),
      };
    },
  );

  const approachWindows: TimelineWindowItem[] = approaches
    .filter(
      (app) =>
        app.origin === "recorded" &&
        app.focus &&
        app.focus.endSeq > app.focus.startSeq,
    )
    .map((app, idx) => {
      const focus = app.focus!;
      const startMs =
        focus.startSeq <= 0 ? 0 : timeAtSequence(attempt, focus.startSeq);
      const endMs = Math.max(startMs, timeAtSequence(attempt, focus.endSeq));
      const geom = spanGeometry(startMs, endMs, totalMs, 2.4);
      return {
        itemType: "window",
        id: `approach-window-${app.id}`,
        kind: "approach-window",
        index: idx + 1,
        shortLabel: `A${idx + 1}`,
        label: `Approach · ${app.label}`,
        startSeq: focus.startSeq,
        endSeq: focus.endSeq,
        pauseSeq: focus.pauseSeq,
        startMs,
        endMs,
        ...geom,
        summary: app.observation,
        observations: [],
        candidateQuestions: [],
        sources: [],
        intentStatus: app.intentStatus,
        intentStatement: app.intentStatement,
        isBaseline: app.isBaseline,
        linkedQuestions: matchVerdictsForRange(focus.startSeq, focus.endSeq),
        linkedApproaches: [app],
      };
    });

  const windows = [...solvingWindows, ...approachWindows];

  // 2. Flagged items: coach/heuristic moments + Java help + user ReviewFlags + annotations
  const rawFlags: Omit<TimelineFlagItem, "row">[] = [];

  const hasEvaluatedMoments = Boolean(evaluation?.moments);
  const baseMoments =
    evaluation?.moments ?? candidateMoments(attempt.events, attempt);
  const seenMoments = new Set<string>();
  baseMoments.forEach((m, index) => {
    const dedupKey = `${m.seq}:${m.endSeq ?? m.seq}:${m.label}`;
    if (seenMoments.has(dedupKey)) return;
    seenMoments.add(dedupKey);
    const startSeq = m.seq;
    const endSeq = m.endSeq ?? m.seq;
    const startMs = timeAtSequence(attempt, startSeq);
    const endMs = Math.max(startMs, timeAtSequence(attempt, endSeq));
    const geom = spanGeometry(startMs, endMs, totalMs, 0);
    rawFlags.push({
      itemType: "flag",
      id: `moment-${index}-${m.seq}`,
      kind: hasEvaluatedMoments ? "coach-moment" : "heuristic-moment",
      label: m.label,
      badgeLabel: hasEvaluatedMoments
        ? "Assessed moment"
        : "Heuristic candidate",
      startSeq,
      endSeq,
      startMs,
      endMs,
      leftPct: pct(startMs, totalMs),
      widthPct: geom.widthPct,
      confidence: m.confidence,
      observation: m.observation,
      interpretation: m.interpretation,
      question: m.question || undefined,
      linkedQuestions: matchVerdictsForRange(startSeq, endSeq),
      linkedApproaches: matchApproachesForRange(startSeq, endSeq),
    });
  });

  (attempt.javaHelp ?? []).forEach((h) => {
    const startSeq = h.requestSeq;
    const endSeq = h.responseSeq ?? h.requestSeq;
    const startMs = timeAtSequence(attempt, startSeq);
    const endMs = Math.max(startMs, timeAtSequence(attempt, endSeq));
    const geom = spanGeometry(startMs, endMs, totalMs, 0);
    const label = h.topics?.length
      ? `Java help · ${h.topics[0]}`
      : "Java help";
    rawFlags.push({
      itemType: "flag",
      id: `java-help-${h.id}`,
      kind: "java-help",
      label,
      badgeLabel: h.deliveredAt ? "Java help · delivered" : "Java help · asked",
      startSeq,
      endSeq,
      startMs,
      endMs,
      leftPct: pct(startMs, totalMs),
      widthPct: geom.widthPct,
      confidence: "high",
      observation: `Asked: “${h.question}”`,
      interpretation: h.deliveredAt
        ? "Reference answer was made available during active solving. An API/syntax lookup is never automatically scored as a learning gap or proof that the answer was applied."
        : "Question was submitted, but no answer was delivered during active solving. Excluded from assistance received.",
      javaHelp: {
        id: h.id,
        question: h.question,
        delivered: Boolean(h.deliveredAt),
        answerKind: h.kind,
        topics: h.topics ?? [],
        sources: h.sources ?? [],
        editor: h.editor,
        model: h.model,
        effort: h.effort,
        traceId: h.research?.traceId,
      },
      linkedQuestions: matchVerdictsForRange(startSeq, endSeq, false, h.id),
      linkedApproaches: matchApproachesForRange(startSeq, endSeq),
    });
  });

  reviewFlags.forEach((f) => {
    let startSeq = attempt.lastSeq;
    let endSeq = attempt.lastSeq;
    let pauseSeq: number | null | undefined = undefined;
    let startMs = totalMs;
    let endMs = totalMs;

    if (f.focus) {
      startSeq = f.focus.startSeq;
      endSeq = f.focus.endSeq;
      pauseSeq = f.focus.pauseSeq;
      startMs = timeAtSequence(attempt, startSeq);
      endMs = Math.max(startMs, timeAtSequence(attempt, endSeq));
    } else if (f.editor?.seq !== undefined) {
      startSeq = f.editor.seq;
      endSeq = f.editor.seq;
      startMs = timeAtSequence(attempt, startSeq);
      endMs = startMs;
    } else if (f.kind === "java-help" && f.messageId) {
      const help = attempt.javaHelp?.find((h) => h.id === f.messageId);
      if (help) {
        startSeq = help.requestSeq;
        endSeq = help.responseSeq ?? help.requestSeq;
        startMs = timeAtSequence(attempt, startSeq);
        endMs = Math.max(startMs, timeAtSequence(attempt, endSeq));
      }
    } else if (f.kind === "reflection" && f.messageId) {
      const msg = attempt.reflection?.messages.find((m) => m.id === f.messageId);
      if (msg?.focus) {
        startSeq = msg.focus.startSeq;
        endSeq = msg.focus.endSeq;
        pauseSeq = msg.focus.pauseSeq;
        startMs = timeAtSequence(attempt, startSeq);
        endMs = Math.max(startMs, timeAtSequence(attempt, endSeq));
      }
    } else if (f.kind === "evaluation" && f.evaluationCreatedAt !== undefined) {
      const ev = attempt.evaluations.find(
        (e) => e.createdAt === f.evaluationCreatedAt,
      );
      if (ev) {
        startSeq = ev.evidenceThrough;
        endSeq = ev.evidenceThrough;
        startMs = timeAtSequence(attempt, startSeq);
        endMs = startMs;
      }
    } else {
      const clampedMs = Math.max(
        0,
        Math.min(totalMs, solvingTime(attempt, f.createdAt)),
      );
      const nearest = attempt.events.findLast((e) => e.at <= f.createdAt);
      startSeq = nearest?.seq ?? (clampedMs === 0 ? 0 : attempt.lastSeq);
      endSeq = startSeq;
      startMs = clampedMs;
      endMs = clampedMs;
    }

    const geom = spanGeometry(startMs, endMs, totalMs, 0);
    rawFlags.push({
      itemType: "flag",
      id: `review-flag-${f.id}`,
      kind: "review-flag",
      label: `Flag · ${f.category}`,
      badgeLabel: `Review flag · ${f.status === "resolved" ? "Reviewed" : "Open"}`,
      startSeq,
      endSeq,
      pauseSeq,
      startMs,
      endMs,
      leftPct: pct(startMs, totalMs),
      widthPct: geom.widthPct,
      observation: f.note || `Flagged ${f.kind} (${f.category}) without an extra note.`,
      interpretation:
        "Product/developer review flag with preserved snapshot and trace bundle. Never alters coach memory or learner skill evidence.",
      reviewFlag: {
        flagId: f.id,
        status: f.status,
        category: f.category,
        note: f.note,
        targetKind: f.kind,
        createdAt: f.createdAt,
        editor: f.editor,
        traceState: f.traceState,
        traceCount: f.traceCount,
        traceId: f.traceId,
      },
      linkedQuestions: matchVerdictsForRange(startSeq, endSeq),
      linkedApproaches: matchApproachesForRange(startSeq, endSeq),
    });
  });

  (attempt.annotations ?? []).forEach((n) => {
    const atMs = timeAtSequence(attempt, n.seq);
    rawFlags.push({
      itemType: "flag",
      id: `annotation-${n.id}`,
      kind: "annotation",
      label: `Note · ${n.judgement}`,
      badgeLabel: `Learner note · ${n.judgement}`,
      startSeq: n.seq,
      endSeq: n.seq,
      startMs: atMs,
      endMs: atMs,
      leftPct: pct(atMs, totalMs),
      widthPct: 0,
      observation: n.comment || `Marked moment as “${n.judgement}”.`,
      interpretation: n.interpretation,
      annotation: {
        annotationId: n.id,
        judgement: n.judgement,
        comment: n.comment,
        interpretation: n.interpretation,
      },
      linkedQuestions: matchVerdictsForRange(n.seq, n.seq),
      linkedApproaches: matchApproachesForRange(n.seq, n.seq),
    });
  });

  rawFlags.sort((a, b) => a.startMs - b.startMs || a.startSeq - b.startSeq);

  // Stagger closely-spaced pins across 2 rows so adjacent flags remain easy to hover/click.
  let lastRow0Pct = -100;
  const flags: TimelineFlagItem[] = rawFlags.map((item) => {
    let row: 0 | 1 = 0;
    if (Math.abs(item.leftPct - lastRow0Pct) < 2.8) {
      row = 1;
    } else {
      lastRow0Pct = item.leftPct;
    }
    return { ...item, row };
  });

  const chronologicalItems: TimelineSelection[] = [...windows, ...flags].sort(
    (a, b) => a.startMs - b.startMs || a.startSeq - b.startSeq,
  );

  return {
    totalMs,
    windows,
    flags,
    chronologicalItems,
  };
}
