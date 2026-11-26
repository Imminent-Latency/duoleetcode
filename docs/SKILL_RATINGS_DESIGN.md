# Design Specification (v8): Hierarchical Skill Ratings, Concept Stability & Pacing Director

> [!NOTE]
> **Design specification (v8 — ready for implementation)** — extends v7 with the adaptive onboarding, **Purposeful Easy Reinforcement**, Practice-Only self-pick policy, Focus/Avoid domain controls, Drain-Before-Prescribe barrier, and interactive Prescription Coach rules aligned in [`PRESCRIPTION_AND_ONBOARDING_DESIGN.md`](./PRESCRIPTION_AND_ONBOARDING_DESIGN.md). Every equation, SQLite DDL/constraint, state transition, resolver rule, Director rule, and §5 metric is implemented and strictly asserted in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts).

---

## Summary of Changes from v7 → v8

| Area | Change in v8 |
| :--- | :--- |
| **Purposeful Easy Reinforcement & Failure Breaker** | Replaced static strongest-domain `Momentum` (Slot 4) and added a **reactive 2-miss circuit breaker** (`consecutiveMisses >= 2` or single harsh onboarding miss `score <= 0.40`): preempts with an approachable **`easy-reinforcement`** session (`[θ - 210, θ - 135]`, $E \in [0.72, 0.82]$, `12–15m`, `preferEasy: true`), targeting recent 14-day struggles first, then fragile/near-due Track B concepts, then rusty, then strongest domain (with anti-loop suppression preventing back-to-back Easy Reinforcement). |
| **Adaptive Onboarding & Visibility (`prescribedCount < 4`)** | Added 1-tap informed starting tiers (`foundations`, `interview-prep`, `experienced`) shifting ONLY Session #1's band while keeping $\mu_0 = 1000 \pm 220$, bundled 12 free seed problems (`ONBOARDING_SEED_PROBLEMS`), adaptive per-attempt step-up/ease-down across 4 core domains, and hidden rating calibration UI until **`prescribedGradedCount >= 4`** (`isRatingRevealed`). |
| **Practice-Only Self-Picks (`rated = false`)** | Self-picked catalog launches run unrated for Track A & onboarding calibration while retaining the Check-In gate, separate Big-O calibration, Coach Memory, positive Track B concept transitions, and light domain cooldowns (`recentDomains`). |
| **Drain-Before-Prescribe & Interactive Steering** | Added deterministic single-flight `drainPendingRatingJobs` barrier ordered by `launchSeq ASC`; added `focusDomains` (`<= 3`, `-35` LCB bias on Growth) & `mutedDomains` (`>= 4` Easy-backed domains unmuted); defined `steeredDomainExplicit` ($w_{\text{sel}} = 0$ only when user names today's single exact domain/technique). |

*(Previous v6 Combined Review fixes `F1`–`F12`, `D1`, and all 8 smaller issues remain preserved in full below.)*

---

## 1. Taxonomy, Local Catalog Contract, 53-Slug Resolver & 24-Concept Catalogue

### 1.1 Track A — 13 Rated Domains, Extension Bridge & Local Catalog Cache (`F3`)

Build-time catalog contract across three files (detailed in [`PRESCRIPTION_AND_ONBOARDING_DESIGN.md`](./PRESCRIPTION_AND_ONBOARDING_DESIGN.md#L61-L79)):
1. [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs): Preserve `acRate` (`0..100`) and `topicTags { name slug }` on list items; allow `limit <= 100` alongside optional `tag` and `orderBy` (`"AC_RATE_DESC" | "AC_RATE_ASC"`); read live `status().isPremium`. Validation schemas in [`lib/validation.ts`](../lib/validation.ts) and [`lib/prescription.ts`](../lib/prescription.ts) preserve both fields.
2. [`spikes/leetcode/extension/client.mjs`](../spikes/leetcode/extension/client.mjs): Tracked copy of `spikes/leetcode/client.mjs`. Every edit to `client.mjs` **must** re-run `npm run leetcode:extension` so both files stay identical.
3. [`spikes/leetcode/extension/bridge.mjs:105-109`](../spikes/leetcode/extension/bridge.mjs): Forward `{ skip, limit, search, difficulty, tag, orderBy }` intact to `LeetCodeClient.list` (clamping `1 <= limit <= 100`), asserted in extension bridge unit tests.

**Local Catalog Cache (`catalog_problems`) & Shortlisting (`selectCandidatesFromCache`):**
- Background sync populates SQLite `catalog_problems` (~38 `limit: 100` pages, 7-day TTL + incremental refresh), precomputing `resolvedDomain`, `baseDifficulty`, and `excluded` (`database | shell | concurrency | interactive | design | data-stream`).
- **Deterministic Filtering:** Filter `!excluded`, `isPremium || !isPaidOnly` (live account tier!), `!excludedSlugs`, **`resolvedDomain === intent.targetDomain`**, concept `searchTagSlug` (when probing/consolidating), `isTitleDisguisedForTarget` when `targetFacet === "selection"`, then apply `preferEasy` (Easy problems inside `[lo - 40, hi + 40]` before general pool) and full-pool `snapCandidatePool`. Planner receives 12–15 shortlisted candidates and runs only `inspect_problem` statement-fit & disguise confirmation (`search_problems` removed).

| Canonical Order | Domain ID | Display Name | Catalog Difficulty Floor | Min $\mu_0$ Gate | Primary Query Slugs |
| :---: | :--- | :--- | :---: | :---: | :--- |
| 1 | `arrays-strings` | Arrays, Strings & Simulation | `800` | None *(always eligible)* | `array`, `string`, `matrix`, `simulation` |
| 2 | `hashing-prefix` | Hashing & Prefix State | `800` | None | `hash-table`, `prefix-sum`, `counting` |
| 3 | `two-pointers-window` | Two Pointers & Sliding Window | `800` | None | `two-pointers`, `sliding-window` |
| 4 | `sorting-intervals` | Sorting & Intervals | `800` | None | `sorting` |
| 5 | `stacks-queues-linked` | Stacks, Queues & Linked Lists | `800` | None | `stack`, `queue`, `monotonic-stack`, `linked-list` |
| 6 | `binary-search` | Binary Search | `800` | None | `binary-search` |
| 7 | `heaps-ordered` | Heaps & Ordered Collections | `800` | None | `heap-priority-queue`, `ordered-set` |
| 8 | `trees-recursion` | Trees & Divide-and-Conquer | `800` | None | `tree`, `binary-tree`, `binary-search-tree`, `trie` |
| 9 | `graphs-search` | Graphs & Grid Search | `800` | None | `depth-first-search`, `breadth-first-search`, `graph`, `topological-sort`, `union-find` |
| 10 | `backtracking` | Backtracking | `980` | **`980`** *(Medium-entry)* | `backtracking` |
| 11 | `dynamic-programming` | Dynamic Programming | `800` | None | `dynamic-programming` |
| 12 | `greedy` | Greedy | `800` | None | `greedy` |
| 13 | `math-bitwise` | Math & Bit Manipulation | `800` | None | `math`, `bit-manipulation`, `number-theory` |

### 1.2 Canonical Overrides & `1..53` Tag Priority Resolver (`Smaller #1`)

Check `CANONICAL_PROBLEM_OVERRIDES[slug]` first:
- **`hashing-prefix`:** `contains-duplicate`, `valid-anagram`, `group-anagrams`, `longest-consecutive-sequence`
- **`dynamic-programming`:** `coin-change`, `perfect-squares`, `word-break`, `longest-increasing-subsequence`
- **`two-pointers-window`:** `two-sum-ii-input-array-is-sorted`, `container-with-most-water`
- **`arrays-strings`:** `longest-common-prefix`

Otherwise pick lowest rank (`1` = highest specificity; `recursion` #47 checked after `1..46`; untagged → `arrays-strings`):

1–5. `trie` (#1 → `trees-recursion`), `union-find` (#2), `topological-sort` (#3), `shortest-path` (#4), `minimum-spanning-tree` (#5 → `graphs-search`)
6–7. `monotonic-stack` (#6), `monotonic-queue` (#7 → `stacks-queues-linked`)
8–9. `heap-priority-queue` (#8), `ordered-set` (#9 → `heaps-ordered`)
10–11. `linked-list` (#10), `doubly-linked-list` (#11 → `stacks-queues-linked`)
12–14. `binary-search-tree` (#12), `binary-tree` (#13), `tree` (#14 → `trees-recursion`)
15. `backtracking` (#15 → `backtracking`) · 16. `sliding-window` (#16 → `two-pointers-window`) · 17. `binary-search` (#17 → `binary-search`)
18–20. `graph` (#18), `breadth-first-search` (#19), `depth-first-search` (#20 → `graphs-search`)
21–22. `dynamic-programming` (#21), `memoization` (#22 → `dynamic-programming`) · 23. `greedy` (#23 → `greedy`) · 24. `two-pointers` (#24 → `two-pointers-window`)
25–26. `stack` (#25), `queue` (#26 → `stacks-queues-linked`) · 27. `prefix-sum` (#27 → `hashing-prefix`)
28–33. `quickselect` (#28), `merge-sort` (#29), `bucket-sort` (#30), `counting-sort` (#31), `radix-sort` (#32), `sorting` (#33 → `sorting-intervals`)
34–36. `hash-table` (#34), `hash-function` (#35), `counting` (#36 → `hashing-prefix`)
37–45. `bitmask` (#37), `bit-manipulation` (#38), `number-theory` (#39), `combinatorics` (#40), `geometry` (#41), `game-theory` (#42), `randomized` (#43), `brainteaser` (#44), `math` (#45 → `math-bitwise`)
46. `divide-and-conquer` (#46) · 47. `recursion` (#47 → `trees-recursion`)
48–53. `matrix` (#48), `simulation` (#49), `enumeration` (#50), `iterator` (#51), `string` (#52), `array` (#53 → `arrays-strings`)

### 1.3 Track B — Canonical 24-Concept Catalogue (`Smaller #2 & #3`)

Concepts store exposure state and calendar-day stability—**never `1000` ratings**:
- After 2 uncoached probes (`probeCount >= 2`), automatic Slot-1 probing pauses for `90` calendar days; meanwhile the concept immediately promotes to `applied` / `coached` via incidental solves or reflection coaching.
- `topological-sort` unlocks at **`minGlobalMu = 1080`**.

| Order | `slug` | Domain | `searchTagSlug` | `minGlobalMu` | Order | `slug` | Domain | `searchTagSlug` | `minGlobalMu` |
| :---: | :--- | :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: |
| 1 | `in-place-array-scan` | `arrays-strings` | `matrix` | `800` | 13 | `top-k-priority-queue` | `heaps-ordered` | `heap-priority-queue` | `900` |
| 2 | `hash-map-set` | `hashing-prefix` | `hash-table` | `800` | 14 | `ordered-set-map` | `heaps-ordered` | `ordered-set` | `1020` |
| 3 | `prefix-sum-map` | `hashing-prefix` | `prefix-sum` | `850` | 15 | `tree-dfs-recursion` | `trees-recursion` | `binary-tree` | `850` |
| 4 | `converging-two-pointers` | `two-pointers-window` | `two-pointers` | `800` | 16 | `bst-ordering` | `trees-recursion` | `binary-search-tree` | `920` |
| 5 | `variable-sliding-window` | `two-pointers-window` | `sliding-window` | `900` | 17 | `prefix-trie` | `trees-recursion` | `trie` | `1000` |
| 6 | `custom-comparator-intervals` | `sorting-intervals` | `sorting` | `850` | 18 | `grid-graph-bfs-dfs` | `graphs-search` | `breadth-first-search` | `920` |
| 7 | `quickselect-partition` | `sorting-intervals` | `sorting` | `1020` | 19 | `topological-sort` | `graphs-search` | `topological-sort` | **`1080`** |
| 8 | `lifo-fifo-state` | `stacks-queues-linked` | `stack` | `800` | 20 | `union-find` | `graphs-search` | `union-find` | `1000` |
| 9 | `linked-list-pointers` | `stacks-queues-linked` | `linked-list` | `850` | 21 | `weighted-shortest-path` | `graphs-search` | `graph` | `1100` |
| 10 | `monotonic-stack-deque` | `stacks-queues-linked` | `monotonic-stack` | `980` | 22 | `state-space-backtracking` | `backtracking` | `backtracking` | `980` |
| 11 | `binary-search-index` | `binary-search` | `binary-search` | `800` | 23 | `dp-1d-2d` | `dynamic-programming` | `dynamic-programming` | `960` |
| 12 | `binary-search-answer` | `binary-search` | `binary-search` | `1020` | 24 | `greedy-bitwise` | `greedy` | `greedy` | `900` |

---

## 2. Closed-Form Difficulty, Rating & Stability Equations

### 2.1 State Parameters & Provisional Domain Display (`F9`)
- **Global Base:** $\mu_0$ (init `1000`), $\sigma_0 \in [20, 220]$ (init `220`). Remains hidden during onboarding (`isRatingRevealed = prescribedGradedCount >= 4`).
- **Domain Facets ($d \in \{1..13\}, f \in \{\text{impl}, \text{sel}\}$):** $\delta_{d,f}$ (init `0`), $\sigma_{d,\text{impl}} \in [45, 150]$ (init `110`), $\sigma_{d,\text{sel}} \in [55, 150]$ (init `110`), `freshSigma` (init `110`), `lastUpdatedAt`, `implAttempts`.
- **Steady-State Global Bleed Guard:** At floors ($\sigma_0 = 20, \sigma_{d,\text{impl}} = 45$), global variance share is $\frac{20^2}{20^2 + 45^2} = \mathbf{16.5\%}$ (`83.5%` domain-local).
- **Provisional Domain Display (`F9`):** Domain facet scores display a **Provisional** indicator while `isDomainProvisional(sigma) = sigma > 80` (~first 6–10 attempts in that domain).

### 2.2 Overlapping Difficulty Mapping ($D$), Empty-Band Snap & Expected Score ($E$)
1. **Overlapping Base Difficulty ($a = \text{acRatePct} / 100 \in [0, 1]$, structural modifier $\Delta D \in [-50, +50]$):**
   - **Easy:** $D_{\text{base}} = 800 + 280 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.85 - a}{0.55}\right) \in [800,\; 1080]$
   - **Medium:** $D_{\text{base}} = 980 + 420 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.80 - a}{0.55}\right) \in [980,\; 1400]$
   - **Hard:** $D_{\text{base}} = 1340 + 460 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.70 - a}{0.50}\right) \in [1340,\; 1800]$
   - Final $D = \text{clamp}_{[800, 1850]}(\text{round}(D_{\text{base}} + \Delta D))$. When $\mu_0 < 800$ (e.g., `738.14`), target bands clamp to `[800, 830]`, yielding $E(738, 800) \approx 0.39$ and `+75` upside on the first clean solve.
2. **Empty-Band Snap Rule (`snapCandidatePool`):** Over the full locally-cached domain pool, try `[L, U]` → `[L - 60, U + 60]` → nearest 3 candidates by $|D_{\text{base}} - \text{mid}|$ (or next eligible domain). When `preferEasy === true`, Easy candidates in `[L - 40, U + 40]` are preferred first.
3. **Expected Score ($L = 320, q = \frac{\ln 10}{320}, \sigma_p = 55, g(\sigma_p) \approx 0.9770$):**
   $$E(\theta, D) = \frac{1}{1 + 10^{-g(\sigma_p)(\theta - D)/320}}$$
   - **Easy Reinforcement (`[θ - 210, θ - 135]`):** $E \in [0.72,\; 0.82]$ · **Growth & Breadth (`[θ - 45, θ + 10]`):** $E \in [0.48,\; 0.58]$ · **Concept Probe (`[θ - 55, θ - 15]`):** $E \in [0.53,\; 0.60]$ · **Consolidation (`[θ - 40, θ + 5]`):** $E \in [0.49,\; 0.57]$ · **Stretch (`[θ + 10, θ + 65]`):** $E \in [0.39,\; 0.48]$.

### 2.3 Mutually Exclusive Rubric ($S \in [0, 1]$) & Single-Base Update Step

Evaluated **top-to-bottom (first match wins)** per exercised domain ($\sum_d w_{d,\text{impl}} = 1$; $w_{d,\text{sel}} = 0$ on signature-forced inputs, `selectionSpoilerRevealed === true`, or explicit single-domain conversational steering `steeredDomainExplicit === true`). Row 1 outside help matches manual `"Record outside help"` (`event.type === "assistance" && !event.assistanceId` via [`components/assessment-menu.tsx:47`](../components/assessment-menu.tsx) and [`components/workspace.tsx:1537`](../components/workspace.tsx)) or explicit help disclosures; `attempt.javaHelp` carries zero penalty.

| Precedence | Mutually Exclusive Attempt Outcome | $S_{d,\text{impl}}$ | $S_{d,\text{sel}}$ |
| :---: | :--- | :---: | :---: |
| 1 | Recorded outside solution help during active solving (`type === "assistance" && !assistanceId`) | `0.35` *(accepted)* / `0.15` | `0.30` *(accepted)* / `0.15` |
| 2 | Accepted in timebox, optimal complexity class, $\le 2$ wrong-answer submits | `1.00` | `1.00` *(if non-obvious)* |
| 3 | Accepted in timebox, optimal complexity class, $\ge 3$ wrong-answer submits or minor constant/pass overhead | `0.80` | `0.90` |
| 4 | Accepted in timebox via suboptimal complexity class | `0.65` *(used)* | `0.50` *(used)*; `0.20` *(missed iff §3.2 holds)* |
| 5 | Unaccepted at deadline, sound core invariant with isolated boundary/syntax bug | `0.40` | `0.75` |
| 6 | Unaccepted at deadline, partial/incomplete mechanics | `0.15` | `0.35` |
| 7 | No viable approach or fundamental invariant contradiction | `0.00` | `0.00` |

**Familiarity Multiplier ($m_{\text{fam}}$, applied when $S > E$, else `1.0`):** `new = 1.0`, `revisit = 0.65`, `solved = 0.25`.

**Simultaneous Intra-Attempt Update (`applyAttemptGraded`):**
1. **Idle $\sigma$-Drift ($c_{\text{drift}} = 7.0\;\text{pts}/\sqrt{\text{day}}$, 21-day grace window):** $\sigma'(\Delta t) = \min(\sigma_{\max}, \sqrt{\sigma^2 + 49 \cdot \max(0, \Delta t - 21)})$, then snapshot pre-attempt state.
2. **Single Global Base Update (`implementation` updates only):**
   Normalize $\hat{w}_d$, $\tilde{w}_d = \hat{w}_d m_{\text{fam},d}$, $E_d = E(\mu_0^{\text{pre}} + \delta_{d,\text{impl}}^{\text{pre}}, D)$, $R_{\text{tot}} = \sum_d \tilde{w}_d(S_{d,\text{impl}} - E_d)$, $I_{\text{tot}} = \sum_d \tilde{w}_d q^2 g(\sigma_p)^2 E_d(1 - E_d)$, $\bar{\sigma}_{\text{dom}}^2 = \sum_d \hat{w}_d (\sigma_{d,\text{impl}}^{\text{pre}})^2$, $V_0 = (\sigma_0^{\text{pre}})^2 + \bar{\sigma}_{\text{dom}}^2$, $\alpha_0 = \frac{(\sigma_0^{\text{pre}})^2}{V_0}$:
   $$\mu_0 \leftarrow \mu_0^{\text{pre}} + \alpha_0 \frac{q g(\sigma_p) R_{\text{tot}}}{V_0^{-1} + I_{\text{tot}}}, \qquad \sigma_0 \leftarrow \max\!\left(20,\; \left((\sigma_0^{\text{pre}})^{-2} + \alpha_0 I_{\text{tot}}\right)^{-1/2}\right)$$
   *(First-attempt note: on `Selection = 0.75, Implementation = 0.40` while $\sigma_0 = 220$, $\mu_0$ dips ~`7` pts more than $\delta_{d,\text{sel}}$ rises, while $\delta_{d,\text{sel}} > 0 > \delta_{d,\text{impl}}$ immediately captures stronger selection relative to coding.)*
3. **Independent Facet Offset Updates:** Update $\delta_{d,f}, \sigma_{d,f}, \sigma_{d,f,\text{fresh}}$ from pre-attempt snapshot. When `prescribed` is true, track `consecutiveMisses` (`implScore <= 0.40`), `recentStruggles`, `prescribedGradedCount`, and `lastPrescribedSlotKind`.

### 2.4 Break / Rust Display, Rubric → Concept Mapping (`F10`) & Stability Ladder

1. **Rusty Badge & Display Rating:** Practiced domain shows **Rusty** at $\Delta t \ge 45$ idle calendar days; display deducts $0.85 \cdot \max(0, \sigma'(\Delta t) - \sigma_{d,f,\text{fresh}})$ (`26` pts after 120 idle days from $\sigma_{\text{fresh}} = 65$; $E$ always uses latent $\theta_{d,f}$).
2. **Track B Rubric → Concept Outcome (`conceptOutcomeFromRubric`, `F10`):** Rows 2–3 → `"applied"`; optimal alternative route → `"probed-uncoached"` if unlearned else `"none"`; Rows 1, 4 (suboptimal), 5–7 → **`"lapsed"`** on `coached`/`applied` records (also pushed to `recentStruggles`), else `"probed-uncoached"`.
3. **Stability Transitions ($R_c(\Delta t, S_c) = (1 + \Delta t / (9 S_c))^{-1}$):**
   - `probed-uncoached`: `state = "probed"`, $S_c = 0$, `probeCount += 1`, `lastEvaluatedAt = now`.
   - `coached`: First → `4d`; repeat on `coached` → **`S_c = min(prev.stabilityDays, 4)`**; on `applied` → **no-op on stability or clock**.
   - `applied`: First → `14d` if previously `coached` with $\Delta t \ge 2\text{d}$ else `12d`. Subsequent → $S_c' = \min(730, S_c \cdot (1 + 2.2 \cdot (1 - R_c + 0.15) \cdot \min(1.5, \Delta t / S_c)))$: same-day cram `14.00 → 14.03d`; exact $R_c = 0.88$: `4 → 14 → 24 → 42 → 72 → 125d`; whole days: `4 → 14 → 25 → 43 → 76 → 131d`.
   - `lapsed`: **$S_c' = \min(S_c,\; 10,\; \max(2,\; 0.25 \cdot S_c))$**, `lapses += 1`, `lastEvaluatedAt = now` (`lastSuccessAt` unchanged). **`4d → 2d`** (due in `3` days), **`14d → 3.5d`**, **`120d → 10d`**.

---

## 3. Check-In State Machine, Drain & Replay, Persistence & Guardrails

### 3.1 Check-In Actions (`F2`, `F4`), Drain-Before-Prescribe, Replay (`F1`, `F5`, `F6`) & Snapshots (`F7`)

- **Unified Settled Contract (`isCheckInSettled` & `canTransitionToComplete`):**
  `isCheckInSettled(a)` returns `true` iff `a.demonstration`, `!a.sealed`, `a.phase ∈ {"active", "paused", "complete"}`, `a.reflection?.intake`, `a.reflection?.checkInSkippedAt !== undefined`, or `(a.reflection?.messages?.length ?? 0) > 0`.
  - **`complete` Guard (`F2`):** `store.transition(id, "complete")` ([`lib/store.ts:377`](../lib/store.ts)) rejects `complete` with HTTP `400` if `!canTransitionToComplete(a)`, and [`components/reflection-workspace.tsx:339`](../components/reflection-workspace.tsx) disables `"Skip reflection"` during intake while preserving legacy exemptions.
  - **Hard Gate (`nextAssessmentGate`):** Applies identically to `recommend()` and `POST /api/state`.

| Check-In Action (`familiarity` Required, No Default) | Persisted State | `rating_jobs` | Big-O Stored | `nextAssessmentGate` |
| :--- | :--- | :---: | :--- | :--- |
| **Continue to coaching** | `intake` saved, `phase = "review"`, `coachingDeferred = false` | `pending` | `time`, `space` | Blocked (`active-coaching`) |
| **Come back to coaching later** | `intake` saved, `phase = "review"`, `coachingDeferred = true` | `pending` | `time`, `space` | **Allowed** *(Pending Reflections)* |
| **Submit & skip coaching** | `intake` saved, `phase = "complete"`, `learningExit = "skipped"` | `pending` | `time`, `space` | **Allowed** |
| **Skip check-in** *(1-tap Familiarity, `F4`)* | `checkInSkippedAt = now`, `phase = "complete"`, `learningExit = "skipped"` | `pending` | `unsure` / `unsure` | **Allowed** |
| Raw/Toolbar `"complete"` while `!isCheckInSettled` *(**`F2`**)* | **Rejected (HTTP 400)** | None | Unchanged | Blocked (`unsettled-checkin`) |

**SQLite Schema, Drain Coordinator & Ledger Replay (`F1`, `F5`, `F6`, `F7`):**
- `practice_launches` adds `rated INTEGER NOT NULL DEFAULT 1` (`0` for practice-only self-picked catalog attempts; `1` for prescribed attempts).
- `skill_rating_events` enforces partial unique index `CREATE UNIQUE INDEX idx_skill_rating_events_attempt_graded ON skill_rating_events(attemptId) WHERE kind = 'attempt-graded'` plus `UNIQUE(idempotencyKey)` (`compensate:${attemptId}:${sourceRevision}`).
- **`drainPendingRatingJobs(db)`:** Single-flight drain barrier run before `startPrescription`, draining `pending` / `running` / bounded-retry (`maxAutoRetries = 2`) `rating_jobs` strictly in **`launchSeq ASC`** order, falling back gracefully without blocking on provider outage.
- **`replayRatingLedger(launches, events)`:**
  - Folds launches in `launchSeq ASC` order; derives `prescribedCount` from `launch.prescribed` and `recentDomains` from all launches (`effective.primaryDomain ?? launch.provisionalDomain`), so both prescribed and practice-only launches apply light domain cooldowns and pending jobs advance Director slots immediately.
  - Applies Track A updates (`applyAttemptGraded(..., { trackLaunchInReducer: false, prescribed: launch.prescribed })`) only when `launch.rated ?? launch.prescribed` is true; unrated (`rated = false`) self-picks still record `complexityCalibration` and positive Track B applications (`applied` / `coached`, no `lapsed` penalties).
  - Replays concept transitions (attempt outcomes at `phaseRank = 0`, reflection coaching at `phaseRank = 1`, standalone concept events) strictly sorted by **`(occurredDay ASC, launchSeq ASC, phaseRank ASC, eventId ASC)`**.
- **Snapshots & Reset (`F7`):** `LibraryImage`, `exportLibrary` ([`lib/store.ts:86`](../lib/store.ts)), and [`lib/snapshots.ts`](../lib/snapshots.ts) capture, replace, restore (`rating_jobs.status = 'running' → 'pending'`), and rollback `practice_launches`, `rating_jobs`, `skill_rating_events`, `director_preferences`, and `onboarding_state`.

### 3.2 Domain-Level Alternative-Route Guard (`evaluateMissedTargetSelection`, `F11`)
Unused domain $d$ receives $S_{d,\text{sel}} = 0.20$ on a missed `selection` target **iff both**: (1) strictly worse asymptotic complexity than optimal (or timeout where $d$ passes), **AND** (2) targeted `targetConceptSlug` has `state ∈ {"coached", "applied"}`, **OR** (when omitted on `Growth`/`Breadth`/`Consolidation` Selection targets) **any Track B concept in `targetDomain`** has `state ∈ {"coached", "applied"}`.

### 3.3 Separate Time & Space Big-O Calibration & Non-Punitive Rescue (`ΔS ≥ 0`)
- Stored independently in `complexityCalibration.time` / `space` as `"${accurate} of ${accurate + inaccurate} accurate, ${unsure} unsure"`; never coupled into domain ratings.
- Reflection only appends non-punitive `reflection-rescue` ($\Delta S \in [0, +0.25]$ on Row 5/6 near-misses) and `coached` concepts.

---

## 4. Onboarding, Disguise Check & Normative Pacing Director

### 4.1 Launch Provenance, Disguise Verification (`F8`) & Spoiler Guard
- Verified `prescriptionId` flows through `Workspace.start` ([`components/workspace.tsx:753`](../components/workspace.tsx)) into `POST /api/state`, persisting `attempt.prescription = { id, intent, selectionSpoilerRevealed }`; self-picked catalog launches omit `prescriptionId` (`rated = false`).
- On `targetFacet === "selection"`, candidates must pass both `isTitleDisguisedForTarget` and Planner `inspect_problem` verification of title, starter signature, and prompt text, with `p.evidence` hidden pre-start ([`components/problem-prescription.tsx:205-241`](../components/problem-prescription.tsx)) unless explicitly revealed (`selectionSpoilerRevealed: true` sets $w_{d,\text{sel}} = 0$).

### 4.2 Normative Pacing Director (`selectNextIntent`, `F12`, `D1`, v8)
See [`PRESCRIPTION_AND_ONBOARDING_DESIGN.md`](./PRESCRIPTION_AND_ONBOARDING_DESIGN.md) for Planner schemas, timebox bands, onboarding seeds, and conversational steering tools. Director scheduling summary:
1. **Stage 1 Adaptive Calibration (`prescribedCount < 4`):** `selectOnboardingIntent` starts from the learner's selected `StartingTier` band on Session #1 ($\mu_0 = 1000 \pm 220$), eases down to `easy-reinforcement` (`12–15m`) after any `score <= 0.40` miss, or steps up across `4` unmuted core domains (`graphs-search` Selection on #4 for high scorers).
2. **Stage 2+ Eligibility, Mute Constraints & Cooldowns:** `validateDirectorPreferences` enforces `<= 3` `focusDomains`, disjoint `mutedDomains`, and `>= 4` Easy-backed domains unmuted. Exclude domains in `mutedDomains`, below `DOMAIN_MIN_GLOBAL_MU` (`backtracking >= 980`), matching `prevDomain`, or appearing `>= 2` times in the last `6` attempts (fallback relaxes 6-cap first, then `prevDomain`).
3. **Reactive 2-Miss Circuit Breaker:** If `consecutiveMisses >= 2 && lastPrescribedSlotKind !== "easy-reinforcement"`, immediately preempt the slot with **`selectEasyReinforcementTarget`** (anti-loop rule prevents consecutive Easy Reinforcements).
4. **Purposeful Easy Reinforcement Target Priority (`[θ - 210, θ - 135]`, `preferEasy: true`, `12–15m`, `implementation`):**
   (1) Eligible domain with a struggle in last `14` days (`recentStruggles`) → (2) Fragile/near-due Track B concept ($R_c \le 0.92$ or $S_c < 14\text{d}$) → (3) Rusty domain → (4) Strongest domain (`implOffset DESC`).
5. **5-Slot Schedule (`slotIndex = prescribedCount % 5`, ties broken by canonical domain index):**
   - **Consolidation (Slot `3`, or Slot `2` overflow when `dueConcepts.length >= 2`):** Top due concept ($R_c \le 0.88$, sorted by `R ASC, stabilityDays ASC, order ASC`) at `[-40, +5]`, or Rusty fallback on Slot `3`.
   - **Slot `1` Probe / Breadth (or Slot `3` fallback if `any(implSigma > 95)`):** Slot `1` with `fragileCount < MAX_FRAGILE_CONCEPTS (4)` probes first canonical eligible `CONCEPT_CATALOGUE` entry at `[-55, -15]`; otherwise `Breadth` picks max `implSigma` at `[-45, +10]`.
   - **Slot `4` Proactive Easy Reinforcement:** Calls `selectEasyReinforcementTarget` (unless previous slot was already `easy-reinforcement`).
   - **Default (Slot `0`, `2`, or `3/4` fallback) Growth:** Minimizes `min(implOffset - 0.6*implSigma, selOffset - 0.6*selSigma) - (isFocused ? 35 : 0)` at `[-45, +10]`, setting `targetFacet = "selection"` iff `implOffset - selOffset >= 35 || implAttempts % 3 === 2`.
6. **Planner Tolerance & Skips:** `evidenceIds: []` permitted at [`lib/prescription.ts:463`](../lib/prescription.ts) whenever `intent` is set; `"Choose another"` retains intent for skips `1–2` and rotates domain on skip `3`; `adjustPrescriptionIntent` supports interactive coach steering.

---

## 5. Machine-Asserted Verification & 200-Seed Recovery Results

Every value below is strictly asserted in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts) (`16/16` tests passing):

1. **Onboarding & Calibration:**
   - Weak (`4 × 0.0` @ `D = 920`) drops $\mu_0$ to **`738.14`**; Stage-2 Director skips `backtracking`, clamps `band[0] = 800`, and rotates domains. Clean Easies move `1000 ± 220` to **`1167 ± 146`**.
   - Starting tiers keep initial prior at `1000 ± 220`; `isRatingRevealed` stays `false` for `0..3` graded prescribed solves and flips `true` at `4`.
2. **Hand-Attributed 11-Session Fixture Replay (22–26 Oct + 19 Nov, strictly §2.3 rubric scores, `prescribedCount = 0`):**
   - **Global Base:** **`1077 ± 112`** (`graphs-search: 1121 ± 107`, `binary-search: 1116 ± 106`, `hashing-prefix: 1088 ± 107`, `two-pointers-window: 1087 ± 108`, `sorting-intervals: 1084 ± 108`, `heaps-ordered: 1059 ± 109`, `stacks-queues-linked: 1055 ± 108` — all *Provisional* while $\sigma > 80$).
   - **Next 5 Director Prescriptions (Days 34–38, `0` cooldown violations):**
     1. `Slot 0 [growth]`: `stacks-queues-linked` (`selection`) @ `1032–1087`
     2. `Slot 1 [breadth]`: `arrays-strings` (`implementation`) @ `1032–1087`
     3. `Slot 2 [consolidation]`: `binary-search` (`implementation`, `binary-search-index`) @ `1076–1121`
     4. `Slot 3 [consolidation]`: `hashing-prefix` (`implementation`, `prefix-sum-map`) @ `1048–1093`
     5. `Slot 4 [easy-reinforcement]`: `sorting-intervals` (`implementation`, `custom-comparator-intervals`, `preferEasy`) @ `874–949`
3. **Deterministic 200-Seed 365-Day v8 Recovery, Real Lapses, Failure-Streak Guard & Concept Pace (`0` cooldown violations across 219,000 simulated days):**

| Learner (`trueBase`) | 90d Global MAE | Mean `graphs − dp` Gap `(90d → 180d → 365d)` | `dp > graphs` Inversions `(90d → 180d → 365d)` | Mean Lapses / 365d | `3+`-Miss Streaks / 365d | Concepts Introduced `(90d → 180d → 365d)` | `30+d` Stable `(90d → 180d → 365d)` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Beginner (`900`)** | `34.0` pts | `65.8 → 100.2 → 138.9` | `17.0% → 9.5% → 2.0%` | `70.0` | `35.87` | `9.1 → 11.9 → 13.7` | `0.8 → 3.2 → 6.5` |
| **Intermediate (`1150`)** | `26.6` pts | `56.7 → 101.3 → 133.6` | `23.0% → 10.0% → 1.5%` | `64.1` | `17.77` | `12.3 → 17.0 → 21.0` | `0.9 → 5.0 → 11.1` |
| **Strong (`1350`)** | `25.5` pts | `58.6 → 94.6 → 133.1` | `17.0% → 7.0% → 1.0%` | `63.5` | `16.59` | `12.4 → 17.1 → 20.9` | `1.1 → 5.0 → 11.1` |
