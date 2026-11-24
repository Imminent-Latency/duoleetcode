import { z } from "zod";
import { database } from "@/lib/store";
import { localRequest, json, failure } from "@/lib/http";
import {
  prescriptionStatus,
  startPrescription,
  answerCatalogRequest,
} from "@/lib/prescription";
import { sandboxMode } from "@/lib/practice-storage.mjs";
export const runtime = "nodejs";
const bodySchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("start"), another: z.boolean().default(false) })
    .strict(),
  z
    .object({
      action: z.literal("catalog-result"),
      jobId: z.string().uuid(),
      requestId: z.string().uuid(),
      data: z.unknown().optional(),
      error: z.string().max(2000).optional(),
    })
    .strict(),
]);
export async function GET(req: Request) {
  try {
    localRequest(req);
    return json(prescriptionStatus(database()));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    if (sandboxMode())
      throw new Error(
        "Open the practice app to get a personalized problem. Test sessions do not guide prescriptions.",
      );
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 400000)
      throw new Error("Catalog response is too large.");
    const body = bodySchema.parse(JSON.parse(raw));
    localRequest(req);
    const db = database();
    if (body.action === "start")
      return json(startPrescription(db, body.another));
    answerCatalogRequest(db, body.jobId, body.requestId, body.data, body.error);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
