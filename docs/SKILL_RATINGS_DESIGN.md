# Design Specification (v6): Hierarchical Skill Ratings, Concept Stability & Pacing Director

> [!NOTE]
> **Design specification (v6 — pre-build blockers cleared & machine-asserted)** — resolves all eight findings (`P1 #1–#2`, `P2 #3–#8`) from the v5 adversarial review. Every equation, resolver rule, concept transition, gate rule, and §5 number is implemented and strictly asserted in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts).

---

## Summary of Changes from v5 Review

| Review Finding | Resolution in v6 |
| :--- | :--- |
| **1. P1 — Weak onboarding locks out all 13 domains (`μ₀ = 738.14 < 800`)** | Split **Catalog Difficulty Floor** (`800` for 12 Easy domains, `980` for `backtracking`) from **Learner Eligibility (`DOMAIN_MIN_GLOBAL_MU`)**. Only `backtracking` gates on $\mu_0 \ge 980$; the 12 Easy-backed domains are **always eligible** regardless of $\mu_0$, with cooldown relaxation if ever needed and target bands clamped to `CATALOG_DIFFICULTY_FLOOR[d]`. Asserted cleanly transitioning into Stage 2 from $\mu_0 = 738.14$. |
| **2. P1 — Gate traps legacy/restored attempts that cannot submit intake** | Defined one unified `isCheckInSettled(a)` contract matching [`lib/reflection-intake.ts`](../lib/reflection-intake.ts) and [`lib/reflection-service.ts`](../lib/reflection-service.ts): `demonstration`, `!sealed`, `phase ∈ {"active", "paused", "complete"}`, `reflection.intake`, `checkInSkippedAt !== undefined`, or `reflection.messages.length > 0` are settled. Existing/restored attempts with prior messages or `complete` phase never trap learners on an unsubmittable check-in. |
| **3. P2 — Attribution failure/retry ambiguity** | Separated synchronous **durable settlement** (`attempt` + `rating_jobs(attemptId PRIMARY KEY, status = 'pending')` committed immediately on check-in or familiarity skip, unlocking the next problem) from asynchronous **idempotent grading** (`skill_rating_events` `UNIQUE(attemptId, kind)` for `attempt-graded`), guaranteeing retries apply the grade **exactly once**. |
| **4. P2 — Launch request drops prescription ID/intent** | Carry `prescriptionId?: string` from `ProblemPrescription` through `Workspace.start` into `POST /api/state`, verifying the saved prescription (`id` + `slug`) and persisting `attempt.prescription = { id, intent }` on the created `Attempt`. `prescribedCount` increments iff `attempt.prescription?.intent` exists. |
| **5. P2 — First lapse raises coached concept stability (`4d → 5d`)** | Bounded `lapsed` stability by previous stability: $S_c' = \min(S_c,\; 10,\; \max(2,\; 0.25 \cdot S_c))$. Coached `4d` drops to `2d` (next due in `3` days instead of `5d`), `14d → 3.5d`, `120d → 10d`. |
| **6. P2 — Pre-start `"Why this problem?"` leaks Selection target** | When `prescription.intent.targetFacet === "selection"`, [`components/problem-prescription.tsx`](../components/problem-prescription.tsx) hides `p.evidence` (`skill` / `observation`) before starting (recording `selectionSpoilerRevealed: true` if explicitly expanded or if `Inspect problem selection` is opened pre-start, which sets $w_{d,\text{sel}} = 0$ on that attempt). |
| **7. P2 — `math` missing explicit rank in resolver** | Added `{ rank: 45, slug: "math", domain: "math-bitwise" }` to the now **53-slug** total priority table (shifting `divide-and-conquer` #46, `recursion` #47, `matrix..array` #48–53) and asserted all primary query slugs alone and paired with `array`. |
| **8. P2 — Published §5 numbers & cooldown invariants unasserted** | Replaced print-only summary output in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts) with strict `assert.equal` / `assert.deepEqual` checks covering every §5 rating/band/prescription number and day-by-day rolling 6-attempt cooldown checks across all 90-day runs. |

---

## 1. Taxonomy, 53-Slug Total-Order Resolver & 24-Concept Catalogue

### 1.1 Track A — 13 Rated Domains & Catalog Query Contract

Schema changes required at build time:
1. Preserve `topicTags: { name, slug }[]` and `acRate: number` (`0..100`) in [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs), [`lib/validation.ts`](../lib/validation.ts), and [`lib/prescription.ts`](../lib/prescription.ts).
2. `LeetCodeClient.list` accepts optional `tag` (a **single** verified slug—never `AND`-combined) and `orderBy: "AC_RATE_DESC" | "AC_RATE_ASC"` (`DESC` when target midpoint $< 1120$, `ASC` when $\ge 1260$, plus a middle `skip` offset when $\in [1120, 1260]$) so returned candidates cluster near the target difficulty instead of the 30 oldest IDs.
3. `search_problems` immediately filters out candidates with `isPaidOnly` (unless `isPremium`), `skippedSlugs`, and any excluded slug in `{"database", "shell", "concurrency", "interactive", "design", "data-stream"}`, and verifies `q.topicTags.some(t => t.slug === tag)` client-side.

| Canonical Order | Domain ID | Display Name | Catalog Difficulty Floor | Min $\mu_0$ Gate | Primary Query Slugs (one at a time) |
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

### 1.2 Explicit `1..53` Tag Priority Resolver (Pre-Attempt Classification)

Every mapped LeetCode slug has a unique priority rank (`1` = highest priority):

1–5. `trie` (#1 → `trees-recursion`), `union-find` (#2), `topological-sort` (#3), `shortest-path` (#4), `minimum-spanning-tree` (#5 → `graphs-search`)
6–7. `monotonic-stack` (#6), `monotonic-queue` (#7 → `stacks-queues-linked`)
8–9. `heap-priority-queue` (#8), `ordered-set` (#9 → `heaps-ordered`)
10–11. `linked-list` (#10), `doubly-linked-list` (#11 → `stacks-queues-linked`)
12–14. `binary-search-tree` (#12), `binary-tree` (#13), `tree` (#14 → `trees-recursion`)
15. `backtracking` (#15 → `backtracking`)
16. `sliding-window` (#16 → `two-pointers-window`)
17. `binary-search` (#17 → `binary-search`)
18–20. `graph` (#18), `breadth-first-search` (#19), `depth-first-search` (#20 → `graphs-search`)
21–22. `dynamic-programming` (#21), `memoization` (#22 → `dynamic-programming`)
23. `greedy` (#23 → `greedy`)
24. `two-pointers` (#24 → `two-pointers-window`)
25–26. `stack` (#25), `queue` (#26 → `stacks-queues-linked`)
27. `prefix-sum` (#27 → `hashing-prefix`)
28–33. `quickselect` (#28), `merge-sort` (#29), `bucket-sort` (#30), `counting-sort` (#31), `radix-sort` (#32), `sorting` (#33 → `sorting-intervals`)
34–36. `hash-table` (#34), `hash-function` (#35), `counting` (#36 → `hashing-prefix`)
37–45. `bitmask` (#37), `bit-manipulation` (#38), `number-theory` (#39), `combinatorics` (#40), `geometry` (#41), `game-theory` (#42), `randomized` (#43), `brainteaser` (#44), **`math` (#45)** → `math-bitwise`
46. `divide-and-conquer` (#46 → `trees-recursion`)
47. `recursion` (#47 → `trees-recursion` fallback when no rank `1..46` tag matches)
48–53. `matrix` (#48), `simulation` (#49), `enumeration` (#50), `iterator` (#51), `string` (#52), `array` (#53) → `arrays-strings`

All primary query slugs (including `["math"]` and `["math", "array"]`) resolve cleanly to their assigned domain.

### 1.3 Track B — Canonical 24-Concept Catalogue

Concepts store states and calendar-day stability—**never `1000` ratings**:
```ts
type ConceptRecord = {
  slug: string;
  domain: DomainId;
  state: "probed" | "coached" | "applied";
  stabilityDays: number;        // 0 while state === "probed"; >0 once coached/applied
  lastEvaluatedAt: number;      // updated on probed, coached, applied, AND lapse (governs Δt)
  lastSuccessAt: number | null; // updated ONLY on coached or applied (null while probed)
  probeCount: number;           // capped at 2 uncoached probes (14-day probe cooldown)
  reps: number;
  lapses: number;
};
```

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
| 19 | `topological-sort` | `graphs-search` | `topological-sort` | `1020` |
| 20 | `union-find` | `graphs-search` | `union-find` | `1000` |
| 21 | `weighted-shortest-path` | `graphs-search` | `graph` | `1100` |
| 22 | `state-space-backtracking` | `backtracking` | `backtracking` | `980` |
| 23 | `dp-1d-2d` | `dynamic-programming` | `dynamic-programming` | `960` |
| 24 | `greedy-bitwise` | `greedy` | `greedy` | `900` |

---

## 2. Closed-Form Difficulty, Rating & Stability Equations

### 2.1 State Parameters
- **Global Base:** $\mu_0$ (init `1000`), $\sigma_0 \in [20, 220]$ (init `220`).
- **Domain Facets ($d \in \{1..13\}, f \in \{\text{impl}, \text{sel}\}$):** $\delta_{d,f}$ (init `0`), $\sigma_{d,\text{impl}} \in [45, 150]$ (init `110`), $\sigma_{d,\text{sel}} \in [55, 150]$ (init `110`), `freshSigma` (init `110`), `lastUpdatedAt`, `implAttempts`.
- **Steady-State Global Bleed Guard:** At the $\sigma$ floors ($\sigma_0 = 20, \sigma_{d,\text{impl}} = 45$), the global variance share is $\frac{20^2}{20^2 + 45^2} = \mathbf{16.5\%}$ (`83.5%` domain-local).

### 2.2 Overlapping Difficulty Mapping ($D$), Empty-Band Snap & Expected Score ($E$)

1. **Overlapping Base Difficulty ($a = \text{acRatePct} / 100 \in [0, 1]$, structural modifier $\Delta D \in [-50, +50]$):**
   - **Easy:** $D_{\text{base}} = 800 + 280 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.85 - a}{0.55}\right) \in [800,\; 1080]$
   - **Medium:** $D_{\text{base}} = 980 + 420 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.80 - a}{0.55}\right) \in [980,\; 1400]$
   - **Hard:** $D_{\text{base}} = 1340 + 460 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.70 - a}{0.50}\right) \in [1340,\; 1800]$
   - Final $D = \text{clamp}_{[800, 1850]}(\text{round}(D_{\text{base}} + \Delta D))$.
2. **Empty-Band Snap Rule (`snapCandidatePool`):** `[L, U]` → `[L - 60, U + 60]` → nearest 3 candidates by $|D_{\text{base}} - \text{mid}|$ (or next eligible domain if 0 candidates). Grading always uses chosen $D$.
3. **Expected Score ($L = 320, q = \frac{\ln 10}{320}, \sigma_p = 55, g(\sigma_p) \approx 0.9770$):**
   $$E(\theta, D) = \frac{1}{1 + 10^{-g(\sigma_p)(\theta - D)/320}}$$
   - **Momentum (`[θ - 105, θ - 55]`):** $E \in [0.60,\; 0.68]$ · **Growth & Breadth (`[θ - 45, θ + 10]`):** $E \in [0.48,\; 0.58]$ · **Concept Probe (`[θ - 55, θ - 15]`):** $E \in [0.53,\; 0.60]$ · **Consolidation (`[θ - 40, θ + 5]`):** $E \in [0.49,\; 0.57]$ · **Stretch (`[θ + 10, θ + 65]`):** $E \in [0.39,\; 0.48]$.

### 2.3 Mutually Exclusive Rubric ($S \in [0, 1]$) & Single-Base Update Step

Evaluated **top-to-bottom (first match wins)** per exercised domain ($\sum_d w_{d,\text{impl}} = 1$; $w_{d,\text{sel}} = 0$ on signature-forced inputs or if `selectionSpoilerRevealed === true`; Java API `Java help` carries no penalty):

| Precedence | Mutually Exclusive Attempt Outcome | $S_{d,\text{impl}}$ | $S_{d,\text{sel}}$ |
| :---: | :--- | :---: | :---: |
| 1 | Recorded outside solution help during active solving | `0.35` *(accepted)* / `0.15` | `0.30` *(accepted)* / `0.15` |
| 2 | Accepted in timebox, optimal complexity class, $\le 2$ wrong-answer submits | `1.00` | `1.00` *(if non-obvious)* |
| 3 | Accepted in timebox, optimal complexity class, $\ge 3$ wrong-answer submits or minor constant/pass overhead | `0.80` | `0.90` |
| 4 | Accepted in timebox via suboptimal complexity class | `0.65` *(used)* | `0.50` *(used)*; `0.20` *(missed iff §3.2 holds)* |
| 5 | Unaccepted at deadline, sound core invariant with isolated boundary/syntax bug | `0.40` | `0.75` |
| 6 | Unaccepted at deadline, partial/incomplete mechanics | `0.15` | `0.35` |
| 7 | No viable approach or fundamental invariant contradiction | `0.00` | `0.00` |

**Familiarity Multiplier ($m_{\text{fam}}$, applied when $S > E$, else `1.0`):** `new = 1.0`, `revisit = 0.65`, `solved = 0.25`.

**Simultaneous Order-Independent Update (`applyAttemptGraded`):**
1. **Idle $\sigma$-Drift ($c_{\text{drift}} = 7.0\;\text{pts}/\sqrt{\text{day}}$, 21-day grace window):** $\sigma'(\Delta t) = \min(\sigma_{\max}, \sqrt{\sigma^2 + 49 \cdot \max(0, \Delta t - 21)})$, then snapshot pre-attempt state.
2. **Single Global Base Update (from `implementation` updates only):**
   Normalize $\hat{w}_d$, $\tilde{w}_d = \hat{w}_d m_{\text{fam},d}$, $E_d = E(\mu_0^{\text{pre}} + \delta_{d,\text{impl}}^{\text{pre}}, D)$, $R_{\text{tot}} = \sum_d \tilde{w}_d(S_{d,\text{impl}} - E_d)$, $I_{\text{tot}} = \sum_d \tilde{w}_d q^2 g(\sigma_p)^2 E_d(1 - E_d)$, $\bar{\sigma}_{\text{dom}}^2 = \sum_d \hat{w}_d (\sigma_{d,\text{impl}}^{\text{pre}})^2$, $V_0 = (\sigma_0^{\text{pre}})^2 + \bar{\sigma}_{\text{dom}}^2$, $\alpha_0 = \frac{(\sigma_0^{\text{pre}})^2}{V_0}$:
   $$\mu_0 \leftarrow \mu_0^{\text{pre}} + \alpha_0 \frac{q g(\sigma_p) R_{\text{tot}}}{V_0^{-1} + I_{\text{tot}}}, \qquad \sigma_0 \leftarrow \max\!\left(20,\; \left((\sigma_0^{\text{pre}})^{-2} + \alpha_0 I_{\text{tot}}\right)^{-1/2}\right)$$
3. **Independent Facet Offset Updates (from pre-attempt snapshot, order-independent):** Same variance-share step for $\delta_{d,f}$ with $\alpha_d = \frac{(\sigma_{d,f}^{\text{pre}})^2}{V}$ and $\sigma_{d,f,\text{fresh}} \leftarrow \sigma_{d,f}$.

### 2.4 Break / Rust Display & Concept Stability Ladder

1. **Rusty Badge & Display Rating:** Practiced domain shows **Rusty** at $\Delta t \ge 45$ idle calendar days; display deducts $0.85 \cdot \max(0, \sigma'(\Delta t) - \sigma_{d,f,\text{fresh}})$ (`26` pts after 120 idle days from $\sigma_{\text{fresh}} = 65$; $E$ always uses latent $\theta_{d,f}$).
2. **Track B Concept Stability (`lastEvaluatedAt` governs $\Delta t$):**
   $$R_c(\Delta t, S_c) = \left(1 + \frac{\Delta t}{9 \cdot S_c}\right)^{-1}$$
   - `probed-uncoached`: `state = "probed"`, $S_c = 0$, `probeCount += 1`, `lastEvaluatedAt = now`.
   - First `coached`: `state = "coached"`, $S_c = 4\text{d}$, `lastEvaluatedAt = lastSuccessAt = now`.
   - First `applied`: `state = "applied"`, $S_c = 14\text{d}$ if previously `coached` with $\Delta t \ge 2\text{d}$ else $12\text{d}$, `reps = 1`, `lastEvaluatedAt = lastSuccessAt = now`.
   - Subsequent `applied`: $S_c' = \min(730, S_c \cdot (1 + 2.2 \cdot (1 - R_c + 0.15) \cdot \min(1.5, \Delta t / S_c)))$:
     - Same-day cram ($\Delta t = 0.1\text{d}$ from `14d`): **`14.00 → 14.03 days`**.
     - Exact continuous due threshold $R_c = 0.88$: **`4 → 14 → 24 → 42 → 72 → 125 days`**.
     - Whole calendar days $R_c \le 0.88$: **`4 → 14 → 25 → 43 → 76 → 131 days`**.
   - `lapsed`: **$S_c' = \min(S_c,\; 10,\; \max(2,\; 0.25 \cdot S_c))$**, `lapses += 1`, `lastEvaluatedAt = now` (`lastSuccessAt` unchanged). Stability strictly never rises on a lapse: **coached `4d → 2d`** (next due in `3` days), **`14d → 3.5d`**, **`120d → 10d`**.

---

## 3. Check-In Gate, Durable Settlement, Alternative-Route Guard & Big-O Stats

### 3.1 Next-Problem Check-In Gate (`isCheckInSettled`) & Durable Settlement
- **Unified Settled Contract (`isCheckInSettled(a)`):** Used identically by UI, `recommend()`, and `POST /api/state`: returns `true` iff `a.demonstration`, `!a.sealed`, `a.phase ∈ {"active", "paused", "complete"}`, `a.reflection?.intake`, `a.reflection?.checkInSkippedAt !== undefined`, or `(a.reflection?.messages?.length ?? 0) > 0`.
  - Consequently, existing/restored legacy attempts with prior reflection messages (even without `intake`) or `phase === "complete"` are **already settled** and never trap a learner behind a check-in they cannot submit.
- **Hard Gate Across All New Starts:** Any sealed non-demonstration attempt in `review`/`learn` with `!isCheckInSettled(a)` blocks starting a new assessment in **both** `recommend()` (shows **“Finish your check-in”**) and `POST /api/state` (blocks self-picked catalog starts). Deferred coaching (`coachingDeferred: true` after check-in) unblocks both.
- **Check-In & Familiarity-Tap Skip:** Completing the 3 fields offers **Continue to coaching**, **Come back to coaching later**, and **Submit & skip coaching**. Alternatively, **Skip check-in** requires only **1 tap on Familiarity** (`New to me · Seen before · Solved before`, no default preselected), sets time and space Big-O to `"unsure"`, marks `checkInSkippedAt = now`, and settles.
- **Durable Settlement & Exactly-Once Grading (`rating_jobs` + `skill_rating_events`):**
  - Saving either the 3-field check-in or **Skip check-in** commits synchronously in SQLite (`attempt` + `rating_jobs(attemptId PRIMARY KEY, status = 'pending')`), **immediately settling the check-in and unlocking the next problem** regardless of network/LLM latency.
  - Background `attempt-attribution` writes an immutable `attempt-graded` row to `skill_rating_events` enforced by **`UNIQUE(attemptId, kind)`** and marks `rating_jobs.status = 'complete'`. If the LLM call fails or times out, the learner still proceeds; a background retry (or clicking `"Retry rating update"`) grades the attempt **exactly once**. Pending/failed jobs still apply deterministic tag cooldowns in `recentDomains` until attribution lands.
  - Later `setExposure` updates or Coach Memory exclusions/corrections append a deterministic `compensating-recompute` event with zero extra LLM calls.

### 3.2 Alternative-Route Guard (`evaluateMissedTargetSelection`)
An unused domain $d$ / concept $c$ receives $S_{d,\text{sel}} = 0.20$ and a concept `lapse` **iff both**: (1) the learner's solution had strictly worse asymptotic complexity than optimal (or timed out where $c$ passes), **AND** (2) $c$ already has `state ∈ {"coached", "applied"}`. Valid optimal alternatives incur `0` Selection penalty and `0` lapse.

### 3.3 Separate Time & Space Big-O Calibration & Non-Punitive Rescue (`ΔS ≥ 0`)
- Runtime and space check-in answers are stored independently in `complexityCalibration.time` and `complexityCalibration.space` (`{ accurate, inaccurate, unsure }`) and rendered as **`"${accurate} of ${accurate + inaccurate} accurate, ${unsure} unsure"`** (never coupled into domain ratings).
- Conversational reflection never lowers `attempt-graded` scores; it may only append `reflection-rescue` ($\Delta S \in [0, +0.25]$ on **unaccepted** Tier 5/6 near-misses) and `coached` Track B concepts.

---

## 4. Onboarding, Prescription Provenance, Spoiler Guard & Pacing Director

### 4.1 Launch Provenance & Pre-Start Spoiler Guard
- **Prescription Provenance (`P2 #4`):** [`components/problem-prescription.tsx`](../components/problem-prescription.tsx) passes `prescriptionId` through `Workspace.start` ([`components/workspace.tsx:753`](../components/workspace.tsx)) into `POST /api/state`. When `prescriptionId` matches an active saved prescription (`slug` match, `!demonstration`), the server persists `attempt.prescription = { id, intent, selectionSpoilerRevealed }` on the created `Attempt`. `prescribedCount` increments **iff** `attempt.prescription?.intent` exists; self-picked library launches omit `attempt.prescription`.
- **Pre-Start Spoiler Guard (`P2 #6`):** When `prescription.intent.targetFacet === "selection"`, [`components/problem-prescription.tsx:205-241`](../components/problem-prescription.tsx) suppresses `p.evidence` (`skill`, `observation`, `support`) under `"Why this problem?"` pre-start, showing spoiler-free metadata plus an opt-in *"Reveal evidence anyway (disables Pattern Selection scoring)"* button. Clicking it (or opening `Inspect problem selection` pre-start) marks `selectionSpoilerRevealed: true`, setting $w_{d,\text{sel}} = 0$ on that attempt. Full evidence renders automatically once the attempt seals.

### 4.2 Onboarding & Deterministic Pacing Director (`selectDirectorIntent`)
- **Stage 1 (4 curated Easies, `10–15m`):** Covers `hashing-prefix`, `two-pointers-window`, `stacks-queues-linked`, `binary-search`.
- **Beginner / Low-$\mu_0$ Fallback:** `DOMAIN_MIN_GLOBAL_MU` restricts only `backtracking` ($\mu_0 \ge 980$); all 12 Easy domains stay eligible even when $\mu_0 = 738.14$. If cooldown filtering ever yields 0 candidates, the Director relaxes the 6-attempt cap first, then `prevDomain`, clamping target bands to `[CATALOG_DIFFICULTY_FLOOR[d], 1850]`.
- **5-Slot Schedule (`slotIndex = prescribedCount mod 5`):** `Growth` (Slot 0/2) · `Concept Probe → Breadth` (Slot 1, `MAX_FRAGILE_CONCEPTS = 3`) · `Consolidation` overflow (Slot 2 if $\ge 2$ due concepts) · `Consolidation → Rusty → Breadth → Growth` (Slot 3) · `Momentum` (Slot 4).

---

## 5. Machine-Asserted Replay & Simulation Results ([`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts))

Every single value below is strictly asserted on every `npm test` run:

1. **Weak Onboarding Transition (`P1 #1`):** Scoring `0.0` on all 4 Stage-1 `D = 920` problems drops global base to **`738.14`**, and 3 consecutive Stage-2 `selectDirectorIntent` calls succeed without error, skipping `backtracking`, clamping `band[0] = 800`, and rotating distinct domains.
2. **Strong Onboarding:** Four clean `D = 920` Stage-1 Easies move global base from `1000 ± 220` to **`1167 ± 146`**.
3. **Replay of 11 Assessed Sessions (22–26 Oct + 19 Nov, `prescribedCount = 0`):**
   - **Global Base:** **`1088 ± 112`** (`graphs-search: 1130 ± 107`, `binary-search: 1125 ± 106`, `two-pointers-window: 1100 ± 108`, `hashing-prefix: 1099 ± 107`, `sorting-intervals: 1097 ± 107`, `heaps-ordered: 1069 ± 109`, `stacks-queues-linked: 1068 ± 108` — provisional within $\sigma \approx 107$).
   - **Next 5 Director Prescriptions (Days 34–38, `0` consecutive or `>2/6` repeats):**
     1. `Slot 0 [growth]`: `stacks-queues-linked` (`selection`) @ `1043–1098`
     2. `Slot 1 [breadth]`: `arrays-strings` (`implementation`) @ `1043–1098`
     3. `Slot 2 [consolidation]`: `hashing-prefix` (`implementation`, `prefix-sum-map`) @ `1059–1104`
     4. `Slot 3 [consolidation]`: `sorting-intervals` (`implementation`, `custom-comparator-intervals`) @ `1057–1102`
     5. `Slot 4 [momentum]`: `graphs-search` (`implementation`) @ `1025–1075`
4. **90-Day Synthetic Convergence (`0` cooldown violations asserted on all 270 days):**
   - **Beginner (true `900`):** **`889 ± 50`** (`graphs: 947`, `dp: 875`, `28` Selection prescriptions).
   - **Intermediate (true `1150`):** **`1119 ± 50`** (`graphs: 1150`, `dp: 1082`, `38` Selection prescriptions).
   - **Strong (true `1350`):** **`1326 ± 50`** (`graphs: 1320`, `dp: 1359`, `28` Selection prescriptions).
