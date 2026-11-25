import assert from "node:assert/strict";
import test from "node:test";
import { TraceStore } from "../lib/agent-traces";
import { ReviewFlags } from "../lib/review-flags";
import { buildTimelineProjection } from "../lib/timeline-markers";
import { reflectionFixture } from "../tools/reflection-fixture";
import type { Evaluation } from "../lib/types";

test("ReviewFlags.forAttempt extracts lightweight timeline anchors and isolates other attempts", () => {
  const log = new TraceStore(":memory:");
  const flags = new ReviewFlags(log);
  const a1 = reflectionFixture();
  const a2 = reflectionFixture();

  a1.reflection = {
    messages: [
      {
        id: "msg-coach-1",
        role: "assistant",
        text: "Let's inspect the HashSet transition.",
        createdAt: a1.createdAt + 105_000,
        focus: {
          startSeq: 3,
          endSeq: 4,
          pauseSeq: 4,
          mode: "range",
          label: "Sorting to HashSet",
        },
        research: {
          traceId: "11111111-1111-4111-8111-111111111111",
          sources: [],
          symbols: [],
          lookups: [],
          claims: [],
          runtime: { editorJava: 25, executionJava: null },
        },
      },
    ],
  };

  // 1. Replay editor flag anchored to recording event seq=3
  flags.create(
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      category: "Editor issue",
      note: "Check transition snapshot here",
      target: {
        kind: "editor",
        attemptId: a1.id,
        source: a1.initialSource,
        editor: {
          file: "Solution.java",
          cursor: { line: 2, column: 5, lineText: "    public boolean containsDuplicate(int[] nums) {" },
          source: "recording",
          seq: 3,
        },
      },
    },
    { attempt: (id) => (id === a1.id ? a1 : a2), mode: () => "test" },
  );

  // 2. Reflection reply flag carrying focus [3..4] and traceId
  flags.create(
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      category: "Unnecessary question",
      note: "Already explained O(n) tradeoff",
      target: {
        kind: "reflection",
        attemptId: a1.id,
        messageId: "msg-coach-1",
      },
    },
    { attempt: (id) => (id === a1.id ? a1 : a2), mode: () => "test" },
  );

  // 3. Flag on a2 must not leak into a1
  flags.create(
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      category: "Other",
      note: "Different attempt",
      target: {
        kind: "editor",
        attemptId: a2.id,
        source: a2.initialSource,
        editor: {
          file: "Solution.java",
          cursor: { line: 1, column: 1, lineText: "class Solution {" },
          source: "recording",
          seq: 0,
        },
      },
    },
    { attempt: (id) => (id === a1.id ? a1 : a2), mode: () => "test" },
  );

  const a1Flags = flags.forAttempt(a1.id);
  assert.equal(a1Flags.length, 2);
  assert.equal(a1Flags[0].category, "Editor issue");
  assert.equal(a1Flags[0].editor?.seq, 3);
  assert.equal(a1Flags[1].category, "Unnecessary question");
  assert.deepEqual(a1Flags[1].focus, {
    startSeq: 3,
    endSeq: 4,
    pauseSeq: 4,
    mode: "range",
    label: "Sorting to HashSet",
  });
  assert.equal(a1Flags[1].traceId, "11111111-1111-4111-8111-111111111111");
  log.close();
});

test("buildTimelineProjection maps solving windows, approach windows, flags, Java help, review flags, and cross-links questionReview verdicts", () => {
  const a = reflectionFixture();
  a.solvingChunks = [
    {
      id: "chunk-1",
      startSeq: 0,
      endSeq: 2,
      elapsedMs: 25_000,
      createdAt: a.createdAt + 25_000,
      signal: "example-run",
      captureContext:
        'Executed against sample or custom cases at event 2 with outcome "Accepted".',
      summary: "Implemented sorting pass with adjacent equality scan and ran sample cases.",
      observations: [
        {
          kind: "execution-outcome",
          statement: "Arrays.sort followed by adjacent scan passed 3/3 sample cases.",
          sequences: [1, 2],
          sourceUrls: [
            "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#sort(int%5B%5D)",
          ],
        },
      ],
      candidateQuestions: [
        {
          topic: "complexity",
          kind: "understanding",
          question: "What is the runtime cost of sorting int[] before scanning?",
          purpose: "Check sorting baseline complexity.",
          sequences: [1],
        },
      ],
      model: "claude-acp/opus",
      effort: "low",
      traceId: "trace-chunk-1",
      sources: [
        {
          id: "src-1",
          title: "Arrays.sort(int[])",
          url: "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#sort(int%5B%5D)",
          kind: "official-docs",
          version: "Java 25",
          retrievedAt: a.createdAt + 24_000,
          excerpt: "Dual-Pivot Quicksort O(n log n)",
          digest: "abc",
        },
      ],
    },
    {
      id: "chunk-2",
      startSeq: 2,
      endSeq: 5,
      elapsedMs: 92_000,
      createdAt: a.createdAt + 92_000,
      signal: "replaced-block",
      captureContext: "Code present before event 3 was removed and followed by new edits.",
      summary: "Replaced sorting loop with single-pass HashSet duplicate check.",
      observations: [
        {
          kind: "representation-fact",
          statement: "HashSet.add returns false when the element is already present.",
          sequences: [3, 4],
          sourceUrls: [],
        },
      ],
      candidateQuestions: [],
      model: "claude-acp/opus",
      effort: "low",
      traceId: "trace-chunk-2",
    },
  ];

  a.javaHelp = [
    {
      id: "help-1",
      question: "What does HashSet.add return when an element already exists?",
      requestSeq: 3,
      askedAt: a.createdAt + 51_000,
      state: "ready",
      answer: "Returns false if the set already contained the element.",
      kind: "reference",
      topics: ["HashSet.add"],
      sources: [
        "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html#add(E)",
      ],
      deliveredAt: a.createdAt + 53_000,
      responseSeq: 4,
    },
  ];

  a.annotations = [
    {
      id: "ann-1",
      seq: 4,
      judgement: "agree",
      comment: "Switched to HashSet for O(n) average time.",
      createdAt: a.createdAt + 110_000,
      interpretationVisible: true,
      interpretation: "Intentional tradeoff.",
    },
  ];

  const evaluation: Evaluation = {
    summary: "Replaced O(n log n) sort with O(n) average-time HashSet pass.",
    strengths: [],
    gaps: [],
    moments: [
      {
        seq: 3,
        endSeq: 4,
        label: "Sorting to HashSet pivot",
        observation: "Removed Arrays.sort loop and inserted HashSet scan.",
        interpretation: "Likely trading O(n) auxiliary space for O(n) average runtime.",
        question: "What motivated replacing the sorting pass?",
        confidence: "high",
      },
    ],
    exercise: { skill: "Hashing", title: "Set check", prompt: "Explain Set.add." },
    version: "conversational-reflection-10",
    createdAt: a.createdAt + 120_000,
    evidenceThrough: 6,
    development: {
      approaches: [
        {
          id: "app-sort",
          label: "Sorting scan",
          origin: "recorded",
          observation: "Sorted array and checked adjacent pairs.",
          focus: {
            startSeq: 1,
            endSeq: 2,
            pauseSeq: 2,
            mode: "range",
            label: "Sorting scan",
          },
          assistanceIds: [],
          learnerEvidence: [],
          intent: {
            status: "hypothesis",
            statement: "Initial working pass.",
            evidence: [],
          },
        },
      ],
      baselineApproachId: "app-sort",
      activeApproachId: "app-sort",
      baselineCorrection: [],
      optimization: { status: "not-discussed", approachId: null },
      revisits: [],
    },
    questionReview: {
      version: "question-evidence-1",
      revision: 1,
      inputHash: "h1",
      recordingHash: "r1",
      throughMessageIds: [],
      createdAt: a.createdAt + 118_000,
      model: "claude-acp/opus",
      effort: "low",
      coverageComplete: true,
      coverage: [],
      limitations: [],
      questions: [
        {
          question: {
            id: "q-pivot",
            topic: "approach-evolution",
            kind: "intent",
            question: "Why replace sorting at events 3–4 after consulting HashSet.add?",
            purpose: "Understand approach transition.",
            priority: "high",
            anchors: {
              sequences: [3, 4],
              learner: [],
              assistanceIds: ["help-1"],
              sourceUrls: [],
            },
          },
          candidate: {
            questionId: "q-pivot",
            classification: "plausible",
            answer: "Likely sought O(n) runtime; unconfirmed until learner explains.",
            justification: "Chronology at 3–4.",
            supporting: {
              sequences: [3, 4],
              learner: [],
              assistanceIds: ["help-1"],
              sourceUrls: [],
            },
            conflicting: {
              sequences: [],
              learner: [],
              assistanceIds: [],
              sourceUrls: [],
            },
            alternatives: ["Practicing HashSet API"],
            uncertainty: "Motivation not yet stated by learner.",
          },
          verdict: {
            questionId: "q-pivot",
            classification: "plausible",
            decision: "needs-evidence",
            missingEvidence: "learner",
            coachingRole: "context-question",
            disposition: "ask-user",
            answer: "Transition observed at #3–#4 near HashSet.add lookup; ask learner.",
            justification: "Chronology alone does not prove intent.",
            supporting: {
              sequences: [3, 4],
              learner: [],
              assistanceIds: ["help-1"],
              sourceUrls: [],
            },
            conflicting: {
              sequences: [],
              learner: [],
              assistanceIds: [],
              sourceUrls: [],
            },
            alternatives: ["Practicing HashSet API"],
            uncertainty: "Motivation not yet stated by learner.",
          },
          updatedRevision: 1,
          askedMessageIds: ["assistant-1"],
          analystTraceId: "trace-analyst-1",
        },
      ],
    },
  };

  const projection = buildTimelineProjection(a, evaluation, [
    {
      id: "flag-1",
      createdAt: a.createdAt + 50_000,
      status: "open",
      category: "Incorrect information",
      note: "Verify pivot timing",
      title: a.problem.title,
      kind: "editor",
      mode: "test",
      attemptId: a.id,
      traceState: "captured",
      traceCount: 3,
      editor: {
        file: "Solution.java",
        cursor: { line: 4, column: 9, lineText: "HashSet<Integer>" },
        source: "recording",
        seq: 3,
      },
    },
  ]);

  assert.equal(projection.totalMs, 100_000);
  // 2 solving windows + 1 recorded approach window
  assert.equal(projection.windows.length, 3);
  const w1 = projection.windows[0];
  const w2 = projection.windows[1];
  assert.equal(w1.kind, "solving-window");
  assert.equal(w1.startMs, 0);
  assert.equal(w1.endMs, 20_000);
  assert.equal(w1.leftPct, 0);
  assert.equal(w1.widthPct, 20);
  assert.equal(w1.linkedQuestions.length, 0);

  assert.equal(w2.kind, "solving-window");
  assert.equal(w2.startMs, 20_000);
  assert.equal(w2.endMs, 90_000);
  // q-pivot cites sequences [3, 4], which fall inside w2 (2..5]
  assert.equal(w2.linkedQuestions.length, 1);
  assert.equal(w2.linkedQuestions[0].id, "q-pivot");
  assert.equal(w2.linkedQuestions[0].askedInChat, true);

  // Flags: coach-moment (#3..#4), java-help (#3..#4), review-flag (#3), annotation (#4)
  assert.equal(projection.flags.length, 4);
  const kinds = projection.flags.map((f) => f.kind);
  assert.ok(kinds.includes("coach-moment"));
  assert.ok(kinds.includes("java-help"));
  assert.ok(kinds.includes("review-flag"));
  assert.ok(kinds.includes("annotation"));

  // Co-located flags at seq=3 (50,000ms = 50%) should stagger across rows 0 and 1
  const at50Pct = projection.flags.filter((f) => f.leftPct === 50);
  assert.equal(at50Pct.length, 3);
  assert.ok(at50Pct.some((f) => f.row === 0));
  assert.ok(at50Pct.some((f) => f.row === 1));

  // Java help item cross-links q-pivot via assistanceIds: ["help-1"]
  const helpFlag = projection.flags.find((f) => f.kind === "java-help")!;
  assert.equal(helpFlag.linkedQuestions.length, 1);
  assert.equal(helpFlag.linkedQuestions[0].id, "q-pivot");
});
