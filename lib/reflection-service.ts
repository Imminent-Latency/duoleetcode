import { reflectionPolicyVersion } from "./reflection-policy";
import { randomUUID } from "node:crypto";
import {
  sameEditorContext,
  validateEditorContext,
  editorContextSchema,
} from "./editor-context";
import type { AttemptStore } from "./store";
import type { Attempt, ReplayFocus } from "./types";
import type { QuestionReview } from "./question-review";
import { reflectionIntakeSchema, intakeMessage } from "./reflection-intake";
import { kickoffBackgroundRatingDrain } from "./rating-worker";
import {
  pendingReflection,
  validateReflection,
  validateReplayFocus,
  type ReflectionResult,
} from "./reflection";

type ReflectionRunner = (
  a: Attempt,
  saveReview?: (review: QuestionReview) => void,
) => Promise<{
  result: ReflectionResult;
  model: string;
  effort?: string;
  research?: import("./research-types").ResearchBundle;
}>;

function checkpointReview(db: AttemptStore, a: Attempt) {
  const session = a.previousLearningExits?.length ?? 0;
  return (review: QuestionReview) => {
    const latest = db.get(a.id);
    if (
      latest.phase !== a.phase ||
      (latest.previousLearningExits?.length ?? 0) !== session
    )
      return;
    latest.reflection ??= { messages: [] };
    latest.reflection.questionReview = structuredClone(review);
    db.save(latest);
  };
}

export type CheckInMode = "continue" | "defer" | "skip-coaching";

export function saveReflectionIntake(
  db: AttemptStore,
  id: string,
  input: unknown,
  now = Date.now(),
  mode: CheckInMode = "continue",
) {
  const answer = reflectionIntakeSchema.parse(input);
  const updated = db.transaction(() => {
    const a = db.get(id);
    if (a.phase !== "review" || !a.sealed)
      throw new Error(
        "Finish and save the assessment before answering reflection questions.",
      );
    a.reflection ??= { messages: [] };
    const previous = a.reflection.intake;
    if (previous) {
      if (
        previous.id === answer.id &&
        previous.familiarity === answer.familiarity &&
        previous.spaceComplexity === answer.spaceComplexity &&
        previous.timeComplexity === answer.timeComplexity
      ) {
        if (mode === "defer") a.reflection.coachingDeferred = true;
        else if (mode === "skip-coaching") {
          a.reflection.coachingDeferred = false;
          a.phase = "complete";
          a.learningExit = { reason: "skipped", at: now };
        } else {
          a.reflection.coachingDeferred = false;
        }
        db.save(a);
        return a;
      }
      throw new Error(
        "Your initial reflection is already saved. Add corrections in the conversation.",
      );
    }
    if (a.reflection.messages.length)
      throw new Error(
        "This conversation has already started. Add your context in the chat.",
      );
    a.reflection.intake = { ...answer, submittedAt: now };
    a.reflection.coachingDeferred = mode === "defer";
    a.exposure = answer.familiarity;
    a.exposureSource = "reported";
    a.exposureUpdatedAt = now;
    a.reflection.messages.push({
      id: answer.id,
      role: "user",
      kind: "intake",
      text: intakeMessage(answer),
      createdAt: now,
    });
    if (mode === "skip-coaching") {
      a.phase = "complete";
      a.learningExit = { reason: "skipped", at: now };
    }
    db.save(a);
    if (!a.demonstration) db.ratings.enqueueRatingJob(a.id, now);
    return a;
  });
  kickoffBackgroundRatingDrain(db);
  return updated;
}

export function skipReflectionCheckIn(
  db: AttemptStore,
  id: string,
  familiarity: "new" | "revisit" | "solved",
  now = Date.now(),
) {
  if (!["new", "revisit", "solved"].includes(familiarity)) {
    throw new Error("Choose your prior familiarity before skipping check-in.");
  }
  const updated = db.transaction(() => {
    const a = db.get(id);
    if (a.phase !== "review" || !a.sealed) {
      throw new Error("Finish and save the assessment before settling check-in.");
    }
    a.reflection ??= { messages: [] };
    if (a.reflection.intake) {
      a.reflection.coachingDeferred = false;
      a.phase = "complete";
      a.learningExit = { reason: "skipped", at: now };
      db.save(a);
      if (!a.demonstration) db.ratings.enqueueRatingJob(a.id, now);
      return a;
    }
    a.reflection.checkInSkippedAt = now;
    a.reflection.coachingDeferred = false;
    a.exposure = familiarity;
    a.exposureSource = "reported";
    a.exposureUpdatedAt = now;
    a.phase = "complete";
    a.learningExit = { reason: "skipped", at: now };
    db.save(a);
    if (!a.demonstration) db.ratings.enqueueRatingJob(a.id, now);
    return a;
  });
  kickoffBackgroundRatingDrain(db);
  return updated;
}

export async function prepareReflection(
  db: AttemptStore,
  id: string,
  run: ReflectionRunner,
) {
  let a = db.get(id);
  if (a.phase !== "review" || !a.sealed)
    throw new Error("Finish and save the assessment first.");
  if (
    a.reflection?.analysis ||
    a.reflection?.messages.some((m) => m.role === "assistant")
  )
    return;
  const session = a.previousLearningExits?.length ?? 0;
  // Preparation is independent of answers that may arrive while it runs.
  const observed = {
    ...a,
    reflection: { messages: [], questionReview: a.reflection?.questionReview },
  };
  const {
    result: raw,
    model,
    effort,
    research,
  } = await run(observed, checkpointReview(db, a));
  const result = validateReflection(observed, raw);
  a = db.get(id);
  if (
    a.phase !== "review" ||
    (a.previousLearningExits?.length ?? 0) !== session
  )
    return;
  a.reflection ??= { messages: [] };
  a.reflection.analysis ??= {
    ...result.evaluation,
    model,
    effort,
    research,
    version: `${reflectionPolicyVersion}-preparation`,
    createdAt: Date.now(),
    evidenceThrough: a.lastSeq,
    exposureRevision: observed.exposureUpdatedAt ?? 0,
  };
  // Merge into the latest record so concurrent intake submissions are preserved.
  db.save(a);
}

export async function prepareReflectionReview(
  db: AttemptStore,
  id: string,
  runReview: (
    a: Attempt,
    saveReview?: (review: QuestionReview) => void,
  ) => Promise<{ review: QuestionReview; model: string; effort?: string }>,
) {
  let a = db.get(id);
  if (a.phase !== "review" || !a.sealed)
    throw new Error("Finish and save the assessment first.");
  if (
    a.reflection?.analysis ||
    a.reflection?.preparedReviewAt ||
    a.reflection?.messages.some((m) => m.role === "assistant")
  )
    return;
  const session = a.previousLearningExits?.length ?? 0;
  // Reusable evidence & question review runs while the learner fills out the intake form,
  // without generating a throwaway Coach reply before their answers exist.
  const observed = {
    ...a,
    reflection: { messages: [], questionReview: a.reflection?.questionReview },
  };
  const { review } = await runReview(observed, checkpointReview(db, a));
  a = db.get(id);
  if (
    a.phase !== "review" ||
    (a.previousLearningExits?.length ?? 0) !== session
  )
    return;
  a.reflection ??= { messages: [] };
  a.reflection.questionReview = structuredClone(review);
  a.reflection.preparedReviewAt = Date.now();
  db.save(a);
}

export async function continueReflection(
  db: AttemptStore,
  id: string,
  reflect: ReflectionRunner,
  message?: {
    id: string;
    text: string;
    focus?: ReplayFocus;
    editor?: import("./types").EditorChatContext;
  },
) {
  let a = db.get(id);
  if (!["review", "learn"].includes(a.phase) || !a.sealed)
    throw new Error("Open reflection after finishing the assessment.");
  a.reflection ??= { messages: [] };
  a.reflection.coachingDeferred = false;
  const phase = a.phase;
  const session = a.previousLearningExits?.length ?? 0;
  if (message) {
    message = {
      ...message,
      editor: message.editor
        ? editorContextSchema.parse(message.editor)
        : undefined,
    };
    if (message.focus) validateReplayFocus(a, message.focus);
    const existing = a.reflection.messages.find((m) => m.id === message!.id);
    if (existing) {
      if (
        existing.role !== "user" ||
        existing.text !== message.text ||
        !sameEditorContext(existing.editor, message.editor)
      )
        throw new Error("A saved message cannot be replaced.");
    } else {
      validateEditorContext(a, message.editor);
      if (pendingReflection(a))
        throw new Error(
          "Retry the pending reflection before sending another message.",
        );
      a.reflection.messages.push({
        ...message,
        role: "user",
        createdAt: Date.now(),
      });
    }
  }
  db.save(a);
  const replyTo = message?.id ?? pendingReflection(a)?.id ?? "opening";
  if (
    a.reflection.messages.some(
      (m) => m.role === "assistant" && m.replyTo === replyTo,
    )
  )
    return;
  const {
    result: raw,
    model,
    effort,
    research,
  } = await reflect(a, checkpointReview(db, a));
  const result = validateReflection(a, raw);
  const responseId = randomUUID();
  for (const entry of result.evaluation.questionReview?.questions ?? []) {
    if (result.askedQuestionIds?.includes(entry.question.id))
      entry.askedMessageIds.push(responseId);
    if (result.surfacedQuestionIds?.includes(entry.question.id)) {
      entry.surfacedMessageIds ??= [];
      entry.surfacedMessageIds.push(responseId);
    }
  }
  const exposureRevision = a.exposureUpdatedAt ?? 0;
  a = db.get(id);
  if (a.phase !== phase || (a.previousLearningExits?.length ?? 0) !== session)
    return;
  if (result.evaluation.questionReview)
    a.reflection!.questionReview = structuredClone(
      result.evaluation.questionReview,
    );
  a.evaluations.push({
    ...result.evaluation,
    model,
    research,
    version: reflectionPolicyVersion,
    effort,
    createdAt: Date.now(),
    evidenceThrough: a.lastSeq,
    exposureRevision,
  });
  a.reflection!.messages.push({
    id: responseId,
    role: "assistant",
    text: result.message,
    createdAt: Date.now(),
    replyTo,
    focus: result.focus,
    status: result.status,
    checks: result.checks,
    research,
    evaluationRevision: a.evaluations.length - 1,
  });
  db.save(a);
}
