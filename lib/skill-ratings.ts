// Browser-safe pure implementation of Skill Ratings v9 & Prescription / Onboarding v2.
// Keep zero Node built-in imports here so both Next.js Server and Client modules can import it.

import type { LanguageId } from "./languages";
import type { Attempt } from "./types";

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

export const DOMAIN_LABELS: Record<DomainId, string> = {
  "arrays-strings": "Arrays, Strings & Simulation",
  "hashing-prefix": "Hashing & Prefix State",
  "two-pointers-window": "Two Pointers & Sliding Window",
  "sorting-intervals": "Sorting & Intervals",
  "stacks-queues-linked": "Stacks, Queues & Linked Lists",
  "binary-search": "Binary Search",
  "heaps-ordered": "Heaps & Ordered Collections",
  "trees-recursion": "Trees & Divide-and-Conquer",
  "graphs-search": "Graphs & Grid Search",
  backtracking: "Backtracking",
  "dynamic-programming": "Dynamic Programming",
  greedy: "Greedy",
  "math-bitwise": "Math & Bit Manipulation",
};

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
  backtracking: 980,
  "dynamic-programming": 800,
  greedy: 800,
  "math-bitwise": 800,
};

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
    if (s === "recursion") continue;
    const entry = SLUG_TO_ENTRY.get(s);
    if (entry && (!best || entry.rank < best.rank)) best = entry;
  }
  if (best && best.rank <= 46) return best.domain;
  if (slugs.includes("recursion")) return "trees-recursion";
  return best ? best.domain : "arrays-strings";
}

export function resolvePrimaryDomain(slug: string, topicTagSlugs: string[]): DomainId {
  return CANONICAL_PROBLEM_OVERRIDES[slug] ?? resolvePrimaryDomainFromSlugs(topicTagSlugs);
}

export function tagToSlug(tag: { name: string; slug?: string }): string {
  if (tag.slug) return tag.slug;
  return tag.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ConceptSpec = {
  order: number;
  slug: string;
  label: string;
  domain: DomainId;
  searchTagSlug: string;
  minGlobalMu: number;
};

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

// Mathematical constants
export const SCALE = 320;
export const Q = Math.LN10 / SCALE;
export const SIGMA_PROBLEM = 55;
export const GRACE_IDLE_DAYS = 21;
export const C_DRIFT = 7.0;
export const RUST_IDLE_DAYS = 45;
export const PROVISIONAL_SIGMA_THRESHOLD = 80;
export const MAX_FRAGILE_CONCEPTS = 4;
export const VALID_RUBRIC_SCORES = new Set([0, 0.15, 0.2, 0.3, 0.35, 0.4, 0.5, 0.65, 0.75, 0.8, 0.9, 1]);

export type RubricRow = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function scoresForRubricRow(row: RubricRow, accepted: boolean): {
  implScore: number;
  selScore: number;
} {
  switch (row) {
    case 1:
      return accepted ? { implScore: 0.35, selScore: 0.3 } : { implScore: 0.15, selScore: 0.15 };
    case 2:
      return { implScore: 1.0, selScore: 1.0 };
    case 3:
      return { implScore: 0.8, selScore: 0.9 };
    case 4:
      return { implScore: 0.65, selScore: 0.5 };
    case 5:
      return { implScore: 0.4, selScore: 0.75 };
    case 6:
      return { implScore: 0.15, selScore: 0.35 };
    case 7:
      return { implScore: 0, selScore: 0 };
  }
}

export function isDomainProvisional(sigma: number): boolean {
  return sigma > PROVISIONAL_SIGMA_THRESHOLD;
}

export type StartingTier = "foundations" | "interview-prep" | "experienced";

export const DEFAULT_STARTING_TIER: StartingTier = "foundations";

export type OnboardingState = {
  startingTier: StartingTier;
  welcomeDismissed: boolean;
};

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

export function shouldShowWelcomePicker(opts: {
  welcomeDismissed: boolean;
  prescribedCount: number;
}): boolean {
  return !opts.welcomeDismissed && opts.prescribedCount === 0;
}

export function standardMinutes(difficultyScore: number): number {
  if (difficultyScore <= 950) return 15;
  if (difficultyScore <= 1080) return 20;
  if (difficultyScore <= 1250) return 25;
  if (difficultyScore <= 1400) return 35;
  return 45;
}

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

export function isManualTimeboxRated(prescribedMinutes: number, chosenMinutes: number): boolean {
  return Math.abs(chosenMinutes - prescribedMinutes) <= 5;
}

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

export function problemBaseDifficulty(
  difficulty: "Easy" | "Medium" | "Hard",
  acRatePct = 55,
  modifier = 0,
): number {
  const safeAc = Number.isFinite(acRatePct) ? acRatePct : 55;
  const a = safeAc > 1 ? safeAc / 100 : safeAc;
  const mod = Math.max(-50, Math.min(50, modifier));
  let base: number;
  if (difficulty === "Easy") {
    base = 800 + 280 * clamp01((0.85 - a) / 0.55);
  } else if (difficulty === "Medium") {
    base = 980 + 420 * clamp01((0.8 - a) / 0.55);
  } else {
    base = 1340 + 460 * clamp01((0.7 - a) / 0.5);
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

export function retrievability(daysElapsed: number, stabilityDays: number): number {
  if (stabilityDays <= 0) return 0;
  if (daysElapsed <= 0) return 1;
  return 1 / (1 + daysElapsed / (9 * stabilityDays));
}

export type ConceptRecord = {
  slug: string;
  domain: DomainId;
  state: "probed" | "coached" | "applied";
  stabilityDays: number;
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

export type LearnerRatingState = {
  globalMu: number;
  globalSigma: number;
  globalLastDay: number | null;
  domains: Record<
    DomainId,
    {
      implOffset: number;
      implSigma: number;
      implFreshSigma: number;
      selOffset: number;
      selSigma: number;
      selFreshSigma: number;
      lastDay: number | null;
      implAttempts: number;
    }
  >;
  concepts: Map<string, ConceptRecord>;
  recentDomains: DomainId[];
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

  const touched = new Set(updates.map((u) => u.domain));
  for (const d of touched) {
    const dom = state.domains[d];
    if (dom.lastDay !== null && day > dom.lastDay) {
      dom.implSigma = driftedSigma(dom.implSigma, day - dom.lastDay, 45, 150);
      dom.selSigma = driftedSigma(dom.selSigma, day - dom.lastDay, 55, 150);
    }
  }

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
    if (prev.state === "coached") {
      prev.stabilityDays = Math.min(prev.stabilityDays, 4);
      prev.lastEvaluatedDay = Math.max(prev.lastEvaluatedDay, day);
    }
  } else if (outcome === "lapsed") {
    prev.stabilityDays = Math.min(prev.stabilityDays, 10, Math.max(2, 0.25 * prev.stabilityDays));
    prev.lapses += 1;
    prev.lastEvaluatedDay = day;
    state.recentStruggles.push({ domain, day, conceptSlug: slug });
  }
}

export function conceptOutcomeFromRubric(args: {
  rubricRow: RubricRow;
  usedOptimalAlternative?: boolean;
  existing?: ConceptRecord;
}): "applied" | "lapsed" | "probed-uncoached" | "none" {
  if (args.usedOptimalAlternative) {
    return !args.existing || args.existing.state === "probed" ? "probed-uncoached" : "none";
  }
  if (args.rubricRow === 2 || args.rubricRow === 3) {
    return "applied";
  }
  if (args.existing && (args.existing.state === "coached" || args.existing.state === "applied")) {
    return "lapsed";
  }
  return "probed-uncoached";
}

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

  // Fallback Free Seeds for Remaining 8 Easy-Backed Domains (24)
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

export function seedCatalogRows(solvedSlugs?: Set<string>): CatalogProblemRow[] {
  return ONBOARDING_SEED_PROBLEMS.map((s) => ({
    slug: s.slug,
    title: s.title,
    difficulty: s.difficulty,
    acRate: s.acRate,
    isPaidOnly: false,
    status: solvedSlugs?.has(s.slug) ? "ac" : null,
    topicTagSlugs: s.topicTagSlugs,
    resolvedDomain: s.domain,
    difficultyScore: problemBaseDifficulty(s.difficulty, s.acRate),
    signatureForced: isSignatureForcedFromSlugs(s.topicTagSlugs),
    excluded: false,
  }));
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

  const rusty = eligible.filter(
    (d) => displayRating(state, d, "implementation", day).rusty,
  );
  if (rusty.length > 0) {
    return buildIntent(rusty[0]);
  }

  const strongest = [...eligible].sort(
    (a, b) =>
      state.domains[b].implOffset - state.domains[a].implOffset ||
      domainIndex(a) - domainIndex(b),
  )[0];
  return buildIntent(strongest);
}

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
  if (!eligible.length) {
    eligible = DOMAINS.filter((d) => passesGlobalGate(d) && d !== prevDomain);
  }
  if (!eligible.length) {
    eligible = DOMAINS.filter(passesGlobalGate);
  }

  const slotIndex = state.prescribedCount % 5;

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

  if (slotIndex === 4 && state.lastPrescribedSlotKind !== "easy-reinforcement") {
    return selectEasyReinforcementTarget(state, eligible, day, slotIndex, validPrefs?.maxMinutes);
  }

  const lcb = (d: DomainId) => {
    const dom = state.domains[d];
    const implLcb = dom.implOffset - 0.6 * dom.implSigma;
    if ((disguisableCounts?.[d] ?? 99) < 5) return implLcb;
    return Math.min(implLcb, dom.selOffset - 0.6 * dom.selSigma);
  };

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

export function evaluateMissedTargetSelection(args: {
  usedOptimalComplexity: boolean;
  targetConceptRecord?: ConceptRecord;
  domainHasKnownConcept?: boolean;
  hasTargetConcept?: boolean;
}): { penalizeSelection: boolean; conceptOutcome: "none" | "probed-uncoached" | "lapsed" } {
  const hasTargetConcept = args.hasTargetConcept ?? Boolean(args.targetConceptRecord);
  if (args.usedOptimalComplexity) {
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

// Launch Ledger & Deterministic Replay
export type PracticeLaunchRow = {
  attemptId: string;
  launchSeq: number;
  day: number;
  startedAt?: number;
  prescribed: boolean;
  rated?: boolean;
  language?: LanguageId;
  provisionalDomain: DomainId;
  difficultyScore?: number;
  difficultyModifier?: number;
  standardMinutes?: number;
  prescribedMinutes?: number;
  intent?: PrescriptionIntent;
  selectionSpoilerRevealed?: boolean;
};

export type RatingJobRow = {
  attemptId: string;
  status: "pending" | "running" | "complete" | "failed";
  attempts: number;
  lastError: string | null;
  claimOwnerId?: string | null;
  claimExpiresAt?: number | null;
  updatedAt: number;
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
    fromEasyReinforcement: boolean;
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
    state.lastPracticedDomain = domainForCooldown;
    if (launch.prescribed) {
      state.prescribedRecentDomains.push(domainForCooldown);
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

    if (effective && !excluded) {
      const isRated = Boolean(launch.rated ?? launch.prescribed);
      const isFromEasyReinf = launch.intent?.slotKind === "easy-reinforcement";
      const totalRescueDelta = rescues.reduce((s, r) => s + Math.max(0, r.payload.scoreDelta), 0);
      const adjustedUpdates = effective.updates.map((u) => {
        const spoiled =
          u.facet === "selection" &&
          (launch.selectionSpoilerRevealed || launch.intent?.steeredDomainExplicit);
        return {
          ...u,
          weight: spoiled ? 0 : u.weight,
          score:
            u.facet === "implementation" && totalRescueDelta > 0
              ? Math.min(0.65, u.score + totalRescueDelta)
              : u.score,
        };
      });
      if (isRated) {
        applyAttemptGraded(state, launch.day, adjustedUpdates, {
          familiarity: effective.familiarity,
          prescribed: launch.prescribed,
          primaryDomain: effective.primaryDomain,
          trackLaunchInReducer: false,
          slotKind: launch.intent?.slotKind,
          targetedConceptSlug: launch.intent?.targetConceptSlug,
          statedComplexity: effective.statedComplexity,
        });
      } else if (effective.statedComplexity) {
        state.complexityCalibration.time[effective.statedComplexity.time] += 1;
        state.complexityCalibration.space[effective.statedComplexity.space] += 1;
      }
      if (isRated) {
        for (const c of effective.conceptOutcomes ?? []) {
          conceptTransitions.push({
            occurredDay: graded?.occurredDay ?? launch.day,
            launchSeq: launch.launchSeq,
            phaseRank: 0,
            eventId: graded?.id ?? `ev:${launch.attemptId}`,
            slug: c.slug,
            domain: c.domain,
            outcome: c.outcome,
            fromEasyReinforcement: isFromEasyReinf,
          });
        }
      }
    }

    if (launch.rated ?? launch.prescribed) {
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
            fromEasyReinforcement: false,
          });
        }
      }
    }
  }

  for (const ev of events) {
    if (ev.kind === "concept-event") {
      const launch = sortedLaunches.find((l) => l.attemptId === ev.attemptId);
      if (launch && !(launch.rated ?? launch.prescribed)) continue;
      const p = ev.payload as ConceptEventPayload;
      conceptTransitions.push({
        occurredDay: ev.occurredDay,
        launchSeq: ev.launchSeq,
        phaseRank: 1,
        eventId: ev.id,
        slug: p.slug,
        domain: p.domain,
        outcome: p.outcome,
        fromEasyReinforcement: false,
      });
    }
  }

  conceptTransitions.sort(
    (a, b) =>
      a.occurredDay - b.occurredDay ||
      a.launchSeq - b.launchSeq ||
      a.phaseRank - b.phaseRank ||
      a.eventId.localeCompare(b.eventId),
  );
  for (const t of conceptTransitions) {
    updateConceptRecord(state, t.slug, t.domain, t.occurredDay, t.outcome, {
      fromEasyReinforcement: t.fromEasyReinforcement,
    });
  }

  return state;
}

export type RatingLedgerSnapshot = {
  launches: PracticeLaunchRow[];
  ratingJobs: RatingJobRow[];
  ratingEvents: SkillRatingEventRow[];
};

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

// Disguise, Shortlisting, Escape Hatch & Steering
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
  frontendId?: string;
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
  const prescribedHistory =
    args.state.prescribedRecentDomains.length > 0 || args.state.lastPracticedDomain !== null
      ? args.state.prescribedRecentDomains
      : args.state.recentDomains;

  const tryInspect = (curIntent: PrescriptionIntent): CatalogProblemRow | null => {
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
    return null;
  };

  const hit1 = tryInspect(args.intent);
  if (hit1) return { intent: args.intent, chosen: hit1, strategy: "primary", inspectedSlugs };
  if (inspectedSlugs.length < maxTotal) {
    const hit2 = tryInspect(args.intent);
    if (hit2) return { intent: args.intent, chosen: hit2, strategy: "batch-2", inspectedSlugs };
  }

  const widenedIntent: PrescriptionIntent = {
    ...args.intent,
    targetDifficultyBand: [
      Math.max(800, args.intent.targetDifficultyBand[0] - 60),
      Math.min(1850, args.intent.targetDifficultyBand[1] + 60),
    ],
  };
  if (inspectedSlugs.length < maxTotal) {
    const hitWide = tryInspect(widenedIntent);
    if (hitWide) return { intent: widenedIntent, chosen: hitWide, strategy: "widened", inspectedSlugs };
  }

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
    const hitRot = tryInspect(rotatedIntent);
    if (hitRot) return { intent: rotatedIntent, chosen: hitRot, strategy: "rotated", inspectedSlugs };
  }

  return { intent: args.intent, chosen: null, strategy: "rotated", inspectedSlugs };
}

export type PrescriptionOverrideInput = {
  domainOverride?: DomainId;
  domainPoolOverride?: DomainId[];
  slotOverride?: "easy-reinforcement" | "growth" | "consolidation" | "breadth" | "stretch";
  maxMinutes?: number;
  excludeSlug?: string;
};

export function adjustPrescriptionIntent(args: {
  state: LearnerRatingState;
  currentIntent: PrescriptionIntent;
  catalog: CatalogProblemRow[];
  isPremium: boolean;
  skippedSlugs: Set<string>;
  preferences?: DirectorPreferences;
  day: number;
  seed?: number;
  override: PrescriptionOverrideInput;
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

export function didCoachLeakSelectionTarget(texts: string[], targetDomain: DomainId): boolean {
  const rx = REVEALING_TITLE_PATTERNS[targetDomain];
  return rx ? texts.some((t) => rx.test(t)) : false;
}

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

export function validateInspectedStarter(
  rawProblem: {
    titleSlug: string;
    locked: boolean;
    javaStarter?: string | null;
    cppStarter?: string | null;
    content: string;
    systemdesign?: boolean;
  },
  language: LanguageId,
): { available: boolean; starter?: string; reason?: string } {
  const starter = language === "cpp" ? rawProblem.cppStarter : rawProblem.javaStarter;
  if (rawProblem.locked || !starter || !rawProblem.content.trim() || rawProblem.systemdesign) {
    return { available: false, reason: `Locked or no ${language} starter.` };
  }
  return { available: true, starter };
}

export type SavedPrescriptionRecord = {
  id: string;
  slug: string;
  language: LanguageId;
  createdAt: number;
  intent: PrescriptionIntent;
  contextKey: string;
  difficultyScore?: number;
  difficultyModifier?: number;
  standardMinutes?: number;
  minutes?: number;
  selectionSpoilerRevealed?: boolean;
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
  | {
      mode: "prescribed" | "prescribed-stale-honored";
      rated: true;
      record: SavedPrescriptionRecord;
      intent: PrescriptionIntent;
    }
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
    return { mode: "prescribed", rated: true, record: rec, intent: rec.intent };
  }
  return { mode: "prescribed-stale-honored", rated: true, record: rec, intent: rec.intent };
}

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

export type CatalogSyncState = {
  nextSkip: number;
  totalNum: number | null;
  lastCompletedAt: number | null;
  consecutiveErrors: number;
  backoffMs: number;
  backoffUntil: number | null;
  lastError: string | null;
};

export class CatalogSyncManager {
  nextSkip: number;
  totalNum: number | null;
  lastCompletedAt: number | null;
  consecutiveErrors: number;
  backoffMs: number;
  backoffUntil: number | null;
  lastError: string | null;

  constructor(initial?: Partial<CatalogSyncState>) {
    this.nextSkip = initial?.nextSkip ?? 0;
    this.totalNum = initial?.totalNum ?? null;
    this.lastCompletedAt = initial?.lastCompletedAt ?? null;
    this.consecutiveErrors = initial?.consecutiveErrors ?? 0;
    this.backoffMs = initial?.backoffMs ?? 0;
    this.backoffUntil = initial?.backoffUntil ?? null;
    this.lastError = initial?.lastError ?? null;
  }

  toJSON(): CatalogSyncState {
    return {
      nextSkip: this.nextSkip,
      totalNum: this.totalNum,
      lastCompletedAt: this.lastCompletedAt,
      consecutiveErrors: this.consecutiveErrors,
      backoffMs: this.backoffMs,
      backoffUntil: this.backoffUntil,
      lastError: this.lastError,
    };
  }

  needsRefresh(now = Date.now(), ttlMs = 7 * 86400_000): boolean {
    return this.lastCompletedAt === null || now - this.lastCompletedAt >= ttlMs;
  }

  applyPage(page: { totalNum: number; count: number; skip?: number }, now = Date.now()): {
    done: boolean;
    syncedCount: number;
  } {
    this.totalNum = page.totalNum;
    const baseSkip = page.skip ?? this.nextSkip;
    this.nextSkip = baseSkip + page.count;
    this.consecutiveErrors = 0;
    this.backoffMs = 0;
    this.backoffUntil = null;
    this.lastError = null;
    const done = page.count === 0 || (page.totalNum > 0 && this.nextSkip >= page.totalNum);
    if (done) {
      this.lastCompletedAt = now;
      this.nextSkip = 0;
    }
    return { done, syncedCount: page.count };
  }

  recordError(error: string, now = Date.now()): CatalogSyncState {
    this.consecutiveErrors += 1;
    this.backoffMs = Math.min(60_000, 1000 * 2 ** (this.consecutiveErrors - 1));
    this.backoffUntil = now + this.backoffMs;
    this.lastError = error.slice(0, 500);
    return this.toJSON();
  }
}

// ============================================================================
// Check-In Gate & Settlement Contract (F2, F4)
// ============================================================================

export function isCheckInSettled(a: Attempt): boolean {
  if (a.demonstration || !a.sealed) return true;
  if (a.phase === "active" || a.phase === "paused" || a.phase === "complete") return true;
  if (a.reflection?.intake || a.reflection?.checkInSkippedAt !== undefined) return true;
  if ((a.reflection?.messages?.length ?? 0) > 0) return true;
  // Preserve legacy learn-phase sessions (before intake form) that already have follow-up/evaluations
  if (a.phase === "learn" && (a.evaluations.length > 0 || Boolean(a.followup))) return true;
  return false;
}

export function canTransitionToComplete(a: Attempt): boolean {
  return isCheckInSettled(a);
}

export type AssessmentGateResult = {
  allowed: boolean;
  reason?: "active-attempt" | "unsettled-checkin" | "active-coaching";
  blockingAttemptId?: string;
  title?: string;
  slug?: string;
  message?: string;
};

export function nextAssessmentGate(history: Attempt[]): AssessmentGateResult {
  const live = history.filter((a) => !a.demonstration);
  const active = live.find((a) => a.phase === "active" || a.phase === "paused");
  if (active) {
    return {
      allowed: false,
      reason: "active-attempt",
      blockingAttemptId: active.id,
      title: active.problem.title,
      slug: active.problem.titleSlug,
      message: "Your current attempt is saved. Return to it before starting a new session.",
    };
  }
  const unsettled = live.find((a) => !isCheckInSettled(a));
  if (unsettled) {
    return {
      allowed: false,
      reason: "unsettled-checkin",
      blockingAttemptId: unsettled.id,
      title: unsettled.problem.title,
      slug: unsettled.problem.titleSlug,
      message: "Finish or skip your quick check-in to record this session before starting the next problem.",
    };
  }
  const inCoaching = live.find(
    (a) =>
      (a.phase === "review" || a.phase === "learn") &&
      !a.reflection?.coachingDeferred,
  );
  if (inCoaching) {
    return {
      allowed: false,
      reason: "active-coaching",
      blockingAttemptId: inCoaching.id,
      title: inCoaching.problem.title,
      slug: inCoaching.problem.titleSlug,
      message: "Return to your saved review or conversation, or choose to come back later.",
    };
  }
  return { allowed: true };
}
