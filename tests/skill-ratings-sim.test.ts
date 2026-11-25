import assert from "node:assert/strict";
import test from "node:test";

// ============================================================================
// Reference deterministic implementation of Skill Ratings Design v5
// Verifies every equation, resolver rank, concept table entry, band, ladder,
// historical replay, and 90-day synthetic convergence cited in SKILL_RATINGS_DESIGN.md.
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

// Total priority order across all 52 mapped LeetCode topicTags.slug values (1 = highest specificity).
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
  { order: 19, slug: "topological-sort", label: "DAG Indegree & Cycle Topological Sort", domain: "graphs-search", searchTagSlug: "topological-sort", minGlobalMu: 1020 },
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
  const primary = options.primaryDomain ?? implUpdates[0]?.domain;
  if (primary) state.recentDomains.push(primary);
  if (options.prescribed) state.prescribedCount += 1;

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
    prev.stabilityDays = Math.max(4, prev.stabilityDays);
    prev.lastEvaluatedDay = day;
  } else if (outcome === "lapsed") {
    // P2 #5: Bound lapse stability by previous stability (e.g. 4d -> 2d, never increases!)
    prev.stabilityDays = Math.min(prev.stabilityDays, 10, Math.max(2, 0.25 * prev.stabilityDays));
    prev.lapses += 1;
    prev.lastEvaluatedDay = day;
  }
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
    if (slotIndex === 1 && fragileCount < 3) {
      const probeable = CONCEPT_CATALOGUE.find((c) => {
        if (!isEligible(c.domain) || state.globalMu < c.minGlobalMu) return false;
        const rec = state.concepts.get(c.slug);
        if (!rec) return true;
        if (rec.state !== "probed") return false;
        return rec.probeCount < 2 && day - rec.lastEvaluatedDay >= 14;
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

/** B5 guardrail: unused alternative domain gets Selection=0.20 ONLY on asymptotic gap + known concept! */
export function evaluateMissedTargetSelection(args: {
  usedOptimalComplexity: boolean;
  targetConceptRecord?: ConceptRecord;
}): { penalizeSelection: boolean; conceptOutcome: "none" | "probed-uncoached" | "lapsed" } {
  if (args.usedOptimalComplexity) {
    // Solved optimally via a valid alternative route -> NEVER penalize Selection or lapse!
    return {
      penalizeSelection: false,
      conceptOutcome:
        !args.targetConceptRecord || args.targetConceptRecord.state === "probed"
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
  return { penalizeSelection: false, conceptOutcome: "probed-uncoached" };
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

  // B3: 24 concepts all reference valid domains & mapped slugs, and uncoached probes cool down
  assert.equal(CONCEPT_CATALOGUE.length, 24);
  for (const c of CONCEPT_CATALOGUE) {
    assert.ok(DOMAINS.includes(c.domain));
    assert.ok(SLUG_TO_ENTRY.has(c.searchTagSlug));
  }
  const s = createInitialState();
  const intent1 = selectDirectorIntent(initWithStep(s, 1), 1);
  assert.equal(intent1.slotKind, "concept-probe");
  assert.equal(intent1.targetConceptSlug, "in-place-array-scan");
  updateConceptRecord(s, "in-place-array-scan", "arrays-strings", 1, "probed-uncoached");
  const intentNext = selectDirectorIntent(initWithStep(s, 1), 3);
  assert.notEqual(intentNext.targetConceptSlug, "in-place-array-scan");
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

  // 4. Replay of the 11 Oct–Nov sessions (historical/self-picked do not advance prescribedCount, so prescribedCount starts at 0!)
  const sHist = createInitialState();
  const realSessions: Array<{
    day: number;
    fam: "new" | "revisit" | "solved";
    updates: DomainFacetUpdate[];
    concept: [string, DomainId, "coached" | "applied"];
  }> = [
    { day: 1, fam: "new", updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 920, score: 0.45 }], concept: ["prefix-sum-map", "hashing-prefix", "coached"] },
    { day: 2, fam: "solved", updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 850, score: 1.0 }, { domain: "hashing-prefix", facet: "selection", weight: 1, difficulty: 850, score: 1.0 }], concept: ["hash-map-set", "hashing-prefix", "applied"] },
    { day: 2, fam: "new", updates: [{ domain: "binary-search", facet: "implementation", weight: 1, difficulty: 960, score: 1.0 }], concept: ["binary-search-index", "binary-search", "applied"] },
    { day: 2, fam: "solved", updates: [{ domain: "stacks-queues-linked", facet: "implementation", weight: 1, difficulty: 860, score: 0.8 }], concept: ["lifo-fifo-state", "stacks-queues-linked", "applied"] },
    { day: 2, fam: "new", updates: [{ domain: "stacks-queues-linked", facet: "implementation", weight: 1, difficulty: 880, score: 0.45 }], concept: ["linked-list-pointers", "stacks-queues-linked", "coached"] },
    { day: 2, fam: "new", updates: [{ domain: "sorting-intervals", facet: "implementation", weight: 1, difficulty: 1120, score: 0.45 }], concept: ["custom-comparator-intervals", "sorting-intervals", "coached"] },
    { day: 3, fam: "new", updates: [{ domain: "binary-search", facet: "implementation", weight: 1, difficulty: 1220, score: 0.4 }, { domain: "binary-search", facet: "selection", weight: 1, difficulty: 1220, score: 0.4 }], concept: ["binary-search-index", "binary-search", "coached"] },
    { day: 4, fam: "new", updates: [{ domain: "two-pointers-window", facet: "implementation", weight: 1, difficulty: 1180, score: 0.45 }, { domain: "two-pointers-window", facet: "selection", weight: 1, difficulty: 1180, score: 0.8 }], concept: ["variable-sliding-window", "two-pointers-window", "coached"] },
    { day: 5, fam: "new", updates: [{ domain: "graphs-search", facet: "implementation", weight: 1, difficulty: 1140, score: 1.0 }, { domain: "graphs-search", facet: "selection", weight: 1, difficulty: 1140, score: 1.0 }], concept: ["grid-graph-bfs-dfs", "graphs-search", "applied"] },
    { day: 29, fam: "new", updates: [{ domain: "hashing-prefix", facet: "implementation", weight: 1, difficulty: 920, score: 1.0 }, { domain: "hashing-prefix", facet: "selection", weight: 1, difficulty: 920, score: 1.0 }], concept: ["hash-map-set", "hashing-prefix", "applied"] },
    { day: 29, fam: "new", updates: [{ domain: "heaps-ordered", facet: "implementation", weight: 0.5, difficulty: 900, score: 0.35 }, { domain: "two-pointers-window", facet: "selection", weight: 0.5, difficulty: 900, score: 0.45 }], concept: ["converging-two-pointers", "two-pointers-window", "coached"] },
  ];
  for (const s of realSessions) {
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

  // 5. 90-day synthetic convergence across Beginner (900), Intermediate (1150), Strong (1350)
  const summary: Record<string, any> = {
    replayBeforePrescriptions: replaySnapshot,
    fourCleanEasiesGlobal: (() => {
      const s4 = createInitialState();
      for (const [i, d] of (["hashing-prefix", "two-pointers-window", "stacks-queues-linked", "binary-search"] as const).entries()) {
        applyAttemptGraded(s4, i + 1, [
          { domain: d, facet: "implementation", weight: 1, difficulty: 920, score: 1 },
          { domain: d, facet: "selection", weight: 1, difficulty: 920, score: 1 },
        ]);
      }
      return `${Math.round(s4.globalMu)}±${Math.round(s4.globalSigma)}`;
    })(),
    next5: next5.map((x) => `${x.slotIndex}:${x.slotKind}:${x.targetDomain}(${x.targetFacet})${x.targetConceptSlug ? `:${x.targetConceptSlug}` : ""}@${x.targetDifficultyBand[0]}-${x.targetDifficultyBand[1]}`),
    synthetic: {},
  };
  for (const [name, trueBase] of [["beginner", 900], ["intermediate", 1150], ["strong", 1350]] as const) {
    const st = createInitialState();
    let selPrescriptions = 0;
    for (let d = 1; d <= 90; d++) {
      const intent = selectDirectorIntent(st, d);
      assert.notEqual(intent.targetDomain, st.recentDomains.at(-1), `${name} day ${d}: consecutive domain repeat`);
      assert.ok(
        st.recentDomains.slice(-6).filter((x) => x === intent.targetDomain).length < 2,
        `${name} day ${d}: >2 occurrences of ${intent.targetDomain} in last 6 attempts`,
      );
      if (intent.targetFacet === "selection") selPrescriptions++;
      const midDiff = Math.round((intent.targetDifficultyBand[0] + intent.targetDifficultyBand[1]) / 2);
      const trueDom = trueBase + (intent.targetDomain === "graphs-search" ? 80 : intent.targetDomain === "dynamic-programming" ? -80 : 0);
      const p = expectedScore(trueDom, midDiff);
      const u = (d * 0.61803398875) % 1;
      const m = Math.min(p, 1 - p);
      const score = u < p - 0.2 * m ? 1.0 : u < p + 0.2 * m ? 0.5 : 0.0;
      applyAttemptGraded(
        st,
        d,
        [
          { domain: intent.targetDomain, facet: "implementation", weight: 1.0, difficulty: midDiff, score },
          ...(intent.targetFacet === "selection"
            ? [{ domain: intent.targetDomain, facet: "selection" as const, weight: 1.0, difficulty: midDiff, score }]
            : []),
        ],
        { prescribed: true, primaryDomain: intent.targetDomain },
      );
      if (intent.targetConceptSlug) {
        updateConceptRecord(
          st,
          intent.targetConceptSlug,
          intent.targetDomain,
          d,
          score >= 0.5 ? "applied" : "coached",
        );
      }
    }
    assert.ok(selPrescriptions >= 8, `${name} should schedule disguised Selection prescriptions`);
    summary.synthetic[name] = {
      global: `${Math.round(st.globalMu)}±${Math.round(st.globalSigma)}`,
      graphsImpl: Math.round(st.globalMu + st.domains["graphs-search"].implOffset),
      dpImpl: Math.round(st.globalMu + st.domains["dynamic-programming"].implOffset),
      selPrescriptions,
    };
  }

  // P2 #8: Strict assertions guarding every published §4/§5 number against silent regressions
  assert.equal(summary.fourCleanEasiesGlobal, "1167±146");
  assert.deepEqual(summary.replayBeforePrescriptions, {
    global: "1088±112",
    domains: {
      "graphs-search": { impl: 1130, implSigma: 107, sel: 1130 },
      "hashing-prefix": { impl: 1099, implSigma: 107, sel: 1108 },
      "binary-search": { impl: 1125, implSigma: 106, sel: 1102 },
      "two-pointers-window": { impl: 1100, implSigma: 108, sel: 1107 },
      "sorting-intervals": { impl: 1097, implSigma: 107, sel: 1088 },
      "stacks-queues-linked": { impl: 1068, implSigma: 108, sel: 1088 },
      "heaps-ordered": { impl: 1069, implSigma: 109, sel: 1088 },
    },
  });
  assert.deepEqual(summary.next5, [
    "0:growth:stacks-queues-linked(selection)@1043-1098",
    "1:breadth:arrays-strings(implementation)@1043-1098",
    "2:consolidation:hashing-prefix(implementation):prefix-sum-map@1059-1104",
    "3:consolidation:sorting-intervals(implementation):custom-comparator-intervals@1057-1102",
    "4:momentum:graphs-search(implementation)@1025-1075",
  ]);
  assert.deepEqual(summary.synthetic, {
    beginner: { global: "889±50", graphsImpl: 947, dpImpl: 875, selPrescriptions: 28 },
    intermediate: { global: "1119±50", graphsImpl: 1150, dpImpl: 1082, selPrescriptions: 38 },
    strong: { global: "1326±50", graphsImpl: 1320, dpImpl: 1359, selPrescriptions: 28 },
  });
});
