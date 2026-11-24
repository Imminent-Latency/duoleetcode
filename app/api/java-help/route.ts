import { traced } from "@/lib/agent-traces";
import { z } from "zod";
import { store } from "@/lib/store";
import { answerJavaReference } from "@/lib/agents";
import { askJavaHelp, deliverJavaHelp } from "@/lib/java-help-service";
import { publicJavaHelp } from "@/lib/java-help";
import { failure, json, localRequest } from "@/lib/http";
import { editorContextSchema } from "@/lib/editor-context";
export const runtime = "nodejs";
export const maxDuration = 300;
const shared = globalThis as typeof globalThis & {
  duoReferenceLocks?: Set<string>;
};
const locks = (shared.duoReferenceLocks ??= new Set<string>());
export async function GET(req: Request) {
  try {
    localRequest(req);
    const id = z.string().uuid().parse(new URL(req.url).searchParams.get("id"));
    return json({ help: publicJavaHelp(store(id).get(id)) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  let locked = "";
  try {
    localRequest(req);
    const body = z
      .object({
        action: z.enum(["ask", "deliver"]),
        attemptId: z.string().uuid(),
        id: z.string().uuid(),
        seq: z.number().int().positive(),
        question: z.string().trim().min(1).max(5000).optional(),
        editor: editorContextSchema.optional(),
      })
      .parse(await req.json());
    localRequest(req);
    if (body.action === "deliver")
      deliverJavaHelp(store(body.attemptId), body.attemptId, body.id, body.seq);
    else {
      if (!body.question) throw new Error("Enter a Java question.");
      if (locks.has(body.attemptId))
        throw new Error(
          "A Java reference reply is already running. Your question is saved.",
        );
      locks.add(body.attemptId);
      locked = body.attemptId;
      await traced(
        {
          role: "java help",
          subjectId: body.id,
          kind: "workflow",
          attemptId: body.attemptId,
          mode:
            store(body.attemptId).memory.sandbox ||
            store(body.attemptId).get(body.attemptId).demonstration
              ? "test"
              : "practice",
        },
        async (trace) => {
          trace.event("workflow.input", body);
          await askJavaHelp(
            store(body.attemptId),
            body.attemptId,
            {
              id: body.id,
              seq: body.seq,
              question: body.question!,
              editor: body.editor,
            },
            answerJavaReference,
          );
          trace.event("workflow.saved", {
            attemptId: body.attemptId,
            messageId: body.id,
          });
        },
      );
    }
    return json({
      help: publicJavaHelp(store(body.attemptId).get(body.attemptId)),
    });
  } catch (e) {
    return failure(e);
  } finally {
    if (locked) locks.delete(locked);
  }
}
