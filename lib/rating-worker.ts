import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { agent } from "./agents";
import { readAgentSettings, baselineAgentModel } from "./agent-settings-store";
import { resolveAgentChoice } from "./agent-settings";
import { attemptLanguage } from "./languages";
import type { AttemptStore } from "./store";
import type { Attempt } from "./types";
import {
  conceptOutcomeFromRubric,
  evaluateMissedTargetSelection,
  problemBaseDifficulty,
  resolvePrimaryDomain,
  scoresForRubricRow,
  standardMinutes,
  tagToSlug,
  timeAdjustedDifficulty,
  type AttemptGradedPayload,
  type ConceptRecord,
  type DomainFacetUpdate,
  type DomainId,
  type PracticeLaunchRow,
  type RubricRow,
} from "./skill-ratings";
import { domainIdSchema } from "./prescription-types";

const complexityVerdictSchema = z.enum(["accurate", "inaccurate", "unsure"]);

const attributionOutputSchema = z
  .object({
    rubricRow: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
    ]),
    accepted: z.boolean(),
    primaryDomain: domainIdSchema.optional(),
    secondaryDomain: domainIdSchema.optional(),
    usedOptimalAlternative: z.boolean().default(false),
    statedComplexity: z.object({
      time: complexityVerdictSchema,
      space: complexityVerdictSchema,
    }),
    conceptsApplied: z.array(z.string()).max(6).default([]),
    conceptsMissed: z.array(z.string()).max(6).default([]),
  })
  .strict();

export type AttributionOutput = z.infer<typeof attributionOutputSchema>;

const attributionPolicy = `Evaluate one completed timed coding assessment purely to attribute skill ratings (Track A) and concept mastery (Track B).
Return strictly JSON matching the schema:
- rubricRow (1..7 precedence, first match wins):
  1 = manual outside solution help during active solving (event.type==='assistance' without assistanceId)
  2 = accepted in timebox, optimal asymptotic complexity, <= 2 wrong submits
  3 = accepted in timebox, optimal asymptotic complexity, >= 3 wrong submits or minor overhead
  4 = accepted in timebox with suboptimal asymptotic complexity
  5 = unaccepted at deadline, sound core invariant with isolated boundary/syntax bug
  6 = unaccepted at deadline, partial/incomplete mechanics
  7 = no viable approach or fundamental invariant contradiction
- usedOptimalAlternative: true ONLY if targetFacet==='selection' and learner skipped the targeted Selection technique yet solved cleanly via an equally optimal alternative asymptotic class.
- statedComplexity: judge learner's stated timeComplexity and spaceComplexity from Check-In independently as "accurate", "inaccurate", or "unsure" (use "unsure" if skipped or blank/I'm not sure).
- conceptsApplied / conceptsMissed: list canonical concept slugs relevant to this attempt only when clearly evidenced.`;

export function buildAttemptGradedPayload(args: {
  attempt: Attempt;
  launch: PracticeLaunchRow;
  attribution: AttributionOutput;
  concepts: Map<string, ConceptRecord>;
  domainHasKnownConcept?: boolean;
}): AttemptGradedPayload {
  const { attempt, launch, attribution } = args;
  const tagSlugs = (attempt.problem.topicTags ?? []).map(tagToSlug);
  const resolvedPrimary =
    attribution.primaryDomain ??
    launch.provisionalDomain ??
    resolvePrimaryDomain(attempt.problem.titleSlug, tagSlugs);

  const hasManualOutsideHelp = attempt.events.some(
    (e) => e.type === "assistance" && !e.assistanceId,
  );
  const row: RubricRow = hasManualOutsideHelp ? 1 : attribution.rubricRow;
  const accepted =
    attribution.accepted ||
    attempt.jobs.some(
      (j) => j.kind === "submit" && j.summary?.verdict === "Accepted",
    );

  const rawDiff =
    launch.difficultyScore ??
    problemBaseDifficulty(
      attempt.problem.difficulty === "Easy" ||
        attempt.problem.difficulty === "Medium" ||
        attempt.problem.difficulty === "Hard"
        ? attempt.problem.difficulty
        : "Medium",
      attempt.problem.acRate ?? 55,
      launch.difficultyModifier ?? 0,
    );
  const stdMin = launch.standardMinutes ?? standardMinutes(rawDiff);
  const chosenMin = Math.max(10, Math.round(attempt.budgetMs / 60_000));
  const effDiff = timeAdjustedDifficulty(rawDiff, stdMin, chosenMin);

  const { implScore, selScore } = scoresForRubricRow(row, accepted);
  const updates: DomainFacetUpdate[] = [];

  if (
    attribution.secondaryDomain &&
    attribution.secondaryDomain !== resolvedPrimary
  ) {
    updates.push(
      { domain: resolvedPrimary, facet: "implementation", weight: 0.7, difficulty: effDiff, score: implScore },
      { domain: attribution.secondaryDomain, facet: "implementation", weight: 0.3, difficulty: effDiff, score: implScore },
    );
  } else {
    updates.push({
      domain: resolvedPrimary,
      facet: "implementation",
      weight: 1.0,
      difficulty: effDiff,
      score: implScore,
    });
  }

  const intent = launch.intent;
  const selectionDisabled =
    !intent ||
    intent.targetFacet !== "selection" ||
    Boolean(launch.selectionSpoilerRevealed) ||
    Boolean(intent.steeredDomainExplicit);

  if (!selectionDisabled && intent) {
    const targetDomain = intent.targetDomain;
    const targetSlug = intent.targetConceptSlug;
    const rec = targetSlug ? args.concepts.get(targetSlug) : undefined;
    if (row === 4 && targetDomain !== resolvedPrimary) {
      const check = evaluateMissedTargetSelection({
        usedOptimalComplexity: attribution.usedOptimalAlternative,
        targetConceptRecord: rec,
        domainHasKnownConcept: args.domainHasKnownConcept,
        hasTargetConcept: Boolean(targetSlug),
      });
      if (check.penalizeSelection) {
        updates.push({
          domain: targetDomain,
          facet: "selection",
          weight: 1.0,
          difficulty: effDiff,
          score: 0.2,
        });
      }
    } else if (!attribution.usedOptimalAlternative) {
      updates.push({
        domain: targetDomain,
        facet: "selection",
        weight: 1.0,
        difficulty: effDiff,
        score: selScore,
      });
    }
  }

  const familiarity: "new" | "revisit" | "solved" =
    attempt.exposure === "solved"
      ? "solved"
      : attempt.exposure === "revisit"
        ? "revisit"
        : "new";

  const statedComplexity =
    attempt.reflection?.checkInSkippedAt !== undefined || !attempt.reflection?.intake
      ? ({ time: "unsure", space: "unsure" } as const)
      : attribution.statedComplexity;

  const conceptOutcomes: NonNullable<AttemptGradedPayload["conceptOutcomes"]> = [];
  const seenSlugs = new Set<string>();
  const targetSlug = intent?.targetConceptSlug;
  if (targetSlug) {
    seenSlugs.add(targetSlug);
    const out = conceptOutcomeFromRubric({
      rubricRow: row,
      usedOptimalAlternative: attribution.usedOptimalAlternative,
      existing: args.concepts.get(targetSlug),
    });
    if (out !== "none") {
      conceptOutcomes.push({
        slug: targetSlug,
        domain: intent.targetDomain,
        outcome: out,
      });
    }
  }
  for (const s of attribution.conceptsApplied) {
    if (!seenSlugs.has(s)) {
      seenSlugs.add(s);
      conceptOutcomes.push({ slug: s, domain: resolvedPrimary, outcome: "applied" });
    }
  }
  for (const s of attribution.conceptsMissed) {
    if (!seenSlugs.has(s)) {
      seenSlugs.add(s);
      const ex = args.concepts.get(s);
      conceptOutcomes.push({
        slug: s,
        domain: ex?.domain ?? resolvedPrimary,
        outcome: ex && (ex.state === "coached" || ex.state === "applied") ? "lapsed" : "probed-uncoached",
      });
    }
  }

  return {
    updates,
    familiarity,
    primaryDomain: resolvedPrimary,
    statedComplexity,
    conceptOutcomes,
  };
}

export async function gradeAttemptWithAgent(
  db: AttemptStore,
  attempt: Attempt,
  launch: PracticeLaunchRow,
): Promise<AttemptGradedPayload> {
  const state = db.ratings.replayState();
  const choice = resolveAgentChoice(
    readAgentSettings(),
    "evaluator",
    baselineAgentModel(),
  );
  const submits = attempt.jobs.filter((j) => j.kind === "submit");
  const wrongSubmits = submits.filter(
    (j) => j.summary?.verdict && j.summary.verdict !== "Accepted",
  ).length;
  const accepted = submits.some((j) => j.summary?.verdict === "Accepted");
  const manualHelp = attempt.events.some(
    (e) => e.type === "assistance" && !e.assistanceId,
  );
  const res = await agent().run(
    "evaluator",
    attributionPolicy,
    {
      problem: {
        title: attempt.problem.title,
        slug: attempt.problem.titleSlug,
        difficulty: attempt.problem.difficulty,
        tags: attempt.problem.topicTags,
      },
      launch: {
        prescribed: launch.prescribed,
        rated: launch.rated,
        provisionalDomain: launch.provisionalDomain,
        intent: launch.intent,
      },
      verdict: { accepted, wrongSubmits, manualOutsideHelp: manualHelp },
      intake: attempt.reflection?.intake,
      checkInSkipped: attempt.reflection?.checkInSkippedAt !== undefined,
      source: attempt.source.slice(0, 12000),
    },
    z.toJSONSchema(attributionOutputSchema),
    attempt,
    choice,
    { language: attemptLanguage(attempt), traceKind: "rating-attribution" },
  );
  const parsed = attributionOutputSchema.parse(res.value);
  return buildAttemptGradedPayload({
    attempt,
    launch,
    attribution: parsed,
    concepts: state.concepts,
    domainHasKnownConcept:
      launch.intent
        ? [...state.concepts.values()].some(
            (c) =>
              c.domain === launch.intent!.targetDomain &&
              (c.state === "coached" || c.state === "applied"),
          )
        : false,
  });
}

const activeDrains = new WeakMap<
  DatabaseSync,
  Promise<{ completedJobIds: string[]; failedJobIds: string[] }>
>();

export type RatingGrader = (
  db: AttemptStore,
  attempt: Attempt,
  launch: PracticeLaunchRow,
) => Promise<AttemptGradedPayload>;

export async function drainPendingRatingJobs(
  db: AttemptStore,
  opts: {
    gradeFn?: RatingGrader;
    maxJobAttempts?: number;
    forceRetryFailed?: boolean;
    now?: number;
    leaseMs?: number;
    bypassSingleFlight?: boolean;
  } = {},
): Promise<{ completedJobIds: string[]; failedJobIds: string[] }> {
  if (!opts.bypassSingleFlight) {
    const existing = activeDrains.get(db.db);
    if (existing) return existing;
  }

  const run = (async () => {
    const gradeFn = opts.gradeFn ?? gradeAttemptWithAgent;
    const maxAttempts = opts.maxJobAttempts ?? 3;
    const nowBase = opts.now ?? Date.now();
    const leaseMs = opts.leaseMs ?? 30_000;
    const ownerId = `drain-${randomUUID()}`;

    const candidateRows = db.db
      .prepare(
        `SELECT j.attemptId, j.status, j.attempts, l.launchSeq, l.day
         FROM rating_jobs j
         JOIN practice_launches l ON l.attemptId = j.attemptId
         WHERE j.status = 'pending'
            OR (j.status = 'running' AND (j.claimExpiresAt IS NULL OR j.claimExpiresAt <= ?))
            OR (j.status = 'failed' AND (j.attempts < ? OR ? = 1))
         ORDER BY l.launchSeq ASC`,
      )
      .all(nowBase, maxAttempts, opts.forceRetryFailed ? 1 : 0) as Array<{
      attemptId: string;
      status: string;
      attempts: number;
      launchSeq: number;
      day: number;
    }>;

    const completedJobIds: string[] = [];
    const failedJobIds: string[] = [];

    for (const row of candidateRows) {
      const claimRes = db.db
        .prepare(
          `UPDATE rating_jobs
           SET status = 'running', attempts = attempts + 1, claimOwnerId = ?, claimExpiresAt = ?, updatedAt = ?
           WHERE attemptId = ?
             AND (
               status = 'pending'
               OR (status = 'running' AND (claimExpiresAt IS NULL OR claimExpiresAt <= ?))
               OR (status = 'failed' AND (attempts < ? OR ? = 1))
             )`,
        )
        .run(
          ownerId,
          nowBase + leaseMs,
          nowBase,
          row.attemptId,
          nowBase,
          maxAttempts,
          opts.forceRetryFailed ? 1 : 0,
        );
      if (claimRes.changes === 0) continue;

      const jobState = db.db
        .prepare("SELECT attempts, claimOwnerId FROM rating_jobs WHERE attemptId = ?")
        .get(row.attemptId) as { attempts: number; claimOwnerId: string | null } | undefined;
      if (!jobState || jobState.claimOwnerId !== ownerId) continue;

      let attempts = jobState.attempts;
      let done = false;
      while (!done) {
        try {
          const attempt = db.get(row.attemptId);
          const launch = db.ratings.getLaunch(row.attemptId);
          if (!launch) throw new Error("Missing launch record for rating job.");
          const payload = await gradeFn(db, attempt, launch);

          const ownerCheck = db.db
            .prepare("SELECT claimOwnerId FROM rating_jobs WHERE attemptId = ?")
            .get(row.attemptId) as { claimOwnerId: string | null } | undefined;
          if (ownerCheck?.claimOwnerId !== ownerId) break;

          db.transaction(() => {
            db.db
              .prepare(
                `INSERT OR IGNORE INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson)
                 VALUES (?, ?, ?, 'attempt-graded', ?, ?, ?, ?)`,
              )
              .run(
                `ev:${row.attemptId}`,
                row.attemptId,
                row.launchSeq,
                `graded:${row.attemptId}`,
                row.day,
                nowBase + attempts,
                JSON.stringify(payload),
              );
            db.db
              .prepare(
                `UPDATE rating_jobs
                 SET status = 'complete', lastError = NULL, claimOwnerId = NULL, claimExpiresAt = NULL, updatedAt = ?
                 WHERE attemptId = ? AND claimOwnerId = ?`,
              )
              .run(nowBase + attempts, row.attemptId, ownerId);
          });
          completedJobIds.push(row.attemptId);
          done = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const alreadyGraded = db.db
            .prepare("SELECT 1 FROM skill_rating_events WHERE attemptId = ? AND kind = 'attempt-graded'")
            .get(row.attemptId);
          if (alreadyGraded) {
            db.db
              .prepare(
                `UPDATE rating_jobs
                 SET status = 'complete', lastError = NULL, claimOwnerId = NULL, claimExpiresAt = NULL, updatedAt = ?
                 WHERE attemptId = ?`,
              )
              .run(nowBase + attempts, row.attemptId);
            completedJobIds.push(row.attemptId);
            done = true;
            break;
          }
          if (attempts >= maxAttempts) {
            db.db
              .prepare(
                `UPDATE rating_jobs
                 SET status = 'failed', lastError = ?, claimOwnerId = NULL, claimExpiresAt = NULL, updatedAt = ?
                 WHERE attemptId = ? AND claimOwnerId = ?`,
              )
              .run(msg.slice(0, 500), nowBase + attempts, row.attemptId, ownerId);
            failedJobIds.push(row.attemptId);
            break;
          }
          attempts += 1;
          db.db
            .prepare(
              `UPDATE rating_jobs
               SET attempts = ?, lastError = ?, claimExpiresAt = ?, updatedAt = ?
               WHERE attemptId = ? AND claimOwnerId = ?`,
            )
            .run(attempts, msg.slice(0, 500), nowBase + leaseMs, nowBase + attempts, row.attemptId, ownerId);
        }
      }
    }

    return { completedJobIds, failedJobIds };
  })();

  if (!opts.bypassSingleFlight) {
    activeDrains.set(db.db, run);
  }
  try {
    return await run;
  } finally {
    if (!opts.bypassSingleFlight && activeDrains.get(db.db) === run) {
      activeDrains.delete(db.db);
    }
  }
}

export function kickoffBackgroundRatingDrain(db: AttemptStore) {
  if (process.env.NODE_TEST_CONTEXT) return;
  void drainPendingRatingJobs(db).catch(() => {});
}
