import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// ============================================================================
// Reference deterministic implementation of Skill Ratings Design v9
// & Prescription / Onboarding Design v2.
// Verifies F1–F19, D1–D3, all 9 smaller items, timebox math, language parity,
// single-flight atomic drains, ordered shortlists, multi-batch escape hatches,
// signatureForced Selection guard, complete steering, & 200-seed e2e recovery.
// ============================================================================

export const DOMAINS = [
  "arrays-strings",
  "hashing-prefix",
  "two-pointers-window",
  "sorting-intervals",
  "stacks-queues-linked",
  "binary-search",
  "heaps-ordered",
  "trees-recursion",
  "graphs-search",
  "backtracking",
  "dynamic-programming",
  "greedy",
  "math-bitwise",
] as const;

export type DomainId = (typeof DOMAINS)[number];

export const CATALOG_DIFFICULTY_FLOOR: Record<DomainId, number> = {
  "arrays-strings": 800,
  "hashing-prefix": 800,
  "two-pointers-window": 800,
  "sorting-intervals": 800,
  "stacks-queues-linked": 800,
  "binary-search": 800,
  "heaps-ordered": 800,
  "trees-recursion": 800,
  "graphs-search": 800,
  backtracking: 980, // Medium-entry domain (only 3 free Easies exist)
  "dynamic-programming": 800,
  greedy: 800,
  "math-bitwise": 800,
};

// Learner globalMu eligibility gate: all 12 Easy-backed domains remain ALWAYS eligible
// regardless of how low globalMu drops; only backtracking requires Medium-level base rating.
export const DOMAIN_MIN_GLOBAL_MU: Partial<Record<DomainId, number>> = {
  backtracking: 980,
};

export const EXCLUDED_LIST_SLUGS = new Set([
  "database",
  "shell",
  "concurrency",
  "interactive",
  "design",
  "data-stream",
]);

export const CANONICAL_PROBLEM_OVERRIDES: Record<string, DomainId> = {
  "contains-duplicate": "hashing-prefix",
  "valid-anagram": "hashing-prefix",
  "group-anagrams": "hashing-prefix",
  "longest-consecutive-sequence": "hashing-prefix",
  "coin-change": "dynamic-programming",
  "perfect-squares": "dynamic-programming",
  "word-break": "dynamic-programming",
  "longest-increasing-subsequence": "dynamic-programming",
  "longest-common-prefix": "arrays-strings",
  "two-sum-ii-input-array-is-sorted": "two-pointers-window",
  "container-with-most-water": "two-pointers-window",
};

export function resolvePrimaryDomain(slug: string, topicTagSlugs: string[]): DomainId {
  return CANONICAL_PROBLEM_OVERRIDES[slug] ?? resolvePrimaryDomainFromSlugs(topicTagSlugs);
}

// Total priority order across all 53 mapped LeetCode topicTags.slug values (1 = highest specificity).
export const TAG_PRIORITY_TABLE: ReadonlyArray<{
  rank: number;
  slug: string;
  domain: DomainId;
  queryablePrimary: boolean;
}> = [
  { rank: 1, slug: "trie", domain: "trees-recursion", queryablePrimary: true },
  { rank: 2, slug: "union-find", domain: "graphs-search", queryablePrimary: true },
  { rank: 3, slug: "topological-sort", domain: "graphs-search", queryablePrimary: true },
  { rank: 4, slug: "shortest-path", domain: "graphs-search", queryablePrimary: false },
  { rank: 5, slug: "minimum-spanning-tree", domain: "graphs-search", queryablePrimary: false },
  { rank: 6, slug: "monotonic-stack", domain: "stacks-queues-linked", queryablePrimary: true },
  { rank: 7, slug: "monotonic-queue", domain: "stacks-queues-linked", queryablePrimary: false },
  { rank: 8, slug: "heap-priority-queue", domain: "heaps-ordered", queryablePrimary: true },
  { rank: 9, slug: "ordered-set", domain: "heaps-ordered", queryablePrimary: true },
  { rank: 10, slug: "linked-list", domain: "stacks-queues-linked", queryablePrimary: true },
  { rank: 11, slug: "doubly-linked-list", domain: "stacks-queues-linked", queryablePrimary: false },
  { rank: 12, slug: "binary-search-tree", domain: "trees-recursion", queryablePrimary: true },
  { rank: 13, slug: "binary-tree", domain: "trees-recursion", queryablePrimary: true },
  { rank: 14, slug: "tree", domain: "trees-recursion", queryablePrimary: true },
  { rank: 15, slug: "backtracking", domain: "backtracking", queryablePrimary: true },
  { rank: 16, slug: "sliding-window", domain: "two-pointers-window", queryablePrimary: true },
  { rank: 17, slug: "binary-search", domain: "binary-search", queryablePrimary: true },
  { rank: 18, slug: "graph", domain: "graphs-search", queryablePrimary: true },
  { rank: 19, slug: "breadth-first-search", domain: "graphs-search", queryablePrimary: true },
  { rank: 20, slug: "depth-first-search", domain: "graphs-search", queryablePrimary: true },
  { rank: 21, slug: "dynamic-programming", domain: "dynamic-programming", queryablePrimary: true },
  { rank: 22, slug: "memoization", domain: "dynamic-programming", queryablePrimary: false },
  { rank: 23, slug: "greedy", domain: "greedy", queryablePrimary: true },
  { rank: 24, slug: "two-pointers", domain: "two-pointers-window", queryablePrimary: true },
  { rank: 25, slug: "stack", domain: "stacks-queues-linked", queryablePrimary: true },
  { rank: 26, slug: "queue", domain: "stacks-queues-linked", queryablePrimary: true },
  { rank: 27, slug: "prefix-sum", domain: "hashing-prefix", queryablePrimary: true },
  { rank: 28, slug: "quickselect", domain: "sorting-intervals", queryablePrimary: false },
  { rank: 29, slug: "merge-sort", domain: "sorting-intervals", queryablePrimary: false },
  { rank: 30, slug: "bucket-sort", domain: "sorting-intervals", queryablePrimary: false },
  { rank: 31, slug: "counting-sort", domain: "sorting-intervals", queryablePrimary: false },
  { rank: 32, slug: "radix-sort", domain: "sorting-intervals", queryablePrimary: false },
  { rank: 33, slug: "sorting", domain: "sorting-intervals", queryablePrimary: true },
  { rank: 34, slug: "hash-table", domain: "hashing-prefix", queryablePrimary: true },
  { rank: 35, slug: "hash-function", domain: "hashing-prefix", queryablePrimary: false },
  { rank: 36, slug: "counting", domain: "hashing-prefix", queryablePrimary: true },
  { rank: 37, slug: "bitmask", domain: "math-bitwise", queryablePrimary: false },
  { rank: 38, slug: "bit-manipulation", domain: "math-bitwise", queryablePrimary: true },
  { rank: 39, slug: "number-theory", domain: "math-bitwise", queryablePrimary: true },
  { rank: 40, slug: "combinatorics", domain: "math-bitwise", queryablePrimary: false },
  { rank: 41, slug: "geometry", domain: "math-bitwise", queryablePrimary: false },
  { rank: 42, slug: "game-theory", domain: "math-bitwise", queryablePrimary: false },
  { rank: 43, slug: "randomized", domain: "math-bitwise", queryablePrimary: false },
  { rank: 44, slug: "brainteaser", domain: "math-bitwise", queryablePrimary: false },
  { rank: 45, slug: "math", domain: "math-bitwise", queryablePrimary: true },
  { rank: 46, slug: "divide-and-conquer", domain: "trees-recursion", queryablePrimary: false },
  { rank: 47, slug: "recursion", domain: "trees-recursion", queryablePrimary: false },
  { rank: 48, slug: "matrix", domain: "arrays-strings", queryablePrimary: true },
  { rank: 49, slug: "simulation", domain: "arrays-strings", queryablePrimary: true },
  { rank: 50, slug: "enumeration", domain: "arrays-strings", queryablePrimary: false },
  { rank: 51, slug: "iterator", domain: "arrays-strings", queryablePrimary: false },
  { rank: 52, slug: "string", domain: "arrays-strings", queryablePrimary: true },
  { rank: 53, slug: "array", domain: "arrays-strings", queryablePrimary: true },
];

const SLUG_TO_ENTRY = new Map(TAG_PRIORITY_TABLE.map((e) => [e.slug, e]));

export function resolvePrimaryDomainFromSlugs(slugs: string[]): DomainId {
  let best: (typeof TAG_PRIORITY_TABLE)[number] | undefined;
  for (const s of slugs) {
    if (s === "recursion") continue; // Checked after structural co-tags
    const entry = SLUG_TO_ENTRY.get(s);
    if (entry && (!best || entry.rank < best.rank)) best = entry;
  }
  if (best && best.rank <= 46) return best.domain;
  if (slugs.includes("recursion")) return "trees-recursion";
  return best ? best.domain : "arrays-strings"; // Untagged fallback (51 problems)
}

export type ConceptSpec = {
  order: number;
  slug: string;
  label: string;
  domain: DomainId;
  searchTagSlug: string;
  minGlobalMu: number;
};

// Canonical 24-Concept Catalogue (Track B)
export const CONCEPT_CATALOGUE: ReadonlyArray<ConceptSpec> = [
  { order: 1, slug: "in-place-array-scan", label: "In-place Array & Matrix Traversal", domain: "arrays-strings", searchTagSlug: "matrix", minGlobalMu: 800 },
  { order: 2, slug: "hash-map-set", label: "HashMap / HashSet Lookup Invariants", domain: "hashing-prefix", searchTagSlug: "hash-table", minGlobalMu: 800 },
  { order: 3, slug: "prefix-sum-map", label: "Prefix Sum & Cumulative Frequency", domain: "hashing-prefix", searchTagSlug: "prefix-sum", minGlobalMu: 850 },
  { order: 4, slug: "converging-two-pointers", label: "Converging & Multi-Array Two Pointers", domain: "two-pointers-window", searchTagSlug: "two-pointers", minGlobalMu: 800 },
  { order: 5, slug: "variable-sliding-window", label: "Fixed & Variable Sliding Window", domain: "two-pointers-window", searchTagSlug: "sliding-window", minGlobalMu: 900 },
  { order: 6, slug: "custom-comparator-intervals", label: "Custom Sorting & Interval Merging", domain: "sorting-intervals", searchTagSlug: "sorting", minGlobalMu: 850 },
  { order: 7, slug: "quickselect-partition", label: "Quickselect & Bucket Partitioning", domain: "sorting-intervals", searchTagSlug: "sorting", minGlobalMu: 1020 },
  { order: 8, slug: "lifo-fifo-state", label: "Stack & Queue State Parsing", domain: "stacks-queues-linked", searchTagSlug: "stack", minGlobalMu: 800 },
  { order: 9, slug: "linked-list-pointers", label: "Linked-List Rewiring & Fast/Slow Pointers", domain: "stacks-queues-linked", searchTagSlug: "linked-list", minGlobalMu: 850 },
  { order: 10, slug: "monotonic-stack-deque", label: "Monotonic Stack & Deque", domain: "stacks-queues-linked", searchTagSlug: "monotonic-stack", minGlobalMu: 980 },
  { order: 11, slug: "binary-search-index", label: "Sorted Index & Boundary Binary Search", domain: "binary-search", searchTagSlug: "binary-search", minGlobalMu: 800 },
  { order: 12, slug: "binary-search-answer", label: "Binary Search on Monotonic Answer Space", domain: "binary-search", searchTagSlug: "binary-search", minGlobalMu: 1020 },
  { order: 13, slug: "top-k-priority-queue", label: "PriorityQueue (Top-K & K-Way Merge)", domain: "heaps-ordered", searchTagSlug: "heap-priority-queue", minGlobalMu: 900 },
  { order: 14, slug: "ordered-set-map", label: "NavigableSet / TreeMap Floor & Ceiling", domain: "heaps-ordered", searchTagSlug: "ordered-set", minGlobalMu: 1020 },
  { order: 15, slug: "tree-dfs-recursion", label: "Binary Tree DFS & Subtree Recursion", domain: "trees-recursion", searchTagSlug: "binary-tree", minGlobalMu: 850 },
  { order: 16, slug: "bst-ordering", label: "BST Range & In-Order Invariants", domain: "trees-recursion", searchTagSlug: "binary-search-tree", minGlobalMu: 920 },
  { order: 17, slug: "prefix-trie", label: "Prefix Trie Construction & Search", domain: "trees-recursion", searchTagSlug: "trie", minGlobalMu: 1000 },
  { order: 18, slug: "grid-graph-bfs-dfs", label: "Grid & Adjacency-List BFS / DFS", domain: "graphs-search", searchTagSlug: "breadth-first-search", minGlobalMu: 920 },
  { order: 19, slug: "topological-sort", label: "DAG Indegree & Cycle Topological Sort", domain: "graphs-search", searchTagSlug: "topological-sort", minGlobalMu: 1080 },
  { order: 20, slug: "union-find", label: "Disjoint Set (Union-Find)", domain: "graphs-search", searchTagSlug: "union-find", minGlobalMu: 1000 },
  { order: 21, slug: "weighted-shortest-path", label: "Dijkstra & Weighted Shortest Paths", domain: "graphs-search", searchTagSlug: "graph", minGlobalMu: 1100 },
  { order: 22, slug: "state-space-backtracking", label: "Backtracking with Pruning & Undo", domain: "backtracking", searchTagSlug: "backtracking", minGlobalMu: 980 },
  { order: 23, slug: "dp-1d-2d", label: "1D / 2D Memoization & Tabulation", domain: "dynamic-programming", searchTagSlug: "dynamic-programming", minGlobalMu: 960 },
  { order: 24, slug: "greedy-bitwise", label: "Greedy Exchange & Bitwise Identities", domain: "greedy", searchTagSlug: "greedy", minGlobalMu: 900 },
];

// ============================================================================
// Mathematical constants & Difficulty / Glicko-1 / Stability functions
// ============================================================================

export const SCALE = 320;
export const Q = Math.LN10 / SCALE;
export const SIGMA_PROBLEM = 55;
export const GRACE_IDLE_DAYS = 21;
export const C_DRIFT = 7.0;
export const RUST_IDLE_DAYS = 45;
export const PROVISIONAL_SIGMA_THRESHOLD = 80;
export const MAX_FRAGILE_CONCEPTS = 4;
export const VALID_RUBRIC_SCORES = new Set([0, 0.15, 0.2, 0.3, 0.35, 0.4, 0.5, 0.65, 0.75, 0.8, 0.9, 1]);

export type LanguageId = "java" | "cpp";

export function isDomainProvisional(sigma: number): boolean {
  return sigma > PROVISIONAL_SIGMA_THRESHOLD;
}

/** F3: Gate Welcome picker strictly on welcomeDismissed & zero prescribed solves (ignores bundled historySeed). */
export function shouldShowWelcomePicker(opts: {
  welcomeDismissed: boolean;
  prescribedCount: number;
  bundledImportCount?: number;
  userImportCount?: number;
}): boolean {
  return !opts.welcomeDismissed && opts.prescribedCount === 0;
}

/** F1: Standard problem timebox anchored to base difficulty score. */
export function standardMinutes(difficultyScore: number): number {
  if (difficultyScore <= 950) return 15;
  if (difficultyScore <= 1080) return 20;
  if (difficultyScore <= 1250) return 25;
  if (difficultyScore <= 1400) return 35;
  return 45;
}

/** F1 & F2: Clock-adjusted effective difficulty via log-ratio ΔD_time clamped to [-45, +45]. */
export function timeAdjustedDifficulty(
  baseDifficulty: number,
  stdMinutes: number,
  prescribedMinutes: number,
): number {
  const safeStd = Math.max(10, stdMinutes);
  const safeChosen = Math.max(10, prescribedMinutes);
  const deltaTime = Math.max(
    -45,
    Math.min(45, Math.round(-75 * Math.log(safeChosen / safeStd))),
  );
  return Math.max(750, Math.min(1850, Math.round(baseDifficulty + deltaTime)));
}

/** F1: UI allows 1–90m; edits within ±5m stay rated via ΔD_time, larger edits run unrated. */
export function isManualTimeboxRated(prescribedMinutes: number, chosenMinutes: number): boolean {
  return Math.abs(chosenMinutes - prescribedMinutes) <= 5;
}

/** F13: Problem-signature tags that force the data structure / reveal Selection. */
export const SIGNATURE_FORCED_SLUGS = new Set([
  "tree",
  "binary-tree",
  "binary-search-tree",
  "linked-list",
  "doubly-linked-list",
]);

export function isSignatureForcedFromSlugs(slugs: string[]): boolean {
  return slugs.some((s) => SIGNATURE_FORCED_SLUGS.has(s));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Overlapping difficulty bands across [800, 1800]; acRatePct is 0..100 (or 0..1 if <=1). */
export function problemBaseDifficulty(
  difficulty: "Easy" | "Medium" | "Hard",
  acRatePct: number,
  modifier = 0,
): number {
  const a = acRatePct > 1 ? acRatePct / 100 : acRatePct;
  const mod = Math.max(-50, Math.min(50, modifier));
  let base: number;
  if (difficulty === "Easy") {
    base = 800 + 280 * clamp01((0.85 - a) / 0.55); // [800, 1080]
  } else if (difficulty === "Medium") {
    base = 980 + 420 * clamp01((0.8 - a) / 0.55); // [980, 1400]
  } else {
    base = 1340 + 460 * clamp01((0.7 - a) / 0.5); // [1340, 1800]
  }
  return Math.max(800, Math.min(1850, Math.round(base + mod)));
}

export function snapCandidatePool<T extends { difficultyScore: number }>(
  candidates: T[],
  band: [number, number],
): T[] {
  const [lo, hi] = band;
  const inBand = candidates.filter(
    (c) => c.difficultyScore >= lo && c.difficultyScore <= hi,
  );
  if (inBand.length > 0) return inBand;
  const widened = candidates.filter(
    (c) => c.difficultyScore >= lo - 60 && c.difficultyScore <= hi + 60,
  );
  if (widened.length > 0) return widened;
  const mid = (lo + hi) / 2;
  return [...candidates]
    .sort((a, b) => Math.abs(a.difficultyScore - mid) - Math.abs(b.difficultyScore - mid))
    .slice(0, 3);
}

export function gFactor(sigma: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * sigma * sigma) / (Math.PI * Math.PI));
}

export function expectedScore(theta: number, difficulty: number, sigmaP = SIGMA_PROBLEM): number {
  return 1 / (1 + 10 ** ((-gFactor(sigmaP) * (theta - difficulty)) / SCALE));
}

export function driftedSigma(
  sigma: number,
  daysElapsed: number,
  minSigma: number,
  maxSigma = 150,
): number {
  const excess = Math.max(0, daysElapsed - GRACE_IDLE_DAYS);
  if (excess <= 0) return Math.max(minSigma, sigma);
  return Math.min(maxSigma, Math.sqrt(sigma * sigma + C_DRIFT * C_DRIFT * excess));
}

export type ConceptRecord = {
  slug: string;
  domain: DomainId;
  state: "probed" | "coached" | "applied";
  stabilityDays: number; // 0 when state === "probed"
  lastEvaluatedDay: number;
  lastSuccessDay: number | null;
  probeCount: number;
  reps: number;
  lapses: number;
};

export type ComplexityBucket = {
  accurate: number;
  inaccurate: number;
  unsure: number;
};

export function formatComplexityStat(b: ComplexityBucket): string {
  const committed = b.accurate + b.inaccurate;
  return `${b.accurate} of ${committed} accurate, ${b.unsure} unsure`;
}

export type LearnerRatingState = {
  globalMu: number;
  globalSigma: number; // [20, 220]
  globalLastDay: number | null;
  domains: Record<
    DomainId,
    {
      implOffset: number;
      implSigma: number; // [45, 150]
      implFreshSigma: number;
      selOffset: number;
      selSigma: number; // [55, 150]
      selFreshSigma: number;
      lastDay: number | null;
      implAttempts: number;
    }
  >;
  concepts: Map<string, ConceptRecord>;
  recentDomains: DomainId[]; // Tracked for all launches/tests (compatibility); Director 6-cap uses prescribedRecentDomains when populated
  prescribedRecentDomains: DomainId[];
  lastPracticedDomain: DomainId | null;
  prescribedCount: number;
  prescribedGradedCount: number;
  recentStruggles: Array<{ domain: DomainId; day: number; conceptSlug?: string }>;
  consecutiveMisses: number;
  missStreakConsumedByBreaker: boolean;
  lastPrescribedSlotKind: PrescriptionIntent["slotKind"] | null;
  lastPrescribedImplScore: number | null;
  lastPrescribedDifficulty: number | null;
  complexityCalibration: {
    time: ComplexityBucket;
    space: ComplexityBucket;
  };
};

export function createInitialState(): LearnerRatingState {
  const domains = {} as LearnerRatingState["domains"];
  for (const d of DOMAINS) {
    domains[d] = {
      implOffset: 0,
      implSigma: 110,
      implFreshSigma: 110,
      selOffset: 0,
      selSigma: 110,
      selFreshSigma: 110,
      lastDay: null,
      implAttempts: 0,
    };
  }
  return {
    globalMu: 1000,
    globalSigma: 220,
    globalLastDay: null,
    domains,
    concepts: new Map(),
    recentDomains: [],
    prescribedRecentDomains: [],
    lastPracticedDomain: null,
    prescribedCount: 0,
    prescribedGradedCount: 0,
    recentStruggles: [],
    consecutiveMisses: 0,
    missStreakConsumedByBreaker: false,
    lastPrescribedSlotKind: null,
    lastPrescribedImplScore: null,
    lastPrescribedDifficulty: null,
    complexityCalibration: {
      time: { accurate: 0, inaccurate: 0, unsure: 0 },
      space: { accurate: 0, inaccurate: 0, unsure: 0 },
    },
  };
}

export function isRatingRevealed(state: LearnerRatingState): boolean {
  return state.prescribedGradedCount >= 4;
}

/** F8: Include initial uncertainty alongside revealed Global Rating. */
export function formatInitialRatingReveal(state: LearnerRatingState): string {
  return `${Math.round(state.globalMu)} ± ${Math.round(state.globalSigma)}`;
}

export function displayRating(
  state: LearnerRatingState,
  domain: DomainId,
  facet: "implementation" | "selection",
  currentDay: number,
) {
  const dom = state.domains[domain];
  const isSel = facet === "selection";
  const offset = isSel ? dom.selOffset : dom.implOffset;
  const sigma0 = isSel ? dom.selSigma : dom.implSigma;
  const fresh = isSel ? dom.selFreshSigma : dom.implFreshSigma;
  const idle = dom.lastDay === null ? 0 : Math.max(0, currentDay - dom.lastDay);
  const currSigma = driftedSigma(sigma0, idle, isSel ? 55 : 45, 150);
  const latent = state.globalMu + offset;
  const deduction = 0.85 * Math.max(0, currSigma - fresh);
  return {
    latent,
    display: latent - deduction,
    sigma: currSigma,
    rusty: dom.lastDay !== null && idle >= RUST_IDLE_DAYS,
  };
}

export type DomainFacetUpdate = {
  domain: DomainId;
  facet: "implementation" | "selection";
  weight: number;
  difficulty: number;
  score: number;
};

/**
 * Simultaneous single-attempt update:
 * - Updates global (mu_0, sigma_0) AT MOST ONCE per attempt from implementation composite.
 * - Updates each domain facet offset independently from the pre-attempt snapshot (order-independent!).
 */
export function applyAttemptGraded(
  state: LearnerRatingState,
  day: number,
  updates: DomainFacetUpdate[],
  options: {
    familiarity?: "new" | "revisit" | "solved";
    prescribed?: boolean;
    primaryDomain?: DomainId;
    trackLaunchInReducer?: boolean;
    slotKind?: PrescriptionIntent["slotKind"];
    targetedConceptSlug?: string;
    statedComplexity?: {
      time: "accurate" | "inaccurate" | "unsure";
      space: "accurate" | "inaccurate" | "unsure";
    };
  } = {},
) {
  const gp = gFactor(SIGMA_PROBLEM);
  const fam = options.familiarity ?? "new";
  const posFamMult = fam === "solved" ? 0.25 : fam === "revisit" ? 0.65 : 1.0;

  if (state.globalLastDay !== null) {
    state.globalSigma = driftedSigma(
      state.globalSigma,
      day - state.globalLastDay,
      20,
      220,
    );
  }
  const preGlobalMu = state.globalMu;
  const preGlobalSigma = state.globalSigma;

  // Drift touched domains once before snapshotting
  const touched = new Set(updates.map((u) => u.domain));
  for (const d of touched) {
    const dom = state.domains[d];
    if (dom.lastDay !== null && day > dom.lastDay) {
      dom.implSigma = driftedSigma(dom.implSigma, day - dom.lastDay, 45, 150);
      dom.selSigma = driftedSigma(dom.selSigma, day - dom.lastDay, 55, 150);
    }
  }

  // 1. Single Global Base update from implementation updates
  const implUpdates = updates.filter((u) => u.facet === "implementation" && u.weight > 0);
  if (implUpdates.length > 0) {
    const rawWSum = implUpdates.reduce((s, u) => s + u.weight, 0);
    let weightedDiffResidual = 0;
    let weightedInfo = 0;
    let repDomVar = 0;
    for (const u of implUpdates) {
      const normW = u.weight / rawWSum;
      const dom = state.domains[u.domain];
      const thetaPre = preGlobalMu + dom.implOffset;
      const E = expectedScore(thetaPre, u.difficulty);
      const effW = normW * (u.score > E ? posFamMult : 1.0);
      weightedDiffResidual += effW * (u.score - E);
      weightedInfo += effW * Q * Q * gp * gp * E * (1 - E);
      repDomVar += normW * dom.implSigma * dom.implSigma;
    }
    if (weightedInfo > 0) {
      const V = preGlobalSigma * preGlobalSigma + repDomVar;
      const alpha0 = (preGlobalSigma * preGlobalSigma) / V;
      const postVar = 1 / (1 / V + weightedInfo);
      const deltaTotal = postVar * Q * gp * weightedDiffResidual;
      state.globalMu = preGlobalMu + alpha0 * deltaTotal;
      state.globalSigma = Math.max(
        20,
        Math.sqrt(1 / (1 / (preGlobalSigma * preGlobalSigma) + alpha0 * weightedInfo)),
      );
    }
  }

  // 2. Order-independent Domain Offset updates from pre-attempt snapshot
  for (const u of updates) {
    if (u.weight <= 0) continue;
    const dom = state.domains[u.domain];
    const isSel = u.facet === "selection";
    const preOffset = isSel ? dom.selOffset : dom.implOffset;
    const preDSigma = isSel ? dom.selSigma : dom.implSigma;
    const minDSigma = isSel ? 55 : 45;

    const thetaPre = preGlobalMu + preOffset;
    const E = expectedScore(thetaPre, u.difficulty);
    const effW = u.weight * (u.score > E ? posFamMult : 1.0);
    if (effW <= 0) continue;

    const V = preGlobalSigma * preGlobalSigma + preDSigma * preDSigma;
    const alphaD = (preDSigma * preDSigma) / V;
    const info = effW * Q * Q * gp * gp * E * (1 - E);
    const postVar = 1 / (1 / V + info);
    const deltaTotal = postVar * Q * gp * effW * (u.score - E);

    if (isSel) {
      dom.selOffset = preOffset + alphaD * deltaTotal;
      dom.selSigma = Math.max(
        minDSigma,
        Math.sqrt(1 / (1 / (preDSigma * preDSigma) + alphaD * info)),
      );
      dom.selFreshSigma = dom.selSigma;
    } else {
      dom.implOffset = preOffset + alphaD * deltaTotal;
      dom.implSigma = Math.max(
        minDSigma,
        Math.sqrt(1 / (1 / (preDSigma * preDSigma) + alphaD * info)),
      );
      dom.implFreshSigma = dom.implSigma;
      dom.implAttempts += 1;
    }
    dom.lastDay = day;
  }

  state.globalLastDay = day;
  const primary =
    options.primaryDomain ??
    (implUpdates.length
      ? [...implUpdates].sort((a, b) => b.weight - a.weight || DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain))[0].domain
      : undefined);
  if (options.trackLaunchInReducer ?? true) {
    if (primary) {
      state.recentDomains.push(primary);
      state.lastPracticedDomain = primary;
      if (options.prescribed) state.prescribedRecentDomains.push(primary);
    }
    if (options.prescribed) state.prescribedCount += 1;
  }
  if (options.prescribed) {
    state.prescribedGradedCount += 1;
    // F9: Order-independent weighted composite implementation score across all implUpdates
    const rawWSum = implUpdates.reduce((s, u) => s + u.weight, 0);
    const compositeImplScore =
      rawWSum > 0
        ? implUpdates.reduce((s, u) => s + u.weight * u.score, 0) / rawWSum
        : undefined;
    const weightedDiff =
      rawWSum > 0
        ? implUpdates.reduce((s, u) => s + u.weight * u.difficulty, 0) / rawWSum
        : undefined;
    if (weightedDiff !== undefined) {
      state.lastPrescribedDifficulty = Math.round(weightedDiff);
    }
    if (compositeImplScore !== undefined) {
      state.lastPrescribedImplScore = compositeImplScore;
      if (compositeImplScore <= 0.4 && primary) {
        state.consecutiveMisses += 1;
        // A new pair of misses after a non-reinforcement miss arms the breaker again
        if (options.slotKind !== "easy-reinforcement" && state.consecutiveMisses >= 2) {
          state.missStreakConsumedByBreaker = false;
        }
        state.recentStruggles.push({
          domain: primary,
          day,
          ...(options.targetedConceptSlug ? { conceptSlug: options.targetedConceptSlug } : {}),
        });
      } else {
        state.consecutiveMisses = 0;
        state.missStreakConsumedByBreaker = false;
      }
    }
    if (options.slotKind) {
      state.lastPrescribedSlotKind = options.slotKind;
      if (options.slotKind === "easy-reinforcement") {
        state.missStreakConsumedByBreaker = true;
      }
    }
  }

  if (options.statedComplexity) {
    state.complexityCalibration.time[options.statedComplexity.time] += 1;
    state.complexityCalibration.space[options.statedComplexity.space] += 1;
  }
}

/** P2 #3: Idempotent exactly-once grading wrapper keyed by attemptId (UNIQUE(attemptId, kind) in SQLite). */
export function applyAttemptGradedOnce(
  state: LearnerRatingState,
  gradedAttemptIds: Set<string>,
  attemptId: string,
  day: number,
  updates: DomainFacetUpdate[],
  options: Parameters<typeof applyAttemptGraded>[3] = {},
): boolean {
  if (gradedAttemptIds.has(attemptId)) return false;
  gradedAttemptIds.add(attemptId);
  applyAttemptGraded(state, day, updates, options);
  return true;
}

export type GateAttemptSummary = {
  id: string;
  phase: "active" | "paused" | "review" | "learn" | "complete";
  sealed: boolean;
  demonstration?: boolean;
  hasIntake?: boolean;
  checkInSkippedAt?: number;
  reflectionMessageCount?: number;
  coachingDeferred?: boolean;
};

/**
 * P1 #2: Matches lib/reflection-intake.ts (`needsReflectionIntake`) and lib/reflection-service.ts:
 * older/restored attempts that are `complete` or already have reflection messages cannot submit
 * intake, so they are treated as check-in settled and never trapped by the gate.
 */
export function isCheckInSettled(a: GateAttemptSummary): boolean {
  if (a.demonstration || !a.sealed) return true;
  if (a.phase === "active" || a.phase === "paused" || a.phase === "complete") return true;
  if (a.hasIntake || a.checkInSkippedAt !== undefined) return true;
  if ((a.reflectionMessageCount ?? 0) > 0) return true;
  return false;
}

/** Blocks BOTH Today prescriptions (`recommend()`) and self-picked starts (`POST /api/state`). */
export function nextAssessmentGate(attempts: GateAttemptSummary[]): {
  allowed: boolean;
  reason?: "active-attempt" | "unsettled-checkin" | "active-coaching";
  blockingAttemptId?: string;
} {
  const live = attempts.filter((a) => !a.demonstration);
  const active = live.find((a) => a.phase === "active" || a.phase === "paused");
  if (active) {
    return { allowed: false, reason: "active-attempt", blockingAttemptId: active.id };
  }
  const unsettled = live.find((a) => !isCheckInSettled(a));
  if (unsettled) {
    return { allowed: false, reason: "unsettled-checkin", blockingAttemptId: unsettled.id };
  }
  const inCoaching = live.find(
    (a) => (a.phase === "review" || a.phase === "learn") && !a.coachingDeferred,
  );
  if (inCoaching) {
    return { allowed: false, reason: "active-coaching", blockingAttemptId: inCoaching.id };
  }
  return { allowed: true };
}

/** F2: Both toolbar "Skip reflection" and POST /api/attempt complete require a settled check-in. */
export function canTransitionToComplete(a: GateAttemptSummary): boolean {
  return isCheckInSettled(a);
}

export type CheckInAction =
  | "continue-coaching"
  | "defer-coaching"
  | "skip-coaching"
  | "skip-checkin";

export type RatingJobRow = {
  attemptId: string;
  status: "pending" | "running" | "complete" | "failed";
  attempts: number;
  lastError: string | null;
  claimOwnerId?: string | null;
  claimExpiresAt?: number | null;
  updatedAt: number;
};

/** F2 & F4: Exact state transition table for all four exit/check-in actions. */
export function applyCheckInAction(
  a: GateAttemptSummary,
  action: CheckInAction,
  input: {
    familiarity?: "new" | "revisit" | "solved";
    timeComplexity?: "accurate" | "inaccurate" | "unsure";
    spaceComplexity?: "accurate" | "inaccurate" | "unsure";
    now: number;
  },
): {
  attempt: GateAttemptSummary;
  ratingJob: RatingJobRow;
  complexity: {
    time: "accurate" | "inaccurate" | "unsure";
    space: "accurate" | "inaccurate" | "unsure";
  };
} {
  if (!input.familiarity) {
    throw new Error("Explicit familiarity selection is required before settling check-in.");
  }
  const base: GateAttemptSummary = { ...a };
  if (action === "continue-coaching") {
    base.phase = "review";
    base.hasIntake = true;
    base.coachingDeferred = false;
  } else if (action === "defer-coaching") {
    base.phase = "review";
    base.hasIntake = true;
    base.coachingDeferred = true;
  } else if (action === "skip-coaching") {
    base.phase = "complete";
    base.hasIntake = true;
    base.coachingDeferred = false;
  } else {
    // F4: One-tap Skip check-in MUST move phase -> "complete" so nextAssessmentGate unblocks!
    base.phase = "complete";
    base.checkInSkippedAt = input.now;
    base.coachingDeferred = false;
  }
  const complexity =
    action === "skip-checkin"
      ? { time: "unsure" as const, space: "unsure" as const }
      : {
          time: input.timeComplexity ?? "unsure",
          space: input.spaceComplexity ?? "unsure",
        };
  return {
    attempt: base,
    ratingJob: {
      attemptId: a.id,
      status: "pending",
      attempts: 0,
      lastError: null,
      updatedAt: input.now,
    },
    complexity,
  };
}

export function retrievability(daysElapsed: number, stabilityDays: number): number {
  if (stabilityDays <= 0) return 0;
  if (daysElapsed <= 0) return 1;
  return 1 / (1 + daysElapsed / (9 * stabilityDays));
}

export function updateConceptRecord(
  state: LearnerRatingState,
  slug: string,
  domain: DomainId,
  day: number,
  outcome: "probed-uncoached" | "coached" | "applied" | "lapsed",
  opts: { fromEasyReinforcement?: boolean } = {},
) {
  const prev = state.concepts.get(slug);
  if (outcome === "probed-uncoached") {
    if (!prev) {
      state.concepts.set(slug, {
        slug,
        domain,
        state: "probed",
        stabilityDays: 0,
        lastEvaluatedDay: day,
        lastSuccessDay: null,
        probeCount: 1,
        reps: 0,
        lapses: 0,
      });
    } else if (prev.state === "probed") {
      prev.probeCount += 1;
      prev.lastEvaluatedDay = day;
    }
    return;
  }

  if (!prev || prev.state === "probed") {
    const probes = prev?.probeCount ?? 0;
    if (outcome === "coached") {
      state.concepts.set(slug, {
        slug,
        domain,
        state: "coached",
        stabilityDays: 4,
        lastEvaluatedDay: day,
        lastSuccessDay: day,
        probeCount: probes,
        reps: 0,
        lapses: 0,
      });
    } else if (outcome === "applied") {
      state.concepts.set(slug, {
        slug,
        domain,
        state: "applied",
        stabilityDays: 12,
        lastEvaluatedDay: day,
        lastSuccessDay: day,
        probeCount: probes,
        reps: 1,
        lapses: 0,
      });
    }
    return;
  }

  const dt = Math.max(0, day - prev.lastEvaluatedDay);
  const R = retrievability(dt, prev.stabilityDays);
  if (outcome === "applied") {
    if (prev.state === "coached" && prev.reps === 0) {
      prev.state = "applied";
      prev.stabilityDays = dt >= 2 && !opts.fromEasyReinforcement ? 14 : 12;
      prev.reps = 1;
      prev.lastEvaluatedDay = day;
      prev.lastSuccessDay = day;
    } else {
      const spacing = Math.min(1.5, dt / prev.stabilityDays);
      // D3: Easy Reinforcement passes grow already-applied stability at 0.5x rate
      const gainMult = opts.fromEasyReinforcement ? 0.5 : 1.0;
      prev.stabilityDays = Math.min(
        730,
        prev.stabilityDays * (1 + gainMult * 2.2 * (1 - R + 0.15) * spacing),
      );
      prev.reps += 1;
      prev.lastEvaluatedDay = day;
      prev.lastSuccessDay = day;
    }
  } else if (outcome === "coached") {
    // F10: Repeat coaching caps coached stability at min(prev, 4) and never refreshes an applied concept!
    if (prev.state === "coached") {
      prev.stabilityDays = Math.min(prev.stabilityDays, 4);
      prev.lastEvaluatedDay = Math.max(prev.lastEvaluatedDay, day);
    }
  } else if (outcome === "lapsed") {
    // P2 #5: Bound lapse stability by previous stability (e.g. 4d -> 2d, never increases!)
    prev.stabilityDays = Math.min(prev.stabilityDays, 10, Math.max(2, 0.25 * prev.stabilityDays));
    prev.lapses += 1;
    prev.lastEvaluatedDay = day;
    state.recentStruggles.push({ domain, day, conceptSlug: slug });
  }
}

/** F10: Rubric-row -> concept outcome mapping for targeted attempts & reviews. */
export function conceptOutcomeFromRubric(args: {
  rubricRow: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  usedOptimalAlternative?: boolean;
  existing?: ConceptRecord;
}): "applied" | "lapsed" | "probed-uncoached" | "none" {
  if (args.usedOptimalAlternative) {
    return !args.existing || args.existing.state === "probed" ? "probed-uncoached" : "none";
  }
  if (args.rubricRow === 2 || args.rubricRow === 3) {
    return "applied";
  }
  // Rows 1, 4 (suboptimal), 5, 6, 7 count as lapses on already-learned concepts!
  if (args.existing && (args.existing.state === "coached" || args.existing.state === "applied")) {
    return "lapsed";
  }
  return "probed-uncoached";
}

export type StartingTier = "foundations" | "interview-prep" | "experienced";

export const DEFAULT_STARTING_TIER: StartingTier = "foundations";

export const STARTING_TIER_BANDS: Record<
  StartingTier,
  { band: [number, number]; minutes: [number, number]; label: string; description: string }
> = {
  foundations: {
    band: [820, 920],
    minutes: [12, 18],
    label: "Building Foundations",
    description: "Approachable single-invariant Easy problems (12–18 min) while we calibrate your baseline.",
  },
  "interview-prep": {
    band: [940, 1040],
    minutes: [17, 23],
    label: "Interview Prep",
    description: "Tricky Easies and entry Mediums (17–23 min) covering core data structures.",
  },
  experienced: {
    band: [1100, 1220],
    minutes: [22, 28],
    label: "Experienced Solver",
    description: "Standard multi-step Mediums (22–28 min) to calibrate higher ratings fast.",
  },
};

export type OnboardingSeedProblem = {
  slug: string;
  title: string;
  domain: DomainId;
  tier: StartingTier;
  difficulty: "Easy" | "Medium";
  acRate: number;
  isPaidOnly: false;
  topicTagSlugs: string[];
};

export const ONBOARDING_SEED_PROBLEMS: ReadonlyArray<OnboardingSeedProblem> = [
  // 4 Core Onboarding Domains x 3 Tiers x 2 Free Band-Verified Seeds (24)
  { slug: "contains-duplicate", title: "Contains Duplicate", domain: "hashing-prefix", tier: "foundations", difficulty: "Easy", acRate: 63, isPaidOnly: false, topicTagSlugs: ["array", "hash-table", "sorting"] },
  { slug: "ransom-note", title: "Ransom Note", domain: "hashing-prefix", tier: "foundations", difficulty: "Easy", acRate: 64, isPaidOnly: false, topicTagSlugs: ["hash-table", "string", "counting"] },
  { slug: "two-sum", title: "Two Sum", domain: "hashing-prefix", tier: "interview-prep", difficulty: "Easy", acRate: 55, isPaidOnly: false, topicTagSlugs: ["array", "hash-table"] },
  { slug: "group-anagrams", title: "Group Anagrams", domain: "hashing-prefix", tier: "interview-prep", difficulty: "Medium", acRate: 73, isPaidOnly: false, topicTagSlugs: ["array", "hash-table", "string", "sorting"] },
  { slug: "contiguous-array", title: "Contiguous Array", domain: "hashing-prefix", tier: "experienced", difficulty: "Medium", acRate: 49, isPaidOnly: false, topicTagSlugs: ["array", "hash-table", "prefix-sum"] },
  { slug: "brick-wall", title: "Brick Wall", domain: "hashing-prefix", tier: "experienced", difficulty: "Medium", acRate: 56, isPaidOnly: false, topicTagSlugs: ["array", "hash-table"] },

  { slug: "move-zeroes", title: "Move Zeroes", domain: "two-pointers-window", tier: "foundations", difficulty: "Easy", acRate: 63, isPaidOnly: false, topicTagSlugs: ["array", "two-pointers"] },
  { slug: "reverse-string", title: "Reverse String", domain: "two-pointers-window", tier: "foundations", difficulty: "Easy", acRate: 79, isPaidOnly: false, topicTagSlugs: ["two-pointers", "string"] },
  { slug: "valid-palindrome", title: "Valid Palindrome", domain: "two-pointers-window", tier: "interview-prep", difficulty: "Easy", acRate: 50, isPaidOnly: false, topicTagSlugs: ["two-pointers", "string"] },
  { slug: "find-the-index-of-the-first-occurrence-in-a-string", title: "Find the Index of the First Occurrence in a String", domain: "two-pointers-window", tier: "interview-prep", difficulty: "Easy", acRate: 45, isPaidOnly: false, topicTagSlugs: ["two-pointers", "string"] },
  { slug: "container-with-most-water", title: "Container With Most Water", domain: "two-pointers-window", tier: "experienced", difficulty: "Medium", acRate: 57, isPaidOnly: false, topicTagSlugs: ["array", "two-pointers", "greedy"] },
  { slug: "max-consecutive-ones-iii", title: "Max Consecutive Ones III", domain: "two-pointers-window", tier: "experienced", difficulty: "Medium", acRate: 64, isPaidOnly: false, topicTagSlugs: ["array", "binary-search", "sliding-window", "prefix-sum"] },

  { slug: "middle-of-the-linked-list", title: "Middle of the Linked List", domain: "stacks-queues-linked", tier: "foundations", difficulty: "Easy", acRate: 80, isPaidOnly: false, topicTagSlugs: ["linked-list", "two-pointers"] },
  { slug: "number-of-recent-calls", title: "Number of Recent Calls", domain: "stacks-queues-linked", tier: "foundations", difficulty: "Easy", acRate: 77, isPaidOnly: false, topicTagSlugs: ["queue"] },
  { slug: "valid-parentheses", title: "Valid Parentheses", domain: "stacks-queues-linked", tier: "interview-prep", difficulty: "Easy", acRate: 42, isPaidOnly: false, topicTagSlugs: ["string", "stack"] },
  { slug: "linked-list-cycle", title: "Linked List Cycle", domain: "stacks-queues-linked", tier: "interview-prep", difficulty: "Easy", acRate: 52, isPaidOnly: false, topicTagSlugs: ["hash-table", "linked-list", "two-pointers"] },
  { slug: "remove-nth-node-from-end-of-list", title: "Remove Nth Node From End of List", domain: "stacks-queues-linked", tier: "experienced", difficulty: "Medium", acRate: 49, isPaidOnly: false, topicTagSlugs: ["linked-list", "two-pointers"] },
  { slug: "daily-temperatures", title: "Daily Temperatures", domain: "stacks-queues-linked", tier: "experienced", difficulty: "Medium", acRate: 64, isPaidOnly: false, topicTagSlugs: ["array", "stack", "monotonic-stack"] },

  { slug: "count-negative-numbers-in-a-sorted-matrix", title: "Count Negative Numbers in a Sorted Matrix", domain: "binary-search", tier: "foundations", difficulty: "Easy", acRate: 78, isPaidOnly: false, topicTagSlugs: ["array", "binary-search", "matrix"] },
  { slug: "find-target-indices-after-sorting-array", title: "Find Target Indices After Sorting Array", domain: "binary-search", tier: "foundations", difficulty: "Easy", acRate: 78, isPaidOnly: false, topicTagSlugs: ["array", "binary-search", "sorting"] },
  { slug: "search-insert-position", title: "Search Insert Position", domain: "binary-search", tier: "interview-prep", difficulty: "Easy", acRate: 48, isPaidOnly: false, topicTagSlugs: ["array", "binary-search"] },
  { slug: "first-bad-version", title: "First Bad Version", domain: "binary-search", tier: "interview-prep", difficulty: "Easy", acRate: 46, isPaidOnly: false, topicTagSlugs: ["binary-search"] },
  { slug: "koko-eating-bananas", title: "Koko Eating Bananas", domain: "binary-search", tier: "experienced", difficulty: "Medium", acRate: 50, isPaidOnly: false, topicTagSlugs: ["array", "binary-search"] },
  { slug: "search-a-2d-matrix", title: "Search a 2D Matrix", domain: "binary-search", tier: "experienced", difficulty: "Medium", acRate: 52, isPaidOnly: false, topicTagSlugs: ["array", "binary-search", "matrix"] },

  // F7: Fallback Free Seeds for Remaining 8 Easy-Backed Domains (all valid across all 3 tiers when core 4 are muted!)
  { slug: "build-array-from-permutation", title: "Build Array from Permutation", domain: "arrays-strings", tier: "foundations", difficulty: "Easy", acRate: 79, isPaidOnly: false, topicTagSlugs: ["array", "simulation"] },
  { slug: "longest-common-prefix", title: "Longest Common Prefix", domain: "arrays-strings", tier: "interview-prep", difficulty: "Easy", acRate: 45, isPaidOnly: false, topicTagSlugs: ["string", "trie"] },
  { slug: "spiral-matrix", title: "Spiral Matrix", domain: "arrays-strings", tier: "experienced", difficulty: "Medium", acRate: 53, isPaidOnly: false, topicTagSlugs: ["array", "matrix", "simulation"] },

  { slug: "sort-the-people", title: "Sort the People", domain: "sorting-intervals", tier: "foundations", difficulty: "Easy", acRate: 78, isPaidOnly: false, topicTagSlugs: ["array", "hash-table", "string", "sorting"] },
  { slug: "rank-transform-of-an-array", title: "Rank Transform of an Array", domain: "sorting-intervals", tier: "interview-prep", difficulty: "Easy", acRate: 57, isPaidOnly: false, topicTagSlugs: ["array", "hash-table", "sorting"] },
  { slug: "merge-intervals", title: "Merge Intervals", domain: "sorting-intervals", tier: "experienced", difficulty: "Medium", acRate: 49, isPaidOnly: false, topicTagSlugs: ["array", "sorting"] },

  { slug: "last-stone-weight", title: "Last Stone Weight", domain: "heaps-ordered", tier: "foundations", difficulty: "Easy", acRate: 66, isPaidOnly: false, topicTagSlugs: ["array", "heap-priority-queue"] },
  { slug: "relative-ranks", title: "Relative Ranks", domain: "heaps-ordered", tier: "interview-prep", difficulty: "Easy", acRate: 57, isPaidOnly: false, topicTagSlugs: ["array", "sorting", "heap-priority-queue"] },
  { slug: "kth-largest-element-in-an-array", title: "Kth Largest Element in an Array", domain: "heaps-ordered", tier: "experienced", difficulty: "Medium", acRate: 64, isPaidOnly: false, topicTagSlugs: ["array", "divide-and-conquer", "sorting", "heap-priority-queue", "quickselect"] },

  { slug: "maximum-depth-of-binary-tree", title: "Maximum Depth of Binary Tree", domain: "trees-recursion", tier: "foundations", difficulty: "Easy", acRate: 77, isPaidOnly: false, topicTagSlugs: ["tree", "depth-first-search", "breadth-first-search", "binary-tree"] },
  { slug: "symmetric-tree", title: "Symmetric Tree", domain: "trees-recursion", tier: "interview-prep", difficulty: "Easy", acRate: 57, isPaidOnly: false, topicTagSlugs: ["tree", "depth-first-search", "breadth-first-search", "binary-tree"] },
  { slug: "binary-tree-level-order-traversal", title: "Binary Tree Level Order Traversal", domain: "trees-recursion", tier: "experienced", difficulty: "Medium", acRate: 64, isPaidOnly: false, topicTagSlugs: ["tree", "breadth-first-search", "binary-tree"] },

  { slug: "flood-fill", title: "Flood Fill", domain: "graphs-search", tier: "foundations", difficulty: "Easy", acRate: 66, isPaidOnly: false, topicTagSlugs: ["array", "depth-first-search", "breadth-first-search", "matrix"] },
  { slug: "find-if-path-exists-in-graph", title: "Find if Path Exists in Graph", domain: "graphs-search", tier: "interview-prep", difficulty: "Easy", acRate: 54, isPaidOnly: false, topicTagSlugs: ["depth-first-search", "breadth-first-search", "union-find", "graph"] },
  { slug: "number-of-islands", title: "Number of Islands", domain: "graphs-search", tier: "experienced", difficulty: "Medium", acRate: 62, isPaidOnly: false, topicTagSlugs: ["array", "depth-first-search", "breadth-first-search", "union-find", "matrix"] },

  { slug: "fibonacci-number", title: "Fibonacci Number", domain: "dynamic-programming", tier: "foundations", difficulty: "Easy", acRate: 72, isPaidOnly: false, topicTagSlugs: ["math", "dynamic-programming", "recursion", "memoization"] },
  { slug: "climbing-stairs", title: "Climbing Stairs", domain: "dynamic-programming", tier: "interview-prep", difficulty: "Easy", acRate: 53, isPaidOnly: false, topicTagSlugs: ["math", "dynamic-programming", "memoization"] },
  { slug: "house-robber", title: "House Robber", domain: "dynamic-programming", tier: "experienced", difficulty: "Medium", acRate: 52, isPaidOnly: false, topicTagSlugs: ["array", "dynamic-programming"] },

  { slug: "lemonade-change", title: "Lemonade Change", domain: "greedy", tier: "foundations", difficulty: "Easy", acRate: 62, isPaidOnly: false, topicTagSlugs: ["array", "greedy"] },
  { slug: "assign-cookies", title: "Assign Cookies", domain: "greedy", tier: "interview-prep", difficulty: "Easy", acRate: 49, isPaidOnly: false, topicTagSlugs: ["array", "two-pointers", "greedy", "sorting"] },
  { slug: "gas-station", title: "Gas Station", domain: "greedy", tier: "experienced", difficulty: "Medium", acRate: 49, isPaidOnly: false, topicTagSlugs: ["array", "greedy"] },

  { slug: "number-of-1-bits", title: "Number of 1 Bits", domain: "math-bitwise", tier: "foundations", difficulty: "Easy", acRate: 74, isPaidOnly: false, topicTagSlugs: ["divide-and-conquer", "bit-manipulation"] },
  { slug: "palindrome-number", title: "Palindrome Number", domain: "math-bitwise", tier: "interview-prep", difficulty: "Easy", acRate: 57, isPaidOnly: false, topicTagSlugs: ["math"] },
  { slug: "single-number-ii", title: "Single Number II", domain: "math-bitwise", tier: "experienced", difficulty: "Medium", acRate: 64, isPaidOnly: false, topicTagSlugs: ["array", "bit-manipulation"] },
];

/** F6 & F7: Select a live-band-verified, unsolved seed for any unmuted domain & tier. */
export function selectOnboardingSeed(
  domain: DomainId,
  tier: StartingTier,
  opts: { solvedSlugs?: Set<string>; liveAcRates?: Map<string, number> } = {},
): OnboardingSeedProblem | undefined {
  const [lo, hi] = STARTING_TIER_BANDS[tier].band;
  const matches = ONBOARDING_SEED_PROBLEMS.filter((seed) => {
    if (seed.domain !== domain || seed.tier !== tier) return false;
    if (opts.solvedSlugs?.has(seed.slug)) return false;
    const ac = opts.liveAcRates?.get(seed.slug) ?? seed.acRate;
    const diff = problemBaseDifficulty(seed.difficulty, ac);
    return diff >= lo && diff <= hi;
  });
  return matches[0];
}

export type DirectorPreferences = {
  focusDomains: DomainId[];
  mutedDomains: DomainId[];
  maxMinutes?: number;
};

export function validateDirectorPreferences(prefs: DirectorPreferences): DirectorPreferences {
  const focusDomains = [...new Set(prefs.focusDomains)];
  const mutedDomains = [...new Set(prefs.mutedDomains)];
  if (focusDomains.length > 3) {
    throw new Error("At most 3 focus domains can be pinned at once.");
  }
  const focusSet = new Set(focusDomains);
  for (const m of mutedDomains) {
    if (focusSet.has(m)) {
      throw new Error(`Domain "${m}" cannot be both focused and muted.`);
    }
  }
  const mutedSet = new Set(mutedDomains);
  const remainingEasyDomains = DOMAINS.filter(
    (d) => CATALOG_DIFFICULTY_FLOOR[d] === 800 && !mutedSet.has(d),
  );
  if (remainingEasyDomains.length < 4) {
    throw new Error("At least 4 Easy-backed domains must remain unmuted.");
  }
  let maxMinutes = prefs.maxMinutes;
  if (maxMinutes !== undefined) {
    if (!Number.isFinite(maxMinutes) || maxMinutes < 10 || maxMinutes > 45) {
      throw new Error("Preferred maxMinutes must stay between 10 and 45 minutes.");
    }
    maxMinutes = Math.round(maxMinutes);
  }
  return { focusDomains, mutedDomains, ...(maxMinutes !== undefined ? { maxMinutes } : {}) };
}

export type PrescriptionIntent = {
  slotIndex: number;
  slotKind:
    | "onboarding"
    | "growth"
    | "breadth"
    | "concept-probe"
    | "consolidation"
    | "easy-reinforcement"
    | "stretch";
  targetDomain: DomainId;
  targetFacet: "implementation" | "selection";
  targetConceptSlug?: string;
  targetDifficultyBand: [number, number];
  preferEasy?: boolean;
  clockGoal?: "standard" | "ability" | "speed";
  allowCoachedRevisit?: boolean;
  defaultTimeboxBand?: [number, number];
  steeredDomainExplicit?: boolean;
  overrideWarning?: string;
};

/** F1 & F2: Scale timebox with difficulty and clock goal, keeping maxMinutes as a candidate filter. */
export function defaultTimeboxBand(
  _slotKind: PrescriptionIntent["slotKind"],
  difficultyScore: number,
  opts: { maxMinutes?: number; clockGoal?: "standard" | "ability" | "speed" } | number = {},
): [number, number] {
  const options = typeof opts === "number" ? { maxMinutes: opts } : opts;
  const std = standardMinutes(difficultyScore);
  let lo: number;
  let hi: number;
  if (options.clockGoal === "ability") {
    lo = Math.min(45, Math.round(std * 1.4));
    hi = Math.min(45, Math.round(std * 1.6));
  } else if (options.clockGoal === "speed") {
    lo = Math.max(10, Math.round(std * 0.65));
    hi = Math.max(12, Math.round(std * 0.8));
  } else {
    lo = Math.max(10, std - 3);
    hi = Math.min(45, std + 3);
  }
  if (options.maxMinutes !== undefined) {
    const cap = Math.max(10, Math.min(45, Math.round(options.maxMinutes)));
    lo = Math.max(10, Math.min(lo, cap));
    hi = Math.max(lo, Math.min(hi, cap));
  }
  return [lo, hi];
}

export function chooseTargetFacet(
  state: LearnerRatingState,
  domain: DomainId,
  slotKind: PrescriptionIntent["slotKind"],
  disguisableCounts?: Partial<Record<DomainId, number>>,
): "implementation" | "selection" {
  if (slotKind === "easy-reinforcement") return "implementation";
  // F13: Do not assign Selection when < 5 non-signature-forced disguised candidates exist
  if ((disguisableCounts?.[domain] ?? 99) < 5) return "implementation";
  const dom = state.domains[domain];
  if (dom.implOffset - dom.selOffset >= 35) return "selection";
  if (slotKind === "growth" && dom.implAttempts % 3 === 2) return "selection";
  return "implementation";
}

function bandForDomain(
  state: LearnerRatingState,
  d: DomainId,
  facet: "implementation" | "selection",
  loDelta: number,
  hiDelta: number,
): [number, number] {
  const theta =
    state.globalMu +
    (facet === "selection" ? state.domains[d].selOffset : state.domains[d].implOffset);
  const floor = CATALOG_DIFFICULTY_FLOOR[d];
  const lo = Math.max(floor, Math.min(1800, Math.round(theta + loDelta)));
  const hi = Math.max(lo + 30, Math.min(1850, Math.round(theta + hiDelta)));
  return [lo, hi];
}

/**
 * v9: Purposeful Easy Reinforcement replaces standalone strongest-domain Momentum.
 * Scales clock with difficulty (`standardMinutes`), grants generous `+50%` ability clock +
 * coached-revisit fallback below θ = 950 (or backtracking floor near 1000).
 */
export function selectEasyReinforcementTarget(
  state: LearnerRatingState,
  eligible: DomainId[],
  day: number,
  slotIndex: number,
  maxMinutes?: number,
): PrescriptionIntent {
  const eligibleSet = new Set(eligible);
  const domainIndex = (d: DomainId) => DOMAINS.indexOf(d);

  const buildIntent = (dom: DomainId, conceptSlug?: string): PrescriptionIntent => {
    const theta = state.globalMu + state.domains[dom].implOffset;
    const band = bandForDomain(state, dom, "implementation", -210, -135);
    const mid = Math.round((band[0] + band[1]) / 2);
    const floorConstrained = theta < 950 || (dom === "backtracking" && theta < 1060);
    const clockGoal: "standard" | "ability" = floorConstrained ? "ability" : "standard";
    return {
      slotIndex,
      slotKind: "easy-reinforcement",
      targetDomain: dom,
      targetFacet: "implementation",
      ...(conceptSlug ? { targetConceptSlug: conceptSlug } : {}),
      targetDifficultyBand: band,
      preferEasy: true,
      clockGoal,
      allowCoachedRevisit: floorConstrained,
      defaultTimeboxBand: defaultTimeboxBand("easy-reinforcement", mid, {
        maxMinutes,
        clockGoal,
      }),
    };
  };

  // Priority 1: Recent struggle (last 14 days) on an eligible domain
  const recentStruggleCandidates = state.recentStruggles
    .filter((s) => day - s.day <= 14 && eligibleSet.has(s.domain))
    .sort(
      (a, b) =>
        b.day - a.day ||
        state.domains[a.domain].implOffset - state.domains[b.domain].implOffset ||
        domainIndex(a.domain) - domainIndex(b.domain),
    );
  if (recentStruggleCandidates.length > 0) {
    const picked = recentStruggleCandidates[0];
    const conceptRec = picked.conceptSlug
      ? state.concepts.get(picked.conceptSlug)
      : undefined;
    return buildIntent(
      picked.domain,
      conceptRec && conceptRec.state !== "probed" ? conceptRec.slug : undefined,
    );
  }

  // Priority 2: Fragile or near-due Track B concept
  const fragileOrNearDue = [...state.concepts.values()]
    .filter((c) => c.state !== "probed" && eligibleSet.has(c.domain))
    .map((c) => ({
      ...c,
      R: retrievability(day - c.lastEvaluatedDay, c.stabilityDays),
      order: CONCEPT_CATALOGUE.find((x) => x.slug === c.slug)?.order ?? 999,
    }))
    .filter((c) => c.R <= 0.92 || c.stabilityDays < 14)
    .sort((a, b) => a.R - b.R || a.stabilityDays - b.stabilityDays || a.order - b.order);
  if (fragileOrNearDue.length > 0) {
    const top = fragileOrNearDue[0];
    return buildIntent(top.domain, top.slug);
  }

  // Priority 3: Rusty eligible domain
  const rusty = eligible.filter(
    (d) => displayRating(state, d, "implementation", day).rusty,
  );
  if (rusty.length > 0) {
    return buildIntent(rusty[0]);
  }

  // Priority 4: Strongest domain momentum fallback
  const strongest = [...eligible].sort(
    (a, b) =>
      state.domains[b].implOffset - state.domains[a].implOffset ||
      domainIndex(a) - domainIndex(b),
  )[0];
  return buildIntent(strongest);
}

/** v9: Adaptive 4-session onboarding ladder with foundations default & fast max(mu0, lastD) step-ups. */
export function selectOnboardingIntent(
  state: LearnerRatingState,
  _day: number,
  opts: {
    startingTier?: StartingTier;
    preferences?: DirectorPreferences;
    disguisableCounts?: Partial<Record<DomainId, number>>;
  } = {},
): PrescriptionIntent {
  const validPrefs = opts.preferences
    ? validateDirectorPreferences(opts.preferences)
    : undefined;
  const mutedSet = new Set(validPrefs?.mutedDomains ?? []);
  const tier = opts.startingTier ?? DEFAULT_STARTING_TIER;
  const step = Math.min(3, state.prescribedCount);
  const used = new Set(
    state.prescribedRecentDomains.length ? state.prescribedRecentDomains : state.recentDomains,
  );
  const prevDomain = state.lastPracticedDomain ?? state.recentDomains.at(-1) ?? null;

  const preferredOrder: DomainId[] = [
    "hashing-prefix",
    "two-pointers-window",
    "stacks-queues-linked",
    step === 3 &&
    Math.max(state.globalMu, state.lastPrescribedDifficulty ?? state.globalMu) >= 1120 &&
    (state.lastPrescribedImplScore ?? 0) >= 0.8
      ? "graphs-search"
      : "binary-search",
    ...DOMAINS.filter((d) => CATALOG_DIFFICULTY_FLOOR[d] === 800),
  ];

  const targetDomain =
    preferredOrder.find(
      (d) => d !== prevDomain && !mutedSet.has(d) && !used.has(d),
    ) ??
    preferredOrder.find((d) => !mutedSet.has(d) && d !== prevDomain) ??
    preferredOrder.find((d) => !mutedSet.has(d)) ??
    "arrays-strings";

  if (step === 0) {
    const tierCfg = STARTING_TIER_BANDS[tier];
    return {
      slotIndex: 0,
      slotKind: "onboarding",
      targetDomain,
      targetFacet: "implementation",
      targetDifficultyBand: [...tierCfg.band],
      preferEasy: tier === "foundations",
      clockGoal: "standard",
      defaultTimeboxBand: defaultTimeboxBand(
        "onboarding",
        Math.round((tierCfg.band[0] + tierCfg.band[1]) / 2),
        { maxMinutes: validPrefs?.maxMinutes },
      ),
    };
  }

  const lastScore = state.lastPrescribedImplScore ?? 0.65;
  if (lastScore <= 0.4) {
    const lo = Math.max(800, Math.round(state.globalMu - 140));
    const hi = Math.max(lo + 40, Math.round(state.globalMu - 65));
    return {
      slotIndex: step,
      slotKind: "easy-reinforcement",
      targetDomain,
      targetFacet: "implementation",
      targetDifficultyBand: [lo, hi],
      preferEasy: true,
      clockGoal: state.globalMu < 950 ? "ability" : "standard",
      allowCoachedRevisit: state.globalMu < 950,
      defaultTimeboxBand: defaultTimeboxBand("easy-reinforcement", lo, {
        maxMinutes: validPrefs?.maxMinutes,
        clockGoal: state.globalMu < 950 ? "ability" : "standard",
      }),
    };
  }

  if (lastScore >= 0.8) {
    // F8: Step up cleanly from max(globalMu, lastPrescribedDifficulty) when solving cleanly
    const anchor = Math.max(state.globalMu, state.lastPrescribedDifficulty ?? state.globalMu);
    const lo = Math.max(800, Math.min(1650, Math.round(anchor + 55)));
    const hi = Math.max(lo + 40, Math.min(1750, Math.round(anchor + 145)));
    const facet: "implementation" | "selection" =
      step === 3 && (opts.disguisableCounts?.[targetDomain] ?? 99) >= 5
        ? "selection"
        : "implementation";
    return {
      slotIndex: step,
      slotKind: "onboarding",
      targetDomain,
      targetFacet: facet,
      targetDifficultyBand: [lo, hi],
      clockGoal: "standard",
      defaultTimeboxBand: defaultTimeboxBand("onboarding", Math.round((lo + hi) / 2), {
        maxMinutes: validPrefs?.maxMinutes,
      }),
    };
  }

  const lo = Math.max(800, Math.min(1800, Math.round(state.globalMu - 45)));
  const hi = Math.max(lo + 30, Math.min(1850, Math.round(state.globalMu + 10)));
  return {
    slotIndex: step,
    slotKind: "onboarding",
    targetDomain,
    targetFacet: "implementation",
    targetDifficultyBand: [lo, hi],
    clockGoal: "standard",
    defaultTimeboxBand: defaultTimeboxBand("onboarding", Math.round((lo + hi) / 2), {
      maxMinutes: validPrefs?.maxMinutes,
    }),
  };
}

export function selectDirectorIntent(
  state: LearnerRatingState,
  day: number,
  preferences?: DirectorPreferences,
  disguisableCounts?: Partial<Record<DomainId, number>>,
): PrescriptionIntent {
  const validPrefs = preferences ? validateDirectorPreferences(preferences) : undefined;
  const mutedSet = new Set(validPrefs?.mutedDomains ?? []);
  const focusSet = new Set(validPrefs?.focusDomains ?? []);
  // F17: Self-picks govern prevDomain ONLY (lastPracticedDomain); prescribedRecentDomains governs 6-cap
  const prevDomain = state.lastPracticedDomain ?? state.recentDomains.at(-1) ?? null;
  const prescribedHistory =
    state.prescribedRecentDomains.length > 0 || state.lastPracticedDomain !== null
      ? state.prescribedRecentDomains
      : state.recentDomains;
  const domainIndex = (d: DomainId) => DOMAINS.indexOf(d);

  const passesGlobalGate = (d: DomainId) =>
    !mutedSet.has(d) && state.globalMu >= (DOMAIN_MIN_GLOBAL_MU[d] ?? -Infinity);
  const isEligible = (d: DomainId) => {
    if (!passesGlobalGate(d)) return false;
    if (d === prevDomain) return false;
    const count6 = prescribedHistory.slice(-6).filter((x) => x === d).length;
    return count6 < 2;
  };
  let eligible = DOMAINS.filter(isEligible);
  // Defense-in-depth beginner/edge-case fallback: relax 6-attempt cap first, then prevDomain if ever empty
  if (!eligible.length) {
    eligible = DOMAINS.filter((d) => passesGlobalGate(d) && d !== prevDomain);
  }
  if (!eligible.length) {
    eligible = DOMAINS.filter(passesGlobalGate);
  }

  const slotIndex = state.prescribedCount % 5;

  // v9 Reactive Failure Circuit Breaker (F16): fires ONCE per miss streak, never loops during AI outage!
  if (
    state.consecutiveMisses >= 2 &&
    !state.missStreakConsumedByBreaker &&
    state.lastPrescribedSlotKind !== "easy-reinforcement"
  ) {
    return selectEasyReinforcementTarget(state, eligible, day, slotIndex, validPrefs?.maxMinutes);
  }

  const dueConcepts = [...state.concepts.values()]
    .filter((c) => c.state !== "probed" && isEligible(c.domain))
    .map((c) => ({
      ...c,
      R: retrievability(day - c.lastEvaluatedDay, c.stabilityDays),
      order: CONCEPT_CATALOGUE.find((x) => x.slug === c.slug)?.order ?? 999,
    }))
    .filter((c) => c.R <= 0.88)
    .sort((a, b) => a.R - b.R || a.stabilityDays - b.stabilityDays || a.order - b.order);

  const fragileCount = [...state.concepts.values()].filter(
    (c) => c.state !== "probed" && c.stabilityDays < 21,
  ).length;

  const withTimebox = (intent: PrescriptionIntent): PrescriptionIntent => ({
    ...intent,
    clockGoal: intent.clockGoal ?? "standard",
    defaultTimeboxBand: defaultTimeboxBand(
      intent.slotKind,
      Math.round((intent.targetDifficultyBand[0] + intent.targetDifficultyBand[1]) / 2),
      { maxMinutes: validPrefs?.maxMinutes, clockGoal: intent.clockGoal ?? "standard" },
    ),
  });

  // Consolidation on Slot 3 (or Slot 2 overflow when >= 2 concepts are due)
  if ((slotIndex === 3 || (slotIndex === 2 && dueConcepts.length >= 2)) && dueConcepts.length > 0) {
    const top = dueConcepts[0];
    const facet = chooseTargetFacet(state, top.domain, "consolidation", disguisableCounts);
    return withTimebox({
      slotIndex,
      slotKind: "consolidation",
      targetDomain: top.domain,
      targetFacet: facet,
      targetConceptSlug: top.slug,
      targetDifficultyBand: bandForDomain(state, top.domain, facet, -40, 5),
    });
  }
  if (slotIndex === 3) {
    const rusty = eligible.filter(
      (d) => displayRating(state, d, "implementation", day).rusty,
    );
    if (rusty.length > 0) {
      const dom = rusty[0];
      const facet = chooseTargetFacet(state, dom, "consolidation", disguisableCounts);
      return withTimebox({
        slotIndex,
        slotKind: "consolidation",
        targetDomain: dom,
        targetFacet: facet,
        targetDifficultyBand: bandForDomain(state, dom, facet, -40, 5),
      });
    }
  }

  // Slot 1 (or Slot 3 fallback when uncalibrated): Concept Probe -> Breadth
  if (
    slotIndex === 1 ||
    (slotIndex === 3 && eligible.some((d) => state.domains[d].implSigma > 95))
  ) {
    if (slotIndex === 1 && fragileCount < MAX_FRAGILE_CONCEPTS) {
      const probeable = CONCEPT_CATALOGUE.find((c) => {
        if (!isEligible(c.domain) || state.globalMu < c.minGlobalMu) return false;
        const rec = state.concepts.get(c.slug);
        if (!rec) return true;
        if (rec.state !== "probed") return false;
        return rec.probeCount < 2
          ? day - rec.lastEvaluatedDay >= 14
          : day - rec.lastEvaluatedDay >= 90;
      });
      if (probeable) {
        return withTimebox({
          slotIndex,
          slotKind: "concept-probe",
          targetDomain: probeable.domain,
          targetFacet: "implementation",
          targetConceptSlug: probeable.slug,
          targetDifficultyBand: bandForDomain(state, probeable.domain, "implementation", -55, -15),
        });
      }
    }
    const bySigma = [...eligible].sort(
      (a, b) =>
        state.domains[b].implSigma - state.domains[a].implSigma ||
        domainIndex(a) - domainIndex(b),
    );
    const dom = bySigma[0];
    const facet = chooseTargetFacet(state, dom, "breadth", disguisableCounts);
    return withTimebox({
      slotIndex,
      slotKind: "breadth",
      targetDomain: dom,
      targetFacet: facet,
      targetDifficultyBand: bandForDomain(state, dom, facet, -45, 10),
    });
  }

  // Slot 4: Proactive Purposeful Easy Reinforcement (unless previous slot just ran Easy Reinforcement)
  if (slotIndex === 4 && state.lastPrescribedSlotKind !== "easy-reinforcement") {
    return selectEasyReinforcementTarget(state, eligible, day, slotIndex, validPrefs?.maxMinutes);
  }

  // Growth LCB (F13: ignore selOffset - 0.6*selSigma when domain has <5 disguisable Selection candidates!)
  const lcb = (d: DomainId) => {
    const dom = state.domains[d];
    const implLcb = dom.implOffset - 0.6 * dom.implSigma;
    if ((disguisableCounts?.[d] ?? 99) < 5) return implLcb;
    return Math.min(implLcb, dom.selOffset - 0.6 * dom.selSigma);
  };

  // D2: Dedicate Slot 0 Growth to eligible pinned focusDomains whenever present; Slot 2 stays true lowest-LCB Growth
  const eligibleFocus = slotIndex === 0 ? eligible.filter((d) => focusSet.has(d)) : [];
  const growthPool = eligibleFocus.length > 0 ? eligibleFocus : eligible;
  const growthDom = [...growthPool].sort(
    (a, b) => lcb(a) - lcb(b) || domainIndex(a) - domainIndex(b),
  )[0];
  const facet = chooseTargetFacet(state, growthDom, "growth", disguisableCounts);
  return withTimebox({
    slotIndex,
    slotKind: "growth",
    targetDomain: growthDom,
    targetFacet: facet,
    targetDifficultyBand: bandForDomain(state, growthDom, facet, -45, 10),
  });
}

export function selectNextIntent(
  state: LearnerRatingState,
  day: number,
  opts: {
    startingTier?: StartingTier;
    preferences?: DirectorPreferences;
    disguisableCounts?: Partial<Record<DomainId, number>>;
  } = {},
): PrescriptionIntent {
  if (state.prescribedCount < 4) {
    return selectOnboardingIntent(state, day, opts);
  }
  return selectDirectorIntent(state, day, opts.preferences, opts.disguisableCounts);
}

export function domainHasKnownConcept(state: LearnerRatingState, domain: DomainId): boolean {
  for (const c of state.concepts.values()) {
    if (c.domain === domain && (c.state === "coached" || c.state === "applied")) {
      return true;
    }
  }
  return false;
}

/** B5 + F11 guardrail: unused alternative domain gets Selection=0.20 ONLY on asymptotic gap + known concept (or known domain concept when concept omitted)! */
export function evaluateMissedTargetSelection(args: {
  usedOptimalComplexity: boolean;
  targetConceptRecord?: ConceptRecord;
  domainHasKnownConcept?: boolean;
  hasTargetConcept?: boolean;
}): { penalizeSelection: boolean; conceptOutcome: "none" | "probed-uncoached" | "lapsed" } {
  const hasTargetConcept = args.hasTargetConcept ?? Boolean(args.targetConceptRecord);
  if (args.usedOptimalComplexity) {
    // Solved optimally via a valid alternative route -> NEVER penalize Selection or lapse!
    return {
      penalizeSelection: false,
      conceptOutcome:
        hasTargetConcept && (!args.targetConceptRecord || args.targetConceptRecord.state === "probed")
          ? "probed-uncoached"
          : "none",
    };
  }
  if (
    args.targetConceptRecord &&
    (args.targetConceptRecord.state === "coached" ||
      args.targetConceptRecord.state === "applied")
  ) {
    return { penalizeSelection: true, conceptOutcome: "lapsed" };
  }
  if (!args.targetConceptRecord && args.domainHasKnownConcept) {
    return { penalizeSelection: true, conceptOutcome: "none" };
  }
  return {
    penalizeSelection: false,
    conceptOutcome: hasTargetConcept ? "probed-uncoached" : "none",
  };
}

// ============================================================================
// F1, F3, F5, F6, F7, F8: Launch Ledger, Deterministic Replay, SQLite, & Catalog Cache
// ============================================================================

export type PracticeLaunchRow = {
  attemptId: string;
  launchSeq: number;
  day: number;
  startedAt?: number;
  prescribed: boolean;
  rated?: boolean; // Derived from prescribed && !manualTimeboxUnrated; false for self-picks
  language?: LanguageId;
  provisionalDomain: DomainId;
  difficultyScore?: number;
  difficultyModifier?: number;
  standardMinutes?: number;
  prescribedMinutes?: number;
  intent?: PrescriptionIntent;
  selectionSpoilerRevealed?: boolean;
};

export type AttemptGradedPayload = {
  updates: DomainFacetUpdate[];
  familiarity: "new" | "revisit" | "solved";
  primaryDomain: DomainId;
  statedComplexity?: {
    time: "accurate" | "inaccurate" | "unsure";
    space: "accurate" | "inaccurate" | "unsure";
  };
  conceptOutcomes?: Array<{
    slug: string;
    domain: DomainId;
    outcome: "probed-uncoached" | "applied" | "lapsed";
  }>;
};

export type CompensatingRecomputePayload =
  | { excluded: true }
  | ({ excluded?: false } & Partial<AttemptGradedPayload>);

export type ReflectionRescuePayload = {
  scoreDelta: number;
  coachedConcepts?: Array<{ slug: string; domain: DomainId }>;
};

export type ConceptEventPayload = {
  slug: string;
  domain: DomainId;
  outcome: "probed-uncoached" | "coached" | "applied" | "lapsed";
};

export type SkillRatingEventRow = {
  id: string;
  attemptId: string;
  launchSeq: number;
  kind: "attempt-graded" | "compensating-recompute" | "reflection-rescue" | "concept-event";
  idempotencyKey: string;
  occurredDay: number;
  createdAt: number;
  payload:
    | AttemptGradedPayload
    | CompensatingRecomputePayload
    | ReflectionRescuePayload
    | ConceptEventPayload;
};

/**
 * F1 & F5: Replay ratings in `launchSeq` order (never worker completion order),
 * derive `prescribedCount` and `recentDomains` strictly from persisted launches,
 * and replay concept updates / lapses / rescues in `(occurredDay, launchSeq, phaseRank, id)` order.
 */
export function replayRatingLedger(
  launches: PracticeLaunchRow[],
  events: SkillRatingEventRow[],
): LearnerRatingState {
  const state = createInitialState();
  const sortedLaunches = [...launches].sort((a, b) => a.launchSeq - b.launchSeq);
  const eventsByAttempt = new Map<string, SkillRatingEventRow[]>();
  for (const ev of events) {
    const list = eventsByAttempt.get(ev.attemptId);
    if (list) list.push(ev);
    else eventsByAttempt.set(ev.attemptId, [ev]);
  }

  const conceptTransitions: Array<{
    occurredDay: number;
    launchSeq: number;
    phaseRank: number;
    eventId: string;
    slug: string;
    domain: DomainId;
    outcome: "probed-uncoached" | "coached" | "applied" | "lapsed";
  }> = [];

  for (const launch of sortedLaunches) {
    if (launch.prescribed) state.prescribedCount += 1;

    const attemptEvents = eventsByAttempt.get(launch.attemptId) ?? [];
    const graded = attemptEvents.find((e) => e.kind === "attempt-graded") as
      | (SkillRatingEventRow & { payload: AttemptGradedPayload })
      | undefined;
    const compensations = (attemptEvents.filter(
      (e) => e.kind === "compensating-recompute",
    ) as Array<SkillRatingEventRow & { payload: CompensatingRecomputePayload }>).sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    const rescues = (attemptEvents.filter(
      (e) => e.kind === "reflection-rescue",
    ) as Array<SkillRatingEventRow & { payload: ReflectionRescuePayload }>).sort(
      (a, b) => a.occurredDay - b.occurredDay || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );

    let excluded = false;
    let effective: AttemptGradedPayload | undefined = graded
      ? structuredClone(graded.payload)
      : undefined;
    for (const comp of compensations) {
      if (comp.payload.excluded) {
        excluded = true;
      } else {
        excluded = false;
        if (effective) {
          if (comp.payload.updates) effective.updates = comp.payload.updates;
          if (comp.payload.familiarity) effective.familiarity = comp.payload.familiarity;
          if (comp.payload.primaryDomain) effective.primaryDomain = comp.payload.primaryDomain;
          if (comp.payload.statedComplexity) effective.statedComplexity = comp.payload.statedComplexity;
          if (comp.payload.conceptOutcomes) effective.conceptOutcomes = comp.payload.conceptOutcomes;
        }
      }
    }

    const domainForCooldown =
      !excluded && effective?.primaryDomain ? effective.primaryDomain : launch.provisionalDomain;
    state.recentDomains.push(domainForCooldown);
    state.lastPracticedDomain = domainForCooldown; // F17: prevDomain-only for all attempts (including self-picks)
    if (launch.prescribed) {
      state.prescribedRecentDomains.push(domainForCooldown);
      // F16: Update slot kind & breaker consumption strictly from launches even if grading fails!
      if (launch.intent?.slotKind) {
        state.lastPrescribedSlotKind = launch.intent.slotKind;
        if (launch.intent.slotKind === "easy-reinforcement") {
          state.missStreakConsumedByBreaker = true;
        }
      }
      if (launch.difficultyScore !== undefined) {
        state.lastPrescribedDifficulty = launch.difficultyScore;
      }
    }

    const isRated = launch.rated ?? launch.prescribed;
    if (effective && !excluded) {
      if (isRated) {
        const maxRescueDelta = Math.max(
          0,
          Math.min(0.25, rescues.reduce((mx, r) => Math.max(mx, r.payload.scoreDelta), 0)),
        );
        const effectiveUpdates = effective.updates.map((u) => {
          const clone = { ...u };
          if ((launch.selectionSpoilerRevealed || launch.intent?.steeredDomainExplicit) && clone.facet === "selection") {
            clone.weight = 0;
          }
          if (maxRescueDelta > 0) {
            if (clone.facet === "implementation" && clone.score <= 0.4) {
              clone.score = Math.min(0.65, clone.score + maxRescueDelta);
            } else if (clone.facet === "selection" && clone.score <= 0.75) {
              clone.score = Math.min(1.0, clone.score + maxRescueDelta);
            }
          }
          return clone;
        });
        applyAttemptGraded(state, launch.day, effectiveUpdates, {
          familiarity: effective.familiarity,
          primaryDomain: effective.primaryDomain,
          statedComplexity: effective.statedComplexity,
          trackLaunchInReducer: false,
          prescribed: launch.prescribed,
          slotKind: launch.intent?.slotKind,
          targetedConceptSlug: launch.intent?.targetConceptSlug,
        });
      } else if (effective.statedComplexity) {
        // F17: Practice-only self-pick skips BOTH Track A ratings and Track B concept updates; keeps Big-O & prevDomain
        state.complexityCalibration.time[effective.statedComplexity.time] += 1;
        state.complexityCalibration.space[effective.statedComplexity.space] += 1;
      }

      if (isRated && graded && effective.conceptOutcomes) {
        for (const co of effective.conceptOutcomes) {
          conceptTransitions.push({
            occurredDay: launch.day,
            launchSeq: launch.launchSeq,
            phaseRank: 0,
            eventId: graded.id,
            slug: co.slug,
            domain: co.domain,
            outcome: co.outcome,
            fromEasyReinforcement: launch.intent?.slotKind === "easy-reinforcement",
          } as any);
        }
      }
      if (isRated) {
        for (const rescue of rescues) {
          for (const cc of rescue.payload.coachedConcepts ?? []) {
            conceptTransitions.push({
              occurredDay: rescue.occurredDay,
              launchSeq: launch.launchSeq,
              phaseRank: 1,
              eventId: rescue.id,
              slug: cc.slug,
              domain: cc.domain,
              outcome: "coached",
            });
          }
        }
      }
    }
  }

  const launchByAttempt = new Map(sortedLaunches.map((l) => [l.attemptId, l]));
  for (const ev of events) {
    if (ev.kind !== "concept-event") continue;
    const p = ev.payload as ConceptEventPayload;
    const launch = launchByAttempt.get(ev.attemptId);
    const seq = launch?.launchSeq ?? ev.launchSeq;
    conceptTransitions.push({
      occurredDay: ev.occurredDay,
      launchSeq: seq,
      phaseRank: p.outcome === "coached" ? 1 : 0,
      eventId: ev.id,
      slug: p.slug,
      domain: p.domain,
      outcome: p.outcome,
      ...(launch?.intent?.slotKind === "easy-reinforcement" ? { fromEasyReinforcement: true } : {}),
    } as any);
  }

  conceptTransitions.sort(
    (a, b) =>
      a.occurredDay - b.occurredDay ||
      a.launchSeq - b.launchSeq ||
      a.phaseRank - b.phaseRank ||
      a.eventId.localeCompare(b.eventId),
  );
  for (const ct of conceptTransitions as Array<
    (typeof conceptTransitions)[number] & { fromEasyReinforcement?: boolean }
  >) {
    updateConceptRecord(state, ct.slug, ct.domain, ct.occurredDay, ct.outcome, {
      fromEasyReinforcement: ct.fromEasyReinforcement,
    });
  }
  return state;
}

/** F6, F7 & v9: SQLite rating ledger + fail-closed rated flag + atomic drain claims + signatureForced cache. */
export function createRatingSchema(db: DatabaseSync) {
  db.exec(`
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

export type RatingLedgerSnapshot = {
  launches: PracticeLaunchRow[];
  ratingJobs: RatingJobRow[];
  ratingEvents: SkillRatingEventRow[];
};

export function exportRatingSnapshot(db: DatabaseSync): RatingLedgerSnapshot {
  const launchRows = db
    .prepare("SELECT * FROM practice_launches ORDER BY launchSeq ASC")
    .all() as Array<Record<string, any>>;
  const jobRows = db
    .prepare("SELECT * FROM rating_jobs ORDER BY attemptId ASC")
    .all() as Array<Record<string, any>>;
  const eventRows = db
    .prepare("SELECT * FROM skill_rating_events ORDER BY launchSeq ASC, createdAt ASC, id ASC")
    .all() as Array<Record<string, any>>;

  return structuredClone({
    launches: launchRows.map((r) => ({
      attemptId: r.attemptId,
      launchSeq: r.launchSeq,
      day: r.day,
      startedAt: r.startedAt ?? r.day,
      prescribed: Boolean(r.prescribed),
      rated: Boolean(r.rated),
      language: (r.language as LanguageId) ?? "java",
      provisionalDomain: r.provisionalDomain as DomainId,
      ...(r.difficultyScore != null ? { difficultyScore: r.difficultyScore } : {}),
      ...(r.difficultyModifier != null ? { difficultyModifier: r.difficultyModifier } : {}),
      ...(r.standardMinutes != null ? { standardMinutes: r.standardMinutes } : {}),
      ...(r.prescribedMinutes != null ? { prescribedMinutes: r.prescribedMinutes } : {}),
      ...(r.intentJson ? { intent: JSON.parse(r.intentJson) as PrescriptionIntent } : {}),
      ...(r.selectionSpoilerRevealed ? { selectionSpoilerRevealed: true } : {}),
    })),
    ratingJobs: jobRows.map((r) => ({
      attemptId: r.attemptId,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
      claimOwnerId: r.claimOwnerId ?? null,
      claimExpiresAt: r.claimExpiresAt ?? null,
      updatedAt: r.updatedAt,
    })),
    ratingEvents: eventRows.map((r) => ({
      id: r.id,
      attemptId: r.attemptId,
      launchSeq: r.launchSeq,
      kind: r.kind,
      idempotencyKey: r.idempotencyKey,
      occurredDay: r.occurredDay,
      createdAt: r.createdAt,
      payload: JSON.parse(r.payloadJson),
    })),
  });
}

export function restoreRatingSnapshot(db: DatabaseSync, snapshot: RatingLedgerSnapshot) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM skill_rating_events; DELETE FROM rating_jobs; DELETE FROM practice_launches;");
    const insLaunch = db.prepare(
      "INSERT INTO practice_launches(attemptId, launchSeq, day, startedAt, prescribed, rated, language, provisionalDomain, difficultyScore, difficultyModifier, standardMinutes, prescribedMinutes, intentJson, selectionSpoilerRevealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const l of snapshot.launches) {
      insLaunch.run(
        l.attemptId,
        l.launchSeq,
        l.day,
        l.startedAt ?? l.day,
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
    const insJob = db.prepare(
      "INSERT INTO rating_jobs(attemptId, status, attempts, lastError, claimOwnerId, claimExpiresAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const j of snapshot.ratingJobs) {
      insJob.run(
        j.attemptId,
        j.status === "running" ? "pending" : j.status,
        j.attempts,
        j.lastError,
        null,
        null,
        j.updatedAt,
      );
    }
    const insEvent = db.prepare(
      "INSERT INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const e of snapshot.ratingEvents) {
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
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Smaller issue: Collision-free snapshot merge & per-session restore re-indexes launchSeq atomically. */
export function mergeRatingSnapshots(
  target: RatingLedgerSnapshot,
  incoming: RatingLedgerSnapshot,
  replace = true,
): RatingLedgerSnapshot {
  const launchesById = new Map<string, PracticeLaunchRow>(target.launches.map((l) => [l.attemptId, l]));
  for (const l of incoming.launches) {
    if (!launchesById.has(l.attemptId) || replace) {
      launchesById.set(l.attemptId, l);
    }
  }
  const reindexed = [...launchesById.values()]
    .sort((a, b) => (a.startedAt ?? a.day) - (b.startedAt ?? b.day) || a.attemptId.localeCompare(b.attemptId))
    .map((l, idx) => ({ ...l, launchSeq: idx + 1 }));
  const seqByAttempt = new Map(reindexed.map((l) => [l.attemptId, l.launchSeq]));

  const jobsById = new Map<string, RatingJobRow>(target.ratingJobs.map((j) => [j.attemptId, j]));
  for (const j of incoming.ratingJobs) {
    if (!jobsById.has(j.attemptId) || replace) jobsById.set(j.attemptId, j);
  }
  const eventsByKey = new Map<string, SkillRatingEventRow>(
    target.ratingEvents.map((e) => [e.idempotencyKey, e]),
  );
  for (const e of incoming.ratingEvents) {
    if (!eventsByKey.has(e.idempotencyKey) || replace) eventsByKey.set(e.idempotencyKey, e);
  }
  const mergedEvents = [...eventsByKey.values()].map((e) => ({
    ...e,
    launchSeq: seqByAttempt.get(e.attemptId) ?? e.launchSeq,
  }));
  return {
    launches: reindexed,
    ratingJobs: [...jobsById.values()].map((j) =>
      j.status === "running" ? { ...j, status: "pending", claimOwnerId: null, claimExpiresAt: null } : j,
    ),
    ratingEvents: mergedEvents,
  };
}

/** F8: Selection problems must not leak the target technique in the problem title. */
const REVEALING_TITLE_PATTERNS: Partial<Record<DomainId, RegExp>> = {
  "binary-search": /\bbinary\s+search\b/i,
  "heaps-ordered": /\b(heap|priority\s+queue|treemap|ordered\s+set)\b/i,
  "stacks-queues-linked": /\b(monotonic\s+stack|monotonic\s+queue|linked\s+list|stack|queue)\b/i,
  "trees-recursion": /\b(trie|binary\s+search\s+tree|bst|binary\s+tree|tree)\b/i,
  "two-pointers-window": /\b(sliding\s+window|two\s+pointers?)\b/i,
  "sorting-intervals": /\b(sort(ing|ed)?|quickselect|merge\s+sort)\b/i,
  backtracking: /\bbacktrack/i,
  "graphs-search": /\b(bfs|dfs|dijkstra|topological|union\s+find|shortest\s+path|breadth-first|depth-first)\b/i,
  "hashing-prefix": /\b(hash\s*(map|set|table)|prefix\s+sum)\b/i,
  "dynamic-programming": /\b(dynamic\s+programming|memoization)\b/i,
  greedy: /\bgreedy\b/i,
};

export function isTitleDisguisedForTarget(title: string, targetDomain: DomainId): boolean {
  const rx = REVEALING_TITLE_PATTERNS[targetDomain];
  return rx ? !rx.test(title) : true;
}

export type CatalogProblemRow = {
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  acRate: number;
  isPaidOnly: boolean;
  status?: "ac" | "notac" | null;
  topicTagSlugs: string[];
  resolvedDomain: DomainId;
  difficultyScore: number;
  signatureForced?: boolean;
  excluded: boolean;
};

function seededStringHash(str: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * F3, F10, F13: Deterministic local catalog filter over full resolvedDomain pool.
 * Orders by 20-pt distance buckets + seeded shuffle up to `limit` (default 15),
 * skips LeetCode `status === "ac"` except `allowCoachedRevisit` candidates when fresh pool < 3,
 * enforces `maxMinutes` via standardMinutes(D), and excludes `signatureForced` for Selection.
 */
export function selectCandidatesFromCache(
  catalog: CatalogProblemRow[],
  intent: PrescriptionIntent,
  opts: {
    isPremium?: boolean;
    excludedSlugs?: Set<string>;
    limit?: number;
    maxMinutes?: number;
    seed?: number;
    coachedRevisitSlugs?: Set<string>;
  } = {},
): CatalogProblemRow[] {
  const limit = opts.limit ?? 15;
  const maxMin = opts.maxMinutes;
  const isRevisitCandidate = (p: CatalogProblemRow) =>
    Boolean(intent.allowCoachedRevisit && opts.coachedRevisitSlugs?.has(p.slug));

  const baseFilter = (p: CatalogProblemRow, allowSolvedRevisit: boolean) => {
    if (p.excluded) return false;
    if (!opts.isPremium && p.isPaidOnly) return false;
    if (opts.excludedSlugs?.has(p.slug)) return false;
    if (p.status === "ac" && !(allowSolvedRevisit && isRevisitCandidate(p))) return false;
    if (p.resolvedDomain !== intent.targetDomain) return false;
    if (intent.targetFacet === "selection") {
      if (p.signatureForced ?? isSignatureForcedFromSlugs(p.topicTagSlugs)) return false;
      if (!isTitleDisguisedForTarget(p.title, intent.targetDomain)) return false;
    }
    return true;
  };

  let domainPool = catalog.filter((p) => baseFilter(p, false));
  if (domainPool.length < 3 && intent.allowCoachedRevisit && opts.coachedRevisitSlugs?.size) {
    const revisits = catalog.filter((p) => baseFilter(p, true));
    if (revisits.length > domainPool.length) domainPool = revisits;
  }

  let filtered = domainPool;
  if (intent.targetConceptSlug) {
    const spec = CONCEPT_CATALOGUE.find((c) => c.slug === intent.targetConceptSlug);
    if (spec) {
      const tagged = domainPool.filter((p) => p.topicTagSlugs.includes(spec.searchTagSlug));
      if (tagged.length > 0) filtered = tagged;
    }
  }
  if (maxMin !== undefined) {
    const timeFit = filtered.filter((p) => standardMinutes(p.difficultyScore) <= maxMin);
    if (timeFit.length > 0) filtered = timeFit;
  }

  const [lo, hi] = intent.targetDifficultyBand;
  let picked: CatalogProblemRow[];
  if (intent.preferEasy) {
    const easyInRange = filtered.filter(
      (p) => p.difficulty === "Easy" && p.difficultyScore >= lo - 40 && p.difficultyScore <= hi + 40,
    );
    picked =
      easyInRange.length > 0
        ? snapCandidatePool(easyInRange, intent.targetDifficultyBand)
        : snapCandidatePool(filtered, intent.targetDifficultyBand);
  } else {
    picked = snapCandidatePool(filtered, intent.targetDifficultyBand);
  }

  // F10: Order by 20-pt distance bucket from band midpoint + deterministic seeded shuffle
  const mid = (lo + hi) / 2;
  const seed = opts.seed ?? 42;
  picked.sort(
    (a, b) =>
      Math.floor(Math.abs(a.difficultyScore - mid) / 20) -
        Math.floor(Math.abs(b.difficultyScore - mid) / 20) ||
      seededStringHash(a.slug, seed) - seededStringHash(b.slug, seed),
  );
  return picked.slice(0, limit);
}

/**
 * F11 & F12: Multi-batch inspection escape hatch.
 * Accumulates failed inspections across disjoint batches, preserves allowedDomainPool,
 * recentDomain cooldowns, maxMinutes, and Easy Reinforcement band on rotation.
 */
export function selectShortlistWithInspectionEscapeHatch(args: {
  catalog: CatalogProblemRow[];
  intent: PrescriptionIntent;
  state: LearnerRatingState;
  day: number;
  inspectFn: (problem: CatalogProblemRow) => boolean;
  isPremium?: boolean;
  excludedSlugs?: Set<string>;
  preferences?: DirectorPreferences;
  allowedDomains?: DomainId[];
  batchSize?: number;
  maxInspectionsPerBatch?: number;
  maxTotalInspections?: number;
  seed?: number;
  coachedRevisitSlugs?: Set<string>;
}): {
  intent: PrescriptionIntent;
  chosen: CatalogProblemRow | null;
  strategy: "primary" | "batch-2" | "widened" | "rotated";
  inspectedSlugs: string[];
} {
  const validPrefs = args.preferences ? validateDirectorPreferences(args.preferences) : undefined;
  const rejected = new Set(args.excludedSlugs);
  const inspectedSlugs: string[] = [];
  const batchSize = args.batchSize ?? 15;
  const maxPerBatch = args.maxInspectionsPerBatch ?? 3;
  const maxTotal = args.maxTotalInspections ?? 6;
  const prevDom = args.state.lastPracticedDomain ?? args.state.recentDomains.at(-1) ?? null;
  const prescribedHistory = args.state.prescribedRecentDomains.length
    ? args.state.prescribedRecentDomains
    : args.state.recentDomains;

  const tryInspect = (
    curIntent: PrescriptionIntent,
    strategyLabel: "primary" | "batch-2" | "widened" | "rotated",
  ): CatalogProblemRow | null => {
    const batch = selectCandidatesFromCache(args.catalog, curIntent, {
      isPremium: args.isPremium,
      excludedSlugs: rejected,
      limit: batchSize,
      maxMinutes: validPrefs?.maxMinutes,
      seed: args.seed,
      coachedRevisitSlugs: args.coachedRevisitSlugs,
    });
    let batchInspections = 0;
    for (const cand of batch) {
      if (inspectedSlugs.length >= maxTotal || batchInspections >= maxPerBatch) break;
      inspectedSlugs.push(cand.slug);
      batchInspections += 1;
      if (args.inspectFn(cand)) return cand;
      rejected.add(cand.slug);
    }
    void strategyLabel;
    return null;
  };

  // Batch 1 & disjoint Batch 2 on primary intent
  const hit1 = tryInspect(args.intent, "primary");
  if (hit1) return { intent: args.intent, chosen: hit1, strategy: "primary", inspectedSlugs };
  if (inspectedSlugs.length < maxTotal) {
    const hit2 = tryInspect(args.intent, "batch-2");
    if (hit2) return { intent: args.intent, chosen: hit2, strategy: "batch-2", inspectedSlugs };
  }

  // Widened band ±60 in same domain before rotating
  const widenedIntent: PrescriptionIntent = {
    ...args.intent,
    targetDifficultyBand: [
      Math.max(800, args.intent.targetDifficultyBand[0] - 60),
      Math.min(1850, args.intent.targetDifficultyBand[1] + 60),
    ],
  };
  if (inspectedSlugs.length < maxTotal) {
    const hitWide = tryInspect(widenedIntent, "widened");
    if (hitWide) return { intent: widenedIntent, chosen: hitWide, strategy: "widened", inspectedSlugs };
  }

  // F12: Rotation MUST exhaust allowedDomains first (while honoring cooldowns & Easy band!), before broader fallback
  const isCooldownOk = (d: DomainId) =>
    d !== prevDom && prescribedHistory.slice(-6).filter((x) => x === d).length < 2;
  const muted = new Set(validPrefs?.mutedDomains ?? []);
  const requestedPool = (args.allowedDomains ?? []).filter((d) => d !== args.intent.targetDomain);
  const globalPool = DOMAINS.filter(
    (d) =>
      d !== args.intent.targetDomain &&
      !muted.has(d) &&
      args.state.globalMu >= (DOMAIN_MIN_GLOBAL_MU[d] ?? -Infinity),
  );
  const orderedRotation: DomainId[] = [
    ...requestedPool.filter(isCooldownOk),
    ...requestedPool.filter((d) => !isCooldownOk(d)),
    ...(args.allowedDomains?.length ? [] : globalPool.filter(isCooldownOk)),
  ];

  for (const dom of orderedRotation) {
    if (inspectedSlugs.length >= maxTotal) break;
    const isEasyReinf = args.intent.slotKind === "easy-reinforcement";
    const band = isEasyReinf
      ? bandForDomain(args.state, dom, "implementation", -210, -135)
      : args.intent.slotKind === "stretch"
        ? bandForDomain(args.state, dom, args.intent.targetFacet, 10, 65)
        : bandForDomain(args.state, dom, args.intent.targetFacet, -60, 40);
    const rotatedIntent: PrescriptionIntent = {
      ...args.intent,
      targetDomain: dom,
      targetConceptSlug: undefined,
      targetDifficultyBand: band,
      preferEasy: isEasyReinf,
      defaultTimeboxBand: defaultTimeboxBand(
        args.intent.slotKind,
        Math.round((band[0] + band[1]) / 2),
        { maxMinutes: validPrefs?.maxMinutes, clockGoal: args.intent.clockGoal },
      ),
    };
    const hitRot = tryInspect(rotatedIntent, "rotated");
    if (hitRot) return { intent: rotatedIntent, chosen: hitRot, strategy: "rotated", inspectedSlugs };
  }

  return { intent: args.intent, chosen: null, strategy: "primary", inspectedSlugs };
}

/** F14: Complete conversational steering with seeded random pools, >=3 domain Selection gate, stretch slot, and coach spoiler detection. */
export function didCoachLeakSelectionTarget(messages: string[], targetDomain: DomainId): boolean {
  const rx = REVEALING_TITLE_PATTERNS[targetDomain];
  if (!rx) return false;
  return messages.some((m) => rx.test(m));
}

export function adjustPrescriptionIntent(args: {
  state: LearnerRatingState;
  currentIntent: PrescriptionIntent;
  catalog: CatalogProblemRow[];
  isPremium: boolean;
  skippedSlugs: Set<string>;
  preferences?: DirectorPreferences;
  day: number;
  seed?: number;
  override: {
    domainOverride?: DomainId;
    domainPoolOverride?: DomainId[];
    slotOverride?: "easy-reinforcement" | "growth" | "consolidation" | "breadth" | "stretch";
    maxMinutes?: number;
    excludeSlug?: string;
  };
}): {
  intent: PrescriptionIntent;
  candidates: CatalogProblemRow[];
  strategy: "primary" | "batch-2" | "widened" | "rotated";
} {
  const validPrefs = args.preferences ? validateDirectorPreferences(args.preferences) : undefined;
  const muted = new Set(validPrefs?.mutedDomains ?? []);
  const excluded = new Set(args.skippedSlugs);
  if (args.override.excludeSlug) excluded.add(args.override.excludeSlug);

  let nextIntent: PrescriptionIntent = { ...args.currentIntent };
  const capMinutes = args.override.maxMinutes ?? validPrefs?.maxMinutes;

  if (args.override.slotOverride === "easy-reinforcement") {
    const eligible = DOMAINS.filter(
      (d) => !muted.has(d) && args.state.globalMu >= (DOMAIN_MIN_GLOBAL_MU[d] ?? -Infinity),
    );
    nextIntent = selectEasyReinforcementTarget(
      args.state,
      eligible.length ? eligible : [args.currentIntent.targetDomain],
      args.day,
      args.currentIntent.slotIndex,
      capMinutes,
    );
  } else if (args.override.slotOverride === "stretch") {
    nextIntent = {
      ...nextIntent,
      slotKind: "stretch",
      preferEasy: false,
      targetDifficultyBand: bandForDomain(
        args.state,
        nextIntent.targetDomain,
        nextIntent.targetFacet,
        10,
        65,
      ),
    };
  } else if (
    args.override.slotOverride === "growth" ||
    args.override.slotOverride === "consolidation" ||
    args.override.slotOverride === "breadth"
  ) {
    nextIntent = {
      ...nextIntent,
      slotKind: args.override.slotOverride,
      preferEasy: false,
      targetDifficultyBand: bandForDomain(
        args.state,
        nextIntent.targetDomain,
        nextIntent.targetFacet,
        args.override.slotOverride === "consolidation" ? -40 : -45,
        args.override.slotOverride === "consolidation" ? 5 : 10,
      ),
    };
  }

  let allowedDomains: DomainId[] | undefined;
  if (args.override.domainOverride) {
    const dom = args.override.domainOverride;
    const isMutedOrGated =
      muted.has(dom) || args.state.globalMu < (DOMAIN_MIN_GLOBAL_MU[dom] ?? -Infinity);
    allowedDomains = [dom];
    nextIntent = {
      ...nextIntent,
      targetDomain: dom,
      targetFacet: "implementation",
      steeredDomainExplicit: true,
      targetConceptSlug: undefined,
      targetDifficultyBand:
        nextIntent.slotKind === "easy-reinforcement"
          ? bandForDomain(args.state, dom, "implementation", -210, -135)
          : nextIntent.slotKind === "stretch"
            ? bandForDomain(args.state, dom, "implementation", 10, 65)
            : bandForDomain(args.state, dom, "implementation", -45, 10),
      ...(isMutedOrGated
        ? { overrideWarning: `Applied one-off practice on muted/gated domain (${dom}); saved preferences unchanged.` }
        : {}),
    };
  } else if (args.override.domainPoolOverride && args.override.domainPoolOverride.length >= 2) {
    const eligiblePool = [...new Set(args.override.domainPoolOverride)].filter((d) => !muted.has(d));
    const prev = args.state.lastPracticedDomain ?? args.state.recentDomains.at(-1);
    const nonPrev = eligiblePool.filter((d) => d !== prev);
    const pickFrom = nonPrev.length > 0 ? nonPrev : eligiblePool;
    const seed = args.seed ?? args.day * 31 + 7;
    const dom = pickFrom[seed % pickFrom.length] ?? nextIntent.targetDomain;
    allowedDomains = eligiblePool;
    // F14: Selection stays rated ONLY when >= 3 eligible domains are in the steering pool!
    const blindPool = eligiblePool.length >= 3;
    const facet = blindPool
      ? chooseTargetFacet(args.state, dom, nextIntent.slotKind)
      : "implementation";
    nextIntent = {
      ...nextIntent,
      targetDomain: dom,
      targetFacet: facet,
      steeredDomainExplicit: !blindPool,
      targetConceptSlug: undefined,
      targetDifficultyBand: bandForDomain(
        args.state,
        dom,
        facet,
        nextIntent.slotKind === "easy-reinforcement" ? -210 : nextIntent.slotKind === "stretch" ? 10 : -45,
        nextIntent.slotKind === "easy-reinforcement" ? -135 : nextIntent.slotKind === "stretch" ? 65 : 10,
      ),
    };
  }

  nextIntent.defaultTimeboxBand = defaultTimeboxBand(
    nextIntent.slotKind,
    Math.round((nextIntent.targetDifficultyBand[0] + nextIntent.targetDifficultyBand[1]) / 2),
    { maxMinutes: capMinutes, clockGoal: nextIntent.clockGoal },
  );

  const candidates = selectCandidatesFromCache(args.catalog, nextIntent, {
    isPremium: args.isPremium,
    excludedSlugs: excluded,
    limit: 15,
    maxMinutes: capMinutes,
    seed: args.seed,
  });
  if (candidates.length > 0) {
    return { intent: nextIntent, candidates, strategy: "primary" };
  }
  const escaped = selectShortlistWithInspectionEscapeHatch({
    catalog: args.catalog,
    intent: nextIntent,
    state: args.state,
    day: args.day,
    inspectFn: () => true,
    isPremium: args.isPremium,
    excludedSlugs: excluded,
    preferences: validPrefs,
    allowedDomains,
    seed: args.seed,
  });
  return {
    intent: escaped.intent,
    candidates: escaped.chosen ? [escaped.chosen] : [],
    strategy: escaped.strategy,
  };
}

/** F5, F15 & F19: Intent- and language-keyed prescription contextKey (no raw ledger cursor churn!). */
export function computePrescriptionContextKey(args: {
  intent: PrescriptionIntent;
  language: LanguageId;
  preferences?: DirectorPreferences;
  planningPreferenceRevisions?: string[];
  isPremium: boolean;
  skippedSlugs: string[];
}): string {
  return JSON.stringify({
    v: 9,
    language: args.language,
    isPremium: args.isPremium,
    slotIndex: args.intent.slotIndex,
    slotKind: args.intent.slotKind,
    targetDomain: args.intent.targetDomain,
    targetFacet: args.intent.targetFacet,
    targetConceptSlug: args.intent.targetConceptSlug ?? null,
    targetDifficultyBand: args.intent.targetDifficultyBand,
    focusDomains: args.preferences?.focusDomains ?? [],
    mutedDomains: args.preferences?.mutedDomains ?? [],
    maxMinutes: args.preferences?.maxMinutes ?? null,
    planningPreferenceRevisions: args.planningPreferenceRevisions ?? [],
    skippedSlugs: args.skippedSlugs,
  });
}

/** F5: Language-aware starter validation (Java & C++26 parity). */
export function validateInspectedStarter(
  rawProblem: { titleSlug: string; locked: boolean; javaStarter?: string | null; cppStarter?: string | null; content: string; systemdesign?: boolean },
  language: LanguageId,
): { available: boolean; starter?: string; reason?: string } {
  const starter = language === "cpp" ? rawProblem.cppStarter : rawProblem.javaStarter;
  if (rawProblem.locked || !starter || !rawProblem.content.trim() || rawProblem.systemdesign) {
    return { available: false, reason: `Locked or no ${language} starter.` };
  }
  return { available: true, starter };
}

/** F15: Explicit stale-prescription & launch provenance resolution (never silent unrated downgrade!). */
export type SavedPrescriptionRecord = {
  id: string;
  slug: string;
  language: LanguageId;
  createdAt: number;
  intent: PrescriptionIntent;
  contextKey: string;
};

export function resolveLaunchPrescription(args: {
  suppliedId?: string;
  savedById: Map<string, SavedPrescriptionRecord>;
  currentContextKey: string;
  slug: string;
  language: LanguageId;
  now: number;
}):
  | { mode: "practice-only"; rated: false }
  | { mode: "prescribed" | "prescribed-stale-honored"; rated: true; intent: PrescriptionIntent }
  | { mode: "conflict"; error: string } {
  if (!args.suppliedId) return { mode: "practice-only", rated: false };
  const rec = args.savedById.get(args.suppliedId);
  if (!rec || rec.slug !== args.slug || rec.language !== args.language) {
    return { mode: "conflict", error: "Prescription mismatch or missing. Refresh before starting." };
  }
  const ageMs = args.now - rec.createdAt;
  if (ageMs >= 48 * 3600_000) {
    return { mode: "conflict", error: "This recommendation expired (>48h). Refresh before starting." };
  }
  if (ageMs < 24 * 3600_000 && rec.contextKey === args.currentContextKey) {
    return { mode: "prescribed", rated: true, intent: rec.intent };
  }
  return { mode: "prescribed-stale-honored", rated: true, intent: rec.intent };
}

/** F19: Validate Planner JSON output contract & evidenceIds relaxation when intent exists. */
export function validatePlannerResult(args: {
  slug: string;
  reason: string;
  minutes: number;
  difficultyModifier: number;
  kind: "new-challenge" | "revisit";
  evidenceIds: string[];
  disguiseVerified: boolean;
  verifiedSlugs: Set<string>;
  suppliedEvidenceIds: Set<string>;
  intent: PrescriptionIntent;
}): boolean {
  if (!args.verifiedSlugs.has(args.slug)) return false;
  if (args.reason.trim().length < 20 || args.reason.length > 900) return false;
  if (args.minutes < 10 || args.minutes > 45) return false;
  if (args.difficultyModifier < -50 || args.difficultyModifier > 50) return false;
  if (args.intent.targetFacet === "selection" && !args.disguiseVerified) return false;
  if (args.evidenceIds.some((id) => !args.suppliedEvidenceIds.has(id))) return false;
  return true;
}

/** F19: "Choose another" skips 1–2 retain same domain/intent; skip 3 rotates domain without advancing prescribedCount. */
export function selectSkipOutcome(
  state: LearnerRatingState,
  currentIntent: PrescriptionIntent,
  skipCountForSlot: number,
  day: number,
  preferences?: DirectorPreferences,
): { rotateDomain: boolean; intent: PrescriptionIntent } {
  if (skipCountForSlot < 3) {
    return { rotateDomain: false, intent: currentIntent };
  }
  const tempState: LearnerRatingState = {
    ...state,
    recentDomains: [...state.recentDomains, currentIntent.targetDomain],
    prescribedRecentDomains: [...state.prescribedRecentDomains, currentIntent.targetDomain],
    lastPracticedDomain: currentIntent.targetDomain,
  };
  return { rotateDomain: true, intent: selectDirectorIntent(tempState, day, preferences) };
}

/** F18: Resumable workspace-level background catalog sync controller with backoff & Session-2 fallback. */
export class CatalogSyncManager {
  nextSkip = 0;
  totalNum: number | null = null;
  lastCompletedAt: number | null = null;
  consecutiveErrors = 0;
  backoffMs = 0;

  needsRefresh(now: number, ttlMs = 7 * 86400_000): boolean {
    return this.lastCompletedAt === null || now - this.lastCompletedAt >= ttlMs;
  }

  async step(
    fetchPage: (skip: number, limit: number) => Promise<{ totalNum: number; count: number }>,
    now: number,
  ): Promise<{ done: boolean; syncedCount: number }> {
    try {
      const page = await fetchPage(this.nextSkip, 100);
      this.totalNum = page.totalNum;
      this.nextSkip += page.count;
      this.consecutiveErrors = 0;
      this.backoffMs = 0;
      const done = page.count === 0 || this.nextSkip >= page.totalNum;
      if (done) {
        this.lastCompletedAt = now;
        this.nextSkip = 0;
      }
      return { done, syncedCount: page.count };
    } catch {
      this.consecutiveErrors += 1;
      this.backoffMs = Math.min(60_000, 1000 * 2 ** (this.consecutiveErrors - 1));
      return { done: false, syncedCount: 0 };
    }
  }
}

/**
 * F4: Single-flight + Atomic Claim-Owner Drain Coordinator (`maxJobAttempts = 3`: 1 run + 2 retries).
 * Joining callers share one in-flight drain; even concurrent workers use unique `claimOwnerId`
 * and never mark an already-graded attempt as failed.
 */
const activeDrains = new WeakMap<
  DatabaseSync,
  Promise<{ completedJobIds: string[]; failedJobIds: string[] }>
>();

export async function drainPendingRatingJobs(
  db: DatabaseSync,
  gradeFn: (attemptId: string, launchSeq: number) => Promise<AttemptGradedPayload>,
  opts: {
    maxJobAttempts?: number;
    maxAutoRetries?: number;
    forceRetryFailed?: boolean;
    now?: number;
    leaseMs?: number;
    bypassSingleFlight?: boolean;
  } = {},
): Promise<{ completedJobIds: string[]; failedJobIds: string[] }> {
  if (!opts.bypassSingleFlight) {
    const existing = activeDrains.get(db);
    if (existing) return existing;
  }

  const run = (async () => {
    const maxAttempts =
      opts.maxJobAttempts ?? (opts.maxAutoRetries !== undefined ? opts.maxAutoRetries : 3);
    const nowBase = opts.now ?? Date.now();
    const leaseMs = opts.leaseMs ?? 30_000;
    const ownerId = `drain-${Math.random().toString(36).slice(2)}-${nowBase}`;

    const candidateRows = db
      .prepare(
        `SELECT j.attemptId, j.status, j.attempts, l.launchSeq, l.day
         FROM rating_jobs j
         JOIN practice_launches l ON l.attemptId = j.attemptId
         WHERE j.status = 'pending'
            OR (j.status = 'running' AND (j.claimExpiresAt IS NULL OR j.claimExpiresAt <= ?))
            OR (j.status = 'failed' AND (j.attempts < ? OR ? = 1))
         ORDER BY l.launchSeq ASC`,
      )
      .all(nowBase, maxAttempts, opts.forceRetryFailed ? 1 : 0) as Array<{
      attemptId: string;
      status: string;
      attempts: number;
      launchSeq: number;
      day: number;
    }>;

    const completedJobIds: string[] = [];
    const failedJobIds: string[] = [];

    for (const row of candidateRows) {
      // Atomic claim before touching external grader
      const claimRes = db
        .prepare(
          `UPDATE rating_jobs
           SET status = 'running', attempts = attempts + 1, claimOwnerId = ?, claimExpiresAt = ?, updatedAt = ?
           WHERE attemptId = ?
             AND (
               status = 'pending'
               OR (status = 'running' AND (claimExpiresAt IS NULL OR claimExpiresAt <= ?))
               OR (status = 'failed' AND (attempts < ? OR ? = 1))
             )`,
        )
        .run(
          ownerId,
          nowBase + leaseMs,
          nowBase,
          row.attemptId,
          nowBase,
          maxAttempts,
          opts.forceRetryFailed ? 1 : 0,
        );
      if (claimRes.changes === 0) continue;

      let jobState = db
        .prepare("SELECT attempts, claimOwnerId FROM rating_jobs WHERE attemptId = ?")
        .get(row.attemptId) as { attempts: number; claimOwnerId: string | null } | undefined;
      if (!jobState || jobState.claimOwnerId !== ownerId) continue;

      let attempts = jobState.attempts;
      let done = false;
      while (!done) {
        try {
          const payload = await gradeFn(row.attemptId, row.launchSeq);
          const ownerCheck = db
            .prepare("SELECT claimOwnerId FROM rating_jobs WHERE attemptId = ?")
            .get(row.attemptId) as { claimOwnerId: string | null } | undefined;
          if (ownerCheck?.claimOwnerId !== ownerId) break;

          db.exec("BEGIN");
          try {
            db.prepare(
              "INSERT OR IGNORE INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson) VALUES (?, ?, ?, 'attempt-graded', ?, ?, ?, ?)",
            ).run(
              `ev:${row.attemptId}`,
              row.attemptId,
              row.launchSeq,
              `graded:${row.attemptId}`,
              row.day,
              nowBase + attempts,
              JSON.stringify(payload),
            );
            db.prepare(
              "UPDATE rating_jobs SET status = 'complete', lastError = NULL, claimOwnerId = NULL, claimExpiresAt = NULL, updatedAt = ? WHERE attemptId = ? AND claimOwnerId = ?",
            ).run(nowBase + attempts, row.attemptId, ownerId);
            db.exec("COMMIT");
            completedJobIds.push(row.attemptId);
            done = true;
          } catch (err) {
            db.exec("ROLLBACK");
            throw err;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const alreadyGraded = db
            .prepare("SELECT 1 FROM skill_rating_events WHERE attemptId = ? AND kind = 'attempt-graded'")
            .get(row.attemptId);
          if (alreadyGraded) {
            db.prepare(
              "UPDATE rating_jobs SET status = 'complete', lastError = NULL, claimOwnerId = NULL, claimExpiresAt = NULL, updatedAt = ? WHERE attemptId = ?",
            ).run(nowBase + attempts, row.attemptId);
            completedJobIds.push(row.attemptId);
            done = true;
            break;
          }
          if (attempts >= maxAttempts) {
            db.prepare(
              "UPDATE rating_jobs SET status = 'failed', lastError = ?, claimOwnerId = NULL, claimExpiresAt = NULL, updatedAt = ? WHERE attemptId = ? AND claimOwnerId = ?",
            ).run(msg.slice(0, 500), nowBase + attempts, row.attemptId, ownerId);
            failedJobIds.push(row.attemptId);
            break;
          }
          attempts += 1;
          db.prepare(
            "UPDATE rating_jobs SET attempts = ?, updatedAt = ? WHERE attemptId = ? AND claimOwnerId = ?",
          ).run(attempts, nowBase + attempts, row.attemptId, ownerId);
        }
      }
    }

    return { completedJobIds, failedJobIds };
  })();

  if (!opts.bypassSingleFlight) {
    activeDrains.set(db, run);
    run.finally(() => {
      if (activeDrains.get(db) === run) activeDrains.delete(db);
    });
  }
  return run;
}

/** F3: Extension bridge forwarding contract preserves tag, orderBy, and limit <= 100. */
export function forwardBridgeListParams(raw: Record<string, unknown>) {
  const num = (v: unknown, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : def;
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    skip: Math.max(0, Math.trunc(num(raw.skip, 0))),
    limit: Math.max(1, Math.min(100, Math.trunc(num(raw.limit, 30)))),
    search: str(raw.search),
    difficulty: str(raw.difficulty),
    tag: str(raw.tag),
    orderBy:
      raw.orderBy === "AC_RATE_DESC" || raw.orderBy === "AC_RATE_ASC"
        ? raw.orderBy
        : undefined,
  };
}

// ============================================================================
// Verification Test Suite
// ============================================================================

test("B1: overlapping Easy/Medium/Hard bands eliminate the 980-1080 dead canyon and snap empty bands", () => {
  // Easy spans [800, 1080], Medium spans [980, 1400], Hard spans [1340, 1800]
  assert.equal(problemBaseDifficulty("Easy", 85), 800);
  assert.equal(problemBaseDifficulty("Easy", 30), 1080);
  assert.equal(problemBaseDifficulty("Medium", 80), 980);
  assert.equal(problemBaseDifficulty("Medium", 68), 1072);
  assert.equal(problemBaseDifficulty("Medium", 25), 1400);
  assert.equal(problemBaseDifficulty("Hard", 70), 1340);
  assert.equal(problemBaseDifficulty("Hard", 20), 1800);

  // At starting theta=1000, Growth band [955, 1010] includes BOTH lower-AC Easies AND 75-80% AC Mediums!
  const med78 = problemBaseDifficulty("Medium", 78);
  assert.ok(med78 >= 955 && med78 <= 1010, `78% AC Medium (${med78}) lands inside [955, 1010]`);

  // Empty band snaps first to widened [lo-60, hi+60], then nearest 3
  const widenedPool = [
    { id: "m1", difficultyScore: 1070 },
    { id: "m2", difficultyScore: 1210 },
  ];
  assert.deepEqual(
    snapCandidatePool(widenedPool, [995, 1020]).map((x) => x.id),
    ["m1"],
  );
  const farPool = [
    { id: "f1", difficultyScore: 1150 },
    { id: "f2", difficultyScore: 1210 },
    { id: "f3", difficultyScore: 1280 },
    { id: "f4", difficultyScore: 1400 },
  ];
  assert.deepEqual(
    snapCandidatePool(farPool, [995, 1020]).map((x) => x.id),
    ["f1", "f2", "f3"],
  );
});

test("B2 & B3: total-order 53-slug resolver fixes misroutings and 24-concept catalogue handles uncoached probes", () => {
  assert.equal(TAG_PRIORITY_TABLE.length, 53);
  const ranks = new Set(TAG_PRIORITY_TABLE.map((t) => t.rank));
  assert.equal(ranks.size, 53);

  // P2 #7: Every primary query slug resolves cleanly alone and paired with container `array`
  for (const entry of TAG_PRIORITY_TABLE) {
    if (!entry.queryablePrimary) continue;
    assert.equal(
      resolvePrimaryDomainFromSlugs([entry.slug]),
      entry.domain,
      `Primary slug [${entry.slug}] must resolve to ${entry.domain}`,
    );
    assert.equal(
      resolvePrimaryDomainFromSlugs([entry.slug, "array"]),
      entry.domain,
      `Primary slug [${entry.slug}, array] must resolve to ${entry.domain}`,
    );
  }

  // Reviewer B2 cases:
  assert.equal(
    resolvePrimaryDomainFromSlugs(["array", "divide-and-conquer", "sorting", "heap-priority-queue", "quickselect"]),
    "heaps-ordered", // Kth Largest Element
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["array", "hash-table", "divide-and-conquer", "sorting", "heap-priority-queue", "bucket-sort", "counting"]),
    "heaps-ordered", // Top K Frequent Elements
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["linked-list", "divide-and-conquer", "heap-priority-queue", "merge-sort"]),
    "heaps-ordered", // Merge k Sorted Lists
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["array", "divide-and-conquer", "dynamic-programming"]),
    "dynamic-programming", // Maximum Subarray
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["array", "binary-search", "divide-and-conquer"]),
    "binary-search", // Median of Two Sorted Arrays
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["hash-table", "linked-list", "two-pointers"]),
    "stacks-queues-linked", // Linked List Cycle
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["linked-list", "two-pointers"]),
    "stacks-queues-linked", // Remove Nth Node From End
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["linked-list", "math", "recursion"]),
    "stacks-queues-linked", // Add Two Numbers
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["math", "recursion"]),
    "math-bitwise", // Pow(x, n)
  );
  assert.equal(
    resolvePrimaryDomainFromSlugs(["array", "two-pointers", "dynamic-programming", "stack", "monotonic-stack"]),
    "stacks-queues-linked", // Trapping Rain Water (via monotonic-stack)
  );
  assert.equal(resolvePrimaryDomainFromSlugs([]), "arrays-strings"); // Untagged fallback

  // B3 & Smaller #2/#3: 24 concepts reference valid domains/slugs, topological-sort unlocks at 1080,
  // uncoached probes cool down for 14d (90d after 2 probes unless applied/coached)
  assert.equal(CONCEPT_CATALOGUE.length, 24);
  for (const c of CONCEPT_CATALOGUE) {
    assert.ok(DOMAINS.includes(c.domain));
    assert.ok(SLUG_TO_ENTRY.has(c.searchTagSlug));
  }
  const topoSpec = CONCEPT_CATALOGUE.find((c) => c.slug === "topological-sort")!;
  assert.equal(topoSpec.minGlobalMu, 1080);
  assert.ok(expectedScore(1080, 1043) >= 0.55);

  const s = createInitialState();
  const intent1 = selectDirectorIntent(initWithStep(s, 1), 1);
  assert.equal(intent1.slotKind, "concept-probe");
  assert.equal(intent1.targetConceptSlug, "in-place-array-scan");
  updateConceptRecord(s, "in-place-array-scan", "arrays-strings", 1, "probed-uncoached");
  const intentNext = selectDirectorIntent(initWithStep(s, 1), 3);
  assert.notEqual(intentNext.targetConceptSlug, "in-place-array-scan");
  // Smaller #3: After 2 uncoached probes, probing pauses until day +90, unless applied/coached incidentally
  updateConceptRecord(s, "in-place-array-scan", "arrays-strings", 15, "probed-uncoached");
  assert.equal(s.concepts.get("in-place-array-scan")!.probeCount, 2);
  assert.notEqual(selectDirectorIntent(initWithStep(s, 1), 40).targetConceptSlug, "in-place-array-scan");
  updateConceptRecord(s, "in-place-array-scan", "arrays-strings", 40, "applied");
  assert.equal(s.concepts.get("in-place-array-scan")!.state, "applied");
  assert.equal(s.concepts.get("in-place-array-scan")!.stabilityDays, 12);
});

function initWithStep(s: LearnerRatingState, step: number): LearnerRatingState {
  s.prescribedCount = step;
  return s;
}

test("B4, B5, B6, B7: single base update, order-independence, Selection targeting, alternative-route safety, and neutral Big-O", () => {
  // B6: Updating impl alone vs impl+sel moves globalMu/globalSigma IDENTICALLY, and order does not matter
  const sOnlyImpl = createInitialState();
  applyAttemptGraded(sOnlyImpl, 1, [
    { domain: "hashing-prefix", facet: "implementation", weight: 1.0, difficulty: 950, score: 1.0 },
  ]);

  const sImplThenSel = createInitialState();
  applyAttemptGraded(sImplThenSel, 1, [
    { domain: "hashing-prefix", facet: "implementation", weight: 1.0, difficulty: 950, score: 1.0 },
    { domain: "hashing-prefix", facet: "selection", weight: 1.0, difficulty: 950, score: 1.0 },
  ]);

  const sSelThenImpl = createInitialState();
  applyAttemptGraded(sSelThenImpl, 1, [
    { domain: "hashing-prefix", facet: "selection", weight: 1.0, difficulty: 950, score: 1.0 },
    { domain: "hashing-prefix", facet: "implementation", weight: 1.0, difficulty: 950, score: 1.0 },
  ]);

  assert.equal(sOnlyImpl.globalMu, sImplThenSel.globalMu);
  assert.equal(sOnlyImpl.globalSigma, sImplThenSel.globalSigma);
  assert.equal(sImplThenSel.globalMu, sSelThenImpl.globalMu);
  assert.equal(
    sImplThenSel.domains["hashing-prefix"].implOffset,
    sSelThenImpl.domains["hashing-prefix"].implOffset,
  );
  assert.equal(
    sImplThenSel.domains["hashing-prefix"].selOffset,
    sSelThenImpl.domains["hashing-prefix"].selOffset,
  );

  // Steady-state global variance share at sigma floors (20^2 / (20^2 + 45^2)) is 16.5%, not 56%!
  const steadyShare = (20 * 20) / (20 * 20 + 45 * 45);
  assert.ok(Math.abs(steadyShare - 0.1649) < 0.001);

  // B5: Valid alternative optimal route never penalizes Selection or triggers a lapse
  const coachedRec: ConceptRecord = {
    slug: "hash-map-set",
    domain: "hashing-prefix",
    state: "coached",
    stabilityDays: 4,
    lastEvaluatedDay: 1,
    lastSuccessDay: 1,
    probeCount: 0,
    reps: 0,
    lapses: 0,
  };
  assert.deepEqual(
    evaluateMissedTargetSelection({ usedOptimalComplexity: true, targetConceptRecord: coachedRec }),
    { penalizeSelection: false, conceptOutcome: "none" },
  );
  assert.deepEqual(
    evaluateMissedTargetSelection({ usedOptimalComplexity: false, targetConceptRecord: coachedRec }),
    { penalizeSelection: true, conceptOutcome: "lapsed" },
  );

  // B7: separate time & space ComplexityBucket counts + explicit unsure display; skip-check-in requires familiarity tap
  const sBigO = createInitialState();
  applyAttemptGraded(
    sBigO,
    1,
    [{ domain: "binary-search", facet: "implementation", weight: 1.0, difficulty: 800, score: 1.0 }],
    { familiarity: "solved", statedComplexity: { time: "accurate", space: "inaccurate" } },
  );
  // Simulate skipping check-in with required familiarity tap ("revisit") -> sets both time & space to "unsure"
  applyAttemptGraded(
    sBigO,
    2,
    [{ domain: "hashing-prefix", facet: "implementation", weight: 1.0, difficulty: 900, score: 1.0 }],
    { familiarity: "revisit", statedComplexity: { time: "unsure", space: "unsure" } },
  );
  assert.ok(sBigO.globalMu + sBigO.domains["binary-search"].implOffset > 1000);
  assert.equal(formatComplexityStat(sBigO.complexityCalibration.time), "1 of 1 accurate, 1 unsure");
  assert.equal(formatComplexityStat(sBigO.complexityCalibration.space), "0 of 1 accurate, 1 unsure");

  // Gate checks (P1 #2): unsettled vs legacy/restored/complete vs deferred
  assert.deepEqual(
    nextAssessmentGate([{ id: "a1", phase: "review", sealed: true }]),
    { allowed: false, reason: "unsettled-checkin", blockingAttemptId: "a1" },
  );
  // Legacy/restored attempt with reflection messages and no intake is settled (never unsubmittably gated!)
  assert.equal(
    isCheckInSettled({ id: "legacy-open", phase: "review", sealed: true, hasIntake: false, reflectionMessageCount: 2 }),
    true,
  );
  assert.deepEqual(
    nextAssessmentGate([
      { id: "legacy-complete", phase: "complete", sealed: true, hasIntake: false, reflectionMessageCount: 0 },
      { id: "a1", phase: "review", sealed: true, hasIntake: true, coachingDeferred: true },
    ]),
    { allowed: true },
  );

  // P2 #3: Retry-safe idempotent grading applies attempt grade exactly once
  const sOnce = createInitialState();
  const gradedIds = new Set<string>();
  const firstRun = applyAttemptGradedOnce(
    sOnce,
    gradedIds,
    "attempt-retry-1",
    1,
    [{ domain: "hashing-prefix", facet: "implementation", weight: 1.0, difficulty: 920, score: 1.0 }],
    { prescribed: true, primaryDomain: "hashing-prefix" },
  );
  const snapshotAfterFirst = {
    globalMu: sOnce.globalMu,
    globalSigma: sOnce.globalSigma,
    implOffset: sOnce.domains["hashing-prefix"].implOffset,
    prescribedCount: sOnce.prescribedCount,
    recentLen: sOnce.recentDomains.length,
  };
  const retryRun = applyAttemptGradedOnce(
    sOnce,
    gradedIds,
    "attempt-retry-1",
    1,
    [{ domain: "hashing-prefix", facet: "implementation", weight: 1.0, difficulty: 920, score: 1.0 }],
    { prescribed: true, primaryDomain: "hashing-prefix" },
  );
  assert.equal(firstRun, true);
  assert.equal(retryRun, false);
  assert.equal(sOnce.globalMu, snapshotAfterFirst.globalMu);
  assert.equal(sOnce.globalSigma, snapshotAfterFirst.globalSigma);
  assert.equal(sOnce.domains["hashing-prefix"].implOffset, snapshotAfterFirst.implOffset);
  assert.equal(sOnce.prescribedCount, snapshotAfterFirst.prescribedCount);
  assert.equal(sOnce.recentDomains.length, snapshotAfterFirst.recentLen);

  // B4: Selection lag >= 35 triggers targetFacet="selection"
  const sLag = createInitialState();
  sLag.domains["heaps-ordered"].implOffset = 40;
  sLag.domains["heaps-ordered"].selOffset = -5;
  assert.equal(chooseTargetFacet(sLag, "heaps-ordered", "growth"), "selection");
});

test("P1 #1: weak onboarding (4 zero-score D=920 problems -> mu0=738.14) transitions cleanly into Stage 2", () => {
  const s = createInitialState();
  const stage1: DomainId[] = [
    "hashing-prefix",
    "two-pointers-window",
    "stacks-queues-linked",
    "binary-search",
  ];
  for (const [i, d] of stage1.entries()) {
    applyAttemptGraded(
      s,
      i + 1,
      [{ domain: d, facet: "implementation", weight: 1.0, difficulty: 920, score: 0.0 }],
      { prescribed: true, primaryDomain: d },
    );
  }
  assert.equal(Number(s.globalMu.toFixed(2)), 738.14);

  // Stage 2: 3 consecutive Director calls at theta ~738 must never throw, skip backtracking, clamp lo=800, and rotate domains
  const stage2: PrescriptionIntent[] = [];
  for (let i = 0; i < 3; i++) {
    const intent = selectDirectorIntent(s, 5 + i);
    stage2.push(intent);
    assert.notEqual(intent.targetDomain, "backtracking");
    assert.equal(intent.targetDifficultyBand[0], 800);
    assert.ok(intent.targetDifficultyBand[1] >= 830);
    assert.notEqual(intent.targetDomain, s.lastPracticedDomain ?? s.recentDomains.at(-1));
    assert.ok(s.prescribedRecentDomains.slice(-6).filter((x) => x === intent.targetDomain).length < 2);
    s.recentDomains.push(intent.targetDomain);
    s.prescribedRecentDomains.push(intent.targetDomain);
    s.lastPracticedDomain = intent.targetDomain;
    s.prescribedCount += 1;
  }
  assert.equal(stage2.length, 3);
});

test("§2 & §5 exact numbers: band probabilities, stability ladders, rusty threshold, 11-session replay, and 90-day convergence", () => {
  // 1. Exact expected-score ranges for bands
  const eAt = (delta: number) => Number(expectedScore(1000, 1000 + delta).toFixed(2));
  assert.deepEqual([eAt(-105), eAt(-55)], [0.68, 0.6]); // Momentum: 0.60–0.68
  assert.deepEqual([eAt(-45), eAt(10)], [0.58, 0.48]); // Growth: 0.48–0.58
  assert.deepEqual([eAt(10), eAt(65)], [0.48, 0.39]); // Stretch: 0.39–0.48

  // 2a. Exact Concept Stability ladder at continuous R_c = 0.88 (dt = (27/22) * S)
  const sExact = createInitialState();
  let exactDay = 0;
  updateConceptRecord(sExact, "union-find", "graphs-search", exactDay, "coached");
  const exactSteps: number[] = [Math.round(sExact.concepts.get("union-find")!.stabilityDays)];
  for (let i = 0; i < 5; i++) {
    const cur = sExact.concepts.get("union-find")!;
    exactDay += cur.stabilityDays * 9 * (1 / 0.88 - 1);
    updateConceptRecord(sExact, "union-find", "graphs-search", exactDay, "applied");
    exactSteps.push(Math.round(sExact.concepts.get("union-find")!.stabilityDays));
  }
  assert.deepEqual(exactSteps, [4, 14, 24, 42, 72, 125]);

  // 2b. Whole-day Concept Stability ladder (first integer day where R_c <= 0.88: ceil((27/22) * S))
  const sLadder = createInitialState();
  let day = 0;
  updateConceptRecord(sLadder, "union-find", "graphs-search", day, "coached");
  const steps: number[] = [Math.round(sLadder.concepts.get("union-find")!.stabilityDays)];
  for (let i = 0; i < 5; i++) {
    const cur = sLadder.concepts.get("union-find")!;
    day += Math.ceil(cur.stabilityDays * 9 * (1 / 0.88 - 1));
    updateConceptRecord(sLadder, "union-find", "graphs-search", day, "applied");
    steps.push(Math.round(sLadder.concepts.get("union-find")!.stabilityDays));
  }
  assert.deepEqual(steps, [4, 14, 25, 43, 76, 131]);

  // Same-day cram check (dt = 0.1d after S=14d)
  const sCram = createInitialState();
  updateConceptRecord(sCram, "union-find", "graphs-search", 0, "coached");
  updateConceptRecord(sCram, "union-find", "graphs-search", 5, "applied"); // S = 14
  updateConceptRecord(sCram, "union-find", "graphs-search", 5.1, "applied");
  assert.equal(Number(sCram.concepts.get("union-find")!.stabilityDays.toFixed(2)), 14.03);

  // P2 #5: Lapses NEVER increase stability (coached 4d -> 2d; applied 14d -> 3.5d; consolidated 120d -> 10d cap)
  const sLapse = createInitialState();
  updateConceptRecord(sLapse, "union-find", "graphs-search", 0, "coached");
  assert.equal(sLapse.concepts.get("union-find")!.stabilityDays, 4);
  updateConceptRecord(sLapse, "union-find", "graphs-search", 5, "lapsed");
  assert.equal(sLapse.concepts.get("union-find")!.stabilityDays, 2);
  assert.equal(sLapse.concepts.get("union-find")!.lastEvaluatedDay, 5);
  assert.equal(sLapse.concepts.get("union-find")!.lastSuccessDay, 0);
  // Next due day from 2d is ceil((27/22)*2) = 3 days (down from 5 days at S=4d)
  assert.equal(Math.ceil(2 * 9 * (1 / 0.88 - 1)), 3);

  updateConceptRecord(sLapse, "top-k-priority-queue", "heaps-ordered", 0, "coached");
  updateConceptRecord(sLapse, "top-k-priority-queue", "heaps-ordered", 5, "applied"); // 14d
  updateConceptRecord(sLapse, "top-k-priority-queue", "heaps-ordered", 25, "lapsed");
  assert.equal(sLapse.concepts.get("top-k-priority-queue")!.stabilityDays, 3.5);

  const sLapseHigh = createInitialState();
  sLapseHigh.concepts.set("tree-dfs-recursion", {
    slug: "tree-dfs-recursion",
    domain: "trees-recursion",
    state: "applied",
    stabilityDays: 120,
    lastEvaluatedDay: 100,
    lastSuccessDay: 100,
    probeCount: 0,
    reps: 5,
    lapses: 0,
  });
  updateConceptRecord(sLapseHigh, "tree-dfs-recursion", "trees-recursion", 200, "lapsed");
  assert.equal(sLapseHigh.concepts.get("tree-dfs-recursion")!.stabilityDays, 10);

  // 3. Rusty badge fires at exactly 45 idle days and deducts 21–30 pts on a 120-day hiatus
  const sRust = createInitialState();
  sRust.globalMu = 1200;
  sRust.domains["graphs-search"].implOffset = 60;
  sRust.domains["graphs-search"].implSigma = 65;
  sRust.domains["graphs-search"].implFreshSigma = 65;
  sRust.domains["graphs-search"].lastDay = 10;
  assert.equal(displayRating(sRust, "graphs-search", "implementation", 54).rusty, false);
  assert.equal(displayRating(sRust, "graphs-search", "implementation", 55).rusty, true);
  const after120 = displayRating(sRust, "graphs-search", "implementation", 130);
  assert.equal(Math.round(after120.latent - after120.display), 26);

  // 4. Replay of the 11 Oct–Nov sessions (hand-attributed post-calibration Stage-2 fixture using strictly valid §2.3 rubric scores)
  const sHist = createInitialState();
  const realSessions: Array<{
    day: number;
    fam: "new" | "revisit" | "solved";
    updates: DomainFacetUpdate[];
    concept: [string, DomainId, "coached" | "applied" | "lapsed"];
  }> = [
    { day: 1, fam: "new", updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 920, score: 0.4 }], concept: ["prefix-sum-map", "hashing-prefix", "coached"] },
    { day: 2, fam: "solved", updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 850, score: 1.0 }, { domain: "hashing-prefix", facet: "selection", weight: 1, difficulty: 850, score: 1.0 }], concept: ["hash-map-set", "hashing-prefix", "applied"] },
    { day: 2, fam: "new", updates: [{ domain: "binary-search", facet: "implementation", weight: 1, difficulty: 960, score: 1.0 }], concept: ["binary-search-index", "binary-search", "applied"] },
    { day: 2, fam: "solved", updates: [{ domain: "stacks-queues-linked", facet: "implementation", weight: 1, difficulty: 860, score: 0.8 }], concept: ["lifo-fifo-state", "stacks-queues-linked", "applied"] },
    { day: 2, fam: "new", updates: [{ domain: "stacks-queues-linked", facet: "implementation", weight: 1, difficulty: 880, score: 0.4 }], concept: ["linked-list-pointers", "stacks-queues-linked", "coached"] },
    { day: 2, fam: "new", updates: [{ domain: "sorting-intervals", facet: "implementation", weight: 1, difficulty: 1120, score: 0.4 }], concept: ["custom-comparator-intervals", "sorting-intervals", "coached"] },
    { day: 3, fam: "new", updates: [{ domain: "binary-search", facet: "implementation", weight: 1, difficulty: 1220, score: 0.4 }, { domain: "binary-search", facet: "selection", weight: 1, difficulty: 1220, score: 0.35 }], concept: ["binary-search-index", "binary-search", "lapsed"] },
    { day: 4, fam: "new", updates: [{ domain: "two-pointers-window", facet: "implementation", weight: 1, difficulty: 1180, score: 0.4 }, { domain: "two-pointers-window", facet: "selection", weight: 1, difficulty: 1180, score: 0.75 }], concept: ["variable-sliding-window", "two-pointers-window", "coached"] },
    { day: 5, fam: "new", updates: [{ domain: "graphs-search", facet: "implementation", weight: 1, difficulty: 1140, score: 1.0 }, { domain: "graphs-search", facet: "selection", weight: 1, difficulty: 1140, score: 1.0 }], concept: ["grid-graph-bfs-dfs", "graphs-search", "applied"] },
    { day: 29, fam: "new", updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 920, score: 1.0 }, { domain: "hashing-prefix", facet: "selection", weight: 1, difficulty: 920, score: 1.0 }], concept: ["hash-map-set", "hashing-prefix", "applied"] },
    { day: 29, fam: "new", updates: [{ domain: "heaps-ordered", facet: "implementation", weight: 0.5, difficulty: 900, score: 0.35 }, { domain: "two-pointers-window", facet: "selection", weight: 0.5, difficulty: 900, score: 0.35 }], concept: ["converging-two-pointers", "two-pointers-window", "coached"] },
  ];
  for (const s of realSessions) {
    for (const u of s.updates) {
      assert.ok(VALID_RUBRIC_SCORES.has(u.score), `Invalid non-rubric fixture score ${u.score}`);
    }
    applyAttemptGraded(sHist, s.day, s.updates, { familiarity: s.fam, prescribed: false });
    updateConceptRecord(sHist, s.concept[0], s.concept[1], s.day, s.concept[2]);
  }
  assert.equal(sHist.prescribedCount, 0);

  const replaySnapshot = {
    global: `${Math.round(sHist.globalMu)}±${Math.round(sHist.globalSigma)}`,
    domains: Object.fromEntries(
      (["graphs-search", "hashing-prefix", "binary-search", "two-pointers-window", "sorting-intervals", "stacks-queues-linked", "heaps-ordered"] as const).map(
        (d) => [
          d,
          {
            impl: Math.round(sHist.globalMu + sHist.domains[d].implOffset),
            implSigma: Math.round(sHist.domains[d].implSigma),
            sel: Math.round(sHist.globalMu + sHist.domains[d].selOffset),
          },
        ],
      ),
    ),
  };

  // Post-calibration entry (5 prescribed completed, entering Slot 0 of Stage-2 Director via selectNextIntent!)
  sHist.prescribedCount = 5;
  sHist.prescribedGradedCount = 5;
  const next5: PrescriptionIntent[] = [];
  for (let i = 0; i < 5; i++) {
    const intent = selectNextIntent(sHist, 34 + i);
    next5.push(intent);
    sHist.recentDomains.push(intent.targetDomain);
    sHist.prescribedRecentDomains.push(intent.targetDomain);
    sHist.lastPracticedDomain = intent.targetDomain;
    sHist.prescribedCount += 1;
    if (intent.targetConceptSlug) {
      updateConceptRecord(sHist, intent.targetConceptSlug, intent.targetDomain, 34 + i, "applied", {
        fromEasyReinforcement: intent.slotKind === "easy-reinforcement",
      });
    }
  }
  // Verify zero consecutive domain repeats and <= 2 occurrences in any rolling 6-attempt window
  for (let i = 1; i < next5.length; i++) {
    assert.notEqual(next5[i].targetDomain, next5[i - 1].targetDomain);
  }

  const fourCleanEasiesGlobal = (() => {
    const s4 = createInitialState();
    for (const [i, d] of (["hashing-prefix", "two-pointers-window", "stacks-queues-linked", "binary-search"] as const).entries()) {
      applyAttemptGraded(s4, i + 1, [
        { domain: d, facet: "implementation", weight: 1, difficulty: 920, score: 1 },
        { domain: d, facet: "selection", weight: 1, difficulty: 920, score: 1 },
      ]);
    }
    return `${Math.round(s4.globalMu)}±${Math.round(s4.globalSigma)}`;
  })();

  const formattedNext5 = next5.map(
    (x) =>
      `${x.slotIndex}:${x.slotKind}:${x.targetDomain}(${x.targetFacet})${x.targetConceptSlug ? `:${x.targetConceptSlug}` : ""}@${x.targetDifficultyBand[0]}-${x.targetDifficultyBand[1]}`,
  );

  // Strict assertions guarding every published §4/§5 v8 number against silent regressions
  assert.equal(fourCleanEasiesGlobal, "1167±146");
  assert.deepEqual(replaySnapshot, {
    global: "1077±112",
    domains: {
      "graphs-search": { impl: 1121, implSigma: 107, sel: 1121 },
      "hashing-prefix": { impl: 1088, implSigma: 107, sel: 1099 },
      "binary-search": { impl: 1116, implSigma: 106, sel: 1089 },
      "two-pointers-window": { impl: 1087, implSigma: 108, sel: 1092 },
      "sorting-intervals": { impl: 1084, implSigma: 108, sel: 1077 },
      "stacks-queues-linked": { impl: 1055, implSigma: 108, sel: 1077 },
      "heaps-ordered": { impl: 1059, implSigma: 109, sel: 1077 },
    },
  });
  assert.deepEqual(formattedNext5, [
    "0:growth:stacks-queues-linked(selection)@1032-1087",
    "1:breadth:arrays-strings(implementation)@1032-1087",
    "2:consolidation:binary-search(implementation):binary-search-index@1076-1121",
    "3:consolidation:hashing-prefix(implementation):prefix-sum-map@1048-1093",
    "4:easy-reinforcement:sorting-intervals(implementation):custom-comparator-intervals@874-949",
  ]);
});

// ============================================================================
// v7 Review Resolution Tests (F1–F12, D1, Smaller Issues)
// ============================================================================

test("F1 & F5: launch-sequence replay is invariant to worker order and pending grades advance Director slots", () => {
  // Base historical launch on day 0 that coached prefix-sum-map (S = 4d)
  const launches: PracticeLaunchRow[] = [
    { attemptId: "a0", launchSeq: 1, day: 0, prescribed: false, provisionalDomain: "hashing-prefix" },
    { attemptId: "a1", launchSeq: 2, day: 1, prescribed: true, provisionalDomain: "hashing-prefix", intent: { slotIndex: 0, slotKind: "growth", targetDomain: "hashing-prefix", targetFacet: "implementation", targetConceptSlug: "prefix-sum-map", targetDifficultyBand: [955, 1010] } },
    { attemptId: "a2", launchSeq: 3, day: 2, prescribed: true, provisionalDomain: "two-pointers-window", intent: { slotIndex: 1, slotKind: "breadth", targetDomain: "two-pointers-window", targetFacet: "implementation", targetDifficultyBand: [955, 1010] } },
  ];

  const evA0Concept: SkillRatingEventRow = {
    id: "e0", attemptId: "a0", launchSeq: 1, kind: "concept-event", idempotencyKey: "c:a0", occurredDay: 0, createdAt: 100,
    payload: { slug: "prefix-sum-map", domain: "hashing-prefix", outcome: "coached" },
  };
  const evA1Graded: SkillRatingEventRow = {
    id: "e1", attemptId: "a1", launchSeq: 2, kind: "attempt-graded", idempotencyKey: "g:a1", occurredDay: 1, createdAt: 200,
    payload: {
      updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 960, score: 0.4 }],
      familiarity: "new",
      primaryDomain: "hashing-prefix",
      conceptOutcomes: [{ slug: "prefix-sum-map", domain: "hashing-prefix", outcome: "lapsed" }],
    },
  };
  const evA1Rescue: SkillRatingEventRow = {
    id: "e2", attemptId: "a1", launchSeq: 2, kind: "reflection-rescue", idempotencyKey: "r:a1", occurredDay: 1, createdAt: 250,
    payload: { scoreDelta: 0.15, coachedConcepts: [{ slug: "prefix-sum-map", domain: "hashing-prefix" }] },
  };
  const evA2Graded: SkillRatingEventRow = {
    id: "e3", attemptId: "a2", launchSeq: 3, kind: "attempt-graded", idempotencyKey: "g:a2", occurredDay: 2, createdAt: 150, // Worker finished BEFORE a1!
    payload: {
      updates: [{ domain: "two-pointers-window", facet: "implementation", weight: 1, difficulty: 980, score: 1.0 }],
      familiarity: "new",
      primaryDomain: "two-pointers-window",
    },
  };

  const forward = replayRatingLedger(launches, [evA0Concept, evA1Graded, evA1Rescue, evA2Graded]);
  const reversed = replayRatingLedger(
    [launches[2], launches[0], launches[1]],
    [evA2Graded, evA1Rescue, evA1Graded, evA0Concept],
  );
  assert.deepEqual(forward, reversed);
  assert.equal(forward.globalLastDay, 2);
  assert.equal(forward.prescribedCount, 2);
  // Lapsed from 4d -> 2d, then same-day repeat coached capped at min(2, 4) = 2d
  assert.equal(forward.concepts.get("prefix-sum-map")!.stabilityDays, 2);
  assert.equal(forward.concepts.get("prefix-sum-map")!.lapses, 1);

  // F5: Pending grade (no attempt-graded yet for p1) advances slot & applies provisional cooldown immediately
  const pendingLaunchOnly: PracticeLaunchRow[] = [
    { attemptId: "p1", launchSeq: 1, day: 1, prescribed: true, provisionalDomain: "arrays-strings" },
  ];
  const pendingState = replayRatingLedger(pendingLaunchOnly, []);
  assert.equal(pendingState.prescribedCount, 1);
  assert.deepEqual(pendingState.recentDomains, ["arrays-strings"]);
  const nextIntent = selectDirectorIntent(pendingState, 2);
  assert.equal(nextIntent.slotIndex, 1); // NEVER repeats Slot 0!
  assert.notEqual(nextIntent.targetDomain, "arrays-strings");

  // Once p1 finishes grading later, prescribedCount stays 1 (no double increment!)
  const settledState = replayRatingLedger(pendingLaunchOnly, [
    {
      id: "gp1", attemptId: "p1", launchSeq: 1, kind: "attempt-graded", idempotencyKey: "g:p1", occurredDay: 1, createdAt: 300,
      payload: {
        updates: [{ domain: "arrays-strings", facet: "implementation", weight: 1, difficulty: 920, score: 1.0 }],
        familiarity: "new",
        primaryDomain: "arrays-strings",
      },
    },
  ]);
  assert.equal(settledState.prescribedCount, 1);
  assert.deepEqual(settledState.recentDomains, ["arrays-strings"]);
});

test("F2 & F4: check-in action state matrix and server-side complete bypass guard", () => {
  const freshSealed: GateAttemptSummary = {
    id: "sealed-new",
    phase: "review",
    sealed: true,
    hasIntake: false,
    reflectionMessageCount: 0,
  };
  // F2: Toolbar "Skip reflection" and API complete MUST reject unsettled fresh attempt
  assert.equal(isCheckInSettled(freshSealed), false);
  assert.equal(canTransitionToComplete(freshSealed), false);
  assert.deepEqual(nextAssessmentGate([freshSealed]), {
    allowed: false,
    reason: "unsettled-checkin",
    blockingAttemptId: "sealed-new",
  });

  // Legacy attempt with existing messages retains legacy exemption
  const legacyAttempt: GateAttemptSummary = {
    id: "legacy-msg",
    phase: "review",
    sealed: true,
    hasIntake: false,
    reflectionMessageCount: 2,
  };
  assert.equal(isCheckInSettled(legacyAttempt), true);
  assert.equal(canTransitionToComplete(legacyAttempt), true);

  // Explicit familiarity required (no preselected "new")
  assert.throws(() => applyCheckInAction(freshSealed, "skip-checkin", { now: 100 }));

  const c1 = applyCheckInAction(freshSealed, "continue-coaching", {
    familiarity: "new", timeComplexity: "accurate", spaceComplexity: "unsure", now: 101,
  });
  assert.equal(c1.attempt.phase, "review");
  assert.equal(c1.attempt.coachingDeferred, false);
  assert.equal(c1.ratingJob.status, "pending");
  assert.equal(isCheckInSettled(c1.attempt), true);
  assert.equal(canTransitionToComplete(c1.attempt), true);
  assert.deepEqual(nextAssessmentGate([c1.attempt]), {
    allowed: false,
    reason: "active-coaching",
    blockingAttemptId: "sealed-new",
  });

  const c2 = applyCheckInAction(freshSealed, "defer-coaching", {
    familiarity: "revisit", timeComplexity: "inaccurate", spaceComplexity: "accurate", now: 102,
  });
  assert.equal(c2.attempt.phase, "review");
  assert.equal(c2.attempt.coachingDeferred, true);
  assert.equal(c2.ratingJob.status, "pending");
  assert.deepEqual(nextAssessmentGate([c2.attempt]), { allowed: true });

  const c3 = applyCheckInAction(freshSealed, "skip-coaching", {
    familiarity: "solved", timeComplexity: "accurate", spaceComplexity: "accurate", now: 103,
  });
  assert.equal(c3.attempt.phase, "complete");
  assert.equal(c3.ratingJob.status, "pending");
  assert.deepEqual(nextAssessmentGate([c3.attempt]), { allowed: true });

  // F4: 1-tap Skip check-in MUST unblock start gate AND set time/space = "unsure"
  const c4 = applyCheckInAction(freshSealed, "skip-checkin", {
    familiarity: "new", timeComplexity: "accurate", spaceComplexity: "accurate", now: 104,
  });
  assert.equal(c4.attempt.phase, "complete");
  assert.equal(c4.attempt.checkInSkippedAt, 104);
  assert.deepEqual(c4.complexity, { time: "unsure", space: "unsure" });
  assert.equal(c4.ratingJob.status, "pending");
  assert.deepEqual(nextAssessmentGate([c4.attempt]), { allowed: true });
});

test("F6 & F7: SQLite partial unique index allows multiple corrections and snapshot round-trips graded + pending state", () => {
  const srcDb = new DatabaseSync(":memory:");
  createRatingSchema(srcDb);

  srcDb
    .prepare("INSERT INTO practice_launches(attemptId, launchSeq, day, prescribed, rated, provisionalDomain, intentJson, selectionSpoilerRevealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("a1", 1, 1, 1, 1, "hashing-prefix", null, 0);
  srcDb
    .prepare("INSERT INTO practice_launches(attemptId, launchSeq, day, prescribed, rated, provisionalDomain, intentJson, selectionSpoilerRevealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("a2", 2, 2, 1, 1, "graphs-search", null, 0);
  srcDb
    .prepare("INSERT INTO rating_jobs(attemptId, status, attempts, lastError, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run("a1", "complete", 1, null, 1000);
  srcDb
    .prepare("INSERT INTO rating_jobs(attemptId, status, attempts, lastError, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run("a2", "running", 1, null, 1100);

  const insEv = srcDb.prepare(
    "INSERT INTO skill_rating_events(id, attemptId, launchSeq, kind, idempotencyKey, occurredDay, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const gradedPayload: AttemptGradedPayload = {
    updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 940, score: 1.0 }],
    familiarity: "new",
    primaryDomain: "hashing-prefix",
  };
  insEv.run("ev1", "a1", 1, "attempt-graded", "graded:a1", 1, 1000, JSON.stringify(gradedPayload));

  // Partial unique index rejects duplicate attempt-graded even with a different idempotencyKey
  assert.throws(() => {
    insEv.run("ev1-dup", "a1", 1, "attempt-graded", "graded:a1:retry", 1, 1001, JSON.stringify(gradedPayload));
  });

  // F6: Multiple compensating-recompute corrections for the SAME attemptId succeed!
  insEv.run("ev2", "a1", 1, "compensating-recompute", "compensate:a1:rev1", 1, 1050, JSON.stringify({ familiarity: "revisit" }));
  insEv.run("ev3", "a1", 1, "compensating-recompute", "compensate:a1:rev2", 1, 1060, JSON.stringify({ familiarity: "solved" }));
  assert.throws(() => {
    insEv.run("ev3-dup", "a1", 1, "compensating-recompute", "compensate:a1:rev2", 1, 1061, JSON.stringify({ familiarity: "solved" }));
  });

  // F7: Snapshot export + restore into fresh SQLite DB preserves both graded + pending attempts
  const snap = exportRatingSnapshot(srcDb);
  const dstDb = new DatabaseSync(":memory:");
  createRatingSchema(dstDb);
  restoreRatingSnapshot(dstDb, snap);
  const restoredSnap = exportRatingSnapshot(dstDb);

  assert.equal(restoredSnap.launches.length, 2);
  assert.equal(restoredSnap.ratingEvents.length, 3);
  assert.equal(restoredSnap.ratingJobs.length, 2);
  // Active "running" job restores safely as "pending" so it can be re-dispatched
  assert.equal(restoredSnap.ratingJobs.find((j) => j.attemptId === "a2")!.status, "pending");

  const srcReplayed = replayRatingLedger(snap.launches, snap.ratingEvents);
  const dstReplayed = replayRatingLedger(restoredSnap.launches, restoredSnap.ratingEvents);
  assert.deepEqual(dstReplayed, srcReplayed);
  // Restored familiarity === "solved" dampening from rev2 is reflected cleanly
  assert.ok(dstReplayed.globalMu < 1060);
  // Pending a2 preserves slot advance -> slotIndex 2!
  assert.equal(selectDirectorIntent(dstReplayed, 3).slotIndex, 2);
});

test("F3, F8 & Smaller #1: local catalog cache filters resolvedDomain, enforces disguise, forwards bridge params, and overrides classics", () => {
  // Smaller #1: All 11 classic misrouted problems resolve via CANONICAL_PROBLEM_OVERRIDES
  const canonicalChecks: Array<[string, string[], DomainId]> = [
    ["contains-duplicate", ["array", "hash-table", "sorting"], "hashing-prefix"],
    ["valid-anagram", ["hash-table", "string", "sorting"], "hashing-prefix"],
    ["group-anagrams", ["array", "hash-table", "string", "sorting"], "hashing-prefix"],
    ["coin-change", ["array", "dynamic-programming", "breadth-first-search"], "dynamic-programming"],
    ["perfect-squares", ["math", "dynamic-programming", "breadth-first-search"], "dynamic-programming"],
    ["word-break", ["array", "hash-table", "string", "dynamic-programming", "trie"], "dynamic-programming"],
    ["longest-common-prefix", ["string", "trie"], "arrays-strings"],
    ["longest-consecutive-sequence", ["array", "hash-table", "union-find"], "hashing-prefix"],
    ["two-sum-ii-input-array-is-sorted", ["array", "two-pointers", "binary-search"], "two-pointers-window"],
    ["longest-increasing-subsequence", ["array", "binary-search", "dynamic-programming"], "dynamic-programming"],
    ["container-with-most-water", ["array", "two-pointers", "greedy"], "two-pointers-window"],
  ];
  for (const [slug, tags, expected] of canonicalChecks) {
    assert.equal(resolvePrimaryDomain(slug, tags), expected, `${slug} override`);
  }

  // F8: Title disguise rejects revealing titles on Selection targets only
  assert.equal(isTitleDisguisedForTarget("Binary Search", "binary-search"), false);
  assert.equal(isTitleDisguisedForTarget("Koko Eating Bananas", "binary-search"), true);
  assert.equal(isTitleDisguisedForTarget("Sliding Window Maximum", "two-pointers-window"), false);
  assert.equal(isTitleDisguisedForTarget("Minimum Size Subarray Sum", "two-pointers-window"), true);

  // F3: Bridge forwards tag & orderBy + caps limit at 100 for local catalog sync
  assert.deepEqual(
    forwardBridgeListParams({ skip: 100, limit: 150, difficulty: "Medium", tag: "array", orderBy: "AC_RATE_DESC" }),
    { skip: 100, limit: 100, search: undefined, difficulty: "Medium", tag: "array", orderBy: "AC_RATE_DESC" },
  );

  const makeRow = (
    slug: string,
    title: string,
    difficulty: "Easy" | "Medium" | "Hard",
    acRate: number,
    tags: string[],
    opts: { paid?: boolean; excluded?: boolean } = {},
  ): CatalogProblemRow => ({
    slug,
    title,
    difficulty,
    acRate,
    isPaidOnly: Boolean(opts.paid),
    topicTagSlugs: tags,
    resolvedDomain: resolvePrimaryDomain(slug, tags),
    difficultyScore: problemBaseDifficulty(difficulty, acRate),
    excluded: Boolean(opts.excluded),
  });

  const catalog: CatalogProblemRow[] = [
    makeRow("binary-search", "Binary Search", "Easy", 58, ["array", "binary-search"]), // Score ~937
    makeRow("search-insert", "Search Insert Position", "Easy", 47, ["array", "binary-search"]), // Score ~993
    makeRow("koko-eating-bananas", "Koko Eating Bananas", "Medium", 66, ["array", "binary-search"]), // Score ~1087
    makeRow("find-peak-element", "Find Peak Element", "Medium", 69, ["array", "binary-search"]), // Score ~1064
    makeRow("paid-bs", "Secret Peak", "Medium", 69, ["array", "binary-search"], { paid: true }),
    // Misleading "array" tag that resolves to hashing-prefix, NOT arrays-strings
    makeRow("group-anagrams", "Group Anagrams", "Medium", 70, ["array", "hash-table", "sorting"]),
    makeRow("spiral-matrix", "Spiral Matrix", "Medium", 68, ["array", "matrix", "simulation"]), // Score ~1072 -> arrays-strings!
  ];

  // Selection intent for binary-search @ [1043, 1098] rejects "Binary Search", excludes paid, returns disguised in-band!
  const bsSel = selectCandidatesFromCache(catalog, {
    slotIndex: 0,
    slotKind: "growth",
    targetDomain: "binary-search",
    targetFacet: "selection",
    targetDifficultyBand: [1043, 1098],
  });
  assert.deepEqual(
    bsSel.map((c) => c.slug),
    ["koko-eating-bananas", "find-peak-element"],
  );

  // Full-pool snap on Selection STILL rejects revealing title "Binary Search" while allowing "search-insert" if far band,
  // whereas Implementation allows "Binary Search"!
  const implLow = selectCandidatesFromCache(catalog, {
    slotIndex: 0,
    slotKind: "growth",
    targetDomain: "binary-search",
    targetFacet: "implementation",
    targetDifficultyBand: [920, 960],
  });
  assert.deepEqual(implLow.map((c) => c.slug), ["binary-search"]);

  // arrays-strings query excludes group-anagrams (resolvedDomain = hashing-prefix) and returns spiral-matrix
  const arrSel = selectCandidatesFromCache(catalog, {
    slotIndex: 1,
    slotKind: "breadth",
    targetDomain: "arrays-strings",
    targetFacet: "implementation",
    targetDifficultyBand: [1043, 1098],
  });
  assert.deepEqual(arrSel.map((c) => c.slug), ["spiral-matrix"]);
});

test("F10 & F11: failed reviews lapse learned concepts, repeat coaching never refreshes, and §3.2 covers domain-level Selection", () => {
  // F10: Applied -> Rubric Row 5/7 yields lapsed (25d -> 6.25d); subsequent coached keeps stability at 6.25d!
  const s = createInitialState();
  updateConceptRecord(s, "union-find", "graphs-search", 0, "coached");
  updateConceptRecord(s, "union-find", "graphs-search", 5, "applied"); // 14d
  updateConceptRecord(s, "union-find", "graphs-search", 23, "applied"); // ~25d (R_c=0.875)
  const recBeforeFail = s.concepts.get("union-find")!;
  const expectedLapseStability = 0.25 * recBeforeFail.stabilityDays;
  const outcomeAppliedFail = conceptOutcomeFromRubric({ rubricRow: 5, existing: recBeforeFail });
  assert.equal(outcomeAppliedFail, "lapsed");
  updateConceptRecord(s, "union-find", "graphs-search", 40, "lapsed");
  assert.equal(s.concepts.get("union-find")!.stabilityDays, expectedLapseStability);
  assert.equal(s.concepts.get("union-find")!.lapses, 1);
  // Follow-up coaching on applied record does NOT reset clock or raise stability back up
  updateConceptRecord(s, "union-find", "graphs-search", 40, "coached");
  assert.equal(s.concepts.get("union-find")!.stabilityDays, expectedLapseStability);
  assert.equal(s.concepts.get("union-find")!.lastEvaluatedDay, 40);

  // Coached -> fail (Rubric Row 6) lapses 4d -> 2d, repeat coached stays 2d (never pops back up to 4d!)
  updateConceptRecord(s, "prefix-trie", "trees-recursion", 1, "coached");
  assert.equal(conceptOutcomeFromRubric({ rubricRow: 6, existing: s.concepts.get("prefix-trie") }), "lapsed");
  updateConceptRecord(s, "prefix-trie", "trees-recursion", 4, "lapsed");
  assert.equal(s.concepts.get("prefix-trie")!.stabilityDays, 2);
  updateConceptRecord(s, "prefix-trie", "trees-recursion", 4, "coached");
  assert.equal(s.concepts.get("prefix-trie")!.stabilityDays, 2);

  // F11: Selection slot WITHOUT targetConceptSlug still penalizes brute-force accept when domain has a coached/applied concept
  assert.equal(domainHasKnownConcept(s, "graphs-search"), true);
  assert.equal(domainHasKnownConcept(s, "greedy"), false);
  assert.deepEqual(
    evaluateMissedTargetSelection({
      usedOptimalComplexity: false,
      domainHasKnownConcept: domainHasKnownConcept(s, "graphs-search"),
    }),
    { penalizeSelection: true, conceptOutcome: "none" },
  );
  assert.deepEqual(
    evaluateMissedTargetSelection({
      usedOptimalComplexity: true,
      domainHasKnownConcept: domainHasKnownConcept(s, "graphs-search"),
    }),
    { penalizeSelection: false, conceptOutcome: "none" },
  );
  assert.deepEqual(
    evaluateMissedTargetSelection({
      usedOptimalComplexity: false,
      domainHasKnownConcept: domainHasKnownConcept(s, "greedy"),
    }),
    { penalizeSelection: false, conceptOutcome: "none" },
  );
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("F9, D1 & D3: 200-seed 365-day end-to-end simulation (via selectNextIntent + ΔD_time + 0.5x Easy credit) verifies recovery & streaks", () => {
  // Provisional UI flag drops once domain uncertainty <= 80
  assert.equal(isDomainProvisional(110), true);
  assert.equal(isDomainProvisional(81), true);
  assert.equal(isDomainProvisional(80), false);

  const SEEDS = 200;
  const archetypeStats: Record<string, any> = {};

  for (const [name, trueBase, tier] of [
    ["beginner", 900, "foundations"],
    ["intermediate", 1150, "interview-prep"],
    ["strong", 1350, "experienced"],
  ] as const) {
    let sumAbsErr90 = 0;
    let sumGap90 = 0, sumGap180 = 0, sumGap365 = 0;
    let inv90 = 0, inv180 = 0, inv365 = 0;
    let sumSel90 = 0, sumLapses365 = 0;
    let sumIntro90 = 0, sumIntro180 = 0, sumIntro365 = 0;
    let sumStable90 = 0, sumStable180 = 0, sumStable365 = 0;
    let sumGraphsSigma180 = 0;
    let sumThreeMissStreaks365 = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = mulberry32(seed * 1009 + trueBase);
      const st = createInitialState();
      let sel90 = 0;
      let lapses365 = 0;
      let threeMissStreaks = 0;

      const snapshotHorizon = (day: number) => {
        const gTheta = st.globalMu + st.domains["graphs-search"].implOffset;
        const dTheta = st.globalMu + st.domains["dynamic-programming"].implOffset;
        const gap = gTheta - dTheta;
        let intro = 0, stable30 = 0;
        for (const c of st.concepts.values()) {
          if (c.state !== "probed") intro++;
          if (c.stabilityDays >= 30) stable30++;
        }
        if (day === 90) {
          sumAbsErr90 += Math.abs(st.globalMu - trueBase);
          sumGap90 += gap;
          if (gap < 0) inv90++;
          sumSel90 += sel90;
          sumIntro90 += intro;
          sumStable90 += stable30;
        } else if (day === 180) {
          sumGap180 += gap;
          if (gap < 0) inv180++;
          sumIntro180 += intro;
          sumStable180 += stable30;
          sumGraphsSigma180 += st.domains["graphs-search"].implSigma;
        } else if (day === 365) {
          sumGap365 += gap;
          if (gap < 0) inv365++;
          sumIntro365 += intro;
          sumStable365 += stable30;
          sumLapses365 += lapses365;
          sumThreeMissStreaks365 += threeMissStreaks;
        }
      };

      for (let d = 1; d <= 365; d++) {
        // F19: Route full 365-day simulation from Day 1 through selectNextIntent (onboarding + Stage 2)!
        const intent = selectNextIntent(st, d, { startingTier: tier });
        assert.notEqual(intent.targetDomain, st.lastPracticedDomain);
        if (d > 4) {
          assert.ok(st.prescribedRecentDomains.slice(-6).filter((x) => x === intent.targetDomain).length < 2);
        }

        if (d <= 90 && intent.targetFacet === "selection") sel90++;
        const rawMidDiff = Math.round((intent.targetDifficultyBand[0] + intent.targetDifficultyBand[1]) / 2);
        const stdMin = standardMinutes(rawMidDiff);
        const midTime = intent.defaultTimeboxBand
          ? Math.round((intent.defaultTimeboxBand[0] + intent.defaultTimeboxBand[1]) / 2)
          : stdMin;
        const effDiff = timeAdjustedDifficulty(rawMidDiff, stdMin, midTime);

        const trueDom =
          trueBase +
          (intent.targetDomain === "graphs-search"
            ? 80
            : intent.targetDomain === "dynamic-programming"
              ? -80
              : 0);
        const p = expectedScore(trueDom, effDiff);
        const m = Math.min(p, 1 - p);
        const u = rng();
        let rubricRow: 2 | 3 | 5 | 6 | 7;
        let score: number;
        if (u < p - 0.33 * m) {
          rubricRow = 2;
          score = 1.0;
        } else if (u < p - 0.08 * m) {
          rubricRow = 3;
          score = 0.8;
        } else if (u < p + 0.17 * m) {
          rubricRow = 5;
          score = 0.4;
        } else if (u < p + 0.37 * m) {
          rubricRow = 6;
          score = 0.15;
        } else {
          rubricRow = 7;
          score = 0.0;
        }

        let selScore = score;
        if (intent.targetFacet === "selection") {
          const uSel = rng();
          selScore = uSel < p - 0.2 * m ? 1.0 : uSel < p ? 0.9 : uSel < p + 0.2 * m ? 0.5 : 0.2;
        }

        applyAttemptGraded(
          st,
          d,
          [
            { domain: intent.targetDomain, facet: "implementation", weight: 1.0, difficulty: effDiff, score },
            ...(intent.targetFacet === "selection"
              ? [{ domain: intent.targetDomain, facet: "selection" as const, weight: 1.0, difficulty: effDiff, score: selScore }]
              : []),
          ],
          {
            prescribed: true,
            primaryDomain: intent.targetDomain,
            slotKind: intent.slotKind,
            targetedConceptSlug: intent.targetConceptSlug,
          },
        );
        if (st.consecutiveMisses >= 3) threeMissStreaks++;

        const isEasyReinf = intent.slotKind === "easy-reinforcement";
        if (intent.targetConceptSlug) {
          const prev = st.concepts.get(intent.targetConceptSlug);
          const outcome = conceptOutcomeFromRubric({ rubricRow, existing: prev });
          if (outcome === "lapsed") lapses365++;
          if (outcome !== "none") {
            updateConceptRecord(st, intent.targetConceptSlug, intent.targetDomain, d, outcome, {
              fromEasyReinforcement: isEasyReinf,
            });
          }
          if (outcome === "probed-uncoached" && rng() < 0.7) {
            updateConceptRecord(st, intent.targetConceptSlug, intent.targetDomain, d, "coached");
          }
        } else if ((rubricRow === 2 || rubricRow === 3) && rng() < 0.35) {
          const domConcept = CONCEPT_CATALOGUE.find(
            (c) =>
              c.domain === intent.targetDomain &&
              st.globalMu >= c.minGlobalMu &&
              (st.concepts.get(c.slug)?.state ?? "probed") === "probed",
          ) ??
            CONCEPT_CATALOGUE.find(
              (c) =>
                c.domain === intent.targetDomain &&
                st.globalMu >= c.minGlobalMu &&
                retrievability(
                  d - (st.concepts.get(c.slug)?.lastEvaluatedDay ?? d),
                  st.concepts.get(c.slug)?.stabilityDays ?? 1,
                ) <= 0.88,
            );
          if (domConcept) {
            updateConceptRecord(st, domConcept.slug, domConcept.domain, d, "applied", {
              fromEasyReinforcement: isEasyReinf,
            });
          }
        }

        if (d === 90 || d === 180 || d === 365) snapshotHorizon(d);
      }
    }

    const metrics = {
      mae90: Number((sumAbsErr90 / SEEDS).toFixed(1)),
      gap90: Number((sumGap90 / SEEDS).toFixed(1)),
      gap180: Number((sumGap180 / SEEDS).toFixed(1)),
      gap365: Number((sumGap365 / SEEDS).toFixed(1)),
      invPct90: Number(((inv90 / SEEDS) * 100).toFixed(1)),
      invPct180: Number(((inv180 / SEEDS) * 100).toFixed(1)),
      invPct365: Number(((inv365 / SEEDS) * 100).toFixed(1)),
      avgSel90: Number((sumSel90 / SEEDS).toFixed(1)),
      avgLapses365: Number((sumLapses365 / SEEDS).toFixed(1)),
      avgIntro90: Number((sumIntro90 / SEEDS).toFixed(1)),
      avgIntro180: Number((sumIntro180 / SEEDS).toFixed(1)),
      avgIntro365: Number((sumIntro365 / SEEDS).toFixed(1)),
      avgStable90: Number((sumStable90 / SEEDS).toFixed(1)),
      avgStable180: Number((sumStable180 / SEEDS).toFixed(1)),
      avgStable365: Number((sumStable365 / SEEDS).toFixed(1)),
      avgGraphsSigma180: Number((sumGraphsSigma180 / SEEDS).toFixed(1)),
      avgThreeMissStreaks365: Number((sumThreeMissStreaks365 / SEEDS).toFixed(2)),
    };
    archetypeStats[name] = metrics;
  }

  if (process.env.DEBUG_RATINGS_V9) {
    console.log("MULTI_SEED_200_V9:", JSON.stringify(archetypeStats, null, 2));
  }

  assert.deepEqual(archetypeStats, {
    beginner: {
      mae90: 34.8,
      gap90: 47.1,
      gap180: 89.6,
      gap365: 123.2,
      invPct90: 25.5,
      invPct180: 10.5,
      invPct365: 3,
      avgSel90: 13.1,
      avgLapses365: 66.6,
      avgIntro90: 9.2,
      avgIntro180: 11.9,
      avgIntro365: 13.7,
      avgStable90: 0.8,
      avgStable180: 3.2,
      avgStable365: 6.3,
      avgGraphsSigma180: 83.2,
      avgThreeMissStreaks365: 30.54,
    },
    intermediate: {
      mae90: 25.6,
      gap90: 63.1,
      gap180: 102.8,
      gap365: 131.4,
      invPct90: 18.5,
      invPct180: 7,
      invPct365: 2,
      avgSel90: 15.3,
      avgLapses365: 63,
      avgIntro90: 11.9,
      avgIntro180: 16.7,
      avgIntro365: 20.7,
      avgStable90: 0.9,
      avgStable180: 4.4,
      avgStable365: 10.8,
      avgGraphsSigma180: 82,
      avgThreeMissStreaks365: 17.23,
    },
    strong: {
      mae90: 24.5,
      gap90: 69.7,
      gap180: 102.4,
      gap365: 131.3,
      invPct90: 12.5,
      invPct180: 9,
      invPct365: 3,
      avgSel90: 17.9,
      avgLapses365: 63.5,
      avgIntro90: 12.1,
      avgIntro180: 16.8,
      avgIntro365: 20.9,
      avgStable90: 0.9,
      avgStable180: 4.5,
      avgStable365: 10.7,
      avgGraphsSigma180: 82.4,
      avgThreeMissStreaks365: 17.11,
    },
  });

  for (const [name, metrics] of Object.entries(archetypeStats)) {
    assert.ok(metrics.mae90 <= 35, `${name} 90d MAE ${metrics.mae90} <= 35`);
    assert.ok(
      metrics.gap90 < metrics.gap180 && metrics.gap180 < metrics.gap365,
      `${name} monotonic gap: ${metrics.gap90} -> ${metrics.gap180} -> ${metrics.gap365}`,
    );
    assert.ok(metrics.gap365 >= 100, `${name} 365d gap ${metrics.gap365} >= 100`);
    assert.ok(metrics.invPct365 < 5, `${name} 365d inversion ${metrics.invPct365}% < 5%`);
    assert.ok(metrics.avgLapses365 > 0, `${name} must exercise real lapses (${metrics.avgLapses365})`);
    assert.ok(metrics.avgSel90 >= 10, `${name} Selection prescriptions/90d ${metrics.avgSel90} >= 10`);
    assert.ok(metrics.avgGraphsSigma180 <= 86, `${name} graphs sigma <= 86 by day 180 (${metrics.avgGraphsSigma180})`);
  }
});

// ============================================================================
// v9 Review Resolution Tests (F1–F19, D1–D3, Smaller Issues)
// ============================================================================

test("v9 F1 & F2: timebox math (standardMinutes, ΔD_time, ±5m manual cap, maxMinutes filter), <950 ability clock, coached revisit, and scaled 1350 clock", () => {
  assert.equal(DEFAULT_STARTING_TIER, "foundations");
  assert.equal(standardMinutes(850), 15);
  assert.equal(standardMinutes(1050), 20);
  assert.equal(standardMinutes(1180), 25);
  assert.equal(standardMinutes(1350), 35);
  assert.equal(standardMinutes(1500), 45);

  // Manual UI range stays 1-90m; within ±5m adjusts difficulty via ΔD_time, > ±5m marks unrated practice
  assert.equal(isManualTimeboxRated(20, 25), true);
  assert.equal(isManualTimeboxRated(20, 15), true);
  assert.equal(isManualTimeboxRated(20, 45), false);
  assert.equal(timeAdjustedDifficulty(800, 15, 22), 771); // +50% generous ability clock makes 800 floor E higher!
  assert.ok(expectedScore(800, 771) > expectedScore(800, 800));

  // < 950 beginner Easy Reinforcement (Slot 4) uses ability clock + coached revisit fallback
  const sBeg = createInitialState();
  sBeg.globalMu = 850;
  sBeg.prescribedCount = 4;
  sBeg.recentStruggles.push({ domain: "binary-search", day: 4 });
  const begReinf = selectDirectorIntent(sBeg, 5);
  assert.equal(begReinf.slotKind, "easy-reinforcement");
  assert.equal(begReinf.clockGoal, "ability");
  assert.equal(begReinf.allowCoachedRevisit, true);
  assert.ok((begReinf.defaultTimeboxBand?.[0] ?? 0) >= 20); // ~21-24m generous clock on a 15m Easy

  // Coached revisit fallback unlocks solved problems >= 5d old when fresh <= 830 supply is thin (<3)
  const sparseCatalog: CatalogProblemRow[] = [
    { slug: "solved-coached-bs", title: "Search Rotated", difficulty: "Easy", acRate: 78, isPaidOnly: false, status: "ac", topicTagSlugs: ["binary-search"], resolvedDomain: "binary-search", difficultyScore: 836, excluded: false },
    { slug: "too-hard-bs", title: "Median Arrays", difficulty: "Hard", acRate: 40, isPaidOnly: false, status: null, topicTagSlugs: ["binary-search"], resolvedDomain: "binary-search", difficultyScore: 1616, excluded: false },
  ];
  const withRevisit = selectCandidatesFromCache(sparseCatalog, begReinf, {
    coachedRevisitSlugs: new Set(["solved-coached-bs"]),
  });
  assert.equal(withRevisit[0].slug, "solved-coached-bs");

  // 1350 Strong learner Easy Reinforcement (Slot 4) lands near 1180 Medium -> scales clock up to ~22-28m (NOT squeezed to 12-15m!)
  const sStrong = createInitialState();
  sStrong.globalMu = 1350;
  sStrong.prescribedCount = 4;
  sStrong.recentStruggles.push({ domain: "graphs-search", day: 9 });
  const strongReinf = selectDirectorIntent(sStrong, 10);
  assert.equal(strongReinf.slotKind, "easy-reinforcement");
  assert.equal(strongReinf.clockGoal, "standard");
  assert.ok((strongReinf.defaultTimeboxBand?.[0] ?? 0) >= 22);

  // maxMinutes filters candidates to problems whose standardMinutes fits instead of starving the clock
  const timeFilterCatalog: CatalogProblemRow[] = [
    { slug: "slow-med", title: "Harder Medium", difficulty: "Medium", acRate: 52, isPaidOnly: false, topicTagSlugs: ["hash-table"], resolvedDomain: "hashing-prefix", difficultyScore: 1194, excluded: false },
    { slug: "quick-easy", title: "Quick Easy", difficulty: "Easy", acRate: 63, isPaidOnly: false, topicTagSlugs: ["hash-table"], resolvedDomain: "hashing-prefix", difficultyScore: 912, excluded: false },
  ];
  const filteredByTime = selectCandidatesFromCache(timeFilterCatalog, {
    slotIndex: 0, slotKind: "growth", targetDomain: "hashing-prefix", targetFacet: "implementation", targetDifficultyBand: [900, 1210],
  }, { maxMinutes: 15 });
  assert.deepEqual(filteredByTime.map((p) => p.slug), ["quick-easy"]);
});

test("v9 F3, F5, F6, F7, F8: welcomeDismissed vs bundled historySeed, C++26 parity, 48 band-verified seeds + mute fallback, fast onboarding", () => {
  // F3: Fresh DB with 3 bundled historySeed notes still shows Welcome until welcomeDismissed
  assert.equal(shouldShowWelcomePicker({ welcomeDismissed: false, prescribedCount: 0, bundledImportCount: 3, userImportCount: 0 }), true);
  assert.equal(shouldShowWelcomePicker({ welcomeDismissed: false, prescribedCount: 0, bundledImportCount: 3, userImportCount: 5 }), true);
  assert.equal(shouldShowWelcomePicker({ welcomeDismissed: true, prescribedCount: 0, bundledImportCount: 3, userImportCount: 0 }), false);
  assert.equal(shouldShowWelcomePicker({ welcomeDismissed: false, prescribedCount: 1, bundledImportCount: 3, userImportCount: 0 }), false);

  // F5: Language parity in starter inspection & contextKey
  const cppOnly = { titleSlug: "p", locked: false, javaStarter: null, cppStarter: "class Solution {};", content: "<p>Solve</p>" };
  assert.equal(validateInspectedStarter(cppOnly, "java").available, false);
  assert.equal(validateInspectedStarter(cppOnly, "cpp").available, true);
  const sampleIntent: PrescriptionIntent = { slotIndex: 0, slotKind: "growth", targetDomain: "arrays-strings", targetFacet: "implementation", targetDifficultyBand: [950, 1010] };
  assert.notEqual(
    computePrescriptionContextKey({ intent: sampleIntent, language: "java", isPremium: false, skippedSlugs: [] }),
    computePrescriptionContextKey({ intent: sampleIntent, language: "cpp", isPremium: false, skippedSlugs: [] }),
  );

  // F6: Every single seed (all 48 across 12 Easy-backed domains x 3 tiers) fits its exact tier band, resolves cleanly, and is free!
  assert.equal(ONBOARDING_SEED_PROBLEMS.length, 48);
  for (const seed of ONBOARDING_SEED_PROBLEMS) {
    assert.equal(seed.isPaidOnly, false);
    assert.ok(!seed.topicTagSlugs.some((t) => EXCLUDED_LIST_SLUGS.has(t)));
    assert.equal(resolvePrimaryDomain(seed.slug, seed.topicTagSlugs), seed.domain, `${seed.slug} domain`);
    const d = problemBaseDifficulty(seed.difficulty, seed.acRate);
    const [lo, hi] = STARTING_TIER_BANDS[seed.tier].band;
    assert.ok(d >= lo && d <= hi, `Seed ${seed.slug} (${seed.tier}) D=${d} outside [${lo}, ${hi}]`);
  }
  // Skipping solved (status="ac") seed automatically selects second seed in the cell
  assert.equal(
    selectOnboardingSeed("hashing-prefix", "foundations", { solvedSlugs: new Set(["contains-duplicate"]) })?.slug,
    "ransom-note",
  );

  // F7: Muting ALL 4 core onboarding domains still produces an in-band seed on arrays-strings
  const muteCore4 = validateDirectorPreferences({
    focusDomains: [],
    mutedDomains: ["hashing-prefix", "two-pointers-window", "stacks-queues-linked", "binary-search"],
  });
  const sMute = createInitialState();
  const sess1 = selectOnboardingIntent(sMute, 1, { startingTier: "foundations", preferences: muteCore4 });
  assert.equal(sess1.targetDomain, "arrays-strings");
  assert.ok(selectOnboardingSeed(sess1.targetDomain, "foundations")?.slug);

  // F8: Experienced 1350-1550 solver crushing onboarding climbs cleanly above 1300 instead of re-anchoring down, and reveal shows ±σ0
  const sExp = createInitialState();
  const bands: number[] = [];
  for (let i = 0; i < 4; i++) {
    const intent = selectNextIntent(sExp, i + 1, { startingTier: "experienced" });
    const mid = Math.round((intent.targetDifficultyBand[0] + intent.targetDifficultyBand[1]) / 2);
    bands.push(mid);
    applyAttemptGraded(sExp, i + 1, [{ domain: intent.targetDomain, facet: "implementation", weight: 1, difficulty: mid, score: 1.0 }], {
      prescribed: true, primaryDomain: intent.targetDomain, slotKind: intent.slotKind,
    });
  }
  assert.ok(bands[1] > bands[0] && bands[2] > bands[1] && bands[3] > bands[2], `Monotonic step-ups: ${bands}`);
  assert.ok(sExp.globalMu >= 1300, `Experienced 4-0 converges >= 1300 (got ${sExp.globalMu})`);
  assert.match(formatInitialRatingReveal(sExp), /^\d+ ± \d+$/);
});

test("v9 F4, F9 & F16: single-flight atomic drain prevents double/failed-overwrite, weighted composite is order-independent, and AI outage never traps in Easy loop", async () => {
  // F9: Weighted composite order independence (80% win + 20% miss = 0.80 in EITHER order)
  const sOrdA = createInitialState();
  const sOrdB = createInitialState();
  applyAttemptGraded(sOrdA, 1, [
    { domain: "hashing-prefix", facet: "implementation", weight: 0.8, difficulty: 980, score: 1.0 },
    { domain: "sorting-intervals", facet: "implementation", weight: 0.2, difficulty: 980, score: 0.0 },
  ], { prescribed: true, slotKind: "onboarding" });
  applyAttemptGraded(sOrdB, 1, [
    { domain: "sorting-intervals", facet: "implementation", weight: 0.2, difficulty: 980, score: 0.0 },
    { domain: "hashing-prefix", facet: "implementation", weight: 0.8, difficulty: 980, score: 1.0 },
  ], { prescribed: true, slotKind: "onboarding" });
  assert.deepEqual(sOrdA, sOrdB);
  assert.equal(sOrdA.lastPrescribedImplScore, 0.8);
  assert.equal(sOrdA.consecutiveMisses, 0);
  assert.deepEqual(selectOnboardingIntent(sOrdA, 2), selectOnboardingIntent(sOrdB, 2));

  // F4: Two concurrent drains (testing atomic DB claims via bypassSingleFlight) grade ONCE and NEVER overwrite 'complete' with 'failed'!
  const db = new DatabaseSync(":memory:");
  createRatingSchema(db);
  db.prepare("INSERT INTO practice_launches(attemptId, launchSeq, day, startedAt, prescribed, rated, provisionalDomain) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("j1", 1, 1, 100, 1, 1, "hashing-prefix");
  db.prepare("INSERT INTO rating_jobs(attemptId, status, attempts, lastError, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run("j1", "pending", 0, null, 100);

  let gradeCount = 0;
  const [r1, r2] = await Promise.all([
    drainPendingRatingJobs(db, async () => {
      gradeCount += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 950, score: 1.0 }], familiarity: "new", primaryDomain: "hashing-prefix" };
    }, { now: 1000, bypassSingleFlight: true }),
    drainPendingRatingJobs(db, async () => {
      gradeCount += 1;
      throw new Error("Slower timeout");
    }, { now: 1000, bypassSingleFlight: true }),
  ]);
  assert.equal(gradeCount, 1); // Only claim winner ran gradeFn!
  assert.equal(r1.completedJobIds.length + r2.completedJobIds.length, 1);
  assert.equal((db.prepare("SELECT status FROM rating_jobs WHERE attemptId = 'j1'").get() as any).status, "complete");

  // Single-flight join also returns shared completion
  db.prepare("INSERT INTO practice_launches(attemptId, launchSeq, day, startedAt, prescribed, rated, provisionalDomain) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("j2", 2, 2, 200, 1, 1, "binary-search");
  db.prepare("INSERT INTO rating_jobs(attemptId, status, attempts, lastError, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run("j2", "pending", 0, null, 200);
  let sfCalls = 0;
  const sf = await Promise.all([
    drainPendingRatingJobs(db, async () => {
      sfCalls += 1;
      return { updates: [{ domain: "binary-search", facet: "implementation", weight: 1, difficulty: 950, score: 1.0 }], familiarity: "new", primaryDomain: "binary-search" };
    }),
    drainPendingRatingJobs(db, async () => {
      sfCalls += 1;
      return { updates: [{ domain: "binary-search", facet: "implementation", weight: 1, difficulty: 950, score: 1.0 }], familiarity: "new", primaryDomain: "binary-search" };
    }),
  ]);
  assert.equal(sfCalls, 1);
  assert.deepEqual(sf[0], sf[1]);

  // F16: After 2 graded misses + AI outage (next 6 launches have NO grade events), Easy Reinforcement fires AT MOST ONCE!
  const launchesOutage: PracticeLaunchRow[] = [
    { attemptId: "m1", launchSeq: 1, day: 1, prescribed: true, rated: true, provisionalDomain: "hashing-prefix", intent: { slotIndex: 0, slotKind: "growth", targetDomain: "hashing-prefix", targetFacet: "implementation", targetDifficultyBand: [950, 1010] } },
    { attemptId: "m2", launchSeq: 2, day: 2, prescribed: true, rated: true, provisionalDomain: "two-pointers-window", intent: { slotIndex: 1, slotKind: "breadth", targetDomain: "two-pointers-window", targetFacet: "implementation", targetDifficultyBand: [950, 1010] } },
  ];
  const eventsOutage: SkillRatingEventRow[] = [
    { id: "gm1", attemptId: "m1", launchSeq: 1, kind: "attempt-graded", idempotencyKey: "gm1", occurredDay: 1, createdAt: 10, payload: { updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 950, score: 0.0 }], familiarity: "new", primaryDomain: "hashing-prefix" } },
    { id: "gm2", attemptId: "m2", launchSeq: 2, kind: "attempt-graded", idempotencyKey: "gm2", occurredDay: 2, createdAt: 20, payload: { updates: [{ domain: "two-pointers-window", facet: "implementation", weight: 1, difficulty: 950, score: 0.0 }], familiarity: "new", primaryDomain: "two-pointers-window" } },
  ];
  const slotKindsDuringOutage: string[] = [];
  for (let i = 0; i < 6; i++) {
    const stOut = replayRatingLedger(launchesOutage, eventsOutage);
    const nextI = selectDirectorIntent(stOut, 3 + i);
    slotKindsDuringOutage.push(nextI.slotKind);
    launchesOutage.push({
      attemptId: `out-${i}`,
      launchSeq: 3 + i,
      day: 3 + i,
      prescribed: true,
      rated: true,
      provisionalDomain: nextI.targetDomain,
      intent: nextI,
    });
  }
  assert.equal(slotKindsDuringOutage[0], "easy-reinforcement"); // Breaker fires immediately once
  assert.notEqual(slotKindsDuringOutage[1], "easy-reinforcement");
  // Wait: natural Slot 4 at step 4 (index 2) can run once, then must never repeat consecutively; max 2 in 6 slots, NEVER 6-in-a-row trap!
  assert.ok(slotKindsDuringOutage.filter((k) => k === "easy-reinforcement").length <= 2, `No loop: ${slotKindsDuringOutage}`);
});

test("v9 F10, F11, F12 & F13: ordered shortlists, multi-batch escape hatch, preserved steering/cooldown/Easy rotation, & signatureForced guard", () => {
  // F11 & F12: 3 failed inspections in Batch 1 move cleanly to disjoint Batch 2; "Graphs or DP" rotates to DP (not arrays!)
  const catalog: CatalogProblemRow[] = [
    // 4 hashing candidates: first 3 (Bucket 0 around midpoint 1010) fail inspectFn, 4th (Bucket 1 at 1035) succeeds in Batch 2!
    ...(["h1", "h2", "h3", "h4"] as const).map((slug, i) => ({
      slug, title: `Hash ${i}`, difficulty: "Medium" as const, acRate: 76 - i, isPaidOnly: false,
      topicTagSlugs: ["hash-table"], resolvedDomain: "hashing-prefix" as DomainId,
      difficultyScore: i < 3 ? 1005 + i * 5 : 1035, excluded: false,
    })),
    { slug: "dp-opt", title: "Coin Paths", difficulty: "Medium", acRate: 64, isPaidOnly: false, topicTagSlugs: ["dynamic-programming"], resolvedDomain: "dynamic-programming", difficultyScore: 1005, excluded: false },
    { slug: "arr-decoy", title: "Array Shuffle", difficulty: "Easy", acRate: 50, isPaidOnly: false, topicTagSlugs: ["array"], resolvedDomain: "arrays-strings", difficultyScore: 978, excluded: false },
    { slug: "dp-easy", title: "Stairs Warmup", difficulty: "Easy", acRate: 72, isPaidOnly: false, topicTagSlugs: ["dynamic-programming"], resolvedDomain: "dynamic-programming", difficultyScore: 866, excluded: false },
  ];
  const st = createInitialState();
  st.prescribedCount = 5;
  st.lastPracticedDomain = "arrays-strings";
  st.prescribedRecentDomains = ["arrays-strings"];

  const esc = selectShortlistWithInspectionEscapeHatch({
    catalog,
    intent: { slotIndex: 0, slotKind: "growth", targetDomain: "hashing-prefix", targetFacet: "implementation", targetDifficultyBand: [980, 1040] },
    state: st,
    day: 6,
    batchSize: 3,
    maxInspectionsPerBatch: 3,
    maxTotalInspections: 6,
    inspectFn: (p) => p.slug === "h4", // First 3 fail!
  });
  assert.equal(esc.chosen?.slug, "h4");
  assert.equal(esc.strategy, "batch-2");
  assert.equal(new Set(esc.inspectedSlugs).size, 4); // No duplicate inspections!

  // F12: Steering pool ["graphs-search", "dynamic-programming"] with 0 Graphs candidates MUST pick "dynamic-programming", never "arrays-strings"
  const rotPool = selectShortlistWithInspectionEscapeHatch({
    catalog,
    intent: { slotIndex: 0, slotKind: "growth", targetDomain: "graphs-search", targetFacet: "implementation", targetDifficultyBand: [980, 1040] },
    state: st,
    day: 6,
    allowedDomains: ["graphs-search", "dynamic-programming"],
    inspectFn: () => true,
  });
  assert.equal(rotPool.strategy, "rotated");
  assert.equal(rotPool.intent.targetDomain, "dynamic-programming");

  // F12: Rotated Easy Reinforcement preserves Easy band [-210, -135] & preferEasy (not Growth band!)
  const rotEasy = selectShortlistWithInspectionEscapeHatch({
    catalog,
    intent: { slotIndex: 4, slotKind: "easy-reinforcement", targetDomain: "graphs-search", targetFacet: "implementation", targetDifficultyBand: [790, 865], preferEasy: true, clockGoal: "ability" },
    state: { ...st, globalMu: 1050, recentDomains: ["arrays-strings"], prescribedRecentDomains: ["arrays-strings"], lastPracticedDomain: "arrays-strings" },
    day: 6,
    inspectFn: () => true,
  });
  assert.equal(rotEasy.strategy, "rotated");
  assert.notEqual(rotEasy.intent.targetDomain, "arrays-strings"); // Honored cooldown!
  assert.equal(rotEasy.intent.preferEasy, true);
  assert.ok(rotEasy.intent.targetDifficultyBand[1] <= 920); // Easy band preserved!

  // F13: signatureForced tags filter out Selection, and <5 disguisable candidates blocks Selection & Growth selSigma hijack
  assert.equal(isSignatureForcedFromSlugs(["tree", "binary-tree"]), true);
  assert.equal(isSignatureForcedFromSlugs(["linked-list", "two-pointers"]), true);
  assert.equal(isSignatureForcedFromSlugs(["array", "binary-search"]), false);
  const stSig = createInitialState();
  stSig.prescribedCount = 5;
  stSig.domains["trees-recursion"].implOffset = 80; // Strong impl, unmeasured selOffset = 0 with selSigma = 110!
  stSig.domains["trees-recursion"].selOffset = 0;
  assert.equal(chooseTargetFacet(stSig, "trees-recursion", "growth", { "trees-recursion": 2 }), "implementation");
  // Without F13 guard, trees-recursion LCB = min(80-66, 0-66) = -66 tied at bottom; WITH F13 guard, impl LCB = +14 so Growth skips it!
  const gIntent = selectDirectorIntent(stSig, 10, undefined, { "trees-recursion": 2 });
  assert.notEqual(gIntent.targetDomain, "trees-recursion");
});

test("v9 F14, F15, F17, F18, F19, D2, D3 & Merge: steering, stale conflict, practice-only, sync, skips, planner check, D2 focus & D3 0.5x", async () => {
  // F14: domainPoolOverride uses seeded pick, requires >=3 domains for Selection, supports "stretch", coach leak detection, & one-off mute override
  const s = createInitialState();
  s.prescribedCount = 5;
  s.domains["binary-search"].implAttempts = 2;
  const poolCatalog: CatalogProblemRow[] = [
    { slug: "bs-1", title: "Koko Eating Bananas", difficulty: "Medium", acRate: 66, isPaidOnly: false, topicTagSlugs: ["binary-search"], resolvedDomain: "binary-search", difficultyScore: 1087, excluded: false },
    { slug: "dp-1", title: "House Robber", difficulty: "Medium", acRate: 52, isPaidOnly: false, topicTagSlugs: ["dynamic-programming"], resolvedDomain: "dynamic-programming", difficultyScore: 1194, excluded: false },
    { slug: "gr-1", title: "Number of Islands", difficulty: "Medium", acRate: 62, isPaidOnly: false, topicTagSlugs: ["breadth-first-search"], resolvedDomain: "graphs-search", difficultyScore: 1117, excluded: false },
    { slug: "bt-1", title: "Subsets", difficulty: "Medium", acRate: 78, isPaidOnly: false, topicTagSlugs: ["backtracking"], resolvedDomain: "backtracking", difficultyScore: 995, excluded: false },
  ];
  const baseGrowth: PrescriptionIntent = { slotIndex: 0, slotKind: "growth", targetDomain: "arrays-strings", targetFacet: "implementation", targetDifficultyBand: [955, 1010] };

  // Pool of 2 -> Selection disabled!
  const pool2 = adjustPrescriptionIntent({
    state: s, currentIntent: baseGrowth, catalog: poolCatalog, isPremium: false, skippedSlugs: new Set(), day: 5, seed: 0,
    override: { domainPoolOverride: ["binary-search", "dynamic-programming"] },
  });
  assert.equal(pool2.intent.steeredDomainExplicit, true);
  assert.equal(pool2.intent.targetFacet, "implementation");

  // Pool of 3 across differing seeds doesn't always pick index 0, and enables Selection!
  const pool3Seed0 = adjustPrescriptionIntent({
    state: s, currentIntent: baseGrowth, catalog: poolCatalog, isPremium: false, skippedSlugs: new Set(), day: 5, seed: 0,
    override: { domainPoolOverride: ["binary-search", "dynamic-programming", "graphs-search"] },
  });
  const pool3Seed1 = adjustPrescriptionIntent({
    state: s, currentIntent: baseGrowth, catalog: poolCatalog, isPremium: false, skippedSlugs: new Set(), day: 5, seed: 1,
    override: { domainPoolOverride: ["binary-search", "dynamic-programming", "graphs-search"] },
  });
  assert.notEqual(pool3Seed0.intent.targetDomain, pool3Seed1.intent.targetDomain);
  assert.equal(pool3Seed0.intent.steeredDomainExplicit, false);
  assert.equal(pool3Seed0.intent.targetFacet, "selection");

  // slotOverride: "stretch" works!
  const stretched = adjustPrescriptionIntent({
    state: s, currentIntent: baseGrowth, catalog: poolCatalog, isPremium: false, skippedSlugs: new Set(), day: 5,
    override: { slotOverride: "stretch" },
  });
  assert.equal(stretched.intent.slotKind, "stretch");
  assert.deepEqual(stretched.intent.targetDifficultyBand, [1010, 1065]);

  // Explicit one-off override on gated backtracking emits warning without erroring
  const gatedOneOff = adjustPrescriptionIntent({
    state: { ...s, globalMu: 920 }, currentIntent: baseGrowth, catalog: poolCatalog, isPremium: false, skippedSlugs: new Set(), day: 5,
    override: { domainOverride: "backtracking" },
  });
  assert.equal(gatedOneOff.intent.targetDomain, "backtracking");
  assert.ok(gatedOneOff.intent.overrideWarning?.includes("backtracking"));
  assert.equal(didCoachLeakSelectionTarget(["Try binary search on the answer space"], "binary-search"), true);

  // F15: Stale suppliedId honors saved intent (<48h) instead of silently becoming unrated; >=48h/missing returns conflict!
  const ctxKey = computePrescriptionContextKey({ intent: baseGrowth, language: "java", isPremium: false, skippedSlugs: [] });
  const savedMap = new Map<string, SavedPrescriptionRecord>([
    ["rx-1", { id: "rx-1", slug: "bs-1", language: "java", createdAt: 1000, intent: baseGrowth, contextKey: ctxKey }],
  ]);
  assert.equal(resolveLaunchPrescription({ savedById: savedMap, currentContextKey: ctxKey, slug: "bs-1", language: "java", now: 2000 }).mode, "practice-only");
  assert.equal(resolveLaunchPrescription({ suppliedId: "rx-1", savedById: savedMap, currentContextKey: "changed-key", slug: "bs-1", language: "java", now: 2000 }).mode, "prescribed-stale-honored");
  assert.equal(resolveLaunchPrescription({ suppliedId: "rx-1", savedById: savedMap, currentContextKey: ctxKey, slug: "bs-1", language: "java", now: 1000 + 49 * 3600_000 }).mode, "conflict");

  // F17: Self-picked catalog launch gives 0 concept credit/inflation AND only applies prevDomain cooldown (never pushes 6-cap)
  const selfLaunches: PracticeLaunchRow[] = [
    { attemptId: "sp1", launchSeq: 1, day: 1, prescribed: false, rated: false, provisionalDomain: "dynamic-programming" },
    { attemptId: "sp2", launchSeq: 2, day: 2, prescribed: false, rated: false, provisionalDomain: "dynamic-programming" },
  ];
  const selfEvents: SkillRatingEventRow[] = [
    { id: "es1", attemptId: "sp1", launchSeq: 1, kind: "attempt-graded", idempotencyKey: "g:sp1", occurredDay: 1, createdAt: 1, payload: { updates: [{ domain: "dynamic-programming", facet: "implementation", weight: 1, difficulty: 1100, score: 1.0 }], familiarity: "new", primaryDomain: "dynamic-programming", statedComplexity: { time: "accurate", space: "accurate" }, conceptOutcomes: [{ slug: "dp-1d-2d", domain: "dynamic-programming", outcome: "applied" }] } },
    { id: "es2", attemptId: "sp2", launchSeq: 2, kind: "attempt-graded", idempotencyKey: "g:sp2", occurredDay: 2, createdAt: 2, payload: { updates: [{ domain: "dynamic-programming", facet: "implementation", weight: 1, difficulty: 1100, score: 0.0 }], familiarity: "new", primaryDomain: "dynamic-programming", conceptOutcomes: [{ slug: "dp-1d-2d", domain: "dynamic-programming", outcome: "lapsed" }] } },
  ];
  const spState = replayRatingLedger(selfLaunches, selfEvents);
  assert.equal(spState.concepts.size, 0); // ZERO concept credit/inflation!
  assert.equal(spState.prescribedRecentDomains.length, 0);
  assert.equal(spState.lastPracticedDomain, "dynamic-programming");
  // Next Slot 0 with pinned DP (after another domain clears prevDomain) is NOT blocked by those 2 self-picks!
  spState.prescribedCount = 5;
  spState.lastPracticedDomain = "arrays-strings";
  const dpFocusAfterSelf = selectDirectorIntent(spState, 3, { focusDomains: ["dynamic-programming"], mutedDomains: [] });
  assert.equal(dpFocusAfterSelf.targetDomain, "dynamic-programming");

  // D2: Slot 0 dedicated to strong pinned focusDomains even when Graphs already has +100 offset!
  const sFocus = createInitialState();
  sFocus.prescribedCount = 5; // Slot 0
  sFocus.domains["graphs-search"].implOffset = 100;
  sFocus.domains["graphs-search"].implSigma = 50;
  const focusedSlot0 = selectDirectorIntent(sFocus, 10, { focusDomains: ["graphs-search"], mutedDomains: [] });
  assert.equal(focusedSlot0.slotIndex, 0);
  assert.equal(focusedSlot0.targetDomain, "graphs-search");

  // D3: Easy Reinforcement concept stability growth is discounted 0.5x on already-applied concepts
  const sD3A = createInitialState();
  const sD3B = createInitialState();
  updateConceptRecord(sD3A, "union-find", "graphs-search", 0, "coached");
  updateConceptRecord(sD3A, "union-find", "graphs-search", 5, "applied"); // 14d
  updateConceptRecord(sD3B, "union-find", "graphs-search", 0, "coached");
  updateConceptRecord(sD3B, "union-find", "graphs-search", 5, "applied"); // 14d
  updateConceptRecord(sD3A, "union-find", "graphs-search", 20, "applied", { fromEasyReinforcement: false });
  updateConceptRecord(sD3B, "union-find", "graphs-search", 20, "applied", { fromEasyReinforcement: true });
  assert.ok(
    sD3B.concepts.get("union-find")!.stabilityDays < sD3A.concepts.get("union-find")!.stabilityDays,
    "0.5x Easy Reinforcement grows slower than full Consolidation",
  );

  // F18: CatalogSyncManager resumes after error & clears backoff on success
  const syncMgr = new CatalogSyncManager();
  await syncMgr.step(async (skip) => ({ totalNum: 250, count: skip === 0 ? 100 : 100 }), 1000);
  assert.equal(syncMgr.nextSkip, 100);
  await syncMgr.step(async () => { throw new Error("429"); }, 1001);
  assert.equal(syncMgr.nextSkip, 100); // Resumes from exact offset!
  assert.equal(syncMgr.backoffMs, 1000);
  await syncMgr.step(async () => ({ totalNum: 250, count: 100 }), 2000);
  await syncMgr.step(async () => ({ totalNum: 250, count: 50 }), 3000);
  assert.equal(syncMgr.needsRefresh(4000), false);

  // F19: "Choose another" skip counting (1-2 keep domain, 3 rotates) + Planner validation + Snapshot merge launchSeq re-indexing
  assert.equal(selectSkipOutcome(sFocus, baseGrowth, 1, 5).rotateDomain, false);
  assert.equal(selectSkipOutcome(sFocus, baseGrowth, 2, 5).rotateDomain, false);
  const skip3 = selectSkipOutcome(sFocus, baseGrowth, 3, 5);
  assert.equal(skip3.rotateDomain, true);
  assert.notEqual(skip3.intent.targetDomain, baseGrowth.targetDomain);

  assert.equal(
    validatePlannerResult({
      slug: "bs-1", reason: "Good problem for testing edge-case index bounds without hints.", minutes: 20,
      difficultyModifier: 0, kind: "new-challenge", evidenceIds: [], disguiseVerified: true,
      verifiedSlugs: new Set(["bs-1"]), suppliedEvidenceIds: new Set(), intent: baseGrowth,
    }),
    true,
  );

  const merged = mergeRatingSnapshots(
    { launches: [{ attemptId: "old-1", launchSeq: 1, day: 1, startedAt: 10, prescribed: true, rated: true, provisionalDomain: "hashing-prefix" }], ratingJobs: [], ratingEvents: [] },
    { launches: [{ attemptId: "new-1", launchSeq: 1, day: 2, startedAt: 20, prescribed: true, rated: true, provisionalDomain: "binary-search" }], ratingJobs: [{ attemptId: "new-1", status: "running", attempts: 1, lastError: null, updatedAt: 20 }], ratingEvents: [{ id: "en", attemptId: "new-1", launchSeq: 1, kind: "attempt-graded", idempotencyKey: "k", occurredDay: 2, createdAt: 20, payload: { updates: [], familiarity: "new", primaryDomain: "binary-search" } }] },
  );
  assert.deepEqual(merged.launches.map((l) => [l.attemptId, l.launchSeq]), [["old-1", 1], ["new-1", 2]]);
  assert.equal(merged.ratingEvents[0].launchSeq, 2);
  assert.equal(merged.ratingJobs[0].status, "pending");
});
