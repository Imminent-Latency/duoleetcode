import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CoachText from "../components/coach-text";

test("coach formatting renders code and steps without executing model-supplied HTML or loading images", () => {
  const html = renderToStaticMarkup(
    createElement(CoachText, {
      children:
        "### Question\n\nExplain `seen.add(i)`.\n\n1. Consider the first element.\n2. Consider a duplicate.\n\n```java\nif (!seen.add(i)) return true;\n```\n\n<script>alert('x')</script>\n\n![tracking](https://example.com/pixel)\n\n[unsafe](javascript:alert(1))",
    }),
  );
  assert.match(html, /<h3>Question<\/h3>/);
  assert.match(html, /<code>seen.add\(i\)<\/code>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<pre><code class="language-java">/);
  assert.doesNotMatch(html, /<script|<img|javascript:|<a/);
});

test("legacy plain questions retain their wording with separated paragraphs", () => {
  const html = renderToStaticMarkup(
    createElement(CoachText, {
      prompt: true,
      children: "Consider seen.add(i). Explain the result. Trace [7].",
    }),
  );
  assert.equal((html.match(/<p>/g) ?? []).length, 3);
  assert.match(html, /Consider seen.add\(i\)./);
});

test("the recorded stock explanation renders as a table with aligned numeric cells and emphasis", () => {
  const html = renderToStaticMarkup(
    createElement(CoachText, {
      children: `Start with best profit \`0\`.

| Selling day | Price | Cheapest earlier price | Profit if sold today | Best profit so far |
|---|---:|---:|---:|---:|
| Day 2 | 8 | 3 | 8 − 3 = 5 | **5** |
| Day 3 | 1 | 3 | 1 − 3 = −2 | **5** |
| Day 4 | 5 | 1 | 5 − 1 = 4 | **5** |

Keep the best profit.`,
    }),
  );
  assert.match(
    html,
    /role="region" aria-label="Explanation table" tabindex="0"/,
  );
  assert.match(html, /<thead>/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 4);
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 5);
  assert.match(html, /style="text-align:right"/);
  assert.match(html, /<strong>5<\/strong>/);
  assert.doesNotMatch(html, /\|---/);
});

test("extended Markdown preserves lists, diagrams and footnotes without enabling unverified links or active content", () => {
  const url =
    "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PriorityQueue.html";
  const html = renderToStaticMarkup(
    createElement(CoachText, {
      children: `~~Earlier claim~~

- [x] Completed step
- [ ] Next step

> Keep the best profit.

\`\`\`text
buy  → [3, 8, 1, 5]
sell →     ^
\`\`\`

See the reference.[^note]

[^note]: ${url}

https://unverified.example/claim

<svg onload="alert(1)"></svg>
![external](https://unverified.example/pixel)`,
      sources: [{ url } as any],
    }),
  );
  assert.match(html, /<del>Earlier claim<\/del>/);
  assert.match(html, /type="checkbox" disabled="" checked=""/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code class="language-text">/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /href="#coach-[^"]+-fn-note"/);
  assert.ok(html.includes(`href="${url}"`));
  assert.doesNotMatch(html, /href="https:\/\/unverified|<svg|onload|<img/);
});

test("footnote links and accessible labels stay within their message when messages reuse footnote names", () => {
  const message = "An explanation.[^1]\n\n[^1]: A local note.";
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(CoachText, { children: message }),
      createElement(CoachText, { children: message }),
    ),
  );
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.equal(targets.length, 4);
  assert.ok(targets.every((id) => ids.includes(id)));
  const labels = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.equal(labels.length, 2);
  assert.ok(labels.every((id) => ids.includes(id)));
});
