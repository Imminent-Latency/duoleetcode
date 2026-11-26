import type { AttemptStore } from "./store";
import { dayFromTimestamp } from "./rating-store";
import {
  CONCEPT_CATALOGUE,
  DOMAIN_LABELS,
  DOMAINS,
  displayRating,
  formatComplexityStat,
  formatInitialRatingReveal,
  isDomainProvisional,
  isRatingRevealed,
  nextAssessmentGate,
  retrievability,
  shouldShowWelcomePicker,
} from "./skill-ratings";
import { getCatalogSyncStatus } from "./catalog-sync";

export function buildRatingProfile(db: AttemptStore, now = Date.now()) {
  const state = db.ratings.replayState();
  const day = dayFromTimestamp(now);
  const preferences = db.ratings.getPreferences();
  const onboarding = db.ratings.getOnboarding();
  const jobs = db.ratings.listJobs();
  const pendingJobs = jobs.filter((j) => j.status === "pending" || j.status === "running");
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const history = db.history();
  const gate = nextAssessmentGate(history);
  const deferredReflections = history
    .filter((a) => !a.demonstration && a.phase === "review" && a.reflection?.coachingDeferred)
    .map((a) => ({
      attemptId: a.id,
      title: a.problem.title,
      slug: a.problem.titleSlug,
      createdAt: a.createdAt,
    }));

  const domains = DOMAINS.map((id) => {
    const impl = displayRating(state, id, "implementation", day);
    const sel = displayRating(state, id, "selection", day);
    const raw = state.domains[id];
    return {
      id,
      label: DOMAIN_LABELS[id],
      implDisplay: Math.round(impl.display),
      implLatent: Math.round(impl.latent),
      implSigma: Math.round(impl.sigma),
      implProvisional: isDomainProvisional(impl.sigma),
      selDisplay: Math.round(sel.display),
      selLatent: Math.round(sel.latent),
      selSigma: Math.round(sel.sigma),
      selProvisional: isDomainProvisional(sel.sigma),
      rusty: impl.rusty,
      implAttempts: raw.implAttempts,
      lastDay: raw.lastDay,
    };
  });

  const concepts = CONCEPT_CATALOGUE.map((spec) => {
    const rec = state.concepts.get(spec.slug);
    const R = rec
      ? Number(retrievability(day - rec.lastEvaluatedDay, rec.stabilityDays).toFixed(2))
      : null;
    return {
      order: spec.order,
      slug: spec.slug,
      label: spec.label,
      domain: spec.domain,
      domainLabel: DOMAIN_LABELS[spec.domain],
      minGlobalMu: spec.minGlobalMu,
      state: rec?.state ?? "unseen",
      stabilityDays: rec ? Number(rec.stabilityDays.toFixed(1)) : 0,
      retrievability: R,
      reps: rec?.reps ?? 0,
      lapses: rec?.lapses ?? 0,
      probeCount: rec?.probeCount ?? 0,
    };
  });

  const revealed = isRatingRevealed(state);
  const showWelcomePicker = shouldShowWelcomePicker({
    welcomeDismissed: onboarding.welcomeDismissed,
    prescribedCount: state.prescribedCount,
  });

  return {
    revealed,
    prescribedCount: state.prescribedCount,
    prescribedGradedCount: state.prescribedGradedCount,
    calibrationTarget: 4,
    revealText: formatInitialRatingReveal(state),
    globalMu: Math.round(state.globalMu),
    globalSigma: Math.round(state.globalSigma),
    consecutiveMisses: state.consecutiveMisses,
    complexityCalibration: {
      time: {
        ...state.complexityCalibration.time,
        formatted: formatComplexityStat(state.complexityCalibration.time),
      },
      space: {
        ...state.complexityCalibration.space,
        formatted: formatComplexityStat(state.complexityCalibration.space),
      },
    },
    domains,
    concepts,
    preferences,
    onboarding: {
      ...onboarding,
      showWelcomePicker,
    },
    pendingJobCount: pendingJobs.length,
    failedJobCount: failedJobs.length,
    failedJobs,
    gate,
    deferredReflections,
    catalogSync: getCatalogSyncStatus(db, now),
  };
}
