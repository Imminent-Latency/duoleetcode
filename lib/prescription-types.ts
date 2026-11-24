import { z } from "zod";

export const prescriptionSchema = z.object({
  traceId: z.string().uuid().optional(),
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  difficulty: z.string(),
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
