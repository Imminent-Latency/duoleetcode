import type * as Monaco from "monaco-editor";
import { SpellingClient } from "@/lib/spelling-client";
import type { SpellingWord } from "@/lib/spelling";

export function installSpelling(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
) {
  const client = new SpellingClient();
  const ignored = new Set<string>();
  const owner = "spelling";
  const ignoreCommand = `duo.spelling.ignore.${editor.getId()}`;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    const model = editor.getModel();
    if (!model || editor.getOption(monaco.editor.EditorOption.readOnly)) return;
    const version = model.getVersionId();
    monaco.editor.setModelMarkers(model, owner, []);
    timer = setTimeout(async () => {
      try {
        const words = await client.request<SpellingWord[]>({
          method: "check",
          source: model.getValue(),
          ignored: [...ignored],
        });
        if (disposed || model.isDisposed() || model.getVersionId() !== version)
          return;
        monaco.editor.setModelMarkers(
          model,
          owner,
          words.map(({ word, offset, length }) => {
            const start = model.getPositionAt(offset),
              end = model.getPositionAt(offset + length);
            return {
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
              severity: monaco.MarkerSeverity.Info,
              source: "Spelling",
              code: "spelling",
              message: `Possible misspelling: “${word}”. Use Quick Fix for suggestions.`,
            };
          }),
        );
      } catch (error) {
        if (!disposed) console.warn("Comment spell check unavailable", error);
      }
    }, 650);
  };
  const disposables = [
    editor.onDidChangeModelContent(schedule),
    editor.onDidChangeConfiguration((event) => {
      if (event.hasChanged(monaco.editor.EditorOption.readOnly)) schedule();
    }),
    monaco.editor.registerCommand(ignoreCommand, (_accessor, word: string) => {
      ignored.add(word.toLowerCase());
      schedule();
    }),
    monaco.languages.registerCodeActionProvider("java", {
      async provideCodeActions(model, _range, context, token) {
        const empty = { actions: [], dispose() {} };
        if (
          model !== editor.getModel() ||
          editor.getOption(monaco.editor.EditorOption.readOnly)
        )
          return empty;
        const marker = context.markers.find(
          (marker) => marker.code === "spelling",
        );
        if (!marker) return empty;
        const version = model.getVersionId(),
          word = model.getValueInRange(marker);
        try {
          const suggestions = await client.request<string[]>({
            method: "suggest",
            word,
          });
          if (
            disposed ||
            token.isCancellationRequested ||
            model.isDisposed() ||
            model.getVersionId() !== version
          )
            return empty;
          const actions: Monaco.languages.CodeAction[] = suggestions.map(
            (text) => ({
              title: `Change to “${text}”`,
              kind: "quickfix",
              diagnostics: [marker],
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: version,
                    textEdit: { range: marker, text },
                  },
                ],
              },
            }),
          );
          actions.push({
            title: `Ignore “${word}” for this editor session`,
            kind: "quickfix",
            diagnostics: [marker],
            command: {
              id: ignoreCommand,
              title: "Ignore spelling",
              arguments: [word],
            },
          });
          return { actions, dispose() {} };
        } catch {
          return empty;
        }
      },
    }),
  ];
  schedule();
  return {
    dispose() {
      disposed = true;
      clearTimeout(timer);
      client.dispose();
      for (const item of disposables) item.dispose();
      const model = editor.getModel();
      if (model && !model.isDisposed())
        monaco.editor.setModelMarkers(model, owner, []);
    },
  };
}
