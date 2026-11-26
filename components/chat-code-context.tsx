"use client";
import { Button } from "./ui";
import type {
  EditorChatContext,
  EditorContextDraft,
  EditorSelection,
} from "@/lib/types";

const lines = (s: EditorSelection) =>
  s.startLine === s.endLine
    ? `Line ${s.startLine}`
    : `Lines ${s.startLine}–${s.endLine}`;
export function SavedCodeContext({ context }: { context?: EditorChatContext }) {
  if (!context) return null;
  return (
    <details className="chat-code-context saved">
      <summary>
        {context.file} · L{context.cursor.line}:C{context.cursor.column}
        {context.selection
          ? ` · ${lines(context.selection)}`
          : " · Cursor line"}
        {context.source === "coached"
          ? " · Coached code"
          : ` · Snapshot ${context.seq}`}
      </summary>
      <pre>
        <code>{context.selection?.text ?? context.cursor.lineText}</code>
      </pre>
    </details>
  );
}
export function ChatCodeContext({
  current,
  selection,
  onAttach,
  onRemove,
}: {
  current?: EditorContextDraft;
  selection?: EditorSelection;
  onAttach: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="chat-code-context">
      <div className="chat-code-context-actions">
        <small>
          {current
            ? `Cursor L${current.cursor.line}:C${current.cursor.column} · line included`
            : "Place your cursor in the editor to add context"}
        </small>
        {!selection && current?.selection && (
          <Button type="button" className="text-button" onClick={onAttach}>
            Attach {lines(current.selection).toLowerCase()}
          </Button>
        )}
        {selection && (
          <Button type="button" className="text-button" onClick={onRemove}>
            Remove selection
          </Button>
        )}
      </div>
      {selection && (
        <details>
          <summary>{lines(selection)} attached</summary>
          <pre>
            <code>{selection.text.slice(0, 12000)}</code>
          </pre>
        </details>
      )}
      {selection && selection.text.length > 12000 && (
        <small role="alert" className="error-text">
          Select fewer lines (up to 12,000 characters).
        </small>
      )}
    </div>
  );
}
