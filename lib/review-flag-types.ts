import { z } from "zod";
import { editorContextSchema } from "./editor-context";
export const reviewCategories = [
  "Incorrect information",
  "Unnecessary question",
  "Poor recommendation",
  "Editor issue",
  "Other",
] as const;
export const reviewTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["reflection", "coaching", "java-help"]),
    attemptId: z.string().uuid(),
    messageId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("evaluation"),
    attemptId: z.string().uuid(),
    createdAt: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("prescription"),
    prescriptionId: z.string().uuid(),
  }),
  z.object({ kind: z.literal("agent-run"), traceId: z.string().uuid() }),
  z.object({
    kind: z.literal("editor"),
    attemptId: z.string().uuid(),
    source: z.string().max(2_000_000),
    editor: editorContextSchema,
  }),
]);
export type ReviewTarget = z.infer<typeof reviewTargetSchema>;
export const reviewFlagInputSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(reviewCategories),
  note: z.string().trim().max(4000),
  target: reviewTargetSchema,
});
export type ReviewFlagInput = z.infer<typeof reviewFlagInputSchema>;
export type ReviewFlagSummary = {
  id: string;
  createdAt: number;
  status: "open" | "resolved";
  category: string;
  note: string;
  title: string;
  kind: ReviewTarget["kind"];
  mode: "practice" | "test";
  attemptId?: string;
  traceState: "captured" | "unavailable" | "none";
  traceCount: number;
};
export type ReviewFlag = ReviewFlagSummary & {
  bundle: {
    format: "duoleetcode-review-flag";
    version: 1;
    capturedAt: number;
    target: ReviewTarget;
    context: unknown;
    settingsAtCapture: unknown;
    traces: unknown;
    traceNote: string;
  };
};
