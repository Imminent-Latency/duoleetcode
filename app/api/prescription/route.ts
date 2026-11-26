import { z } from "zod";
import { database } from "@/lib/store";
import { localRequest, json, failure } from "@/lib/http";
import {
  answerCatalogRequest,
  coachPrescription,
  prescriptionStatus,
  revealPrescriptionSpoiler,
  startPrescription,
} from "@/lib/prescription";
import { sandboxMode } from "@/lib/practice-storage.mjs";
import { languageIdSchema, normalizeLanguage } from "@/lib/languages";
import { domainIdSchema } from "@/lib/prescription-types";
export const runtime = "nodejs";
const overrideSchema = z
  .object({
    domainOverride: domainIdSchema.optional(),
    domainPoolOverride: z.array(domainIdSchema).min(2).max(5).optional(),
    slotOverride: z
      .enum(["easy-reinforcement", "growth", "consolidation", "breadth", "stretch"])
      .optional(),
    maxMinutes: z.number().int().min(10).max(45).optional(),
    excludeSlug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  })
  .strict();
const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      another: z.boolean().default(false),
      language: languageIdSchema.default("java"),
      isPremium: z.boolean().default(false),
      override: overrideSchema.optional(),
    })
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
  z
    .object({
      action: z.literal("coach"),
      message: z.string().trim().min(1).max(2000),
      language: languageIdSchema.default("java"),
      isPremium: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("reveal-spoiler"),
      prescriptionId: z.string().uuid(),
    })
    .strict(),
]);
export async function GET(req: Request) {
  try {
    localRequest(req);
    const url = new URL(req.url);
    const lang = normalizeLanguage(url.searchParams.get("language"));
    const isPremium = url.searchParams.get("isPremium") === "true";
    return json(prescriptionStatus(database(), undefined, lang, isPremium));
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
      return json(
        startPrescription(
          db,
          body.another,
          { isPremium: body.isPremium, override: body.override },
          body.language,
        ),
      );
    if (body.action === "coach")
      return json(
        await coachPrescription(db, body.message, body.language, body.isPremium),
      );
    if (body.action === "reveal-spoiler") {
      revealPrescriptionSpoiler(db, body.prescriptionId);
      return json({ ok: true });
    }
    answerCatalogRequest(db, body.jobId, body.requestId, body.data, body.error);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
