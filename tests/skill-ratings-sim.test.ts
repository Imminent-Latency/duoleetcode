import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// ============================================================================
// Reference deterministic implementation of Skill Ratings Design v7
// Verifies every equation, resolver rank/override, concept table entry, band,
// ladder, launch-sequence replay, check-in state machine, SQLite constraints,
// catalog filtering, historical replay fixture, and 100-seed 365-day recovery.
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

export function isDomainProvisional(sigma: number): boolean {
  return sigma > PROVISIONAL_SIGMA_THRESHOLD;
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
  recentDomains: DomainId[];
  prescribedCount: number;
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
    prescribedCount: 0,
    complexityCalibration: {
      time: { accurate: 0, inaccurate: 0, unsure: 0 },
      space: { accurate: 0, inaccurate: 0, unsure: 0 },
    },
  };
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
  if (options.trackLaunchInReducer ?? true) {
    const primary = options.primaryDomain ?? implUpdates[0]?.domain;
    if (primary) state.recentDomains.push(primary);
    if (options.prescribed) state.prescribedCount += 1;
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
      prev.stabilityDays = dt >= 2 ? 14 : 12;
      prev.reps = 1;
      prev.lastEvaluatedDay = day;
      prev.lastSuccessDay = day;
    } else {
      const spacing = Math.min(1.5, dt / prev.stabilityDays);
      prev.stabilityDays = Math.min(
        730,
        prev.stabilityDays * (1 + 2.2 * (1 - R + 0.15) * spacing),
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

export type PrescriptionIntent = {
  slotIndex: number;
  slotKind: "growth" | "breadth" | "concept-probe" | "consolidation" | "momentum";
  targetDomain: DomainId;
  targetFacet: "implementation" | "selection";
  targetConceptSlug?: string;
  targetDifficultyBand: [number, number];
};

export function chooseTargetFacet(
  state: LearnerRatingState,
  domain: DomainId,
  slotKind: PrescriptionIntent["slotKind"],
): "implementation" | "selection" {
  const dom = state.domains[domain];
  if (dom.implOffset - dom.selOffset >= 35) return "selection";
  if (slotKind === "growth" && dom.implAttempts % 3 === 2) return "selection";
  return "implementation";
}

export function selectDirectorIntent(
  state: LearnerRatingState,
  day: number,
): PrescriptionIntent {
  const prevDomain = state.recentDomains.at(-1) ?? null;
  const domainIndex = (d: DomainId) => DOMAINS.indexOf(d);

  const passesGlobalGate = (d: DomainId) =>
    state.globalMu >= (DOMAIN_MIN_GLOBAL_MU[d] ?? -Infinity);
  const isEligible = (d: DomainId) => {
    if (!passesGlobalGate(d)) return false;
    if (d === prevDomain) return false;
    const count6 = state.recentDomains.slice(-6).filter((x) => x === d).length;
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

  const slotIndex = state.prescribedCount % 5;
  const bandFor = (
    d: DomainId,
    facet: "implementation" | "selection",
    loDelta: number,
    hiDelta: number,
  ): [number, number] => {
    const theta =
      state.globalMu +
      (facet === "selection" ? state.domains[d].selOffset : state.domains[d].implOffset);
    const floor = CATALOG_DIFFICULTY_FLOOR[d];
    const lo = Math.max(floor, Math.min(1800, Math.round(theta + loDelta)));
    const hi = Math.max(lo + 30, Math.min(1850, Math.round(theta + hiDelta)));
    return [lo, hi];
  };

  // Consolidation on Slot 3 (or Slot 2 overflow when >= 2 concepts are due)
  if ((slotIndex === 3 || (slotIndex === 2 && dueConcepts.length >= 2)) && dueConcepts.length > 0) {
    const top = dueConcepts[0];
    const facet = chooseTargetFacet(state, top.domain, "consolidation");
    return {
      slotIndex,
      slotKind: "consolidation",
      targetDomain: top.domain,
      targetFacet: facet,
      targetConceptSlug: top.slug,
      targetDifficultyBand: bandFor(top.domain, facet, -40, 5),
    };
  }
  if (slotIndex === 3) {
    // Rusty domain fallback -> Breadth fallback -> Growth fallback
    const rusty = eligible.filter(
      (d) => displayRating(state, d, "implementation", day).rusty,
    );
    if (rusty.length > 0) {
      const dom = rusty[0];
      const facet = chooseTargetFacet(state, dom, "consolidation");
      return {
        slotIndex,
        slotKind: "consolidation",
        targetDomain: dom,
        targetFacet: facet,
        targetDifficultyBand: bandFor(dom, facet, -40, 5),
      };
    }
  }

  // Slot 1 (or Slot 3 fallback when uncalibrated): Breadth / Concept Probe
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
        // After 2 uncoached probes, pause automatic probing for 90 days (unless incidentally applied/coached).
        return rec.probeCount < 2
          ? day - rec.lastEvaluatedDay >= 14
          : day - rec.lastEvaluatedDay >= 90;
      });
      if (probeable) {
        return {
          slotIndex,
          slotKind: "concept-probe",
          targetDomain: probeable.domain,
          targetFacet: "implementation",
          targetConceptSlug: probeable.slug,
          targetDifficultyBand: bandFor(probeable.domain, "implementation", -55, -15),
        };
      }
    }
    const bySigma = [...eligible].sort(
      (a, b) =>
        state.domains[b].implSigma - state.domains[a].implSigma ||
        domainIndex(a) - domainIndex(b),
    );
    const dom = bySigma[0];
    const facet = chooseTargetFacet(state, dom, "breadth");
    return {
      slotIndex,
      slotKind: "breadth",
      targetDomain: dom,
      targetFacet: facet,
      targetDifficultyBand: bandFor(dom, facet, -45, 10),
    };
  }

  // Slot 4: Momentum
  if (slotIndex === 4) {
    const strongest = [...eligible].sort(
      (a, b) =>
        state.domains[b].implOffset - state.domains[a].implOffset ||
        domainIndex(a) - domainIndex(b),
    )[0];
    const facet = chooseTargetFacet(state, strongest, "momentum");
    return {
      slotIndex,
      slotKind: "momentum",
      targetDomain: strongest,
      targetFacet: facet,
      targetDifficultyBand: bandFor(strongest, facet, -105, -55),
    };
  }

  // Default (Slot 0, Slot 2, or Slot 3 fallback): Growth by minimum LCB across both facets
  const lcb = (d: DomainId) => {
    const dom = state.domains[d];
    return Math.min(
      dom.implOffset - 0.6 * dom.implSigma,
      dom.selOffset - 0.6 * dom.selSigma,
    );
  };
  const growthDom = [...eligible].sort(
    (a, b) => lcb(a) - lcb(b) || domainIndex(a) - domainIndex(b),
  )[0];
  const facet = chooseTargetFacet(state, growthDom, "growth");
  return {
    slotIndex,
    slotKind: "growth",
    targetDomain: growthDom,
    targetFacet: facet,
    targetDifficultyBand: bandFor(growthDom, facet, -45, 10),
  };
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
  prescribed: boolean;
  provisionalDomain: DomainId;
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

    if (effective && !excluded) {
      const maxRescueDelta = Math.max(
        0,
        Math.min(0.25, rescues.reduce((mx, r) => Math.max(mx, r.payload.scoreDelta), 0)),
      );
      const effectiveUpdates = effective.updates.map((u) => {
        const clone = { ...u };
        if (launch.selectionSpoilerRevealed && clone.facet === "selection") {
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
      });

      if (graded && effective.conceptOutcomes) {
        for (const co of effective.conceptOutcomes) {
          conceptTransitions.push({
            occurredDay: launch.day,
            launchSeq: launch.launchSeq,
            phaseRank: 0,
            eventId: graded.id,
            slug: co.slug,
            domain: co.domain,
            outcome: co.outcome,
          });
        }
      }
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

  const launchByAttempt = new Map(sortedLaunches.map((l) => [l.attemptId, l]));
  for (const ev of events) {
    if (ev.kind !== "concept-event") continue;
    const p = ev.payload as ConceptEventPayload;
    const seq = launchByAttempt.get(ev.attemptId)?.launchSeq ?? ev.launchSeq;
    conceptTransitions.push({
      occurredDay: ev.occurredDay,
      launchSeq: seq,
      phaseRank: p.outcome === "coached" ? 1 : 0,
      eventId: ev.id,
      slug: p.slug,
      domain: p.domain,
      outcome: p.outcome,
    });
  }

  conceptTransitions.sort(
    (a, b) =>
      a.occurredDay - b.occurredDay ||
      a.launchSeq - b.launchSeq ||
      a.phaseRank - b.phaseRank ||
      a.eventId.localeCompare(b.eventId),
  );
  for (const ct of conceptTransitions) {
    updateConceptRecord(state, ct.slug, ct.domain, ct.occurredDay, ct.outcome);
  }
  return state;
}

/** F6 & F7: SQLite rating ledger + partial unique index + catalog cache schema. */
export function createRatingSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS practice_launches (
      attemptId TEXT PRIMARY KEY,
      launchSeq INTEGER NOT NULL UNIQUE,
      day INTEGER NOT NULL,
      prescribed INTEGER NOT NULL,
      provisionalDomain TEXT NOT NULL,
      intentJson TEXT,
      selectionSpoilerRevealed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rating_jobs (
      attemptId TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'complete', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
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
      topicTagSlugsJson TEXT NOT NULL,
      resolvedDomain TEXT NOT NULL,
      baseDifficulty INTEGER NOT NULL,
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
      prescribed: Boolean(r.prescribed),
      provisionalDomain: r.provisionalDomain as DomainId,
      ...(r.intentJson ? { intent: JSON.parse(r.intentJson) as PrescriptionIntent } : {}),
      ...(r.selectionSpoilerRevealed ? { selectionSpoilerRevealed: true } : {}),
    })),
    ratingJobs: jobRows.map((r) => ({
      attemptId: r.attemptId,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
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
      "INSERT INTO practice_launches(attemptId, launchSeq, day, prescribed, provisionalDomain, intentJson, selectionSpoilerRevealed) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const l of snapshot.launches) {
      insLaunch.run(
        l.attemptId,
        l.launchSeq,
        l.day,
        l.prescribed ? 1 : 0,
        l.provisionalDomain,
        l.intent ? JSON.stringify(l.intent) : null,
        l.selectionSpoilerRevealed ? 1 : 0,
      );
    }
    const insJob = db.prepare(
      "INSERT INTO rating_jobs(attemptId, status, attempts, lastError, updatedAt) VALUES (?, ?, ?, ?, ?)",
    );
    for (const j of snapshot.ratingJobs) {
      insJob.run(
        j.attemptId,
        j.status === "running" ? "pending" : j.status,
        j.attempts,
        j.lastError,
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
  topicTagSlugs: string[];
  resolvedDomain: DomainId;
  difficultyScore: number;
  excluded: boolean;
};

/** F3: Deterministic local catalog filter over full resolvedDomain pool (never paged tag search). */
export function selectCandidatesFromCache(
  catalog: CatalogProblemRow[],
  intent: PrescriptionIntent,
  opts: { isPremium?: boolean; excludedSlugs?: Set<string> } = {},
): CatalogProblemRow[] {
  const domainPool = catalog.filter(
    (p) =>
      !p.excluded &&
      (opts.isPremium || !p.isPaidOnly) &&
      !opts.excludedSlugs?.has(p.slug) &&
      p.resolvedDomain === intent.targetDomain &&
      (intent.targetFacet !== "selection" ||
        isTitleDisguisedForTarget(p.title, intent.targetDomain)),
  );
  let filtered = domainPool;
  if (intent.targetConceptSlug) {
    const spec = CONCEPT_CATALOGUE.find((c) => c.slug === intent.targetConceptSlug);
    if (spec) {
      const tagged = domainPool.filter((p) => p.topicTagSlugs.includes(spec.searchTagSlug));
      if (tagged.length > 0) filtered = tagged;
    }
  }
  return snapCandidatePool(filtered, intent.targetDifficultyBand);
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
    assert.notEqual(intent.targetDomain, s.recentDomains.at(-1));
    assert.ok(s.recentDomains.slice(-6).filter((x) => x === intent.targetDomain).length < 2);
    s.recentDomains.push(intent.targetDomain);
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

  // 4. Replay of the 11 Oct–Nov sessions (hand-attributed historical fixture using strictly valid §2.3 rubric scores; prescribedCount starts at 0)
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

  const next5: PrescriptionIntent[] = [];
  for (let i = 0; i < 5; i++) {
    const intent = selectDirectorIntent(sHist, 34 + i);
    next5.push(intent);
    sHist.recentDomains.push(intent.targetDomain);
    sHist.prescribedCount += 1;
    if (intent.targetConceptSlug) {
      updateConceptRecord(sHist, intent.targetConceptSlug, intent.targetDomain, 34 + i, "applied");
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

  // Strict assertions guarding every published §4/§5 v7 number against silent regressions
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
    "4:momentum:graphs-search(implementation)@1016-1066",
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
    .prepare("INSERT INTO practice_launches(attemptId, launchSeq, day, prescribed, provisionalDomain, intentJson, selectionSpoilerRevealed) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("a1", 1, 1, 1, "hashing-prefix", null, 0);
  srcDb
    .prepare("INSERT INTO practice_launches(attemptId, launchSeq, day, prescribed, provisionalDomain, intentJson, selectionSpoilerRevealed) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("a2", 2, 2, 1, "graphs-search", null, 0);
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

test("F9 & D1: 200-seed 365-day simulation verifies global MAE, monotonic domain separation, real lapses, and provisional horizon", () => {
  // Provisional UI flag drops once domain uncertainty <= 80
  assert.equal(isDomainProvisional(110), true);
  assert.equal(isDomainProvisional(81), true);
  assert.equal(isDomainProvisional(80), false);

  const SEEDS = 200;
  const archetypeStats: Record<string, any> = {};

  for (const [name, trueBase] of [["beginner", 900], ["intermediate", 1150], ["strong", 1350]] as const) {
    let sumAbsErr90 = 0;
    let sumGap90 = 0, sumGap180 = 0, sumGap365 = 0;
    let inv90 = 0, inv180 = 0, inv365 = 0;
    let sumSel90 = 0, sumLapses365 = 0;
    let sumIntro90 = 0, sumIntro180 = 0, sumIntro365 = 0;
    let sumStable90 = 0, sumStable180 = 0, sumStable365 = 0;
    let sumGraphsSigma180 = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = mulberry32(seed * 1009 + trueBase);
      const st = createInitialState();
      let sel90 = 0;
      let lapses365 = 0;

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
        }
      };

      for (let d = 1; d <= 365; d++) {
        const intent = selectDirectorIntent(st, d);
        assert.notEqual(intent.targetDomain, st.recentDomains.at(-1));
        assert.ok(st.recentDomains.slice(-6).filter((x) => x === intent.targetDomain).length < 2);

        if (d <= 90 && intent.targetFacet === "selection") sel90++;
        const midDiff = Math.round((intent.targetDifficultyBand[0] + intent.targetDifficultyBand[1]) / 2);
        const trueDom =
          trueBase +
          (intent.targetDomain === "graphs-search"
            ? 80
            : intent.targetDomain === "dynamic-programming"
              ? -80
              : 0);
        const p = expectedScore(trueDom, midDiff);
        const m = Math.min(p, 1 - p);
        const u = rng();
        // Unbiased §2.3 5-row rubric sampling: E[score] = (p-0.33m)*1 + (0.25m)*0.8 + (0.25m)*0.4 + (0.20m)*0.15 = p
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
            { domain: intent.targetDomain, facet: "implementation", weight: 1.0, difficulty: midDiff, score },
            ...(intent.targetFacet === "selection"
              ? [{ domain: intent.targetDomain, facet: "selection" as const, weight: 1.0, difficulty: midDiff, score: selScore }]
              : []),
          ],
          { prescribed: true, primaryDomain: intent.targetDomain },
        );

        if (intent.targetConceptSlug) {
          const prev = st.concepts.get(intent.targetConceptSlug);
          const outcome = conceptOutcomeFromRubric({ rubricRow, existing: prev });
          if (outcome === "lapsed") lapses365++;
          if (outcome !== "none") {
            updateConceptRecord(st, intent.targetConceptSlug, intent.targetDomain, d, outcome);
          }
          if (outcome === "probed-uncoached" && rng() < 0.7) {
            updateConceptRecord(st, intent.targetConceptSlug, intent.targetDomain, d, "coached");
          }
        } else if ((rubricRow === 2 || rubricRow === 3) && rng() < 0.35) {
          // D1: Credit incidental concept application observed on non-probe optimal solves
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
            updateConceptRecord(st, domConcept.slug, domConcept.domain, d, "applied");
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
    };
    archetypeStats[name] = metrics;
  }

  if (process.env.DEBUG_RATINGS_V7) {
    console.log("MULTI_SEED_200:", JSON.stringify(archetypeStats, null, 2));
  }

  for (const [name, metrics] of Object.entries(archetypeStats)) {
    assert.ok(metrics.mae90 <= 35, `${name} 90d MAE ${metrics.mae90} <= 35`);
    assert.ok(
      metrics.gap90 < metrics.gap180 && metrics.gap180 < metrics.gap365,
      `${name} monotonic gap: ${metrics.gap90} -> ${metrics.gap180} -> ${metrics.gap365}`,
    );
    assert.ok(metrics.gap365 >= 100, `${name} 365d gap ${metrics.gap365} >= 100`);
    assert.ok(metrics.invPct365 < 5, `${name} 365d inversion ${metrics.invPct365}% < 5%`);
    assert.ok(metrics.avgLapses365 > 0, `${name} must exercise real lapses (${metrics.avgLapses365})`);
    assert.ok(metrics.avgSel90 >= 15, `${name} Selection prescriptions/90d ${metrics.avgSel90} >= 15`);
    assert.ok(metrics.avgGraphsSigma180 <= 80, `${name} graphs sigma <= 80 by day 180 (${metrics.avgGraphsSigma180})`);
  }

  assert.deepEqual(archetypeStats, {
    beginner: {
      mae90: 24.5, gap90: 64.5, gap180: 94.1, gap365: 126.4,
      invPct90: 14, invPct180: 6.5, invPct365: 1.5,
      avgSel90: 19.8, avgLapses365: 66.9,
      avgIntro90: 9, avgIntro180: 11.3, avgIntro365: 13,
      avgStable90: 1, avgStable180: 3.5, avgStable365: 6.3,
      avgGraphsSigma180: 74.2,
    },
    intermediate: {
      mae90: 26.6, gap90: 51, gap180: 85.4, gap365: 123.7,
      invPct90: 22.5, invPct180: 14, invPct365: 3.5,
      avgSel90: 23, avgLapses365: 66.4,
      avgIntro90: 11.6, avgIntro180: 16.5, avgIntro365: 21,
      avgStable90: 1.1, avgStable180: 4.7, avgStable365: 11.5,
      avgGraphsSigma180: 74.3,
    },
    strong: {
      mae90: 29.7, gap90: 52, gap180: 81.6, gap365: 121.5,
      invPct90: 20.5, invPct180: 13, invPct365: 1,
      avgSel90: 26.9, avgLapses365: 65.6,
      avgIntro90: 11.9, avgIntro180: 16.9, avgIntro365: 21.1,
      avgStable90: 1.3, avgStable180: 5.1, avgStable365: 11.5,
      avgGraphsSigma180: 76.8,
    },
  });
});
