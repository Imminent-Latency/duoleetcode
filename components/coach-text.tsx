import type { ResearchSource } from "@/lib/research-types";
import { citationUrl } from "./research-sources";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useId } from "react";

export default function CoachText({
  children,
  prompt = false,
  sources = [],
}: {
  children: string;
  prompt?: boolean;
  sources?: ResearchSource[];
}) {
  const footnotePrefix = `coach-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  // Older questions were stored as one paragraph. Preserve their wording while
  // separating sentences; new prompts already contain authored Markdown.
  const text =
    prompt && !/[\n`*#]/.test(children)
      ? children.replace(/([.!?])\s+(?=[A-Z])/g, "$1\n\n")
      : children;
  return (
    <div className="coach-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        skipHtml
        disallowedElements={["img"]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div
              className="coach-table-scroll"
              role="region"
              aria-label="Explanation table"
              tabIndex={0}
            >
              <table {...props} />
            </div>
          ),
          h2: ({ node: _node, id, ...props }) => (
            <h2
              {...props}
              id={
                id === "footnote-label" ? `${footnotePrefix}footnote-label` : id
              }
            />
          ),
          a: ({ node: _node, children: label, href, ...props }) => {
            if (href?.startsWith(`#${footnotePrefix}fn`))
              return (
                <a
                  {...props}
                  href={href}
                  aria-describedby={
                    props["aria-describedby"] === "footnote-label"
                      ? `${footnotePrefix}footnote-label`
                      : props["aria-describedby"]
                  }
                >
                  {label}
                </a>
              );
            const url = href ? citationUrl(href) : undefined;
            return url && sources.some((s) => citationUrl(s.url) === url) ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
