import nspell from "nspell";
import { codingVocabulary, commentWords } from "./spelling";

let dictionary: Promise<ReturnType<typeof nspell>> | undefined;
function loadDictionary() {
  return (dictionary ??= Promise.all(
    ["index.aff", "index.dic"].map(async (file) => {
      const response = await fetch(`/spell/${file}`);
      if (!response.ok) throw new Error("Spelling dictionary could not load");
      return response.text();
    }),
  )
    .then(([aff, dic]) => {
      const spell = nspell({ aff, dic });
      for (const word of codingVocabulary) spell.add(word);
      return spell;
    })
    .catch((error) => {
      dictionary = undefined;
      throw error;
    }));
}

self.onmessage = async ({ data }) => {
  try {
    const spell = await loadDictionary();
    const normalize = (word: string) => word.replaceAll("’", "'");
    const result =
      data.method === "suggest"
        ? spell.suggest(normalize(data.word)).slice(0, 5)
        : commentWords(data.source)
            .filter(
              ({ word }) =>
                !spell.correct(normalize(word)) &&
                !data.ignored.includes(word.toLowerCase()),
            )
            .slice(0, 200);
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
