export type MemoryScope = "all" | "reflection" | "coaching" | "planning";
export type MemorySource = {
  label: string;
  quote: string;
  attemptId?: string;
  messageId?: string;
  url?: string;
};
export type CoachingMemory = {
  id: string;
  revision: number;
  text: string;
  scope: MemoryScope;
  status: "active" | "proposed";
  origin: "user" | "project-preference" | "coach-suggestion";
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
};
export type SkillEvidence = {
  id: string;
  skillId: string;
  skill: string;
  kind: "assessment" | "first-response" | "imported-note";
  observation: string;
  outcome: string;
  support: string;
  at: number;
  current: boolean;
  source: {
    label: string;
    attemptId?: string;
    messageId?: string;
    evaluationRevision?: number;
    approachId?: string;
    revisitId?: string;
    events?: number[];
    quotes?: { messageId: string; quote: string }[];
    url?: string;
    policyVersion?: string;
    model?: string;
  };
  correction?: {
    revision: number;
    text: string;
    excluded: boolean;
    at: number;
  };
};
export type MemoryUse = {
  id: string;
  at: number;
  role: string;
  attemptId?: string;
  prescription?: import("./prescription-types").Prescription;
  preferences: { id: string; revision: number; text?: string }[];
  evidenceIds: string[];
};
