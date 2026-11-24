import { z } from "zod";
export const eventSchema = z.object({
  seq: z.number().int().positive(),
  at: z.number().finite(),
  type: z.enum([
    "edit",
    "focus",
    "pause-activity",
    "pause",
    "resume",
    "run",
    "submit",
    "assistance",
    "finish",
    "recover",
  ]),
  edits: z
    .array(
      z.object({
        offset: z.number().int().nonnegative(),
        length: z.number().int().nonnegative(),
        text: z.string().max(200000),
      }),
    )
    .max(500)
    .optional(),
  version: z.number().int().positive().optional(),
  origin: z.string().max(100).optional(),
  detail: z.string().max(3000).optional(),
  jobId: z.string().max(100).optional(),
  assistanceId: z.string().uuid().optional(),
  assistanceStage: z.enum(["request", "response"]).optional(),
});
export const problemSchema = z.object({
  questionId: z.string().max(100),
  questionFrontendId: z.string().max(100),
  title: z.string().max(300),
  titleSlug: z.string().regex(/^[a-z0-9-]+$/),
  difficulty: z.string().max(30),
  content: z.string().max(200000),
  javaStarter: z.string().max(200000),
  exampleInputs: z.object({ raw: z.string().max(100000) }),
  metadata: z
    .object({
      params: z
        .array(
          z.object({ name: z.string().max(100), type: z.string().max(200) }),
        )
        .max(100)
        .optional(),
      systemdesign: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  topicTags: z
    .array(z.object({ name: z.string().max(100) }))
    .max(50)
    .optional(),
  locked: z.boolean().optional(),
});
export const jobSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["run", "submit"]),
  state: z.string().max(30),
  remoteId: z.union([z.string().max(200), z.number()]).optional(),
  source: z.string().max(200000),
  sourceSha256: z.string().optional(),
  input: z.string().max(100000).optional(),
  seq: z.number().int().nonnegative(),
  createdAt: z.number(),
  result: z.record(z.string(), z.unknown()).optional(),
  summary: z.object({ verdict: z.string().max(100) }).optional(),
  url: z
    .string()
    .url()
    .refine((s) => s.startsWith("https://leetcode.com/"))
    .optional(),
  sourceVerification: z
    .object({ matches: z.boolean(), questionMatches: z.boolean() })
    .optional(),
  error: z.string().max(2000).optional(),
});
