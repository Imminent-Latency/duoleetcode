import { importForCompletion, maskJavaNonCode } from "./java-imports";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Item = {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
  filterText?: string;
  data?: { className?: string; memberName?: string };
  textEdit?: {
    range?: Range;
    insert?: Range;
    replace?: Range;
    newText: string;
  };
  additionalTextEdits?: { range: Range; newText: string }[];
  _autoImport?: { offset: number; text: string };
};
type Result = { items: Item[]; isIncomplete?: boolean } | Item[] | null;
type Request = (
  method: string,
  data: { text: string; position: Position },
) => Promise<Result>;
const itemsOf = (result: Result) =>
  Array.isArray(result) ? result : (result?.items ?? []);
const offsetAt = (text: string, pos: Position) => {
  let offset = 0;
  for (let line = 0; line < pos.line; line++)
    offset = text.indexOf("\n", offset) + 1;
  return offset + pos.character;
};
const positionAt = (text: string, offset: number): Position => {
  const prefix = text.slice(0, offset);
  return {
    line: prefix.split("\n").length - 1,
    character: offset - prefix.lastIndexOf("\n") - 1,
  };
};

// Resolve a missing type using javacs's own class suggestions, then ask javacs
// for its members in a temporary imported snapshot. Source changes happen only
// when Monaco accepts a suggestion (as an ordinary recorded additional edit).
export async function javaCompletions(
  request: Request,
  text: string,
  position: Position,
  cancelled = () => false,
): Promise<Result> {
  const cursor = offsetAt(text, position);
  const masked = maskJavaNonCode(text);
  const importName = /^\s*import\s+([A-Z][\w$]*)$/.exec(
    masked.slice(0, cursor).split(/\r?\n/).at(-1) ?? "",
  );
  if (importName) {
    // Resolve a short class name through the engine's class index instead of
    // requiring the learner to remember its package. No source is changed here.
    const prefix = `class Solution { void completion() { ${importName[1]}`;
    const result = await request("completion", {
      text: prefix + " } }",
      position: { line: 0, character: prefix.length },
    });
    if (cancelled()) return null;
    return {
      isIncomplete: true,
      items: itemsOf(result).flatMap((item) => {
        const qualified = item.data?.className ?? item.detail ?? "";
        return [7, 8].includes(item.kind ?? 0) &&
          /^(?:java|javax)\.[\w$.]+$/.test(qualified)
          ? [
              {
                label: item.label,
                kind: item.kind,
                detail: qualified,
                filterText: item.label,
                insertText: qualified,
              },
            ]
          : [];
      }),
    };
  }
  const original = await request("completion", { text, position });
  if (cancelled() || itemsOf(original).length) return original;
  const receiver = /\b([A-Z][\w$]*)[ \t]*\.[ \t]*[\w$]*$/.exec(
    masked.slice(0, cursor),
  );
  if (!receiver || /[\w$.]/.test(masked[receiver.index - 1] ?? ""))
    return original;
  const name = receiver[1];
  const nameEnd = receiver.index + name.length;
  // Removing the dot and partial member makes this an ordinary type-name
  // completion without changing the offsets of any other source text.
  const classSource =
    text.slice(0, nameEnd) + " ".repeat(cursor - nameEnd) + text.slice(cursor);
  const classes = itemsOf(
    await request("completion", {
      text: classSource,
      position: positionAt(text, nameEnd),
    }),
  ).filter((item) => item.label === name);
  if (cancelled()) return original;
  const candidates = new Set(
    classes.map((item) => item.data?.className ?? item.detail ?? ""),
  );
  // A same-named variable, user type, conflicting import, or multiple matching
  // types must not be silently replaced by a standard-library class.
  if (
    !classes.length ||
    classes.some((item) => ![7, 8].includes(item.kind ?? 0)) ||
    candidates.size !== 1
  )
    return original;
  const qualified = [...candidates][0];
  if (qualified.split(".").at(-1) !== name) return original;
  const edit = importForCompletion(text, qualified, position.line);
  if (!edit || edit.offset > receiver.index) return original;
  const imported =
    text.slice(0, edit.offset) + edit.text + text.slice(edit.offset);
  const result = await request("completion", {
    text: imported,
    position: positionAt(imported, cursor + edit.text.length),
  });
  if (cancelled()) return original;
  const originalPosition = (p: Position) => {
    let offset = offsetAt(imported, p);
    if (offset >= edit.offset + edit.text.length) offset -= edit.text.length;
    else if (offset > edit.offset)
      throw new Error("Completion edit overlaps its temporary import");
    return positionAt(text, offset);
  };
  const originalRange = (r: Range): Range => ({
    start: originalPosition(r.start),
    end: originalPosition(r.end),
  });
  const items: Item[] = [];
  for (const item of itemsOf(result)) {
    // These members came from the compiler's resolved receiver. Inherited
    // static methods can name a superclass in their documentation metadata.
    if (!item.data?.className || !item.data.memberName) continue;
    try {
      items.push({
        ...item,
        _autoImport: edit,
        textEdit: item.textEdit
          ? {
              ...item.textEdit,
              ...(item.textEdit.range
                ? { range: originalRange(item.textEdit.range) }
                : {}),
              ...(item.textEdit.insert
                ? { insert: originalRange(item.textEdit.insert) }
                : {}),
              ...(item.textEdit.replace
                ? { replace: originalRange(item.textEdit.replace) }
                : {}),
            }
          : undefined,
        additionalTextEdits: item.additionalTextEdits?.map((e) => ({
          ...e,
          range: originalRange(e.range),
        })),
      });
    } catch {
      /* Do not apply an edit that only exists in the imported snapshot. */
    }
  }
  return items.length
    ? {
        items,
        isIncomplete: Array.isArray(result) ? false : result?.isIncomplete,
      }
    : original;
}
