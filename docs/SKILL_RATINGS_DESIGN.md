# Design Specification (v7): Hierarchical Skill Ratings, Concept Stability & Pacing Director

> [!NOTE]
> **Design specification (v7 — ready for implementation)** — resolves all 12 findings (`F1`–`F12`), owner pacing decision `D1`, and all 8 smaller issues from the **v6 Combined Review**. Every equation, SQLite DDL/constraint, state transition, resolver rule, Director rule, and §5 metric is implemented and strictly asserted in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts).

---

## Summary of Changes from v6 Combined Review

| Review Finding | Resolution in v7 |
| :--- | :--- |
| **F1 (P1) — Background grading order changes ratings** | Persist monotonic **`launchSeq`** per attempt in `practice_launches`; `replayRatingLedger` replays rating transitions strictly in **`launchSeq ASC`** order and concept/lapse/rescue transitions in **`(occurredDay, launchSeq, phaseRank, eventId)`** order. Worker completion order has zero effect. |
| **F2 (P1) — `"Skip reflection"` bypasses check-in settlement** | Guard `store.transition(id, "complete")` ([`lib/store.ts:377`](../lib/store.ts)) and [`components/reflection-workspace.tsx:339`](../components/reflection-workspace.tsx) with `canTransitionToComplete(a) === isCheckInSettled(a)`. Unsettled sealed reviews cannot jump to `complete` while preserving the legacy exemption (`messages.length > 0` or already `complete`). |
| **F3 (P1) — Paged catalog search misses target bands & domains** | Extend [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs), synced [`spikes/leetcode/extension/client.mjs`](../spikes/leetcode/extension/client.mjs) (`npm run leetcode:extension`), and [`spikes/leetcode/extension/bridge.mjs:105-109`](../spikes/leetcode/extension/bridge.mjs) (`tag`, `orderBy`, `limit <= 100`, `acRate`, `topicTags`). Populate local SQLite **`catalog_problems` cache** (~38 list calls) and run `selectCandidatesFromCache` deterministically by `resolvedDomain` + full-pool `snapCandidatePool`; Planner checks statement fit only. |
| **F4 (P2) — One-tap Skip check-in leaves start gate blocked** | Explicitly define all 4 check-in exit actions: `skip-checkin` sets `checkInSkippedAt = now`, explicit `familiarity`, `time = space = "unsure"`, **`phase = "complete"`**, and `coachingDeferred = false`, unblocking `nextAssessmentGate` immediately. |
| **F5 (P2) — Pending grade repeats a Director slot** | Derive `prescribedCount` and `recentDomains` cooldowns **strictly from `practice_launches`** (using `primaryDomain ?? launch.provisionalDomain`), never inside `applyAttemptGraded`. Starting next while grading is pending advances slots immediately and never double-counts when attribution finishes. |
| **F6 (P2) — Event `UNIQUE` constraint rejects second correction** | Replace table-wide `UNIQUE(attemptId, kind)` with partial index `idx_skill_rating_events_attempt_graded ON skill_rating_events(attemptId) WHERE kind = 'attempt-graded'` plus `UNIQUE(idempotencyKey)` (`compensate:${attemptId}:${sourceRevision}`). Verified in SQLite. |
| **F7 (P2) — Snapshot restore omits grading ledger tables** | Include `practice_launches`, `rating_jobs` (`running` normalized to `pending`), and `skill_rating_events` in `LibraryImage`, `exportLibrary` ([`lib/store.ts:86`](../lib/store.ts)), snapshot capture/restore/reset, and rollback journals. |
| **F8 (P2) — Selection problem can leak technique in title/prompt** | Restore explicit problem-content disguise check for `targetFacet === "selection"`: deterministic `isTitleDisguisedForTarget` pre-filter plus planner `inspect_problem` confirmation of title, method signature, and prompt text. |
| **F9 (P2) — Domain ratings stay noisy for ~6 months** | Mark domain facet scores visually as **Provisional** while $\sigma_{d,f} > 80$ (~first 6–10 attempts in domain); keep Global Rating prominent; replace single-seed §5 convergence numbers with deterministic **200-seed 365-day recovery metrics**. |
| **F10 (P2) — Failed reviews logged as coaching, never lapses** | Add explicit Rubric Row → Concept Outcome table (`lapsed` for Rows 1, 4 suboptimal, 5–7 on `coached`/`applied` records); cap repeat `coached` stability at $\min(S_c, 4)$ and make coaching on `applied` a no-op; verify with real lapses across 200 seeds. |
| **F11 (P2) — §3.2 undefined for no-concept Selection slots** | Extend §3.2 condition (2) to domain level: when `targetConceptSlug` is omitted (`Growth`/`Breadth`/`Momentum`), Selection penalizes `0.20` on asymptotic gap iff **any Track B concept in `targetDomain`** is `coached` or `applied`. |
| **F12 (P2) — Director rules missing from spec text** | Restore every normative Director rule into §4.2 (`PrescriptionIntent` schema, `chooseTargetFacet`, domain selection & tie-breaks, Slot 3 `σ > 95` rule, Stage 2 onboarding, `Choose another`, `evidenceIds: []` relaxation). |
| **D1 & 8 Smaller Issues** | Raise `MAX_FRAGILE_CONCEPTS` from `3` to **`4`** and credit incidental optimal demonstrations on non-probe problems; add `CANONICAL_PROBLEM_OVERRIDES` (11 classics); raise `topological-sort` `minGlobalMu` to **`1080`**; define post-2-probe 90d pause; cite existing manual `"Record outside help"` UI (`type === "assistance" && !assistanceId`); document `<800` floor, `0.75/0.40` base interaction, extension client sync, and label 11-session replay as a fixture using valid rubric values. |

---

## 1. Taxonomy, Local Catalog Contract, 53-Slug Resolver & 24-Concept Catalogue

### 1.1 Track A — 13 Rated Domains, Extension Bridge & Local Catalog Cache (`F3`)

Build-time catalog contract across three files:
1. [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs): Preserve `acRate` (`0..100`) and `topicTags { name slug }` on list items; allow `limit <= 100` alongside optional `tag` and `orderBy` (`"AC_RATE_DESC" | "AC_RATE_ASC"`) for cache sync and direct queries. Validation schemas in [`lib/validation.ts`](../lib/validation.ts) and [`lib/prescription.ts`](../lib/prescription.ts) preserve both fields.
2. [`spikes/leetcode/extension/client.mjs`](../spikes/leetcode/extension/client.mjs): Tracked copy of `spikes/leetcode/client.mjs`. Every edit to `client.mjs` **must** re-run `npm run leetcode:extension` so both files stay identical.
3. [`spikes/leetcode/extension/bridge.mjs:105-109`](../spikes/leetcode/extension/bridge.mjs): Forward `{ skip, limit, search, difficulty, tag, orderBy }` intact to `LeetCodeClient.list` (clamping `1 <= limit <= 100`), asserted in extension bridge unit tests.

**Why Local Catalog Caching (`catalog_problems` SQLite table) Replaces Paged Tag Search:**
Paged `search_problems` cannot reach `[1043, 1098]` reliably within a 6×30 budget (e.g., first in-band same-domain `array` problem sits at rank `175` with `difficulty: MEDIUM`) and cannot compute whole-pool `snapCandidatePool`. Instead:
- Sync the catalog metadata (`slug`, `frontendId`, `title`, `difficulty`, `acRate`, `isPaidOnly`, `topicTagSlugsJson`, precomputed `resolvedDomain`, `baseDifficulty`, `excluded`, `fetchedAt`) into SQLite `catalog_problems` (~38 `limit: 100` paginated calls on cold start, `7`-day TTL + incremental refresh).
- **Deterministic Candidate Shortlisting (`selectCandidatesFromCache`):** Query the **full local cache** filtering `!excluded`, `isPremium || !isPaidOnly`, `!excludedSlugs` (attempted/recent/skipped), **`resolvedDomain === intent.targetDomain`** (never raw `tag` membership alone), `searchTagSlug` when probing a concept, `!revealingTitle` (`isTitleDisguisedForTarget`) when `targetFacet === "selection"`, then apply `snapCandidatePool` over the entire matching pool.
- Hand only the `10–15` shortlisted candidates to the Planner Agent for `inspect_problem` statement-fit and full disguise verification.

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

Excluded slugs (`{"database", "shell", "concurrency", "interactive", "design", "data-stream"}`) set `excluded = 1` in `catalog_problems` and are skipped by recommendations.

### 1.2 Canonical Overrides & `1..53` Tag Priority Resolver (`Smaller #1`)

Before evaluating topic tags, check `CANONICAL_PROBLEM_OVERRIDES[slug]` for famous multi-tag problems whose historical LeetCode tags misroute under any tag-only rule:
- **`hashing-prefix`:** `contains-duplicate`, `valid-anagram`, `group-anagrams`, `longest-consecutive-sequence`
- **`dynamic-programming`:** `coin-change`, `perfect-squares`, `word-break`, `longest-increasing-subsequence`
- **`two-pointers-window`:** `two-sum-ii-input-array-is-sorted`, `container-with-most-water`
- **`arrays-strings`:** `longest-common-prefix`

Otherwise, pick the lowest priority rank (`1` = highest specificity) across all 53 mapped `topicTags.slug` values (`recursion` #47 is inspected only after ranks `1..46`; untagged falls back to `arrays-strings`):

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
```ts
type ConceptRecord = {
  slug: string;
  domain: DomainId;
  state: "probed" | "coached" | "applied";
  stabilityDays: number;        // 0 while state === "probed"; >0 once coached/applied
  lastEvaluatedAt: number;      // updated on probed, coached, applied, AND lapse (governs Δt)
  lastSuccessAt: number | null; // updated ONLY on coached or applied (null while probed)
  probeCount: number;           // 14-day cooldown for <2 probes; 90-day pause once probeCount >= 2
  reps: number;
  lapses: number;
};
```

- **Post-2-Probe Path (`Smaller #3`):** Once `probeCount >= 2` while still `state === "probed"`, automatic Slot-1 probing pauses for `90` calendar days (preserving Slot-1 bandwidth for other concepts). Meanwhile, the concept immediately promotes to `coached` (if discussed in reflection or explicit study goal) or `applied` (if observed incidentally in an optimal Growth/Breadth/Momentum/self-picked solve).
- **`topological-sort` Unlock (`Smaller #2`):** `minGlobalMu = 1080` so its entry problems (`1043–1114`) match its probe band (`E(1080, 1043) = 0.56`).

| Order | `slug` | Domain | `searchTagSlug` | `minGlobalMu` |
| :---: | :--- | :--- | :--- | :---: |
| 1 | `in-place-array-scan` | `arrays-strings` | `matrix` | `800` |
| 2 | `hash-map-set` | `hashing-prefix` | `hash-table` | `800` |
| 3 | `prefix-sum-map` | `hashing-prefix` | `prefix-sum` | `850` |
| 4 | `converging-two-pointers` | `two-pointers-window` | `two-pointers` | `800` |
| 5 | `variable-sliding-window` | `two-pointers-window` | `sliding-window` | `900` |
| 6 | `custom-comparator-intervals` | `sorting-intervals` | `sorting` | `850` |
| 7 | `quickselect-partition` | `sorting-intervals` | `sorting` | `1020` |
| 8 | `lifo-fifo-state` | `stacks-queues-linked` | `stack` | `800` |
| 9 | `linked-list-pointers` | `stacks-queues-linked` | `linked-list` | `850` |
| 10 | `monotonic-stack-deque` | `stacks-queues-linked` | `monotonic-stack` | `980` |
| 11 | `binary-search-index` | `binary-search` | `binary-search` | `800` |
| 12 | `binary-search-answer` | `binary-search` | `binary-search` | `1020` |
| 13 | `top-k-priority-queue` | `heaps-ordered` | `heap-priority-queue` | `900` |
| 14 | `ordered-set-map` | `heaps-ordered` | `ordered-set` | `1020` |
| 15 | `tree-dfs-recursion` | `trees-recursion` | `binary-tree` | `850` |
| 16 | `bst-ordering` | `trees-recursion` | `binary-search-tree` | `920` |
| 17 | `prefix-trie` | `trees-recursion` | `trie` | `1000` |
| 18 | `grid-graph-bfs-dfs` | `graphs-search` | `breadth-first-search` | `920` |
| 19 | `topological-sort` | `graphs-search` | `topological-sort` | **`1080`** |
| 20 | `union-find` | `graphs-search` | `union-find` | `1000` |
| 21 | `weighted-shortest-path` | `graphs-search` | `graph` | `1100` |
| 22 | `state-space-backtracking` | `backtracking` | `backtracking` | `980` |
| 23 | `dp-1d-2d` | `dynamic-programming` | `dynamic-programming` | `960` |
| 24 | `greedy-bitwise` | `greedy` | `greedy` | `900` |

---

## 2. Closed-Form Difficulty, Rating & Stability Equations

### 2.1 State Parameters & Provisional Domain Display (`F9`)
- **Global Base:** $\mu_0$ (init `1000`), $\sigma_0 \in [20, 220]$ (init `220`).
- **Domain Facets ($d \in \{1..13\}, f \in \{\text{impl}, \text{sel}\}$):** $\delta_{d,f}$ (init `0`), $\sigma_{d,\text{impl}} \in [45, 150]$ (init `110`), $\sigma_{d,\text{sel}} \in [55, 150]$ (init `110`), `freshSigma` (init `110`), `lastUpdatedAt`, `implAttempts`.
- **Steady-State Global Bleed Guard:** At floors ($\sigma_0 = 20, \sigma_{d,\text{impl}} = 45$), global variance share is $\frac{20^2}{20^2 + 45^2} = \mathbf{16.5\%}$ (`83.5%` domain-local).
- **Provisional Domain Display (`F9`):** Because domain separation takes ~10–15 per-domain attempts (~6 months across 13 domains at 1 problem/day), domain facet scores render a muted **Provisional** indicator (`isDomainProvisional(sigma) = sigma > 80`, typically the first ~6–10 attempts in that domain), keeping the converged Global Rating primary in the UI.

### 2.2 Overlapping Difficulty Mapping ($D$), Empty-Band Snap & Expected Score ($E$)
1. **Overlapping Base Difficulty ($a = \text{acRatePct} / 100 \in [0, 1]$, structural modifier $\Delta D \in [-50, +50]$):**
   - **Easy:** $D_{\text{base}} = 800 + 280 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.85 - a}{0.55}\right) \in [800,\; 1080]$
   - **Medium:** $D_{\text{base}} = 980 + 420 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.80 - a}{0.55}\right) \in [980,\; 1400]$
   - **Hard:** $D_{\text{base}} = 1340 + 460 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.70 - a}{0.50}\right) \in [1340,\; 1800]$
   - Final $D = \text{clamp}_{[800, 1850]}(\text{round}(D_{\text{base}} + \Delta D))$.
   - **Beginner Floor Note (`Smaller #5`):** When $\mu_0 < 800$ (e.g., `738.14` after 4 zero-score Stage-1 onboarding solves), target bands clamp to `[800, 830]`; against the easiest `800`-rated Easies, $E(738, 800) \approx 0.39$, which awards larger `+75` upside on the learner's first clean solve.
2. **Empty-Band Snap Rule (`snapCandidatePool`):** Over the full locally-cached domain pool, try `[L, U]` → `[L - 60, U + 60]` → nearest 3 candidates by $|D_{\text{base}} - \text{mid}|$ (or next eligible domain if 0 candidates). Grading uses chosen $D$.
3. **Expected Score ($L = 320, q = \frac{\ln 10}{320}, \sigma_p = 55, g(\sigma_p) \approx 0.9770$):**
   $$E(\theta, D) = \frac{1}{1 + 10^{-g(\sigma_p)(\theta - D)/320}}$$
   - **Momentum (`[θ - 105, θ - 55]`):** $E \in [0.60,\; 0.68]$ · **Growth & Breadth (`[θ - 45, θ + 10]`):** $E \in [0.48,\; 0.58]$ · **Concept Probe (`[θ - 55, θ - 15]`):** $E \in [0.53,\; 0.60]$ · **Consolidation (`[θ - 40, θ + 5]`):** $E \in [0.49,\; 0.57]$ · **Stretch (`[θ + 10, θ + 65]`):** $E \in [0.39,\; 0.48]$.

### 2.3 Mutually Exclusive Rubric ($S \in [0, 1]$) & Single-Base Update Step

Evaluated **top-to-bottom (first match wins)** per exercised domain ($\sum_d w_{d,\text{impl}} = 1$; $w_{d,\text{sel}} = 0$ on signature-forced inputs or if `selectionSpoilerRevealed === true`).
- **Row 1 Outside Help Detection (`Smaller #4`):** Matches existing manual `"Record outside help"` events recorded via [`components/assessment-menu.tsx:47`](../components/assessment-menu.tsx) and [`components/workspace.tsx:1537`](../components/workspace.tsx) (`event.type === "assistance" && !event.assistanceId`) as well as explicit help disclosures in reflection. Java syntax/API lookups (`attempt.javaHelp`) carry zero penalty.

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
2. **Single Global Base Update (from `implementation` updates only):**
   Normalize $\hat{w}_d$, $\tilde{w}_d = \hat{w}_d m_{\text{fam},d}$, $E_d = E(\mu_0^{\text{pre}} + \delta_{d,\text{impl}}^{\text{pre}}, D)$, $R_{\text{tot}} = \sum_d \tilde{w}_d(S_{d,\text{impl}} - E_d)$, $I_{\text{tot}} = \sum_d \tilde{w}_d q^2 g(\sigma_p)^2 E_d(1 - E_d)$, $\bar{\sigma}_{\text{dom}}^2 = \sum_d \hat{w}_d (\sigma_{d,\text{impl}}^{\text{pre}})^2$, $V_0 = (\sigma_0^{\text{pre}})^2 + \bar{\sigma}_{\text{dom}}^2$, $\alpha_0 = \frac{(\sigma_0^{\text{pre}})^2}{V_0}$:
   $$\mu_0 \leftarrow \mu_0^{\text{pre}} + \alpha_0 \frac{q g(\sigma_p) R_{\text{tot}}}{V_0^{-1} + I_{\text{tot}}}, \qquad \sigma_0 \leftarrow \max\!\left(20,\; \left((\sigma_0^{\text{pre}})^{-2} + \alpha_0 I_{\text{tot}}\right)^{-1/2}\right)$$
   - *First-Attempt Base Interaction Note (`Smaller #6`):* On an initial near-miss with `Selection = 0.75, Implementation = 0.40` while $\sigma_0 = 220$, $\mu_0$ drops slightly more than $\delta_{d,\text{sel}}$ rises, so combined $\theta_{d,\text{sel}} = \mu_0 + \delta_{d,\text{sel}}$ dips ~`7` pts while $\delta_{d,\text{sel}} > 0 > \delta_{d,\text{impl}}$ immediately captures stronger pattern recognition relative to coding execution.
3. **Independent Facet Offset Updates:** Compute $\delta_{d,f}, \sigma_{d,f}, \sigma_{d,f,\text{fresh}}$ from the pre-attempt snapshot.

### 2.4 Break / Rust Display, Rubric → Concept Mapping (`F10`) & Stability Ladder

1. **Rusty Badge & Display Rating:** Practiced domain shows **Rusty** at $\Delta t \ge 45$ idle calendar days; display deducts $0.85 \cdot \max(0, \sigma'(\Delta t) - \sigma_{d,f,\text{fresh}})$ (`26` pts after 120 idle days from $\sigma_{\text{fresh}} = 65$; $E$ always uses latent $\theta_{d,f}$).
2. **Track B Rubric → Concept Outcome Mapping (`conceptOutcomeFromRubric`, `F10`):**

| Targeted Attempt / Review Outcome | Existing `unseen` / `"probed"` | Existing `"coached"` or `"applied"` |
| :--- | :--- | :--- |
| **Rows 2–3** *(Accepted, optimal complexity)* | `"applied"` *(12d)* | `"applied"` *(grows stability)* |
| **Optimal alternative route** *(missed target, §3.2)* | `"probed-uncoached"` | `"none"` *(no penalty, no lapse)* |
| **Row 1 / Row 4 suboptimal / Rows 5–7** *(failed target)* | `"probed-uncoached"` *(later `"coached"` iff reflection teaches it)* | **`"lapsed"`** *(strictly shrinks stability)* |

3. **Stability Transitions ($R_c(\Delta t, S_c) = (1 + \Delta t / (9 S_c))^{-1}$):**
   - `probed-uncoached`: `state = "probed"`, $S_c = 0$, `probeCount += 1`, `lastEvaluatedAt = now`.
   - `coached`:
     - If `!prev || prev.state === "probed"`: `state = "coached"`, $S_c = 4\text{d}$, `lastEvaluatedAt = lastSuccessAt = now`.
     - If `prev.state === "coached"`: **`S_c = min(prev.stabilityDays, 4)`**, `lastEvaluatedAt = max(prev.lastEvaluatedAt, now)` *(a lapsed `2d` coached concept stays `2d`; repeat coaching never restores `4d`)*.
     - If `prev.state === "applied"`: **no-op on `stabilityDays` and `lastEvaluatedAt`** *(coaching never acts as a free refresh on an already-applied concept)*.
   - `applied`:
     - First `applied`: $S_c = 14\text{d}$ if previously `coached` with $\Delta t \ge 2\text{d}$ else $12\text{d}$, `reps = 1`, `lastEvaluatedAt = lastSuccessAt = now`.
     - Subsequent `applied`: $S_c' = \min(730, S_c \cdot (1 + 2.2 \cdot (1 - R_c + 0.15) \cdot \min(1.5, \Delta t / S_c)))$:
       - Same-day cram ($\Delta t = 0.1\text{d}$ from `14d`): **`14.00 → 14.03 days`**.
       - Continuous $R_c = 0.88$: **`4 → 14 → 24 → 42 → 72 → 125 days`** · Whole calendar days: **`4 → 14 → 25 → 43 → 76 → 131 days`**.
   - `lapsed`: $S_c' = \min(S_c,\; 10,\; \max(2,\; 0.25 \cdot S_c))$, `lapses += 1`, `lastEvaluatedAt = now` (`lastSuccessAt` unchanged). **`4d → 2d`** (due in `3` days), **`14d → 3.5d`**, **`120d → 10d`**.

---

## 3. Check-In State Machine, Launch-Sequence Replay, Persistence & Guardrails

### 3.1 Check-In Actions (`F2`, `F4`), Durable Replay (`F1`, `F5`, `F6`) & Snapshots (`F7`)

**Unified Check-In Contract (`isCheckInSettled` & `canTransitionToComplete`):**
`isCheckInSettled(a)` is true iff `a.demonstration`, `!a.sealed`, `a.phase ∈ {"active", "paused", "complete"}`, `a.reflection?.intake`, `a.reflection?.checkInSkippedAt !== undefined`, or `(a.reflection?.messages?.length ?? 0) > 0`.
- **`complete` API & Toolbar Guard (`F2`):** `store.transition(id, "complete")` ([`lib/store.ts:377`](../lib/store.ts)) MUST reject `action === "complete"` with HTTP `400` whenever `!canTransitionToComplete(a)` (defined as `isCheckInSettled(a)` on the **pre-transition** attempt!), and [`components/reflection-workspace.tsx:339`](../components/reflection-workspace.tsx) disables `"Skip reflection"` while `intakeActive` is active. Pre-existing legacy attempts with `reflection.messages.length > 0` or already-`complete` phase stay exempt and never trap learners.
- **Hard Gate (`nextAssessmentGate`):** Blocks BOTH Today prescriptions (`recommend()`) and self-picked catalog starts (`POST /api/state`) when `!isCheckInSettled(a)` or `(phase ∈ {"review","learn"} && !coachingDeferred)`.

| Check-In Exit Action (`familiarity` Required, No Default) | Persisted Attempt State | `rating_jobs` Enqueued | Complexity Stored | `nextAssessmentGate` |
| :--- | :--- | :---: | :--- | :--- |
| **Continue to coaching** | `intake` saved, `phase = "review"`, `coachingDeferred = false` | `pending` | `time`, `space` | Blocked (`active-coaching`) |
| **Come back to coaching later** | `intake` saved, `phase = "review"`, `coachingDeferred = true` | `pending` | `time`, `space` | **Allowed** *(on Pending Reflections)* |
| **Submit & skip coaching** | `intake` saved, `phase = "complete"`, `learningExit = "skipped"` | `pending` | `time`, `space` | **Allowed** |
| **Skip check-in** *(1-tap Familiarity only, `F4`)* | `checkInSkippedAt = now`, `phase = "complete"`, `learningExit = "skipped"` | `pending` | `unsure` / `unsure` | **Allowed** |
| Toolbar / API `"complete"` while `!isCheckInSettled` *(**`F2`**)* | **Rejected (HTTP 400)** | None | Unchanged | Blocked (`unsettled-checkin`) |

**SQLite Ledger Schema (`F1`, `F5`, `F6`):**
```sql
CREATE TABLE practice_launches (
  attemptId TEXT PRIMARY KEY,
  launchSeq INTEGER NOT NULL UNIQUE,      -- monotonic start sequence assigned synchronously at launch
  day INTEGER NOT NULL,
  prescribed INTEGER NOT NULL,
  provisionalDomain TEXT NOT NULL,
  intentJson TEXT,
  selectionSpoilerRevealed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE rating_jobs (
  attemptId TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'complete', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE skill_rating_events (
  id TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL,
  launchSeq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('attempt-graded', 'compensating-recompute', 'reflection-rescue', 'concept-event')),
  idempotencyKey TEXT NOT NULL UNIQUE,    -- e.g. compensate:${attemptId}:${sourceRevision}
  occurredDay INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  payloadJson TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_skill_rating_events_attempt_graded
  ON skill_rating_events(attemptId) WHERE kind = 'attempt-graded';
```
- **Order-Independent Background Grading (`F1`, `F5`):** `replayRatingLedger(launches, events)` always folds `practice_launches` in **`launchSeq ASC`** order:
  1. `prescribedCount` and `recentDomains` cooldown history are derived **strictly from `practice_launches`** (using `effective.primaryDomain ?? launch.provisionalDomain`), so pending jobs advance the Director immediately without double-counting when grading finishes (`F5`).
  2. Each launch merges its `attempt-graded` payload with any `compensating-recompute` rows (ordered by `createdAt, id`), applies any non-punitive `reflection-rescue` ($\Delta S \in [0, +0.25]$), and runs `applyAttemptGraded(..., { trackLaunchInReducer: false })`.
  3. Concept transitions (grading outcomes at `phaseRank = 0`, reflection coaching at `phaseRank = 1`, standalone concept events) replay deterministically sorted by **`(occurredDay ASC, launchSeq ASC, phaseRank ASC, eventId ASC)`**. Late/reordered worker completions yield bit-for-bit identical ratings, `globalLastDay`, and concept stabilities (`F1`).
- **Snapshot Capture, Restore, Reset & Rollback (`F7`):** Extend `LibraryImage` ([`lib/snapshot-types.ts`](../lib/snapshot-types.ts), [`lib/snapshot-schema.ts`](../lib/snapshot-schema.ts)), `exportLibrary` ([`lib/store.ts:86`](../lib/store.ts)), and [`lib/snapshots.ts`](../lib/snapshots.ts) (`captureLibrary`, `projectLibrary`, `replaceLibrary`, `clearLearning`, rollback journal) to round-trip `practice_launches`, `rating_jobs` (normalizing `status === 'running' → 'pending'` on restore so restored pending jobs re-dispatch cleanly), and `skill_rating_events`. Selective coaching resets clear `rating_jobs` + `skill_rating_events` for the reset attempts while preserving `practice_launches`, then recompute via `replayRatingLedger`.

### 3.2 Domain-Level Alternative-Route Guard (`evaluateMissedTargetSelection`, `F11`)

An unused domain $d$ receives $S_{d,\text{sel}} = 0.20$ on a missed `selection` target **iff both**:
1. The learner's accepted solution used strictly worse asymptotic complexity than optimal (or timed out where optimal $d$ passes); **AND**
2. Either the targeted concept (`targetConceptSlug`) has `state ∈ {"coached", "applied"}`, **OR** (when `targetConceptSlug` is omitted on `Growth`, `Breadth`, or `Momentum` Selection slots) **any Track B concept belonging to `targetDomain`** has `state ∈ {"coached", "applied"}`.

Valid optimal alternatives always incur `0` Selection penalty and `0` concept lapse.

### 3.3 Separate Time & Space Big-O Calibration & Non-Punitive Rescue (`ΔS ≥ 0`)
- Runtime and space check-in answers accumulate independently in `complexityCalibration.time` and `complexityCalibration.space` (`{ accurate, inaccurate, unsure }`) and render as **`"${accurate} of ${accurate + inaccurate} accurate, ${unsure} unsure"`** (never coupled into domain ratings).
- Conversational reflection never lowers `attempt-graded` scores; it may only append `reflection-rescue` ($\Delta S \in [0, +0.25]$ on **unaccepted** Row 5/6 near-misses) and `coached` Track B concepts.

---

## 4. Onboarding, Disguise Check & Complete Normative Pacing Director

### 4.1 Launch Provenance, Disguise Verification (`F8`) & Pre-Start Spoiler Guard
- **Launch Provenance:** [`components/problem-prescription.tsx`](../components/problem-prescription.tsx) sends `prescriptionId` via `Workspace.start` ([`components/workspace.tsx:753`](../components/workspace.tsx)) into `POST /api/state`, which verifies the saved prescription (`id` + `slug`, `!demonstration`), persists `attempt.prescription = { id, intent, selectionSpoilerRevealed }`, and inserts into `practice_launches` with `launchSeq`, `prescribed = Boolean(intent)`, and `provisionalDomain`.
- **Selection Disguise Requirement (`F8`):** Whenever `targetFacet === "selection"`, candidates **must** pass BOTH:
  1. `isTitleDisguisedForTarget(title, targetDomain)` deterministic pre-filter in `selectCandidatesFromCache` (rejecting revealing titles such as `"Binary Search"`, `"Sliding Window Maximum"`, `"Two Sum"` / method names naming the structure); **AND**
  2. Planner Agent `inspect_problem` verification confirming the problem title, starter method signature, and prompt text do not explicitly name `targetDomain`'s algorithm/data structure. If forced by starter signature or `selectionSpoilerRevealed === true`, set $w_{d,\text{sel}} = 0$.
- **Pre-Start Evidence Spoiler Guard:** When `intent.targetFacet === "selection"`, [`components/problem-prescription.tsx:205-241`](../components/problem-prescription.tsx) hides `p.evidence` (`skill`, `observation`, `support`) under `"Why this problem?"` pre-start unless explicitly revealed (`selectionSpoilerRevealed: true`), then displays full evidence once sealed.

### 4.2 Complete Normative Pacing Director (`F12` & `D1`)

```ts
type PrescriptionIntent = {
  slotIndex: number; // prescribedCount % 5
  slotKind: "growth" | "breadth" | "concept-probe" | "consolidation" | "momentum";
  targetDomain: DomainId;
  targetFacet: "implementation" | "selection";
  targetConceptSlug?: string;
  targetDifficultyBand: [number, number];
};
```

1. **Stage 1 Onboarding (first 4 prescribed solves):** Curated `10–15m` Easies covering `hashing-prefix`, `two-pointers-window`, `stacks-queues-linked`, `binary-search`. (`DOMAIN_MIN_GLOBAL_MU` gates only `backtracking` on $\mu_0 \ge 980$; all 12 Easy-backed domains remain permanently eligible even when $\mu_0 < 800$.)
2. **Stage 2 Transition & Eligibility Cooldowns:** All subsequent prescriptions invoke `selectDirectorIntent(state, day)`:
   - Exclude domains failing `DOMAIN_MIN_GLOBAL_MU`, `prevDomain` (`recentDomains.at(-1)`), or `count(recentDomains.slice(-6), d) >= 2`.
   - Defense-in-depth fallback if empty: drop the 6-attempt cap first, then drop `prevDomain`.
3. **Band Construction (`bandFor(d, facet, loDelta, hiDelta)`):**
   - Compute $\theta = \mu_0 + (\text{facet} = \text{sel} ? \delta_{d,\text{sel}} : \delta_{d,\text{impl}})$.
   - `lo = clamp([CATALOG_DIFFICULTY_FLOOR[d], 1800], round(theta + loDelta))`; `hi = clamp([lo + 30, 1850], round(theta + hiDelta))`.
4. **Target Facet Choice (`chooseTargetFacet(state, d, slotKind)`):**
   - Return `"selection"` iff `dom.implOffset - dom.selOffset >= 35`, **OR** (`slotKind === "growth" && dom.implAttempts % 3 === 2`); else `"implementation"`.
5. **Concept Due Sorting (`dueConcepts`):** Track B concepts with `state !== "probed"`, eligible domain, and $R_c(day - lastEvaluatedAt, S_c) \le 0.88$, sorted by **`R_c ASC, stabilityDays ASC, catalogueOrder ASC`**.
6. **Concept Pace & Fragile Cap (`MAX_FRAGILE_CONCEPTS = 4`, `D1`):**
   - Count concepts with `state !== "probed" && stabilityDays < 21` as `fragileCount`. Setting `MAX_FRAGILE_CONCEPTS = 4` *(owner-tunable knob)* PLUS crediting **incidental concept demonstrations** (`applied`) whenever non-probe solves demonstrate an eligible Track B concept lifts annual coverage from ~14 to **`21.0 / 24`** concepts for an Intermediate learner while keeping Consolidation queues manageable.
7. **Deterministic 5-Slot Selection (`slotIndex = prescribedCount % 5`, ties broken by canonical domain index `0..12`):**
   - **Consolidation Priority (Slot `3`, or Slot `2` overflow when `dueConcepts.length >= 2`):** Pick `dueConcepts[0]` with band `[-40, +5]`. On Slot `3` with 0 due concepts, pick first eligible `rusty` domain (`[-40, +5]`); if none, fall through to Step 8 when any eligible domain has `implSigma > 95`.
   - **Slot `1` Concept Probe → Breadth (also Slot `3` when `any(eligible, d => implSigma > 95)`):** On Slot `1` when `fragileCount < MAX_FRAGILE_CONCEPTS`, pick first canonical `CONCEPT_CATALOGUE` entry with eligible domain, $\mu_0 \ge c.\text{minGlobalMu}$, and (`!rec` OR (`rec.state === "probed"` and `dt >= (probeCount < 2 ? 14 : 90)`)) with `implementation` band `[-55, -15]`. Otherwise pick `Breadth`: eligible domain maximizing **`implSigma DESC`** (band `[-45, +10]`).
   - **Slot `4` Momentum:** Eligible domain maximizing **`implOffset DESC`** (band `[-105, -55]`).
   - **Default (Slot `0`, Slot `2`, or Slot `3` fallback) Growth:** Eligible domain minimizing Lower Confidence Bound **`min(implOffset - 0.6*implSigma, selOffset - 0.6*selSigma) ASC`** (band `[-45, +10]`).
8. **Planner Integration & `"Choose another"` (`F12`):**
   - [`lib/prescription.ts:463`](../lib/prescription.ts) allows `evidenceIds: []` when `prescription.intent` is present (so cold-start / zero-evidence domains prescribe immediately).
   - Clicking **Choose another** pushes the declined slug into `skippedSlugs`; skips 1–2 re-run the same `intent` with the next shortlisted candidate, and skip 3 rotates to the next eligible domain.

---

## 5. Machine-Asserted Verification & 200-Seed Recovery Results

All invariants, SQLite partial unique constraints, check-in exit transitions, `F1`–`F12` regressions, and §5 numbers are strictly asserted in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts):

1. **Onboarding Extremes:**
   - **Weak (`4 × 0.0` @ `D = 920`):** Global base drops to **`738.14`**; 3 consecutive Stage-2 `selectDirectorIntent` calls succeed, skip `backtracking`, clamp `band[0] = 800`, and rotate domains.
   - **Strong (`4 × 1.0` @ `D = 920`):** Global base moves from `1000 ± 220` to **`1167 ± 146`**.
2. **Hand-Attributed 11-Session Fixture Replay (22–26 Oct + 19 Nov, strictly §2.3 rubric scores, `prescribedCount = 0`):**
   - **Global Base:** **`1077 ± 112`** (`graphs-search: 1121 ± 107`, `binary-search: 1116 ± 106`, `hashing-prefix: 1088 ± 107`, `two-pointers-window: 1087 ± 108`, `sorting-intervals: 1084 ± 108`, `heaps-ordered: 1059 ± 109`, `stacks-queues-linked: 1055 ± 108` — all tagged *Provisional* since $\sigma > 80$).
   - **Next 5 Director Prescriptions (Days 34–38, `0` cooldown violations):**
     1. `Slot 0 [growth]`: `stacks-queues-linked` (`selection`) @ `1032–1087`
     2. `Slot 1 [breadth]`: `arrays-strings` (`implementation`) @ `1032–1087`
     3. `Slot 2 [consolidation]`: `binary-search` (`implementation`, `binary-search-index` after Day-3 lapse) @ `1076–1121`
     4. `Slot 3 [consolidation]`: `hashing-prefix` (`implementation`, `prefix-sum-map`) @ `1048–1093`
     5. `Slot 4 [momentum]`: `graphs-search` (`implementation`) @ `1016–1066`
3. **Deterministic 200-Seed Recovery, Real Lapses & Concept Pace (1 problem/day, true `graphs − dp = 160` pts, `0` cooldown violations across 219,000 simulated days):**

| Learner (`trueBase`) | 90d Global MAE | Mean `graphs − dp` Gap `(90d → 180d → 365d)` | `dp > graphs` Inversions `(90d → 180d → 365d)` | 180d `graphs` $\sigma$ | Mean Lapses / 365d | Concepts Introduced `(90d → 180d → 365d)` | `30+d` Stable `(90d → 180d → 365d)` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Beginner (`900`)** | `24.5` pts | `64.5 → 94.1 → 126.4` | `14.0% → 6.5% → 1.5%` | `74.2` *(calibrated)* | `66.9` | `9.0 → 11.3 → 13.0` | `1.0 → 3.5 → 6.3` |
| **Intermediate (`1150`)** | `26.6` pts | `51.0 → 85.4 → 123.7` | `22.5% → 14.0% → 3.5%` | `74.3` *(calibrated)* | `66.4` | `11.6 → 16.5 → 21.0` | `1.1 → 4.7 → 11.5` |
| **Strong (`1350`)** | `29.7` pts | `52.0 → 81.6 → 121.5` | `20.5% → 13.0% → 1.0%` | `76.8` *(calibrated)* | `65.6` | `11.9 → 16.9 → 21.1` | `1.3 → 5.1 → 11.5` |
