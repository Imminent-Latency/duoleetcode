import { agent } from "@/lib/agents";
import {
  agentFeatures,
  agentSettingsSchema,
  lowSettings,
  resolveAgentChoice,
  validateAgentChoice,
} from "@/lib/agent-settings";
import {
  baselineAgentModel,
  readAgentSettings,
  saveAgentSettings,
} from "@/lib/agent-settings-store";
import { failure, json, localRequest } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    return json({
      settings: readAgentSettings(),
      baseline: lowSettings(baselineAgentModel()),
      models: await agent().models(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    const settings = agentSettingsSchema.parse(await req.json());
    const models = await agent().models();
    for (const feature of agentFeatures)
      validateAgentChoice(
        resolveAgentChoice(settings, feature.role, baselineAgentModel()),
        models,
      );
    localRequest(req);
    return json({ settings: saveAgentSettings(settings) });
  } catch (e) {
    return failure(e);
  }
}
