import assert from "node:assert/strict";
import { AgentRuntime } from "../lib/agents";
import { traced, traces } from "../lib/agent-traces";
const runtime = new AgentRuntime();
const schema = {
  type: "object",
  properties: { receipt: { type: "string" } },
  required: ["receipt"],
  additionalProperties: false,
};
try {
  const root = await traced(
    {
      role: "diagnostics check",
      kind: "workflow",
      mode: "test",
      subjectId: "trace-smoke",
    },
    async (trace) => {
      const result = await runtime.run(
        "planner",
        "This is a diagnostics check using synthetic data. Call read_diagnostic_fixture exactly once, then copy its receipt into your structured response.",
        { request: "Read the diagnostic fixture." },
        schema,
        undefined,
        undefined,
        {
          tools: {
            definitions: [
              {
                type: "function",
                name: "read_diagnostic_fixture",
                description:
                  "Read a synthetic diagnostic fixture. No practice data is used.",
                inputSchema: {
                  type: "object",
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
            handle: async (name) => {
              assert.equal(name, "read_diagnostic_fixture");
              const child = await runtime.run(
                "java reference",
                "Return the supplied receipt verbatim. This is a protocol check, no research or coaching.",
                { receipt: "diagnostics-verified" },
                schema,
                undefined,
                undefined,
                { audit: true },
              );
              assert.equal(child.value.receipt, "diagnostics-verified");
              return { receipt: child.value.receipt };
            },
          },
        },
      );
      assert.equal(result.value.receipt, "diagnostics-verified");
      trace.event("workflow.verified", { receipt: result.value.receipt });
      return trace.id;
    },
  );
  const family = traces().export(root);
  assert.equal(family.runs.length, 3);
  assert.ok(family.runs.every((r) => r.status === "succeeded"));
  const parent = family.runs.find((r) => r.kind === "model")!;
  assert.ok(parent.events.some((e) => e.kind === "tool.started"));
  assert.ok(parent.events.some((e) => e.kind === "tool.completed"));
  assert.equal(
    family.runs.find((r) => r.kind === "audit")!.parentId,
    parent.id,
  );
  console.log(
    JSON.stringify(
      {
        root,
        runs: family.runs.map(({ id, role, status, usage, events }) => ({
          id,
          role,
          status,
          usage,
          events: events.length,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  runtime.close();
}
