import { z } from "zod";
import type { Attempt } from "./types";

const citation = z.object({
  messageId: z.string(),
  quote: z.string().min(1).max(3000),
});
const key = z.string().min(1).max(80);
const focus = z.object({
  startSeq: z.number().int().nonnegative(),
  endSeq: z.number().int().nonnegative(),
  mode: z.enum(["snapshot", "range", "loop"]),
  label: z.string().min(1).max(160),
  pauseSeq: z.number().int().nonnegative().nullable(),
});

// A compact, inspectable evidence summary, never private model reasoning.
export const reflectionDevelopmentSchema = z.object({
  approaches: z
    .array(
      z.object({
        id: key,
        label: z.string().min(1).max(120),
        origin: z.enum(["recorded", "learner-proposed", "coach-introduced"]),
        observation: z.string().min(1).max(900),
        focus: focus.nullable(),
        assistanceIds: z.array(z.string()).max(8),
        learnerEvidence: z.array(citation).max(4),
        intent: z.object({
          status: z.enum(["unknown", "hypothesis", "confirmed", "corrected"]),
          statement: z.string().min(1).max(600),
          evidence: z.array(citation).max(4),
        }),
      }),
    )
    .max(6),
  baselineApproachId: key.nullable(),
  activeApproachId: key.nullable(),
  // Required only when genuinely contradicting an already established baseline.
  baselineCorrection: z
    .array(citation)
    .max(4)
    .describe(
      "Empty unless new learner evidence contradicts a previously ready baseline. Establishing or repairing a baseline for the first time is not a baselineCorrection.",
    ),
  optimization: z.object({
    status: z.enum([
      "not-discussed",
      "offered",
      "exploring",
      "deferred",
      "explained",
      "demonstrated",
    ]),
    approachId: key.nullable(),
  }),
  revisits: z
    .array(
      z.object({
        id: key,
        approachId: key.nullable(),
        skill: z.string().min(1).max(140),
        reason: z.string().min(1).max(900),
        kind: z.enum([
          "correctness",
          "implementation",
          "independent-recall",
          "optimization",
        ]),
        status: z.enum(["open", "resolved", "dismissed"]),
        evidence: z.array(z.number().int().nonnegative()).max(8),
        learnerEvidence: z.array(citation).max(4),
      }),
    )
    .max(6),
});
export type ReflectionDevelopment = z.infer<typeof reflectionDevelopmentSchema>;

const approach = reflectionDevelopmentSchema.shape.approaches.element;
const intent = approach.shape.intent;
const constrainedApproach = approach.extend({
  intent: z.union([
    intent.extend({ status: z.enum(["unknown", "hypothesis"]) }),
    intent.extend({
      status: z.enum(["confirmed", "corrected"]),
      evidence: z.array(citation).min(1).max(4),
    }),
  ]),
});
export const reflectionDevelopmentOutputSchema =
  reflectionDevelopmentSchema.extend({
    approaches: z
      .array(
        z.union([
          constrainedApproach.extend({ origin: z.literal("recorded"), focus }),
          constrainedApproach.extend({
            origin: z.literal("learner-proposed"),
            learnerEvidence: z.array(citation).min(1).max(4),
          }),
          constrainedApproach.extend({ origin: z.literal("coach-introduced") }),
        ]),
      )
      .max(6),
  });

export function latestDevelopment(a: Attempt) {
  return a.evaluations.findLast((e) => e.development)?.development;
}

export const developmentPolicy = `Maintain evaluation.development as a concise evidence summary, not a reasoning transcript. Use stable approach and revisit IDs across turns. Reconstruct only meaningful stages from implementationEvidence, delivered javaAssistance, inspected snapshots, reviewed worth-sharing findings and learner messages. An approach observation describes concrete technical behavior—including what each representation preserved, lost (e.g. duplicate-key overwrites) or cost according to verified findings—while intent separately states an unknown, hypothesis, confirmed explanation or learner correction. Confirmed/corrected intent requires literal learner citations. A temporal association between a question and an edit suggests a question, never causation. Link relevant assistanceIds; their timestamps and editor context let you distinguish reference learning from algorithm reasoning. Do not call API lookups deficits.

Before evaluating an ambiguous strategy, resolve its purpose when that would change the feedback: what was sorting intended to accomplish, what should the replacement improve, which constraints must remain true? Ask ONE neutral question and focus the relevant recording. In an opening debrief with an unexplained strategy transition, ask about that decision BEFORE asking how the final unfinished loop would work. For example, a heapify-runtime lookup while sorting was present, followed by record/comparator lookups and a heap rewrite, calls for the original sorting goal or intended benefit of switching; don't start by quizzing the learner about a temporary queue. Choose one of those decisions, not both at once. Prefer the significant decision to minor syntax or a tour of edits. Skip questions already answered by the intake, code and learner explanations together. Use the learner's answer to correct hypotheses. Preserve relevant earlier stages, corrections and outstanding revisit targets, rather than silently replacing them with the final snapshot. Keep the record small (up to six stages/targets); it is not a checklist.

When the learner proposes a different approach, add a learner-proposed stage and clarify what moves, repeats or stops BEFORE evaluating it. Algorithm names like 'sliding window' do not establish mechanics. Set activeApproachId to the approach being discussed. baselineApproachId identifies the approach assessed by the three checks; it can be a learner's sound conceptual repair even when the saved implementation is unfinished. State that distinction. Coach-introduced ideas are not independently derived learner solutions. Cite the learner description for a learner-proposed approach.

For a questionable complexity answer, identify the reasoning behind it. If the learner has already said what repeats, use that explanation; don't ask them to repeat it. When they propose a bound because they think comparisons restart, ask one small prediction about which work would need to repeat at the next step. A question like 'Wouldn't it be O(logn), because ...?' is a tentative model to explore, not a request for a full corrective lecture. Do not lead by announcing the correct bound or a growth-rate lesson. Use a small trace with the predicted step left blank. Explain directly when they explicitly request a worked explanation or after the specific assumption has been explored. Worked explanations should normally include a compact table, before/after or text diagram when it clarifies mechanics. Do not reveal a prediction's answer before asking it.

Once a correct baseline and its complexity are supported, set ready. If a worthwhile optimization remains, optionally offer one checkpoint ('What repeated work might we avoid?') with a hint, explanation, or move-on option; optimization is never a prerequisite to leaving. Set optimization.status=offered and save an open optimization/independent-recall revisit target before offering. If the learner doesn't know, disclose that an improvement exists and offer an explanation or moving on. Don't repeatedly offer after they defer. optimizationDeferredAt records an explicit move-on while an optimization was offered: leave it deferred unless a newer learner message asks to explore it. Use explained for coach-taught material, demonstrated only for a learner's supported independent explanation/application, and deferred when postponed. Avoid creating an optimization obligation for every sound answer.

During optional exploration of another approach, retain the baseline checks and readiness; a misconception about the newly taught approach does not revoke knowledge of the baseline. Record the new unresolved concept as a revisit target instead. Only change an established baseline or downgrade it when new LEARNER evidence actually contradicts it; baselineCorrection must cite that new evidence. Empty baselineCorrection means preserve the established baseline. This is not permanent mastery.

Revisit targets are concrete future activities, distinct from demonstrated deficits: independently implement an unfinished repair, revisit an invalid stopping rule, or recall a coach-taught optimization. Explain why with recording or learner citations. Preserve open targets until resolved by new evidence or explicitly dismissed by the learner; cite that evidence when changing status. A completed reflection does not resolve all future practice. Keep resolved/dismissed targets in the record so corrections remain inspectable. Never treat unknown intent as needs-practice. A learner correction updates the current interpretation while earlier evaluation revisions remain historical.`;
