"use client";
import { useEffect, useState } from "react";
import type { EditorContextDraft, EditorSelection } from "@/lib/types";
import { languageConfig, type LanguageId } from "@/lib/languages";
function sameSelection(a?: EditorSelection, b?: EditorSelection): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.startLine === b.startLine &&
      a.startColumn === b.startColumn &&
      a.endLine === b.endLine &&
      a.endColumn === b.endColumn &&
      a.text === b.text)
  );
}
function sameContext(
  a?: EditorContextDraft,
  b?: EditorContextDraft,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.file === b.file &&
      a.cursor.line === b.cursor.line &&
      a.cursor.column === b.cursor.column &&
      a.cursor.lineText === b.cursor.lineText &&
      sameSelection(a.selection, b.selection))
  );
}
export function useEditorChat(source: string, language: LanguageId = "java") {
  const [observed, setObserved] = useState<{
    source: string;
    context: EditorContextDraft;
  }>();
  const [attached, setAttached] = useState<{
    source: string;
    selection: EditorSelection;
  }>();
  const [focusRequest, setFocusRequest] = useState(0);
  const current = observed?.source === source ? observed.context : undefined;
  const selection =
    attached?.source === source ? attached.selection : undefined;
  useEffect(() => {
    if (attached && attached.source !== source) setAttached(undefined);
  }, [attached, source]);
  const onChange = (context: EditorContextDraft, contextSource = source) =>
    setObserved((prev) =>
      prev &&
      prev.source === contextSource &&
      sameContext(prev.context, context)
        ? prev
        : { source: contextSource, context },
    );
  const attach = (context = current) =>
    setAttached(
      context?.selection ? { source, selection: context.selection } : undefined,
    );
  const requestHelp = (context: EditorContextDraft) => {
    onChange(context);
    attach(context);
    setFocusRequest((n) => n + 1);
  };
  const context = (): EditorContextDraft => {
    const cursor = current?.cursor ?? {
      line: 1,
      column: 1,
      lineText: source.split(/\r\n|\r|\n/, 1)[0],
    };
    if ((selection?.text.length ?? 0) > 12000 || cursor.lineText.length > 12000)
      throw new Error(
        "Select fewer lines (up to 12,000 characters) before sending.",
      );
    return { file: languageConfig(language).filename, cursor, selection };
  };
  return {
    current,
    selection,
    onChange,
    attach,
    clear: () => setAttached(undefined),
    requestHelp,
    focusRequest,
    context,
  };
}
export type EditorChatBinding = ReturnType<typeof useEditorChat>;
