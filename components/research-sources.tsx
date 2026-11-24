"use client";
import type { ResearchBundle, ResearchSource } from "@/lib/research-types";
export function citationUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return;
    if (
      u.hostname === "docs.oracle.com" ||
      u.hostname === "dev.java" ||
      u.hostname === "openjdk.org" ||
      u.hostname === "www.openjdk.org" ||
      u.hostname === "stackoverflow.com" ||
      (u.hostname === "github.com" && u.pathname.startsWith("/openjdk/"))
    )
      return u.href;
  } catch {}
}
function Source({ source }: { source: ResearchSource }) {
  const url = citationUrl(source.url);
  return (
    <div className="research-source">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {source.title}
        </a>
      ) : (
        <span>{source.title}</span>
      )}
      <small>
        {source.version} ·{" "}
        {source.kind === "secondary"
          ? "Secondary community source"
          : source.kind === "official-source"
            ? "Official implementation"
            : "Official documentation"}
      </small>
      <details>
        <summary>Retrieved excerpt</summary>
        <pre>{source.excerpt}</pre>
        <small>Retrieved {new Date(source.retrievedAt).toLocaleString()}</small>
      </details>
    </div>
  );
}
export default function ResearchSources({
  research,
}: {
  research?: ResearchBundle;
}) {
  if (!research) return null;
  const traceLink = research.traceId ? (
    <a
      className="agent-trace-link"
      href={`/?trace=${research.traceId}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      Inspect agent run
    </a>
  ) : null;
  if (!research.sources.length && !research.claims.length) return traceLink;
  const used = new Set(research.claims.flatMap((c) => c.sourceIds));
  return (
    <>
      <details className="research-sources" aria-label="Sources for this reply">
        <summary>
          Sources &amp; assumptions
          {research.sources.length ? ` · ${research.sources.length}` : ""}
        </summary>
        {research.claims.map((c, i) => (
          <div className="research-claim" key={i}>
            <p>{c.claim}</p>
            <small>
              {c.basis === "documented"
                ? "Documented behavior"
                : c.basis === "implementation-derived"
                  ? "Derived from versioned implementation"
                  : "Not verified"}
            </small>
            {research.sources
              .filter((s) => c.sourceIds.includes(s.id))
              .map((s) => (
                <Source key={s.id} source={s} />
              ))}
          </div>
        ))}
        {research.sources.some((s) => !used.has(s.id)) && (
          <details>
            <summary>Other references consulted</summary>
            {research.sources
              .filter((s) => !used.has(s.id))
              .map((s) => (
                <Source key={s.id} source={s} />
              ))}
          </details>
        )}
      </details>
      {traceLink}
    </>
  );
}
