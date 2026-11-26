import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AgentRuntime } from "../lib/agents";
import { lowSettings } from "../lib/agent-settings";
import { TraceStore } from "../lib/agent-traces";

const outSchema = z
  .object({
    computed: z.number().int(),
    usedTool: z.boolean(),
  })
  .strict();

async function main() {
  const traceStore = new TraceStore(":memory:");
  const runtime = new AgentRuntime(
    () => lowSettings("gpt-6.1-sol"),
    traceStore,
  );
  runtime.includeAcpModels = true;

  try {
    const status = await runtime.status();
    const models = await runtime.models();
    const claudeModel =
      models.find((m) => m.model === "claude-acp/haiku") ??
      models.find((m) => m.provider === "claude-acp");

    if (!claudeModel) throw new Error("No claude-acp model discovered");

    const results: Record<string, any> = {};
    for (const candidate of [claudeModel]) {
      const started = Date.now();
      let toolCalls = 0;
      const effort = candidate.efforts.includes("low")
        ? "low"
        : candidate.efforts[0]!;
      const res = await runtime.run(
        "reflection coach",
        "Call the read_probe_token tool once, multiply secretValue by multiplier, and return { computed, usedTool: true }.",
        { task: "mcp-and-structured-output-probe" },
        z.toJSONSchema(outSchema),
        undefined,
        { model: candidate.model, effort },
        {
          skipEvidenceAudit: true,
          timeoutMs: 90000,
          tools: {
            definitions: [
              {
                type: "function",
                name: "read_probe_token",
                description:
                  "Read the dynamic secretValue and multiplier from the DuoLeetCode host.",
                inputSchema: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                },
              },
            ],
            handle: async () => {
              toolCalls++;
              return { secretValue: 19, multiplier: 3 };
            },
          },
        },
      );
      const parsed = outSchema.parse(res.value);
      assert.equal(parsed.computed, 57);
      assert.equal(parsed.usedTool, true);
      assert.ok(toolCalls >= 1, `${candidate.model} must invoke MCP tool`);
      results[candidate.model] = {
        elapsedMs: Date.now() - started,
        effort,
        toolCalls,
        output: parsed,
        traceId: res.traceId,
      };
    }

    const report = {
      verifiedAt: new Date().toISOString(),
      providers: status.providers,
      totalModelsDiscovered: models.length,
      results,
    };
    mkdirSync(path.join(process.cwd(), ".local"), { recursive: true });
    writeFileSync(
      path.join(process.cwd(), ".local", "acp-smoke-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    runtime.close();
  }
}

await main();
