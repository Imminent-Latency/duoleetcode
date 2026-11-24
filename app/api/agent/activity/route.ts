import { z } from "zod";
import { localRequest, json, failure } from "@/lib/http";
import { traces } from "@/lib/agent-traces";
import { readActivity } from "@/lib/agent-activity";
import { store } from "@/lib/store";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const q = z
      .object({
        attemptId: z.string().uuid(),
        traceId: z.string().uuid().optional(),
        feature: z.enum(["reflection", "coaching", "java-help"]),
        subjectId: z.string().uuid().optional(),
        since: z.coerce.number().nonnegative().optional(),
        details: z.enum(["0", "1"]).default("0"),
      })
      .parse(Object.fromEntries(new URL(req.url).searchParams));
    const a = store(q.attemptId).get(q.attemptId);
    // Live Java lookups show progress without revealing an answer before its
    // recorded delivery. Reflection/coaching detail is post-assessment only.
    const help = a.javaHelp?.find(
      (h) =>
        (!q.subjectId || h.id === q.subjectId) &&
        (!q.traceId || h.research?.traceId === q.traceId),
    );
    const allowed =
      q.feature === "java-help"
        ? !!help?.deliveredAt
        : a.sealed && ["review", "learn", "complete"].includes(a.phase);
    if (q.feature !== "java-help" && !allowed)
      throw new Error(
        "Finish the assessment before opening coaching activity.",
      );
    return json({
      activity: readActivity(
        traces(),
        { ...q, details: q.details === "1" },
        allowed,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
