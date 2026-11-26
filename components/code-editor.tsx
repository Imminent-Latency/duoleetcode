"use client";
import { Flag } from "lucide-react";
import { useReviewFlag } from "./review-flag";
import loader from "@monaco-editor/loader";
import type * as Monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { java } from "@/lib/java";
import { cpp } from "@/lib/cpp";
import { importForCompletion, importQuickFixes } from "@/lib/java-imports";
import { javaCompletions } from "@/lib/java-completions";
import type { Edit, EditorContextDraft } from "@/lib/types";
import { javaSnippets } from "@/lib/java-snippets";
import { cppSnippets, shouldOfferSnippets } from "@/lib/cpp-snippets";
import { languageConfig, type LanguageId } from "@/lib/languages";
import { installSpelling } from "./editor-spelling";
loader.config({ paths: { vs: "/monaco/vs" } });
type Props = {
  value: string;
  language?: LanguageId;
  readOnly?: boolean;
  onEdit?: (value: string, edits: Edit[], origin: string) => void;
  diffFrom?: string;
  label?: string;
  revealLine?: number;
  onDiagnostics?: (count: number, status: string, detail?: string) => void;
  diagnosticsRetry?: number;
  onContextChange?: (context: EditorContextDraft, source?: string) => void;
  onAskHelp?: (context: EditorContextDraft) => void;
  helpDisabled?: boolean;
  selectionResetKey?: number;
  reviewTarget?: {
    attemptId: string;
    source: "recording" | "coached";
    seq?: number;
  };
};
export default function CodeEditor({
  value,
  language = "java",
  readOnly = false,
  onEdit,
  diffFrom,
  label,
  revealLine,
  onDiagnostics,
  diagnosticsRetry,
  onContextChange,
  onAskHelp,
  helpDisabled = false,
  selectionResetKey,
  reviewTarget,
}: Props) {
  const lang = languageConfig(language);
  const resolvedLabel = label ?? lang.filename;
  const flag = useReviewFlag();
  const flagRef = useRef({ flag, reviewTarget });
  flagRef.current = { flag, reviewTarget };
  const captureFlag = useRef<(() => void) | undefined>(undefined);
  const chat = useRef({ onContextChange, onAskHelp, helpDisabled });
  chat.current = { onContextChange, onAskHelp, helpDisabled };
  const refreshChat = useRef<(() => void) | undefined>(undefined);
  const refreshGlyph = useRef<(() => void) | undefined>(undefined);
  const diagnosticCallback = useRef(onDiagnostics);
  diagnosticCallback.current = onDiagnostics;
  const retryDiagnostics = useRef<(() => void) | undefined>(undefined);
  const callback = useRef(onEdit);
  callback.current = onEdit;
  const container = useRef<HTMLDivElement>(null);
  const current = useRef<
    | Monaco.editor.IStandaloneCodeEditor
    | Monaco.editor.IStandaloneDiffEditor
    | undefined
  >(undefined);
  const latest = useRef({ value, readOnly, diffFrom, revealLine, language: lang.id });
  latest.current = { value, readOnly, diffFrom, revealLine, language: lang.id };
  const applying = useRef(false);
  const mountChat = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
    disposables: { dispose: () => void }[],
  ) => {
    if (
      !chat.current.onContextChange &&
      !chat.current.onAskHelp &&
      !flagRef.current.reviewTarget
    )
      return;
    const capture = (): EditorContextDraft | undefined => {
      const model = editor.getModel(),
        cursor = editor.getPosition(),
        selection = editor.getSelection();
      if (!model || !cursor) return;
      return {
        file: languageConfig(latest.current.language).filename,
        cursor: {
          line: cursor.lineNumber,
          column: cursor.column,
          lineText: model.getLineContent(cursor.lineNumber),
        },
        selection:
          selection && !selection.isEmpty()
            ? {
                startLine: selection.startLineNumber,
                startColumn: selection.startColumn,
                endLine: selection.endLineNumber,
                endColumn: selection.endColumn,
                text: model.getValueInRange(selection),
              }
            : undefined,
      };
    };
    const report = () => {
      const context = capture(),
        target = flagRef.current.reviewTarget,
        model = editor.getModel();
      if (context && target && model)
        flagRef.current.flag({
          kind: "editor",
          attemptId: target.attemptId,
          source: model.getValue(),
          editor: { ...context, source: target.source, seq: target.seq },
        });
    };
    captureFlag.current = report;
    if (flagRef.current.reviewTarget)
      disposables.push(
        editor.addAction({
          id: "duo.flag-review",
          label: "Flag this editor for review",
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyB,
          ],
          contextMenuGroupId: "navigation",
          contextMenuOrder: 1.6,
          run: report,
        }),
      );
    const ask = () => {
      const context = capture();
      if (context && !chat.current.helpDisabled)
        chat.current.onAskHelp?.(context);
    };
    const wrapper = document.createElement("div");
    wrapper.className = "editor-help-glyph";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "?";
    wrapper.appendChild(button);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", ask);
    const widget: Monaco.editor.IGlyphMarginWidget = {
      getId: () => `duo.help.${editor.getId()}`,
      getDomNode: () => wrapper,
      getPosition: () => {
        const line = editor.getPosition()?.lineNumber ?? 1;
        return {
          lane: monaco.editor.GlyphMarginLane.Center,
          zIndex: 10,
          range: new monaco.Range(line, 1, line, 1),
        };
      },
    };
    if (chat.current.onAskHelp) editor.addGlyphMarginWidget(widget);
    const updateGlyph = (context?: EditorContextDraft) => {
      button.disabled = chat.current.helpDisabled;
      const title = context?.selection
        ? "Ask about selected code"
        : "Ask for help at cursor";
      button.setAttribute("aria-label", title);
      button.title = `${title} · ⌘⇧H / Ctrl+Shift+H`;
      if (chat.current.onAskHelp) editor.layoutGlyphMarginWidget(widget);
    };
    const update = () => {
      const context = capture();
      const model = editor.getModel();
      if (context && model)
        chat.current.onContextChange?.(context, model.getValue());
      updateGlyph(context);
    };
    refreshChat.current = update;
    refreshGlyph.current = () => updateGlyph(capture());
    disposables.push(
      editor.onDidChangeCursorSelection(update),
      editor.onDidChangeModelContent(update),
    );
    if (chat.current.onAskHelp)
      disposables.push(
        editor.addAction({
          id: "duo.ask-help",
          label: "Ask for help with this code",
          keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyH,
          ],
          contextMenuGroupId: "navigation",
          contextMenuOrder: 1.5,
          run: ask,
        }),
      );
    disposables.push({
      dispose: () => {
        refreshChat.current = undefined;
        refreshGlyph.current = undefined;
        captureFlag.current = undefined;
        if (chat.current.onAskHelp) editor.removeGlyphMarginWidget(widget);
        wrapper.remove();
      },
    });
    update();
  };
  const mount = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
    disposables: { dispose: () => void }[],
  ) => {
    monaco.editor.defineTheme("duo-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "7B878C" },
        { token: "keyword", foreground: "CBACF5" },
        { token: "string", foreground: "B8D7A7" },
        { token: "number", foreground: "E5B785" },
      ],
      colors: {
        "editor.background": "#13191d",
        "editor.foreground": "#d6dfe4",
        "editorLineNumber.foreground": "#536269",
        "editorLineNumber.activeForeground": "#c6d3d9",
        "editor.lineHighlightBackground": "#1b2429",
        "editor.selectionBackground": "#315549",
        "editorCursor.foreground": "#b3edcf",
        "editorWidget.background": "#1e292f",
        "editorSuggestWidget.background": "#1e292f",
        "editorSuggestWidget.selectedBackground": "#31463e",
        "editorHoverWidget.background": "#1e292f",
        "editorHoverWidget.foreground": "#d6dfe4",
        "editorHoverWidget.border": "#405259",
        "editorHoverWidget.statusBarBackground": "#172128",
        "menu.background": "#1e292f",
        "menu.foreground": "#d6dfe4",
        "menu.selectionBackground": "#31463e",
        "menu.selectionForeground": "#e3e9e9",
        "menu.border": "#405259",
        "menu.separatorBackground": "#405259",
      },
    });
    monaco.editor.setTheme("duo-dark");
    disposables.push(
      monaco.editor.addKeybindingRule({
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period,
        command: "-editor.action.quickFix",
      }),
    );
    const isCpp = lang.id === "cpp";
    const markerOwner = isCpp ? "clangd" : "javacs";
    const diagLabel = isCpp ? "C++26" : "Java";
    const requestEngine = (method: string, data: Record<string, unknown>) =>
      isCpp ? cpp().request(method, data) : java().request(method, data);
    let disposed = false;
    let checking = false;
    let checkAgain = false;
    let diagnosticTimer: ReturnType<typeof setTimeout>;
    const scheduleDiagnostics = () => {
      clearTimeout(diagnosticTimer);
      const model = editor.getModel();
      // Pausing locks edits, not diagnostics. Read-only timeline viewers do
      // not request checks on every replay frame.
      if (
        !model ||
        (editor.getOption(monaco.editor.EditorOption.readOnly) &&
          !diagnosticCallback.current)
      )
        return;
      if (checking) {
        checkAgain = true;
        return;
      }
      const version = model.getVersionId();
      monaco.editor.setModelMarkers(model, markerOwner, []);
      diagnosticCallback.current?.(0, `Checking ${diagLabel}…`);
      diagnosticTimer = setTimeout(async () => {
        checking = true;
        try {
          const diagnostics = await requestEngine("diagnostics", {
            text: model.getValue(),
          });
          if (
            disposed ||
            model.isDisposed() ||
            version !== model.getVersionId()
          )
            return;
          const markers: Monaco.editor.IMarkerData[] = (
            Array.isArray(diagnostics) ? diagnostics : []
          ).map((d: any) => ({
            startLineNumber: d.range.start.line + 1,
            startColumn: d.range.start.character + 1,
            endLineNumber: d.range.end.line + 1,
            endColumn: d.range.end.character + 1,
            message: d.message,
            severity:
              d.severity === 1
                ? monaco.MarkerSeverity.Error
                : d.severity === 2
                  ? monaco.MarkerSeverity.Warning
                  : monaco.MarkerSeverity.Info,
            source: diagLabel,
            code: d.code === undefined ? undefined : String(d.code),
          }));
          monaco.editor.setModelMarkers(model, markerOwner, markers);
          const errors = markers.filter(
            (m) => m.severity === monaco.MarkerSeverity.Error,
          ).length;
          diagnosticCallback.current?.(
            errors,
            errors
              ? `${errors} ${diagLabel} ${errors === 1 ? "error" : "errors"}`
              : `No ${diagLabel} errors`,
          );
        } catch (error) {
          if (
            !disposed &&
            !model.isDisposed() &&
            version === model.getVersionId()
          )
            diagnosticCallback.current?.(
              0,
              `${diagLabel} checks unavailable`,
              error instanceof Error ? error.message : String(error),
            );
        } finally {
          checking = false;
          if (!disposed && checkAgain) {
            checkAgain = false;
            scheduleDiagnostics();
          }
        }
      }, 450);
    };
    retryDiagnostics.current = () => {
      if (isCpp) {
        void cpp()
          .request("restart", {})
          .catch(() => {})
          .finally(() => {
            if (!disposed) scheduleDiagnostics();
          });
      } else {
        java().stop();
        scheduleDiagnostics();
      }
    };
    disposables.push({
      dispose: () => {
        disposed = true;
        retryDiagnostics.current = undefined;
        clearTimeout(diagnosticTimer);
      },
    });
    disposables.push(editor.onDidChangeModelContent(scheduleDiagnostics));
    disposables.push(
      editor.onDidChangeConfiguration((e) => {
        if (e.hasChanged(monaco.editor.EditorOption.readOnly))
          scheduleDiagnostics();
      }),
    );
    scheduleDiagnostics();
    disposables.push(installSpelling(editor, monaco, lang.id));
    let pasted = false;
    const dom = editor.getDomNode();
    const paste = () => {
      pasted = true;
      setTimeout(() => {
        pasted = false;
      }, 0);
    };
    dom?.addEventListener("paste", paste, true);
    disposables.push({
      dispose: () => dom?.removeEventListener("paste", paste, true),
    });
    disposables.push(
      editor.onDidChangeModelContent((e) => {
        if (
          !applying.current &&
          !editor.getOption(monaco.editor.EditorOption.readOnly)
        )
          callback.current?.(
            editor.getValue(),
            e.changes.map((c) => ({
              offset: c.rangeOffset,
              length: c.rangeLength,
              text: c.text,
            })),
            e.isUndoing
              ? "undo"
              : e.isRedoing
                ? "redo"
                : pasted
                  ? "paste"
                  : "editor",
          );
      }),
    );
    const range = (r: any) =>
      new monaco.Range(
        r.start.line + 1,
        r.start.character + 1,
        r.end.line + 1,
        r.end.character + 1,
      );
    disposables.push(
      monaco.languages.registerCodeActionProvider(lang.monacoLanguage, {
        async provideCodeActions(model, selection, context, token) {
          const empty = { actions: [], dispose() {} };
          if (
            model !== editor.getModel() ||
            editor.getOption(monaco.editor.EditorOption.readOnly)
          )
            return empty;
          const version = model.getVersionId();
          const source = model.getValue();
          const lspRange = (r: Monaco.IRange) => ({
            start: {
              line: r.startLineNumber - 1,
              character: r.startColumn - 1,
            },
            end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
          });
          if (isCpp) {
            const markers = context.markers.filter(
              (marker) => marker.source === "C++26",
            );
            if (!markers.length) return empty;
            try {
              const actions = await cpp().request("codeActions", {
                text: source,
                range: lspRange(selection),
                diagnostics: markers.map((marker) => ({
                  range: lspRange(marker),
                  code:
                    typeof marker.code === "object"
                      ? marker.code.value
                      : marker.code,
                  message: marker.message,
                  severity:
                    marker.severity === monaco.MarkerSeverity.Error ? 1 : 2,
                })),
              });
              if (
                token.isCancellationRequested ||
                model.isDisposed() ||
                version !== model.getVersionId() ||
                !Array.isArray(actions)
              )
                return empty;
              return {
                actions: actions.map((action: any) => ({
                  title: action.title,
                  kind: "quickfix",
                  diagnostics: markers,
                  edit: {
                    edits: (action.edits ?? []).map((e: any) => ({
                      resource: model.uri,
                      versionId: version,
                      textEdit: {
                        range: range(e.range),
                        text: e.newText,
                      },
                    })),
                  },
                })),
                dispose() {},
              };
            } catch {
              return empty;
            }
          }
          const unresolved = context.markers.filter((marker) =>
            [
              "compiler.err.cant.resolve",
              "compiler.err.cant.resolve.location",
            ].includes(
              typeof marker.code === "object"
                ? marker.code.value
                : (marker.code ?? ""),
            ),
          );
          if (!unresolved.length) return empty;
          try {
            const result = await java().request("codeActions", {
              text: source,
              range: lspRange(selection),
              diagnostics: unresolved.map((marker) => ({
                range: lspRange(marker),
                code:
                  typeof marker.code === "object"
                    ? marker.code.value
                    : marker.code,
                message: marker.message,
                severity: 1,
              })),
            });
            if (
              token.isCancellationRequested ||
              model.isDisposed() ||
              version !== model.getVersionId()
            )
              return empty;
            return {
              actions: importQuickFixes(
                source,
                result,
                selection.startLineNumber - 1,
              ).map((fix) => {
                const pos = model.getPositionAt(fix.offset);
                return {
                  title: fix.title,
                  kind: "quickfix",
                  diagnostics: unresolved,
                  edit: {
                    edits: [
                      {
                        resource: model.uri,
                        versionId: version,
                        textEdit: {
                          range: new monaco.Range(
                            pos.lineNumber,
                            pos.column,
                            pos.lineNumber,
                            pos.column,
                          ),
                          text: fix.text,
                        },
                      },
                    ],
                  },
                };
              }),
              dispose() {},
            };
          } catch {
            return empty;
          }
        },
      }),
    );
    if (isCpp) {
      disposables.push(
        monaco.languages.registerHoverProvider("cpp", {
          async provideHover(model, position, token) {
            if (model !== editor.getModel()) return null;
            const version = model.getVersionId();
            try {
              const res = await cpp().request("inspect", {
                text: model.getValue(),
                position: {
                  line: position.lineNumber - 1,
                  character: position.column - 1,
                },
              });
              if (
                token.isCancellationRequested ||
                model.isDisposed() ||
                version !== model.getVersionId()
              )
                return null;
              const raw = res?.hover?.contents;
              if (!raw) return null;
              const contents = Array.isArray(raw)
                ? raw.map((c: any) =>
                    typeof c === "string"
                      ? { value: c }
                      : { value: String(c?.value ?? "") },
                  )
                : typeof raw === "string"
                  ? [{ value: raw }]
                  : [{ value: String(raw.value ?? "") }];
              if (!contents.some((c: any) => c.value.trim().length > 0))
                return null;
              return {
                range: res.hover.range ? range(res.hover.range) : undefined,
                contents,
              };
            } catch {
              return null;
            }
          },
        }),
      );
    }
    // Reuse Monaco's marker hover and action picker for all entry points.
    // Right-click moves the cursor before building the menu, so this context
    // key follows the error the user clicked rather than their previous cursor.
    const onDiagnostic = editor.createContextKey<boolean>(
      "duo.onDiagnostic",
      false,
    );
    const updateDiagnosticContext = () => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      onDiagnostic.set(
        Boolean(
          model &&
          selection &&
          monaco.editor
            .getModelMarkers({ resource: model.uri })
            .some((marker) =>
              monaco.Range.areIntersectingOrTouching(marker, selection),
            ),
        ),
      );
    };
    disposables.push(
      editor.onDidChangeCursorSelection(updateDiagnosticContext),
      monaco.editor.onDidChangeMarkers((resources) => {
        const uri = editor.getModel()?.uri.toString();
        if (resources.some((resource) => resource.toString() === uri))
          updateDiagnosticContext();
      }),
      editor.addAction({
        id: "duo.quick-fix",
        label: "Quick Fix…",
        precondition: "!editorReadonly && duo.onDiagnostic",
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 0,
        run: () =>
          editor.trigger("duo.quick-fix", "editor.action.codeAction", {
            kind: "quickfix",
            apply: "never",
          }),
      }),
      { dispose: () => onDiagnostic.reset() },
    );
    updateDiagnosticContext();
    const mapItem = (
      item: any,
      model: Monaco.editor.ITextModel,
      pos: Monaco.Position,
    ) => {
      const word = model.getWordUntilPosition(pos);
      const edit = item.textEdit;
      const cleanLabel = isCpp
        ? String(item.label ?? "").replace(/^\s*(?:•\s*)?/, "")
        : String(item.label ?? "");
      const autoImport =
        !isCpp &&
        (item._autoImport ??
          ([7, 8].includes(item.kind) && !item.data?.memberName
            ? importForCompletion(
                model.getValue(),
                item.data?.className ?? item.detail ?? "",
                pos.lineNumber - 1,
              )
            : undefined));
      const importPosition = autoImport
        ? model.getPositionAt(autoImport.offset)
        : undefined;
      const kinds = [
        18, 18, 0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 15, 17, 28, 19, 20, 21, 23,
        16, 14, 6, 10, 11, 24,
      ];
      return {
        label: cleanLabel,
        kind: kinds[item.kind ?? 1] ?? 18,
        detail: item.detail,
        documentation: item.documentation?.value ?? item.documentation,
        insertText: edit?.newText ?? item.insertText ?? cleanLabel,
        insertTextRules:
          item.insertTextFormat === 2
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
        range: edit?.range
          ? range(edit.range)
          : edit?.replace
            ? range(edit.replace)
            : new monaco.Range(
                pos.lineNumber,
                word.startColumn,
                pos.lineNumber,
                word.endColumn,
              ),
        sortText: item.sortText,
        filterText: item.filterText ?? cleanLabel,
        additionalTextEdits: [
          ...(item.additionalTextEdits?.map((x: any) => ({
            range: range(x.range),
            text: x.newText,
          })) ?? []),
          ...(autoImport && importPosition
            ? [
                {
                  range: new monaco.Range(
                    importPosition.lineNumber,
                    importPosition.column,
                    importPosition.lineNumber,
                    importPosition.column,
                  ),
                  text: autoImport.text,
                },
              ]
            : []),
        ],
        _autoImport: autoImport,
        _lsp: item,
        _model: model,
        _version: model.getVersionId(),
        _position: pos,
      } as Monaco.languages.CompletionItem;
    };
    const activeSnippets = isCpp ? cppSnippets : javaSnippets;
    disposables.push(
      monaco.languages.registerCompletionItemProvider(lang.monacoLanguage, {
        triggerCharacters: isCpp ? [".", ">", ":"] : ["."],
        provideCompletionItems: async (
          model: Monaco.editor.ITextModel,
          pos: Monaco.Position,
          context: Monaco.languages.CompletionContext,
          token: Monaco.CancellationToken,
        ) => {
          if (
            model !== editor.getModel() ||
            editor.getOption(monaco.editor.EditorOption.readOnly)
          )
            return { suggestions: [] };
          const version = model.getVersionId();
          const word = model.getWordUntilPosition(pos);
          const linePrefix = model
            .getLineContent(pos.lineNumber)
            .slice(0, word.startColumn - 1);
          const snippets = shouldOfferSnippets(linePrefix)
            ? activeSnippets
                .filter(
                  (s) => word.word.length > 0 && s.label.startsWith(word.word),
                )
                .map((s) => ({
                  ...s,
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertTextRules:
                    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range: new monaco.Range(
                    pos.lineNumber,
                    word.startColumn,
                    pos.lineNumber,
                    word.endColumn,
                  ),
                  sortText: "0" + s.label,
                }))
            : [];
          if (snippets.some((s) => s.label === word.word))
            return { suggestions: snippets };
          try {
            const result = isCpp
              ? await cpp().request("completion", {
                  text: model.getValue(),
                  position: { line: pos.lineNumber - 1, character: pos.column - 1 },
                })
              : await javaCompletions(
                  (method, data) => java().request(method, data),
                  model.getValue(),
                  { line: pos.lineNumber - 1, character: pos.column - 1 },
                  () =>
                    token.isCancellationRequested ||
                    model.isDisposed() ||
                    version !== model.getVersionId(),
                );
            if (
              token.isCancellationRequested ||
              model.isDisposed() ||
              version !== model.getVersionId()
            )
              return { suggestions: [] };
            return {
              suggestions: [
                ...snippets,
                ...(Array.isArray(result) ? result : (result?.items ?? [])).map(
                  (item: any) => mapItem(item, model, pos),
                ),
              ],
              incomplete: Array.isArray(result)
                ? false
                : (result?.isIncomplete ?? false),
            };
          } catch (error) {
            console.warn(`${diagLabel} completion failed`, String(error));
            return { suggestions: snippets };
          }
        },
        resolveCompletionItem: async (
          item: Monaco.languages.CompletionItem,
          token: Monaco.CancellationToken,
        ) => {
          const meta = item as any;
          if (isCpp || !meta._lsp?.data) return item;
          try {
            const resolved = await java().request("resolve", {
              item: meta._lsp,
            });
            if (
              token.isCancellationRequested ||
              meta._model.isDisposed() ||
              meta._version !== meta._model.getVersionId()
            )
              return item;
            return mapItem(
              { ...resolved, _autoImport: meta._autoImport },
              meta._model,
              meta._position,
            );
          } catch {
            return item;
          }
        },
      }),
    );
  };
  const options: Monaco.editor.IStandaloneEditorConstructionOptions = {
    readOnly,
    glyphMargin: !!onAskHelp,
    editContext: false,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
    lineHeight: 24,
    padding: { top: 22, bottom: 20 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    tabCompletion: "on",
    acceptSuggestionOnEnter: "on",
    quickSuggestions: { other: true, comments: false, strings: false },
    wordBasedSuggestions: "off",
    renderValidationDecorations: "on",
    snippetSuggestions: "top",
    suggest: { showWords: false },
    fixedOverflowWidgets: true,
    hover: { enabled: "on", sticky: true, delay: 300 },
    // Monaco's fixed shadow-root menu loses standalone theme variables.
    // Keep widgets in the themed document so menus and quick fixes stay legible.
    useShadowDOM: false,
    ariaLabel: resolvedLabel,
    renderLineHighlight: "line",
    bracketPairColorization: { enabled: true },
  };
  useEffect(() => {
    let cancelled = false;
    const disposables: { dispose: () => void }[] = [];
    void loader.init().then((monaco) => {
      if (cancelled || !container.current) return;
      if (latest.current.diffFrom !== undefined) {
        const original = monaco.editor.createModel(
          latest.current.diffFrom,
          lang.monacoLanguage,
        );
        const modified = monaco.editor.createModel(
          latest.current.value,
          lang.monacoLanguage,
        );
        const editor = monaco.editor.createDiffEditor(container.current, {
          ...options,
          theme: "duo-dark",
          readOnly: true,
          renderSideBySide: false,
          originalEditable: false,
        });
        editor.setModel({ original, modified });
        current.current = editor;
        mountChat(editor.getModifiedEditor(), monaco, disposables);
        disposables.push(editor, original, modified);
      } else {
        const model = monaco.editor.createModel(
          latest.current.value,
          lang.monacoLanguage,
        );
        const editor = monaco.editor.create(container.current, {
          ...options,
          readOnly: latest.current.readOnly,
          model,
          theme: "vs-dark",
        });
        current.current = editor;
        mount(editor, monaco, disposables);
        mountChat(editor, monaco, disposables);
        disposables.push(editor, model);
      }
      const editor = current.current;
      if (editor && latest.current.revealLine) {
        const target =
          "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
        target.revealLineInCenterIfOutsideViewport(latest.current.revealLine);
      }
    });
    return () => {
      cancelled = true;
      current.current = undefined;
      for (const disposable of disposables) disposable.dispose();
    };
  }, [diffFrom !== undefined, lang.id]);
  useEffect(() => {
    if (diagnosticsRetry) retryDiagnostics.current?.();
  }, [diagnosticsRetry]);
  useEffect(() => {
    refreshGlyph.current?.();
  }, [helpDisabled]);
  useEffect(() => {
    if (selectionResetKey === undefined) return;
    const editor = current.current;
    if (!editor) return;
    const target =
      "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
    const position = target.getPosition();
    if (position) target.setPosition(position);
  }, [selectionResetKey]);
  useEffect(() => {
    const editor = current.current;
    if (!editor) return;
    let synced = false;
    applying.current = true;
    try {
      if ("getOriginalEditor" in editor) {
        const models = editor.getModel();
        if (models && models.original.getValue() !== diffFrom) {
          models.original.setValue(diffFrom ?? "");
          synced = true;
        }
        if (models && models.modified.getValue() !== value) {
          models.modified.setValue(value);
          synced = true;
        }
      } else {
        editor.updateOptions({ readOnly });
        if (editor.getValue() !== value) {
          editor.setValue(value);
          synced = true;
        }
      }
      if (revealLine) {
        const target =
          "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
        target.revealLineInCenterIfOutsideViewport(revealLine);
      }
    } finally {
      applying.current = false;
    }
    if (synced) refreshChat.current?.();
  }, [value, readOnly, diffFrom, revealLine]);
  return (
    <div className="editor-review-wrap">
      <div className="editor-inner" ref={container} />
      {reviewTarget && (
        <button
          type="button"
          className="editor-flag-button"
          aria-label="Flag editor for review"
          title="Flag editor for review · ⌘⌥B / Ctrl+Alt+B"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => captureFlag.current?.()}
        >
          <Flag size={13} />
        </button>
      )}
    </div>
  );
}
