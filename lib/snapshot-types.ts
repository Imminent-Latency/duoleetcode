import type { Attempt } from "./types";
import type { AgentSettings } from "./agent-settings";
import type { CoachingMemory } from "./learner-memory-types";

export type MemoryImage = {
  version: number;
  preferences: CoachingMemory[];
  preferenceRevisions: { id: string; revision: number; data: string }[];
  forgotten: { id: string }[];
  evidence: {
    id: string;
    attempt_id: string | null;
    skill_id: string;
    current: number;
    at: number;
    data: string;
  }[];
  corrections: { id: string; revision: number; data: string }[];
  uses: { id: string; at: number; data: string }[];
  suppressed: { id: string }[];
};
export type LibraryImage = {
  attempts: Attempt[];
  importedEvidence: Record<string, any>[];
  memory: MemoryImage;
};
export type SnapshotData = {
  format: "duoleetcode-snapshot";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  practice: LibraryImage;
  sandbox: LibraryImage;
  settings: AgentSettings | null;
  browser: Record<string, string>;
  pagesPreview: Record<string, unknown> | null;
};
export type SnapshotArchive = SnapshotData & { sha256: string };
export type LibrarySelection = {
  attempts: string[];
  coaching: boolean;
  preferences: boolean;
  evidence: string[];
  imported: string[];
  receipts: boolean;
};
export type DataSelection = {
  practice: LibrarySelection;
  sandbox: LibrarySelection;
  settings: boolean;
  browser: boolean;
  pagesPreview: boolean;
};
export type DataOperation = {
  action: "restore" | "reset";
  selection: DataSelection;
  attemptMode: "whole" | "coaching";
  conflicts: "keep" | "replace";
};
export type SnapshotSummary = {
  id: string;
  name: string;
  createdAt: string;
  practice: number;
  sandbox: number;
  bytes: number;
};
export const emptyLibrarySelection = (): LibrarySelection => ({
  attempts: [],
  coaching: true,
  preferences: false,
  evidence: [],
  imported: [],
  receipts: false,
});
export const emptySelection = (): DataSelection => ({
  practice: emptyLibrarySelection(),
  sandbox: emptyLibrarySelection(),
  settings: false,
  browser: false,
  pagesPreview: false,
});
export function selectEverything(s: SnapshotData): DataSelection {
  const select = (l: LibraryImage): LibrarySelection => ({
    attempts: l.attempts.map((a) => a.id),
    coaching: true,
    preferences: true,
    evidence: l.memory.evidence.map((e) => e.id),
    imported: l.importedEvidence.map((e) => e.id),
    receipts: true,
  });
  return {
    practice: select(s.practice),
    sandbox: select(s.sandbox),
    settings: !!s.settings,
    browser: Object.keys(s.browser).length > 0,
    pagesPreview: !!s.pagesPreview,
  };
}
export const browserPreferenceKeys = [
  "duo-java-help-width",
  "duo-problem-width",
  "duo-editor-height-page",
  "duo-reflection-split",
  "duo-reflection-follow",
];
export const isBrowserDataKey = (key: string) =>
  browserPreferenceKeys.includes(key) ||
  key.startsWith("duo-reflection-intake-");
