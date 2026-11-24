// Stdio MCP server passed to ACP sessions (`session/new` -> `mcpServers`).
// Forwards dynamic DuoLeetCode tool listing and execution over a private 0600
// local Unix socket owned by the parent Node process.
import { createConnection } from "node:net";

const socketPath = process.argv[2];
const sessionToken = process.argv[3];
if (!socketPath || !sessionToken) process.exit(1);

const MAX_LINE = 16 * 1024 * 1024;

function parseLines(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let end;
    while ((end = buffer.indexOf(10)) >= 0) {
      if (end > MAX_LINE) throw new Error("JSON line exceeds transport limit");
      const line = buffer.subarray(0, end).toString("utf8").trim();
      buffer = buffer.subarray(end + 1);
      if (line) onMessage(JSON.parse(line));
    }
    if (buffer.length > MAX_LINE)
      throw new Error("JSON line exceeds transport limit");
  };
}

function callParent(payload) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Local tool host timed out"));
    }, 65000);
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(data);
    };
    const push = parseLines((reply) => {
      if (reply?.error && reply.ok === false && reply.fatal) {
        finish(new Error(String(reply.error)));
      } else {
        finish(null, reply);
      }
    });
    socket.on("connect", () => {
      socket.write(JSON.stringify({ token: sessionToken, ...payload }) + "\n");
    });
    socket.on("data", (chunk) => {
      try {
        push(chunk);
      } catch (e) {
        finish(e);
      }
    });
    socket.on("error", () => finish(new Error("Local tool host unavailable")));
    socket.on("end", () => finish(new Error("Local tool host closed")));
  });
}

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

const onStdin = parseLines(async (message) => {
  if (!message || typeof message !== "object" || message.id === undefined) {
    return;
  }
  try {
    let result;
    if (message.method === "server/discover") {
      result = {
        resultType: "complete",
        supportedVersions: ["2026-07-28", "2025-06-18", "2024-11-05"],
        capabilities: { tools: {} },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "duoleetcode",
            version: "0.2.0",
          },
        },
      };
    } else if (message.method === "initialize") {
      const requested = String(message.params?.protocolVersion ?? "");
      const protocolVersion = [
        "2024-11-05",
        "2025-03-26",
        "2025-06-18",
      ].includes(requested)
        ? requested
        : "2024-11-05";
      result = {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "duoleetcode", version: "0.2.0" },
      };
    } else if (message.method === "ping") {
      result = {};
    } else if (message.method === "tools/list") {
      const reply = await callParent({ op: "list" });
      const defs = Array.isArray(reply?.tools) ? reply.tools : [];
      result = {
        tools: defs.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
        })),
      };
    } else if (message.method === "tools/call" && message.params?.name) {
      const reply = await callParent({
        op: "call",
        name: String(message.params.name),
        arguments: message.params.arguments ?? {},
      });
      const ok = reply?.ok !== false;
      result = {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              ok ? reply?.data : { error: reply?.error ?? "Tool call failed" },
            ),
          },
        ],
        ...(ok ? {} : { isError: true }),
      };
    } else {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
        isError: true,
      },
    });
  }
});

process.stdin.on("data", (bytes) => {
  try {
    onStdin(bytes);
  } catch {
    process.exit(1);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdout.on("error", () => process.exit(0));
