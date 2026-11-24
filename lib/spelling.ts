export type SpellingWord = { word: string; offset: number; length: number };

// Only prose in Java comments: strings, text blocks and identifiers are code.
// Keep UTF-16 offsets unchanged so Monaco edits exactly the misspelled word.
export function commentWords(source: string): SpellingWord[] {
  const comments: { text: string; offset: number }[] = [];
  const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
  const code = source.replace(
    /"""[\s\S]*?(?:"""|$)|"(?:\\[\s\S]|[^"\\\r\n])*(?:"|(?=\r|\n|$))|'(?:\\[\s\S]|[^'\\\r\n])*(?:'|(?=\r|\n|$))|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
    (text: string, offset: number) => {
      if (text.startsWith("//") || text.startsWith("/*"))
        comments.push({ text, offset });
      return blank(text);
    },
  );
  const identifiers = new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const words: SpellingWord[] = [];
  let end = 0;
  const commentSource = comments
    .map(({ text, offset }) => {
      const gap = blank(source.slice(end, offset));
      end = offset + text.length;
      return gap + text;
    })
    .join("");
  const prose = commentSource.replace(
    /```[\s\S]*?(?:```|$)|`[^`\r\n]*`|\{@(?:code|link|literal)\s[^}]*\}|https?:\/\/\S+|\b[^\s@]+@[^\s@]+\.[^\s@]+|<\/?[A-Za-z][^>]*>|@[A-Za-z]+/g,
    blank,
  );
  for (const match of prose.matchAll(
    /[A-Za-z_$][A-Za-z0-9_$]*(?:['’][A-Za-z]+)*/g,
  )) {
    const word = match[0];
    if (
      word.length < 3 ||
      word.length > 40 ||
      /[_$0-9]|[a-z][A-Z]|^[A-Z]+$/.test(word) ||
      identifiers.has(word)
    )
      continue;
    words.push({ word, offset: match.index!, length: word.length });
  }
  return words;
}

export const codingVocabulary =
  "leetcode hackerrank javacs int ints boolean hashmap hashmaps hashset hashsets arraylist runtime runtimes comparator comparators iterable iterables memoization memoize deque deques subarray subarrays substring substrings subtree subtrees nums nullptr javadoc bigo".split(
    " ",
  );
