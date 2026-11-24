import { z } from "zod";
import type { Attempt, ReflectionIntake } from "./types";

export const reflectionIntakeSchema = z
  .object({
    id: z.string().uuid(),
    familiarity: z.enum(["new", "revisit", "solved"]),
    timeComplexity: z.string().trim().min(1).max(5000),
    spaceComplexity: z.string().trim().min(1).max(5000),
  })
  .strict();
export const familiarityLabels = {
  new: "New to me",
  revisit: "Seen before",
  solved: "Solved before",
} as const;
export function intakeMessage(intake: Omit<ReflectionIntake, "submittedAt">) {
  return `Prior familiarity: ${familiarityLabels[intake.familiarity]}\n\nRuntime complexity:\n${intake.timeComplexity}\n\nAuxiliary space complexity:\n${intake.spaceComplexity}`;
}
// Preserve conversations that began before the introduction of the entry form.
export function needsReflectionIntake(a: Attempt) {
  return !a.reflection?.intake && !a.reflection?.messages.length;
}
