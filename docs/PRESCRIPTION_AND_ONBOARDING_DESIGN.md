# Design Specification (v1): Adaptive Onboarding, Problem Picking & Interactive Prescription Coach

> [!NOTE]
> **Companion specification to [`SKILL_RATINGS_DESIGN.md`](./SKILL_RATINGS_DESIGN.md) (v8).** Defines the end-to-end learner flow from first connection through onboarding calibration, local catalog synchronization (Free and Premium LeetCode tiers), the deterministic Drain-Before-Prescribe barrier, the strict Director → Focused Planner pipeline, Purposeful Easy Reinforcement, and the interactive Prescription Coach. Every core rule and state transition is verified in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts).

---

## Overview: Separation of Concerns

The current [`lib/prescription.ts`](../lib/prescription.ts) asks one planner agent to diagnose skills, search LeetCode title pages via the browser bridge, inspect up to 3 problems, and justify the pick from raw history. In the v8 architecture:

| Layer | Owner | Responsibilities |
| :--- | :--- | :--- |
| **Drain-Before-Prescribe Barrier** | Deterministic Coordinator (`drainPendingRatingJobs`) | Sequentially finishes any pending/retryable `rating_jobs` in `launchSeq ASC` order with bounded retry before computing the next curriculum slot. |
| **Curriculum & Shortlist Engine** | Deterministic Director (`selectNextIntent` + `selectCandidatesFromCache`) | Owns adaptive onboarding, purposeful Easy reinforcement, 5-slot cadence, cooldowns, focus/avoid domain constraints, Track B concepts, and `12–15`-candidate filtering over the local `catalog_problems` SQLite cache. |
| **Qualitative Problem Curator** | Focused Planner Agent *(no `search_problems` tool)* | Picks 1 problem from the shortlist, runs `1–3` `inspect_problem` checks (Java starter, lock status, runner support, statement clarity), verifies target-concept & disguise fit (`F8`), sets `difficultyModifier ∈ [-50, +50]` and `minutes`, and writes a spoiler-free rationale. |
| **Conversational Steering** | Interactive Prescription Coach (`adjustPrescriptionIntent`) | Handles fast `"Choose another"` or live steering chat (*"shorter"*, *"easier win"*, *"focus on Graphs"*), applying structured Director overrides and proposing Coach Memory updates. |

---

## 1. Adaptive Onboarding & 4-Session Calibration (`prescribedCount < 4`)

### 1.1 Phase 0 — First-Run Welcome & Informed Starting-Band Picker

When a learner has zero prescribed sessions (`prescribedCount === 0` and no imported history), the Today card ([`components/problem-prescription.tsx`](../components/problem-prescription.tsx)) renders a lightweight setup state:
1. **Connection Checklist:** Confirms LeetCode Chrome Extension connection + AI provider sign-in. Connecting LeetCode immediately starts background `catalog_problems` sync without blocking Session #1.
2. **Optional 1-Tap Starting Tier (Skippable, defaults to `"interview-prep"`):** Each option states exact bands, problem feel, and timeboxes so learners make an informed choice:

| Tier ID | Label Shown to Learner | Learner-Facing Description | Session #1 Band | Timebox Band |
| :--- | :--- | :--- | :---: | :---: |
| `foundations` | **Building Foundations** | Approachable single-invariant Easy problems (`12–15m`) while we calibrate your baseline. | `[820, 920]` | `[12, 15]` min |
| `interview-prep` *(default)* | **Interview Prep** | Tricky Easies and entry Mediums (`15–22m`) covering core data structures. | `[940, 1040]` | `[15, 22]` min |
| `experienced` | **Experienced Solver** | Standard multi-step Mediums (`25–30m`) to calibrate higher ratings fast. | `[1100, 1220]` | `[25, 30]` min |

- **Mathematical Boundary:** The chosen tier sets **only Session #1's difficulty band**. Every learner begins at identical initial rating parameters ($\mu_0 = 1000, \sigma_0 = 220$) so self-reports cannot inflate ratings, while $\sigma_0 = 220$ moves strong or beginner solvers rapidly from real outcomes.
- **Imported Historical Notes (`practice.imported()`):** Learners with imported text notes skip the Welcome tier picker (treated as having prior qualitative context for the Planner) and start directly with normal Check-In / reflection UX, still completing 4 native timed prescribed sessions to establish numerical Track A baselines without fabricated scores.

### 1.2 Zero-Wait Session #1 (`ONBOARDING_SEED_PROBLEMS`)

Wait-free first launch does not block on the full `~3,700`-problem background sync. The app bundles **`ONBOARDING_SEED_PROBLEMS`**: 12 curated, **100% free** (`isPaidOnly: false`), Java-supported, non-excluded LeetCode problems spanning all `4` core onboarding domains × `3` starting tiers:

| Domain | `foundations` (`Easy`) | `interview-prep` (`Medium`) | `experienced` (`Medium`) |
| :--- | :--- | :--- | :--- |
| `hashing-prefix` | `contains-duplicate` | `group-anagrams` | `subarray-sum-equals-k` |
| `two-pointers-window` | `valid-palindrome` | `container-with-most-water` | `longest-substring-without-repeating-characters` |
| `stacks-queues-linked` | `valid-parentheses` | `remove-nth-node-from-end-of-list` | `daily-temperatures` |
| `binary-search` | `search-insert-position` | `koko-eating-bananas` | `search-in-rotated-sorted-array` |

Session #1 calls `inspect_problem` on the chosen free seed (filtering any `mutedDomains` by substituting from unmuted Easy domains) while the remaining catalog syncs silently during Solve #1.

### 1.3 Adaptive Calibration Ladder (Sessions 1–4)

`selectOnboardingIntent` adapts difficulty after **every single settled attempt** across 4 distinct domains (`hashing-prefix`, `two-pointers-window`, `stacks-queues-linked`, and `binary-search` — or `graphs-search` on Session #4 if $\mu_0 \ge 1120$ and last `score >= 0.80`):
- **Harsh Miss (`lastPrescribedImplScore <= 0.40`):** Immediately eases Session $k$ down into **`easy-reinforcement`** (`[max(800, μ₀ - 110), max(840, μ₀ - 40)]`, `preferEasy: true`, `12–15m`) on the next core domain so a tough miss never snowballs into back-to-back onboarding failures.
- **Clean Solve (`lastPrescribedImplScore >= 0.80`):** Steps up into `[max(800, μ₀ - 15), min(1850, μ₀ + 55)]`, introducing a disguised **`selection`** target on Session #4.
- **Middle Outcome (`0.40 < score < 0.80`):** Holds `[max(800, μ₀ - 45), min(1850, μ₀ + 10)]` on `"implementation"`.

### 1.4 Calibration Visibility & Practice-Only Self-Picks

- **UI Rating Visibility (`isRatingRevealed`):** Numeric scores stay hidden behind **`"Calibrating your baseline (N of 4 sessions)"`** while `prescribedGradedCount < 4`, avoiding erratic ±100-pt jumps after one session. Once 4 prescribed sessions finish grading (`prescribedGradedCount >= 4`), the Global Rating reveals alongside domain ratings marked **Provisional** while $\sigma_{d,f} > 80$.
- **Self-Picked Catalog Problems (`rated = false`):** Launches from `Browse problems` (`POST /api/state` without a valid `prescriptionId`) run as **practice-only**:
  - **Excluded** from Track A rating updates ($\mu_0, \sigma_0, \delta_{d,f}$), `prescribedCount`, `prescribedGradedCount`, and onboarding calibration.
  - **Retained:** Same Check-In gate (`isCheckInSettled`), reflection/coaching, separate Time & Space Big-O calibration, Coach Memory evidence, positive Track B concept transitions (`applied` / `coached`, no rating `lapsed` penalties), and a light cooldown entry in `recentDomains` so the Director does not immediately re-prescribe the topic just practiced.

---

## 2. Local Catalog Sync & Free / Premium Tier Support

### 2.1 Three-File Bridge & Client Contract

1. [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs): GraphQL `problemsetQuestionList` query includes `acRate` and `topicTags { name slug }`; `list({ skip, limit, search, difficulty, tag, orderBy })` allows `limit <= 100`.
2. [`spikes/leetcode/extension/client.mjs`](../spikes/leetcode/extension/client.mjs): Tracked bundle synced by running **`npm run leetcode:extension`** after every change to `client.mjs`.
3. [`spikes/leetcode/extension/bridge.mjs:105-109`](../spikes/leetcode/extension/bridge.mjs): Forwards `{ skip, limit: clamp(1..100), search, difficulty, tag, orderBy }` to `LeetCodeClient.list` without dropping fields.

### 2.2 Background Sync & Account Tier Filtering

- **Cache Table (`catalog_problems`):** Populated incrementally in `limit = 100` pages (`~38` calls, `7`-day TTL, incremental head sync for new problems), computing `resolvedDomain` (`CANONICAL_PROBLEM_OVERRIDES` + 53-slug table), `baseDifficulty`, and `excluded` (`database | shell | concurrency | interactive | design | data-stream`).
- **Free vs. Premium Support:** Every prescription & catalog shortlist reads live account status from `LeetCodeClient.status().isPremium` ([`spikes/leetcode/client.mjs:1`](../spikes/leetcode/client.mjs)):
  - **Free accounts (`isPremium === false`):** `selectCandidatesFromCache` strictly excludes `isPaidOnly === true`.
  - **Premium accounts (`isPremium === true`):** All unlocked paid and free problems in the resolved domain are eligible.
  - **Defense in depth:** `inspect_problem` always verifies `!rawInfo.locked && Boolean(rawInfo.javaStarter)`.

---

## 3. Deterministic Drain-Before-Prescribe Coordinator

To eliminate race conditions between background `rating_jobs` completion and next-problem selection (such as lagging step-ups in onboarding or delayed reactive Easy rescues):

```
Check-In Submitted / Skipped
  ├─▶ Synchronously commit attempt + practice_launches + rating_jobs(status='pending')
  └─▶ Kick off single-flight background drainPendingRatingJobs(db)

User opens Today / requests startPrescription
  ├─▶ Check pending/running/retryable rating_jobs joined on launchSeq ASC
  ├─▶ Drain barrier runs drainPendingRatingJobs(db) (status badge: "Updating your skill profile…")
  │     ├─ Grades sequentially in launchSeq ASC order
  │     ├─ Max 2 bounded retries per transient failure
  │     └─ Writes immutable attempt-graded (partial unique index) + marks job 'complete'
  ├─▶ Replay exact LearnerRatingState via replayRatingLedger(launches, events)
  └─▶ Invoke selectNextIntent(replayedState, today, prefs) -> shortlist -> Planner Agent
```

- **Graceful AI-Outage Degrade:** If an attempt exhausts `maxAutoRetries = 2` (e.g., offline or provider error), `drainPendingRatingJobs` marks that job `status = 'failed'`, records `lastError`, does **not** throw a blocking exception, and returns `failedJobIds`. The Director still advances safely using `practice_launches` cooldowns and counters while Today shows a non-blocking *"Retry rating update"* control.

---

## 4. Director → Focused Planner Pipeline

### 4.1 Planner Constraints & Escape Hatch

- **No `search_problems` Tool:** Removed from the Planner Agent runtime tool list so the LLM never wastes turns or misses target bands on title searches.
- **Deterministic Shortlisting (`12–15` candidates):** Filtered locally via `selectCandidatesFromCache` (`resolvedDomain`, live `isPremium`, `!excluded`, `!solved/skipped`, concept `searchTagSlug`, `isTitleDisguisedForTarget` when `selection`, `preferEasy` when `easy-reinforcement`, full-pool `snapCandidatePool`).
- **Server-Side Escape Hatch (`shortlistWithEscapeHatch`):** If all `<= 3` `inspect_problem` calls fail (locked, missing Java starter, system design, statement disguise leak, or poor quality), the server deterministically supplies a 2nd uninspected batch → widens `targetDifficultyBand` by `±60` → rotates to the next eligible domain without failing the user flow.

### 4.2 Planner Input, Output Schema & Timebox Contract

- **Inputs supplied to Planner:** `intent: PrescriptionIntent`, `shortlist: CatalogProblemRow[]`, `defaultTimeboxBand: [lo, hi]`, domain-scoped Coach Memory preferences & observations (including open `outcome = "revisit"` notes as candidate tie-breakers), and `skippedSlugs`.
- **Required Output Schema:**
  ```ts
  type PlannerResult = {
    slug: string;                         // Must exist in verified inspect_problem set
    reason: string;                       // 20..900 chars, spoiler-free motivation
    minutes: number;                      // Clamped to [10, 45]; chosen within intent.defaultTimeboxBand ± 5m
    difficultyModifier: number;           // Integer [-50, +50] added to catalog baseDifficulty
    kind: "new-challenge" | "revisit";    // "revisit" when consolidation or open revisit target
    evidenceIds: string[];                // 0..4 valid supplied IDs (0 allowed when intent exists)
    disguiseVerified: boolean;            // Must be true when intent.targetFacet === "selection"
  };
  ```
- **User Timebox Edits:** On the Prepare screen, learners can still adjust the assessment countdown within `[10, 45]` minutes without incurring a rating penalty (rubric evaluates within-timebox completion and solution quality).
- **`lib/prescription.ts:463` & Cache Invalidation (`contextKey`):** Allow `evidenceIds: []` when `prescription.intent` is attached (fixing cold-start and unpracticed domains), and key `prescriptionContextKey` on `{ replayedLedgerCursor, directorPrefs, intentHash, skippedSlugs }` so background memory noise never invalidates an unstarted prescription card.

### 4.3 Structured Focus/Avoid Domains & Coach Memory

Learners can pin up to **`3` focus domains** (`focusDomains`, soft-prioritized via a `-35` LCB offset bias on `Growth` slots without bypassing cooldowns, Easy Reinforcement, or Consolidation) and mute domains (`mutedDomains`, enforced to leave **$\ge 4$ Easy-backed domains unmuted** and kept disjoint from `focusDomains`). Free-text `planning` memories remain advisory in the Planner for problem style and session pacing.

---

## 5. Interactive Prescription Coach (Conversational Steering)

Alongside 1-click **"Choose another"** (skips 1–2 re-pick within the same `PrescriptionIntent`; skip 3 rotates to the next eligible domain without advancing `prescribedCount`), the Today card provides an optional **"Adjust with coach"** drawer backed by structured tools over the Director:

| Tool | Inputs | Behavior |
| :--- | :--- | :--- |
| `adjust_prescription_intent` | `{ domainOverride?, domainPoolOverride?, slotOverride?, maxMinutes?, excludeSlug? }` | Re-runs Director intent adjustment + `shortlistWithEscapeHatch` with live `isPremium` and `skippedSlugs`. Never invents uncached slugs. |
| `inspect_problem` | `{ slug }` | Same bounded (max 3/turn) access, Java starter, statement fit, and disguise check. |
| `propose_planning_preference` | `{ focusDomains?, mutedDomains?, maxMinutes?, freeTextPreference? }` | Proposes durable focus/avoid/style updates through Coach Memory approval (never mutates `director_preferences` silently without confirmation). |

**Steered Rating Rules:**
- **Global Rating, Implementation rating, and Track B concept stability always score at `100%`** on every prescribed problem, steered or unsteered.
- **Pattern Selection (`w_sel`):** Kept **active** on broad steering (e.g., *"something 15 minutes and easier"*, *"give me Graphs or DP"*, `domainPoolOverride.length >= 2`), and sets **`w_sel = 0`** (`steeredDomainExplicit = true`, `targetFacet = "implementation"`) **only** when the learner explicitly named today's single exact domain/technique.

---

## 6. Persistence, Snapshot Integration & Verification Matrix

- **SQLite Extensions:** Add `rated INTEGER NOT NULL DEFAULT 1` to `practice_launches`; persist `director_preferences` and `onboarding_state` (`startingTier`, `welcomeDismissed`) inside `library_meta` (or dedicated JSON snapshot fields) exported in [`lib/store.ts:86`](../lib/store.ts) and restored/reset atomically in [`lib/snapshots.ts`](../lib/snapshots.ts).
- **Executable Verification Coverage ([`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts)):** All `16/16` tests verify onboarding seed cleanliness, tier prior invariance, adaptive step-up/ease-down, `isRatingRevealed`, Purposeful Easy Reinforcement & reactive 2-miss breaker, Practice-Only Self-Picks, Free vs. Premium filtering, `focusDomains`/`mutedDomains` invariants, single- vs. multi-domain steering (`w_sel`), `launchSeq` Drain-Before-Prescribe retries/fallbacks, and 200-seed 365-day stability.
