import { test } from "node:test";
import assert from "node:assert/strict";
import { database, store } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { GET as getState, POST as createAttempt } from "../app/api/state/route";
import { POST as mutateAttempt } from "../app/api/attempts/[id]/route";
import { GET as getRatings, POST as postRatings } from "../app/api/ratings/route";
import { GET as getSync, POST as postSync } from "../app/api/catalog-sync/route";
import {
  answerCatalogRequest,
  listSavedPrescriptionsById,
  prescriptionContextKeyForIntent,
  prescriptionStatus,
  startPrescription,
} from "../lib/prescription";
import { drainPendingRatingJobs } from "../lib/rating-worker";
import {
  captureSnapshot,
  parseSnapshot,
  projectOperation,
  replaceLibrary,
} from "../lib/snapshots";
import { selectEverything } from "../lib/snapshot-types";

process.env.DUO_DATABASE = ":memory:";

const makeRequest = (urlPath: string, body?: unknown) =>
  new Request(`http://127.0.0.1:4318${urlPath}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "127.0.0.1:4318",
      origin: "http://127.0.0.1:4318",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const twoSum = {
  ...demoProblem,
  questionId: "1",
  questionFrontendId: "1",
  title: "Two Sum",
  titleSlug: "two-sum",
  difficulty: "Easy",
  acRate: 55,
  topicTags: [{ name: "Hash Table", slug: "hash-table" }],
  locked: false,
};

const containsDuplicate = {
  ...demoProblem,
  questionId: "217",
  questionFrontendId: "217",
  title: "Contains Duplicate",
  titleSlug: "contains-duplicate",
  difficulty: "Easy",
  acRate: 63,
  topicTags: [{ name: "Hash Table", slug: "hash-table" }],
  locked: false,
};

test("integration: SQLite schema v4, fail-closed rated flag, Check-In gate actions, and single-flight atomic drain", async () => {
  const db = database();
  // Clean in-memory practice DB before test
  db.db.exec(
    "DELETE FROM events; DELETE FROM checkpoints; DELETE FROM attempts; DELETE FROM skill_rating_events; DELETE FROM rating_jobs; DELETE FROM practice_launches; DELETE FROM catalog_problems; DELETE FROM library_meta WHERE key IN ('director_preferences', 'onboarding_state', 'catalog_sync_state');",
  );

  // Welcome picker defaults to foundations & ignores bundled historySeed (F3, F2)
  const initState = await (await getState(makeRequest("/api/state"))).json();
  assert.equal(initState.ratings.onboarding.startingTier, "foundations");
  assert.equal(initState.ratings.onboarding.showWelcomePicker, true);

  // Self-picked catalog launch (no prescriptionId) persists rated = false (F17)
  const selfRes = await createAttempt(
    makeRequest("/api/state", {
      problem: twoSum,
      budgetMs: 20 * 60_000,
      language: "java",
    }),
  );
  assert.equal(selfRes.status, 200);
  const selfAttempt = (await selfRes.json()).attempt;
  const selfLaunch = db.ratings.getLaunch(selfAttempt.id);
  assert.equal(selfLaunch?.prescribed, false);
  assert.equal(selfLaunch?.rated, false);

  // Finish session -> sealed review without check-in blocks NEXT problem AND rejects raw 'complete' (F2)
  await mutateAttempt(makeRequest(`/api/attempts/${selfAttempt.id}`, { action: "finish" }), {
    params: Promise.resolve({ id: selfAttempt.id }),
  });
  const blockedNext = await createAttempt(
    makeRequest("/api/state", { problem: containsDuplicate, budgetMs: 15 * 60_000 }),
  );
  assert.equal(blockedNext.status, 400);
  const blockedComplete = await mutateAttempt(
    makeRequest(`/api/attempts/${selfAttempt.id}`, { action: "complete" }),
    { params: Promise.resolve({ id: selfAttempt.id }) },
  );
  assert.equal(blockedComplete.status, 400);

  // 1-tap Skip Check-In requires familiarity and unlocks next problem while queuing rating_job (F4)
  const badSkip = await mutateAttempt(
    makeRequest(`/api/attempts/${selfAttempt.id}`, { action: "skip-checkin" }),
    { params: Promise.resolve({ id: selfAttempt.id }) },
  );
  assert.equal(badSkip.status, 400);

  const okSkip = await mutateAttempt(
    makeRequest(`/api/attempts/${selfAttempt.id}`, {
      action: "skip-checkin",
      familiarity: "new",
    }),
    { params: Promise.resolve({ id: selfAttempt.id }) },
  );
  assert.equal(okSkip.status, 200);
  const skippedAttempt = (await okSkip.json()).attempt;
  assert.equal(skippedAttempt.phase, "complete");
  assert.ok(skippedAttempt.reflection.checkInSkippedAt);

  // Concurrent single-flight drain grades once (even with 2 concurrent drain calls) & self-pick gives 0 rating/concept change!
  let gradeCalls = 0;
  const [d1, d2] = await Promise.all([
    drainPendingRatingJobs(db, {
      gradeFn: async () => {
        gradeCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return {
          updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 920, score: 1 }],
          familiarity: "new",
          primaryDomain: "hashing-prefix",
          statedComplexity: { time: "unsure", space: "unsure" },
          conceptOutcomes: [{ slug: "hash-map-set", domain: "hashing-prefix", outcome: "applied" }],
        };
      },
    }),
    drainPendingRatingJobs(db, {
      gradeFn: async () => {
        gradeCalls += 1;
        return {
          updates: [],
          familiarity: "new",
          primaryDomain: "hashing-prefix",
        };
      },
    }),
  ]);
  assert.equal(gradeCalls, 1);
  assert.deepEqual(d1, d2);
  const afterSelf = db.ratings.replayState();
  assert.equal(afterSelf.globalMu, 1000); // Self-pick NEVER alters ratings!
  assert.equal(afterSelf.concepts.size, 0); // Self-pick NEVER inflates concepts!
  assert.equal(afterSelf.lastPracticedDomain, "hashing-prefix"); // Light prevDomain cooldown preserved!
  assert.equal(afterSelf.complexityCalibration.time.unsure, 1);
});

test("integration: prescribed launch manual timebox cap (±5m), stale conflict (409), check-in defer, and catalog sync", async () => {
  const db = database();
  db.db.exec(
    "DELETE FROM events; DELETE FROM checkpoints; DELETE FROM attempts; DELETE FROM skill_rating_events; DELETE FROM rating_jobs; DELETE FROM practice_launches; DELETE FROM catalog_problems; DELETE FROM memory_uses; DELETE FROM library_meta WHERE key IN ('director_preferences', 'onboarding_state', 'catalog_sync_state');",
  );

  // Catalog sync ingest + error backoff + signatureForced tagging (F13, F18)
  const sync1 = await (
    await postSync(
      makeRequest("/api/catalog-sync", {
        action: "ingest-page",
        skip: 0,
        totalNum: 3,
        questions: [
          {
            questionFrontendId: "217",
            title: "Contains Duplicate",
            titleSlug: "contains-duplicate",
            difficulty: "Easy",
            acRate: 63,
            isPaidOnly: false,
            topicTags: [{ name: "Hash Table", slug: "hash-table" }],
          },
          {
            questionFrontendId: "104",
            title: "Maximum Depth of Binary Tree",
            titleSlug: "maximum-depth-of-binary-tree",
            difficulty: "Easy",
            acRate: 77,
            isPaidOnly: false,
            topicTags: [{ name: "Binary Tree", slug: "binary-tree" }],
          },
        ],
      }),
    )
  ).json();
  assert.equal(sync1.nextSkip, 2);
  assert.equal(sync1.catalogCount, 2);
  const treeRow = db.ratings.getCatalogProblems().find((p) => p.slug === "maximum-depth-of-binary-tree");
  assert.equal(treeRow?.signatureForced, true);

  const errSync = await (
    await postSync(makeRequest("/api/catalog-sync", { action: "record-error", error: "429" }))
  ).json();
  assert.equal(errSync.nextSkip, 2);
  assert.equal(errSync.backoffMs, 1000);
  const checkSync = await (await getSync(makeRequest("/api/catalog-sync"))).json();
  assert.equal(checkSync.nextSkip, 2);

  // Generate a prescribed pick in cpp
  const choice = { model: "fixture", effort: "low" };
  startPrescription(
    db,
    false,
    {
      choice,
      skipDrain: true,
      run: async (input: any, tools) => {
        const pick = input.shortlist[0];
        await tools.handle("inspect_problem", { slug: pick.slug });
        return {
          value: {
            slug: pick.slug,
            reason: "Calibrate hashing implementation under a clean timed constraint.",
            minutes: 15,
            difficultyModifier: 0,
            kind: "new-challenge",
            evidenceIds: [],
            disguiseVerified: true,
          },
          ...choice,
        };
      },
    },
    "cpp",
  );
  for (let i = 0; i < 50; i++) {
    const st = prescriptionStatus(db, choice, "cpp");
    if (st.job?.state !== "running") break;
    for (const r of st.job.requests) {
      answerCatalogRequest(db, st.job.id, r.id, containsDuplicate);
    }
    await new Promise((r) => setImmediate(r));
  }
  const rx = prescriptionStatus(db, choice, "cpp").prescription!;
  assert.equal(rx.slug, "contains-duplicate");

  // Mismatched language or unknown prescriptionId -> 409 Conflict (F15)
  const wrongLang = await createAttempt(
    makeRequest("/api/state", {
      problem: containsDuplicate,
      budgetMs: 15 * 60_000,
      language: "java",
      prescriptionId: rx.id,
    }),
  );
  assert.equal(wrongLang.status, 409);

  // Stale preferences (changed after prescription) within 48h STILL honor saved intent as rated!
  await postRatings(
    makeRequest("/api/ratings", {
      action: "set-preferences",
      preferences: { focusDomains: ["graphs-search"], mutedDomains: [] },
    }),
  );

  // Launch within ±5m (e.g. 20m vs 15m) stays rated; > ±5m (e.g. 30m) would mark rated=false
  const okLaunch = await createAttempt(
    makeRequest("/api/state", {
      problem: containsDuplicate,
      budgetMs: 20 * 60_000,
      language: "cpp",
      prescriptionId: rx.id,
    }),
  );
  assert.equal(okLaunch.status, 200);
  const a1 = (await okLaunch.json()).attempt;
  assert.equal(a1.prescription.rated, true);
  assert.equal(db.ratings.getLaunch(a1.id)?.language, "cpp");
  assert.equal(db.ratings.getLaunch(a1.id)?.rated, true);

  // Defer coaching ("Come back later") settles check-in and unblocks next start + lists deferredReflections!
  await mutateAttempt(makeRequest(`/api/attempts/${a1.id}`, { action: "finish" }), {
    params: Promise.resolve({ id: a1.id }),
  });
  await mutateAttempt(
    makeRequest(`/api/attempts/${a1.id}`, {
      action: "reflection-intake",
      mode: "defer",
      answers: {
        id: crypto.randomUUID(),
        familiarity: "new",
        timeComplexity: "O(n)",
        spaceComplexity: "O(n)",
      },
    }),
    { params: Promise.resolve({ id: a1.id }) },
  );
  const profile = await (await getRatings(makeRequest("/api/ratings"))).json();
  assert.equal(profile.gate.allowed, true);
  assert.equal(profile.deferredReflections.length, 1);

  // Snapshot round-trip preserves launches, jobs, events, preferences & onboarding
  const sandbox = database("sandbox");
  const snap = parseSnapshot(
    captureSnapshot(db, sandbox, { settings: null, browser: {}, pagesPreview: null }, "Integration"),
  );
  assert.equal(snap.practice.ratings?.launches.length, 1);
  const projected = projectOperation(snap, snap, {
    action: "restore",
    attemptMode: "whole",
    conflicts: "replace",
    selection: {
      ...selectEverything(snap),
    },
  });
  const restored = store(a1.id);
  replaceLibrary(restored, projected.projected.practice);
  assert.equal(restored.ratings.listLaunches().length, 1);
  assert.deepEqual(restored.ratings.getPreferences().focusDomains, ["graphs-search"]);
});
