import { z } from "zod";
import { database } from "@/lib/store";
import { failure, json, localRequest } from "@/lib/http";
import { preferenceInput } from "@/lib/learner-memory";
import { sandboxMode } from "@/lib/practice-storage.mjs";
export const runtime = "nodejs";
const revision = z.number().int().nonnegative();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), ...preferenceInput.shape }).strict(),
  z
    .object({
      action: z.literal("edit"),
      id: z.string(),
      revision,
      ...preferenceInput.shape,
    })
    .strict(),
  z.object({ action: z.literal("forget"), id: z.string(), revision }).strict(),
  z
    .object({
      action: z.literal("correct-evidence"),
      id: z.string(),
      revision,
      text: z.string().trim().min(1).max(1500),
      excluded: z.boolean(),
    })
    .strict(),
]);
export async function GET(req: Request) {
  try {
    localRequest(req);
    const memory = database().memory;
    const params = new URL(req.url).searchParams;
    const id = params.get("id");
    if (id)
      return json({ memory: memory.get(id), revisions: memory.revisions(id) });
    return json({
      preferences: memory.list(),
      evidence: memory.search({
        query: (params.get("q") ?? "").slice(0, 500),
        includeSuperseded: params.get("older") === "true",
        includeExcluded: true,
        limit: 100,
      }),
      uses: memory.uses(),
      sandbox: sandboxMode(),
      availableAttemptIds: database()
        .snapshotRecords()
        .map((a) => a.id),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    const body = bodySchema.parse(await req.json());
    localRequest(req);
    const memory = database().memory;
    if (body.action === "add")
      memory.add({ text: body.text, scope: body.scope });
    if (body.action === "edit")
      memory.edit(body.id, body.revision, {
        text: body.text,
        scope: body.scope,
      });
    if (body.action === "forget") memory.forget(body.id, body.revision);
    if (body.action === "correct-evidence")
      memory.correctEvidence(body.id, body.revision, body.text, body.excluded);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
