"use client";
import DOMPurify from "dompurify";
import { useMemo } from "react";

export function formatProblem(html: string) {
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "video", "audio", "iframe", "style", "form"],
    FORBID_ATTR: ["style"],
  });
  const doc = new DOMParser().parseFromString(safe, "text/html");
  for (const p of doc.body.querySelectorAll("p")) {
    if (!p.textContent?.replace(/\u00a0/g, " ").trim() && !p.children.length)
      p.remove();
  }
  // Group both LeetCode example-block markup and older flat p/pre examples.
  let card: HTMLElement | undefined;
  const result = doc.createElement("div");
  for (const node of Array.from(doc.body.childNodes)) {
    const text = node.textContent?.trim() ?? "";
    if (node instanceof HTMLElement && /^(?:Example\s*\d*\s*:?)$/.test(text)) {
      card = doc.createElement("section");
      card.className = "problem-example";
      const title = doc.createElement("h4");
      title.textContent = text.replace(/:$/, "");
      card.append(title);
      result.append(card);
    } else {
      if (/^(?:Constraints|Follow[ -]up)\s*:/i.test(text)) card = undefined;
      (card ?? result).append(node);
    }
  }
  return result.innerHTML;
}
export default function ProblemDescription({ content }: { content: string }) {
  const html = useMemo(
    () => (typeof window === "undefined" ? "" : formatProblem(content)),
    [content],
  );
  return (
    <div
      className="problem-description"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
