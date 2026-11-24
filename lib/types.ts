import type { ResearchBundle } from "./research-types";
export type Phase = "active" | "paused" | "review" | "learn" | "complete";
export type Exposure = "new" | "revisit" | "solved" | "unknown";
export type Edit = { offset: number; length: number; text: string };
export type EditorSelection = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
};
export type EditorContextDraft = {
  file: "Solution.java";
  cursor: { line: number; column: number; lineText: string };
  selection?: EditorSelection;
};
export type EditorChatContext = EditorContextDraft & {
  source: "recording" | "coached";
  seq?: number;
};
export type EvidenceEvent = {
  seq: number;
  at: number;
  type:
    | "edit"
    | "focus"
    | "pause-activity"
    | "pause"
    | "resume"
    | "run"
    | "submit"
    | "assistance"
    | "finish"
    | "recover";
  edits?: Edit[];
  version?: number;
  origin?: string;
  detail?: string;
  jobId?: string;
  assistanceId?: string;
  assistanceStage?: "request" | "response";
};
export type JavaHelp = {
  research?: ResearchBundle;
  id: string;
  question: string;
  requestSeq: number;
  askedAt: number;
  state: "pending" | "ready" | "failed";
  answer?: string;
  kind?: "reference" | "clarification" | "redirect";
  topics?: string[];
  sources?: string[];
  model?: string;
  effort?: string;
  generatedAt?: number;
  deliveredAt?: number;
  responseSeq?: number;
  error?: string;
  editor?: EditorChatContext;
};
export type Problem = {
  questionId: string;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  content: string;
  javaStarter: string;
  exampleInputs: { raw: string };
  metadata?: {
    params?: { name: string; type: string }[];
    systemdesign?: boolean;
  } | null;
  topicTags?: { name: string }[];
  locked?: boolean;
};
export type JudgeJob = {
  id: string;
  kind: "run" | "submit";
  state: string;
  remoteId?: string | number;
  source: string;
  sourceSha256?: string;
  input?: string;
  seq: number;
  createdAt: number;
  result?: Record<string, unknown>;
  summary?: { verdict: string };
  url?: string;
  sourceVerification?: { matches: boolean; questionMatches: boolean };
  error?: string;
};
export type Finding = {
  skill: string;
  observation: string;
  evidence: number[];
  learnerEvidence?: { messageId: string; quote: string }[];
};
export type Moment = {
  seq: number;
  endSeq?: number | null;
  label: string;
  observation: string;
  interpretation: string;
  question: string;
  confidence: "low" | "medium" | "high";
};
export type Evaluation = {
  questionReview?: import("./question-review").QuestionReview;
  development?: import("./reflection-development").ReflectionDevelopment;
  research?: ResearchBundle;
  summary: string;
  strengths: Finding[];
  gaps: Finding[];
  moments: Moment[];
  exercise: { skill: string; title: string; prompt: string; rubric?: string };
  model?: string;
  effort?: string;
  version: string;
  createdAt: number;
  evidenceThrough: number;
  exposureRevision?: number;
};
export type Annotation = {
  id: string;
  seq: number;
  judgement: "agree" | "correct" | "unsure";
  comment: string;
  createdAt: number;
  interpretationVisible: boolean;
  interpretation?: string;
  evaluationRevision?: number;
};
export type Followup = {
  research?: ResearchBundle;
  evaluationRevision?: number;
  answer: string;
  answeredAt: number;
  feedback?: string;
  outcome?: "independent" | "partial" | "needs-practice" | "unassessed";
  next?: {
    title: string;
    slug: string;
    reason: string;
    revisitAt: number;
    research?: ResearchBundle;
  };
  coachedCode?: string;
  messages?: CoachingMessage[];
  plannedAfter?: string;
};
export type Understanding = {
  status: "sufficient" | "needs-evidence";
  summary: string;
  criteria: {
    concept: string;
    status: "demonstrated" | "open";
    evidence: { messageId: string; quote: string }[];
  }[];
  support: "independent" | "coached" | "unassessed";
};
export type CoachingMessage = {
  research?: ResearchBundle;
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  replyTo?: string;
  understanding?: Understanding;
  editor?: EditorChatContext;
};
export type ReplayFocus = {
  startSeq: number;
  endSeq: number;
  mode: "snapshot" | "range" | "loop";
  label: string;
  /** Exact recorded snapshot to inspect when pausing from the coach message. */
  pauseSeq?: number | null;
};
export type ReflectionCheck = {
  status: "open" | "explained" | "inferred" | "needs-practice";
  evidence: { messageId: string; quote: string }[];
  recordingEvidence?: number[];
  assessment?: string;
  uncertainty?: string | null;
};
export type ReflectionMessage = {
  research?: ResearchBundle;
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  replyTo?: string;
  focus?: ReplayFocus | null;
  status?: "exploring" | "ready";
  checks?: Record<
    "approach" | "timeComplexity" | "spaceComplexity",
    ReflectionCheck
  >;
  evaluationRevision?: number;
  kind?: "intake";
  editor?: EditorChatContext;
};
export type ReflectionIntake = {
  id: string;
  familiarity: "new" | "revisit" | "solved";
  spaceComplexity: string;
  timeComplexity: string;
  submittedAt: number;
};
export type LearningExit = {
  reason: "sufficient" | "skipped" | "manual";
  at: number;
};
export type WorkContinuation = {
  id: string;
  kind: "continuation";
  date: string;
  minutes?: number;
  note?: string;
  recordedAt: number;
};
export type WorkSegment =
  | {
      id: string;
      kind: "assessment";
      startedAt: number;
      endedAt: number | null;
      endReason?: "pause" | "assessment-ended";
    }
  | WorkContinuation;
export type Attempt = {
  id: string;
  /** Separates fresh coaching evidence after an explicit coaching reset. */
  evidenceEpoch?: string;
  problem: Problem;
  createdAt: number;
  budgetMs: number;
  deadline: number;
  phase: Phase;
  initialSource: string;
  source: string;
  version: number;
  lastSeq: number;
  pauses: {
    start: number;
    end?: number;
    reason?: "manual" | "window-blur" | "tab-hidden";
  }[];
  workSegments?: WorkSegment[];
  endedAt?: number;
  sealed?: boolean;
  exposure: Exposure;
  exposureSource?: "default" | "reported" | "remembered";
  exposureUpdatedAt?: number;
  events: EvidenceEvent[];
  checkpoints: { seq: number; source: string }[];
  jobs: JudgeJob[];
  evaluations: Evaluation[];
  annotations: Annotation[];
  followup?: Followup;
  javaHelp?: JavaHelp[];
  /** Private mid-session milestone notes; reused after sealing to accelerate review. */
  solvingChunks?: import("./solving-chunks").SolvingChunkNote[];
  demonstration?: boolean;
  learningExit?: LearningExit;
  previousLearningExits?: LearningExit[];
  reflection?: {
    /** Reviewed investigation checkpoint, retained if generating the reply fails. */
    questionReview?: import("./question-review").QuestionReview;
    /** Timestamp when reusable pre-intake question review finished without generating a draft reply. */
    preparedReviewAt?: number;
    messages: ReflectionMessage[];
    intake?: ReflectionIntake;
    /** Private preliminary analysis; never shown before the learner answers. */
    analysis?: Evaluation;
    /** Public readiness flag; analysis content stays on the server. */
    analysisReady?: boolean;
    /** Explicitly moving on while an optional optimization was offered. */
    optimizationDeferredAt?: number;
  };
};
export type AttemptSummary = Pick<
  Attempt,
  "id" | "createdAt" | "phase" | "budgetMs" | "endedAt" | "exposure"
> & {
  title: string;
  slug: string;
  difficulty: string;
  verdict: string;
  events: number;
  gap?: string;
  demonstration?: boolean;
};
