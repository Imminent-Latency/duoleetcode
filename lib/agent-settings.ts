import { z } from "zod";

// Every production harness registers here and resolves the same platform preset.
// Model identifiers/effort values stay provider-neutral; adapters advertise support.
export const agentFeatures = [
  {
    id: "reference",
    role: "java reference",
    label: "Java help",
    description: "Look up Java APIs and syntax during an assessment.",
  },
  {
    id: "reflection",
    role: "reflection coach",
    label: "Reflection",
    description: "Discuss your attempt and explore the recording.",
  },
  {
    id: "evaluation",
    role: "evaluator",
    label: "Assessment feedback",
    description: "Identify supported strengths and learning opportunities.",
  },
  {
    id: "coaching",
    role: "coach",
    label: "Focused coaching",
    description: "Work through a concept in conversation.",
  },
  {
    id: "planning",
    role: "planner",
    label: "Next activity",
    description: "Choose what to practice and revisit.",
  },
] as const;
export type AgentFeature = (typeof agentFeatures)[number]["id"];
export type AgentRole =
  (typeof agentFeatures)[number]["role"] | "connection check";
export const agentPresets = [
  { value: "low", label: "Low", enabled: true },
  { value: "balanced", label: "Balanced — not tuned yet", enabled: false },
  { value: "optimal", label: "Optimal — not tuned yet", enabled: false },
  { value: "thirsty", label: "Thirsty — not tuned yet", enabled: false },
  { value: "custom", label: "Custom", enabled: true },
] as const;
export const agentChoiceSchema = z
  .object({
    model: z.string().trim().min(1).max(160),
    effort: z.string().trim().min(1).max(40),
  })
  .strict();
export type AgentChoice = z.infer<typeof agentChoiceSchema>;
export const backgroundSettingsSchema = z
  .object({
    solvingAnalysis: z.boolean(),
    preIntakeReview: z.boolean(),
  })
  .strict();
export type BackgroundSettings = z.infer<typeof backgroundSettingsSchema>;
export const defaultBackgroundSettings: BackgroundSettings = {
  solvingAnalysis: true,
  preIntakeReview: true,
};
export function resolveBackgroundSettings(
  settings?: { background?: BackgroundSettings } | null,
): BackgroundSettings {
  return {
    solvingAnalysis:
      settings?.background?.solvingAnalysis ??
      defaultBackgroundSettings.solvingAnalysis,
    preIntakeReview:
      settings?.background?.preIntakeReview ??
      defaultBackgroundSettings.preIntakeReview,
  };
}
export function normalizeBackgroundSettings(
  background?: BackgroundSettings,
): BackgroundSettings | undefined {
  if (!background) return undefined;
  return background.solvingAnalysis ===
    defaultBackgroundSettings.solvingAnalysis &&
    background.preIntakeReview === defaultBackgroundSettings.preIntakeReview
    ? undefined
    : { ...background };
}
export const agentSettingsSchema = z
  .object({
    version: z.literal(1),
    preset: z.enum(["low", "custom"]),
    features: z
      .object({
        reference: agentChoiceSchema,
        reflection: agentChoiceSchema,
        evaluation: agentChoiceSchema,
        coaching: agentChoiceSchema,
        planning: agentChoiceSchema,
      })
      .strict(),
    background: backgroundSettingsSchema.optional(),
  })
  .strict();
export type AgentSettings = z.infer<typeof agentSettingsSchema>;
export type AgentProviderId =
  | "codex"
  | "claude-acp"
  | "agy-acp"
  | "codex-acp";
export type AgentModel = {
  model: string;
  name: string;
  efforts: string[];
  provider?: AgentProviderId;
  providerLabel?: string;
};
export function lowSettings(model: string): AgentSettings {
  return {
    version: 1,
    preset: "low",
    features: {
      reference: { model, effort: "low" },
      reflection: { model, effort: "low" },
      evaluation: { model, effort: "low" },
      coaching: { model, effort: "low" },
      planning: { model, effort: "low" },
    },
  };
}
export function resolveAgentChoice(
  settings: AgentSettings,
  role: AgentRole,
  baselineModel: string,
): AgentChoice {
  const feature = agentFeatures.find((f) => f.role === role);
  // Diagnostics use the platform baseline. No implicit escalation or model fallback.
  return settings.preset === "custom" && feature
    ? { ...settings.features[feature.id] }
    : { model: baselineModel, effort: "low" };
}
export function validateAgentChoice(choice: AgentChoice, models: AgentModel[]) {
  const model = models.find((m) => m.model === choice.model);
  if (!model)
    throw new Error(
      `Model ${choice.model} is not in the current model catalog. Choose another model in Agent settings.`,
    );
  if (!model.efforts.includes(choice.effort))
    throw new Error(
      `${model.name} does not advertise ${choice.effort} effort. Choose a supported level in Agent settings.`,
    );
  return choice;
}
