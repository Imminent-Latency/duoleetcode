import { z } from "zod";

export type LanguageId = "java" | "cpp";
export const DEFAULT_LANGUAGE: LanguageId = "java";
export const languageIdSchema = z.enum(["java", "cpp"]);
export const PREFERRED_LANGUAGE_KEY = "duo-preferred-language";

export type LanguageConfig = {
  id: LanguageId;
  label: string;
  shortLabel: string;
  badge: string;
  profileLabel: string;
  leetcodeSlug: "java" | "cpp";
  monacoLanguage: "java" | "cpp";
  filename: "Solution.java" | "solution.cpp";
  fence: "java" | "cpp";
  helpLabel: string;
  examplePrompt: string;
  outsideHelpExample: string;
};

export const LANGUAGE_CONFIGS: Record<LanguageId, LanguageConfig> = {
  java: {
    id: "java",
    label: "Java 25",
    shortLabel: "Java",
    badge: "JAVA 25",
    profileLabel: "Java 25",
    leetcodeSlug: "java",
    monacoLanguage: "java",
    filename: "Solution.java",
    fence: "java",
    helpLabel: "Java help",
    examplePrompt: "What does HashSet.add return?",
    outsideHelpExample: "e.g. Looked up HashMap.put syntax",
  },
  cpp: {
    id: "cpp",
    label: "C++26",
    shortLabel: "C++26",
    badge: "C++26",
    profileLabel: "C++26",
    leetcodeSlug: "cpp",
    monacoLanguage: "cpp",
    filename: "solution.cpp",
    fence: "cpp",
    helpLabel: "C++ help",
    examplePrompt: "What does std::unordered_map::emplace return?",
    outsideHelpExample: "e.g. Looked up std::ranges::sort signature",
  },
};

export function normalizeLanguage(lang?: string | null): LanguageId {
  return lang === "cpp" ? "cpp" : "java";
}

export function attemptLanguage(
  attempt?: { language?: LanguageId | string | null } | null,
): LanguageId {
  return normalizeLanguage(attempt?.language);
}

export function languageConfig(lang?: LanguageId | string | null): LanguageConfig {
  return LANGUAGE_CONFIGS[normalizeLanguage(lang)];
}

export function starterForLanguage(
  problem: { javaStarter?: string | null; cppStarter?: string | null },
  lang: LanguageId,
): string | null {
  const starter = lang === "cpp" ? problem.cppStarter : problem.javaStarter;
  return typeof starter === "string" && starter.trim().length > 0
    ? starter
    : null;
}

export function availableLanguages(problem: {
  javaStarter?: string | null;
  cppStarter?: string | null;
}): LanguageId[] {
  const langs: LanguageId[] = [];
  if (starterForLanguage(problem, "java")) langs.push("java");
  if (starterForLanguage(problem, "cpp")) langs.push("cpp");
  return langs;
}
