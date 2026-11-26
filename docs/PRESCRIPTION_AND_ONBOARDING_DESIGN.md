# Design Specification (v2): Adaptive Onboarding, Problem Picking & Interactive Prescription Coach

> [!NOTE]
> **Companion specification to [`SKILL_RATINGS_DESIGN.md`](./SKILL_RATINGS_DESIGN.md) (v9).** Resolves all 19 findings (`F1`–`F19`), Decisions (`D1`–`D3`), and 9 smaller items from the v1 Combined Review. Defines the end-to-end learner flow from first connection through onboarding calibration, resumable local catalog sync (Free and Premium tiers, Java & C++26 parity), difficulty-anchored timeboxes (`ΔD_time`), atomic Drain-Before-Prescribe, the Director → Focused Planner shortlist & multi-batch escape hatch, Purposeful Easy Reinforcement, and the interactive Prescription Coach.

---

## Overview: Separation of Concerns & v1 → v2 Summary

The legacy [`lib/prescription.ts`](../lib/prescription.ts) asks one planner agent to diagnose skills, search LeetCode title pages via the browser bridge, inspect up to 3 problems, and justify the pick from raw history. In the **v2** architecture:

| Layer | Owner | Responsibilities |
| :--- | :--- | :--- |
| **Drain-Before-Prescribe Barrier** | Single-Flight Coordinator (`drainPendingRatingJobs`) | Atomically claims and sequentially finishes pending/retryable `rating_jobs` in `launchSeq ASC` order (`maxJobAttempts = 3`) before computing the next curriculum slot. |
| **Curriculum & Shortlist Engine** | Deterministic Director (`selectNextIntent` + `selectCandidatesFromCache`) | Owns adaptive onboarding, purposeful Easy reinforcement, `standardMinutes(D)` & `ΔD_time`, 5-slot cadence (with Slot 0 Focus dedication `D2`), cooldowns, Track B concepts (`D3`), and `up to 15`-candidate filtering over `catalog_problems`. |
| **Qualitative Problem Curator** | Focused Planner Agent *(no `search_problems` tool)* | Picks 1 problem from the shortlist, runs `1–3` `inspect_problem` checks (Java/C++26 starter via `starterForLanguage`, lock status, statement clarity), verifies target-concept & disguise fit (`F13`), sets `difficultyModifier ∈ [-50, +50]` and `minutes`, and writes a spoiler-free rationale. |
| **Conversational Steering** | Interactive Prescription Coach (`adjustPrescriptionIntent`) | Handles `"Choose another"` (skip 1–2 retain intent; skip 3 rotates domain) or live steering chat (*"shorter"*, *"stretch"*, *"Graphs or DP"*), enforcing `>= 3` pool size for Selection (`w_sel`) and anti-leak checks. |

**Key v1 → v2 Review Fixes (`F1`–`F19`, `D1`–`D3`):**
`F1/F2` difficulty-anchored `standardMinutes(D)` + `ΔD_time` + `<950` ability clock & coached revisit (`"foundations"` default) · `F3` `welcomeDismissed && prescribedCount === 0` gating · `F4/F9/F16` single-flight atomic claim drain, weighted composite `lastPrescribedImplScore`, launch-ledger breaker guard · `F5` Java & C++26 starter parity · `F6/F7` 48 band-verified seeds covering core 4 + all 8 fallback Easy domains · `F8` `max(μ₀, lastD)` onboarding step-ups & `μ₀ ± σ₀` reveal · `F10–F13` 20-pt bucket order, disjoint multi-batch escape hatch, preserved steering/Easy rotation, & `signatureForced` guard · `F14–F15` complete steering + `<48h` stale honor (`>=48h`/mismatch `409`) · `F17` 100% practice-only self-picks · `F18` `/api/catalog-sync` `CatalogSyncManager` · `F19` `lib/prescription.ts:497` contract & honest verification · `D2/D3` Slot 0 Focus dedication & `0.5×` Easy concept gain.

---

## 1. Adaptive Onboarding & 4-Session Calibration (`prescribedCount < 4`)

### 1.1 Phase 0 — First-Run Welcome & Informed Starting-Band Picker (`F2`, `F3`, `F8`)

When a learner has zero prescribed sessions and has not dismissed onboarding (`shouldShowWelcomePicker`: **`!welcomeDismissed && prescribedCount === 0`**), the Today card ([`components/problem-prescription.tsx`](../components/problem-prescription.tsx)) renders a lightweight setup state:
1. **Connection Checklist:** Confirms LeetCode Chrome Extension connection + AI provider sign-in. Connecting LeetCode immediately starts background `catalog_problems` sync via `/api/catalog-sync` without blocking Session #1.
2. **Bundled `historySeed` & User Imports (`F3`):** [`lib/store.ts:55`](../lib/store.ts) seeds bundled demo history on fresh init. That bundled `historySeed` MUST NOT hide the Welcome picker (`prescribedCount === 0`). User-imported learners (`importHistory`) also retain access to the Welcome tier picker until they launch a prescribed session or explicitly dismiss it.
3. **Optional 1-Tap Starting Tier (Skippable, defaults to **`"foundations"`**, `F2`):** Each option states exact bands, problem feel, and difficulty-anchored timeboxes (`STARTING_TIER_BANDS`):

| Tier ID | Label Shown to Learner | Learner-Facing Description | Session #1 Band | Timebox Band |
| :--- | :--- | :--- | :---: | :---: |
| `foundations` *(default)* | **Building Foundations** | Approachable single-invariant Easy problems (`12–18 min`) while we calibrate your baseline. | `[820, 920]` | `[12, 18]` min |
| `interview-prep` | **Interview Prep** | Tricky Easies and entry Mediums (`17–23 min`) covering core data structures. | `[940, 1040]` | `[17, 23]` min |
| `experienced` | **Experienced Solver** | Standard multi-step Mediums (`22–28 min`) to calibrate higher ratings fast. | `[1100, 1220]` | `[22, 28]` min |

- **Mathematical Boundary:** The chosen tier sets **only Session #1's difficulty band**. Every learner begins at identical initial rating parameters ($\mu_0 = 1000, \sigma_0 = 220$) so self-reports cannot inflate ratings.

### 1.2 Zero-Wait Session #1 — 48 Live-Band-Verified Free Seeds (`F6`, `F7`)

Wait-free first launch bundles **`ONBOARDING_SEED_PROBLEMS`**: **48** curated, **100% free** (`isPaidOnly: false`), Java/C++-supported, non-excluded LeetCode problems verified against `problemBaseDifficulty(difficulty, acRate)` and `resolvePrimaryDomain`:
- **24 Core Seeds (`F6`):** `2` unsolved fallback seeds per cell across `4` core domains × `3` starting tiers (`selectOnboardingSeed` skips `status === "ac"` and verifies live `acRate` inside `[lo, hi]`):

| Domain | `foundations` `[820, 920]` (`Easy`) | `interview-prep` `[940, 1040]` (`Easy`/`Medium`) | `experienced` `[1100, 1220]` (`Medium`) |
| :--- | :--- | :--- | :--- |
| `hashing-prefix` | `contains-duplicate`, `ransom-note` | `two-sum`, `group-anagrams` | `contiguous-array`, `brick-wall` |
| `two-pointers-window` | `move-zeroes`, `reverse-string` | `valid-palindrome`, `find-the-index-of-the-first-occurrence-in-a-string` | `container-with-most-water`, `max-consecutive-ones-iii` |
| `stacks-queues-linked` | `middle-of-the-linked-list`, `number-of-recent-calls` | `valid-parentheses`, `linked-list-cycle` | `remove-nth-node-from-end-of-list`, `daily-temperatures` |
| `binary-search` | `count-negative-numbers-in-a-sorted-matrix`, `find-target-indices-after-sorting-array` | `search-insert-position`, `first-bad-version` | `koko-eating-bananas`, `search-a-2d-matrix` |

- **24 Fallback Seeds Across Remaining 8 Easy-Backed Domains (`F7`):** Guarantees Session #1 never lacks a seed even if all 4 core domains are muted (`validateDirectorPreferences` keeps `>= 4` Easy-backed domains unmuted):
  - `arrays-strings`: `build-array-from-permutation` / `longest-common-prefix` / `spiral-matrix`
  - `sorting-intervals`: `sort-the-people` / `rank-transform-of-an-array` / `merge-intervals`
  - `heaps-ordered`: `last-stone-weight` / `relative-ranks` / `kth-largest-element-in-an-array`
  - `trees-recursion`: `maximum-depth-of-binary-tree` / `symmetric-tree` / `binary-tree-level-order-traversal`
  - `graphs-search`: `flood-fill` / `find-if-path-exists-in-graph` / `number-of-islands`
  - `dynamic-programming`: `fibonacci-number` / `climbing-stairs` / `house-robber`
  - `greedy`: `lemonade-change` / `assign-cookies` / `gas-station`
  - `math-bitwise`: `number-of-1-bits` / `palindrome-number` / `single-number-ii`

### 1.3 Adaptive Calibration Ladder (Sessions 1–4, `F8`, `F13`)

`selectOnboardingIntent` adapts difficulty after **every settled attempt** across 4 distinct domains (`hashing-prefix`, `two-pointers-window`, `stacks-queues-linked`, and `binary-search` — or `graphs-search` on Session #4 when `Math.max(globalMu, lastPrescribedDifficulty ?? globalMu) >= 1120` and `lastScore >= 0.80`):
- **Harsh Miss (`lastPrescribedImplScore <= 0.40`):** Eases Session $k$ down into **`easy-reinforcement`** (`[max(800, μ₀ - 140), max(lo + 40, μ₀ - 65)]`, `preferEasy: true`, `clockGoal: μ₀ < 950 ? "ability" : "standard"`, `allowCoachedRevisit: μ₀ < 950`).
- **Clean Solve (`lastPrescribedImplScore >= 0.80`):** Anchors to **`anchor = Math.max(μ₀, lastPrescribedDifficulty ?? μ₀)`** and steps up cleanly into `[max(800, min(1650, anchor + 55)), max(lo + 40, min(1750, anchor + 145))]`, enabling `selection` on Session #4 when `disguisableCounts[targetDomain] >= 5` (`F13`).
- **Middle Outcome (`0.40 < score < 0.80`):** Holds `[max(800, min(1800, μ₀ - 45)), max(lo + 30, min(1850, μ₀ + 10))]` on `"implementation"`.

### 1.4 Calibration Visibility (`μ₀ ± σ₀`) & Practice-Only Self-Picks (`F8`, `F17`)

- **UI Rating Visibility (`isRatingRevealed` & `formatInitialRatingReveal`):** Numeric scores stay hidden behind **`"Calibrating your baseline (N of 4 sessions)"`** while `prescribedGradedCount < 4`. Once `prescribedGradedCount >= 4`, the reveal displays **`μ₀ ± σ₀`** (e.g., `1167 ± 146`) alongside **Provisional** domain badges while $\sigma_{d,f} > 80$.
- **Self-Picked Catalog Problems (`rated = false`, `F17`):** Launches from `Browse problems` (omitting `prescriptionId`) run as **100% practice-only**:
  - **Excluded** from Track A rating updates ($\mu_0, \sigma_0, \delta_{d,f}$), Track B concept credit/lapses (`concepts` map untouched), `prescribedCount`, `prescribedGradedCount`, `prescribedRecentDomains` (6-attempt cap), and onboarding calibration.
  - **Retained:** Check-In gate (`isCheckInSettled`), reflection/coaching, Time & Space Big-O calibration (`complexityCalibration`), Coach Memory evidence, and **`lastPracticedDomain`** (`prevDomain`-only immediate repeat avoidance).

---

## 2. Local Catalog Sync, Language Parity & `signatureForced` (`F5`, `F13`, `F18`)

### 2.1 Three-File Bridge & Client Contract

1. [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs): GraphQL `problemsetQuestionList` query includes `acRate` and `topicTags { name slug }`; `list({ skip, limit, search, difficulty, tag, orderBy })` allows `limit <= 100`.
2. [`spikes/leetcode/extension/client.mjs`](../spikes/leetcode/extension/client.mjs): Tracked bundle synced by running **`npm run leetcode:extension`** after every change to `client.mjs`.
3. [`spikes/leetcode/extension/bridge.mjs:105-109`](../spikes/leetcode/extension/bridge.mjs): Forwards `{ skip, limit: clamp(1..100), search, difficulty, tag, orderBy }` to `LeetCodeClient.list` without dropping fields.

### 2.2 `/api/catalog-sync` Transport, Account Tier Filtering & C++26 Parity (`F5`, `F13`, `F18`)

- **Background Sync Transport (`CatalogSyncManager`, `F18`):** Driven via `POST /api/catalog-sync` (progress/TTL readable via `GET /api/catalog-sync`), storing paginated `limit = 100` responses in SQLite `catalog_problems` (`7`-day TTL). Tracks `nextSkip`, `totalNum`, `lastCompletedAt`, `consecutiveErrors`, and exponential backoff (`min(60_000, 1000 * 2^(consecutiveErrors - 1))`) so interrupted syncs resume from the exact `skip` offset. If sync has not completed by Session #2, `selectShortlistWithInspectionEscapeHatch` safely draws from the `48`-seed bank and already-cached domains.
- **Precomputed Cache Fields (`signatureForced`, `F13`):** Computes `resolvedDomain` (`CANONICAL_PROBLEM_OVERRIDES` + 53-slug table), `baseDifficulty`, `excluded`, and **`signatureForced`** (`SIGNATURE_FORCED_SLUGS`: `tree`, `binary-tree`, `binary-search-tree`, `linked-list`, `doubly-linked-list`). Domains with `< 5` non-`signatureForced` disguisable problems (`disguisableCounts[d] < 5`) disable `Selection` in `chooseTargetFacet` and omit `selOffset - 0.6*selSigma` from Growth LCB.
- **Free vs. Premium Filtering:** Reads live `LeetCodeClient.status().isPremium` ([`spikes/leetcode/client.mjs:1`](../spikes/leetcode/client.mjs)); `isPremium === false` excludes `isPaidOnly === true`.
- **Java & C++26 Parity (`validateInspectedStarter`, `F5`):** Every `inspect_problem` check verifies `!rawProblem.locked && !rawProblem.systemdesign && Boolean(rawProblem.content.trim())` alongside the active language starter (`starterForLanguage(rawProblem, language)` checking `cppStarter` for `"cpp"` and `javaStarter` for `"java"`). Both `contextKey` and `practice_launches.language` persist `"java" | "cpp"`.

---

## 3. Launch Ledger & Single-Flight Atomic Drain (`F4`, `F9`, `F16`)

To eliminate race conditions between background `rating_jobs` completion and next-problem selection while preventing duplicate or clobbered grades:

```
Attempt Launched (`POST /api/state` -> `resolveLaunchPrescription`)
  └─▶ Atomically persist `attempt` + `practice_launches` (`rated` DEFAULT 0, `language`,
      `difficultyScore`, `difficultyModifier`, `standardMinutes`, `prescribedMinutes`, `intentJson`)

Check-In Submitted / Skipped
  ├─▶ Synchronously update attempt gate + enqueue `rating_jobs(status='pending')`
  └─▶ Kick off WeakMap single-flight `drainPendingRatingJobs(db)`

User opens Today / requests `startPrescription`
  ├─▶ Join active single-flight drain OR claim pending / expired-lease / retryable `rating_jobs`
  │     ├─ Claim atomically via `claimOwnerId` + `claimExpiresAt` (`30s` lease) in `launchSeq ASC`
  │     ├─ Bounded attempts: **`maxJobAttempts = 3`** (1 initial run + 2 retries)
  │     ├─ Commit immutable `attempt-graded` (partial unique index) + mark job `'complete'`
  │     └─ Before marking `'failed'`, query `skill_rating_events` for existing `attempt-graded` -> heal `'complete'`
  ├─▶ Replay exact `LearnerRatingState` via `replayRatingLedger(launches, events)`
  └─▶ Invoke `selectNextIntent(replayedState, today, prefs)` -> shortlist -> Planner Agent
```

- **Graceful AI-Outage Degrade (`F16`):** If a job exhausts `maxJobAttempts = 3` (e.g., offline), it marks `status = 'failed'`, clears lease claims, records `lastError`, and surfaces a non-blocking *"Retry rating update"* control. Because `replayRatingLedger` derives `lastPrescribedSlotKind`, `lastPrescribedDifficulty`, and `missStreakConsumedByBreaker` strictly from `practice_launches`, Easy Reinforcement fires **at most once** per miss streak and never loops during outages. `lastPrescribedImplScore` uses normalized weighted composite `∑(w·s) / ∑w` (`F9`).

---

## 4. Director → Focused Planner Pipeline, Escape Hatch & Timeboxes

### 4.1 Ordered Shortlist & Multi-Batch Escape Hatch (`F2`, `F10`, `F11`, `F12`)

- **No `search_problems` Tool:** Removed from Planner runtime tools.
- **Deterministic Ordered Shortlist (`selectCandidatesFromCache`, `F10`):** Filters `!excluded`, live `isPremium`, `!excludedSlugs`, `status !== "ac"` (except during floor-constrained Easy Reinforcement `allowCoachedRevisit` when fresh `< 3`, unlocking coached solves `>= 5d` old, `F2`), `standardMinutes(D) <= maxMinutes` (`F1`), `resolvedDomain === targetDomain`, concept `searchTagSlug`, `!signatureForced && isTitleDisguisedForTarget` on `selection`, and `preferEasy`. Orders results by **`20`-point distance buckets** from target band midpoint (`floor(|D - mid| / 20)`) with seeded deterministic tie-breaking, returning **`up to 15`** candidates.
- **Multi-Batch Escape Hatch (`selectShortlistWithInspectionEscapeHatch`, `F11`, `F12`):** Accumulates `rejectedSlugs` across up to `6` inspections (`<= 3`/batch): **Batch 1 (primary 15)** → **disjoint Batch 2 (primary 15 excluding rejected)** → **Widened band (`±60`)** → **Domain Rotation**. Rotation exhausts `allowedDomains` first (honoring `prevDomain`, 6-cap cooldowns, `mutedDomains`, and `maxMinutes`), then global unmuted eligible domains, preserving `slotKind === "easy-reinforcement"` Easy band `[-210, -135]` and `preferEasy`.

### 4.2 Planner Output, `ΔD_time`, Prepare UI Edits (`±5m`), & Stale Cards (`F1`, `F2`, `F15`, `F19`)

- **Required Output Schema:**
  ```ts
  type PlannerResult = {
    slug: string;                         // Must exist in verified inspect_problem set
    reason: string;                       // 20..900 chars, spoiler-free motivation
    minutes: number;                      // Clamped to [10, 45]; within intent.defaultTimeboxBand
    difficultyModifier: number;           // Integer [-50, +50] added to catalog baseDifficulty
    kind: "new-challenge" | "revisit";    // "revisit" when consolidation or coached-revisit target
    evidenceIds: string[];                // 0..4 valid supplied IDs (0 allowed when intent exists)
    disguiseVerified: boolean;            // Must be true when intent.targetFacet === "selection"
  };
  ```
- **Difficulty-Anchored Timeboxes & Prepare Edits (`F1`, `F2`):**
  - `standardMinutes(D)`: `<= 950 → 15m`, `<= 1080 → 20m`, `<= 1250 → 25m`, `<= 1400 → 35m`, `> 1400 → 45m`.
  - Track A evaluates against `D_eff = clamp(750, 1850, round(D + clamp(-45, +45, round(-75 * ln(max(10, T) / max(10, T_std))))))`.
  - **Easy Reinforcement (`F2`):** `1350` learners solving `1180` Mediums get `standardMinutes(1180) = 25m` (`clockGoal: "standard"`, `defaultTimeboxBand = [22, 28]`); learners `< 950` (or `backtracking < 1060`) get `clockGoal: "ability"` (`+50%` time, `ΔD_time ≈ -30`, `~21–24m` on `800–850` Easies) + `allowCoachedRevisit = true`.
  - **Prepare Screen Timer (`components/workspace.tsx:1897`):** Keeps full **`[1, 90]`** minute editability (`minutes < 1 || minutes > 90`). Manual edits within **`±5m`** of `prescribedMinutes` remain **`rated = true`** (graded via `D_eff`); edits beyond `±5m` warn the learner and run as **`rated = false` (practice-only)**.
- **Evidence Validation (`lib/prescription.ts:497`) & `contextKey` (`F15`, `F19`):** Allows `evidenceIds: []` when `prescription.intent` is attached. `computePrescriptionContextKey` keys on `{ v: 9, language, isPremium, intent, preferences, planningPreferenceRevisions, skippedSlugs }` (never churning on raw ledger cursor).
- **Stale Card Resolution (`resolveLaunchPrescription`, `F15`):**
  - `suppliedId` omitted → **`practice-only`** (`rated: false`).
  - `suppliedId` matches `(slug, language)` and `age < 48h` → honors saved intent (**`prescribed`** if `< 24h && contextKey` matches, else **`prescribed-stale-honored`**, still **`rated: true`** — never silently downgraded to unrated!).
  - Missing ID, `(slug, language)` mismatch, or `age >= 48h` → **`conflict` (HTTP 409)** requiring card refresh before starting.

### 4.3 Structured Focus / Avoid Domains & Focus Slot 0 (`D2`)

Learners can pin up to **`3` focus domains** (`focusDomains`), keep `mutedDomains` disjoint (`>= 4` Easy-backed domains unmuted), and set optional `maxMinutes ∈ [10, 45]`. **`D2` Rule:** Whenever any `focusDomains` entry is eligible, **Slot 0 Growth** is dedicated to lowest-LCB among eligible focus domains, while **Slot 2** remains true lowest-LCB across all eligible domains.

---

## 5. Interactive Prescription Coach (`F14`, `F19`)

Alongside 1-click **"Choose another"** (`selectSkipOutcome`: skips `1–2` re-pick within the same intent/domain; **skip `3`** rotates away from `targetDomain` without advancing `prescribedCount`), the Today card provides **"Adjust with coach"**:

| Tool | Inputs | Behavior |
| :--- | :--- | :--- |
| `adjust_prescription_intent` | `{ domainOverride?, domainPoolOverride?, slotOverride?, maxMinutes?, excludeSlug? }` | Supports all `5` `slotOverride` values (`easy-reinforcement`, `growth`, `consolidation`, `breadth`, **`stretch`**), runs `selectShortlistWithInspectionEscapeHatch` with live `isPremium`, `allowedDomains`, and `skippedSlugs`. Never invents uncached slugs. |
| `inspect_problem` | `{ slug }` | Same bounded (max 3/turn) access, Java/`C++26` starter (`validateInspectedStarter`), statement fit, and disguise check. |
| `propose_planning_preference` | `{ focusDomains?, mutedDomains?, maxMinutes?, freeTextPreference? }` | Proposes durable focus/avoid/style updates through Coach Memory approval (never mutates saved preferences silently without confirmation). |

**Complete Steering & Anti-Leak Rules (`F14`):**
- **Multi-domain pool (`domainPoolOverride.length >= 2`):** Picks uniformly via deterministic seeded selection over non-`prevDomain` eligible candidates (no index-0 bias). **`Selection` (`w_sel > 0`) stays active ONLY when `eligiblePool.length >= 3`** (`1–2` domains force `steeredDomainExplicit = true` and `w_sel = 0`).
- **One-off muted/gated override:** Explicit single `domainOverride` on a muted or `< 980`-gated domain (e.g. `backtracking`) succeeds once with `overrideWarning` without altering saved preferences.
- **Anti-leak check (`didCoachLeakSelectionTarget`):** Sets `w_sel = 0` if coach dialogue names the target technique before solving.

---

## 6. Persistence, Snapshot Merge & Verification (`lib/store.ts:92`)

- **SQLite Extensions:**
  - `practice_launches`: `rated INTEGER NOT NULL DEFAULT 0` (fail-closed!), `startedAt INTEGER NOT NULL DEFAULT 0`, `language TEXT NOT NULL DEFAULT 'java'`, `difficultyScore`, `difficultyModifier`, `standardMinutes`, `prescribedMinutes`, `intentJson`, `selectionSpoilerRevealed`.
  - `rating_jobs`: `claimOwnerId TEXT`, `claimExpiresAt INTEGER`.
  - `catalog_problems`: `signatureForced INTEGER NOT NULL DEFAULT 0`.
  - `library_meta` / snapshots: `director_preferences`, `onboarding_state` (`startingTier`, `welcomeDismissed`).
- **Snapshots & Merge (`lib/store.ts:92`, `lib/snapshots.ts`, `mergeRatingSnapshots`):** `exportRatingSnapshot` / `restoreRatingSnapshot` round-trip all launch difficulty/timebox/language columns and reset `'running'` jobs to `'pending'`. `mergeRatingSnapshots` atomically re-indexes `launchSeq` sorted by `(startedAt, attemptId)` and remaps `skill_rating_events.launchSeq` to prevent `UNIQUE(launchSeq)` collisions.
- **Executable Verification Coverage ([`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts)):** `16/16` suites verify `F1`–`F19`, `D1`–`D3`, snapshot merge re-indexing, all `48` band-verified seeds, and the `200`-seed × `365`-day end-to-end simulation (`219/219` passing across `npm test`).
