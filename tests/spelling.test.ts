import { test } from "node:test";
import assert from "node:assert/strict";
import nspell from "nspell";
import { readFile } from "node:fs/promises";
import { codingVocabulary, commentWords } from "../lib/spelling";

test("spelling checks comment prose with exact offsets, excluding Java strings and identifiers", () => {
  const source = `class Solution {
    String text = "// speling";
    String block = """
      /* speling */
      """;
    int minPrices = 0;
    // A speling mistake near minPrices and UTF-16 😀 wrds.
    /* An algorithim. */
  }`;
  const words = commentWords(source);
  assert.deepEqual(
    words
      .filter((item) => ["speling", "wrds", "algorithim"].includes(item.word))
      .map((item) => item.word),
    ["speling", "wrds", "algorithim"],
  );
  assert.ok(!words.some((item) => item.word === "minPrices"));
  for (const word of words)
    assert.equal(
      source.slice(word.offset, word.offset + word.length),
      word.word,
    );
});

test("spelling excludes URLs, inline code, Javadoc references and technical tokens", () => {
  const source =
    "// See https://example.test/speling `wrng` SOME_CONSTANT camelCase char_map foo123\r\n/** {@link Wronggg} <code>normal</code> @return don’t stop */\n// ```\n// speling\n// ```\n/* unfinished commment";
  const words = commentWords(source).map((word) => word.word);
  assert.ok(
    !words.some((word) =>
      [
        "speling",
        "wrng",
        "Wronggg",
        "camelCase",
        "char_map",
        "foo123",
        "return",
        "example",
        "test",
      ].includes(word),
    ),
  );
  assert.ok(words.includes("don’t"));
  assert.ok(words.includes("commment"));
});

test("bundled English dictionary offers corrections without changing technical vocabulary", async () => {
  const [aff, dic] = await Promise.all(
    ["aff", "dic"].map((ext) =>
      readFile(`node_modules/dictionary-en/index.${ext}`, "utf8"),
    ),
  );
  const spell = nspell({ aff, dic });
  for (const word of codingVocabulary) spell.add(word);
  assert.equal(spell.correct("speling"), false);
  assert.ok(spell.suggest("speling").includes("spelling"));
  assert.equal(spell.correct("memoization"), true);
  assert.equal(spell.correct("runtime"), true);
});
