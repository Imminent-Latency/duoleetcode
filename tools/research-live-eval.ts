// Opt-in research checks. All source and conversation fixtures are synthetic.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { agent, reflect } from "../lib/agents";
import { reflectionFixture, sorting } from "./reflection-fixture";
const results: any[] = [];
try {
  const search = await agent().searchTechnical(
    "Java 25 Arrays.sort(int[]) space complexity",
    "official",
    { model: "gpt-6.1-sol", effort: "low" },
  );
  assert.ok(search.results.length);
  results.push({ name: "official restricted search", pass: true, ...search });
  const a = reflectionFixture();
  a.source = sorting;
  a.reflection = {
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        text: "For OpenJDK 25 specifically, can Arrays.sort(int[]) allocate O(n) auxiliary memory even though it modifies the input? Check official documentation and the actual versioned implementation before answering. Please include clickable sources. Browser symbol lookup is unavailable in this offline fixture; resolve the obvious int[] signature from source instead of waiting for the browser.",
        createdAt: Date.now(),
      },
    ],
  };
  const result = await reflect(a, { model: "gpt-6.1-sol", effort: "low" });
  assert.ok(result.research?.sources.some((s) => s.kind === "official-docs"));
  assert.ok(result.research?.sources.some((s) => s.kind === "official-source"));
  assert.ok(
    result.research?.claims.some(
      (c) => c.basis === "implementation-derived" && c.sourceIds.length,
    ),
  );
  assert.match(result.result.message, /https:\/\//);
  results.push({
    name: "versioned primitive-sort explanation",
    pass: true,
    ...result,
  });
} finally {
  writeFileSync(
    ".local/research-live-eval.json",
    JSON.stringify(results, null, 2),
  );
  agent().close();
}
console.log(JSON.stringify(results.map(({ name, pass }) => ({ name, pass }))));
