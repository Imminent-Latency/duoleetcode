import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { store } from "@/lib/store";
import { json, failure, localRequest } from "@/lib/http";
import { eventSchema, jobSchema } from "@/lib/validation";
import { candidateMoments, replay } from "@/lib/recording";
import type { Attempt } from "@/lib/types";
import {
  saveReflectionIntake,
  skipReflectionCheckIn,
} from "@/lib/reflection-service";
import { publicJavaHelp } from "@/lib/java-help";
import { resolveBackgroundSettings } from "@/lib/agent-settings";
import { readAgentSettings } from "@/lib/agent-settings-store";
import { agent, scheduleBackgroundSolvingCheck } from "@/lib/agents";

function publicAttempt(a: Attempt) {
  const bg = resolveBackgroundSettings(readAgentSettings());
  const ready = Boolean(
    a.reflection?.analysis ||
      a.reflection?.preparedReviewAt ||
      !bg.preIntakeReview,
  );
  return {
    ...a,
    solvingChunks: ["active", "paused"].includes(a.phase)
      ? undefined
      : a.solvingChunks,
    javaHelp: publicJavaHelp(a),
    reflection:
      a.reflection || (a.phase === "review" && !bg.preIntakeReview)
        ? {
            messages: [],
            ...a.reflection,
            analysis: undefined,
            questionReview: undefined,
            preparedReviewAt: undefined,
            analysisReady: ready,
          }
        : undefined,
    evaluations: a.evaluations.map((e) => ({
      ...e,
      exercise: { ...e.exercise, rubric: undefined },
    })),
  };
}
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    localRequest(req);
    const { id } = await ctx.params;
    return json({
      attempt: publicAttempt(store(id).get(id)),
      serverTime: Date.now(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    localRequest(req);
    const { id } = await ctx.params;
    const raw = await req.json();
    localRequest(req);
    const { action } = z.object({ action: z.string() }).parse(raw);
    let a: Attempt;
    if (action === "events") {
      const body = z
        .object({ events: z.array(eventSchema).max(2000) })
        .parse(raw);
      a = store(id).append(id, body.events);
      scheduleBackgroundSolvingCheck(store(id), id);
    } else if (action === "complete") {
      agent().interruptAttemptBackground(id);
      a = store(id).transition(
        id,
        "complete",
        Date.now(),
        z
          .enum(["sufficient", "skipped", "manual"])
          .optional()
          .parse(raw.reason),
      );
    } else if (
      ["pause", "resume", "finish", "seal", "learn", "reflect"].includes(action)
    ) {
      if (action === "finish" || action === "seal")
        agent().interruptAttemptBackground(id);
      a = store(id).transition(id, action as "pause");
      if (action === "pause") scheduleBackgroundSolvingCheck(store(id), id);
    } else if (action === "job") {
      const job = jobSchema.parse(raw.job);
      a = store(id).get(id);
      const existing = a.jobs.find((j) => j.id === job.id);
      if (!existing) {
        if (a.phase !== "active")
          throw new Error("Judge requests must start during the assessment.");
        if (job.seq > a.lastSeq || job.source !== replay(a, job.seq))
          throw new Error("The judge snapshot does not match its recording.");
      } else if (
        existing.source !== job.source ||
        existing.seq !== job.seq ||
        existing.kind !== job.kind ||
        existing.input !== job.input
      )
        throw new Error("A judge request cannot change its original source.");
      const sha = createHash("sha256").update(job.source).digest("hex");
      if (job.sourceSha256 && job.sourceSha256 !== sha)
        throw new Error(
          "The judge source fingerprint does not match the saved snapshot.",
        );
      const merged = { ...existing, ...job, sourceSha256: sha };
      a.jobs = existing
        ? a.jobs.map((j) => (j.id === job.id ? merged : j))
        : [...a.jobs, merged];
      store(id).save(a);
      scheduleBackgroundSolvingCheck(store(id), id);
    } else if (action === "record-continuation") {
      const report = z
        .object({
          id: z.string().uuid(),
          date: z.iso.date(),
          minutes: z.number().int().min(1).max(1440).optional(),
          note: z.string().trim().min(1).max(1000).optional(),
        })
        .parse(raw.segment);
      a = store(id).recordContinuation(id, report);
    } else if (action === "reflection-intake") {
      const mode = z
        .enum(["continue", "defer", "skip-coaching"])
        .default("continue")
        .parse(raw.mode);
      a = saveReflectionIntake(store(id), id, raw.answers, undefined, mode);
    } else if (action === "skip-checkin") {
      const familiarity = z
        .enum(["new", "revisit", "solved"])
        .parse(raw.familiarity);
      a = skipReflectionCheckIn(store(id), id, familiarity);
    } else if (action === "exposure") {
      a = store(id).setExposure(
        id,
        z.enum(["new", "revisit", "solved"]).parse(raw.exposure),
      );
    } else if (action === "annotate") {
      const note = z
        .object({
          seq: z.number().int().nonnegative(),
          judgement: z.enum(["agree", "correct", "unsure"]),
          comment: z.string().max(3000),
          interpretationVisible: z.boolean(),
        })
        .parse(raw);
      a = store(id).get(id);
      if (!["review", "learn", "complete"].includes(a.phase))
        throw new Error("Review becomes available after the assessment.");
      if (note.seq > a.lastSeq) throw new Error("Unknown moment");
      a.annotations.push({
        ...note,
        interpretation: (
          a.evaluations.at(-1)?.moments ?? candidateMoments(a.events, a)
        ).find((m) => m.seq === note.seq)?.interpretation,
        evaluationRevision: a.evaluations.length - 1,
        id: randomUUID(),
        createdAt: Date.now(),
      });
      store(id).save(a);
    } else if (action === "answer") {
      a = store(id).get(id);
      if (a.phase !== "learn" || !a.evaluations.length)
        throw new Error("Open the follow-up exercise first.");
      if (a.followup)
        throw new Error("Your first response has already been preserved.");
      const answer = z.string().trim().min(1).max(20000).parse(raw.answer);
      a.followup = {
        answer,
        evaluationRevision: a.evaluations.length - 1,
        answeredAt: Date.now(),
      };
      store(id).save(a);
    } else if (action === "coached-code") {
      a = store(id).get(id);
      if (!a.followup?.feedback)
        throw new Error(
          "Complete the first response before editing with coaching.",
        );
      a.followup.coachedCode = z.string().max(200000).parse(raw.code);
      store(id).save(a);
    } else throw new Error("Unknown action");
    return json({ attempt: publicAttempt(a), serverTime: Date.now() });
  } catch (e) {
    return failure(e);
  }
}
