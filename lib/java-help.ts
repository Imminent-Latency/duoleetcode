import type { Attempt, JavaHelp, Moment } from "./types";
import { languageConfig } from "./languages";
export function publicJavaHelp(a: Attempt) {
  return (a.javaHelp ?? []).map((h) =>
    h.deliveredAt
      ? h
      : { ...h, answer: undefined, sources: undefined, research: undefined },
  );
}
export function referenceEvidence(a: Attempt) {
  return (a.javaHelp ?? []).map((h) => ({
    id: h.id,
    question: h.question,
    editor: h.editor,
    requestSeq: h.requestSeq,
    askedAt: h.askedAt,
    answer: h.deliveredAt ? h.answer : undefined,
    research: h.deliveredAt ? h.research : undefined,
    deliveredAt: h.deliveredAt,
    responseSeq: h.responseSeq,
    kind: h.kind,
    topics: h.topics,
    sources: h.deliveredAt ? h.sources : undefined,
    meaning: h.deliveredAt
      ? "Reference answer made available during the timed attempt. This does not prove it was read or applied."
      : "Question recorded; no answer was delivered during the assessment. Do not count this as assistance received.",
  }));
}
export function javaHelpMoments(a: Attempt): Moment[] {
  const label = languageConfig(a.language).helpLabel;
  return (a.javaHelp ?? []).map((h) => ({
    seq: h.requestSeq,
    endSeq: h.responseSeq ?? null,
    label,
    observation: `Asked: ${h.question.slice(0, 180)}${h.deliveredAt ? " · Answer delivered" : " · No answer delivered"}`,
    interpretation:
      "An API or syntax lookup alone does not establish a learning gap or use of a solution hint.",
    question: "",
    confidence: "high",
  }));
}
export type ReferenceAnswer = Pick<
  JavaHelp,
  "answer" | "kind" | "topics" | "sources" | "model" | "effort" | "research"
>;
