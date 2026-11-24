"use client";
import { useEffect, useState } from "react";
import type { EditorContextDraft, EditorSelection } from "@/lib/types";
export function useEditorChat(source: string) {
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
    setAttached(undefined);
  }, [source]);
  const onChange = (context: EditorContextDraft) =>
    setObserved({ source, context });
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
    return { file: "Solution.java", cursor, selection };
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
