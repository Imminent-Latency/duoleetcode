import { z } from "zod";
import { database } from "@/lib/store";
import { failure, json, localRequest } from "@/lib/http";
import {
  getCatalogSyncStatus,
  ingestCatalogSyncPage,
  recordCatalogSyncError,
  resetCatalogSync,
} from "@/lib/catalog-sync";

export const runtime = "nodejs";

const questionSchema = z.object({
  questionFrontendId: z.union([z.string(), z.number()]).optional(),
  title: z.string().max(300),
  titleSlug: z.string().regex(/^[a-z0-9-]+$/),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  acRate: z.number().min(0).max(100).optional(),
  isPaidOnly: z.boolean().optional(),
  status: z.string().nullable().optional(),
  topicTags: z
    .array(z.object({ name: z.string().max(100), slug: z.string().max(100).optional() }))
    .max(50)
    .optional(),
});

const postSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ingest-page"),
      skip: z.number().int().min(0).max(10000),
      totalNum: z.number().int().min(0).max(20000),
      questions: z.array(questionSchema).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("record-error"),
      error: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("reset"),
    })
    .strict(),
]);

export async function GET(req: Request) {
  try {
    localRequest(req);
    return json(getCatalogSyncStatus(database()));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    localRequest(req);
    const body = postSchema.parse(await req.json());
    localRequest(req);
    const db = database();
    if (body.action === "ingest-page") {
      return json(ingestCatalogSyncPage(db, body));
    }
    if (body.action === "record-error") {
      return json(recordCatalogSyncError(db, body.error));
    }
    return json(resetCatalogSync(db));
  } catch (e) {
    return failure(e);
  }
}
