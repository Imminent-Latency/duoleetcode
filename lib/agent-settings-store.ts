import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  agentSettingsSchema,
  lowSettings,
  normalizeBackgroundSettings,
  normalizeDefaultLanguage,
  type AgentSettings,
} from "./agent-settings";

export const baselineAgentModel = () =>
  process.env.DUO_AGENT_MODEL ?? "gpt-6.1-sol";
const settingsFile = () =>
  process.env.DUO_SETTINGS_FILE ||
  path.join(process.cwd(), ".local", "agent-settings.json");
function withNormalizedPreferences(
  base: AgentSettings,
  background?: AgentSettings["background"],
  defaultLanguage?: AgentSettings["defaultLanguage"],
): AgentSettings {
  const normalizedBg = normalizeBackgroundSettings(background);
  const normalizedLang = normalizeDefaultLanguage(defaultLanguage);
  const {
    background: _ignoredBg,
    defaultLanguage: _ignoredLang,
    ...rest
  } = base;
  return {
    ...rest,
    ...(normalizedBg ? { background: normalizedBg } : {}),
    ...(normalizedLang ? { defaultLanguage: normalizedLang } : {}),
  };
}
export function readAgentSettings(
  file = settingsFile(),
  model = baselineAgentModel(),
): AgentSettings {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    // Older saved Custom configurations gain the new feature at the Low baseline.
    if (
      raw?.version === 1 &&
      raw.features &&
      raw.features.reference === undefined
    )
      raw.features.reference = lowSettings(model).features.reference;
    const saved = agentSettingsSchema.parse(raw);
    return withNormalizedPreferences(
      saved.preset === "low" ? lowSettings(model) : saved,
      saved.background,
      saved.defaultLanguage,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return lowSettings(model);
    throw new Error(
      "Agent settings could not be read. Restore the settings file before starting an agent.",
    );
  }
}
export function saveAgentSettings(
  input: unknown,
  file = settingsFile(),
  model = baselineAgentModel(),
) {
  const parsed = agentSettingsSchema.parse(input);
  const settings = withNormalizedPreferences(
    parsed.preset === "low" ? lowSettings(model) : parsed,
    parsed.background,
    parsed.defaultLanguage,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(temporary, file);
  return settings;
}
