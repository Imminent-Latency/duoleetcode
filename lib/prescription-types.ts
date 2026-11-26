import { z } from "zod";
import { languageIdSchema } from "./languages";

export const domainIdSchema = z.enum([
  "arrays-strings",
  "hashing-prefix",
  "two-pointers-window",
  "sorting-intervals",
  "stacks-queues-linked",
  "binary-search",
  "heaps-ordered",
  "trees-recursion",
  "graphs-search",
  "backtracking",
  "dynamic-programming",
  "greedy",
  "math-bitwise",
]);

export const prescriptionIntentSchema = z.object({
  slotIndex: z.number().int().min(0),
  slotKind: z.enum([
    "onboarding",
    "growth",
    "breadth",
    "concept-probe",
    "consolidation",
    "easy-reinforcement",
    "stretch",
  ]),
  targetDomain: domainIdSchema,
  targetFacet: z.enum(["implementation", "selection"]),
  targetConceptSlug: z.string().optional(),
  targetDifficultyBand: z.tuple([z.number(), z.number()]),
  preferEasy: z.boolean().optional(),
  clockGoal: z.enum(["standard", "ability", "speed"]).optional(),
  allowCoachedRevisit: z.boolean().optional(),
  defaultTimeboxBand: z.tuple([z.number(), z.number()]).optional(),
  steeredDomainExplicit: z.boolean().optional(),
  overrideWarning: z.string().optional(),
});

export const prescriptionSchema = z.object({
  traceId: z.string().uuid().optional(),
  id: z.string().uuid(),
  language: languageIdSchema.optional(),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  difficulty: z.string(),
  difficultyScore: z.number().optional(),
  difficultyModifier: z.number().optional(),
  standardMinutes: z.number().optional(),
  intent: prescriptionIntentSchema.optional(),
  disguiseVerified: z.boolean().optional(),
  selectionSpoilerRevealed: z.boolean().optional(),
  overrideWarning: z.string().optional(),
  strategy: z.enum(["primary", "batch-2", "widened", "rotated"]).optional(),
  reason: z.string(),
  minutes: z.number().int().min(10).max(45),
  kind: z.enum(["new-challenge", "revisit"]),
  evidence: z.array(
    z.object({
      id: z.string(),
      skill: z.string(),
      observation: z.string(),
      support: z.string(),
      date: z.number(),
      source: z.string(),
      url: z.string().optional(),
      attemptId: z.string().optional(),
      correction: z.string().optional(),
    }),
  ),
  model: z.string(),
  effort: z.string(),
  createdAt: z.number(),
  contextKey: z.string(),
  skippedSlugs: z.array(z.string()),
});
export type Prescription = z.infer<typeof prescriptionSchema>;
export type CatalogRequest = {
  id: string;
  op: "list" | "problem";
  args: Record<string, unknown>;
};
export type PrescriptionStatus = {
  prescription?: Prescription;
  job?: {
    traceId?: string;
    id: string;
    state: "running" | "complete" | "failed";
    stage: string;
    error?: string;
    requests: CatalogRequest[];
  };
};
