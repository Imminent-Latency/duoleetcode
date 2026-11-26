import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { replay } from "./recording";
import { cppLsp } from "./cpp-lsp";
import type { Attempt } from "./types";
import type { JavaSymbolEvidence } from "./research-types";
export const symbolArgs = z.object({
  document: z.enum(["recording", "coached"]),
  seq: z.number().int().nonnegative().nullable(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
export type SymbolJob = {
  id: string;
  attemptId: string;
  source: string;
  sourceHash: string;
  args: z.infer<typeof symbolArgs>;
};
type Pending = {
  job: SymbolJob;
  resolve: (v: JavaSymbolEvidence) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  fullTimeoutMs: number;
  promoted: boolean;
  createdAt: number;
};
const shared = globalThis as typeof globalThis & {
  duoSymbolJobs?: Map<string, Pending>;
  duoSymbolHeartbeats?: Map<string, number>;
};
const jobs = (shared.duoSymbolJobs ??= new Map());
const heartbeats = (shared.duoSymbolHeartbeats ??= new Map());
export function recordSymbolBridgePoll(attemptId: string, now = Date.now()) {
  for (const [id, seenAt] of heartbeats) {
    if (now - seenAt > 60_000) heartbeats.delete(id);
  }
  heartbeats.set(attemptId, now);
}
export function hasActiveSymbolBridge(
  attemptId: string,
  now = Date.now(),
  ttlMs = 5_000,
) {
  const seenAt = heartbeats.get(attemptId);
  return seenAt !== undefined && now - seenAt <= ttlMs;
}
export function clearSymbolBridgeHeartbeats() {
  heartbeats.clear();
}
export function browserSymbolsDisabled(disableOption?: boolean) {
  return Boolean(disableOption || process.env.DUO_DISABLE_BROWSER_SYMBOLS === "1");
}
function rejectUnavailable(id: string, reject: (e: Error) => void) {
  jobs.delete(id);
  reject(
    new Error(
      "Browser Java lookup unavailable. Do not claim that LSP resolved this call; use the supplied code and official references, or state uncertainty.",
    ),
  );
}
export function symbolSnapshot(a: Attempt, input: unknown) {
  const args = symbolArgs.parse(input);
  if (
    args.document === "recording" &&
    (args.seq === null ||
      (args.seq !== 0 && !a.events.some((e) => e.seq === args.seq)))
  )
    throw new Error("Choose a saved recording snapshot.");
  if (
    args.document === "coached" &&
    (args.seq !== null || a.followup?.coachedCode === undefined)
  )
    throw new Error("Save the coached workspace first.");
  const source =
    args.document === "recording"
      ? replay(a, args.seq!)
      : a.followup!.coachedCode!;
  const lines = source.split(/\r\n|\n|\r/);
  if (
    lines[args.line - 1] === undefined ||
    args.column > lines[args.line - 1].length + 1
  )
    throw new Error("The symbol position is outside the selected source.");
  return {
    source,
    args,
    sourceHash: createHash("sha256").update(source).digest("hex"),
  };
}
export function requestJavaSymbol(
  a: Attempt,
  input: unknown,
  timeout = 20000,
  opts?: { noBridgeTimeout?: number },
): Promise<JavaSymbolEvidence> {
  const snapshot = symbolSnapshot(a, input),
    id = randomUUID(),
    createdAt = Date.now(),
    promoted =
      opts?.noBridgeTimeout === undefined || hasActiveSymbolBridge(a.id),
    initialTimeout = promoted
      ? timeout
      : Math.min(timeout, opts.noBridgeTimeout!);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => rejectUnavailable(id, reject),
      initialTimeout,
    );
    jobs.set(id, {
      job: { id, attemptId: a.id, ...snapshot },
      resolve,
      reject,
      timer,
      fullTimeoutMs: timeout,
      promoted,
      createdAt,
    });
  });
}
export function pendingSymbolJobs(attemptId: string) {
  const now = Date.now();
  const out: SymbolJob[] = [];
  for (const [id, p] of jobs) {
    if (p.job.attemptId !== attemptId) continue;
    if (!p.promoted) {
      clearTimeout(p.timer);
      p.promoted = true;
      const remaining = Math.max(1, p.fullTimeoutMs - (now - p.createdAt));
      p.timer = setTimeout(() => rejectUnavailable(id, p.reject), remaining);
    }
    out.push(p.job);
  }
  return out;
}
export const symbolReplySchema = z.object({
  attemptId: z.string().uuid(),
  id: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: z
    .object({
      hover: z.unknown(),
      signatures: z.unknown(),
      definition: z.unknown(),
    })
    .optional(),
  error: z.string().max(1000).optional(),
});
export function completeSymbolJob(input: z.infer<typeof symbolReplySchema>) {
  const pending = jobs.get(input.id);
  if (
    !pending ||
    pending.job.attemptId !== input.attemptId ||
    pending.job.sourceHash !== input.sourceHash
  )
    throw new Error(
      "This Java lookup no longer belongs to the requested snapshot.",
    );
  if (JSON.stringify(input.result ?? {}).length > 60000)
    throw new Error("Java symbol response is too large.");
  jobs.delete(input.id);
  clearTimeout(pending.timer);
  if (input.error || !input.result)
    pending.reject(new Error(input.error ?? "Java lookup failed"));
  else if (!(
    (input.result.hover as any)?.contents?.length ||
    (input.result.hover as any)?.contents?.value ||
    (input.result.signatures as any)?.signatures?.length ||
    (Array.isArray(input.result.definition)
      ? input.result.definition.length
      : (input.result.definition as any)?.uri) ||
    (typeof input.result.hover === "string" &&
      input.result.hover.trim().length > 0)
  ))
    pending.reject(
      new Error(
        "The compiler did not resolve this symbol. Do not claim LSP verification.",
      ),
    );
  else
    pending.resolve({
      ...pending.job.args,
      sourceHash: input.sourceHash,
      javaProfile: 25,
      ...input.result,
    });
}

export async function requestCppSymbol(
  a: Attempt,
  input: unknown,
): Promise<JavaSymbolEvidence> {
  const snapshot = symbolSnapshot(a, input);
  const result = await cppLsp().inspect(snapshot.source, {
    line: snapshot.args.line - 1,
    character: snapshot.args.column - 1,
  });
  const hasContent =
    Boolean((result?.hover as any)?.contents?.length) ||
    Boolean((result?.hover as any)?.contents?.value) ||
    Boolean((result?.signatures as any)?.signatures?.length) ||
    Boolean(
      Array.isArray(result?.definition)
        ? result.definition.length
        : (result?.definition as any)?.uri,
    ) ||
    (typeof result?.hover === "string" && result.hover.trim().length > 0);
  if (!hasContent)
    throw new Error(
      "clangd did not resolve this symbol. Do not claim LSP verification.",
    );
  return {
    ...snapshot.args,
    sourceHash: snapshot.sourceHash,
    language: "cpp",
    languageProfile: "C++26",
    hover: result.hover ?? null,
    signatures: result.signatures ?? null,
    definition: result.definition ?? null,
  };
}
