import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentTrace } from "./agent-traces";
import { traceScope } from "./agent-traces";
import type { AgentModel, AgentProviderId } from "./agent-settings";

export const MAX_ACP_MESSAGE = 16 * 1024 * 1024;

export type AcpProviderId = Exclude<AgentProviderId, "codex">;

export type AcpProviderStatus = {
  id: AgentProviderId;
  name: string;
  transport: string;
  signedIn: boolean;
  plan: string | null;
  detail: string;
  modelCount?: number;
};

export type DynamicToolSpec = {
  type: "function";
  name: string;
  description: string;
  inputSchema: unknown;
};

export class JsonLineDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  constructor(
    private readonly onMessage: (message: any) => void,
    private readonly maxBytes = MAX_ACP_MESSAGE,
  ) {}
  push(chunk: Buffer | string) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.buffer = Buffer.concat([this.buffer, bytes]);
    let end: number;
    while ((end = this.buffer.indexOf(10)) >= 0) {
      if (end > this.maxBytes)
        throw new Error("ACP JSON line exceeds transport limit");
      const line = this.buffer.subarray(0, end).toString("utf8").trim();
      this.buffer = this.buffer.subarray(end + 1);
      if (line) this.onMessage(JSON.parse(line));
    }
    if (this.buffer.length > this.maxBytes)
      throw new Error("ACP JSON line exceeds transport limit");
  }
  end() {
    if (this.buffer.toString("utf8").trim())
      throw new Error("Truncated ACP JSON line");
  }
}

export function isJsonRpc(message: unknown): message is Record<string, any> {
  return (
    !!message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    (message as any).jsonrpc === "2.0" &&
    (typeof (message as any).method === "string" ||
      ("id" in (message as any) &&
        ("result" in (message as any) || "error" in (message as any))))
  );
}

export type AcpTurnEntry = {
  id: string;
  type: "message" | "reasoning" | "tool" | "plan";
  startedAt: number;
  endedAt?: number | null;
  text?: string;
  toolCallId?: string;
  title?: string;
  name?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown;
  plan?: unknown[];
};

export type AcpTurnState = {
  prompt: unknown;
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  status: string;
  phase: string;
  entries: AcpTurnEntry[];
  tools: Record<string, AcpTurnEntry>;
  sequence: number;
  stopReason: string | null;
  usage?: Record<string, any>;
  error?: string;
};

export function createAcpTurn(prompt: unknown, now = Date.now()): AcpTurnState {
  return {
    prompt,
    startedAt: now,
    lastEventAt: now,
    endedAt: null,
    status: "working",
    phase: "Waiting for the agent",
    entries: [],
    tools: {},
    sequence: 0,
    stopReason: null,
  };
}

export function applyAcpTurnUpdate(
  turn: AcpTurnState,
  update: Record<string, any>,
  now = Date.now(),
) {
  if (turn.endedAt !== null) return;
  turn.lastEventAt = now;
  const kind = update?.sessionUpdate;
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    if (update.content?.type !== "text" || !update.content.text) return;
    const type = kind === "agent_message_chunk" ? "message" : "reasoning";
    let item = turn.entries.at(-1);
    if (item?.type !== type) {
      item = {
        id: `entry-${++turn.sequence}`,
        type,
        startedAt: now,
        text: "",
      };
      turn.entries.push(item);
    }
    item.text = (item.text ?? "") + update.content.text;
    turn.phase = type === "message" ? "Writing a response" : "Thinking";
  } else if (
    (kind === "tool_call" || kind === "tool_call_update") &&
    typeof update.toolCallId === "string"
  ) {
    let item = turn.tools[update.toolCallId];
    if (!Object.hasOwn(turn.tools, update.toolCallId)) {
      item = {
        id: `entry-${++turn.sequence}`,
        type: "tool",
        startedAt: now,
        toolCallId: update.toolCallId,
        title: "Tool call",
        status: "pending",
      };
      turn.entries.push(item);
      turn.tools[update.toolCallId] = item;
    }
    for (const key of [
      "title",
      "name",
      "kind",
      "status",
      "rawInput",
      "rawOutput",
      "content",
    ] as const) {
      if (Object.hasOwn(update, key)) (item as any)[key] = update[key];
    }
    if (["completed", "failed", "cancelled"].includes(item.status ?? ""))
      item.endedAt ??= now;
    else item.endedAt = null;
    const active = Object.values(turn.tools).find((t) =>
      ["pending", "in_progress"].includes(t.status ?? ""),
    );
    turn.phase = active
      ? `Running ${active.title || active.name || "tool"}`
      : "Agent continuing";
  } else if (kind === "plan" && Array.isArray(update.entries)) {
    let item = turn.entries.find((e) => e.type === "plan");
    if (!item) {
      item = { id: `entry-${++turn.sequence}`, type: "plan", startedAt: now };
      turn.entries.push(item);
    }
    item.plan = update.entries;
    turn.phase = "Updating the plan";
  } else if (kind === "usage_update") {
    turn.usage = update;
  }
}

export function finishAcpTurn(
  turn: AcpTurnState,
  reason: string,
  error?: string,
  now = Date.now(),
) {
  if (turn.endedAt !== null) return;
  turn.endedAt = now;
  turn.stopReason = reason;
  const states: Record<string, [string, string]> = {
    end_turn: ["completed", "Finished"],
    cancelled: ["cancelled", "Stopped"],
    disconnected: ["interrupted", "Disconnected"],
    error: ["failed", "Turn failed"],
    max_tokens: ["limited", "Token limit reached"],
    max_turn_requests: ["limited", "Turn limit reached"],
    refusal: ["limited", "Agent declined"],
  };
  [turn.status, turn.phase] = states[reason] ?? ["limited", "Turn ended"];
  if (error) turn.error = error;
  for (const tool of Object.values(turn.tools)) {
    if (["pending", "in_progress"].includes(tool.status ?? "")) {
      tool.status = reason === "cancelled" ? "cancelled" : "interrupted";
      tool.endedAt = now;
    }
  }
}

export function extractStructuredJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty model response");
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const anyFence = /```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/i.exec(trimmed);
  if (anyFence) {
    try {
      return JSON.parse(anyFence[1].trim());
    } catch {}
  }
  // Balanced top-level JSON object scan in case a model adds brief framing prose.
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(firstBrace, i + 1);
          return JSON.parse(candidate);
        }
      }
    }
  }
  throw new Error("Response did not contain a valid JSON object");
}

export function parseAcpModelId(
  modelId: string,
): { provider: AcpProviderId; rawModel: string } | null {
  for (const prefix of ["claude-acp", "agy-acp", "codex-acp"] as const) {
    if (modelId.startsWith(prefix + "/")) {
      const rawModel = modelId.slice(prefix.length + 1).trim();
      if (rawModel) return { provider: prefix, rawModel };
    }
  }
  return null;
}

export function isAcpModelId(modelId: string): boolean {
  return parseAcpModelId(modelId) !== null;
}

function findOutsideNodeModules(bin: string, envOverride?: string): string | null {
  if (envOverride) {
    try {
      accessSync(envOverride);
      return envOverride;
    } catch {
      return null;
    }
  }
  const searchPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => !entry.includes("node_modules" + path.sep + ".bin"))
    .join(path.delimiter);
  const res = spawnSync("which", [bin], {
    encoding: "utf8",
    env: { ...process.env, PATH: searchPath },
  });
  const found = res.status === 0 ? res.stdout.trim().split(/\r?\n/)[0] : "";
  return found || null;
}

export type AcpAdapterSpec = {
  id: AcpProviderId;
  label: string;
  shortPrefix: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export function resolveAcpAdapterSpec(
  provider: AcpProviderId,
): AcpAdapterSpec | null {
  if (provider === "claude-acp") {
    const entry = path.resolve(
      process.cwd(),
      "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    );
    try {
      accessSync(entry);
    } catch {
      return null;
    }
    const claudeBin = findOutsideNodeModules(
      "claude",
      process.env.DUO_CLAUDE_BIN,
    );
    return {
      id: "claude-acp",
      label: "Claude (Claude SDK · ACP)",
      shortPrefix: "Claude",
      command: process.execPath,
      args: [entry],
      env: {
        CLAUDE_AGENT_ACP_PROTOCOL: "v1",
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false",
        ENABLE_TOOL_SEARCH: "false",
        MCP_PROTOCOL_NEGOTIATION: "legacy",
        ...(claudeBin ? { CLAUDE_CODE_EXECUTABLE: claudeBin } : {}),
      },
    };
  }
  if (provider === "agy-acp") {
    const agyBin = findOutsideNodeModules("agy", process.env.DUO_AGY_BIN);
    if (!agyBin) return null;
    return {
      id: "agy-acp",
      label: "Antigravity (Gemini · ACP)",
      shortPrefix: "Antigravity",
      command: agyBin,
      args: ["acp", "--include-default-customizations=false"],
      env: {},
    };
  }
  if (provider === "codex-acp") {
    const entry = path.resolve(
      process.cwd(),
      "node_modules/@agentclientprotocol/codex-acp/dist/index.js",
    );
    const codexBin = findOutsideNodeModules("codex", process.env.DUO_CODEX_BIN);
    try {
      accessSync(entry);
    } catch {
      return null;
    }
    if (!codexBin) return null;
    return {
      id: "codex-acp",
      label: "Codex (ACP Adapter)",
      shortPrefix: "Codex ACP",
      command: process.execPath,
      args: [entry],
      env: { CODEX_PATH: codexBin },
    };
  }
  return null;
}

type RegisteredToolSession = {
  definitions: DynamicToolSpec[];
  trace?: AgentTrace;
  handle: (name: string, args: unknown) => Promise<{ ok: boolean; data: unknown }>;
};

export class AcpToolBroker {
  private dir?: string;
  private server?: Server;
  private sockets = new Set<Socket>();
  private sessions = new Map<string, RegisteredToolSession>();
  socketPath = "";
  private ready?: Promise<string>;

  async ensureStarted(): Promise<string> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "duo-acp-"));
      chmodSync(dir, 0o700);
      const sock = path.join(dir, "tools.sock");
      const server = createServer((socket) => {
        this.sockets.add(socket);
        const decoder = new JsonLineDecoder(async (msg) => {
          const session =
            typeof msg?.token === "string"
              ? this.sessions.get(msg.token)
              : undefined;
          if (!session) {
            socket.end(
              JSON.stringify({
                ok: false,
                fatal: true,
                error: "Tool session unavailable",
              }) + "\n",
            );
            return;
          }
          if (msg.op === "list") {
            socket.end(
              JSON.stringify({ ok: true, tools: session.definitions }) + "\n",
            );
            return;
          }
          if (msg.op === "call" && typeof msg.name === "string") {
            const allowed = session.definitions.some((d) => d.name === msg.name);
            if (!allowed) {
              socket.end(
                JSON.stringify({ ok: false, error: "Tool not permitted" }) + "\n",
              );
              return;
            }
            const startedAt = Date.now();
            const callId = `acp-mcp-${randomUUID()}`;
            session.trace?.event("tool.started", {
              callId,
              tool: msg.name,
              arguments: msg.arguments,
            });
            try {
              const run = () => session.handle(msg.name, msg.arguments ?? {});
              const outcome = session.trace
                ? await traceScope.run(session.trace, run)
                : await run();
              session.trace?.event("tool.completed", {
                callId,
                tool: msg.name,
                durationMs: Date.now() - startedAt,
                result: outcome.data,
                ...(outcome.ok ? {} : { error: outcome.data }),
              });
              socket.end(
                JSON.stringify(
                  outcome.ok
                    ? { ok: true, data: outcome.data }
                    : {
                        ok: false,
                        error:
                          (outcome.data as any)?.error ??
                          String(outcome.data ?? "Tool failed"),
                      },
                ) + "\n",
              );
            } catch (e) {
              const errText = e instanceof Error ? e.message : String(e);
              session.trace?.event("tool.completed", {
                callId,
                tool: msg.name,
                durationMs: Date.now() - startedAt,
                error: { message: errText },
              });
              socket.end(
                JSON.stringify({ ok: false, error: errText }) + "\n",
              );
            }
            return;
          }
          socket.end(
            JSON.stringify({ ok: false, error: "Unsupported broker op" }) + "\n",
          );
        });
        socket.on("data", (chunk) => {
          try {
            decoder.push(chunk);
          } catch {
            socket.destroy();
          }
        });
        socket.on("error", () => {});
        socket.on("close", () => this.sockets.delete(socket));
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(sock, () => resolve());
      });
      chmodSync(sock, 0o600);
      server.unref?.();
      this.dir = dir;
      this.server = server;
      this.socketPath = sock;
      return sock;
    })();
    try {
      return await this.ready;
    } catch (e) {
      this.ready = undefined;
      throw e;
    }
  }

  register(session: RegisteredToolSession): {
    token: string;
    unregister: () => void;
  } {
    const token = randomUUID();
    this.sessions.set(token, session);
    return {
      token,
      unregister: () => {
        this.sessions.delete(token);
      },
    };
  }

  close() {
    this.sessions.clear();
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    this.server?.close();
    if (this.dir) {
      try {
        rmSync(this.dir, { recursive: true, force: true });
      } catch {}
    }
    this.dir = undefined;
    this.server = undefined;
    this.ready = undefined;
  }
}

export function choosePermissionOption(
  params: Record<string, any>,
  allowedToolNames: Set<string>,
  allowWebSearch: boolean,
): { outcome: "selected"; optionId: string } | { outcome: "cancelled" } {
  const candidates = [
    params?.toolCall?._meta?.claudeCode?.toolName,
    params?.toolCall?.name,
    params?.toolCall?.title,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());

  const matchesOurMcp = (raw: string) => {
    const normalized = raw
      .replace(/^mcp_+duoleetcode_+/, "")
      .replace(/^duoleetcode\s*[-./:]+\s*/, "")
      .replace(/\s*\(MCP\)\s*$/i, "")
      .trim();
    return (
      /^mcp_+duoleetcode_+/i.test(raw) ||
      raw.startsWith("duoleetcode.") ||
      raw.startsWith("duoleetcode:") ||
      raw.startsWith("duoleetcode/") ||
      /^duoleetcode\s*-\s*/i.test(raw) ||
      allowedToolNames.has(normalized)
    );
  };

  const isOurMcpTool = candidates.some(matchesOurMcp);
  const isAllowedSearch =
    allowWebSearch &&
    (params?.toolCall?.kind === "search" ||
      candidates.some((c) => /^(?:web_?search|search_web|google_search)$/i.test(c)));

  const options: Array<{ optionId: string; kind?: string }> = Array.isArray(
    params?.options,
  )
    ? params.options
    : [];

  if (isOurMcpTool || isAllowedSearch) {
    const allow =
      options.find((o) => o.kind === "allow_once") ??
      options.find((o) => String(o.kind ?? "").startsWith("allow")) ??
      options.find((o) => /allow/i.test(o.optionId));
    if (allow) return { outcome: "selected", optionId: allow.optionId };
  }
  const reject = options.find((o) =>
    String(o.kind ?? "").startsWith("reject"),
  );
  if (reject) return { outcome: "selected", optionId: reject.optionId };
  return { outcome: "cancelled" };
}

class AcpAdapterConnection {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<Record<string, any>>;
  private seq = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sessionListeners = new Map<string, (msg: Record<string, any>) => void>();
  private permissionHandlers = new Map<
    string,
    (params: Record<string, any>) => { outcome: string; optionId?: string }
  >();
  initResult?: Record<string, any>;

  constructor(
    public readonly spec: AcpAdapterSpec,
    private readonly cwd: string,
  ) {}

  async connect(): Promise<Record<string, any>> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      mkdirSync(this.cwd, { recursive: true, mode: 0o700 });
      const child = spawn(
        /* turbopackIgnore: true */ this.spec.command,
        this.spec.args,
        {
          cwd: this.cwd,
          env: { ...process.env, ...this.spec.env },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      this.child = child;
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => {});
      child.on("error", (err) =>
        this.fail(
          new Error(`Could not start ${this.spec.label}: ${err.message}`),
        ),
      );
      child.on("exit", () =>
        this.fail(new Error(`${this.spec.label} ACP process exited.`)),
      );
      const decoder = new JsonLineDecoder((msg) => {
        if (!isJsonRpc(msg)) return;
        this.onMessage(msg);
      });
      child.stdout.on("data", (chunk) => {
        try {
          decoder.push(chunk);
        } catch (e) {
          this.fail(
            e instanceof Error ? e : new Error("Malformed ACP stream"),
          );
        }
      });
      const init = await this.request(
        "initialize",
        {
          protocolVersion: 1,
          clientInfo: { name: "duoleetcode", version: "0.2.0" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        },
        20000,
      );
      if (init?.protocolVersion !== 1 || !init?.agentCapabilities) {
        throw new Error(`Incompatible ACP handshake from ${this.spec.label}`);
      }
      this.initResult = init;
      return init;
    })();
    try {
      return await this.ready;
    } catch (e) {
      this.close();
      throw e;
    }
  }

  private onMessage(msg: Record<string, any>) {
    if (msg.method && msg.id !== undefined) {
      if (msg.method === "session/request_permission") {
        const sid = msg.params?.sessionId;
        const handler = sid ? this.permissionHandlers.get(sid) : undefined;
        const outcome = handler
          ? handler(msg.params ?? {})
          : { outcome: "cancelled" };
        this.write({ jsonrpc: "2.0", id: msg.id, result: { outcome } });
        return;
      }
      this.write({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Client capability not available" },
      });
      return;
    }
    if (msg.method === "session/update") {
      const sid = msg.params?.sessionId;
      if (sid) this.sessionListeners.get(sid)?.(msg.params);
      return;
    }
    if (!msg.method && msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || "ACP error"));
      else p.resolve(msg.result);
    }
  }

  private write(payload: unknown) {
    if (this.child?.stdin.writable) {
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    }
  }

  request(method: string, params: unknown, timeoutMs = 45000): Promise<any> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error(`${this.spec.label} is not connected`));
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.spec.label} ${method} timed out`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  bindSession(
    sessionId: string,
    onUpdate: (params: Record<string, any>) => void,
    onPermission: (params: Record<string, any>) => {
      outcome: string;
      optionId?: string;
    },
  ) {
    this.sessionListeners.set(sessionId, onUpdate);
    this.permissionHandlers.set(sessionId, onPermission);
    return () => {
      this.sessionListeners.delete(sessionId);
      this.permissionHandlers.delete(sessionId);
    };
  }

  fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.ready = undefined;
  }

  close() {
    this.fail(new Error(`${this.spec.label} connection closed.`));
    try {
      this.child?.kill("SIGTERM");
    } catch {}
    this.child = undefined;
  }
}

type CachedCatalog = {
  fetchedAt: number;
  models: AgentModel[];
  effortConfigId?: string;
  status: AcpProviderStatus;
};

export class AcpRuntimePool {
  private connections = new Map<AcpProviderId, AcpAdapterConnection>();
  private catalogs = new Map<AcpProviderId, CachedCatalog>();
  readonly broker = new AcpToolBroker();

  constructor(
    private readonly workspaceDir = path.join(
      process.cwd(),
      ".local",
      "agent-workspace",
    ),
    private readonly resolveSpec: (
      id: AcpProviderId,
    ) => AcpAdapterSpec | null = resolveAcpAdapterSpec,
  ) {}

  private getConnection(provider: AcpProviderId): AcpAdapterConnection {
    let conn = this.connections.get(provider);
    if (!conn) {
      const spec = this.resolveSpec(provider);
      if (!spec) {
        throw new Error(
          `ACP provider ${provider} is not installed on this machine.`,
        );
      }
      conn = new AcpAdapterConnection(spec, this.workspaceDir);
      this.connections.set(provider, conn);
    }
    return conn;
  }

  private checkClaudeCliAuth(): { signedIn: boolean; plan: string | null } {
    const claudeBin = findOutsideNodeModules(
      "claude",
      process.env.DUO_CLAUDE_BIN,
    );
    if (!claudeBin) {
      return {
        signedIn: Boolean(process.env.ANTHROPIC_API_KEY),
        plan: process.env.ANTHROPIC_API_KEY ? "api-key" : null,
      };
    }
    const res = spawnSync(
      /* turbopackIgnore: true */ claudeBin,
      ["auth", "status"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    if (res.status === 0) {
      try {
        const parsed = JSON.parse(res.stdout);
        return {
          signedIn: Boolean(parsed.loggedIn),
          plan: parsed.planTier || parsed.subscriptionType || null,
        };
      } catch {}
    }
    return { signedIn: false, plan: null };
  }

  async inspectProvider(
    provider: AcpProviderId,
    force = false,
  ): Promise<CachedCatalog | null> {
    const cached = this.catalogs.get(provider);
    if (!force && cached && Date.now() - cached.fetchedAt < 60_000) {
      return cached;
    }
    const spec = this.resolveSpec(provider);
    if (!spec) return null;
    try {
      const conn = this.getConnection(provider);
      await conn.connect();
      const session = await conn.request(
        "session/new",
        { cwd: this.workspaceDir, mcpServers: [] },
        20000,
      );
      if (session?.sessionId && conn.initResult?.agentCapabilities?.sessionCapabilities?.close) {
        void conn
          .request("session/close", { sessionId: session.sessionId }, 5000)
          .catch(() => {});
      }
      const configs: any[] = Array.isArray(session?.configOptions)
        ? session.configOptions
        : [];
      const modelOption =
        configs.find((c) => c.category === "model" || c.id === "model") ??
        undefined;
      const thoughtOption =
        configs.find(
          (c) =>
            c.category === "thought_level" ||
            ["effort", "thought_level", "reasoning_effort"].includes(c.id),
        ) ?? undefined;
      const baseEfforts: string[] = Array.isArray(thoughtOption?.options)
        ? thoughtOption.options
            .map((o: any) => String(o.value))
            .filter((v: string) => v && v !== "default")
        : ["low", "medium", "high"];
      const normalizedEfforts = baseEfforts.length ? baseEfforts : ["low"];
      const availIds = new Set<string>(
        (session?.models?.availableModels ?? []).map((m: any) =>
          String(m.modelId),
        ),
      );
      const rawModels: Array<{ value: string; name: string }> = Array.isArray(
        modelOption?.options,
      )
        ? modelOption.options
            .filter((o: any) => o?.value && o.value !== "default")
            .map((o: any) => ({
              value: String(o.value),
              name: String(o.name || o.value),
            }))
        : [];
      const models: AgentModel[] = rawModels.map((m) => {
        // Check if availableModels restricts specific effort variants on agy-acp.
        const specificEfforts =
          availIds.size > 0
            ? normalizedEfforts.filter(
                (e) =>
                  availIds.has(`${m.value}-${e}`) ||
                  availIds.has(`${m.value}[${e}]`),
              )
            : [];
        const efforts =
          specificEfforts.length > 0
            ? specificEfforts
            : availIds.has(m.value) && /-medium$/.test(m.value)
              ? ["medium"]
              : normalizedEfforts;
        return {
          model: `${provider}/${m.value}`,
          name: `${spec.shortPrefix} · ${m.name}`,
          efforts,
          provider,
          providerLabel: spec.label,
        };
      });

      let signedIn = models.length > 0;
      let plan: string | null = null;
      if (provider === "claude-acp") {
        const auth = this.checkClaudeCliAuth();
        signedIn = auth.signedIn;
        plan = auth.plan;
      } else if (provider === "agy-acp") {
        plan = session?._meta?.antigravity?.tier?.name ?? null;
        signedIn = Boolean(plan || models.length > 0);
      } else if (provider === "codex-acp") {
        plan = "ChatGPT";
      }
      const entry: CachedCatalog = {
        fetchedAt: Date.now(),
        models,
        effortConfigId: thoughtOption?.id,
        status: {
          id: provider,
          name: spec.shortPrefix,
          transport: spec.label,
          signedIn,
          plan,
          detail: signedIn
            ? `${spec.label}${plan ? ` · ${plan}` : ""} (${models.length} models)`
            : `Sign in via local ${provider === "claude-acp" ? "claude login" : provider === "agy-acp" ? "agy acp --login" : "codex login"}`,
          modelCount: models.length,
        },
      };
      this.catalogs.set(provider, entry);
      return entry;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const entry: CachedCatalog = {
        fetchedAt: Date.now(),
        models: [],
        status: {
          id: provider,
          name: spec.shortPrefix,
          transport: spec.label,
          signedIn: false,
          plan: null,
          detail: msg,
          modelCount: 0,
        },
      };
      this.catalogs.set(provider, entry);
      return entry;
    }
  }

  async listModels(
    providers: AcpProviderId[] = ["claude-acp", "agy-acp", "codex-acp"],
  ): Promise<AgentModel[]> {
    const catalogs = await Promise.all(
      providers.map((p) => this.inspectProvider(p)),
    );
    return catalogs.flatMap((c) => c?.models ?? []);
  }

  async statuses(
    providers: AcpProviderId[] = ["claude-acp", "agy-acp"],
  ): Promise<AcpProviderStatus[]> {
    const catalogs = await Promise.all(
      providers.map((p) => this.inspectProvider(p)),
    );
    return catalogs.filter((c): c is CachedCatalog => c !== null).map((c) => c.status);
  }

  async openSession(options: {
    modelId: string;
    effort: string;
    baseInstructions: string;
    outputSchema: unknown;
    dynamicTools: DynamicToolSpec[];
    handleTool: (
      name: string,
      args: unknown,
    ) => Promise<{ ok: boolean; data: unknown }>;
    searchDomains?: string[];
    trace?: AgentTrace;
  }): Promise<{
    sessionId: string;
    resolvedModel: string;
    promptTurn: (
      payload: unknown,
      turnOpts: {
        timeoutMs: number;
        onPreemptRegister?: (cancel: () => void) => void;
        onPreemptCleanup?: () => void;
      },
    ) => Promise<{ value: any; searched: boolean }>;
    dispose: () => void;
  }> {
    const parsed = parseAcpModelId(options.modelId);
    if (!parsed) throw new Error(`Not an ACP model identifier: ${options.modelId}`);
    const { provider, rawModel } = parsed;
    const catalog = await this.inspectProvider(provider);
    if (!catalog?.status.signedIn) {
      throw new Error(
        catalog?.status.detail ||
          `${provider} is not signed in. Check Connections first.`,
      );
    }
    const conn = this.getConnection(provider);
    const init = await conn.connect();

    let toolRegistration: { token: string; unregister: () => void } | undefined;
    let mcpServers: any[] = [];
    if (options.dynamicTools.length > 0) {
      const socketPath = await this.broker.ensureStarted();
      toolRegistration = this.broker.register({
        definitions: options.dynamicTools,
        trace: options.trace,
        handle: options.handleTool,
      });
      mcpServers = [
        {
          name: "duoleetcode",
          command: process.execPath,
          args: [
            path.resolve(process.cwd(), "tools/acp-mcp-bridge.mjs"),
            socketPath,
            toolRegistration.token,
          ],
          env: [],
        },
      ];
    }

    const structuredInstruction = `${options.baseInstructions}\n\nCRITICAL OUTPUT CONTRACT:\nReturn ONLY a single raw JSON object conforming strictly to the following JSON Schema. Do NOT wrap the JSON in Markdown code fences (\`\`\`json) and do NOT output any text before or after the JSON object.\nJSON Schema:\n${JSON.stringify(options.outputSchema)}`;

    const supportsClientSystemPrompt = Boolean(
      init?.agentCapabilities?.sessionCapabilities?.systemPrompt,
    );
    const supportsAgyAppend = Boolean(
      init?.agentCapabilities?._meta?.antigravity?.systemPrompt?.append,
    );

    const newSessionParams: Record<string, any> = {
      cwd: this.workspaceDir,
      mcpServers,
      ...(supportsClientSystemPrompt
        ? {
            systemPrompt: {
              mode: "override",
              content: [{ type: "text", text: structuredInstruction }],
            },
          }
        : {}),
      _meta: {
        ...(supportsAgyAppend
          ? {
              antigravity: {
                systemPrompt: { append: structuredInstruction },
              },
            }
          : {}),
        ...(provider === "claude-acp"
          ? {
              claudeCode: {
                options: {
                  settingSources: [],
                  tools: [
                    ...(options.dynamicTools.length
                      ? ["ToolSearch", "WaitForMcpServers"]
                      : []),
                    ...(options.searchDomains ? ["WebSearch"] : []),
                  ],
                  allowedTools: [
                    ...(options.dynamicTools.length
                      ? ["ToolSearch", "WaitForMcpServers"]
                      : []),
                    ...(options.searchDomains ? ["WebSearch"] : []),
                    ...options.dynamicTools.map(
                      (t) => `mcp__duoleetcode__${t.name}`,
                    ),
                  ],
                  settings: {
                    permissions: {
                      allow: [
                        ...(options.dynamicTools.length
                          ? ["ToolSearch", "WaitForMcpServers"]
                          : []),
                        ...(options.searchDomains ? ["WebSearch"] : []),
                        ...options.dynamicTools.map(
                          (t) => `mcp__duoleetcode__${t.name}`,
                        ),
                      ],
                    },
                  },
                },
              },
            }
          : {}),
      },
    };

    const created = await conn.request("session/new", newSessionParams, 30000);
    const sessionId = String(created.sessionId);

    const sessionConfigs: any[] = Array.isArray(created?.configOptions)
      ? created.configOptions
      : [];
    const modelCfg = sessionConfigs.find(
      (c) => c.category === "model" || c.id === "model",
    );
    if (modelCfg) {
      await conn.request(
        "session/set_config_option",
        { sessionId, configId: modelCfg.id, value: rawModel },
        15000,
      );
    } else {
      await conn
        .request("session/set_model", { sessionId, modelId: rawModel }, 15000)
        .catch(() => {});
    }

    const effortCfgId =
      sessionConfigs.find(
        (c) =>
          c.category === "thought_level" ||
          ["effort", "thought_level", "reasoning_effort"].includes(c.id),
      )?.id ?? catalog.effortConfigId;
    if (effortCfgId && options.effort) {
      await conn
        .request(
          "session/set_config_option",
          { sessionId, configId: effortCfgId, value: options.effort },
          15000,
        )
        .catch(() => {});
    }

    if (provider === "codex-acp") {
      const modeCfg = sessionConfigs.find((c) => c.id === "mode");
      if (modeCfg) {
        await conn
          .request(
            "session/set_config_option",
            { sessionId, configId: "mode", value: "read-only" },
            10000,
          )
          .catch(() => {});
      }
    }

    const allowedNames = new Set(options.dynamicTools.map((t) => t.name));
    let activeTurn:
      | {
          ordinal: number;
          turn: AcpTurnState;
          onDone?: () => void;
          searched: boolean;
        }
      | undefined;

    const unbind = conn.bindSession(
      sessionId,
      (params) => {
        const update = params?.update;
        if (!update || !activeTurn) return;
        const { ordinal, turn } = activeTurn;
        applyAcpTurnUpdate(turn, update);
        const kind = update.sessionUpdate;
        if (kind === "agent_message_chunk" && update.content?.text) {
          options.trace?.event("message.delta", {
            ordinal,
            turnId: sessionId,
            text: update.content.text,
          });
        } else if (kind === "agent_thought_chunk" && update.content?.text) {
          options.trace?.event("reasoning.summary.delta", {
            turnId: sessionId,
            itemId: `thought-${ordinal}`,
            summaryIndex: 0,
            delta: update.content.text,
          });
        } else if (kind === "tool_call" || kind === "tool_call_update") {
          const toolLabel = String(update.name || update.title || "");
          if (
            update.kind === "search" ||
            update.kind === "fetch" ||
            /web_?search|search_web|google_search/i.test(toolLabel)
          ) {
            activeTurn.searched = true;
            if (kind === "tool_call") {
              options.trace?.event("search.started", {
                turnId: sessionId,
                item: update,
              });
            } else if (update.status === "completed") {
              options.trace?.event("search.completed", {
                turnId: sessionId,
                item: update,
              });
            }
          }
        } else if (kind === "usage_update") {
          const usage = update.usage ?? update;
          options.trace?.event("usage.updated", {
            turnId: sessionId,
            tokenUsage: usage,
          });
          options.trace?.update({ usage });
        }
      },
      (permParams) =>
        choosePermissionOption(
          permParams,
          allowedNames,
          Boolean(options.searchDomains),
        ),
    );

    let turnCounter = 0;
    const executeSinglePrompt = async (
      promptText: string,
      timeoutMs: number,
      onPreemptRegister?: (cancel: () => void) => void,
      onPreemptCleanup?: () => void,
    ) => {
      const ordinal = ++turnCounter;
      const turn = createAcpTurn(promptText);
      const state = { ordinal, turn, searched: false };
      activeTurn = state;
      options.trace?.event("turn.started", { ordinal, turnId: sessionId });

      return new Promise<{ text: string; searched: boolean }>(
        (resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            clearTimeout(timer);
            onPreemptCleanup?.();
            if (activeTurn === state) activeTurn = undefined;
          };
          onPreemptRegister?.(() => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.notify("session/cancel", { sessionId });
            finishAcpTurn(turn, "cancelled");
            const partial = turn.entries
              .filter((e) => e.type === "message")
              .map((e) => e.text ?? "")
              .join("");
            options.trace?.event("turn.interrupted", {
              ordinal,
              turnId: sessionId,
              reason: "preempted",
              partialOutput: partial,
            });
            reject(
              Object.assign(new Error("Background analysis preempted."), {
                traceStatus: "interrupted",
              }),
            );
          });
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            conn.notify("session/cancel", { sessionId });
            finishAcpTurn(turn, "error", "Timed out");
            const partial = turn.entries
              .filter((e) => e.type === "message")
              .map((e) => e.text ?? "")
              .join("");
            options.trace?.event("turn.timeout", {
              ordinal,
              turnId: sessionId,
              partialOutput: partial,
            });
            reject(
              new Error(
                "Coaching took too long. Your attempt is saved; you can retry.",
              ),
            );
          }, timeoutMs);
          timer.unref?.();

          conn
            .request(
              "session/prompt",
              {
                sessionId,
                prompt: [{ type: "text", text: promptText }],
              },
              timeoutMs + 5000,
            )
            .then((res) => {
              if (settled) return;
              settled = true;
              cleanup();
              const stopReason = String(res?.stopReason ?? "end_turn");
              finishAcpTurn(turn, stopReason);
              if (res?.usage) {
                options.trace?.event("usage.updated", {
                  turnId: sessionId,
                  tokenUsage: res.usage,
                });
                options.trace?.update({ usage: res.usage });
              }
              const thoughts = turn.entries
                .filter((e) => e.type === "reasoning" && e.text)
                .map((e) => e.text!);
              if (thoughts.length) {
                options.trace?.event("reasoning.summary.completed", {
                  turnId: sessionId,
                  itemId: `thought-${ordinal}`,
                  summary: thoughts,
                });
              }
              const text = turn.entries
                .filter((e) => e.type === "message")
                .map((e) => e.text ?? "")
                .join("");
              options.trace?.event("message.completed", {
                ordinal,
                turnId: sessionId,
                text,
              });
              options.trace?.event("turn.completed", {
                ordinal,
                turn: { id: sessionId, status: turn.status, stopReason },
                output: text,
              });
              if (stopReason !== "end_turn") {
                reject(
                  Object.assign(
                    new Error(`ACP turn stopped (${stopReason}).`),
                    {
                      traceStatus:
                        stopReason === "cancelled" ? "interrupted" : "failed",
                    },
                  ),
                );
                return;
              }
              resolve({ text, searched: state.searched });
            })
            .catch((err: unknown) => {
              if (settled) return;
              settled = true;
              cleanup();
              finishAcpTurn(
                turn,
                "error",
                err instanceof Error ? err.message : String(err),
              );
              reject(err);
            });
        },
      );
    };

    const promptTurn = async (
      payload: unknown,
      turnOpts: {
        timeoutMs: number;
        onPreemptRegister?: (cancel: () => void) => void;
        onPreemptCleanup?: () => void;
      },
    ) => {
      const promptBody =
        !supportsClientSystemPrompt && !supportsAgyAppend
          ? `${structuredInstruction}\n\nINPUT:\n${JSON.stringify(payload)}`
          : JSON.stringify(payload);
      options.trace?.event("turn.input", {
        ordinal: turnCounter + 1,
        payload,
        effort: options.effort,
        transport: "acp",
        provider,
        outputSchema: options.outputSchema,
      });
      const first = await executeSinglePrompt(
        promptBody,
        turnOpts.timeoutMs,
        turnOpts.onPreemptRegister,
        turnOpts.onPreemptCleanup,
      );
      try {
        return {
          value: extractStructuredJson(first.text),
          searched: first.searched,
        };
      } catch {
        options.trace?.event("validation.failed", {
          stage: "json-initial",
          output: first.text,
        });
        const repaired = await executeSinglePrompt(
          "Your previous message could not be parsed as JSON. Output ONLY the valid JSON object matching the required JSON Schema, with no Markdown fences or extra prose.",
          Math.min(turnOpts.timeoutMs, 60000),
          turnOpts.onPreemptRegister,
          turnOpts.onPreemptCleanup,
        );
        try {
          return {
            value: extractStructuredJson(repaired.text),
            searched: first.searched || repaired.searched,
          };
        } catch {
          options.trace?.event("validation.failed", {
            stage: "json",
            output: repaired.text,
          });
          throw new Error(
            "The coach returned an unreadable response. Your attempt is saved.",
          );
        }
      }
    };

    const dispose = () => {
      unbind();
      toolRegistration?.unregister();
      if (init?.agentCapabilities?.sessionCapabilities?.close) {
        void conn
          .request("session/close", { sessionId }, 5000)
          .catch(() => {});
      }
    };

    return {
      sessionId,
      resolvedModel: options.modelId,
      promptTurn,
      dispose,
    };
  }

  close() {
    for (const c of this.connections.values()) c.close();
    this.connections.clear();
    this.catalogs.clear();
    this.broker.close();
  }
}
