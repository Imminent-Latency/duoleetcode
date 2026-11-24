import { test } from "node:test";
import assert from "node:assert/strict";
import { importForCompletion, importQuickFixes } from "../lib/java-imports";
test("class suggestions add a qualified Java import in the single-file workspace", () => {
  assert.deepEqual(
    importForCompletion("class Solution {\n  HashM", "java.util.HashMap", 1),
    { offset: 0, text: "import java.util.HashMap;\n" },
  );
  const source = "package practice;\r\n\r\nclass Solution {\r\n  HashM";
  const edit = importForCompletion(source, "java.util.HashMap", 3)!;
  assert.equal(
    source.slice(0, edit.offset) + edit.text + source.slice(edit.offset),
    "package practice;\r\nimport java.util.HashMap;\r\n\r\nclass Solution {\r\n  HashM",
  );
});

test("missing-type quick fixes offer compiler imports once and preserve the source layout", () => {
  const proposal = (name: string) => ({
    title: `Import '${name}'`,
    edit: {
      changes: {
        "file:///files/project/Solution.java": [
          { newText: `import ${name};\n` },
        ],
      },
    },
  });
  const source =
    "package practice;\r\n// keep this\r\nclass Solution { HashMap<Character, Character> map; }";
  assert.deepEqual(
    importQuickFixes(
      source,
      [proposal("java.util.HashMap"), proposal("java.util.HashMap")],
      2,
    ),
    [
      {
        title: "Import 'java.util.HashMap'",
        offset: 19,
        text: "import java.util.HashMap;\r\n",
      },
    ],
  );
  for (const imports of [
    "import java.util.HashMap;\n",
    "import java.util.*;\n",
    "import custom.HashMap;\n",
  ])
    assert.deepEqual(
      importQuickFixes(imports + source, [proposal("java.util.HashMap")], 3),
      [],
    );
  assert.deepEqual(
    importQuickFixes(
      source,
      [
        { title: "Generate implementation", command: { command: "anything" } },
        {
          title: "Import 'java.util.HashMap'",
          edit: {
            changes: {
              "file:///other.java": [{ newText: "import java.util.HashMap;" }],
            },
          },
        },
        {
          title: "Import 'java.util.HashMap'",
          edit: {
            changes: {
              "file:///files/project/Solution.java": [
                { newText: "replace solution" },
              ],
            },
          },
        },
        null,
      ],
      2,
    ),
    [],
  );
});
test("existing imports, java.lang, import lines and comments are handled", () => {
  assert.equal(
    importForCompletion(
      "import java.util.*;\nclass Solution { HashM",
      "java.util.HashMap",
      1,
    ),
    undefined,
  );
  assert.equal(
    importForCompletion("class Solution { Str", "java.lang.String", 0),
    undefined,
  );
  assert.equal(
    importForCompletion("import java.util.HashM", "java.util.HashMap", 0),
    undefined,
  );
  assert.ok(
    importForCompletion(
      "// import java.util.HashMap;\nclass Solution { HashM",
      "java.util.HashMap",
      1,
    ),
  );
  assert.equal(
    importForCompletion("class Solution { Mine", "unverified.Custom", 0),
    undefined,
  );
});
