import { database } from "@/lib/store";
import { failure, json, localRequest } from "@/lib/http";
import { problemSchema } from "@/lib/validation";
import { recommend } from "@/lib/recommendation";
import { latestCoaching } from "@/lib/coaching";
import { latestReflection } from "@/lib/reflection";
import { sandboxMode } from "@/lib/practice-storage.mjs";
import { demoProblem } from "@/lib/demo";
import { languageIdSchema } from "@/lib/languages";
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
    return json({
      attempts,
      sandboxMode: sandboxMode(),
      importedHistory: practice.imported(),
      recommendation: recommend(history),
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
      })
      .parse(await req.json());
    localRequest(req);
    const demonstration =
      sandboxMode() ||
      body.demonstration ||
      body.problem.titleSlug === demoProblem.titleSlug;
    const target = database(demonstration ? "sandbox" : "practice");
    if (target.list().some((a) => a.phase === "active" || a.phase === "paused"))
      throw new Error(
        "Resume or finish your existing assessment before starting another.",
      );
    if (body.problem.locked)
      throw new Error("This problem is unavailable to your connected account.");
    return json({
      attempt: target.create(
        body.problem,
        body.budgetMs,
        demonstration,
        undefined,
        body.language,
      ),
      serverTime: Date.now(),
    });
  } catch (e) {
    return failure(e);
  }
}
