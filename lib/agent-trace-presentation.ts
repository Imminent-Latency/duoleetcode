import type { TraceDetail, TraceEvent } from "./agent-trace-types";

type RecordLike = Record<string, any>;

function isObject(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function clip(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function formatDurationMs(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function formatArgPreview(args: unknown): string {
  if (!isObject(args)) return "";
  const entries = Object.entries(args).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (!entries.length) return "";
  const parts = entries.slice(0, 2).map(([k, v]) => {
    if (typeof v === "string") return `${k}=${JSON.stringify(clip(v, 28))}`;
    if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
    if (Array.isArray(v)) return `${k}=[${v.length}]`;
    return `${k}={…}`;
  });
  if (entries.length > 2) parts.push(`+${entries.length - 2}`);
  return parts.join(", ");
}

function summarizeStructuredOutput(value: unknown): string {
  if (!isObject(value)) {
    if (typeof value === "string") return clip(value, 60);
    if (Array.isArray(value)) return `${value.length} items`;
    return "";
  }
  if (typeof value.slug === "string") {
    return [
      `slug=${JSON.stringify(value.slug)}`,
      typeof value.kind === "string" ? value.kind : "",
      typeof value.minutes === "number" ? `${value.minutes}m` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof value.ok === "boolean") {
    const issueCount = Array.isArray(value.issues) ? value.issues.length : 0;
    return value.ok
      ? "ok"
      : `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
  }
  if (typeof value.message === "string") return clip(value.message, 56);
  if (typeof value.answer === "string") return clip(value.answer, 56);
  if (Array.isArray(value.questions))
    return `${value.questions.length} question${value.questions.length === 1 ? "" : "s"}`;
  if (Array.isArray(value.answers))
    return `${value.answers.length} answer${value.answers.length === 1 ? "" : "s"}`;
  const keys = Object.keys(value);
  return keys.length
    ? keys.slice(0, 3).join(", ") +
        (keys.length > 3 ? ` (+${keys.length - 3})` : "")
    : "";
}

function summarizeUsage(tokenUsage: unknown): string {
  if (!isObject(tokenUsage)) return "";
  const u = isObject(tokenUsage.total) ? tokenUsage.total : tokenUsage;
  const total =
    typeof u.totalTokens === "number"
      ? u.totalTokens
      : typeof u.total_tokens === "number"
        ? u.total_tokens
        : undefined;
  const input =
    typeof u.inputTokens === "number"
      ? u.inputTokens
      : typeof u.input_tokens === "number"
        ? u.input_tokens
        : undefined;
  const output =
    typeof u.outputTokens === "number"
      ? u.outputTokens
      : typeof u.output_tokens === "number"
        ? u.output_tokens
        : undefined;
  if (total !== undefined) {
    const breakdown =
      input !== undefined && output !== undefined
        ? ` (${input.toLocaleString()} in · ${output.toLocaleString()} out)`
        : "";
    return `${total.toLocaleString()} tokens${breakdown}`;
  }
  if (typeof u.used === "number" && typeof u.size === "number") {
    return `${u.used.toLocaleString()} / ${u.size.toLocaleString()} context`;
  }
  return "";
}

function unwrapToolResult(rawResult: unknown): {
  success?: boolean;
  output?: unknown;
} {
  if (rawResult === undefined) return {};
  if (typeof rawResult === "string") {
    return { output: tryParseJson(rawResult) ?? rawResult };
  }
  if (!isObject(rawResult)) return { output: rawResult };

  if (Array.isArray(rawResult.contentItems)) {
    const success =
      typeof rawResult.success === "boolean" ? rawResult.success : undefined;
    if (
      rawResult.contentItems.length === 1 &&
      isObject(rawResult.contentItems[0]) &&
      typeof rawResult.contentItems[0].text === "string"
    ) {
      const text = rawResult.contentItems[0].text;
      return {
        ...(success !== undefined ? { success } : {}),
        output: tryParseJson(text) ?? text,
      };
    }
    const items = rawResult.contentItems.map((item: unknown) => {
      if (isObject(item) && typeof item.text === "string") {
        const parsed = tryParseJson(item.text);
        return parsed !== undefined ? { ...item, content: parsed } : item;
      }
      return item;
    });
    return { ...(success !== undefined ? { success } : {}), output: items };
  }

  return { output: rawResult };
}

function unwrapTurnData(data: unknown): unknown {
  if (!isObject(data)) return data;
  const next: RecordLike = { ...data };
  if (typeof next.output === "string") {
    const parsed = tryParseJson(next.output);
    if (parsed !== undefined) next.output = parsed;
  }
  if (isObject(next.turn) && Array.isArray(next.turn.items)) {
    next.turn = {
      ...next.turn,
      items: next.turn.items.map((item: unknown) => {
        if (isObject(item) && typeof item.text === "string") {
          const parsed = tryParseJson(item.text);
          if (parsed !== undefined) {
            const { text: _rawText, ...rest } = item;
            return { ...rest, output: parsed };
          }
        }
        return item;
      }),
    };
  }
  return next;
}

function summarizeEvent(kind: string, data: unknown): string | undefined {
  if (!isObject(data)) return undefined;
  switch (kind) {
    case "run.started":
      return [data.role, data.kind].filter(Boolean).join(" · ") || undefined;
    case "request": {
      const parts: string[] = [];
      if (isObject(data.input)) {
        const keys = Object.keys(data.input);
        if (keys.length) {
          parts.push(
            `input: ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ` (+${keys.length - 3})` : ""}`,
          );
        }
      }
      if (Array.isArray(data.searchDomains) && data.searchDomains.length) {
        parts.push(`${data.searchDomains.length} search domains`);
      }
      return parts.join(" · ") || undefined;
    }
    case "thread.configuration": {
      const toolCount = Array.isArray(data.dynamicTools)
        ? data.dynamicTools.length
        : 0;
      return (
        [
          data.model,
          data.transport ?? data.modelProvider,
          toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    }
    case "turn.input":
      return (
        [
          typeof data.ordinal === "number" ? `Turn ${data.ordinal}` : "",
          typeof data.effort === "string" ? `${data.effort} effort` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    case "turn.started":
      return typeof data.ordinal === "number"
        ? `Turn ${data.ordinal}`
        : undefined;
    case "tool.started": {
      const name = typeof data.tool === "string" ? data.tool : "tool";
      const args = formatArgPreview(data.arguments);
      return `${name}(${args}) · in progress`;
    }
    case "tool.completed": {
      const name = typeof data.tool === "string" ? data.tool : "tool";
      const dur = formatDurationMs(data.durationMs);
      return [name, dur, data.error ? "error" : ""].filter(Boolean).join(" · ");
    }
    case "tool.abandoned": {
      const name = typeof data.tool === "string" ? data.tool : "tool";
      const dur = formatDurationMs(data.durationMs);
      return [name, "abandoned", dur].filter(Boolean).join(" · ");
    }
    case "search.started":
    case "search.completed": {
      const item = isObject(data.item) ? data.item : {};
      const q = item.query ?? item.title ?? item.name;
      return typeof q === "string" ? clip(q, 60) : undefined;
    }
    case "turn.completed": {
      const turn = isObject(data.turn) ? data.turn : {};
      return (
        [
          typeof data.ordinal === "number" ? `Turn ${data.ordinal}` : "",
          typeof turn.status === "string" ? turn.status : "",
          typeof turn.stopReason === "string" ? turn.stopReason : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    }
    case "turn.interrupted":
    case "turn.timeout":
      return (
        [
          typeof data.ordinal === "number" ? `Turn ${data.ordinal}` : "",
          typeof data.reason === "string" ? data.reason : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    case "audit.result": {
      const issueCount = Array.isArray(data.issues) ? data.issues.length : 0;
      return [
        typeof data.pass === "number" ? `Pass ${data.pass}` : "",
        data.ok ? "ok" : `${issueCount} issue${issueCount === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "validation.failed": {
      const issueCount = Array.isArray(data.issues)
        ? data.issues.length
        : undefined;
      return (
        [
          typeof data.stage === "string" ? data.stage : "",
          issueCount !== undefined
            ? `${issueCount} issue${issueCount === 1 ? "" : "s"}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    }
    case "result":
      return summarizeStructuredOutput(data.value) || undefined;
    case "workflow.saved":
      if (
        isObject(data.prescription) &&
        typeof data.prescription.slug === "string"
      ) {
        return `${data.prescription.slug} (${data.prescription.title ?? ""})`.trim();
      }
      return (
        [
          data.action,
          typeof data.attemptId === "string" ? data.attemptId.slice(0, 8) : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    case "workflow.input":
      return (
        [
          data.action,
          Array.isArray(data.skippedSlugs) && data.skippedSlugs.length
            ? `${data.skippedSlugs.length} skipped`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    case "run.finished":
      return (
        [
          typeof data.status === "string" ? data.status : "",
          typeof data.error === "string" ? clip(data.error, 56) : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      );
    default:
      return undefined;
  }
}

const nonMessageBoundary = new Set([
  "message.delta",
  "usage.updated",
  "reasoning.summary.delta",
  "reasoning.summary.completed",
]);

const nonReasoningBoundary = new Set([
  "reasoning.summary.delta",
  "message.delta",
  "usage.updated",
]);

function assembleReasoningSummary(deltas: TraceEvent[]): string[] {
  const byIndex = new Map<number, string>();
  for (const d of deltas) {
    const obj = isObject(d.data) ? d.data : {};
    const idx = typeof obj.summaryIndex === "number" ? obj.summaryIndex : 0;
    const chunk = typeof obj.delta === "string" ? obj.delta : "";
    byIndex.set(idx, (byIndex.get(idx) ?? "") + chunk);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .filter(Boolean);
}

type StreamAttachment = {
  chunks: number;
  firstSeq: number;
  lastSeq: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

/**
 * Post-processes raw trace events into a cleaner presentation structure for the
 * Agent Diagnostics UI without modifying stored database records or exports.
 */
export function presentTraceDetail(detail: TraceDetail): TraceDetail {
  const raw = detail.events;
  if (!raw.length) {
    return { ...detail, rawEventCount: 0, view: "condensed" };
  }

  const consumed = new Set<number>();
  const messageStreams = new Map<number, StreamAttachment>();
  const reasoningStreams = new Map<number, StreamAttachment>();
  const standaloneMessageStreams = new Map<number, TraceEvent>();
  const standaloneReasoningStreams = new Map<number, TraceEvent>();

  // 1. Fold message.delta runs into matching message.completed events, or
  //    collapse unfinished/pre-tool runs into a single message.stream item.
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].kind !== "message.delta" || consumed.has(i)) continue;
    const deltas: { index: number; event: TraceEvent }[] = [
      { index: i, event: raw[i] },
    ];
    let targetCompletedIndex = -1;
    for (let j = i + 1; j < raw.length; j++) {
      const candidate = raw[j];
      if (candidate.kind === "message.delta") {
        deltas.push({ index: j, event: candidate });
        continue;
      }
      if (candidate.kind === "message.completed") {
        targetCompletedIndex = j;
        break;
      }
      if (!nonMessageBoundary.has(candidate.kind)) {
        break;
      }
    }

    const combinedText = deltas
      .map(({ event }) =>
        isObject(event.data) && typeof event.data.text === "string"
          ? event.data.text
          : "",
      )
      .join("");
    const first = deltas[0].event;
    const last = deltas[deltas.length - 1].event;

    const completedEvent =
      targetCompletedIndex >= 0 ? raw[targetCompletedIndex] : undefined;
    const completedText =
      completedEvent &&
      isObject(completedEvent.data) &&
      typeof completedEvent.data.text === "string"
        ? completedEvent.data.text
        : undefined;

    if (
      completedEvent &&
      completedText !== undefined &&
      !messageStreams.has(targetCompletedIndex) &&
      (completedText === combinedText || completedText.includes(combinedText))
    ) {
      for (const d of deltas) consumed.add(d.index);
      messageStreams.set(targetCompletedIndex, {
        chunks: deltas.length,
        firstSeq: first.seq,
        lastSeq: last.seq,
        startedAt: first.at,
        endedAt: completedEvent.at,
        durationMs: Math.max(0, completedEvent.at - first.at),
      });
    } else {
      for (const d of deltas) consumed.add(d.index);
      const firstData = isObject(first.data) ? first.data : {};
      const parsed = tryParseJson(combinedText);
      const contiguous = last.seq - first.seq + 1 === deltas.length;
      const seqLabel =
        deltas.length === 1
          ? String(first.seq)
          : contiguous
            ? `${first.seq}–${last.seq}`
            : `${first.seq}…${last.seq}`;
      standaloneMessageStreams.set(deltas[0].index, {
        seq: first.seq,
        ...(deltas.length > 1 ? { endSeq: last.seq } : {}),
        seqLabel,
        at: first.at,
        endedAt: last.at,
        kind: "message.stream",
        collapsedCount: deltas.length,
        summary: [
          typeof firstData.ordinal === "number"
            ? `Turn ${firstData.ordinal}`
            : "",
          `${deltas.length} message.delta chunk${deltas.length === 1 ? "" : "s"}`,
          `${combinedText.length.toLocaleString()} chars`,
        ]
          .filter(Boolean)
          .join(" · "),
        data: {
          ...(typeof firstData.ordinal === "number"
            ? { ordinal: firstData.ordinal }
            : {}),
          ...(typeof firstData.turnId === "string"
            ? { turnId: firstData.turnId }
            : {}),
          chunks: deltas.length,
          durationMs: Math.max(0, last.at - first.at),
          partial: true,
          ...(parsed !== undefined
            ? { output: parsed }
            : { text: combinedText }),
        },
      });
    }
  }

  // 2. Fold reasoning.summary.delta runs into reasoning.summary.completed, or
  //    collapse unfinished runs into a single reasoning.summary.stream item.
  for (let i = 0; i < raw.length; i++) {
    const startEvent = raw[i];
    if (startEvent.kind !== "reasoning.summary.delta" || consumed.has(i))
      continue;
    const firstItemId = isObject(startEvent.data)
      ? startEvent.data.itemId
      : undefined;
    const deltas: { index: number; event: TraceEvent }[] = [
      { index: i, event: startEvent },
    ];
    let targetCompletedIndex = -1;
    for (let j = i + 1; j < raw.length; j++) {
      const candidate = raw[j];
      if (candidate.kind === "reasoning.summary.delta") {
        const candItemId = isObject(candidate.data)
          ? candidate.data.itemId
          : undefined;
        if (candItemId === firstItemId) {
          deltas.push({ index: j, event: candidate });
          continue;
        }
        break;
      }
      if (candidate.kind === "reasoning.summary.completed") {
        const candItemId = isObject(candidate.data)
          ? candidate.data.itemId
          : undefined;
        if (
          firstItemId === undefined ||
          candItemId === undefined ||
          candItemId === firstItemId
        ) {
          targetCompletedIndex = j;
        }
        break;
      }
      if (!nonReasoningBoundary.has(candidate.kind)) {
        break;
      }
    }

    const first = deltas[0].event;
    const last = deltas[deltas.length - 1].event;
    if (
      targetCompletedIndex >= 0 &&
      !reasoningStreams.has(targetCompletedIndex)
    ) {
      for (const d of deltas) consumed.add(d.index);
      const rc = raw[targetCompletedIndex];
      reasoningStreams.set(targetCompletedIndex, {
        chunks: deltas.length,
        firstSeq: first.seq,
        lastSeq: last.seq,
        startedAt: first.at,
        endedAt: rc.at,
        durationMs: Math.max(0, rc.at - first.at),
      });
    } else {
      for (const d of deltas) consumed.add(d.index);
      const firstData = isObject(first.data) ? first.data : {};
      const summaryItems = assembleReasoningSummary(deltas.map((d) => d.event));
      standaloneReasoningStreams.set(deltas[0].index, {
        seq: first.seq,
        ...(deltas.length > 1 ? { endSeq: last.seq } : {}),
        seqLabel:
          deltas.length === 1 ? String(first.seq) : `${first.seq}–${last.seq}`,
        at: first.at,
        endedAt: last.at,
        kind: "reasoning.summary.stream",
        collapsedCount: deltas.length,
        summary: [
          `${deltas.length} summary chunk${deltas.length === 1 ? "" : "s"}`,
          summaryItems[0] ? clip(summaryItems[0], 48) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        data: {
          ...(typeof firstData.turnId === "string"
            ? { turnId: firstData.turnId }
            : {}),
          ...(typeof firstData.itemId === "string"
            ? { itemId: firstData.itemId }
            : {}),
          chunks: deltas.length,
          summary: summaryItems,
        },
      });
    }
  }

  // 3. Pair tool.started with matching tool.completed / tool.abandoned, and
  //    format message.completed, reasoning.summary.completed, and turn.completed.
  const intermediate: TraceEvent[] = [];
  for (let i = 0; i < raw.length; i++) {
    const streamMsg = standaloneMessageStreams.get(i);
    if (streamMsg) {
      intermediate.push(streamMsg);
      continue;
    }
    const streamReasoning = standaloneReasoningStreams.get(i);
    if (streamReasoning) {
      intermediate.push(streamReasoning);
      continue;
    }
    if (consumed.has(i)) continue;

    const e = raw[i];
    if (e.kind === "tool.started" && isObject(e.data)) {
      const hasCallId = e.data.callId !== undefined && e.data.callId !== null;
      let matchIndex = -1;
      for (let j = i + 1; j < raw.length; j++) {
        if (consumed.has(j)) continue;
        const cand = raw[j];
        if (cand.kind !== "tool.completed" && cand.kind !== "tool.abandoned") {
          continue;
        }
        if (!isObject(cand.data)) continue;
        const sameCall = hasCallId
          ? cand.data.callId === e.data.callId
          : cand.data.tool === e.data.tool;
        if (sameCall) {
          matchIndex = j;
          break;
        }
      }

      if (matchIndex >= 0) {
        consumed.add(matchIndex);
        const end = raw[matchIndex];
        const endData = isObject(end.data) ? end.data : {};
        const toolName =
          typeof e.data.tool === "string"
            ? e.data.tool
            : typeof endData.tool === "string"
              ? endData.tool
              : "tool";
        const abandoned = end.kind === "tool.abandoned";
        const { success, output } = abandoned
          ? { success: undefined, output: undefined }
          : unwrapToolResult(endData.result);
        const durationMs =
          typeof endData.durationMs === "number"
            ? endData.durationMs
            : Math.max(0, end.at - e.at);
        const argPreview = formatArgPreview(e.data.arguments);
        const statusLabel = abandoned
          ? "abandoned"
          : endData.error || success === false
            ? "error"
            : "";
        const contiguous = end.seq === e.seq + 1;
        intermediate.push({
          seq: e.seq,
          endSeq: end.seq,
          seqLabel: contiguous ? `${e.seq}–${end.seq}` : `${e.seq}, ${end.seq}`,
          at: e.at,
          endedAt: end.at,
          kind: "tool.call",
          collapsedCount: 2,
          summary: [
            `${toolName}(${argPreview})`,
            formatDurationMs(durationMs),
            statusLabel,
          ]
            .filter(Boolean)
            .join(" · "),
          data: {
            tool: toolName,
            ...(e.data.callId !== undefined ? { callId: e.data.callId } : {}),
            durationMs,
            ...(success !== undefined ? { success } : {}),
            ...(abandoned ? { abandoned: true } : {}),
            arguments: e.data.arguments,
            ...(output !== undefined ? { output } : {}),
            ...(endData.error !== undefined ? { error: endData.error } : {}),
          },
        });
        continue;
      }
    }

    if (e.kind === "message.completed" && isObject(e.data)) {
      const stream = messageStreams.get(i);
      const parsed = tryParseJson(e.data.text);
      const prevKeptSeq = intermediate.length
        ? (intermediate[intermediate.length - 1].endSeq ??
          intermediate[intermediate.length - 1].seq)
        : 0;
      const canSpanRange = Boolean(stream && stream.firstSeq > prevKeptSeq);
      const seqLabel =
        stream && canSpanRange ? `${stream.firstSeq}–${e.seq}` : String(e.seq);
      const preview =
        parsed !== undefined
          ? summarizeStructuredOutput(parsed)
          : typeof e.data.text === "string"
            ? clip(e.data.text, 56)
            : "";
      intermediate.push({
        seq: stream && canSpanRange ? stream.firstSeq : e.seq,
        ...(stream && canSpanRange ? { endSeq: e.seq } : {}),
        seqLabel,
        at: e.at,
        kind: "message.completed",
        ...(stream ? { collapsedCount: stream.chunks + 1 } : {}),
        summary: [
          typeof e.data.ordinal === "number" ? `Turn ${e.data.ordinal}` : "",
          stream
            ? `folded ${stream.chunks} message.delta${
                !canSpanRange ? ` (#${stream.firstSeq}–${stream.lastSeq})` : ""
              }`
            : "",
          preview,
        ]
          .filter(Boolean)
          .join(" · "),
        data: {
          ...(typeof e.data.ordinal === "number"
            ? { ordinal: e.data.ordinal }
            : {}),
          ...(typeof e.data.turnId === "string"
            ? { turnId: e.data.turnId }
            : {}),
          ...(stream
            ? {
                stream: {
                  chunks: stream.chunks,
                  seqRange: [stream.firstSeq, stream.lastSeq],
                  durationMs: stream.durationMs,
                },
              }
            : {}),
          ...(parsed !== undefined
            ? { output: parsed }
            : { text: e.data.text }),
        },
      });
      continue;
    }

    if (e.kind === "reasoning.summary.completed" && isObject(e.data)) {
      const stream = reasoningStreams.get(i);
      const prevKeptSeq = intermediate.length
        ? (intermediate[intermediate.length - 1].endSeq ??
          intermediate[intermediate.length - 1].seq)
        : 0;
      const canSpanRange = Boolean(stream && stream.firstSeq > prevKeptSeq);
      const summaries = Array.isArray(e.data.summary) ? e.data.summary : [];
      intermediate.push({
        seq: stream && canSpanRange ? stream.firstSeq : e.seq,
        ...(stream && canSpanRange ? { endSeq: e.seq } : {}),
        seqLabel:
          stream && canSpanRange
            ? `${stream.firstSeq}–${e.seq}`
            : String(e.seq),
        at: e.at,
        kind: "reasoning.summary.completed",
        ...(stream ? { collapsedCount: stream.chunks + 1 } : {}),
        summary: [
          stream ? `folded ${stream.chunks} summary.delta` : "",
          typeof summaries[0] === "string" ? clip(summaries[0], 56) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        data: {
          ...e.data,
          ...(stream
            ? {
                stream: {
                  chunks: stream.chunks,
                  seqRange: [stream.firstSeq, stream.lastSeq],
                  durationMs: stream.durationMs,
                },
              }
            : {}),
        },
      });
      continue;
    }

    if (e.kind === "turn.completed") {
      intermediate.push({
        ...e,
        seqLabel: String(e.seq),
        summary: summarizeEvent(e.kind, e.data),
        data: unwrapTurnData(e.data),
      });
      continue;
    }

    intermediate.push({
      ...e,
      seqLabel: String(e.seq),
      summary: summarizeEvent(e.kind, e.data),
    });
  }

  // 4. Coalesce adjacent usage.updated events (common in ACP runtimes).
  const events: TraceEvent[] = [];
  for (let i = 0; i < intermediate.length; i++) {
    const current = intermediate[i];
    if (current.kind !== "usage.updated") {
      events.push(current);
      continue;
    }
    const group = [current];
    while (
      i + 1 < intermediate.length &&
      intermediate[i + 1].kind === "usage.updated"
    ) {
      group.push(intermediate[++i]);
    }
    if (group.length === 1) {
      const usageSummary = isObject(current.data)
        ? summarizeUsage(current.data.tokenUsage)
        : "";
      events.push({
        ...current,
        summary: usageSummary || undefined,
      });
    } else {
      const first = group[0];
      const last = group[group.length - 1];
      const bestSummary =
        [...group]
          .reverse()
          .map((g) =>
            isObject(g.data) ? summarizeUsage(g.data.tokenUsage) : "",
          )
          .find(Boolean) ?? "";
      const contiguous = last.seq - first.seq + 1 === group.length;
      events.push({
        seq: first.seq,
        endSeq: last.seq,
        seqLabel: contiguous
          ? `${first.seq}–${last.seq}`
          : `${first.seq}…${last.seq}`,
        at: last.at,
        kind: "usage.updated",
        collapsedCount: group.length,
        summary: [bestSummary, `${group.length} updates`]
          .filter(Boolean)
          .join(" · "),
        data: {
          ...(isObject(last.data) && typeof last.data.turnId === "string"
            ? { turnId: last.data.turnId }
            : {}),
          latest: isObject(last.data) ? last.data.tokenUsage : last.data,
          updates: group.map((g) => ({
            seq: g.seq,
            tokenUsage: isObject(g.data) ? g.data.tokenUsage : g.data,
          })),
        },
      });
    }
  }

  return {
    ...detail,
    events,
    rawEventCount: raw.length,
    view: "condensed",
  };
}
