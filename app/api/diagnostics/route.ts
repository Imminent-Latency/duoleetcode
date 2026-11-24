import { z } from "zod";
import { traces } from "@/lib/agent-traces";
import { localRequest, json, failure } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const q = z
      .object({
        id: z.string().uuid().optional(),
        export: z.literal("1").optional(),
        usage: z.literal("1").optional(),
        role: z.string().max(100).optional(),
        status: z
          .enum(["running", "succeeded", "failed", "interrupted", "timed-out"])
          .optional(),
        mode: z.enum(["practice", "test", "all"]).optional(),
        attemptId: z.string().uuid().optional(),
        offset: z.coerce.number().int().min(0).max(1000000).optional(),
      })
      .parse(Object.fromEntries(new URL(req.url).searchParams));
    const db = traces();
    if (q.usage) return json(db.usageSummary(q.mode ?? "practice"));
    if (q.export) return json(db.export(q.id));
    return json(
      q.id
        ? db.detail(q.id)
        : db.list({
            ...q,
            mode: q.mode === "all" ? undefined : q.mode,
          }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    const data = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("retention"),
          days: z.number().nullable(),
        }),
        z.object({
          action: z.literal("clear"),
          id: z.string().uuid().optional(),
          confirmed: z.literal(true),
        }),
      ])
      .parse(await req.json());
    localRequest(req);
    const db = traces();
    return json({
      removed:
        data.action === "clear"
          ? db.clear(data.id)
          : db.setRetention(data.days),
      ...db.settings(),
    });
  } catch (e) {
    return failure(e);
  }
}
