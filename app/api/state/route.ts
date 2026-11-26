import { database } from "@/lib/store";
import { failure, httpError, json, localRequest } from "@/lib/http";
import { problemSchema } from "@/lib/validation";
import { recommend } from "@/lib/recommendation";
import { latestCoaching } from "@/lib/coaching";
import { latestReflection } from "@/lib/reflection";
import { sandboxMode } from "@/lib/practice-storage.mjs";
import { demoProblem } from "@/lib/demo";
import { DEFAULT_LANGUAGE, languageIdSchema } from "@/lib/languages";
import { resolveDefaultLanguage } from "@/lib/agent-settings";
import { readAgentSettings } from "@/lib/agent-settings-store";
import { buildRatingProfile } from "@/lib/rating-profile";
import {
  listSavedPrescriptionsById,
  prescriptionContextKeyForIntent,
} from "@/lib/prescription";
import {
  isManualTimeboxRated,
  nextAssessmentGate,
  resolveLaunchPrescription,
} from "@/lib/skill-ratings";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const practice = database();
    const history = practice.history();
    const sandbox = sandboxMode() ? [] : database("sandbox").list();
    const attempts = [...practice.list(), ...sandbox].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    let defaultLanguage = DEFAULT_LANGUAGE;
    try {
      defaultLanguage = resolveDefaultLanguage(readAgentSettings());
    } catch {
      /* Keep state endpoint available if settings file is unreadable. */
    }
    return json({
      attempts,
      sandboxMode: sandboxMode(),
      defaultLanguage,
      importedHistory: practice.imported(),
      recommendation: recommend(history),
      ratings: buildRatingProfile(practice),
      skills: history.flatMap(
        (a) =>
          a.evaluations.at(-1)?.strengths.map((s) => ({
            ...s,
            attemptId: a.id,
            date: a.createdAt,
            kind: s.learnerEvidence?.length
              ? "explained in reflection"
              : "observed",
          })) ?? [],
      ),
      followups: history
        .filter((a) => a.followup?.outcome || a.learningExit)
        .map((a) => ({
          skill:
            a.evaluations[
              a.followup?.evaluationRevision ?? a.evaluations.length - 1
            ]?.exercise.skill ?? a.problem.title,
          outcome: a.followup?.outcome,
          hasResponse: Boolean(a.followup),
          understanding: latestCoaching(a)?.understanding,
          reflectionStatus: latestReflection(a)?.status,
          learningExit: a.learningExit,
          date: a.followup?.answeredAt ?? a.learningExit?.at,
          attemptId: a.id,
        })),
      serverTime: Date.now(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    const body = z
      .object({
        problem: problemSchema,
        budgetMs: z.number().int().min(60000).max(5400000),
        demonstration: z.boolean().default(false),
        language: languageIdSchema.default("java"),
        prescriptionId: z.string().uuid().optional(),
        selectionSpoilerRevealed: z.boolean().optional(),
        isPremium: z.boolean().default(false),
      })
      .parse(await req.json());
    localRequest(req);
    const demonstration =
      sandboxMode() ||
      body.demonstration ||
      body.problem.titleSlug === demoProblem.titleSlug;
    const target = database(demonstration ? "sandbox" : "practice");
    if (!demonstration) {
      const gate = nextAssessmentGate(target.history());
      if (!gate.allowed) {
        throw new Error(
          gate.message ??
            "Finish your current session before starting another.",
        );
      }
    } else if (
      target.list().some((a) => a.phase === "active" || a.phase === "paused")
    ) {
      throw new Error(
        "Resume or finish your existing assessment before starting another.",
      );
    }
    if (body.problem.locked)
      throw new Error("This problem is unavailable to your connected account.");

    let launchMeta: Parameters<typeof target.create>[5] | undefined;
    if (body.prescriptionId && !demonstration) {
      const savedById = listSavedPrescriptionsById(target);
      const existingRec = savedById.get(body.prescriptionId);
      const currentKey = existingRec
        ? prescriptionContextKeyForIntent(
            target,
            existingRec.intent,
            body.language,
            body.isPremium,
            existingRec.skippedSlugs,
          )
        : "";
      const resolution = resolveLaunchPrescription({
        suppliedId: body.prescriptionId,
        savedById,
        currentContextKey: currentKey,
        slug: body.problem.titleSlug,
        language: body.language,
        now: Date.now(),
      });
      if (resolution.mode === "conflict") {
        throw httpError(resolution.error, 409);
      }
      if (
        resolution.mode === "prescribed" ||
        resolution.mode === "prescribed-stale-honored"
      ) {
        const chosenMinutes = Math.round(body.budgetMs / 60_000);
        const prescribedMinutes = resolution.record.minutes ?? chosenMinutes;
        const rated = isManualTimeboxRated(prescribedMinutes, chosenMinutes);
        launchMeta = {
          prescriptionId: resolution.record.id,
          intent: resolution.intent,
          difficultyScore: resolution.record.difficultyScore,
          difficultyModifier: resolution.record.difficultyModifier,
          standardMinutes: resolution.record.standardMinutes,
          prescribedMinutes,
          selectionSpoilerRevealed: Boolean(
            body.selectionSpoilerRevealed ||
              resolution.record.selectionSpoilerRevealed,
          ),
          rated,
        };
      }
    }

    return json({
      attempt: target.create(
        body.problem,
        body.budgetMs,
        demonstration,
        undefined,
        body.language,
        launchMeta,
      ),
      serverTime: Date.now(),
    });
  } catch (e) {
    return failure(e);
  }
}
