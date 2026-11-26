import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CppResearch,
  allowedCppSearchResult,
  cppSourceLocation,
} from "../lib/cpp-research";
import { cppReferenceUrl, readCppReference } from "../lib/cpp-reference";
import { cppLsp } from "../lib/cpp-lsp";
import { validateEditorContext } from "../lib/editor-context";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { AgentRuntime } from "../lib/agents";
import { baselineAgentModel } from "../lib/agent-settings-store";
import { lowSettings } from "../lib/agent-settings";
import { captureSnapshot, parseSnapshot } from "../lib/snapshots";
import {
  startPrescription,
  prescriptionStatus,
  answerCatalogRequest,
  savedPrescription,
} from "../lib/prescription";
import { testParameters } from "../lib/test-cases";
import { POST as createAttempt } from "../app/api/state/route";
import CoachText from "../components/coach-text";
import ResearchSources from "../components/research-sources";
import type { ResearchBundle } from "../lib/research-types";

test("C++ reference URLs bind standard/cppreference paths and reject arbitrary URLs or traversal", () => {
  assert.equal(
    cppReferenceUrl({
      source: "standard",
      standard: "c++26",
      path: "vector.overview",
      section: null,
    }).url,
    "https://eel.is/c++draft/vector.overview",
  );
  assert.equal(
    cppReferenceUrl({
      source: "cppreference",
      standard: "c++26",
      path: "w/cpp/container/vector.html",
      section: null,
    }).url,
    "https://en.cppreference.com/cpp/container/vector",
  );
  for (const bad of [
    "../secret",
    "/etc/passwd",
    "https://evil.test/cpp/vector",
    "cpp/container/../../secret",
    "cpp/container/vector?token=1",
    "cpp/container/vector#frag",
  ]) {
    assert.throws(() =>
      cppReferenceUrl({ source: "cppreference", path: bad, section: null }),
    );
  }

  const libcxx = cppSourceLocation({
    library: "libcxx",
    path: "vector",
    startLine: 10,
    endLine: 40,
  });
  assert.match(libcxx.url, /llvm\/llvm-project\/blob\/llvmorg-21\.1\.0\/libcxx\/include\/vector#L10-L40$/);

  const libstd = cppSourceLocation({
    library: "libstdc++",
    path: "bits/stl_vector.h",
    startLine: 1,
    endLine: 50,
  });
  assert.match(libstd.url, /gcc-mirror\/gcc\/blob\/releases\/gcc-15\.1\.0\/libstdc\+\+-v3\/include\/bits\/stl_vector\.h#L1-L50$/);

  assert.throws(() =>
    cppSourceLocation({
      library: "libcxx",
      path: "../secret",
      startLine: 1,
      endLine: 10,
    }),
  );
  assert.throws(() =>
    cppSourceLocation({
      library: "libcxx",
      path: "vector",
      startLine: 1,
      endLine: 500,
    }),
  );

  assert.equal(
    allowedCppSearchResult("https://eel.is/c++draft/alg.sorting", "official"),
    true,
  );
  assert.equal(
    allowedCppSearchResult("https://en.cppreference.com/cpp/algorithm/sort", "official"),
    true,
  );
  assert.equal(
    allowedCppSearchResult("https://en.cppreference.com.evil.test/cpp/sort", "official"),
    false,
  );
  assert.equal(
    allowedCppSearchResult("https://stackoverflow.com/questions/42/example", "official"),
    false,
  );
  assert.equal(
    allowedCppSearchResult("https://stackoverflow.com/questions/42/example", "secondary"),
    true,
  );
});

test("readCppReference resolves eel.is single-quoted anchors and cppreference underscored sections cleanly", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("eel.is")) {
        return new Response(
          "<html><body><main><div id='general' class='section'><h3>26.8.1 General</h3><p>Sorting algorithms.</p></section></main></body></html>",
          { status: 200 },
        );
      }
      return new Response(
        '<html><body><div id="mw-content-text"><div class="t-navbar">Navbar junk</div><table class="t-dcl-begin"><tbody><tr><td>emplace()</td></tr></tbody></table><h3><span class="mw-headline" id="Return_value">Return value</span></h3><p>Pair of iterator and bool.</p><h3><span class="mw-headline" id="Complexity">Complexity</span></h3><p>Amortized constant.</p><div class="printfooter">Footer junk</div></div></body></html>',
        { status: 200 },
      );
    };

    const eel = await readCppReference({
      source: "standard",
      standard: "c++26",
      path: "alg.sorting",
      section: "general",
    });
    assert.equal(eel.url, "https://eel.is/c++draft/alg.sorting#general");
    assert.match(eel.text, /Sorting algorithms/);

    const sec = await readCppReference({
      source: "cppreference",
      standard: "c++26",
      path: "cpp/container/unordered_map/emplace",
      section: "Return value",
    });
    assert.equal(
      sec.url,
      "https://en.cppreference.com/cpp/container/unordered_map/emplace#Return_value",
    );
    assert.match(sec.text, /Pair of iterator and bool/);
    assert.doesNotMatch(sec.text, /Amortized constant/);

    const overview = await readCppReference({
      source: "cppreference",
      standard: "c++26",
      path: "cpp/container/unordered_map/emplace",
      section: null,
    });
    assert.doesNotMatch(overview.text, /mw-content-text/);
    assert.doesNotMatch(overview.text, /Navbar junk/);
    assert.doesNotMatch(overview.text, /Footer junk/);
    assert.match(overview.text, /emplace\(\)/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("CppResearch enforces primary-first lock, source receipts, and resolves C++ symbols via clangd", async () => {
  const db = new AttemptStore(":memory:");
  const a = db.create(
    {
      ...demoProblem,
      cppStarter: `class Solution {\npublic:\n    int f(vector<int>& nums) {\n        return static_cast<int>(nums.size());\n    }\n};\n`,
    },
    60000,
    true,
    Date.now(),
    "cpp",
  );
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("line1\nline2\nline3\n", { status: 200 });
  try {
    const r = new CppResearch(a, async () => ({ results: [] }));
    await assert.rejects(
      r.handle("search_cpp_reference", {
        standard: "c++26",
        symbols: ["std::sort"],
        topic: "time complexity",
        tier: "secondary",
        reason: "Official standard docs did not specify the guarantee.",
      }),
      /locked/,
    );
    const receipt = (await r.handle("read_cpp_source", {
      library: "libcxx",
      path: "vector",
      startLine: 1,
      endLine: 3,
    })) as any;
    assert.match(receipt.url, /llvm\/llvm-project/);
    assert.match(receipt.excerpt, /1: line1/);

    const resolved = (await r.handle("resolve_cpp_symbol", {
      document: "recording",
      seq: 0,
      line: 4,
      column: 38,
    })) as any;
    assert.equal(resolved.language, "cpp");
    assert.equal(resolved.languageProfile, "C++26");
    assert.match(JSON.stringify(resolved.hover), /size/);

    assert.throws(
      () =>
        r.finish({
          technicalClaims: [
            {
              claim: "Unverified assumption.",
              basis: "unverified",
              sourceIds: [],
              use: "explanation",
            },
          ],
          evaluation: { gaps: [{}] },
        }),
      /penalties/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    db.db.close();
    await cppLsp().close();
  }
});

test("C++26 citations are clickable in CoachText and ResearchSources while invented URLs stay inert", () => {
  const url = "https://eel.is/c++draft/vector.overview";
  const b: ResearchBundle = {
    sources: [
      {
        id: "r1",
        title: "C++26 ISO standard draft",
        url,
        kind: "official-docs",
        version: "C++26",
        retrievedAt: Date.now(),
        excerpt: "vector overview excerpt.",
        digest: "test",
      },
    ],
    claims: [
      {
        claim: "std::vector provides contiguous storage.",
        basis: "documented",
        sourceIds: ["r1"],
        use: "explanation",
      },
    ],
    symbols: [],
    lookups: [],
    runtime: { language: "cpp", editorProfile: "C++26", executionProfile: null },
  };
  const html = renderToStaticMarkup(
    createElement(CoachText, {
      sources: b.sources,
      children: `[C++26](${url}) [invented](https://eel.is/c++draft/fake)`,
    }),
  );
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.doesNotMatch(html, /fake/);
  const card = renderToStaticMarkup(
    createElement(ResearchSources, { research: b }),
  );
  assert.match(card, /C\+\+26/);
  assert.match(card, /eel\.is/);
});

test("AgentRuntime exposes C++26 research tools when language is cpp", async () => {
  const runtime = new AgentRuntime(() => lowSettings(baselineAgentModel()));
  runtime.connect = async () => {};
  runtime.status = async () => ({
    signedIn: true,
    plan: "test",
    model: "test",
    provider: "test",
  });
  runtime.models = async () => [
    { model: baselineAgentModel(), name: "Baseline", efforts: ["low"] },
  ];
  const starts: any[] = [];
  runtime.rpc = async (method, params: any) => {
    if (method === "thread/start") {
      starts.push(params);
      return { thread: { id: "cpp-thread" }, model: params.model };
    }
    if (method === "turn/start") {
      queueMicrotask(() => {
        runtime.receive({
          method: "item/completed",
          params: {
            threadId: "cpp-thread",
            item: { type: "agentMessage", text: '{"technicalClaims":[]}' },
          },
        });
        runtime.receive({
          method: "turn/completed",
          params: { threadId: "cpp-thread", turn: { status: "completed" } },
        });
      });
      return { turn: { id: "cpp-turn" } };
    }
    return {};
  };
  await runtime.run(
    "java reference",
    "Test",
    {},
    {},
    undefined,
    undefined,
    { language: "cpp" },
  );
  assert.deepEqual(
    starts[0].dynamicTools.map((t: any) => t.name),
    [
      "read_cpp_reference",
      "read_cpp_source",
      "search_cpp_reference",
      "read_secondary_reference",
    ],
  );
});

test("C++26 attempt lifecycle, editor context validation, snapshots, test parameter parsing, and prescription", async () => {
  process.env.DUO_DATABASE = ":memory:";
  const res = await createAttempt(
    new Request("http://127.0.0.1:4318/api/state", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4318",
        origin: "http://127.0.0.1:4318",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        problem: demoProblem,
        budgetMs: 60000,
        demonstration: true,
        language: "cpp",
      }),
    }),
  );
  assert.equal(res.status, 200);
  const { attempt } = await res.json();
  assert.equal(attempt.language, "cpp");
  assert.equal(attempt.source, demoProblem.cppStarter);

  assert.deepEqual(
    testParameters({
      ...demoProblem,
      metadata: null,
      javaStarter: "",
      cppStarter:
        "class Solution {\npublic:\n    int twoSum(vector<int>& nums, int target) {\n        return 0;\n    }\n};",
    }),
    [
      { type: "vector<int>&", name: "nums" },
      { type: "int", name: "target" },
    ],
  );

  assert.ok(
    validateEditorContext(attempt, {
      file: "solution.cpp",
      source: "recording",
      seq: 0,
      cursor: { line: 1, column: 1, lineText: "class Solution {" },
    }),
  );
  assert.throws(() =>
    validateEditorContext(attempt, {
      file: "Solution.java",
      source: "recording",
      seq: 0,
      cursor: { line: 1, column: 1, lineText: "class Solution {" },
    }),
  );

  const db = new AttemptStore(":memory:");
  const sandbox = new AttemptStore(":memory:", true);
  sandbox.create(demoProblem, 60000, true, Date.now(), "cpp");
  const snap = parseSnapshot(
    captureSnapshot(
      db,
      sandbox,
      { settings: null, browser: { "duo-preferred-language": "cpp" }, pagesPreview: null },
      "C++ Snapshot",
    ),
  );
  assert.equal(snap.sandbox.attempts[0].language, "cpp");
  assert.equal(snap.browser["duo-preferred-language"], "cpp");

  const choice = { model: "fixture-planner", effort: "low" };
  const candidate = {
    title: "Two Sum",
    titleSlug: "two-sum",
    difficulty: "Easy",
    isPaidOnly: false,
    topicTags: [{ name: "Array" }],
  };
  const cppOnlyProblem = {
    ...demoProblem,
    ...candidate,
    questionId: "1",
    questionFrontendId: "1",
    javaStarter: "",
    cppStarter: "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { return {}; } };",
    locked: false,
  };
  startPrescription(db, false, {
    choice,
    run: async (input: any, tools, selectedChoice, language) => {
      assert.equal(language, "cpp");
      assert.equal(input.language, "C++26");
      await tools.handle("search_problems", { search: "two", difficulty: "EASY", skip: 0 });
      const inspected = (await tools.handle("inspect_problem", { slug: "two-sum" })) as any;
      assert.equal(inspected.available, true);
      assert.ok(inspected.cppStarter);
      return {
        value: {
          slug: "two-sum",
          reason: "Practice C++26 standard library containers and clean problem reading.",
          kind: "new-challenge",
          minutes: 20,
          evidenceIds: input.evidence.slice(0, 1).map((e: any) => e.id),
        },
        ...selectedChoice,
      };
    },
  }, "cpp");
  let status;
  for (let i = 0; i < 100; i++) {
    status = prescriptionStatus(db, choice, "cpp");
    if (status.job?.state !== "running") break;
    for (const req of status.job?.requests ?? []) {
      answerCatalogRequest(
        db,
        status.job!.id,
        req.id,
        req.op === "list" ? { totalNum: 1, questions: [candidate] } : cppOnlyProblem,
      );
    }
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(status?.job?.state, "complete", status?.job?.error ?? "");
  assert.equal(status?.prescription?.language, "cpp");
  assert.equal(savedPrescription(db, choice, "java"), undefined);
  assert.equal(savedPrescription(db, choice, "cpp")?.slug, "two-sum");

  db.db.close();
  sandbox.db.close();
});
