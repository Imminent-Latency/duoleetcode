import { openDB } from "idb";
import { sameEvent } from "./recording";
import { applyPauseEvent } from "./assessment-time";
import type { Attempt, EvidenceEvent, JudgeJob } from "./types";
let dataGeneration: string | undefined;
export async function api(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(dataGeneration ? { "X-Duo-Data-Generation": dataGeneration } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  const nextGeneration = r.headers.get("X-Duo-Data-Generation");
  if (
    dataGeneration &&
    nextGeneration &&
    nextGeneration !== dataGeneration &&
    !data.reloadRequired
  )
    throw new Error(
      "Your library changed. Reload this page to continue with the current data.",
    );
  if (nextGeneration) dataGeneration = nextGeneration;
  if (!r.ok)
    throw new Error(data.error ?? "The local app could not save this request.");
  return data;
}
export const extensionId = "lodbloofininlhaelhppdkahkfiglmbm";
export function bridge<T = any>(
  op: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chrome = (window as any).chrome;
    if (!chrome?.runtime?.sendMessage) {
      reject(
        new Error(
          "Open this app in the browser where DuoLeetCode Local Bridge is installed.",
        ),
      );
      return;
    }
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "The browser bridge did not respond. Check Connections before retrying.",
          ),
        ),
      45000,
    );
    chrome.runtime.sendMessage(
      extensionId,
      { protocol: 1, op, args },
      (response: any) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          const err = new Error(
            response?.error?.message ??
              response?.error ??
              "The browser bridge rejected the request.",
          ) as Error & { code?: string };
          const code = response?.errorCode ?? response?.error?.code;
          if (typeof code === "string") err.code = code;
          reject(err);
        } else resolve(response.data);
      },
    );
  });
}
const buffer = () =>
  openDB("duoleetcode-recovery", 1, {
    upgrade(db) {
      db.createObjectStore("events", { keyPath: ["attemptId", "seq"] });
    },
  });
export class Recorder {
  attempt: Attempt;
  events: EvidenceEvent[];
  version: number;
  seq: number;
  originTime: number;
  wallTime = Date.now();
  lastTime = 0;
  saved = Promise.resolve();
  syncing?: Promise<void>;
  constructor(
    a: Attempt,
    serverTime: number,
    private onStatus: (s: string) => void,
  ) {
    this.attempt = a;
    this.events = [...a.events];
    this.seq = a.lastSeq;
    this.version = a.version;
    this.originTime = serverTime;
  }
  now() {
    // performance.now() can stop during OS sleep on some browsers. Evidence
    // must share the server's wall-clock basis; solving time is derived later.
    this.lastTime = Math.max(
      this.lastTime,
      this.originTime + Date.now() - this.wallTime,
    );
    return this.lastTime;
  }
  acceptAttempt(attempt: Attempt) {
    this.attempt = { ...attempt, pauses: [...attempt.pauses] };
    for (const e of this.events)
      if (e.seq > attempt.lastSeq) applyPauseEvent(this.attempt, e);
    return this.attempt;
  }
  async recover() {
    const db = await buffer();
    const rows = await db.getAll("events");
    for (const row of rows
      .filter((r) => r.attemptId === this.attempt.id)
      .sort((a, b) => a.seq - b.seq)) {
      const { attemptId, ...e } = row;
      if (e.seq <= this.attempt.lastSeq) {
        if (
          !sameEvent(
            this.attempt.events.find((server) => server.seq === e.seq),
            e as EvidenceEvent,
          )
        )
          throw new Error(
            "The browser recovery buffer conflicts with another saved edit. Keep this tab open; no recovery data has been discarded.",
          );
        await db.delete("events", [attemptId, e.seq]);
        continue;
      }
      if (e.seq > this.seq) {
        this.events.push(e as EvidenceEvent);
        this.seq = e.seq;
        if (e.version) this.version = e.version;
      }
    }
    this.acceptAttempt(this.attempt);
    await this.flush();
  }
  record(data: Omit<EvidenceEvent, "seq" | "at">) {
    const at =
      this.attempt.phase === "paused"
        ? this.now()
        : Math.min(this.now(), this.attempt.deadline);
    const e: EvidenceEvent = {
      ...data,
      seq: ++this.seq,
      at: Math.max(at, this.events.at(-1)?.at ?? this.attempt.createdAt),
    };
    if (e.type === "edit") e.version = ++this.version;
    this.events.push(e);
    this.attempt = { ...this.attempt, pauses: [...this.attempt.pauses] };
    applyPauseEvent(this.attempt, e);
    this.onStatus("Saving locally…");
    this.saved = this.saved
      .then(async () => {
        const db = await buffer();
        await db.put("events", { ...e, attemptId: this.attempt.id });
      })
      .catch((e) => {
        this.onStatus("Recovery storage unavailable — keep this page open");
        throw e;
      });
    return e;
  }
  async flush(): Promise<void> {
    if (this.syncing) {
      await this.syncing;
      return this.flush();
    }
    this.syncing = (async () => {
      await this.saved;
      const pending = this.events.filter((e) => e.seq > this.attempt.lastSeq);
      for (let i = 0; i < pending.length; i += 1000) {
        const batch = pending.slice(i, i + 1000);
        const { attempt } = await api("/api/attempts/" + this.attempt.id, {
          action: "events",
          events: batch,
        });
        this.acceptAttempt(attempt);
        const db = await buffer();
        const tx = db.transaction("events", "readwrite");
        for (const e of batch) await tx.store.delete([attempt.id, e.seq]);
        await tx.done;
      }
      this.onStatus("All changes saved");
    })();
    try {
      await this.syncing;
    } catch (e) {
      this.onStatus("Saved in this browser · retrying connection");
      throw e;
    } finally {
      this.syncing = undefined;
    }
  }
}
export function mergeJob(local: JudgeJob, remote: any): JudgeJob {
  return {
    ...local,
    state: remote.state,
    remoteId: remote.remoteId ?? undefined,
    result: remote.result ?? undefined,
    summary: remote.summary ?? undefined,
    url: remote.url ?? undefined,
    sourceSha256: remote.sourceSha256,
    sourceVerification: remote.sourceVerification ?? undefined,
    error: remote.error ?? undefined,
  };
}
