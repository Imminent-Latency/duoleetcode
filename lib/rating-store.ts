import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { LanguageId } from "./languages";
import {
  DEFAULT_STARTING_TIER,
  EXCLUDED_LIST_SLUGS,
  isSignatureForcedFromSlugs,
  isTitleDisguisedForTarget,
  mergeRatingSnapshots,
  problemBaseDifficulty,
  replayRatingLedger,
  resolvePrimaryDomain,
  validateDirectorPreferences,
  type CatalogProblemRow,
  type CatalogSyncState,
  type ConceptEventPayload,
  type DirectorPreferences,
  type DomainId,
  type LearnerRatingState,
  type OnboardingState,
  type PracticeLaunchRow,
  type PrescriptionIntent,
  type RatingJobRow,
  type RatingLedgerSnapshot,
  type ReflectionRescuePayload,
  type SkillRatingEventRow,
} from "./skill-ratings";

export type RatingLibrarySnapshot = RatingLedgerSnapshot & {
  preferences?: DirectorPreferences;
  onboarding?: OnboardingState;
};

export type CatalogQuestionInput = {
  questionFrontendId?: string | number;
  title: string;
  titleSlug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  acRate?: number;
  isPaidOnly?: boolean;
  status?: "ac" | "notac" | string | null;
  topicTags?: Array<{ name: string; slug?: string }>;
};

export const dayFromTimestamp = (ms: number) => Math.floor(ms / 86_400_000);

export class RatingStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly isSandbox = false,
  ) {}

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS practice_launches (
        attemptId TEXT PRIMARY KEY,
        launchSeq INTEGER NOT NULL UNIQUE,
        day INTEGER NOT NULL,
        startedAt INTEGER NOT NULL DEFAULT 0,
        prescribed INTEGER NOT NULL,
        rated INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'java',
        provisionalDomain TEXT NOT NULL,
        difficultyScore INTEGER,
        difficultyModifier INTEGER,
        standardMinutes INTEGER,
        prescribedMinutes INTEGER,
        intentJson TEXT,
        selectionSpoilerRevealed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rating_jobs (
        attemptId TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'complete', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        claimOwnerId TEXT,
        claimExpiresAt INTEGER,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skill_rating_events (
        id TEXT PRIMARY KEY,
        attemptId TEXT NOT NULL,
        launchSeq INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('attempt-graded', 'compensating-recompute', 'reflection-rescue', 'concept-event')),
        idempotencyKey TEXT NOT NULL UNIQUE,
        occurredDay INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        payloadJson TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_rating_events_attempt_graded
        ON skill_rating_events(attemptId)
        WHERE kind = 'attempt-graded';
      CREATE TABLE IF NOT EXISTS catalog_problems (
        slug TEXT PRIMARY KEY,
        frontendId TEXT NOT NULL,
        title TEXT NOT NULL,
        difficulty TEXT NOT NULL CHECK(difficulty IN ('Easy', 'Medium', 'Hard')),
        acRate REAL NOT NULL,
        isPaidOnly INTEGER NOT NULL,
        status TEXT,
        topicTagSlugsJson TEXT NOT NULL,
        resolvedDomain TEXT NOT NULL,
        baseDifficulty INTEGER NOT NULL,
        signatureForced INTEGER NOT NULL DEFAULT 0,
        excluded INTEGER NOT NULL,
        fetchedAt INTEGER NOT NULL
      );
    `);
  }

  private readMeta<T>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM library_meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  private writeMeta(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO library_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value));
  }

  getPreferences(): DirectorPreferences {
    const saved = this.readMeta<DirectorPreferences>("director_preferences");
    if (!saved) return { focusDomains: [], mutedDomains: [] };
    try {
      return validateDirectorPreferences({
        focusDomains: saved.focusDomains ?? [],
        mutedDomains: saved.mutedDomains ?? [],
        maxMinutes: saved.maxMinutes,
      });
    } catch {
      return { focusDomains: [], mutedDomains: [] };
    }
  }

  setPreferences(prefs: DirectorPreferences): DirectorPreferences {
    const validated = validateDirectorPreferences(prefs);
    this.writeMeta("director_preferences", validated);
    return validated;
  }

  getOnboarding(): OnboardingState {
    const saved = this.readMeta<Partial<OnboardingState>>("onboarding_state");
    return {
      startingTier:
        saved?.startingTier === "foundations" ||
        saved?.startingTier === "interview-prep" ||
        saved?.startingTier === "experienced"
          ? saved.startingTier
          : DEFAULT_STARTING_TIER,
      welcomeDismissed: Boolean(saved?.welcomeDismissed),
    };
  }

  setOnboarding(patch: Partial<OnboardingState>): OnboardingState {
    const next: OnboardingState = { ...this.getOnboarding(), ...patch };
    this.writeMeta("onboarding_state", next);
    return next;
  }

  getCatalogSyncState(): CatalogSyncState {
    const saved = this.readMeta<Partial<CatalogSyncState>>("catalog_sync_state");
    return {
      nextSkip: saved?.nextSkip ?? 0,
      totalNum: saved?.totalNum ?? null,
      lastCompletedAt: saved?.lastCompletedAt ?? null,
      consecutiveErrors: saved?.consecutiveErrors ?? 0,
      backoffMs: saved?.backoffMs ?? 0,
      backoffUntil: saved?.backoffUntil ?? null,
      lastError: saved?.lastError ?? null,
    };
  }

  saveCatalogSyncState(state: CatalogSyncState): CatalogSyncState {
    this.writeMeta("catalog_sync_state", state);
    return state;
  }

  recordLaunch(args: {
    attemptId: string;
    startedAt: number;
    prescribed: boolean;
    rated: boolean;
    language: LanguageId;
    provisionalDomain: DomainId;
    difficultyScore?: number;
    difficultyModifier?: number;
    standardMinutes?: number;
    prescribedMinutes?: number;
    intent?: PrescriptionIntent;
    selectionSpoilerRevealed?: boolean;
  }): PracticeLaunchRow {
    const maxRow = this.db
      .prepare("SELECT COALESCE(MAX(launchSeq), 0) AS m FROM practice_launches")
      .get() as { m: number };
    const launchSeq = Number(maxRow?.m ?? 0) + 1;
    const day = dayFromTimestamp(args.startedAt);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO practice_launches(
          attemptId, launchSeq, day, startedAt, prescribed, rated, language,
          provisionalDomain, difficultyScore, difficultyModifier, standardMinutes,
          prescribedMinutes, intentJson, selectionSpoilerRevealed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.attemptId,
        launchSeq,
        day,
        args.startedAt,
        args.prescribed ? 1 : 0,
        args.rated ? 1 : 0,
        args.language,
        args.provisionalDomain,
        args.difficultyScore ?? null,
        args.difficultyModifier ?? null,
        args.standardMinutes ?? null,
        args.prescribedMinutes ?? null,
        args.intent ? JSON.stringify(args.intent) : null,
        args.selectionSpoilerRevealed ? 1 : 0,
      );
    return {
      attemptId: args.attemptId,
      launchSeq,
      day,
      startedAt: args.startedAt,
      prescribed: args.prescribed,
      rated: args.rated,
      language: args.language,
      provisionalDomain: args.provisionalDomain,
      difficultyScore: args.difficultyScore,
      difficultyModifier: args.difficultyModifier,
      standardMinutes: args.standardMinutes,
      prescribedMinutes: args.prescribedMinutes,
      intent: args.intent,
      selectionSpoilerRevealed: args.selectionSpoilerRevealed,
    };
  }

  markSpoilerRevealed(attemptId: string) {
    this.db
      .prepare("UPDATE practice_launches SET selectionSpoilerRevealed = 1 WHERE attemptId = ?")
      .run(attemptId);
  }

  enqueueRatingJob(attemptId: string, now = Date.now()) {
    if (this.isSandbox) return;
    const launch = this.getLaunch(attemptId);
    if (!launch) return;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO rating_jobs(attemptId, status, attempts, lastError, claimOwnerId, claimExpiresAt, updatedAt)
         VALUES (?, 'pending', 0, NULL, NULL, NULL, ?)`,
      )
      .run(attemptId, now);
  }

  listLaunches(): PracticeLaunchRow[] {
    const rows = this.db
      .prepare("SELECT * FROM practice_launches ORDER BY launchSeq ASC")
      .all() as Array<Record<string, any>>;
    return rows.map((r) => ({
      attemptId: r.attemptId,
      launchSeq: Number(r.launchSeq),
      day: Number(r.day),
      startedAt: Number(r.startedAt ?? 0),
      prescribed: Boolean(r.prescribed),
      rated: Boolean(r.rated),
      language: (r.language as LanguageId) ?? "java",
      provisionalDomain: r.provisionalDomain as DomainId,
      ...(r.difficultyScore != null ? { difficultyScore: Number(r.difficultyScore) } : {}),
      ...(r.difficultyModifier != null ? { difficultyModifier: Number(r.difficultyModifier) } : {}),
      ...(r.standardMinutes != null ? { standardMinutes: Number(r.standardMinutes) } : {}),
      ...(r.prescribedMinutes != null ? { prescribedMinutes: Number(r.prescribedMinutes) } : {}),
      ...(r.intentJson ? { intent: JSON.parse(r.intentJson) as PrescriptionIntent } : {}),
      ...(r.selectionSpoilerRevealed ? { selectionSpoilerRevealed: true } : {}),
    }));
  }

  getLaunch(attemptId: string): PracticeLaunchRow | undefined {
    const r = this.db
      .prepare("SELECT * FROM practice_launches WHERE attemptId = ?")
      .get(attemptId) as Record<string, any> | undefined;
    if (!r) return undefined;
    return {
      attemptId: r.attemptId,
      launchSeq: Number(r.launchSeq),
      day: Number(r.day),
      startedAt: Number(r.startedAt ?? 0),
      prescribed: Boolean(r.prescribed),
      rated: Boolean(r.rated),
      language: (r.language as LanguageId) ?? "java",
      provisionalDomain: r.provisionalDomain as DomainId,
      ...(r.difficultyScore != null ? { difficultyScore: Number(r.difficultyScore) } : {}),
      ...(r.difficultyModifier != null ? { difficultyModifier: Number(r.difficultyModifier) } : {}),
      ...(r.standardMinutes != null ? { standardMinutes: Number(r.standardMinutes) } : {}),
      ...(r.prescribedMinutes != null ? { prescribedMinutes: Number(r.prescribedMinutes) } : {}),
      ...(r.intentJson ? { intent: JSON.parse(r.intentJson) as PrescriptionIntent } : {}),
      ...(r.selectionSpoilerRevealed ? { selectionSpoilerRevealed: true } : {}),
    };
  }

  listJobs(): RatingJobRow[] {
    const rows = this.db
      .prepare("SELECT * FROM rating_jobs ORDER BY updatedAt ASC, attemptId ASC")
      .all() as Array<Record<string, any>>;
    return rows.map((r) => ({
      attemptId: r.attemptId,
      status: r.status as RatingJobRow["status"],
      attempts: Number(r.attempts),
      lastError: r.lastError ?? null,
      claimOwnerId: r.claimOwnerId ?? null,
      claimExpiresAt: r.claimExpiresAt != null ? Number(r.claimExpiresAt) : null,
      updatedAt: Number(r.updatedAt),
    }));
  }

  listEvents(): SkillRatingEventRow[] {
    const rows = this.db
      .prepare("SELECT * FROM skill_rating_events ORDER BY launchSeq ASC, createdAt ASC, id ASC")
      .all() as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id,
      attemptId: r.attemptId,
      launchSeq: Number(r.launchSeq),
      kind: r.kind as SkillRatingEventRow["kind"],
      idempotencyKey: r.idempotencyKey,
      occurredDay: Number(r.occurredDay),
      createdAt: Number(r.createdAt),
      payload: JSON.parse(r.payloadJson),
    }));
  }

  replayState(): LearnerRatingState {
    return replayRatingLedger(this.listLaunches(), this.listEvents());
  }

  appendReflectionRescue(
    attemptId: string,
    payload: ReflectionRescuePayload,
    now = Date.now(),
    suffix = randomUUID(),
  ) {
    const launch = this.getLaunch(attemptId);
    if (!launch || !launch.rated) return;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson)
         VALUES (?, ?, ?, 'reflection-rescue', ?, ?, ?, ?)`,
      )
      .run(
        `rescue:${randomUUID()}`,
        attemptId,
        launch.launchSeq,
        `rescue:${attemptId}:${suffix}`,
        dayFromTimestamp(now),
        now,
        JSON.stringify(payload),
      );
  }

  appendConceptEvent(
    attemptId: string,
    payload: ConceptEventPayload,
    now = Date.now(),
    idempotencyKey?: string,
  ) {
    const launch = this.getLaunch(attemptId);
    if (!launch || !launch.rated) return;
    const key = idempotencyKey ?? `concept:${attemptId}:${payload.slug}:${payload.outcome}:${dayFromTimestamp(now)}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson)
         VALUES (?, ?, ?, 'concept-event', ?, ?, ?, ?)`,
      )
      .run(
        `ce:${randomUUID()}`,
        attemptId,
        launch.launchSeq,
        key,
        dayFromTimestamp(now),
        now,
        JSON.stringify(payload),
      );
  }

  coachedRevisitSlugs(nowDay: number, minAgeDays = 5, slugForAttempt?: Map<string, string>): Set<string> {
    const out = new Set<string>();
    const cutoff = nowDay - minAgeDays;
    for (const ev of this.listEvents()) {
      if (ev.occurredDay > cutoff) continue;
      if (ev.kind === "reflection-rescue") {
        const s = slugForAttempt?.get(ev.attemptId);
        if (s) out.add(s);
      } else if (ev.kind === "attempt-graded") {
        const s = slugForAttempt?.get(ev.attemptId);
        if (s) out.add(s);
      }
    }
    return out;
  }

  upsertCatalogPage(questions: CatalogQuestionInput[], fetchedAt = Date.now()): number {
    const stmt = this.db.prepare(
      `INSERT INTO catalog_problems(
        slug, frontendId, title, difficulty, acRate, isPaidOnly, status,
        topicTagSlugsJson, resolvedDomain, baseDifficulty, signatureForced, excluded, fetchedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        frontendId = excluded.frontendId,
        title = excluded.title,
        difficulty = excluded.difficulty,
        acRate = excluded.acRate,
        isPaidOnly = excluded.isPaidOnly,
        status = excluded.status,
        topicTagSlugsJson = excluded.topicTagSlugsJson,
        resolvedDomain = excluded.resolvedDomain,
        baseDifficulty = excluded.baseDifficulty,
        signatureForced = excluded.signatureForced,
        excluded = excluded.excluded,
        fetchedAt = excluded.fetchedAt`,
    );
    let count = 0;
    for (const q of questions) {
      if (!q?.titleSlug || !q?.title) continue;
      const diff = q.difficulty === "Easy" || q.difficulty === "Medium" || q.difficulty === "Hard"
        ? q.difficulty
        : "Medium";
      const tagSlugs = (q.topicTags ?? []).map((t) => t.slug ?? t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
      const excluded = tagSlugs.some((s) => EXCLUDED_LIST_SLUGS.has(s));
      const resolvedDomain = resolvePrimaryDomain(q.titleSlug, tagSlugs);
      const acRate = Number.isFinite(q.acRate) ? Number(q.acRate) : 55;
      const baseDifficulty = problemBaseDifficulty(diff, acRate);
      const signatureForced = isSignatureForcedFromSlugs(tagSlugs);
      stmt.run(
        q.titleSlug,
        String(q.questionFrontendId ?? ""),
        q.title,
        diff,
        acRate,
        q.isPaidOnly ? 1 : 0,
        q.status ?? null,
        JSON.stringify(tagSlugs),
        resolvedDomain,
        baseDifficulty,
        signatureForced ? 1 : 0,
        excluded ? 1 : 0,
        fetchedAt,
      );
      count += 1;
    }
    return count;
  }

  catalogCount(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS c FROM catalog_problems").get() as { c: number };
    return Number(r?.c ?? 0);
  }

  getCatalogProblems(): CatalogProblemRow[] {
    const rows = this.db
      .prepare("SELECT * FROM catalog_problems")
      .all() as Array<Record<string, any>>;
    return rows.map((r) => ({
      slug: r.slug,
      frontendId: r.frontendId,
      title: r.title,
      difficulty: r.difficulty as CatalogProblemRow["difficulty"],
      acRate: Number(r.acRate),
      isPaidOnly: Boolean(r.isPaidOnly),
      status: (r.status === "ac" || r.status === "notac" ? r.status : null),
      topicTagSlugs: JSON.parse(r.topicTagSlugsJson) as string[],
      resolvedDomain: r.resolvedDomain as DomainId,
      difficultyScore: Number(r.baseDifficulty),
      signatureForced: Boolean(r.signatureForced),
      excluded: Boolean(r.excluded),
    }));
  }

  getDisguisableCounts(isPremium: boolean): Partial<Record<DomainId, number>> | undefined {
    const rows = this.getCatalogProblems();
    if (rows.length < 50) return undefined;
    const counts: Partial<Record<DomainId, number>> = {};
    for (const p of rows) {
      if (p.excluded) continue;
      if (!isPremium && p.isPaidOnly) continue;
      if (p.signatureForced) continue;
      if (!isTitleDisguisedForTarget(p.title, p.resolvedDomain)) continue;
      counts[p.resolvedDomain] = (counts[p.resolvedDomain] ?? 0) + 1;
    }
    return counts;
  }

  exportSnapshot(): RatingLibrarySnapshot {
    return structuredClone({
      launches: this.listLaunches(),
      ratingJobs: this.listJobs().map((j) => ({
        ...j,
        status: j.status === "running" ? ("pending" as const) : j.status,
        claimOwnerId: null,
        claimExpiresAt: null,
      })),
      ratingEvents: this.listEvents(),
      preferences: this.getPreferences(),
      onboarding: this.getOnboarding(),
    });
  }

  replaceSnapshot(snapshot: RatingLibrarySnapshot | undefined, mergeWithExisting = false, replaceConflicts = true) {
    const incoming: RatingLedgerSnapshot = {
      launches: snapshot?.launches ?? [],
      ratingJobs: snapshot?.ratingJobs ?? [],
      ratingEvents: snapshot?.ratingEvents ?? [],
    };
    const finalLedger = mergeWithExisting
      ? mergeRatingSnapshots(this.exportSnapshot(), incoming, replaceConflicts)
      : incoming;

    this.db.exec("DELETE FROM skill_rating_events; DELETE FROM rating_jobs; DELETE FROM practice_launches;");
    const insLaunch = this.db.prepare(
      `INSERT INTO practice_launches(
        attemptId, launchSeq, day, startedAt, prescribed, rated, language, provisionalDomain,
        difficultyScore, difficultyModifier, standardMinutes, prescribedMinutes, intentJson, selectionSpoilerRevealed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of finalLedger.launches) {
      insLaunch.run(
        l.attemptId,
        l.launchSeq,
        l.day,
        l.startedAt ?? l.day * 86_400_000,
        l.prescribed ? 1 : 0,
        (l.rated ?? l.prescribed) ? 1 : 0,
        l.language ?? "java",
        l.provisionalDomain,
        l.difficultyScore ?? null,
        l.difficultyModifier ?? null,
        l.standardMinutes ?? null,
        l.prescribedMinutes ?? null,
        l.intent ? JSON.stringify(l.intent) : null,
        l.selectionSpoilerRevealed ? 1 : 0,
      );
    }
    const insJob = this.db.prepare(
      `INSERT INTO rating_jobs(attemptId, status, attempts, lastError, claimOwnerId, claimExpiresAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const j of finalLedger.ratingJobs) {
      insJob.run(
        j.attemptId,
        j.status === "running" ? "pending" : j.status,
        j.attempts,
        j.lastError ?? null,
        null,
        null,
        j.updatedAt,
      );
    }
    const insEvent = this.db.prepare(
      `INSERT INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of finalLedger.ratingEvents) {
      insEvent.run(
        e.id,
        e.attemptId,
        e.launchSeq,
        e.kind,
        e.idempotencyKey,
        e.occurredDay,
        e.createdAt,
        JSON.stringify(e.payload),
      );
    }
    if (snapshot?.preferences) {
      this.setPreferences(snapshot.preferences);
    } else if (!mergeWithExisting) {
      this.db.prepare("DELETE FROM library_meta WHERE key = 'director_preferences'").run();
    }
    if (snapshot?.onboarding) {
      this.setOnboarding(snapshot.onboarding);
    } else if (!mergeWithExisting) {
      this.db.prepare("DELETE FROM library_meta WHERE key = 'onboarding_state'").run();
    }
  }
}
