export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  kind: "official-docs" | "official-source" | "secondary";
  version: string;
  retrievedAt: number;
  excerpt: string;
  digest: string;
};
export type TechnicalClaim = {
  claim: string;
  basis: "documented" | "implementation-derived" | "unverified";
  sourceIds: string[];
  use: "explanation" | "assessment";
};
export type JavaSymbolEvidence = {
  document: "recording" | "coached";
  seq: number | null;
  line: number;
  column: number;
  sourceHash: string;
  javaProfile: number;
  hover: unknown;
  signatures: unknown;
  definition: unknown;
};
export type ResearchBundle = {
  traceId?: string;
  audit?: { passes: number; revised: boolean };
  sources: ResearchSource[];
  claims: TechnicalClaim[];
  symbols: JavaSymbolEvidence[];
  lookups: { tool: string; target: string; ok: boolean; reason?: string }[];
  runtime: { editorJava: number; executionJava: number | null };
};
