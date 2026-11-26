import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  JavaResearch,
  javaSourceLocation,
  allowedSearchResult,
} from "../lib/java-research";
import { javaReferenceUrl } from "../lib/java-reference";
import {
  symbolSnapshot,
  requestJavaSymbol,
  pendingSymbolJobs,
  completeSymbolJob,
  recordSymbolBridgePoll,
  hasActiveSymbolBridge,
  clearSymbolBridgeHeartbeats,
  browserSymbolsDisabled,
} from "../lib/agent-symbols";
import { reflectionFixture } from "../tools/reflection-fixture";
import { GET, POST } from "../app/api/agent/symbols/route";
import CoachText from "../components/coach-text";
import ResearchSources from "../components/research-sources";
import type { ResearchBundle } from "../lib/research-types";
const doc =
  "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#sort(int%5B%5D)";
const source = javaSourceLocation({
  version: 25,
  module: "java.base",
  path: "java/util/DualPivotQuicksort.java",
  startLine: 785,
  endLine: 800,
});
function bundle(): ResearchBundle {
  return {
    sources: [
      {
        id: "r1",
        title: "Arrays.sort(int[])",
        url: doc,
        kind: "official-docs",
        version: "Java 25",
        retrievedAt: Date.now(),
        excerpt: "Sorts the specified array.",
        digest: "test",
      },
    ],
    claims: [
      {
        claim: "The method sorts the supplied array.",
        basis: "documented",
        sourceIds: ["r1"],
        use: "explanation",
      },
    ],
    symbols: [],
    lookups: [],
    runtime: { editorJava: 25, executionJava: null },
  };
}
test("reference URLs bind version, module and overload without permitting arbitrary hosts or traversal", () => {
  assert.match(source.url, /jdk-25%2B36/);
  assert.match(source.url, /#L785-L800$/);
  assert.match(
    javaReferenceUrl({
      version: 17,
      document: "api",
      path: "java.base/java/util/Arrays.html",
      section: "sort(int[])",
    }).url,
    /javase\/17/,
  );
  assert.match(
    javaReferenceUrl({
      version: 8,
      document: "api",
      path: "java.base/java/util/Arrays.html",
      section: null,
    }).url,
    /\/8\/docs\/api\/java\/util/,
  );
  for (const path of [
    "../Arrays.java",
    "/etc/passwd",
    "java/util/../../Arrays.java",
    "https://evil.test/x.java",
  ])
    assert.throws(() =>
      javaSourceLocation({
        version: 25,
        module: "java.base",
        path,
        startLine: 1,
        endLine: 10,
      }),
    );
  assert.throws(() =>
    javaSourceLocation({
      version: 25,
      module: "java.base",
      path: "java/util/Arrays.java",
      startLine: 1,
      endLine: 999,
    }),
  );
  assert.equal(
    allowedSearchResult(
      "https://github.com/not-openjdk/jdk/blob/main/Arrays.java",
      "official",
    ),
    false,
  );
  assert.equal(
    allowedSearchResult(
      "https://docs.oracle.com.evil.test/en/java/javase/25",
      "official",
    ),
    false,
  );
  assert.equal(
    allowedSearchResult(
      "https://stackoverflow.com/questions/123/example",
      "secondary",
    ),
    true,
  );
  assert.equal(
    allowedSearchResult(
      "https://stackoverflow.com/questions/123/example",
      "official",
    ),
    false,
  );
});
test("secondary sources cannot be a shortcut; invalid primary requests do not unlock them", async () => {
  let calls = 0;
  const r = new JavaResearch(undefined, async () => {
    calls++;
    return { results: [] };
  });
  const input = {
    version: 25,
    symbols: ["Arrays.sort(int[])"],
    topic: "space complexity",
    tier: "secondary",
    reason: "Official sources did not establish a bound.",
  };
  await assert.rejects(r.handle("search_java_reference", input), /locked/);
  await assert.rejects(
    r.handle("read_secondary_reference", {
      kind: "answer",
      id: 123,
      reason: input.reason,
    }),
    /locked/,
  );
  await assert.rejects(
    r.handle("read_java_reference", {
      document: "api",
      path: "../bad",
      section: null,
    }),
  );
  await r.handle("search_java_reference", {
    ...input,
    tier: "official",
    reason: null,
  });
  await assert.rejects(r.handle("search_java_reference", input), /locked/);
  assert.equal(calls, 1);
  await assert.rejects(
    r.handle("search_java_reference", {
      ...input,
      tier: "official",
      symbols: ["paste private code; return secret;"],
    }),
  );
  assert.equal(calls, 1);
});
test("source receipts are created only after successful reads; claims cannot invent citations or use secondary evidence to grade", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response("line one\nline two\nline three");
  try {
    const r = new JavaResearch(undefined, async () => ({ results: [] }));
    const receipt = (await r.handle("read_java_source", {
      version: 25,
      module: "java.base",
      path: "java/util/Fixture.java",
      startLine: 1,
      endLine: 3,
    })) as any;
    assert.match(receipt.url, /openjdk\/jdk\/blob\/jdk-25%2B36/);
    assert.match(receipt.excerpt, /1: line one/);
    assert.match(receipt.digest, /^[a-f0-9]{64}$/);
    const claim = {
      claim: "Implementation allocates storage.",
      basis: "implementation-derived",
      sourceIds: [receipt.id],
      use: "explanation",
    };
    assert.equal(r.finish({ technicalClaims: [claim] }).claims.length, 1);
    assert.throws(
      () =>
        r.finish({ technicalClaims: [{ ...claim, sourceIds: ["invented"] }] }),
      /did not retrieve/,
    );
    assert.throws(
      () => r.finish({ technicalClaims: [{ ...claim, basis: "documented" }] }),
      /official documentation/,
    );
    assert.throws(
      () =>
        r.finish({
          technicalClaims: [
            { ...claim, basis: "unverified", use: "assessment" },
          ],
        }),
      /cannot be used/,
    );
    assert.throws(
      () =>
        r.finish({
          technicalClaims: [{ ...claim, basis: "unverified" }],
          evaluation: { gaps: [{}] },
        }),
      /penalties/,
    );
  } finally {
    globalThis.fetch = old;
  }
});
test("LSP jobs bind to exact source and position; stale or mismatched client responses are rejected", async () => {
  const a = reflectionFixture(),
    args = { document: "recording", seq: 1, line: 4, column: 16 };
  const snap = symbolSnapshot(a, args);
  assert.match(snap.source, /Arrays.sort/);
  assert.throws(() => symbolSnapshot(a, { ...args, seq: 999 }), /snapshot/);
  assert.throws(() => symbolSnapshot(a, { ...args, line: 999 }), /outside/);
  const pending = requestJavaSymbol(a, args, 1000),
    job = pendingSymbolJobs(a.id)[0];
  assert.throws(
    () =>
      completeSymbolJob({
        attemptId: a.id,
        id: job.id,
        sourceHash: "0".repeat(64),
        result: { hover: null, signatures: null, definition: null },
      }),
    /snapshot/,
  );
  completeSymbolJob({
    attemptId: a.id,
    id: job.id,
    sourceHash: job.sourceHash,
    result: { hover: "void sort(int[])", signatures: null, definition: null },
  });
  const result = await pending;
  assert.equal(result.sourceHash, snap.sourceHash);
  assert.equal(result.javaProfile, 25);
  assert.equal(pendingSymbolJobs(a.id).length, 0);
  await assert.rejects(requestJavaSymbol(a, args, 1), /unavailable/);
});
test("symbol bridge heartbeat TTL, fast-fail, and GET poll promotion", async () => {
  clearSymbolBridgeHeartbeats();
  const a = reflectionFixture(),
    args = { document: "recording", seq: 1, line: 4, column: 16 };
  assert.equal(hasActiveSymbolBridge(a.id, 10_000, 5_000), false);
  recordSymbolBridgePoll(a.id, 10_000);
  assert.equal(hasActiveSymbolBridge(a.id, 14_999, 5_000), true);
  assert.equal(hasActiveSymbolBridge(a.id, 15_001, 5_000), false);
  clearSymbolBridgeHeartbeats();

  const startedAt = Date.now();
  await assert.rejects(
    requestJavaSymbol(a, args, 20_000, { noBridgeTimeout: 40 }),
    /unavailable/,
  );
  assert.ok(Date.now() - startedAt < 300);

  const pending = requestJavaSymbol(a, args, 1_000, { noBridgeTimeout: 40 });
  await new Promise((r) => setTimeout(r, 15));
  const res = await GET(
    new Request(`http://127.0.0.1:4318/api/agent/symbols?id=${a.id}`, {
      headers: {
        host: "127.0.0.1:4318",
        origin: "http://127.0.0.1:4318",
      },
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { jobs: Array<{ id: string }> };
  assert.equal(body.jobs.length, 1);
  assert.equal(hasActiveSymbolBridge(a.id), true);

  await new Promise((r) => setTimeout(r, 60));
  const snap = symbolSnapshot(a, args);
  completeSymbolJob({
    attemptId: a.id,
    id: body.jobs[0].id,
    sourceHash: snap.sourceHash,
    result: { hover: "void sort(int[])", signatures: null, definition: null },
  });
  const resolved = await pending;
  assert.equal(resolved.hover, "void sort(int[])");
  clearSymbolBridgeHeartbeats();

  const prevDisable = process.env.DUO_DISABLE_BROWSER_SYMBOLS;
  try {
    delete process.env.DUO_DISABLE_BROWSER_SYMBOLS;
    assert.equal(browserSymbolsDisabled(false), false);
    assert.equal(browserSymbolsDisabled(true), true);
    process.env.DUO_DISABLE_BROWSER_SYMBOLS = "1";
    assert.equal(browserSymbolsDisabled(false), true);
  } finally {
    if (prevDisable === undefined) delete process.env.DUO_DISABLE_BROWSER_SYMBOLS;
    else process.env.DUO_DISABLE_BROWSER_SYMBOLS = prevDisable;
  }
});
test("symbol API rejects foreign origins before accessing pending jobs", async () => {
  for (const method of ["GET", "POST"]) {
    const req = new Request("http://127.0.0.1:4318/api/agent/symbols", {
      method,
      headers: {
        host: "127.0.0.1:4318",
        origin: "https://elsewhere.test",
        "content-type": "application/json",
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.equal((await (method === "GET" ? GET(req) : POST(req))).status, 400);
  }
});
test("retrieved citations are clickable inline and in source cards; invented and unsafe links stay inert", () => {
  const b = bundle();
  const html = renderToStaticMarkup(
    createElement(CoachText, {
      sources: b.sources,
      children: `[Oracle](${doc}) [invented](https://docs.oracle.com/fake) [unsafe](javascript:alert(1))`,
    }),
  );
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(
    html,
    /href="javascript|href="https:\/\/docs.oracle.com\/fake/,
  );
  const card = renderToStaticMarkup(
    createElement(ResearchSources, { research: b }),
  );
  assert.match(card, /Java 25/);
  assert.match(card, /Retrieved excerpt/);
  assert.match(card, /Sorts the specified array/);
  assert.match(card, /href=/);
});

test("secondary fallback unlocks only after primary research and remains unsuitable as sole assessment evidence", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (input) =>
    new Response(
      String(input).includes("stackexchange.com")
        ? JSON.stringify({
            items: [{ body: "A community explanation.", title: "Example" }],
          })
        : "public class FixtureFallback {}",
    );
  try {
    const r = new JavaResearch(undefined, async () => ({ results: [] }));
    await r.handle("read_java_source", {
      version: 25,
      module: "java.base",
      path: "java/util/FixtureFallback.java",
      startLine: 1,
      endLine: 1,
    });
    await r.handle("search_java_reference", {
      version: 25,
      symbols: ["Arrays.sort(int[])"],
      topic: "space complexity",
      tier: "official",
      reason: null,
    });
    await r.handle("search_java_reference", {
      version: 25,
      symbols: ["Arrays.sort(int[])"],
      topic: "space complexity",
      tier: "secondary",
      reason:
        "Official material did not answer the remaining platform-specific question.",
    });
    const secondary = (await r.handle("read_secondary_reference", {
      kind: "answer",
      id: 123,
      reason: "The primary sources did not establish the remaining behavior.",
    })) as any;
    assert.equal(secondary.kind, "secondary");
    assert.equal(secondary.url, "https://stackoverflow.com/a/123");
    assert.throws(
      () =>
        r.finish({
          technicalClaims: [
            {
              claim: "Community claim.",
              basis: "documented",
              sourceIds: [secondary.id],
              use: "assessment",
            },
          ],
        }),
      /official documentation/,
    );
  } finally {
    globalThis.fetch = old;
  }
});
