import type { QuestionReview } from "@/lib/question-review";
import CoachText from "./coach-text";
import { citationUrl } from "./research-sources";

export default function QuestionReviewDetails({
  review,
}: {
  review: QuestionReview;
}) {
  return (
    <section
      className="question-review-details"
      aria-label="Question and evidence review"
    >
      <h3>Question and evidence review</h3>
      <p>
        {review.questions.length} questions · Revision {review.revision} ·{" "}
        {review.coverageComplete
          ? "Material evidence covered"
          : "Coverage incomplete"}
      </p>
      <p className="question-review-note">
        These are internal investigation questions, not a checklist for you.
        Findings remain open to correction in the conversation.
      </p>
      {review.limitations.map((s, i) => (
        <p key={i}>{s}</p>
      ))}
      {review.coachNote && (
        <div className="diagnostic-event">
          <strong>Coach selection &amp; insights</strong>
          <p>{review.coachNote}</p>
          <small>
            Asked:{" "}
            {review.turnAskedIds?.length
              ? review.turnAskedIds.join(", ")
              : "none"}
            {" · "}
            Insights used:{" "}
            {review.turnSurfacedIds?.length
              ? review.turnSurfacedIds.join(", ")
              : "none"}
          </small>
        </div>
      )}
      <details className="diagnostic-event">
        <summary>Coverage by topic</summary>
        {review.coverage.map((c) => (
          <div key={c.topic}>
            <strong>{c.topic.replaceAll("-", " ")}</strong>
            <p>{c.rationale}</p>
            <small>
              {c.questionIds.join(", ") || "No further question needed"}
            </small>
          </div>
        ))}
      </details>
      {review.questions.map(
        ({
          question: q,
          candidate,
          verdict: v,
          updatedRevision,
          askedMessageIds,
          surfacedMessageIds,
          analystTraceId,
          judgeTraceId,
        }) => (
          <details key={q.id} className="diagnostic-event">
            <summary>
              <span>{q.question}</span>
              <small>
                {v.disposition.replaceAll("-", " ")}
                {v.coachingRole
                  ? ` · ${v.coachingRole.replaceAll("-", " ")}`
                  : ""}
              </small>
            </summary>
            <p>{q.purpose}</p>
            <small>
              {q.id} · {q.priority} priority · Updated in revision{" "}
              {updatedRevision}
              {askedMessageIds.length || review.turnAskedIds?.includes(q.id)
                ? " · Asked in conversation"
                : ""}
              {surfacedMessageIds?.length ||
              review.turnSurfacedIds?.includes(q.id)
                ? " · Used in coaching"
                : ""}
            </small>
            <h4>Reviewed finding · {v.decision.replaceAll("-", " ")}</h4>
            <p>
              {v.classification.replaceAll("-", " ")}
              {v.missingEvidence && v.missingEvidence !== "none"
                ? ` · missing ${v.missingEvidence} evidence`
                : ""}
            </p>
            <CoachText sources={review.sources}>{v.answer}</CoachText>
            <p>{v.justification}</p>
            {v.uncertainty && (
              <p>
                <strong>Uncertainty: </strong>
                {v.uncertainty}
              </p>
            )}
            {v.alternatives.length > 0 && (
              <ul>
                {v.alternatives.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
            {(["supporting", "conflicting"] as const).map((side) => (
              <details key={side}>
                <summary>
                  {side === "supporting"
                    ? "Supporting evidence"
                    : "Conflicting evidence"}
                </summary>
                <p>
                  Recording events:{" "}
                  {v[side].sequences.join(", ") || "None cited"}
                </p>
                {v[side].learner.map((c, i) => (
                  <blockquote key={i}>
                    {c.quote}
                    <small>Message {c.messageId}</small>
                  </blockquote>
                ))}
                <p>
                  Java assistance:{" "}
                  {v[side].assistanceIds.join(", ") || "None cited"}
                </p>
                {v[side].sourceUrls
                  .filter((url) => citationUrl(url))
                  .map((url) => {
                    const source = review.sources?.find((s) => s.url === url);
                    return (
                      <div key={url}>
                        <p>
                          <a href={url} target="_blank" rel="noreferrer">
                            {source?.title ?? url}
                          </a>
                        </p>
                        {source && (
                          <details>
                            <summary>
                              Retrieved excerpt · {source.version}
                            </summary>
                            <pre>{source.excerpt}</pre>
                            <small>
                              {source.kind} · Retrieved{" "}
                              {new Date(source.retrievedAt).toLocaleString()}
                            </small>
                          </details>
                        )}
                      </div>
                    );
                  })}
              </details>
            ))}
            <details>
              <summary>Original analyst answer (before verification)</summary>
              <CoachText sources={review.sources}>{candidate.answer}</CoachText>
              <p>{candidate.justification}</p>
            </details>
            <p>
              {analystTraceId && (
                <a href={`?trace=${encodeURIComponent(analystTraceId)}`}>
                  Analyst trace
                </a>
              )}
              {analystTraceId && judgeTraceId ? " · " : ""}
              {judgeTraceId && (
                <a href={`?trace=${encodeURIComponent(judgeTraceId)}`}>
                  Judge trace
                </a>
              )}
            </p>
          </details>
        ),
      )}
    </section>
  );
}
