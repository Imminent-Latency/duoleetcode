import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentFeatures,
  agentSettingsSchema,
  lowSettings,
  normalizeDefaultLanguage,
  resolveAgentChoice,
  resolveDefaultLanguage,
  validateAgentChoice,
  type AgentSettings,
} from "../lib/agent-settings";
import {
  baselineAgentModel,
  readAgentSettings,
  saveAgentSettings,
} from "../lib/agent-settings-store";
import { AgentRuntime } from "../lib/agents";
import { GET, POST } from "../app/api/agent/settings/route";

test("Low is platform-wide; custom edits are per feature and cannot leak into a preset", () => {
  const s = lowSettings("baseline");
  s.features.reflection = { model: "different", effort: "high" };
  for (const f of agentFeatures)
    assert.deepEqual(resolveAgentChoice(s, f.role, "baseline"), {
      model: "baseline",
      effort: "low",
    });
  s.preset = "custom";
  assert.deepEqual(resolveAgentChoice(s, "reflection coach", "baseline"), {
    model: "different",
    effort: "high",
  });
  assert.equal(resolveAgentChoice(s, "coach", "baseline").effort, "low");
  assert.throws(() => agentSettingsSchema.parse({ ...s, preset: "thirsty" }));
  assert.throws(() =>
    agentSettingsSchema.parse({
      ...s,
      features: { reflection: s.features.reflection },
    }),
  );
  assert.throws(
    () =>
      validateAgentChoice(s.features.reflection, [
        { model: "different", name: "Different", efforts: ["low"] },
      ]),
    /does not advertise/,
  );
  assert.throws(
    () => validateAgentChoice(s.features.reflection, []),
    /catalog/,
  );
});
test("settings survive reload, normalize Low, and reject corrupt data without a hidden fallback", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duo-settings-"));
  const file = path.join(dir, "settings.json");
  try {
    assert.equal(readAgentSettings(file, "baseline").preset, "low");
    const s = lowSettings("baseline");
    s.preset = "custom";
    s.features.planning = { model: "smaller", effort: "low" };
    saveAgentSettings(s, file, "baseline");
    assert.deepEqual(readAgentSettings(file, "baseline"), s);
    const legacy = structuredClone(s) as any;
    delete legacy.features.reference;
    writeFileSync(file, JSON.stringify(legacy));
    assert.deepEqual(readAgentSettings(file, "baseline"), s);
    s.preset = "low";
    saveAgentSettings(s, file, "baseline");
    assert.deepEqual(
      readAgentSettings(file, "baseline"),
      lowSettings("baseline"),
    );
    writeFileSync(file, "broken");
    assert.throws(() => readAgentSettings(file), /could not be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("each harness sends its resolved model and effort, with settings fixed for the running turn", async () => {
  let settings: AgentSettings = lowSettings(baselineAgentModel());
  const runtime = new AgentRuntime(() => structuredClone(settings));
  runtime.connect = async () => {};
  runtime.status = async () => ({
    signedIn: true,
    plan: "test",
    model: "test",
    provider: "test",
  });
  runtime.models = async () => [
    {
      model: baselineAgentModel(),
      name: "Baseline",
      efforts: ["low", "medium"],
    },
    { model: "alternate", name: "Alternate", efforts: ["low", "high"] },
  ];
  const sent: { method: string; params: any }[] = [];
  let changeDuringTurn = false;
  runtime.rpc = async (method, params: any) => {
    sent.push({ method, params });
    if (method === "thread/start") {
      if (changeDuringTurn)
        settings.features.reflection = { model: "alternate", effort: "high" };
      return { thread: { id: "test-thread" }, model: params.model };
    }
    if (method === "turn/start") {
      queueMicrotask(() => {
        runtime.receive({
          method: "item/completed",
          params: {
            threadId: "test-thread",
            item: { type: "agentMessage", text: '{"technicalClaims":[]}' },
          },
        });
        runtime.receive({
          method: "turn/completed",
          params: { threadId: "test-thread", turn: { status: "completed" } },
        });
      });
      return { turn: { id: "test-turn" } };
    }
    return {};
  };
  for (const f of agentFeatures) {
    sent.length = 0;
    await runtime.run(f.role, "Test", {}, {});
    assert.equal(
      sent.find((r) => r.method === "thread/start")!.params.model,
      baselineAgentModel(),
    );
    assert.equal(
      sent.find((r) => r.method === "turn/start")!.params.effort,
      "low",
    );
    if (f.id === "reference") {
      const start = sent.find((r) => r.method === "thread/start")!.params;
      assert.deepEqual(
        start.dynamicTools.map((t: any) => t.name),
        [
          "read_java_reference",
          "read_java_source",
          "search_java_reference",
          "read_secondary_reference",
        ],
      );
      assert.equal(runtime.contexts.size, 0);
      assert.equal(runtime.referenceContexts.size, 0);
      assert.equal(runtime.researchContexts.size, 0);
    }
  }
  settings.preset = "custom";
  changeDuringTurn = true;
  const running = await runtime.run("reflection coach", "Test", {}, {});
  assert.equal(running.effort, "low");
  const next = await runtime.run("reflection coach", "Test", {}, {});
  assert.equal(next.model, "alternate");
  assert.equal(next.effort, "high");
  settings.features.reflection.effort = "unsupported";
  const count = sent.length;
  await assert.rejects(
    runtime.run("reflection coach", "Test", {}, {}),
    /does not advertise/,
  );
  assert.equal(sent.length, count); // Nothing sent to inference after validation fails.
});
test("settings API rejects cross-origin changes and untuned presets before writing", async () => {
  const request = (method: string, origin: string, body?: unknown) =>
    new Request("http://127.0.0.1:4318/api/agent/settings", {
      method,
      headers: {
        host: "127.0.0.1:4318",
        origin,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (await GET(request("GET", "https://elsewhere.example"))).status,
    400,
  );
  assert.equal(
    (
      await POST(
        request("POST", "https://elsewhere.example", lowSettings("test")),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        request("POST", "http://127.0.0.1:4318", {
          ...lowSettings("test"),
          preset: "optimal",
        }),
      )
    ).status,
    400,
  );
});

test("evidence audit repairs once and refuses a second unsupported reply", async () => {
  for (const rejectAgain of [false, true]) {
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
    let thread = 0;
    let audits = 0;
    let candidates = 0;
    const auditThreads = new Set<string>();
    runtime.rpc = async (method, params: any) => {
      if (method === "thread/start") {
        const id = `audit-test-${++thread}`;
        if (!params.dynamicTools.length) auditThreads.add(id);
        assert.equal(params.model, baselineAgentModel());
        return { thread: { id }, model: params.model };
      }
      if (method === "turn/start") {
        const audit = auditThreads.has(params.threadId);
        const value = audit
          ? {
              ok: ++audits > 1 && !rejectAgain,
              issues:
                audits > 1 && !rejectAgain
                  ? []
                  : [
                      {
                        kind: "unsupported-interpretation",
                        domain: "technical",
                        message: "Remove unsupported complexity assertion",
                        sequences: [],
                      },
                    ],
            }
          : {
              message:
                ++candidates === 1
                  ? "Unsupported claim"
                  : "Revised explanation",
              technicalClaims: [],
            };
        queueMicrotask(() => {
          runtime.receive({
            method: "item/completed",
            params: {
              threadId: params.threadId,
              item: { type: "agentMessage", text: JSON.stringify(value) },
            },
          });
          runtime.receive({
            method: "turn/completed",
            params: {
              threadId: params.threadId,
              turn: { status: "completed" },
            },
          });
        });
        return { turn: { id: `turn-${audits}-${candidates}` } };
      }
      return {};
    };
    const run = runtime.run("reflection coach", "Test", {}, {});
    if (rejectAgain) await assert.rejects(run, /could not verify/);
    else {
      const result = await run;
      assert.equal(result.value.message, "Revised explanation");
      assert.deepEqual(result.research?.audit, { passes: 2, revised: true });
    }
    assert.equal(candidates, 2);
    assert.equal(audits, 2);
    assert.equal(runtime.researchContexts.size, 0);
  }
});

test("defaultLanguage persists across Low and Custom presets and normalizes default Java", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "duo-lang-settings-"));
  const file = path.join(dir, "settings.json");
  try {
    const initial = readAgentSettings(file, "baseline");
    assert.equal(resolveDefaultLanguage(initial), "java");
    assert.equal(normalizeDefaultLanguage("java"), undefined);
    assert.equal(normalizeDefaultLanguage("cpp"), "cpp");
    assert.equal(initial.defaultLanguage, undefined);

    const savedCppLow = saveAgentSettings(
      { ...lowSettings("baseline"), defaultLanguage: "cpp" },
      file,
      "baseline",
    );
    assert.equal(savedCppLow.defaultLanguage, "cpp");
    assert.equal(readAgentSettings(file, "baseline").defaultLanguage, "cpp");
    assert.equal(
      resolveDefaultLanguage(readAgentSettings(file, "baseline")),
      "cpp",
    );

    const custom = lowSettings("baseline");
    custom.preset = "custom";
    custom.features.planning = { model: "smaller", effort: "low" };
    custom.defaultLanguage = "cpp";
    saveAgentSettings(custom, file, "baseline");
    assert.equal(readAgentSettings(file, "baseline").defaultLanguage, "cpp");

    saveAgentSettings(
      { ...lowSettings("baseline"), defaultLanguage: "java" },
      file,
      "baseline",
    );
    const resetJava = readAgentSettings(file, "baseline");
    assert.equal(resetJava.defaultLanguage, undefined);
    assert.equal(resolveDefaultLanguage(resetJava), "java");
    assert.deepEqual(resetJava, lowSettings("baseline"));

    assert.throws(() =>
      agentSettingsSchema.parse({
        ...lowSettings("baseline"),
        defaultLanguage: "python",
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
