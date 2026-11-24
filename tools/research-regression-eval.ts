// Opt-in synthetic API/aliasing regressions, no learner state or settings writes.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { reflectionFixture } from "./reflection-fixture";
const cases = [
  {
    name: "object-array overload",
    source:
      "import java.util.Arrays; class Solution { void example(Integer[] nums) { Arrays.sort(nums); } }",
    question:
      "For Java 25, explain the auxiliary-space behavior of this object-array sort. Check its exact overload in official documentation and cite your sources. This fixture has no live browser LSP; do not wait for symbol lookup.",
  },
  {
    name: "alias versus copying",
    source:
      "class Solution { void example(int[] nums) { int[] alias = nums; int[] copy = nums.clone(); } }",
    question:
      "Does assigning alias allocate a second array of n ints? How is the clone different? Verify using the official Java language specification and include clickable sources. This fixture has no live browser LSP; infer the explicit int[] types from the supplied source.",
  },
];
const results = [];
try {
  for (const c of cases) {
    const a = reflectionFixture();
    a.initialSource = c.source;
    a.source = c.source;
    a.events = [];
    a.lastSeq = 0;
    a.jobs = [];
    a.reflection = {
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          text: c.question,
          createdAt: Date.now(),
        },
      ],
    };
    const r = await reflect(a, { model: "gpt-6.1-sol", effort: "low" });
    assert.ok(r.research?.sources.some((s) => s.kind === "official-docs"));
    assert.ok(
      r.research?.claims.some(
        (c) => c.basis === "documented" && c.sourceIds.length,
      ),
    );
    assert.match(r.result.message, /https:\/\//);
    results.push({ name: c.name, pass: true, ...r });
  }
  const search = await agent().searchTechnical(
    "Java 25 Arrays.sort(int[]) space complexity",
    "official",
    { model: "gpt-6.1-sol", effort: "low" },
  );
  assert.ok(
    search.results.some((r) => new URL(r.url).hostname === "docs.oracle.com"),
  );
  assert.ok(
    search.results.every((r) =>
      [
        "docs.oracle.com",
        "openjdk.org",
        "dev.java",
        "www.openjdk.org",
      ].includes(new URL(r.url).hostname),
    ),
  );
  results.push({
    name: "documentation-only search domains",
    pass: true,
    ...search,
  });
} finally {
  writeFileSync(
    ".local/research-regression-eval.json",
    JSON.stringify(results, null, 2),
  );
  agent().close();
}
console.log(JSON.stringify(results.map(({ name, pass }) => ({ name, pass }))));
