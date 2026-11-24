import type { AttemptStore } from "./store";
import type { Attempt, EditorChatContext } from "./types";
import { sameEditorContext, validateEditorContext } from "./editor-context";
import type { ReferenceAnswer } from "./java-help";
function active(a: Attempt, now: number) {
  if (a.phase !== "active" || a.sealed || now >= a.deadline)
    throw new Error(
      "Java help is available while the assessment timer is running.",
    );
}
function event(
  a: Attempt,
  id: string,
  seq: number,
  stage: "request" | "response",
) {
  const e = a.events.find((e) => e.seq === seq);
  if (
    !e ||
    e.type !== "assistance" ||
    e.assistanceId !== id ||
    e.assistanceStage !== stage ||
    a.pauses.some((p) => e.at >= p.start && e.at < (p.end ?? Infinity))
  )
    throw new Error(
      "The help request must be linked to a saved recording event.",
    );
  return e;
}
export async function askJavaHelp(
  db: AttemptStore,
  id: string,
  input: {
    id: string;
    question: string;
    seq: number;
    editor?: EditorChatContext;
  },
  run: (
    question: string,
    history: {
      question: string;
      answer?: string;
      editor?: EditorChatContext;
    }[],
    editor?: EditorChatContext,
  ) => Promise<ReferenceAnswer>,
  now = Date.now(),
) {
  let a = db.get(id, now);
  const editor = validateEditorContext(a, input.editor, input.seq);
  const existing = a.javaHelp?.find((h) => h.id === input.id);
  if (
    existing &&
    (existing.question !== input.question ||
      existing.requestSeq !== input.seq ||
      !sameEditorContext(existing.editor, editor))
  )
    throw new Error("A saved help request cannot be replaced.");
  if (existing?.state === "ready") return;
  active(a, now);
  const anchor = event(a, input.id, input.seq, "request");
  if (
    a.javaHelp?.some(
      (h) =>
        h.id !== input.id &&
        (h.state === "pending" || (h.state === "ready" && !h.deliveredAt)),
    )
  )
    throw new Error("Wait for the previous reference reply first.");
  const help = existing ?? {
    id: input.id,
    question: input.question,
    requestSeq: input.seq,
    askedAt: anchor.at,
    state: "pending" as const,
    editor,
  };
  help.state = "pending";
  delete help.error;
  a.javaHelp ??= [];
  if (!existing) a.javaHelp.push(help);
  db.save(a);
  try {
    const response = await run(
      input.question,
      a.javaHelp
        .filter((h) => h.id !== input.id && h.deliveredAt)
        .map((h) => ({
          question: h.question,
          answer: h.answer,
          editor: h.editor,
        })),
      editor,
    );
    a = db.get(id);
    Object.assign(
      a.javaHelp!.find((h) => h.id === input.id)!,
      response,
      { state: "ready", generatedAt: Date.now() },
    );
    db.save(a);
  } catch (e) {
    a = db.get(id);
    Object.assign(
      a.javaHelp!.find((h) => h.id === input.id)!,
      {
        state: "failed",
        error: e instanceof Error ? e.message : "Reference lookup failed",
      },
    );
    db.save(a);
    throw e;
  }
}
export function deliverJavaHelp(
  db: AttemptStore,
  id: string,
  helpId: string,
  seq: number,
  now = Date.now(),
) {
  return db.transaction(() => {
    const a = db.get(id, now);
    const help = a.javaHelp?.find((h) => h.id === helpId);
    if (!help || help.state !== "ready")
      throw new Error("The reference reply is not ready.");
    if (help.deliveredAt) return a;
    active(a, now);
    const anchor = event(a, helpId, seq, "response");
    if (seq <= help.requestSeq || anchor.at + 5000 < (help.generatedAt ?? 0))
      throw new Error(
        "The reply marker must follow generation of the reference answer.",
      );
    help.deliveredAt = now;
    help.responseSeq = seq;
    db.save(a);
    return a;
  });
}
