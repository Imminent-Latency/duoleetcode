# Design Specification (v4): Hierarchical Skill Ratings, Concept Stability & Pacing Director

> [!NOTE]
> **Design specification (v4 — post-adversarial review, numerically simulated)** — resolves all mathematical, catalog, schema, and incentive issues identified in the v3 adversarial review, and includes replay verification against existing historical/native sessions plus 90-day synthetic convergence simulations.

---

## Summary of Changes from v3 Adversarial Review

| Review Finding | Resolution in v4 |
| :--- | :--- |
| **1 & 6. Missing update rule, Elo/Glicko mixing, `μ + 85` = 38% pass rate, & 24-bucket sample starvation** | Replaced independent buckets with a **Hierarchical Glicko-1 model**: Global Base $(\mu_0, \sigma_0)$ updated on *every* attempt + 13 Domain Offsets $(\delta_{d,f}, \sigma_{d,f})$ split by variance share. Defined closed-form $E(\theta, D)$, graded outcome $S \in [0, 1]$, and recalibrated ZPD bands (`[θ - 45, θ + 10]` ≈ 50–58% expected score). |
| **2. Decay paradoxes (`μ < anchor` rising, snap-back on failure, break-cycle inflation, 2 ladders, concept ratings)** | **Ratings $(\mu_0, \delta)$ never change passively over time**; expected score $E$ always uses true $\theta = \mu_0 + \delta$. Idle time beyond a 21-day rotation grace window widens $\sigma$ only. Read-only display deducts $0.55 \cdot \max(0, \sigma(\Delta t) - \sigma_{\text{fresh}}) \ge 0$ (never rises when $\theta < 1000$, drops $\theta$ on post-break failure, zero break-farming). **Memory stability $S_c$ lives exclusively on Named Concepts** (concepts have no `1000` ratings) under one canonical update equation. |
| **3 & Smaller. Familiarity unavailable on skip; punitive reflection docks rating** | Every sealed attempt completes the 3-field post-attempt check-in (**Familiarity**, **Runtime complexity**, **Space complexity**) before choosing **Continue to coaching**, **Come back to coaching later**, or **Submit & skip coaching**. Thus familiarity and complexity understanding are *always* scored at baseline, and **conversational reflection is strictly non-punitive ($\Delta S \ge 0$)**—pure upside rescue/teaching with zero incentive to skip chat. |
| **4 & Domain 12. No primary-domain resolver; `Recursion` ≠ `Backtracking`; missed-structure ambiguity; `Greedy` lumped with `Math`** | Split **Domain 12: Greedy** from **Domain 13: Math & Bitwise** (13 domains total). `Recursion` routes via structural co-tags rather than Domain 10; `Backtracking` gets a `Medium` / $\mu_0 \ge 1025$ entry floor (only 3 free Easies exist). Added deterministic specificity-ranked tag resolver + persisted `PrescriptionIntent` on `Prescription` so missed-structure `Selection` updates only fire against an explicit target or clear asymptotic gap. |
| **5. Catalog `filters.tags` is `AND`, fake slugs return all 3,706 items, `slug` stripped, `systemdesign` rejected** | Preserve `topicTags: { name, slug }[]` in `lib/validation.ts` and `lib/prescription.ts`. Query **one** verified LeetCode `slug` per `search_problems` call and post-filter `questions` client-side by `topicTags.slug` so unknown/ignored slugs return `0` results instead of 3,706. Clamp `acRate` strictly inside each difficulty band; exclude `metadata.systemdesign` concepts (e.g. multi-method `LRUCache`) until supported by the runner. |
| **Smaller. Mixed units, missing slot fallbacks, LLM replay determinism, memory exclusions, `evidenceIds` guard** | Concept due-ness uses **calendar days**; domain cooldowns use **completed attempts**. Defined full slot fallback chain (no `1150+` requirement), `MAX_FRAGILE_CONCEPTS = 3` admission cap, LLM attribution stored inside immutable events for deterministic replay, compensating events on Coach Memory exclusions, and `evidenceIds: []` permitted on `onboarding` / `breadth` / `concept-probe` slots. |

---

## 1. Taxonomy, Verified LeetCode Tag Slugs & Primary-Domain Resolver

### 1.1 Track A — 13 Rated Domains (Hierarchical `1000` Scale)

Schema change required before implementation: retain `slug` alongside `name` on `topicTags` in [`lib/validation.ts`](../lib/validation.ts) (`problemSchema`) and [`lib/prescription.ts`](../lib/prescription.ts) (`candidateSchema`). Every slug listed below is a verified LeetCode `topicTags.slug` (note: `"Graph Theory"` is `graph`; `"Heap (Priority Queue)"` is `heap-priority-queue`):

| ID | Rated Domain | Verified Primary Query Slugs (queried **one at a time**, never `AND`-combined) | Secondary Mapped Slugs | Entry Floor |
| :--- | :--- | :--- | :--- | :--- |
| `arrays-strings` | **1. Arrays, Strings & Simulation** | `array`, `string`, `matrix`, `simulation` | `enumeration`, `iterator` | `800` (Easy) |
| `hashing-prefix` | **2. Hashing & Prefix State** | `hash-table`, `prefix-sum`, `counting` | `hash-function` | `800` (Easy) |
| `two-pointers-window` | **3. Two Pointers & Sliding Window** | `two-pointers`, `sliding-window` | — | `800` (Easy) |
| `sorting-intervals` | **4. Sorting & Intervals** | `sorting` | `merge-sort`, `quickselect`, `bucket-sort`, `counting-sort`, `radix-sort` | `800` (Easy) |
| `stacks-queues-linked` | **5. Stacks, Queues & Linked Lists** | `stack`, `queue`, `monotonic-stack`, `linked-list` | `monotonic-queue`, `doubly-linked-list` | `800` (Easy) |
| `binary-search` | **6. Binary Search** | `binary-search` | — | `800` (Easy) |
| `heaps-ordered` | **7. Heaps & Ordered Collections** | `heap-priority-queue`, `ordered-set` | — | `900` (Easy+) |
| `trees-recursion` | **8. Trees & Divide-and-Conquer** | `tree`, `binary-tree`, `binary-search-tree`, `trie` | `divide-and-conquer` | `850` (Easy) |
| `graphs-search` | **9. Graphs & Grid Search** | `depth-first-search`, `breadth-first-search`, `graph`, `topological-sort`, `union-find` | `shortest-path`, `minimum-spanning-tree` | `950` (Easy+/Med) |
| `backtracking` | **10. Backtracking** | `backtracking` | — | **`1075` (Medium, $\mu_0 \ge 1025$)** |
| `dynamic-programming` | **11. Dynamic Programming** | `dynamic-programming` | `memoization` | `975` (Easy+/Med) |
| `greedy` | **12. Greedy** | `greedy` | — | `900` (Easy+) |
| `math-bitwise` | **13. Math & Bit Manipulation** | `math`, `bit-manipulation`, `number-theory` | `bitmask`, `combinatorics`, `geometry`, `game-theory`, `brainteaser`, `randomized` | `850` (Easy) |

**Special Tag Handling Rules:**
1. **`recursion` (`51` problems, `0` overlap with `backtracking`):** Never mapped blindly to `backtracking`. Resolved via co-tags (`linked-list` → `stacks-queues-linked`, `tree`/`binary-tree` → `trees-recursion`, `math` → `math-bitwise`, fallback → `trees-recursion`).
2. **Excluded / Runner-Unsupported Tags:** `database`, `shell`, `concurrency`, `interactive`, and any problem where `metadata.systemdesign === true` (rejected at [`lib/prescription.ts:418`](../lib/prescription.ts)) are excluded from prescription and concept probing. Consequently, multi-method class-design concepts like `LRUCache` (`design` / `data-stream`) are omitted from Track B until multi-method class execution is supported.
3. **Catalog Search Defense-in-Depth:** Because LeetCode's `problemsetQuestionList` `filters.tags` uses `AND` semantics and silently ignores unknown slugs (returning all ~3,700 problems), `search_problems` accepts at most **one** `tag: string` slug per call from the verified allowlist above **and** post-filters returned candidates by `q.topicTags.some(t => t.slug === tag)`.

### 1.2 Deterministic Problem → Primary Domain Resolver (Pre-Attempt)

When classifying a catalog problem from tags alone (before code exists), rank its mapped tags by **Specificity Tier** (highest tier wins; ties broken by rarest catalog count):
- **Tier 1 (Algorithmic Paradigm):** `dynamic-programming`, `backtracking`, `topological-sort`, `union-find`, `shortest-path`, `minimum-spanning-tree`, `trie`, `monotonic-stack`, `monotonic-queue`, `sliding-window`, `binary-search`, `heap-priority-queue`, `ordered-set`, `greedy`, `two-pointers`, `prefix-sum`, `divide-and-conquer`.
- **Tier 2 (Core Structure / Operation):** `graph`, `depth-first-search`, `breadth-first-search`, `binary-search-tree`, `binary-tree`, `tree`, `linked-list`, `stack`, `queue`, `sorting`, `hash-table`, `counting`, `bit-manipulation`, `number-theory`.
- **Tier 3 (Generic Input Container — fallback only when no Tier 1/2 tag is present):** `math`, `simulation`, `matrix`, `string`, `array`.

### 1.3 Track B — Named Concept Ledger (States + Stability Only, No Ratings)

Concepts **do not** carry `1000`-scale ratings. Each concept entry stores:
```ts
type ConceptRecord = {
  slug: string;              // e.g. "union-find", "monotonic-stack", "variable-sliding-window"
  domain: DomainId;          // parent domain in Track A
  state: "coached" | "applied";
  stabilityDays: number;     // S_c > 0 (calendar days)
  lastSuccessAt: number;     // wall-clock ms of last demonstrated/coached event
  reps: number;
  lapses: number;
};
```
Unseen concepts have no row until encountered in an attempt or coaching session.

---

## 2. Closed-Form Hierarchical Rating & Concept Stability Math

### 2.1 State Representation

To avoid sample starvation across 26 domain facets at ~1 problem/day, ratings decompose into a **Global Java DSA Base** plus **13 Paired Domain Offsets**:
- **Global Base:** $\mu_0 \in \mathbb{R}$ (init `1000`), $\sigma_0 \in [45, 220]$ (init `220`).
- **Domain Offsets ($d \in \{1..13\}$, facet $f \in \{\text{impl}, \text{sel}\}$):** $\delta_{d,f} \in \mathbb{R}$ (init `0`), $\sigma_{d,\text{impl}} \in [40, 110]$ (init `110`), $\sigma_{d,\text{sel}} \in [50, 110]$ (init `110`), plus `freshSigma` (the $\sigma_{d,f}$ recorded right after the domain's most recent update) and `lastUpdatedAt`.
- **Latent Skill:** $\theta_{d,f} = \mu_0 + \delta_{d,f}$, with combined prior variance $V_{d,f} = \sigma_0^2 + \sigma_{d,f}^2$.

### 2.2 Problem Difficulty Anchor ($D$) & Expected Score ($E$)

1. **Problem Difficulty ($D \in [800, 1850]$):**
   - Base band from LeetCode `difficulty` + clamped `acRate` ($a \in [0.15, 0.90]$):
     - **Easy:** $D_{\text{base}} = 820 + 210 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.85 - a}{0.55}\right) \in [820, 1030]$
     - **Medium:** $D_{\text{base}} = 1060 + 340 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.75 - a}{0.50}\right) \in [1060, 1400]$
     - **Hard:** $D_{\text{base}} = 1420 + 380 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.65 - a}{0.45}\right) \in [1420, 1800]$
   - Post-seal attribution may apply a bounded structural modifier $\Delta D \in [-50, +50]$, clamped to `[800, 1850]`. Problem difficulty uncertainty is fixed at $\sigma_p = 55$.
2. **Expected Score Function:**
   With logistic scale $L = 320$, $q = \frac{\ln 10}{320} \approx 0.007196$, and $g(\sigma_p) = \left(1 + \frac{3 q^2 \sigma_p^2}{\pi^2}\right)^{-1/2} \approx 0.977$:
   $$E(\theta, D) = \frac{1}{1 + 10^{-g(\sigma_p)(\theta - D)/320}}$$
   **Resulting Target Difficulty Bands:**
   - **Momentum / Fluency (`E ≈ 0.65`):** $D \in [\theta - 105,\; \theta - 55]$
   - **Growth / ZPD (`E ≈ 0.50–0.58`):** $D \in [\theta - 45,\; \theta + 10]$
   - **Stretch Probe (`E ≈ 0.40–0.47`):** $D \in [\theta + 10,\; \theta + 65]$

### 2.3 Outcome Variable ($S \in [0, 1]$) & Variance-Split Update Rule

Each exercised `(domain d, facet f)` receives weight $w_{d,f} \in (0, 1]$ ($\sum_d w_{d,\text{impl}} = 1$; `Selection` weights $w_{d,\text{sel}} \in [0, 1]$ are `0` on signature-forced problems such as `ListNode`/`TreeNode` inputs unless a non-obvious sub-pattern was required) and deterministic rubric score $S_{d,f}$:

| Observed Evidence Tier (Code + Judge + 3-Field Complexity Check-In) | $S_{d,\text{impl}}$ | $S_{d,\text{sel}}$ |
| :--- | :---: | :---: |
| Accepted in timebox, optimal complexity class, accurate stated time/space Big-O, $\le 2$ wrong submits, no solution help | `1.00` | `1.00` *(if non-obvious)* |
| Accepted in timebox, optimal code with inaccurate/uncertain stated time/space Big-O, minor overhead, or $\ge 3$ wrong submits | `0.78` | `0.80` |
| Accepted via suboptimal complexity class (e.g. $O(n^2)$ brute force where $O(n)$ structure applies) | `0.65` *(on structure used)* | `0.20` *(on missed target domain, if eligible per §3.2)* |
| Unaccepted at deadline, structurally sound core invariant with isolated boundary/syntax bug | `0.40` | `0.75` *(spotted right structure)* |
| Unaccepted at deadline, partial/incomplete mechanics | `0.15` | `0.35` |
| No viable approach or fundamental invariant contradiction | `0.00` | `0.00` |

**Familiarity Multiplier ($m_{\text{fam}}$):**
- `new`: `1.0`
- `revisit` (*Seen before*): `0.65` when $S > E$, `1.0` when $S \le E$
- `solved` (*Solved before*): `0.25` when $S > E$, `1.0` when $S \le E$

**Closed-Form Update Step:**
1. **Idle Uncertainty Drift (21-day active rotation grace period):**
   For $\Delta t$ calendar days since last update ($c_{\text{drift}} = 4.5\;\text{pts}/\sqrt{\text{day}}$):
   $$\sigma'(\Delta t) = \min\!\left(\sigma_{\max},\; \sqrt{\sigma^2 + c_{\text{drift}}^2 \cdot \max(0,\; \Delta t - 21)}\right)$$
   *Latent means $\mu_0$ and $\delta_{d,f}$ never drift passively.*
2. **Posterior Mean & Variance Partition:**
   With effective weight $\tilde{w} = w_{d,f} \cdot m_{\text{fam}}$, prior variance $V = \sigma_0^2 + \sigma_{d,f}^2$, and Fisher information $I = \tilde{w} q^2 g(\sigma_p)^2 E(1 - E)$:
   $$\Delta_{\text{total}} = \frac{q \, g(\sigma_p) \, \tilde{w} \, (S_{d,f} - E)}{V^{-1} + I}$$
   Split by variance share $\alpha_0 = \frac{\sigma_0^2}{V}$ and $\alpha_d = \frac{\sigma_{d,f}^2}{V}$:
   $$\mu_0 \leftarrow \mu_0 + \alpha_0 \Delta_{\text{total}}, \qquad \sigma_0 \leftarrow \max\!\left(45,\; \left(\sigma_0^{-2} + \alpha_0 I\right)^{-1/2}\right)$$
   $$\delta_{d,f} \leftarrow \delta_{d,f} + \alpha_d \Delta_{\text{total}}, \qquad \sigma_{d,f} \leftarrow \max\!\left(\sigma_{\min},\; \left(\sigma_{d,f}^{-2} + \alpha_d I\right)^{-1/2}\right), \qquad \sigma_{d,f,\text{fresh}} \leftarrow \sigma_{d,f}$$

### 2.4 Paradox-Free Break / Rust Display & Concept Stability Equation

1. **Read-Only Conservative Display Rating (Zero Decay Paradoxes):**
   At render time on day $t$, let $\sigma_{\text{curr}} = \sigma'(\Delta t)$:
   $$\theta_{\text{display}} = \theta_{d,f} - 0.55 \cdot \max\!\left(0,\; \sigma_{\text{curr}} - \sigma_{d,f,\text{fresh}}\right)$$
   A domain displays a **Rusty** badge when $\sigma_{\text{curr}} - \sigma_{d,f,\text{fresh}} \ge 12$ (~50+ idle days).
   - **Below-1000 safety:** Because $0.55 \cdot \max(0, \Delta\sigma) \ge 0$ is subtracted from $\theta_{d,f}$, an `870` skill drifts down to `858` (never upward toward `1000`).
   - **No snap-back on failure:** Failing a post-break refresher ($S = 0.15 < E$) lowers $\theta_{d,f}$ via the widened $\sigma_{\text{curr}}$.
   - **No break-cycle inflation:** Expected score $E$ always uses latent $\theta_{d,f}$, never $\theta_{\text{display}}$.
2. **Canonical Concept Stability Update (Track B Only, Calendar Days):**
   Retrievability after $\Delta t$ calendar days since `lastSuccessAt`:
   $$R_c(\Delta t, S_c) = \left(1 + \frac{\Delta t}{9 \cdot S_c}\right)^{-1}$$
   - **First exposure via coaching (`state = "coached"`, `reps = 0`):** $S_c = 4\text{ days}$, `lastSuccessAt = now`.
   - **First independent application (`state = "applied"`, `reps = 1`):** $S_c = 14\text{ days}$ if previously coached with $\Delta t \ge 2\text{d}$, else $12\text{ days}$; `lastSuccessAt = now`.
   - **Subsequent independent applications (`reps ≥ 2`):**
     $$S_c' = \min\!\left(730,\; S_c \cdot \left(1 + 2.2 \cdot (1 - R_c(\Delta t, S_c) + 0.15) \cdot \min\!\left(1.5,\; \frac{\Delta t}{S_c}\right)\right)\right)$$
     *(Same-day cramming $\Delta t \approx 0 \implies \frac{\Delta t}{S_c} \approx 0 \implies S_c' \approx S_c$; spaced reviews at $R_c \approx 0.85$ follow the single ladder **`4d → 14d → 28d → 61d → 138d → 310d+`**.)*
   - **Lapse on targeted concept:** $S_c' = \min(10,\; \max(5,\; 0.25 \cdot S_c))$, `lapses += 1`, `lastSuccessAt = now` (schedules a ~1-week relearning follow-up; untargeted concepts are untouched).

---

## 3. Lifecycle, Familiarity, Non-Punitive Reflection & Replay Determinism

### 3.1 Required 3-Field Post-Seal Check-In & Three Exit Paths
- Every non-abandoned sealed attempt opens the existing 3-field **Initial Reflection** check-in alongside the frozen code (**Prior familiarity**: `New to me / Seen before / Solved before`, **Runtime complexity**, and **Auxiliary space complexity**; explicit `"unsure"` remains accepted).
- Submitting those 3 fields offers three explicit exit actions right on the form:
  1. **Continue to coaching** — opens live conversational reflection immediately.
  2. **Come back to coaching later** (`defer`) — saves the 3 answers, triggers baseline rating attribution, and adds the attempt to the **Pending Reflections** shelf on **Today**.
  3. **Submit & skip coaching** (`skip-confident`) — saves the 3 answers, triggers the exact same baseline rating attribution, and finishes cleanly without reminders.
- Because all three paths capture familiarity + stated runtime/space complexity before scoring, skipping chat can never bypass the familiarity damper or hide an inaccurate Big-O answer.
- The background post-seal attribution worker writes an immutable `attempt-seal` event into `skill_rating_events` containing its **complete structured LLM attribution output** (`exercisedDomains`, `demonstratedConcepts`, `difficultyModifier`, `familiarity`, `statedComplexityCheck`), while the post-seal summary card shows `"Updating skill ratings…"` (~3–6s) and then animates the exact delta.
- If the learner later changes `exposure` (`setExposure`) or excludes/corrects an observation in **Coach Memory**, the store appends a deterministic `compensating-recompute` event and replays the pure TypeScript math over active events—**no LLM call is ever re-run during replay, snapshot restore, or correction**.

### 3.2 When Missed-Structure `Selection` Penalties Are Allowed
Persisted `prescriptionSchema` ([`lib/prescription-types.ts`](../lib/prescription-types.ts)) gains an optional `intent` block:
```ts
intent?: {
  slotKind: "onboarding" | "growth" | "breadth" | "concept-probe" | "consolidation" | "momentum";
  targetDomain: DomainId;
  targetFacet: "implementation" | "selection";
  targetConceptSlug?: string;
  targetDifficultyBand: [number, number];
}
```
Post-seal attribution may assign a low `Selection` score ($S_{d,\text{sel}} = 0.20$) to an unused domain $d$ **only if**:
1. `prescription.intent` explicitly targeted $d$ with `targetFacet: "selection"` (or `targetConceptSlug`), **OR**
2. The learner's solution ran in strictly worse asymptotic complexity than optimal (e.g. TLE or $O(n^2)$ vs $O(n)$) **and** domain $d$ is already `applied` or `coached` in the learner's history/Concept Ledger.

### 3.3 Strictly Non-Punitive Reflection (`ΔS ≥ 0`)
Reflection never lowers any `attempt-seal` score. Completing reflection (immediately or later from **Pending Reflections**) may only append a `reflection-rescue` event with $\Delta S \in [0,\; +0.25]$ (for example, when time expired on a structurally sound invariant confirmed in conversation) and/or record `coached` Concept Ledger entries ($S_c = 4\text{d}$) for newly taught optimizations.

---

## 4. Onboarding & Deterministic Pacing Director

### 4.1 Two-Stage Onboarding
1. **Stage 1 — Fixed Curated Breadth Pack (4 non-locked, 10–15m Easy problems):**
   Covers 4 orthogonal domains (`hashing-prefix`, `two-pointers-window`, `stacks-queues-linked`, `binary-search` or `trees-recursion`). Fast clean solves rapidly move $\mu_0$ (`±220 → ±125` in 4 sessions) without risk of single-topic tunneling.
2. **Stage 2 — Dynamic Calibration Batch (3 problems):**
   Uses the Pacing Director below to probe `[θ - 20, θ + 35]` across untouched domains (`graphs-search`, `sorting-intervals`, `heaps-ordered`). Existing or imported history replays chronologically through `applyAttemptEvent` to warm-start $(\mu_0, \delta, \sigma, S_c)$ automatically.

### 4.2 Deterministic Pacing Director Rules & Complete Fallback Cascade

1. **Separated Units:**
   - **Domain Cooldowns (Attempt Count):** Primary domain $d$ is ineligible if $d = d_{\text{last}}$ (never twice in a row) or $d$ appeared $\ge 2$ times in the last 6 completed attempts (including self-picked catalog attempts).
   - **Concept Due Queue (Calendar Days):** Concept $c$ is due when $R_c(\Delta t_{\text{days}}, S_c) \le 0.88$ and its parent domain is cooldown-eligible. Ordered by **lowest $R_c$ first, tie-breaking by lowest $S_c$** (rescuing fragile $S_c=4\text{d}$ concepts first).
   - **Concept Admission Throttle (`MAX_FRAGILE_CONCEPTS = 3`):** Do not schedule new `concept-probe` slots while $\ge 3$ tracked concepts have $S_c < 21\text{ days}$.
2. **5-Slot Rolling Schedule & Fallbacks (`step = completedAttempts mod 5`):**
   - **Slot 0 (`Growth`):** Cooldown-eligible domain minimizing Lower Confidence Bound $\delta_{d,\text{impl}} - 0.6 \sigma_{d,\text{impl}}$ (naturally balances weak offsets and uncalibrated wide-$\sigma$ domains). Band: $[\theta - 45, \theta + 10]$.
   - **Slot 1 (`Breadth / Concept Probe`):** If `fragileConcepts < 3` and an unseen concept exists in an eligible domain (respecting domain entry floors, e.g. `backtracking` requires $\mu_0 \ge 1025$), probe it at $[\theta - 55, \theta - 15]$; **fallback:** highest-$\sigma_{d,\text{impl}}$ eligible domain (`Breadth`).
   - **Slot 2 (`Growth` / Elastic `Consolidation` Overflow):** Converts to `Consolidation` if `dueConcepts.length >= 2` (providing up to 40% consolidation capacity during heavy review weeks); **fallback:** `Growth`.
   - **Slot 3 (`Consolidation`):** Top due concept (or rustiest domain with $\sigma_{\text{curr}} - \sigma_{\text{fresh}} \ge 12$) at $[\theta - 40, \theta + 5]$; **fallback if queue empty:** `Breadth` (if any $\sigma_d > 95$) → else `Growth`.
   - **Slot 4 (`Momentum`):** Highest-rated cooldown-eligible domain $\arg\max_d \theta_{d,\text{impl}}$ (no `1150+` threshold required) at $[\theta - 105, \theta - 55]$.
3. **Skip & Planner Evidence Rules:**
   - Clicking **Choose another** (`skippedSlugs`) retains the Director's `intent` for up to 2 skips, rotating to the runner-up eligible domain on a 3rd skip.
   - [`lib/prescription.ts:463`](../lib/prescription.ts) is relaxed to allow `evidenceIds: []` when `intent.slotKind` is `"onboarding"`, `"breadth"`, or `"concept-probe"` (citing the persisted `intent` receipt instead of unrelated historical skill rows).

---

## 5. Pre-Build Replay & Convergence Verification

Executed in an isolated deterministic simulation before writing implementation code:

1. **Replay of 11 Assessed Historical & Native Sessions (Oct 22 – Nov 19, 2026, including the 24-day gap before `Isomorphic Strings` and `Best Time to Buy and Sell Stock`):**
   - Converged cleanly to **Global Base `1104 ± 112`**, differentiating stronger demonstrated domains (`binary-search: 1137`, `graphs-search: 1134`, `sorting-intervals: 1112`, `two-pointers-window: 1110`, `hashing-prefix: 1109`) from assisted/unfinished domains (`stacks-queues-linked: 1083`, `heaps-ordered: 1084`), while applying the `0.25×` familiarity damper on `Two Sum` and `Valid Parentheses` revisits.
   - Next 5 Director prescriptions were 100% satisfiable with zero domain repeats: `[growth: stacks-queues-linked @ 1064]` → `[breadth: arrays-strings @ 1084]` → `[consolidation: prefix-sum @ 1084]` → `[consolidation: linked-list-pointers @ 1059]` → `[momentum: binary-search @ 1053]`.
2. **90-Day Synthetic Learners (1 problem/day, clamped `[800, 1850]`, +70 Graph specialization / -70 DP specialization):**
   - **Beginner (true `900`):** settled at `890 ± 51`, 6 concepts consolidated to $S_c \ge 30\text{d}$, `maxDue = 4`, `0` cooldown violations.
   - **Intermediate (true `1150`):** settled at `1165 ± 51`, `maxDue = 3`, `0` cooldown violations.
   - **Strong (true `1350`):** settled at `1330 ± 51`, cleanly separating `graphs-search (1347)` from `dynamic-programming (1228)`, `maxDue = 3`, `0` cooldown violations.
3. **Break & Rust Edge Cases (120-day hiatus):**
   - Below-1000 learner (`870`): conservative display moved `870 → 859` (never increased).
   - `1260` learner failing a `1220` refresher ($S = 0.15$): dropped `1260 → 1237` (never snapped upward).
   - Same-day cramming ($\Delta t = 0.1\text{d}$): $S_c$ moved `16.00d → 16.03d` (`+0.2%`), while spaced retrievals progressed `4d → 16d → 28d → 61d → 138d`.
