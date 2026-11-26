import { z } from "zod";
import { database } from "@/lib/store";
import { failure, json, localRequest } from "@/lib/http";
import { buildRatingProfile } from "@/lib/rating-profile";
import { drainPendingRatingJobs } from "@/lib/rating-worker";
import { domainIdSchema } from "@/lib/prescription-types";

export const runtime = "nodejs";

const postSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("set-onboarding"),
      startingTier: z.enum(["foundations", "interview-prep", "experienced"]).optional(),
      welcomeDismissed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("set-preferences"),
      preferences: z
        .object({
          focusDomains: z.array(domainIdSchema).max(3),
          mutedDomains: z.array(domainIdSchema),
          maxMinutes: z.number().int().min(10).max(45).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("retry-drain"),
    })
    .strict(),
]);

export async function GET(req: Request) {
  try {
    localRequest(req);
    return json(buildRatingProfile(database()));
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
    if (body.action === "set-onboarding") {
      db.ratings.setOnboarding({
        ...(body.startingTier !== undefined ? { startingTier: body.startingTier } : {}),
        ...(body.welcomeDismissed !== undefined ? { welcomeDismissed: body.welcomeDismissed } : {}),
      });
    } else if (body.action === "set-preferences") {
      db.ratings.setPreferences(body.preferences);
    } else {
      await drainPendingRatingJobs(db, { forceRetryFailed: true });
    }
    return json(buildRatingProfile(db));
  } catch (e) {
    return failure(e);
  }
}
