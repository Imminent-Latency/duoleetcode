import { z } from "zod";
import { database } from "@/lib/store";
import { failure, json, localRequest } from "@/lib/http";
import { sandboxMode } from "@/lib/practice-storage.mjs";
import {
  advanceGeneration,
  operationJournal,
  readExtras,
  snapshotHome,
  writeExtras,
} from "@/lib/data-environment";
import {
  applyProjected,
  assertIdle,
  captureSnapshot,
  listSnapshots,
  parseSnapshot,
  projectOperation,
  readSnapshot,
  saveSnapshot,
} from "@/lib/snapshots";
import { browserDataSchema, operationSchema } from "@/lib/snapshot-schema";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("snapshot"),
    name: z.string().trim().min(1).max(160),
    browser: browserDataSchema,
  }),
  z.object({ action: z.literal("upload"), archive: z.unknown() }),
  z.object({ action: z.literal("current"), browser: browserDataSchema }),
  z.object({
    action: z.literal("preview"),
    operation: operationSchema,
    sourceId: z.string().uuid().optional(),
    browser: browserDataSchema,
  }),
  z.object({
    action: z.literal("apply"),
    operation: operationSchema,
    sourceId: z.string().uuid().optional(),
    browser: browserDataSchema,
    token: z.string().length(64),
    confirmation: z.literal("APPLY"),
  }),
]);
export async function GET(req: Request) {
  try {
    localRequest(req);
    if (sandboxMode())
      throw new Error("Open the practice app to manage both libraries.");
    const params = new URL(req.url).searchParams,
      id = params.get("id");
    if (id) {
      const snapshot = readSnapshot(snapshotHome(), id);
      if (params.has("download"))
        return new Response(JSON.stringify(snapshot, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="duoleetcode-${snapshot.id}.json"`,
            "Cache-Control": "no-store",
          },
        });
      return json({ snapshot });
    }
    return json({ snapshots: listSnapshots(snapshotHome()) });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    if (sandboxMode())
      throw new Error("Open the practice app to manage both libraries.");
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 64 * 1024 * 1024)
      throw new Error("Snapshot files are limited to 64 MB in this POC.");
    const body = schema.parse(JSON.parse(raw));
    localRequest(req);
    if (body.action === "upload") {
      const snapshot = parseSnapshot(body.archive);
      saveSnapshot(snapshotHome(), snapshot);
      return json({ snapshot });
    }
    const practice = database(),
      sandbox = database("sandbox");
    const current = captureSnapshot(
      practice,
      sandbox,
      { ...readExtras(), browser: body.browser },
      body.action === "snapshot" ? body.name : "Current library",
    );
    if (body.action === "current") return json({ snapshot: current });
    if (body.action === "snapshot") {
      saveSnapshot(snapshotHome(), current);
      return json({ snapshot: current });
    }
    const source =
      body.operation.action === "restore"
        ? readSnapshot(snapshotHome(), body.sourceId ?? "")
        : current;
    const { projected, preview } = projectOperation(
      current,
      source,
      body.operation,
    );
    if (body.action === "preview") return json({ preview });
    if (body.token !== preview.token)
      throw new Error(
        "Data changed since this preview. Review a fresh preview before applying.",
      );
    assertIdle(practice, sandbox);
    if (!preview.changed) return json({ ok: true, unchanged: true });
    const recovery = {
      ...current,
      name: `Before ${body.operation.action} · ${new Date().toLocaleString()}`,
    };
    // Re-seal after naming the automatic recovery snapshot.
    const { sealSnapshot } = await import("@/lib/snapshots");
    const { sha256: _checksum, ...recoveryData } = recovery;
    const saved = saveSnapshot(snapshotHome(), sealSnapshot(recoveryData));
    // No await between the last idle/state check and the synchronous mutation.
    assertIdle(practice, sandbox);
    const fresh = captureSnapshot(
      practice,
      sandbox,
      { ...readExtras(), browser: body.browser },
      "Current library",
    );
    if (
      projectOperation(fresh, source, body.operation).preview.token !==
      body.token
    )
      throw new Error("Data changed before apply. Refresh the preview.");
    applyProjected(
      practice,
      sandbox,
      saved,
      projected,
      operationJournal(),
      (s) => {
        writeExtras(s);
        advanceGeneration();
      },
    );
    return json({
      ok: true,
      reloadRequired: true,
      recoveryId: saved.id,
      browser: body.operation.selection.browser ? projected.browser : null,
      affectedAttempts: [
        ...body.operation.selection.practice.attempts,
        ...body.operation.selection.sandbox.attempts,
      ],
    });
  } catch (error) {
    return failure(error);
  }
}
