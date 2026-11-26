import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AgentEvidence } from "../lib/agent-evidence";
import {
  cacheNotebookCheckpoint,
  clearNotebookCheckpointCache,
  closeNotebookPools,
  compactNotebookContext,
  getCachedNotebookCheckpoint,
  ReflectionNotebook,
  reflectionNotebookEnabled,
  unifiedDiff,
  type NotebookCheckpoint,
} from "../lib/reflection-notebook";
import type { Attempt } from "../lib/types";

function makeSyntheticAttempt(extraEditCount = 0): Attempt {
  const initial = `class Solution {
    public int maxProfit(int[] prices) {
        return 0;
    }
}`;
  const events: Attempt["events"] = [
    {
      seq: 1,
      at: 1000,
      type: "edit",
      edits: [
        {
          offset: initial.indexOf("return 0;"),
          length: "return 0;".length,
          text: "Arrays.sort(prices);\n        return prices[prices.length - 1];",
        },
      ],
      origin: "typing",
    },
    {
      seq: 2,
      at: 2000,
      type: "assistance",
      assistanceId: "help-1",
      assistanceStage: "request",
    },
    {
      seq: 3,
      at: 3000,
      type: "assistance",
      assistanceId: "help-1",
      assistanceStage: "response",
    },
  ];

  // Build seq 4 as a major pivot replacing Arrays.sort with PriorityQueue
  let cur = initial;
  cur =
    cur.slice(0, cur.indexOf("return 0;")) +
    "Arrays.sort(prices);\n        return prices[prices.length - 1];" +
    cur.slice(cur.indexOf("return 0;") + "return 0;".length);

  const sortBlock =
    "Arrays.sort(prices);\n        return prices[prices.length - 1];";
  events.push({
    seq: 4,
    at: 4000,
    type: "edit",
    edits: [
      {
        offset: cur.indexOf(sortBlock),
        length: sortBlock.length,
        text: "PriorityQueue<Integer> pq = new PriorityQueue<>();\n        return 0;",
      },
    ],
    origin: "typing",
  });
  cur =
    cur.slice(0, cur.indexOf(sortBlock)) +
    "PriorityQueue<Integer> pq = new PriorityQueue<>();\n        return 0;" +
    cur.slice(cur.indexOf(sortBlock) + sortBlock.length);

  for (let i = 0; i < extraEditCount; i++) {
    const seq = 5 + i;
    const marker = "// step\n";
    const insertAt = cur.indexOf("return 0;");
    events.push({
      seq,
      at: 5000 + i * 100,
      type: "edit",
      edits: [{ offset: insertAt, length: 0, text: marker }],
      origin: "typing",
    });
    cur = cur.slice(0, insertAt) + marker + cur.slice(insertAt);
  }

  return {
    id: "attempt-nb-1",
    problem: {
      questionId: "121",
      questionFrontendId: "121",
      title: "Best Time to Buy and Sell Stock",
      titleSlug: "best-time-to-buy-and-sell-stock",
      difficulty: "Easy",
      content: "<p>Find maximum profit from one buy and sell.</p>",
      javaStarter: initial,
      exampleInputs: { raw: "[7,1,5,3,6,4]" },
    },
    createdAt: 0,
    budgetMs: 25 * 60 * 1000,
    deadline: 25 * 60 * 1000,
    phase: "review",
    sealed: true,
    exposure: "new",
    initialSource: initial,
    source: cur,
    version: events.length,
    lastSeq: events.length,
    pauses: [],
    events,
    checkpoints: [],
    jobs: [
      {
        id: "job-1",
        kind: "run",
        state: "SUCCESS",
        source: cur,
        seq: events.length,
        createdAt: 6000,
        summary: { verdict: "Wrong Answer" },
      },
    ],
    evaluations: [],
    annotations: [],
    javaHelp: [
      {
        id: "help-1",
        question: "How does PriorityQueue order elements in Java?",
        requestSeq: 2,
        askedAt: 2000,
        state: "ready",
        answer: "By default PriorityQueue is a min-heap using natural ordering.",
        kind: "reference",
        topics: ["PriorityQueue"],
        sources: [
          "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html",
        ],
        deliveredAt: 3000,
        responseSeq: 3,
        research: {
          sources: [
            {
              id: "src-1",
              title: "PriorityQueue (Java SE 25)",
              url: "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html",
              kind: "official-docs",
              version: "25",
              retrievedAt: 2500,
              excerpt: "An unbounded priority queue based on a priority heap. ".repeat(
                200,
              ),
              digest: "abc123",
            },
          ],
          claims: [],
          symbols: [],
          lookups: [],
          runtime: { editorJava: 25, executionJava: null },
        },
      },
    ],
    reflection: {
      messages: [
        {
          id: "u1",
          role: "user",
          kind: "intake",
          text: "I tried sorting first then a heap.",
          createdAt: 7000,
        },
      ],
      intake: {
        id: "u1",
        familiarity: "new",
        timeComplexity: "O(n log n)",
        spaceComplexity: "O(n)",
        submittedAt: 7000,
      },
    },
  };
}

test.after(async () => {
  await closeNotebookPools();
});

test("unifiedDiff produces clean unified hunks", () => {
  const d = unifiedDiff("a\nb\nc\n", "a\nx\nc\n", "seq-0", "seq-1");
  assert.match(d, /--- seq-0/);
  assert.match(d, /\+\+\+ seq-1/);
  assert.match(d, /-b/);
  assert.match(d, /\+x/);
  assert.equal(unifiedDiff("same\n", "same\n"), "");
});

test("ReflectionNotebook: state persistence, dump/restore, and fork isolation", async () => {
  const attempt = makeSyntheticAttempt();
  const nb = await ReflectionNotebook.create(attempt, {
    recordingHash: "hash-1",
    backend: "native",
  });
  try {
    const c1 = await nb.executeCell(
      "pivots = [1, 4]\ndef summarize():\n    return len(pivots)\nsummarize()",
      { stage: "question-generation", purpose: "Define shared state" },
    );
    assert.equal(c1.ok, true);
    assert.equal(c1.result, 2);

    const c2 = await nb.executeCell(
      "pivots.append(9)\nprint('count:', summarize())\nsummarize()",
      { stage: "question-generation", purpose: "Mutate state" },
    );
    assert.equal(c2.ok, true);
    assert.equal(c2.result, 3);
    assert.match(c2.stdout, /count: 3/);

    const cp = await nb.checkpoint();
    assert.ok(cp.sessionDump && cp.dumpBytes > 0);
    assert.equal(cp.cells.length, 2);

    // Fork two parallel branches and ensure isolated state
    const f1 = await nb.fork("question-analysis", "b1");
    const f2 = await nb.fork("question-analysis", "b2");
    try {
      const r1 = await f1.executeCell("pivots.append(101)\npivots", {
        stage: "question-analysis",
        branchId: "b1",
      });
      const r2 = await f2.executeCell("pivots.append(202)\npivots", {
        stage: "question-analysis",
        branchId: "b2",
      });
      assert.deepEqual(r1.result, [1, 4, 9, 101]);
      assert.deepEqual(r2.result, [1, 4, 9, 202]);
      nb.mergeBranch(f1);
      nb.mergeBranch(f2);
    } finally {
      await f1.close();
      await f2.close();
    }

    // Parent must still have [1, 4, 9]
    const parentCheck = await nb.executeCell("pivots", {
      stage: "question-judgment",
    });
    assert.deepEqual(parentCheck.result, [1, 4, 9]);

    // Restore into a brand-new notebook from checkpoint
    const restored = await ReflectionNotebook.create(attempt, {
      recordingHash: "hash-1",
      backend: "native",
      checkpoint: cp,
    });
    try {
      assert.equal(restored.stats.restoredFromCheckpoint, true);
      const r3 = await restored.executeCell("summarize()", {
        stage: "reflection-coach",
      });
      assert.equal(r3.ok, true);
      assert.equal(r3.result, 3);
    } finally {
      await restored.close();
    }

    // Verify nbformat 4.5 .ipynb export
    const ipynb = nb.toIpynb();
    assert.equal(ipynb.nbformat, 4);
    assert.equal(ipynb.nbformat_minor, 5);
    assert.ok(ipynb.cells.length >= 6);
  } finally {
    await nb.close();
  }
});

test("ReflectionNotebook: host helpers & AgentEvidence receipt capture", async () => {
  const attempt = makeSyntheticAttempt();
  const evidence = new AgentEvidence(attempt);
  const nb = await ReflectionNotebook.create(attempt, {
    recordingHash: "hash-2",
    evidence,
  });
  try {
    const res = await nb.executeCell(
      `
hits = search_edits("PriorityQueue", limit=5)
hits_kw = search_edits(pattern="PriorityQueue", limit=5)
src = replay(seq=4)
d = diff(from_seq=1, to_seq=4, context_lines=2)
lines = code_lines(seq=4, start_line=1, end_line=10)
ev = read_evidence(seq=4)
help_rec = read_assistance(id="help-1")
print("hits:", len(hits), "hits_kw:", len(hits_kw), "diff_ok:", "PriorityQueue" in d)
{"hit_seqs": [h["seq"] for h in hits], "kw_seqs": [h["seq"] for h in hits_kw], "has_pq": "PriorityQueue" in src, "has_lines": "1:" in lines, "ev_seq": ev["event"]["seq"], "help_id": help_rec["id"]}
`,
      { stage: "question-analysis", purpose: "Exercise all recording helpers" },
    );
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.deepEqual(res.result, {
      hit_seqs: [4],
      kw_seqs: [4],
      has_pq: true,
      has_lines: true,
      ev_seq: 4,
      help_id: "help-1",
    });
    const receipts = evidence.bundle().receipts;
    const toolsRecorded = new Set(receipts.map((r) => r.tool));
    for (const expected of [
      "search_edits",
      "replay",
      "diff",
      "code_lines",
      "read_evidence",
      "read_assistance",
      "run_notebook",
    ]) {
      assert.ok(
        toolsRecorded.has(expected),
        `Expected receipt for ${expected}`,
      );
    }
  } finally {
    await nb.close();
  }
});

test("ReflectionNotebook: sandbox isolation, timeout rollback, and output truncation", async () => {
  const attempt = makeSyntheticAttempt();
  const nb = await ReflectionNotebook.create(attempt, {
    recordingHash: "hash-3",
  });
  try {
    const seed = await nb.executeCell("safe_val = 777", { stage: "test" });
    assert.equal(seed.ok, true);

    const blocked = await nb.executeCell("import os\nos.listdir('.')", {
      stage: "test",
    });
    assert.equal(blocked.ok, false);
    assert.ok(blocked.error);

    // Trigger feed duration timeout (5s limit) -> worker recovers from lastGoodDump
    const looped = await nb.executeCell("while True:\n    pass", {
      stage: "test",
    });
    assert.equal(looped.ok, false);
    assert.equal(looped.error?.type, "TimeoutOrMemoryLimit");

    // Verify variable from before infinite loop survived automatic recovery
    const after = await nb.executeCell("safe_val", { stage: "test" });
    assert.equal(after.ok, true);
    assert.equal(after.result, 777);

    // Oversized stdout truncation
    const big = await nb.executeCell("print('A' * 16000)", { stage: "test" });
    assert.equal(big.ok, true);
    assert.equal(big.truncated, true);
    assert.match(big.stdout, /truncated/);
  } finally {
    await nb.close();
  }
});

test("ReflectionNotebook: WASM backend smoke test & timing", async () => {
  const attempt = makeSyntheticAttempt();
  const t0 = Date.now();
  const nb = await ReflectionNotebook.create(attempt, {
    recordingHash: "hash-wasm",
    backend: "wasm",
  });
  const createMs = Date.now() - t0;
  try {
    const t1 = Date.now();
    const res = await nb.executeCell(
      'x = 40\ny = len(events)\n(x + 2, y)',
      { stage: "wasm-smoke" },
    );
    const evalMs = Date.now() - t1;
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.deepEqual(res.result, [42, 4]);
    const cp = await nb.checkpoint();
    assert.ok(cp.dumpBytes > 0);
    console.log(
      `[wasm smoke] createMs=${createMs}ms, evalMs=${evalMs}ms, dumpBytes=${cp.dumpBytes}`,
    );
  } finally {
    await nb.close();
  }
});

test("compactNotebookContext reduces prompt payload size by >90%", () => {
  const synthetic = makeSyntheticAttempt(1200);
  const fullSize = JSON.stringify({
    events: synthetic.events,
    javaAssistance: synthetic.javaHelp,
  }).length;
  const compactSize = JSON.stringify(compactNotebookContext(synthetic)).length;
  assert.ok(fullSize > 100_000, `Expected large synthetic size, got ${fullSize}`);
  assert.ok(
    compactSize < 15_000,
    `Expected compact size <15KB, got ${compactSize}`,
  );
  const ratio = 1 - compactSize / fullSize;
  assert.ok(ratio > 0.9, `Expected >90% reduction, got ${(ratio * 100).toFixed(1)}%`);

  // Also check against the real Stock recording fixture if present in main repo .local
  const stockFixture = path.resolve(
    process.cwd(),
    "../../../.local/stock-conversation-review.json",
  );
  if (existsSync(stockFixture)) {
    const stock = JSON.parse(readFileSync(stockFixture, "utf8")) as Attempt;
    const stockFull = JSON.stringify({
      events: stock.events,
      javaAssistance: stock.javaHelp,
      solvingChunks: stock.solvingChunks ?? [],
    }).length;
    const stockCompact = JSON.stringify(compactNotebookContext(stock)).length;
    console.log(
      `[compactContext Stock] full=${(stockFull / 1024).toFixed(1)}KB -> compact=${(stockCompact / 1024).toFixed(1)}KB (${((1 - stockCompact / stockFull) * 100).toFixed(1)}% smaller)`,
    );
    assert.ok(stockCompact < 15_000);
  }
});

test("reflectionNotebookEnabled defaults on and respects DUO_REFLECTION_NOTEBOOK=0 and explicit overrides", () => {
  const prev = process.env.DUO_REFLECTION_NOTEBOOK;
  try {
    delete process.env.DUO_REFLECTION_NOTEBOOK;
    assert.equal(reflectionNotebookEnabled(), true);
    assert.equal(reflectionNotebookEnabled(false), false);

    process.env.DUO_REFLECTION_NOTEBOOK = "0";
    assert.equal(reflectionNotebookEnabled(), false);
    assert.equal(reflectionNotebookEnabled(true), true);
  } finally {
    if (prev === undefined) delete process.env.DUO_REFLECTION_NOTEBOOK;
    else process.env.DUO_REFLECTION_NOTEBOOK = prev;
  }
});

test("checkpoint cache keys by attempt+recordingHash and evicts LRU entries past 32", () => {
  clearNotebookCheckpointCache();
  try {
    const makeCp = (attemptId: string, recordingHash: string): NotebookCheckpoint => ({
      version: "monty-notebook-1",
      backend: "native",
      attemptId,
      recordingHash,
      executionCount: 1,
      cells: [],
      dumpBytes: 12,
      updatedAt: Date.now(),
    });

    for (let i = 0; i < 32; i++) {
      cacheNotebookCheckpoint(makeCp(`att-${i}`, "h1"));
    }
    // Refresh att-0 as most recently used before inserting a 33rd entry.
    assert.ok(getCachedNotebookCheckpoint("att-0", "h1"));
    assert.equal(getCachedNotebookCheckpoint("att-0", "different-hash"), undefined);

    cacheNotebookCheckpoint(makeCp("att-32", "h1"));
    assert.ok(getCachedNotebookCheckpoint("att-0", "h1"));
    assert.equal(getCachedNotebookCheckpoint("att-1", "h1"), undefined);
    assert.ok(getCachedNotebookCheckpoint("att-32", "h1"));
  } finally {
    clearNotebookCheckpointCache();
  }
});
