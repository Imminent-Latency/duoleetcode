import { z } from "zod";
import { localRequest, json, failure } from "@/lib/http";
import {
  pendingSymbolJobs,
  completeSymbolJob,
  recordSymbolBridgePoll,
  symbolReplySchema,
} from "@/lib/agent-symbols";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const id = z.string().uuid().parse(new URL(req.url).searchParams.get("id"));
    recordSymbolBridgePoll(id);
    return json({ jobs: pendingSymbolJobs(id) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    completeSymbolJob(symbolReplySchema.parse(await req.json()));
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
