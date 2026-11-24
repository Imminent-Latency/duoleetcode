import { traced } from "@/lib/agent-traces";
import {
  agent,
  coach,
  evaluate,
  prepareQuestionReview,
  reflect,
} from "@/lib/agents";
import {
  continueReflection,
  prepareReflectionReview,
} from "@/lib/reflection-service";
import { resolveBackgroundSettings } from "@/lib/agent-settings";
import { readAgentSettings } from "@/lib/agent-settings-store";
import { needsReflectionIntake } from "@/lib/reflection-intake";
import { replayFocusSchema } from "@/lib/reflection";
import { continueCoaching } from "@/lib/coaching-service";
import { store } from "@/lib/store";
import { localRequest, json, failure } from "@/lib/http";
import { z } from "zod";
import { editorContextSchema } from "@/lib/editor-context";
export const runtime = "nodejs";
export const maxDuration = 900;
const globalLocks = globalThis as typeof globalThis & {
  duoAgentLocks?: Set<string>;
};
const locks = (globalLocks.duoAgentLocks ??= new Set<string>());
export async function GET(req: Request) {
  try {
    localRequest(req);
    return json(await agent().status());
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  let key = "";
  let owned = false;
  try {
    localRequest(req);
    const body = z
      .object({
        action: z.enum(["login", "evaluate", "coach", "reflect", "prepare"]),
        id: z.string().uuid().optional(),
        message: z
          .object({
            id: z.string().uuid(),
            text: z.string().trim().min(1).max(20000),
            focus: replayFocusSchema.optional(),
            editor: editorContextSchema.optional(),
          })
          .optional(),
      })
      .parse(await req.json());
    localRequest(req);
    if (body.action === "login") return json(await agent().login());
    if (!body.id) throw new Error("Choose an attempt first.");
    key = body.id;
    if (locks.has(key))
      throw new Error("A review is already running for this attempt.");
    locks.add(key);
    owned = true;
    let a = store(body.id!).get(body.id!);
    if (!["review", "learn", "complete"].includes(a.phase) || !a.sealed)
      throw new Error("Finish and save the independent assessment first.");
    await traced(
      {
        role: body.action,
        kind: "workflow",
        attemptId: a.id,
        mode:
          a.demonstration || store(body.id!).memory.sandbox
            ? "test"
            : "practice",
      },
      async (trace) => {
        trace.event("workflow.input", body);
        if (body.action === "reflect" || body.action === "prepare") {
          if (a.jobs.some((j) => ["judging", "sending"].includes(j.state)))
            throw new Error(
              "Waiting for the pending judge result before reflection.",
            );
          if (body.action === "prepare") {
            const bg = resolveBackgroundSettings(readAgentSettings());
            if (bg.preIntakeReview) {
              await prepareReflectionReview(
                store(body.id!),
                body.id!,
                (a, saveReview) =>
                  prepareQuestionReview(a, undefined, saveReview),
              );
            }
          } else {
            if (needsReflectionIntake(a))
              throw new Error(
                "Answer the three reflection questions before starting the conversation.",
              );
            const bg = resolveBackgroundSettings(readAgentSettings());
            if (
              a.reflection?.intake &&
              bg.preIntakeReview &&
              !a.reflection.analysis &&
              !a.reflection.preparedReviewAt
            )
              throw new Error(
                "The coach is still preparing your recording. Your answers are saved.",
              );
            await continueReflection(
              store(body.id!),
              body.id!,
              (a, saveReview) =>
                reflect(
                  a,
                  undefined,
                  "conversation",
                  store(body.id!).memory,
                  saveReview,
                ),
              body.message,
            );
          }
        } else if (body.action === "evaluate") {
          if (
            a.jobs.some((j) => j.state === "judging" || j.state === "sending")
          )
            throw new Error(
              "Wait for the pending judge result before generating feedback.",
            );
          const evaluation = await evaluate(a, store(body.id!).memory);
          a = store(body.id!).get(body.id!);
          a.evaluations.push(evaluation);
          store(body.id!).save(a);
        } else {
          await continueCoaching(
            store(body.id!),
            body.id!,
            {
              coach: (a) => coach(a, store(body.id!).memory),
            },
            body.message,
          );
        }
        trace.event("workflow.saved", { attemptId: a.id, action: body.action });
      },
    );
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  } finally {
    if (owned) locks.delete(key);
  }
}
