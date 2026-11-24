import { test } from "node:test";
import assert from "node:assert/strict";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { validateEditorContext } from "../lib/editor-context";
import { askJavaHelp } from "../lib/java-help-service";
import type { EditorChatContext } from "../lib/types";

const source = 'class Solution {\r\n    String label = "😀";\r\n\r\n}\r\n';
function fixture() {
  const db = new AttemptStore(":memory:");
  const a = db.create({ ...demoProblem, javaStarter: source }, 60000, true);
  const editor: EditorChatContext = {
    file: "Solution.java",
    source: "recording",
    seq: 0,
    cursor: { line: 2, column: 5, lineText: source.split("\r\n")[1] },
    selection: {
      startLine: 2,
      startColumn: 5,
      endLine: 3,
      endColumn: 1,
      text: 'String label = "😀";\r\n',
    },
  };
  return { db, a, editor };
}
test("code context checks UTF-16 ranges, CRLF, empty lines, and immutable recording snapshots", () => {
  const { db, a, editor } = fixture();
  assert.deepEqual(validateEditorContext(a, editor), editor);
  assert.ok(
    validateEditorContext(a, {
      ...editor,
      cursor: { line: 3, column: 1, lineText: "" },
    }),
  );
  for (const cursor of [
    { line: 99, column: 1, lineText: "" },
    { line: 3, column: 2, lineText: "" },
    { line: 2, column: 99, lineText: editor.cursor.lineText },
  ])
    assert.throws(
      () => validateEditorContext(a, { ...editor, cursor }),
      /outside/,
    );
  assert.throws(
    () =>
      validateEditorContext(a, {
        ...editor,
        cursor: { ...editor.cursor, lineText: "forged" },
      }),
    /cursor line/,
  );
  assert.throws(
    () =>
      validateEditorContext(a, {
        ...editor,
        selection: { ...editor.selection, text: "forged" },
      }),
    /Selected code/,
  );
  assert.throws(
    () => validateEditorContext(a, { ...editor, seq: 99 }),
    /snapshot/,
  );
  assert.throws(() =>
    validateEditorContext(a, {
      ...editor,
      selection: { ...editor.selection, text: "x".repeat(12001) },
    }),
  );
  db.append(a.id, [
    {
      seq: 1,
      at: Date.now(),
      type: "edit",
      version: a.version + 1,
      edits: [{ offset: 0, length: source.length, text: "class Changed {}" }],
    },
  ]);
  assert.deepEqual(validateEditorContext(db.get(a.id), editor), editor);
  assert.throws(
    () => validateEditorContext(db.get(a.id), { ...editor, seq: 1 }),
    /outside|cursor line/,
  );
  db.db.close();
});
test("reference turns persist exact context, reject replacement, and pass only saved snippet context to inference", async () => {
  const { db, a, editor } = fixture();
  const id = crypto.randomUUID();
  db.append(a.id, [
    {
      seq: 1,
      at: Date.now(),
      type: "assistance",
      assistanceId: id,
      assistanceStage: "request",
    },
  ]);
  const input = {
    id,
    seq: 1,
    question: "What does this declaration mean?",
    editor: { ...editor, seq: 1 },
  };
  let calls = 0;
  const run = async (
    q: string,
    history: unknown[],
    ctx?: EditorChatContext,
  ) => {
    calls++;
    assert.equal(q, input.question);
    assert.deepEqual(history, []);
    assert.deepEqual(ctx, input.editor);
    assert.deepEqual(Object.keys(ctx!).sort(), [
      "cursor",
      "file",
      "selection",
      "seq",
      "source",
    ]);
    return {
      answer: "A Java declaration.",
      kind: "clarification" as const,
      model: "test",
      topics: [],
      sources: [],
    };
  };
  await askJavaHelp(db, a.id, input, run);
  await askJavaHelp(db, a.id, input, run);
  assert.equal(calls, 1);
  assert.deepEqual(db.get(a.id).javaHelp?.[0].editor, input.editor);
  await assert.rejects(
    askJavaHelp(
      db,
      a.id,
      {
        ...input,
        editor: { ...input.editor, cursor: { ...editor.cursor, column: 6 } },
      },
      run,
    ),
    /cannot be replaced/,
  );
  await assert.rejects(
    askJavaHelp(db, a.id, { ...input, editor }, run),
    /snapshot/,
  );
  db.db.close();
});
test("coached context uses separately saved work and cannot be passed off as assessment context", () => {
  const { db, a, editor } = fixture();
  const coached = { ...editor, source: "coached" as const, seq: undefined };
  assert.throws(() => validateEditorContext(a, coached), /Save the coached/);
  a.followup = {
    answer: "Preserved",
    answeredAt: Date.now(),
    coachedCode: source,
  };
  assert.ok(validateEditorContext(a, coached));
  assert.throws(() => validateEditorContext(a, coached, 1), /Save the coached/);
  a.followup.coachedCode = "";
  assert.ok(
    validateEditorContext(a, {
      file: "Solution.java",
      source: "coached",
      cursor: { line: 1, column: 1, lineText: "" },
    }),
  );
  assert.equal(a.initialSource, source);
  db.db.close();
});
