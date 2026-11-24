import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AcpRuntimePool,
  JsonLineDecoder,
  applyAcpTurnUpdate,
  choosePermissionOption,
  createAcpTurn,
  extractStructuredJson,
  finishAcpTurn,
  isAcpModelId,
  parseAcpModelId,
} from "../lib/acp-runtime";
import { AgentRuntime } from "../lib/agents";
import { lowSettings } from "../lib/agent-settings";

test("ACP JSONL decoder handles fragmented UTF-8 lines and rejects malformed or oversized payloads", () => {
  const received: any[] = [];
  const decoder = new JsonLineDecoder((msg) => received.push(msg), 128);
  const bytes = Buffer.from('{"text":"héllo 🌍"}\n\n{"id":2}\n', "utf8");
  for (const byte of bytes) decoder.push(Buffer.from([byte]));
  decoder.end();
  assert.deepEqual(received, [{ text: "héllo 🌍" }, { id: 2 }]);

  assert.throws(() => new JsonLineDecoder(() => {}).push("not-json\n"));
  assert.throws(
    () => new JsonLineDecoder(() => {}, 16).push("x".repeat(20) + "\n"),
    /limit/,
  );
});

test("ACP turn state merges message, thought, and partial tool updates and marks cancelled tools", () => {
  const turn = createAcpTurn("prompt", 100);
  applyAcpTurnUpdate(
    turn,
    {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Checking bounds..." },
    },
    110,
  );
  applyAcpTurnUpdate(
    turn,
    {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      name: "read_evidence",
      status: "in_progress",
      rawInput: { seq: 4 },
    },
    120,
  );
  applyAcpTurnUpdate(
    turn,
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      rawOutput: { ok: true },
    },
    130,
  );
  applyAcpTurnUpdate(
    turn,
    {
      sessionUpdate: "tool_call",
      toolCallId: "t2",
      name: "read_java_reference",
      status: "pending",
    },
    135,
  );
  applyAcpTurnUpdate(
    turn,
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: '{"answer":"ok"}' },
    },
    140,
  );
  assert.deepEqual(turn.tools.t1.rawInput, { seq: 4 });
  assert.equal(turn.tools.t1.endedAt, 130);

  finishAcpTurn(turn, "cancelled", undefined, 150);
  assert.equal(turn.status, "cancelled");
  assert.equal(turn.tools.t2.status, "cancelled");
  assert.equal(turn.tools.t2.endedAt, 150);
});

test("extractStructuredJson parses raw JSON, fenced json blocks, and framed JSON objects", () => {
  assert.deepEqual(extractStructuredJson('{"ok":true}'), { ok: true });
  assert.deepEqual(extractStructuredJson('```json\n{"a":1,"b":"x"}\n```'), {
    a: 1,
    b: "x",
  });
  assert.deepEqual(
    extractStructuredJson('Here is the JSON:\n{"msg":"brace { inside } string"}\n'),
    { msg: "brace { inside } string" },
  );
  assert.throws(() => extractStructuredJson("no braces here"));
});

test("choosePermissionOption allows only registered DuoLeetCode MCP tools or scoped web search and rejects host tools", () => {
  const allowed = new Set(["read_evidence", "read_java_reference"]);
  const options = [
    { optionId: "allow-1", kind: "allow_once" },
    { optionId: "reject-1", kind: "reject_once" },
  ];

  assert.deepEqual(
    choosePermissionOption(
      { toolCall: { name: "mcp__duoleetcode__read_evidence" }, options },
      allowed,
      false,
    ),
    { outcome: "selected", optionId: "allow-1" },
  );
  assert.deepEqual(
    choosePermissionOption(
      {
        toolCall: {
          title: "duoleetcode - read_evidence (MCP)",
          _meta: { claudeCode: { toolName: "mcp__duoleetcode__read_evidence" } },
        },
        options,
      },
      allowed,
      false,
    ),
    { outcome: "selected", optionId: "allow-1" },
  );
  assert.deepEqual(
    choosePermissionOption(
      { toolCall: { name: "Bash" }, options },
      allowed,
      true,
    ),
    { outcome: "selected", optionId: "reject-1" },
  );
  assert.deepEqual(
    choosePermissionOption(
      { toolCall: { name: "WebSearch", kind: "search" }, options },
      allowed,
      false,
    ),
    { outcome: "selected", optionId: "reject-1" },
  );
  assert.deepEqual(
    choosePermissionOption(
      { toolCall: { name: "WebSearch", kind: "search" }, options },
      allowed,
      true,
    ),
    { outcome: "selected", optionId: "allow-1" },
  );
});

test("parseAcpModelId distinguishes ACP provider models from native Codex models", () => {
  assert.equal(isAcpModelId("gpt-6.1-sol"), false);
  assert.deepEqual(parseAcpModelId("claude-acp/sonnet"), {
    provider: "claude-acp",
    rawModel: "sonnet",
  });
  assert.deepEqual(parseAcpModelId("agy-acp/gemini-4-neon"), {
    provider: "agy-acp",
    rawModel: "gemini-4-neon",
  });
});

test("AcpRuntimePool + AgentRuntime execute end-to-end ACP turns with MCP Unix-socket tools, JSON fence repair, and permission guard", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "duo-acp-e2e-"));
  const fixtureScript = path.join(tempDir, "fixture-acp-agent.mjs");
  writeFileSync(
    fixtureScript,
    `
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

let sessionParams = null;
let turnCount = 0;
let pendingBashId = null;
let activePromptId = null;
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    send({
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          sessionCapabilities: { systemPrompt: { mode: { override: {} } }, close: {} },
          _meta: { antigravity: { systemPrompt: { append: true } } },
        },
        agentInfo: { name: "fixture-acp", version: "0.1.0" },
      },
    });
    return;
  }
  if (msg.method === "session/new") {
    sessionParams = msg.params;
    send({
      id: msg.id,
      result: {
        sessionId: "acp-session-1",
        configOptions: [
          { id: "model", category: "model", options: [{ value: "gemini-test", name: "Gemini Test" }] },
          { id: "thought_level", category: "thought_level", options: [{ value: "low", name: "Low" }] },
        ],
        _meta: { antigravity: { tier: { name: "Test Tier" } } },
      },
    });
    return;
  }
  if (msg.method === "session/set_config_option" || msg.method === "session/close") {
    send({ id: msg.id, result: {} });
    return;
  }
  if (msg.method === "session/prompt") {
    activePromptId = msg.id;
    turnCount++;
    // First attempt to request Bash permission — must be rejected by DuoLeetCode!
    pendingBashId = "perm-bash-" + turnCount;
    send({
      id: pendingBashId,
      method: "session/request_permission",
      params: {
        sessionId: "acp-session-1",
        toolCall: { name: "Bash" },
        options: [
          { optionId: "allow", kind: "allow_once" },
          { optionId: "deny", kind: "reject_once" },
        ],
      },
    });
    return;
  }
  if (msg.id === pendingBashId && msg.result) {
    const bashDenied = msg.result.outcome?.optionId === "deny";
    const mcp = sessionParams.mcpServers?.[0];
    if (!mcp) {
      send({
        method: "session/update",
        params: {
          sessionId: "acp-session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: JSON.stringify({ bashDenied, toolResult: null }) },
          },
        },
      });
      send({ id: activePromptId, result: { stopReason: "end_turn", usage: { inputTokens: 40, outputTokens: 15 } } });
      return;
    }
    const child = spawn(mcp.command, mcp.args, { stdio: ["pipe", "pipe", "ignore"] });
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (replyLine) => {
      const reply = JSON.parse(replyLine);
      if (reply.id === 10) {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "custom_lookup", arguments: { key: "alpha" } } }) + "\\n");
      } else if (reply.id === 11) {
        const parsedTool = JSON.parse(reply.result.content[0].text);
        const wrapped = "\`\`\`json\\n" + JSON.stringify({ bashDenied, toolResult: parsedTool }) + "\\n\`\`\`";
        send({
          method: "session/update",
          params: {
            sessionId: "acp-session-1",
            update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Verified via MCP." } },
          },
        });
        send({
          method: "session/update",
          params: {
            sessionId: "acp-session-1",
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: wrapped } },
          },
        });
        send({ id: activePromptId, result: { stopReason: "end_turn", usage: { inputTokens: 50, outputTokens: 20 } } });
        child.stdin.end();
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list", params: {} }) + "\\n");
  }
});
`,
  );

  const pool = new AcpRuntimePool(path.join(tempDir, "workspace"), (id) =>
    id === "agy-acp"
      ? {
          id: "agy-acp",
          label: "Fixture Antigravity ACP",
          shortPrefix: "Fixture",
          command: process.execPath,
          args: [fixtureScript],
        }
      : null,
  );

  const runtime = new AgentRuntime(() => ({
    ...lowSettings("agy-acp/gemini-test"),
    preset: "custom",
  }));
  runtime.acp = pool;
  runtime.includeAcpModels = true;
  runtime.connect = async () => {
    throw new Error("Codex unavailable in ACP-only test");
  };

  try {
    const models = await runtime.models();
    assert.equal(models.length, 1);
    assert.equal(models[0].model, "agy-acp/gemini-test");

    const out = await runtime.run(
      "reflection coach",
      "Return the lookup output.",
      { test: true },
      {
        type: "object",
        properties: { bashDenied: { type: "boolean" }, toolResult: {} },
      },
      undefined,
      undefined,
      {
        skipEvidenceAudit: true,
        tools: {
          definitions: [
            {
              type: "function",
              name: "custom_lookup",
              description: "Lookup a test key",
              inputSchema: {
                type: "object",
                properties: { key: { type: "string" } },
                required: ["key"],
                additionalProperties: false,
              },
            },
          ],
          handle: async (_name, input: any) => ({
            echoedKey: input.key,
            count: 42,
          }),
        },
      },
    );

    assert.equal(out.model, "agy-acp/gemini-test");
    assert.equal(out.value.bashDenied, true);
    assert.deepEqual(out.value.toolResult, { echoedKey: "alpha", count: 42 });
  } finally {
    runtime.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
