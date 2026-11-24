import { AgentRuntime } from "../lib/agents";
const runtime = new AgentRuntime();
try {
  console.log(await runtime.status());
  const r = await runtime.run(
    "connection check",
    "Return a short greeting confirming a practice session can begin.",
    { request: "Return ready=true and a short greeting." },
    {
      type: "object",
      properties: { ready: { type: "boolean" }, message: { type: "string" } },
      required: ["ready", "message"],
      additionalProperties: false,
    },
  );
  console.log({ model: r.model, ...r.value });
} finally {
  runtime.close();
}
