import { z } from "zod";
import { ReviewFlags } from "@/lib/review-flags";
import { localRequest, json, failure } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const q = z
      .object({
        id: z.string().uuid().optional(),
        attemptId: z.string().uuid().optional(),
        status: z.enum(["open", "resolved"]).optional(),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .parse(Object.fromEntries(new URL(req.url).searchParams));
    const flags = new ReviewFlags();
    return json(
      q.id
        ? flags.get(q.id)
        : q.attemptId
          ? { flags: flags.forAttempt(q.attemptId) }
          : flags.list(q.status, q.offset),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    const body = await req.json();
    localRequest(req);
    const flags = new ReviewFlags();
    if (body.action === "status") {
      const d = z
        .object({ id: z.string().uuid(), status: z.enum(["open", "resolved"]) })
        .parse(body);
      return json(flags.setStatus(d.id, d.status));
    }
    if (body.action !== "create")
      throw new Error("Choose a supported review action.");
    return json(flags.create(body.flag));
  } catch (e) {
    return failure(e);
  }
}
