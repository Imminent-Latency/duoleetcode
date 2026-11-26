import type { Problem } from "./types";
// An original exercise for checking the app without a LeetCode account. It is
// never sent to LeetCode and never counted as learner progress.
export const demoProblem: Problem = {
  questionId: "demo",
  questionFrontendId: "LAB",
  title: "First repeated reading",
  titleSlug: "local-repeated-reading",
  difficulty: "Easy",
  content:
    "<p>A sensor produces a list of integer readings. Return the first reading that has already appeared earlier in the list. If all readings are distinct, return <code>-1</code>.</p><h3>Example</h3><pre>readings = [8, 3, 5, 3, 8]\nOutput: 3</pre><p>The repeated <code>3</code> is encountered before the repeated <code>8</code>.</p><h3>Constraints</h3><ul><li>1 ≤ readings.length ≤ 10,000</li><li>0 ≤ readings[i] ≤ 1,000,000</li></ul>",
  javaStarter:
    "import java.util.*;\n\nclass Solution {\n    public int firstRepeated(int[] readings) {\n        \n    }\n}\n",
  cppStarter:
    "class Solution {\npublic:\n    int firstRepeated(vector<int>& readings) {\n        \n    }\n};\n",
  exampleInputs: { raw: "[8,3,5,3,8]" },
  topicTags: [{ name: "Hash table" }],
};
