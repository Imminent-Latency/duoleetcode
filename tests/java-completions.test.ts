import { test } from "node:test";
import assert from "node:assert/strict";
import { javaCompletions } from "../lib/java-completions";
import { applyEdits } from "../lib/recording";

const positionAt = (text: string, offset: number) => ({
  line: text.slice(0, offset).split("\n").length - 1,
  character: offset - text.lastIndexOf("\n", offset - 1) - 1,
});
const itemsOf = (result: Awaited<ReturnType<typeof javaCompletions>>) =>
  Array.isArray(result) ? result : (result?.items ?? []);

test("importing a short class name searches the engine and inserts a qualified name only", async () => {
  const source = "// Header\r\nimport HashM;\r\nclass Solution {}";
  const position = positionAt(source, source.indexOf("HashM") + 5);
  const result = await javaCompletions(
    async (_, data) => {
      assert.ok(
        data.text.startsWith("class Solution { void completion() { HashM"),
      );
      return {
        items: [
          {
            label: "HashMap",
            kind: 7,
            detail: "java.util.HashMap",
            data: { className: "java.util.HashMap" },
            textEdit: {
              range: { start: { line: 0, character: 0 }, end: data.position },
              newText: "bad synthetic range",
            },
          },
          { label: "HashM", kind: 6, detail: "local variable" },
        ],
      };
    },
    source,
    position,
  );
  const items = itemsOf(result);
  assert.deepEqual(items, [
    {
      label: "HashMap",
      kind: 7,
      detail: "java.util.HashMap",
      filterText: "HashMap",
      insertText: "java.util.HashMap",
    },
  ]);
  assert.equal(
    source.replace("HashM", items[0].insertText!),
    "// Header\r\nimport java.util.HashMap;\r\nclass Solution {}",
  );
});

test("package paths, static imports and comments retain normal engine completion", async () => {
  for (const source of [
    "import java.util.",
    "import java.time.Loc",
    "import static java.util.Collections.",
    "// import HashM",
    'class Solution { String s = "import HashM',
  ]) {
    const expected = { items: [{ label: "native", kind: 9 }] };
    assert.equal(
      await javaCompletions(
        async (_, data) => {
          assert.equal(data.text, source);
          return expected;
        },
        source,
        positionAt(source, source.length),
      ),
      expected,
    );
  }
});

test("missing standard types get compiler-derived members and a deferred import with original edit coordinates", async () => {
  for (const name of ["Arrays", "Collections", "Objects"]) {
    const source = `package practice;\r\n// 🐣\r\nclass Solution {\r\n    void test() { ${name}.so }\r\n}`;
    const offset = source.indexOf(`${name}.so`) + name.length + 3;
    const position = positionAt(source, offset);
    let calls = 0;
    const result = await javaCompletions(
      async (_, data) => {
        calls++;
        if (calls === 1) {
          assert.equal(data.text, source);
          return null;
        }
        if (calls === 2) {
          assert.equal(data.text.slice(offset - 3, offset), "   ");
          assert.equal(data.position.character, position.character - 3);
          return {
            items: [
              {
                label: name,
                kind: 7,
                data: { className: `java.util.${name}` },
              },
            ],
          };
        }
        assert.ok(data.text.includes(`import java.util.${name};\r\n`));
        assert.equal(data.position.line, position.line + 1);
        assert.equal(data.position.character, position.character);
        const range = {
          start: { ...data.position, character: data.position.character - 2 },
          end: data.position,
        };
        return {
          items: [
            {
              label: "sort",
              kind: 2,
              data: { className: `java.util.${name}`, memberName: "sort" },
              textEdit: { newText: "sort()", insert: range, replace: range },
            },
            { label: "class", kind: 14 },
          ],
        };
      },
      source,
      position,
    );
    const items = itemsOf(result);
    assert.equal(calls, 3);
    assert.equal(
      items.length,
      1,
      "only members verified for the resolved class are offered",
    );
    assert.deepEqual(items[0].textEdit!.replace, {
      start: { ...position, character: position.character - 2 },
      end: position,
    });
    const edit = items[0]._autoImport!;
    const accepted = applyEdits(source, [
      { offset: edit.offset, length: 0, text: edit.text },
      { offset: offset - 2, length: 2, text: "sort()" },
    ]);
    assert.ok(
      accepted.startsWith(
        `package practice;\r\nimport java.util.${name};\r\n// 🐣`,
      ),
    );
    assert.ok(accepted.includes(`${name}.sort()`));
  }
});

test("inherited static members retain their declaring-class metadata while importing the receiver", async () => {
  let calls = 0;
  const result = await javaCompletions(
    async () => {
      calls++;
      if (calls === 1) return null;
      if (calls === 2)
        return {
          items: [
            {
              label: "GregorianCalendar",
              kind: 7,
              detail: "java.util.GregorianCalendar",
            },
          ],
        };
      return {
        items: [
          {
            label: "getInstance",
            kind: 2,
            data: {
              className: "java.util.Calendar",
              memberName: "getInstance",
            },
          },
        ],
      };
    },
    "GregorianCalendar.",
    { line: 0, character: 18 },
  );
  const item = itemsOf(result)[0];
  assert.equal(item.data?.className, "java.util.Calendar");
  assert.equal(item._autoImport?.text, "import java.util.GregorianCalendar;\n");
});

test("normal imported and instance completions take one request and keep the engine result", async () => {
  const expected = { items: [{ label: "sort", kind: 2 }] };
  let calls = 0;
  const result = await javaCompletions(
    async () => {
      calls++;
      return expected;
    },
    "Arrays.",
    { line: 0, character: 7 },
  );
  assert.equal(result, expected);
  assert.equal(calls, 1);
});

test("fallback does not guess through ambiguous names, shadowing, or conflicting imports", async () => {
  for (const matches of [
    [
      { label: "Arrays", kind: 6, data: { className: "Solution" } },
      { label: "Arrays", kind: 7, detail: "java.util.Arrays" },
    ],
    [
      { label: "Arrays", kind: 7, detail: "mine.Arrays" },
      { label: "Arrays", kind: 7, detail: "java.util.Arrays" },
    ],
    [
      { label: "Arrays", kind: 7, detail: "java.util.Arrays" },
      { label: "Arrays", kind: 7, detail: "javax.other.Arrays" },
    ],
    [{ label: "Arrays", kind: 7, detail: "unverified.Arrays" }],
  ]) {
    let calls = 0;
    const result = await javaCompletions(
      async () => (++calls === 1 ? null : { items: matches }),
      "Arrays.",
      { line: 0, character: 7 },
    );
    assert.equal(result, null);
    assert.equal(calls, 2);
  }
  for (const imports of ["import custom.Arrays;\n", "import java.util.*;\n"]) {
    const source = imports + "class Solution { void f() { Arrays. } }";
    let calls = 0;
    const result = await javaCompletions(
      async () =>
        ++calls === 1
          ? null
          : {
              items: [{ label: "Arrays", kind: 7, detail: "java.util.Arrays" }],
            },
      source,
      positionAt(source, source.indexOf("Arrays.") + 7),
    );
    assert.equal(result, null);
    assert.equal(calls, 2);
  }
});

test("no fallback inside strings/comments, for qualified names, or after cancellation", async () => {
  for (const source of [
    "// Arrays.",
    "/* Arrays.",
    '"Arrays.',
    '"""\nArrays.',
    "java.util.Arrays.",
    "thing.Arrays.",
    "values.",
  ]) {
    let calls = 0;
    await javaCompletions(
      async () => {
        calls++;
        return null;
      },
      source,
      positionAt(source, source.length),
    );
    assert.equal(calls, 1, source);
  }
  let calls = 0;
  await javaCompletions(
    async () => {
      calls++;
      return null;
    },
    "Arrays.",
    { line: 0, character: 7 },
    () => true,
  );
  assert.equal(calls, 1);
});
