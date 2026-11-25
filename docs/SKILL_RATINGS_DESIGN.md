# Design Specification (v5): Hierarchical Skill Ratings, Concept Stability & Pacing Director

> [!NOTE]
> **Design specification (v5 — machine-verified)** — resolves all seven blockers (`B1`–`B7`), all nine formula/prose discrepancies, and all sixteen smaller issues from the v4 review. Every equation, resolver rule, concept transition, and §5 number is implemented and asserted in [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts).

---

## Summary of Changes from v4 Review

| Review Item | Resolution in v5 |
| :--- | :--- |
| **B1. Empty bands around `θ = 1000–1040` & missing empty-band rule** | Overlapped Easy `[800, 1080]`, Medium `[980, 1400]`, and Hard `[1340, 1800]` ($a = \text{acRate}/100$), placing `68%–80%` AC Mediums at `980–1072` across the former `1030–1060` gap. Lowered entry floors to `800` (`980` for `backtracking`). Added 3-step `snapCandidatePool` (`[lo, hi]` → `[lo-60, hi+60]` → nearest 3 by $|D - \text{mid}|$, scored at actual $D$), `orderBy: AC_RATE` list queries, and list-level `design` filtering. |
| **B2. "Rarest tag wins" misroutings & 16 untiered slugs** | Replaced rarity tie-breaking with an explicit **`1..52` total priority table** (§1.2): `heap-priority-queue` (#8) and `linked-list` (#10) outrank `two-pointers` (#24); `tree`/`bst` (#12–14) outrank `bfs`/`dfs` (#19–20); `divide-and-conquer` (#45) and `recursion` (#46) sit just above generic containers (#47–52); untagged problems (`[]`) fall back to `arrays-strings`. |
| **B3. Missing concept catalogue & infinite re-probe loop** | Restored the **24-Concept Catalogue** (§1.3) with `(order, slug, domain, searchTagSlug, minGlobalMu)` and added `state: "probed"` + `probeCount` (`max 2` uncoached probes, `14-day` cooldown). |
| **B4. Nothing ever targets `Selection`** | Added `chooseTargetFacet` (§4.2): sets `targetFacet = "selection"` ("disguised" problem) when $\delta_{d,\text{impl}} - \delta_{d,\text{sel}} \ge 35$ or every 3rd `Growth` attempt in $d$; `Growth` ranks domains by $\min(\text{LCB}_{\text{impl}}, \text{LCB}_{\text{sel}})$. |
| **B5. Valid alternative optimal solutions penalized** | Missed-target `Selection = 0.20` and concept `lapse` require **both** an asymptotic complexity gap **and** an already `coached`/`applied` concept in Track B (§3.2). Optimal alternative routes incur `0` penalty and `0` lapse. |
| **B6 & floor bleed. Global base double-counted; 56% floor bleed** | `applyAttemptGraded` updates $(\mu_0, \sigma_0)$ **once per attempt** from the weighted `implementation` composite, and updates domain facets order-independently from the pre-attempt snapshot (§2.3). Lowered $\sigma_{0,\min} = 20$ vs. $\sigma_{d,\text{impl},\min} = 45$ (`16.5%` steady-state global variance share). |
| **B7. Big-O check-in distorts domain ratings & penalizes `"unsure"`** | Removed free-text Big-O from the DSA domain rubric. Stated time and space Big-O are tracked separately in `complexityCalibration.time` and `complexityCalibration.space` (`{ accurate, inaccurate, unsure }`), displayed as raw counts alongside `unsure` (e.g. `"7 of 9 accurate, 3 unsure"` — never a bare combined percentage). |
| **§5 & Smaller issues** | Committed [`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts) and regenerated every number in §2 and §5 directly from passing assertions; closed all 16 smaller issues in §§1–4. |

---

## 1. Taxonomy, Total-Order Resolver & 24-Concept Catalogue

### 1.1 Track A — 13 Rated Domains & Catalog Query Contract

Schema changes required at build time:
1. Preserve `topicTags: { name, slug }[]` and `acRate: number` (`0..100`) in [`spikes/leetcode/client.mjs`](../spikes/leetcode/client.mjs), [`lib/validation.ts`](../lib/validation.ts), and [`lib/prescription.ts`](../lib/prescription.ts).
2. `LeetCodeClient.list` accepts optional `tag` (a **single** verified slug—never `AND`-combined) and `orderBy: "AC_RATE_DESC" | "AC_RATE_ASC"` (`DESC` when target midpoint $< 1120$, `ASC` when $\ge 1260$, plus a middle `skip` offset when $\in [1120, 1260]$) so the 30 returned candidates cluster near the target difficulty instead of the 30 oldest IDs.
3. `search_problems` immediately filters out candidates with `isPaidOnly` (unless `isPremium`), `skippedSlugs`, and any excluded slug in `{"database", "shell", "concurrency", "interactive", "design", "data-stream"}`, and verifies `q.topicTags.some(t => t.slug === tag)` client-side. Thus `design` problems (including multi-method `systemdesign` tasks rejected at [`lib/prescription.ts:418`](../lib/prescription.ts)) never consume `inspect_problem` calls.

| Canonical Order | Domain ID | Display Name | Entry Floor ($\mu_0$) | Primary Query Slugs (queried one at a time) |
| :---: | :--- | :--- | :---: | :--- |
| 1 | `arrays-strings` | Arrays, Strings & Simulation | `800` | `array`, `string`, `matrix`, `simulation` |
| 2 | `hashing-prefix` | Hashing & Prefix State | `800` | `hash-table`, `prefix-sum`, `counting` |
| 3 | `two-pointers-window` | Two Pointers & Sliding Window | `800` | `two-pointers`, `sliding-window` |
| 4 | `sorting-intervals` | Sorting & Intervals | `800` | `sorting` |
| 5 | `stacks-queues-linked` | Stacks, Queues & Linked Lists | `800` | `stack`, `queue`, `monotonic-stack`, `linked-list` |
| 6 | `binary-search` | Binary Search | `800` | `binary-search` |
| 7 | `heaps-ordered` | Heaps & Ordered Collections | `800` | `heap-priority-queue`, `ordered-set` |
| 8 | `trees-recursion` | Trees & Divide-and-Conquer | `800` | `tree`, `binary-tree`, `binary-search-tree`, `trie` |
| 9 | `graphs-search` | Graphs & Grid Search | `800` | `depth-first-search`, `breadth-first-search`, `graph`, `topological-sort`, `union-find` |
| 10 | `backtracking` | Backtracking | **`980`** | `backtracking` |
| 11 | `dynamic-programming` | Dynamic Programming | `800` | `dynamic-programming` |
| 12 | `greedy` | Greedy | `800` | `greedy` |
| 13 | `math-bitwise` | Math & Bit Manipulation | `800` | `math`, `bit-manipulation`, `number-theory` |

### 1.2 Explicit `1..52` Tag Priority Resolver (Pre-Attempt Classification)

Every mapped LeetCode slug has a unique priority rank (`1` = highest priority, no catalog-rarity heuristic):

1. `trie` → `trees-recursion`
2. `union-find` → `graphs-search`
3. `topological-sort` → `graphs-search`
4. `shortest-path` → `graphs-search`
5. `minimum-spanning-tree` → `graphs-search`
6. `monotonic-stack` → `stacks-queues-linked`
7. `monotonic-queue` → `stacks-queues-linked`
8. `heap-priority-queue` → `heaps-ordered` *(outranks `linked-list` & `divide-and-conquer`: routes Merge k Sorted Lists, Kth Largest, Top K Frequent)*
9. `ordered-set` → `heaps-ordered`
10. `linked-list` → `stacks-queues-linked` *(outranks `two-pointers` & `recursion`: routes Linked List Cycle, Remove Nth Node, Add Two Numbers)*
11. `doubly-linked-list` → `stacks-queues-linked`
12. `binary-search-tree` → `trees-recursion`
13. `binary-tree` → `trees-recursion`
14. `tree` → `trees-recursion` *(outranks `bfs`/`dfs`/`dp`/`divide-and-conquer`)*
15. `backtracking` → `backtracking`
16. `sliding-window` → `two-pointers-window`
17. `binary-search` → `binary-search` *(outranks `divide-and-conquer`: routes Median of Two Sorted Arrays)*
18. `graph` → `graphs-search`
19. `breadth-first-search` → `graphs-search`
20. `depth-first-search` → `graphs-search`
21. `dynamic-programming` → `dynamic-programming` *(outranks `divide-and-conquer`: routes Maximum Subarray)*
22. `memoization` → `dynamic-programming`
23. `greedy` → `greedy`
24. `two-pointers` → `two-pointers-window`
25. `stack` → `stacks-queues-linked`
26. `queue` → `stacks-queues-linked`
27. `prefix-sum` → `hashing-prefix`
28–33. `quickselect` (#28), `merge-sort` (#29), `bucket-sort` (#30), `counting-sort` (#31), `radix-sort` (#32), `sorting` (#33) → `sorting-intervals`
34–36. `hash-table` (#34), `hash-function` (#35), `counting` (#36) → `hashing-prefix`
37–38. `bitmask` (#37), `bit-manipulation` (#38) → `math-bitwise`
39–44. `number-theory` (#39), `combinatorics` (#40), `geometry` (#41), `game-theory` (#42), `randomized` (#43), `brainteaser` (#44) → `math-bitwise`
45. `divide-and-conquer` → `trees-recursion` *(demoted below all specific structures/paradigms)*
46. `recursion` → routed to `math-bitwise` if co-tagged `math` (e.g. *Pow(x, n)*) when no rank `1..45` tag matched, else `trees-recursion`
47–52. `matrix` (#47), `simulation` (#48), `enumeration` (#49), `iterator` (#50), `string` (#51), `array` (#52) → `arrays-strings`

**Untagged fallback:** The 51 catalog problems with `topicTags = []` resolve to `arrays-strings` if self-picked (and never match tag-filtered Director queries). Strongly connected / Eulerian / biconnected / sweep-line / string-matching / rolling-hash / suffix-array / reservoir-sampling / rejection-sampling / probability-and-statistics (combined `<120` niche problems) are intentionally unmapped in v5; problems carrying only niche + container tags resolve via their container tag during pre-filtering and via actual code during post-check-in attribution.

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
- **Steady-State Global Bleed Guard:** At the $\sigma$ floors ($\sigma_0 = 20, \sigma_{d,\text{impl}} = 45$), the global variance share is $\frac{20^2}{20^2 + 45^2} = \mathbf{16.5\%}$ (`83.5%` domain-local), preventing isolated domain failures from dragging down unrelated domains.

### 2.2 Overlapping Difficulty Mapping ($D$), Empty-Band Snap & Expected Score ($E$)

1. **Overlapping Base Difficulty ($a = \text{acRatePct} / 100 \in [0, 1]$, structural modifier $\Delta D \in [-50, +50]$):**
   - **Easy:** $D_{\text{base}} = 800 + 280 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.85 - a}{0.55}\right) \in [800,\; 1080]$
   - **Medium:** $D_{\text{base}} = 980 + 420 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.80 - a}{0.55}\right) \in [980,\; 1400]$
   - **Hard:** $D_{\text{base}} = 1340 + 460 \cdot \text{clamp}_{[0,1]}\!\left(\frac{0.70 - a}{0.50}\right) \in [1340,\; 1800]$
   - Final $D = \text{clamp}_{[800, 1850]}(\text{round}(D_{\text{base}} + \Delta D))$. Easy and Medium overlap across `[980, 1080]`; Medium and Hard overlap across `[1340, 1400]`.
2. **Empty-Band Snap Rule (`snapCandidatePool`):**
   Given target band $[L, U]$ with midpoint $M = \frac{L+U}{2}$:
   - Step 1: Return candidates with $D_{\text{base}} \in [L, U]$ if non-empty.
   - Step 2: Otherwise widen to $[L - 60, U + 60]$ if non-empty.
   - Step 3: Otherwise return the 3 candidates minimizing $|D_{\text{base}} - M|$. (If the entire domain returns 0 available candidates, advance to the next eligible domain.) Scoring always uses the chosen problem's actual $D$, never $M$.
3. **Expected Score ($L = 320, q = \frac{\ln 10}{320}, \sigma_p = 55, g(\sigma_p) = (1 + 3q^2\sigma_p^2/\pi^2)^{-1/2} \approx 0.9770$):**
   $$E(\theta, D) = \frac{1}{1 + 10^{-g(\sigma_p)(\theta - D)/320}}$$
   **Exact Target Bands & Expected Scores:**
   - **Momentum (`[θ - 105, θ - 55]`):** $E \in [0.60,\; 0.68]$
   - **Growth & Breadth (`[θ - 45, θ + 10]`):** $E \in [0.48,\; 0.58]$
   - **Concept Probe (`[θ - 55, θ - 15]`):** $E \in [0.53,\; 0.60]$
   - **Consolidation (`[θ - 40, θ + 5]`):** $E \in [0.49,\; 0.57]$
   - **Stretch (`[θ + 10, θ + 65]`):** $E \in [0.39,\; 0.48]$

### 2.3 Mutually Exclusive Rubric ($S \in [0, 1]$) & Single-Base Update Step

Evaluated **top-to-bottom (first match wins, never stacked)** per exercised domain ($\sum_d w_{d,\text{impl}} = 1$; $w_{d,\text{sel}} = 0$ on signature-forced inputs like `ListNode`/`TreeNode` unless a non-obvious sub-pattern was required; Java API reference lookups via `Java help` carry no penalty):

| Precedence | Mutually Exclusive Attempt Outcome | $S_{d,\text{impl}}$ | $S_{d,\text{sel}}$ |
| :---: | :--- | :---: | :---: |
| 1 | Recorded outside solution help during active solving (accepted or not) | `0.35` *(if accepted, else `0.15`)* | `0.30` *(if accepted, else `0.15`)* |
| 2 | Accepted in timebox, optimal complexity class, $\le 2$ wrong-answer submits | `1.00` | `1.00` *(if non-obvious)* |
| 3 | Accepted in timebox, optimal complexity class, $\ge 3$ wrong-answer submits or minor constant/pass overhead | `0.80` | `0.90` |
| 4 | Accepted in timebox via suboptimal complexity class (e.g. $O(n^2)$ where $O(n)$ applies) | `0.65` *(used domain)* | `0.50` *(used domain)*; `0.20` *(missed domain iff §3.2 holds)* |
| 5 | Unaccepted at deadline, structurally sound core invariant with isolated boundary/syntax bug | `0.40` | `0.75` |
| 6 | Unaccepted at deadline, partial/incomplete mechanics | `0.15` | `0.35` |
| 7 | No viable approach or fundamental invariant contradiction | `0.00` | `0.00` |

**Familiarity Multiplier ($m_{\text{fam}}$, applied when $S > E$, else `1.0`):** `new = 1.0`, `revisit = 0.65`, `solved = 0.25`.

**Simultaneous Order-Independent Update (`applyAttemptGraded`):**
1. **Idle $\sigma$-Drift ($c_{\text{drift}} = 7.0\;\text{pts}/\sqrt{\text{day}}$, 21-day grace window):**
   $$\sigma'(\Delta t) = \min\!\left(\sigma_{\max},\; \sqrt{\sigma^2 + 49 \cdot \max(0,\; \Delta t - 21)}\right)$$
   Apply once to $\sigma_0$ ($\sigma_{\max}=220$) and touched domains ($\sigma_{\max}=150$), then snapshot $(\mu_0^{\text{pre}}, \sigma_0^{\text{pre}}, \delta_{d,f}^{\text{pre}}, \sigma_{d,f}^{\text{pre}})$.
2. **Single Global Base Update (from `implementation` updates only):**
   Normalize $\hat{w}_d = \frac{w_{d,\text{impl}}}{\sum_k w_{k,\text{impl}}}$, $\tilde{w}_d = \hat{w}_d m_{\text{fam},d}$, $E_d = E(\mu_0^{\text{pre}} + \delta_{d,\text{impl}}^{\text{pre}}, D)$, $R_{\text{tot}} = \sum_d \tilde{w}_d(S_{d,\text{impl}} - E_d)$, $I_{\text{tot}} = \sum_d \tilde{w}_d q^2 g(\sigma_p)^2 E_d(1 - E_d)$, $\bar{\sigma}_{\text{dom}}^2 = \sum_d \hat{w}_d (\sigma_{d,\text{impl}}^{\text{pre}})^2$, $V_0 = (\sigma_0^{\text{pre}})^2 + \bar{\sigma}_{\text{dom}}^2$, and $\alpha_0 = \frac{(\sigma_0^{\text{pre}})^2}{V_0}$:
   $$\mu_0 \leftarrow \mu_0^{\text{pre}} + \alpha_0 \frac{q g(\sigma_p) R_{\text{tot}}}{V_0^{-1} + I_{\text{tot}}}, \qquad \sigma_0 \leftarrow \max\!\left(20,\; \left((\sigma_0^{\text{pre}})^{-2} + \alpha_0 I_{\text{tot}}\right)^{-1/2}\right)$$
   *(Four clean `D = 920` Easies from initialization move $(\mu_0, \sigma_0)$ from `1000 ± 220` to **`1167 ± 146`**, never double-counting `Selection`.)*
3. **Independent Facet Offset Updates (from pre-attempt snapshot, order-independent):**
   For each active $(d, f)$ with $\theta^{\text{pre}} = \mu_0^{\text{pre}} + \delta_{d,f}^{\text{pre}}$, $\tilde{w} = w_{d,f} m_{\text{fam}}$, $V = (\sigma_0^{\text{pre}})^2 + (\sigma_{d,f}^{\text{pre}})^2$, $\alpha_d = \frac{(\sigma_{d,f}^{\text{pre}})^2}{V}$, and $I = \tilde{w} q^2 g(\sigma_p)^2 E(1 - E)$:
   $$\delta_{d,f} \leftarrow \delta_{d,f}^{\text{pre}} + \alpha_d \frac{q g(\sigma_p) \tilde{w}(S_{d,f} - E)}{V^{-1} + I}, \qquad \sigma_{d,f} \leftarrow \max\!\left(\sigma_{\min},\; \left((\sigma_{d,f}^{\text{pre}})^{-2} + \alpha_d I\right)^{-1/2}\right), \qquad \sigma_{d,f,\text{fresh}} \leftarrow \sigma_{d,f}$$

### 2.4 Break / Rust Display & Concept Stability Ladder

1. **Rusty Badge & Read-Only Display Rating:**
   - **Rusty badge trigger:** Fires on any practiced domain (`lastUpdatedAt !== null`) at **$\Delta t \ge 45$ idle calendar days** (independent of $\sigma_{\text{fresh}}$).
   - **Display formula:** $\theta_{\text{display}} = \theta_{d,f} - 0.85 \cdot \max(0,\; \sigma'(\Delta t) - \sigma_{d,f,\text{fresh}})$. On a 120-day break from $\sigma_{\text{fresh}} = 65$, this deducts **`26` points** (strictly downward even when $\theta < 1000$; expected score $E$ always uses latent $\theta_{d,f}$).
2. **Track B Concept Stability (`lastEvaluatedAt` governs $\Delta t$):**
   $$R_c(\Delta t, S_c) = \left(1 + \frac{\Delta t}{9 \cdot S_c}\right)^{-1}$$
   - `probed-uncoached`: `state = "probed"`, $S_c = 0$, `probeCount += 1`, `lastEvaluatedAt = now`.
   - First `coached`: `state = "coached"`, $S_c = 4\text{d}$, `lastEvaluatedAt = lastSuccessAt = now`.
   - First `applied`: `state = "applied"`, $S_c = 14\text{d}$ if previously `coached` with $\Delta t \ge 2\text{d}$ else $12\text{d}$, `reps = 1`, `lastEvaluatedAt = lastSuccessAt = now`.
   - Subsequent `applied` (`reps ≥ 1` while `applied`):
     $$S_c' = \min\!\left(730,\; S_c \cdot \left(1 + 2.2 \cdot (1 - R_c(\Delta t, S_c) + 0.15) \cdot \min\!\left(1.5,\; \frac{\Delta t}{S_c}\right)\right)\right)$$
     - **Same-day repeat ($\Delta t = 0.1\text{d}$ from $14\text{d}$):** **`14.00 → 14.03 days`**.
     - **Ladder at exact continuous due threshold $R_c = 0.88$ ($\Delta t = \frac{27}{22} S_c$):** **`4 → 14 → 24 → 42 → 72 → 125 days`**.
     - **Ladder on first whole calendar day $R_c \le 0.88$ ($\Delta t = \lceil \frac{27}{22} S_c \rceil$):** **`4 → 14 → 25 → 43 → 76 → 131 days`**.
   - `lapsed`: $S_c' = \min(10, \max(5, 0.25 \cdot S_c))$, `lapses += 1`, `lastEvaluatedAt = now` (`lastSuccessAt` unchanged).

---

## 3. Check-In Lifecycle, Alternative-Route Guard, Big-O Calibration & Non-Punitive Rescue

### 3.1 Next-Problem Check-In Gate & Familiarity-Tap Skip (No Auto-Settle Timer)
- **Intentional UI change:** While `intakeActive` is true, the toolbar `"Skip reflection"` button ([`components/reflection-workspace.tsx:320-337`](../components/reflection-workspace.tsx)) is hidden so completions flow through the check-in surface.
- **Full check-in (3 fields, 3 exit actions):** Completing **Familiarity** (`New to me · Seen before · Solved before`, no default preselected), **Runtime complexity**, and **Auxiliary space complexity** enables **Continue to coaching**, **Come back to coaching later** (`defer`), and **Submit & skip coaching** (`skip-confident`). **All three actions trigger `attempt-attribution` identically**, writing an immutable `attempt-graded` event (containing the full structured LLM attribution output so replay/restore is 100% deterministic without LLM calls).
- **Explicit "Skip check-in" action (1 familiarity tap, still rates):** A learner who wants to skip typing runtime/space complexity may choose **Skip check-in**, which requires **only the single familiarity tap** (`New to me · Seen before · Solved before`, no default preselected so the `1.0×` `"new"` multiplier cannot be claimed passively), records both runtime and space complexity as `"unsure"`, runs `attempt-attribution` (`attempt-graded`), and unlocks the next problem.
- **Hard gate across both prescriptions and self-picked catalog starts (no 24-hour auto-settle):** There is no timer-based auto-settlement and no `"abandoned"` state. Any sealed non-demonstration attempt without a settled check-in blocks starting a new assessment in **both**:
  1. `recommend()` ([`lib/recommendation.ts`](../lib/recommendation.ts)), which blocks `Today` prescriptions and shows a **“Finish your check-in”** prompt; and
  2. `POST /api/state` ([`app/api/state/route.ts:73`](../app/api/state/route.ts), which currently checks only `active | paused` and does *not* call `recommend()`), so self-picked problems from **Problem library** are gated identically.
  *(Attempts whose check-in was submitted with `"Come back to coaching later"` already have a settled check-in, so they sit in the non-blocking **Pending Reflections** shelf without gating `recommend()` or `POST /api/state`.)*
- If the learner later changes `exposure` (`setExposure`) or excludes/corrects an observation in **Coach Memory**, the store appends a deterministic `compensating-recompute` event and replays the pure TypeScript math over active events.

### 3.2 Alternative-Route Guard (`evaluateMissedTargetSelection`)
An unused domain $d$ / concept $c$ receives $S_{d,\text{sel}} = 0.20$ and a concept `lapse` **if and only if both hold**:
1. The learner's solution had strictly worse asymptotic complexity than optimal (or failed via TLE/MLE where $c$ passes), **AND**
2. Concept $c$ in domain $d$ already has `state ∈ {"coached", "applied"}` in Track B.

If the learner solved the problem **optimally via a different valid route**, `Selection` on the unused target domain is **not updated (`w = 0`)** and no `lapse` is recorded (an uncoached probe simply increments `probeCount`).

### 3.3 Separate Time & Space Big-O Calibration Signals & Strictly Non-Punitive Coaching (`ΔS ≥ 0`)
- Runtime and auxiliary-space check-in answers are tracked **independently** in `complexityCalibration`:
  ```ts
  complexityCalibration: {
    time: { accurate: number; inaccurate: number; unsure: number };
    space: { accurate: number; inaccurate: number; unsure: number };
  }
  ```
  Neither field ever enters $S_{d,\text{impl}}$ or $S_{d,\text{sel}}$. On **Your progress**, each dimension renders as **raw counts alongside the `unsure` count**—e.g. `Runtime: 7 of 9 accurate, 3 unsure` and `Space: 5 of 8 accurate, 4 unsure`—never as a bare percentage (which misleads at small sample sizes or when a user frequently selects `"unsure"`), and never merged into a single combined number.
- Conversational reflection never lowers `attempt-graded` scores; it may only append a `reflection-rescue` event ($\Delta S \in [0, +0.25]$ on **unaccepted** Tier 5/6 near-misses when chat confirms a sound invariant, never on already-accepted solves) and record `coached` Track B concepts.

---

## 4. Onboarding & Deterministic Pacing Director

### 4.1 Onboarding
- **Stage 1 (4 fixed curated Easy problems, 10–15m):** Covers `hashing-prefix`, `two-pointers-window`, `stacks-queues-linked`, and `binary-search`. Four clean `D = 920` solves move $(\mu_0, \sigma_0)$ to **`1167 ± 146`**.
- **Stage 2 (3 dynamic Director prescriptions):** Uses §4.2 directly (where overlapping `[980, 1080]` Mediums/Easies + `snapCandidatePool` guarantee valid candidates in every eligible domain).

### 4.2 Pacing Director (`selectDirectorIntent`)
- **Counters & Cooldowns:** `prescribedCount` increments **only** on attempts launched from a Director `Prescription` (self-picked attempts update ratings and `recentDomains` cooldowns without advancing `prescribedCount` or consuming `Consolidation` slots). Domain $d$ is eligible iff $\mu_0 \ge \text{DOMAIN\_ENTRY\_FLOOR}[d]$, $d \neq d_{\text{last}}$, and $d$ appears $< 2$ times in `recentDomains.slice(-6)`. All domain ties break by **canonical order `1..13` (§1.1)**; concept ties break by lowest $R_c$, then lowest $S_c$, then **concept order `1..24` (§1.3)**.
- **Target Facet Rule (`chooseTargetFacet`):** For `concept-probe`, `targetFacet = "implementation"`. For all other slots, `targetFacet = "selection"` (planner inspects statement to confirm the target structure is not named in the title/signature/prompt) iff $\delta_{d,\text{impl}} - \delta_{d,\text{sel}} \ge 35$ or (`slotKind === "growth"` and `implAttempts(d) mod 3 === 2`); else `"implementation"`.
- **5-Slot Schedule (`slotIndex = prescribedCount mod 5`):**
  - **Slot 0 (`Growth`):** Eligible domain minimizing $\min(\delta_{d,\text{impl}} - 0.6\sigma_{d,\text{impl}},\; \delta_{d,\text{sel}} - 0.6\sigma_{d,\text{sel}})$, band $[\theta - 45, \theta + 10]$.
  - **Slot 1 (`Concept Probe` → `Breadth` fallback):** First concept in `1..24` in an eligible domain with $\mu_0 \ge \text{minGlobalMu}$ that is unseen or `probed` (`probeCount < 2` and $\Delta t \ge 14\text{d}$), provided `< 3` concepts have $0 < S_c < 21\text{d}$, band $[\theta - 55, \theta - 15]$. **Fallback:** highest-$\sigma_{d,\text{impl}}$ eligible domain (`Breadth`), band $[\theta - 45, \theta + 10]$.
  - **Slot 2 (`Consolidation` overflow → `Growth` fallback):** Converts to `Consolidation` if $\ge 2$ eligible concepts have $R_c \le 0.88$; else `Growth`.
  - **Slot 3 (`Consolidation` → `Rusty` → `Breadth` → `Growth`):** Top eligible due concept ($R_c \le 0.88$) at $[\theta - 40, \theta + 5]$; else first eligible Rusty domain ($\Delta t \ge 45\text{d}$); else `Breadth` (if any eligible $\sigma_{d,\text{impl}} > 95$); else `Growth`.
  - **Slot 4 (`Momentum`):** Highest-$\delta_{d,\text{impl}}$ eligible domain at $[\theta - 105, \theta - 55]$.
- [`lib/prescription.ts:463`](../lib/prescription.ts) permits `evidenceIds: []` when `intent.slotKind ∈ {"growth", "breadth", "concept-probe"}` has no prior `SkillEvidence` in `targetDomain`. Clicking **Choose another** retains `intent` for 2 skips, rotating to the next eligible domain on skip 3.

---

## 5. Machine-Verified Replay & Simulation Results ([`tests/skill-ratings-sim.test.ts`](../tests/skill-ratings-sim.test.ts))

All figures below are asserted directly in `npm test`:

1. **Replay of the 11 Assessed Historical & Native Sessions (22–26 Oct + 19 Nov, 24-day gap):**
   - `Two Sum` and `Valid Parentheses` were reported previously solved (`solved` multiplier `0.25×`). Because all 11 predated the Director, `prescribedCount = 0`.
   - Resulting state: **Global Base `1088 ± 112`**. Domain implementation means (`graphs-search: 1130`, `binary-search: 1125`, `two-pointers-window: 1100`, `hashing-prefix: 1099`, `sorting-intervals: 1097`, `heaps-ordered: 1069`, `stacks-queues-linked: 1068`) remain **provisional directional estimates inside $\sigma_{d,\text{impl}} \approx 106\text{–}109$** (`Calibrating` badge), not statistically separated mastery yet.
   - Next 5 Director prescriptions starting Day 34 (`prescribedCount = 0..4`) span **5 distinct domains (`0` repeats)** and exercise `Selection` targeting on Slot 0:
     1. `Slot 0 [growth]`: `stacks-queues-linked` (`selection`) @ `1043–1098`
     2. `Slot 1 [breadth]`: `arrays-strings` (`implementation`) @ `1043–1098` *(fragile concepts = 3 throttled new probe)*
     3. `Slot 2 [consolidation]`: `hashing-prefix` (`implementation`, `prefix-sum-map`) @ `1059–1104`
     4. `Slot 3 [consolidation]`: `sorting-intervals` (`implementation`, `custom-comparator-intervals`) @ `1057–1102`
     5. `Slot 4 [momentum]`: `graphs-search` (`implementation`) @ `1025–1075`
2. **90-Day Synthetic Convergence (1 prescribed problem/day):**
   - **Beginner (true `900`):** `889 ± 50` global (`28` disguised `Selection` prescriptions, `0` cooldown violations).
   - **Intermediate (true `1150`):** `1119 ± 50` global (`graphs-search: 1150`, `dynamic-programming: 1082`, `38` `Selection` prescriptions).
   - **Strong (true `1350`):** `1326 ± 50` global (`28` `Selection` prescriptions).
