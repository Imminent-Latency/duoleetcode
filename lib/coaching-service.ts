import { randomUUID } from "node:crypto";
import {
  sameEditorContext,
  validateEditorContext,
  editorContextSchema,
} from "./editor-context";
import type { AttemptStore } from "./store";
import type { Attempt, Followup } from "./types";
import {
  FIRST_RESPONSE,
  latestCoaching,
  pendingCoaching,
  readyToMoveOn,
  validateUnderstanding,
  type CoachingResult,
} from "./coaching";

type Dependencies = {
  coach: (a: Attempt) => Promise<CoachingResult>;
  plan?: (
    a: Attempt,
    history: Attempt[],
  ) => Promise<NonNullable<Followup["next"]>>;
};
// The route owns the attempt lock. Persist each user turn before calling the
// model so a failed response can be retried after a refresh without losing it.
export async function continueCoaching(
  db: AttemptStore,
  id: string,
  deps: Dependencies,
  message?: {
    id: string;
    text: string;
    editor?: import("./types").EditorChatContext;
  },
) {
  let a = db.get(id);
  if (a.phase !== "learn" || !a.sealed || !a.followup)
    throw new Error(
      "Preserve your first response in focused practice before coaching.",
    );
  a.followup.messages ??= [];
  const sessionRevision = a.previousLearningExits?.length ?? 0;
  if (message) {
    message = {
      ...message,
      editor: message.editor
        ? editorContextSchema.parse(message.editor)
        : undefined,
    };
    const existing = a.followup.messages.find((m) => m.id === message!.id);
    if (existing) {
      if (
        existing.role !== "user" ||
        existing.text !== message.text ||
        !sameEditorContext(existing.editor, message.editor)
      )
        throw new Error("A saved message cannot be replaced.");
    } else {
      validateEditorContext(a, message.editor);
      if (pendingCoaching(a))
        throw new Error(
          "Retry the pending reply before sending another message.",
        );
      if (!a.followup.feedback && !latestCoaching(a))
        throw new Error(
          "Get feedback on your first response before continuing the conversation.",
        );
      a.followup.messages.push({
        ...message,
        role: "user",
        createdAt: Date.now(),
      });
      db.save(a);
    }
  }
  const replyTo = message?.id ?? pendingCoaching(a)?.id ?? FIRST_RESPONSE;
  if (
    !a.followup.messages.some(
      (m) => m.role === "assistant" && m.replyTo === replyTo,
    )
  ) {
    const result = await deps.coach(a);
    const understanding = validateUnderstanding(a, result);
    a = db.get(id);
    // Moving on is immediate, even while a model call is in flight.
    if (
      a.phase !== "learn" ||
      (a.previousLearningExits?.length ?? 0) !== sessionRevision
    )
      return;
    const followup = a.followup!;
    if (!followup.feedback) {
      followup.feedback = result.feedback;
      followup.research = result.research;
      followup.outcome = result.outcome;
    }
    (followup.messages ??= []).push({
      id: randomUUID(),
      role: "assistant",
      text: result.feedback,
      replyTo,
      createdAt: Date.now(),
      understanding,
      research: result.research,
    });
    db.save(a);
  }
  const revision = latestCoaching(a)?.id;
  if (deps.plan && readyToMoveOn(a) && a.followup!.plannedAfter !== revision) {
    const next = await deps.plan(a, db.history());
    a = db.get(id);
    if (
      a.phase !== "learn" ||
      latestCoaching(a)?.id !== revision ||
      (a.previousLearningExits?.length ?? 0) !== sessionRevision
    )
      return;
    a.followup!.next = next;
    a.followup!.plannedAfter = revision;
    db.save(a);
  }
}
