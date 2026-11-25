import { readAgentSettings } from "./agent-settings-store";
import { traces, redact, traceHash, type TraceStore } from "./agent-traces";
import { store, database } from "./store";
import { prescriptionSchema } from "./prescription-types";
import { replay } from "./recording";
import { validateEditorContext } from "./editor-context";
import type { Attempt } from "./types";
import {
  reviewFlagInputSchema,
  type AttemptReviewFlag,
  type ReviewFlag,
  type ReviewFlagSummary,
} from "./review-flag-types";

export class ReviewFlags {
  constructor(readonly log: TraceStore = traces()) {
    log.db.exec(`CREATE TABLE IF NOT EXISTS review_flags (
      id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, status TEXT NOT NULL,
      requestHash TEXT NOT NULL, summary TEXT NOT NULL, bundle TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS review_flags_created ON review_flags(createdAt DESC);`);
  }
  get(id: string): ReviewFlag {
    const row = this.log.db
      .prepare("SELECT status,summary,bundle FROM review_flags WHERE id=?")
      .get(id);
    if (!row) throw new Error("Review flag not found.");
    return {
      ...JSON.parse(String(row.summary)),
      status: row.status,
      bundle: JSON.parse(String(row.bundle)),
    };
  }
  list(status?: "open" | "resolved", offset = 0) {
    const args = status ? [status] : [];
    const where = status ? "WHERE status=?" : "";
    return {
      flags: this.log.db
        .prepare(
          `SELECT status,summary FROM review_flags ${where} ORDER BY createdAt DESC,rowid DESC LIMIT 50 OFFSET ?`,
        )
        .all(...args, offset)
        .map((r) => ({
          ...JSON.parse(String(r.summary)),
          status: r.status,
        })) as ReviewFlagSummary[],
      total: Number(
        this.log.db
          .prepare(`SELECT COUNT(*) n FROM review_flags ${where}`)
          .get(...args)!.n,
      ),
    };
  }
  forAttempt(attemptId: string): AttemptReviewFlag[] {
    const parseJson = <T>(raw: unknown): T | null => {
      if (typeof raw !== "string" || !raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    };
    return this.log.db
      .prepare(
        `SELECT
          status,
          summary,
          json_extract(bundle, '$.target.messageId') AS messageId,
          json_extract(bundle, '$.target.createdAt') AS evaluationCreatedAt,
          COALESCE(
            json_extract(bundle, '$.target.traceId'),
            json_extract(bundle, '$.context.selectedItem.research.traceId'),
            json_extract(bundle, '$.context.run.id')
          ) AS traceId,
          json_extract(bundle, '$.context.focus') AS focusJson,
          json_extract(bundle, '$.context.editor') AS editorJson
        FROM review_flags
        WHERE json_extract(summary, '$.attemptId') = ?
        ORDER BY createdAt ASC, rowid ASC`,
      )
      .all(attemptId)
      .map((r) => ({
        ...(JSON.parse(String(r.summary)) as ReviewFlagSummary),
        status: r.status as "open" | "resolved",
        ...(typeof r.messageId === "string" ? { messageId: r.messageId } : {}),
        ...(typeof r.evaluationCreatedAt === "number"
          ? { evaluationCreatedAt: r.evaluationCreatedAt }
          : {}),
        ...(typeof r.traceId === "string" ? { traceId: r.traceId } : {}),
        focus: parseJson(r.focusJson),
        editor: parseJson(r.editorJson),
      }));
  }
  setStatus(id: string, status: "open" | "resolved") {
    this.get(id);
    this.log.db
      .prepare("UPDATE review_flags SET status=? WHERE id=?")
      .run(status, id);
    return this.get(id);
  }
  create(
    raw: unknown,
    deps: {
      attempt?: (id: string) => Attempt;
      prescription?: (id: string) => unknown;
      settings?: () => unknown;
      mode?: (id?: string) => "practice" | "test";
    } = {},
  ) {
    const input = reviewFlagInputSchema.parse(raw);
    const hash = traceHash(input);
    const previous = this.log.db
      .prepare("SELECT requestHash FROM review_flags WHERE id=?")
      .get(input.id);
    if (previous) {
      if (previous.requestHash !== hash)
        throw new Error(
          "This flag was already saved with different content. Start a new flag.",
        );
      return this.get(input.id);
    }
    const target = input.target;
    const at = Date.now();
    let context: unknown,
      title = "Agent run",
      traceId: string | undefined,
      attemptId: string | undefined;
    let mode: "practice" | "test" =
      deps.mode?.() ?? (database().memory.sandbox ? "test" : "practice");
    if (target.kind === "prescription") {
      const p = prescriptionSchema.parse(
        deps.prescription
          ? deps.prescription(target.prescriptionId)
          : prescription(target.prescriptionId),
      );
      context = { prescription: p };
      title = p.title;
      traceId = p.traceId;
    } else if (target.kind === "agent-run") {
      const detail = this.log.detail(target.traceId);
      traceId = target.traceId;
      mode = detail.run.mode;
      attemptId = detail.run.attemptId ?? undefined;
      title = detail.run.role;
      context = { run: detail.run };
    } else {
      attemptId = target.attemptId;
      const a = structuredClone(
        deps.attempt
          ? deps.attempt(attemptId)
          : store(attemptId).get(attemptId),
      );
      mode =
        deps.mode?.(attemptId) ??
        (a.demonstration || store(attemptId).memory.sandbox
          ? "test"
          : "practice");
      title = a.problem.title;
      // Match only the requested saved reply; never substitute a later reply.
      let item: any;
      if (target.kind === "reflection")
        item = a.reflection?.messages.find(
          (m) => m.id === target.messageId && m.role === "assistant",
        );
      if (target.kind === "coaching")
        item =
          target.messageId === "legacy-feedback" && a.followup?.feedback
            ? { text: a.followup.feedback, research: a.followup.research }
            : a.followup?.messages?.find(
                (m) => m.id === target.messageId && m.role === "assistant",
              );
      if (target.kind === "java-help")
        item = a.javaHelp?.find(
          (h) => h.id === target.messageId && h.deliveredAt,
        );
      if (target.kind === "evaluation")
        item = a.evaluations.find((e) => e.createdAt === target.createdAt);
      if (target.kind !== "editor" && !item)
        throw new Error(
          "That saved reply is no longer available. Flag the current editor instead.",
        );
      traceId = item?.research?.traceId;
      let visibleSource = a.source;
      if (target.kind === "editor") {
        // Editor flags may capture unsaved live text. Validate coordinates against
        // that captured text and label it separately from acknowledged recording.
        const draft = {
          ...a,
          followup: {
            answer: "",
            answeredAt: 0,
            ...a.followup,
            coachedCode: target.source,
          },
        };
        validateEditorContext(draft, {
          ...target.editor,
          source: "coached",
          seq: undefined,
        });
        if (target.editor.seq !== undefined) {
          if (
            target.editor.source !== "recording" ||
            (target.editor.seq !== 0 &&
              !a.events.some((e) => e.seq === target.editor.seq))
          )
            throw new Error("The selected replay event is unavailable.");
          if (replay(a, target.editor.seq) !== target.source)
            throw new Error("The captured replay does not match that event.");
        }
        visibleSource = target.source;
        traceId = this.log.db
          .prepare(
            "SELECT id FROM agent_runs WHERE attemptId=? AND kind='workflow' ORDER BY startedAt DESC,rowid DESC LIMIT 1",
          )
          .get(attemptId)?.id as string | undefined;
      } else if (item?.focus) {
        visibleSource = replay(a, item.focus.pauseSeq ?? item.focus.endSeq);
      }
      a.javaHelp = a.javaHelp?.map((h) =>
        h.deliveredAt
          ? h
          : {
              ...h,
              answer: undefined,
              research: undefined,
              sources: undefined,
            },
      );
      context = {
        attempt: a,
        selectedItem: item,
        visibleSource,
        sourceHash: traceHash(visibleSource),
        sourceOrigin:
          target.kind === "editor" && target.editor.seq === undefined
            ? "editor snapshot (may contain unsaved changes)"
            : "saved attempt",
        editor: target.kind === "editor" ? target.editor : item?.editor,
        focus: item?.focus,
      };
    }
    let captured: unknown = null,
      traceState: ReviewFlagSummary["traceState"] = "none",
      traceCount = 0;
    let traceNote =
      "No trace was attached to this item. Older replies may predate tracing.";
    if (traceId) {
      try {
        const data = this.log.export(traceId);
        captured = data;
        traceCount = data.runs.length;
        traceState = "captured";
        traceNote = data.runs.some((r) => r.status === "running")
          ? "Captured while a run was active; later events are not part of this copy."
          : "Independent copy of the available run family. Diagnostic retention and clear actions do not remove it.";
      } catch {
        traceState = "unavailable";
        traceNote =
          "The linked trace was unavailable at capture (it may have expired or been cleared). The saved item is preserved.";
      }
    }
    if (target.kind === "editor" && traceState === "captured")
      traceNote +=
        " This is the latest agent run for the attempt; it may not be related to the editor issue.";
    let settingsAtCapture: unknown;
    try {
      settingsAtCapture = (deps.settings ?? readAgentSettings)();
    } catch {
      settingsAtCapture = { unavailable: true };
    }
    const summary: ReviewFlagSummary = {
      id: input.id,
      createdAt: at,
      status: "open",
      category: input.category,
      note: input.note,
      title,
      kind: target.kind,
      mode,
      attemptId,
      traceState,
      traceCount,
    };
    const bundle: ReviewFlag["bundle"] = {
      format: "duoleetcode-review-flag",
      version: 1,
      capturedAt: at,
      target,
      context,
      settingsAtCapture,
      traces: captured,
      traceNote,
    };
    const encoded = JSON.stringify(redact(bundle));
    if (Buffer.byteLength(encoded) > 64 * 1024 * 1024)
      throw new Error(
        "This review bundle exceeds 64 MB. Flag a smaller context or export the attempt separately.",
      );
    // One insert makes retries idempotent without changing the original capture.
    this.log.db
      .prepare("INSERT INTO review_flags VALUES(?,?,'open',?,?,?)")
      .run(input.id, at, hash, JSON.stringify(redact(summary)), encoded);
    return this.get(input.id);
  }
}
function prescription(id: string) {
  const row = database()
    .db.prepare(
      "SELECT data FROM memory_uses WHERE json_extract(data,'$.prescription.id')=? ORDER BY at DESC LIMIT 1",
    )
    .get(id);
  if (!row) throw new Error("That recommendation is no longer available.");
  return JSON.parse(String(row.data)).prescription;
}
