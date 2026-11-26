import { z } from "zod";
import {
  DEFAULT_LANGUAGE,
  languageIdSchema,
  type LanguageId,
} from "./languages";

// Every production harness registers here and resolves the same platform preset.
// Model identifiers/effort values stay provider-neutral; adapters advertise support.
export const agentFeatures = [
  {
    id: "reference",
    role: "java reference",
    label: "Reference help",
    description: "Look up Java 25 or C++26 APIs and syntax during an assessment.",
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
export function resolveDefaultLanguage(
  settings?: { defaultLanguage?: LanguageId } | null,
): LanguageId {
  return settings?.defaultLanguage ?? DEFAULT_LANGUAGE;
}
export function normalizeDefaultLanguage(
  language?: LanguageId,
): LanguageId | undefined {
  return !language || language === DEFAULT_LANGUAGE ? undefined : language;
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
    defaultLanguage: languageIdSchema.optional(),
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

export type AgentTeamProfile = {
  id: "openai-low" | "claude-low" | "gemini-low";
  label: string;
  provider: string;
  philosophy: string;
  deepModel: AgentModel;
  fastModel: AgentModel;
  features: AgentSettings["features"];
};

function pickFirstAvailable(
  models: AgentModel[],
  candidates: string[],
): AgentModel | undefined {
  for (const id of candidates) {
    const found = models.find((m) => m.model === id);
    if (found) return found;
  }
  return undefined;
}

function lowChoiceFor(m: AgentModel): AgentChoice {
  return {
    model: m.model,
    effort: m.efforts.includes("low") ? "low" : m.efforts[0] ?? "low",
  };
}

// Role-paired Low-effort team profiles: flagship model at Low effort for
// nuanced pedagogical judgment (reflection, evaluation, coaching), paired with
// fast workhorse model at Low effort for timed Java lookups and catalog planning.
export function availableTeamProfiles(models: AgentModel[]): AgentTeamProfile[] {
  const specs: Array<{
    id: AgentTeamProfile["id"];
    label: string;
    provider: string;
    philosophy: string;
    deepCandidates: string[];
    fastCandidates: string[];
  }> = [
    {
      id: "openai-low",
      label: "OpenAI Team (Low)",
      provider: "Codex · ChatGPT",
      philosophy:
        "Astra for reflection, evaluation & coaching · Sol for reference help & next-problem planning",
      deepCandidates: ["gpt-6-astra", "gpt-6.2-astra"],
      fastCandidates: ["gpt-6.1-sol", "gpt-6.2-sol"],
    },
    {
      id: "claude-low",
      label: "Claude Team (Low)",
      provider: "Claude SDK · ACP",
      philosophy:
        "Opus 5.5 for reflection, evaluation & coaching · Sonnet 5.5 for reference help & next-problem planning",
      deepCandidates: ["claude-acp/opus", "claude-acp/fable", "claude-acp/claude-opus-5"],
      fastCandidates: ["claude-acp/sonnet", "claude-acp/haiku", "claude-acp/claude-sonnet-5"],
    },
    {
      id: "gemini-low",
      label: "Gemini Team (Low)",
      provider: "Antigravity · ACP",
      philosophy:
        "Gemini 4 Neon for reflection, evaluation & coaching · Gemini 3.8 Flash for reference help & next-problem planning",
      deepCandidates: [
        "agy-acp/gemini-4-neon",
        "agy-acp/gemini-4-carbon",
        "agy-acp/gemini-4-argon",
      ],
      fastCandidates: [
        "agy-acp/gemini-3.8-flash",
        "agy-acp/gemini-4-hydrogen",
      ],
    },
  ];

  const profiles: AgentTeamProfile[] = [];
  for (const spec of specs) {
    const deepModel = pickFirstAvailable(models, spec.deepCandidates);
    const fastModel = pickFirstAvailable(models, spec.fastCandidates);
    if (!deepModel || !fastModel) continue;
    const deep = lowChoiceFor(deepModel);
    const fast = lowChoiceFor(fastModel);
    profiles.push({
      id: spec.id,
      label: spec.label,
      provider: spec.provider,
      philosophy: spec.philosophy,
      deepModel,
      fastModel,
      features: {
        reference: { ...fast },
        reflection: { ...deep },
        evaluation: { ...deep },
        coaching: { ...deep },
        planning: { ...fast },
      },
    });
  }
  return profiles;
}
