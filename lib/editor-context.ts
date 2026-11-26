import { z } from "zod";
import type { Attempt, EditorChatContext } from "./types";
import { replay } from "./recording";
import { languageConfig } from "./languages";

const coordinate = z.number().int().positive();
export const editorContextSchema = z.object({
  file: z.enum(["Solution.java", "solution.cpp"]),
  source: z.enum(["recording", "coached"]),
  seq: z.number().int().nonnegative().optional(),
  cursor: z.object({
    line: coordinate,
    column: coordinate,
    lineText: z.string().max(12000),
  }),
  selection: z
    .object({
      startLine: coordinate,
      startColumn: coordinate,
      endLine: coordinate,
      endColumn: coordinate,
      text: z.string().min(1).max(12000),
    })
    .optional(),
});
// Normalize and verify against the saved snapshot, never the latest editor text.
// Positions use Monaco's one-based UTF-16 coordinates; end positions are exclusive.
export function validateEditorContext(
  a: Attempt,
  input: unknown,
  expectedSeq?: number,
): EditorChatContext | undefined {
  if (input === undefined) return;
  const context = editorContextSchema.parse(input);
  const expectedFile = languageConfig(a.language).filename;
  if (context.file !== expectedFile)
    throw new Error(`Editor context file must be ${expectedFile}.`);
  let source: string;
  if (context.source === "recording") {
    if (
      context.seq === undefined ||
      (context.seq !== 0 && !a.events.some((e) => e.seq === context.seq)) ||
      (expectedSeq !== undefined && context.seq !== expectedSeq)
    )
      throw new Error(
        "Editor context must refer to its saved recording snapshot.",
      );
    source = replay(a, context.seq);
  } else {
    if (
      expectedSeq !== undefined ||
      context.seq !== undefined ||
      a.followup?.coachedCode === undefined
    )
      throw new Error(
        "Save the coached workspace before attaching its context.",
      );
    source = a.followup.coachedCode;
  }
  const lines = source.split(/\r\n|\r|\n/);
  const offset = (line: number, column: number) => {
    if (!lines[line - 1] || column > lines[line - 1].length + 1) {
      // An empty line still has one valid cursor position.
      if (lines[line - 1] !== "" || column !== 1)
        throw new Error("The editor position is outside the saved code.");
    }
    let at = 0;
    const endings = source.match(/\r\n|\r|\n/g) ?? [];
    for (let i = 0; i < line - 1; i++)
      at += lines[i].length + endings[i].length;
    return at + column - 1;
  };
  offset(context.cursor.line, context.cursor.column);
  if (lines[context.cursor.line - 1] !== context.cursor.lineText)
    throw new Error("The cursor line no longer matches its saved code.");
  if (context.selection) {
    const s = context.selection;
    const start = offset(s.startLine, s.startColumn),
      end = offset(s.endLine, s.endColumn);
    if (end <= start || source.slice(start, end) !== s.text)
      throw new Error(
        "Selected code does not match its saved snapshot. Select the lines again.",
      );
  }
  return context;
}
export function sameEditorContext(
  a?: EditorChatContext,
  b?: EditorChatContext,
) {
  return JSON.stringify(a) === JSON.stringify(b);
}
