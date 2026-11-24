import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { AttemptStore } from "../lib/store";
import { demoProblem } from "../lib/demo";
import { lowSettings } from "../lib/agent-settings";
import {
  applyProjected,
  assertIdle,
  captureLibrary,
  captureSnapshot,
  canonical,
  parseSnapshot,
  projectOperation,
  readSnapshot,
  replaceLibrary,
  saveSnapshot,
  sealSnapshot,
} from "../lib/snapshots";
import {
  emptySelection,
  selectEverything,
  type DataOperation,
  type SnapshotData,
} from "../lib/snapshot-types";
import { POST, GET } from "../app/api/data/route";
import {
  dataGeneration,
  operationJournal,
  snapshotHome,
} from "../lib/data-environment";
import { readAgentSettings } from "../lib/agent-settings-store";

function fixture(db: AttemptStore, demo = false) {
  const now = Date.now() - 10000;
  const a = db.create(
    { ...demoProblem, titleSlug: demo ? "test-data" : "real-practice" },
    60000,
    demo,
    now,
  );
  db.append(
    a.id,
    [
      {
        seq: 1,
        version: 2,
        at: now + 100,
        type: "edit",
        edits: [
          {
            offset: 0,
            length: a.source.length,
            text: "class Solution { int value = 42; }",
          },
        ],
      },
    ],
    now + 200,
  );
  db.transition(a.id, "finish", now + 500);
  db.transition(a.id, "seal", now + 500);
  const saved = db.get(a.id);
  saved.evaluations.push({
    summary: "Uses constant extra memory.",
    strengths: [
      {
        skill: "Auxiliary space complexity",
        observation: "Explained constant extra memory",
        evidence: [1],
      },
    ],
    gaps: [],
    moments: [],
    exercise: {
      skill: "Space complexity",
      title: "Reason about space",
      prompt: "Explain the memory used.",
    },
    version: "test-policy",
    createdAt: now + 501,
    evidenceThrough: 1,
  });
  saved.reflection = {
    messages: [
      {
        id: "answer",
        role: "user",
        text: "Only one int, so constant extra space.",
        createdAt: now + 502,
      },
    ],
  };
  saved.followup = {
    answer: "O(1)",
    answeredAt: now + 503,
    feedback: "Correct",
    outcome: "independent",
    messages: [],
  };
  saved.learningExit = { reason: "sufficient", at: now + 504 };
  saved.phase = "complete";
  saved.jobs.push({
    id: crypto.randomUUID(),
    kind: "submit",
    state: "done",
    seq: 1,
    createdAt: now + 500,
    source: saved.source,
    summary: { verdict: "Accepted" },
    result: { total_testcases: 80 },
  });
  db.save(saved);
  return saved;
}
function environment() {
  const home = mkdtempSync(path.join(os.tmpdir(), "duo-snapshots-"));
  const practice = new AttemptStore(path.join(home, "practice.sqlite")),
    sandbox = new AttemptStore(path.join(home, "sandbox.sqlite"), true);
  const extras = {
    settings: { ...lowSettings("test-low-model"), preset: "custom" as const },
    browser: { "duo-problem-width": "31" },
    pagesPreview: { rows: [{ title: "Staged only" }] },
  };
  return {
    home,
    practice,
    sandbox,
    extras,
    capture: () => captureSnapshot(practice, sandbox, extras, "Round trip"),
    close() {
      practice.db.close();
      sandbox.db.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
const operation = (
  s: SnapshotData,
  action: "reset" | "restore",
): DataOperation => ({
  action,
  selection: selectEverything(s),
  attemptMode: "whole",
  conflicts: "replace",
});

test("full snapshot reset/restore preserves recordings, coaching, corrections, settings and test separation", () => {
  const e = environment();
  try {
    const a = fixture(e.practice),
      testAttempt = fixture(e.sandbox, true);
    const evidence = e.practice.memory.search({ attemptId: a.id })[0];
    e.practice.memory.correctEvidence(
      evidence.id,
      0,
      "Keep the reasoning, not just the original label.",
      false,
    );
    const pref = e.practice.memory.list()[0];
    e.practice.memory.edit(pref.id, pref.revision, {
      text: "Use one clear example.",
      scope: "coaching",
    });
    e.practice.memory.recordUse({
      role: "coach",
      attemptId: a.id,
      preferences: [{ id: pref.id, revision: pref.revision }],
      evidenceIds: [evidence.id],
    });
    const before = e.capture();
    const legacy = parseSnapshot(e.practice.exportLibrary());
    assert.deepEqual(legacy.practice.attempts, before.practice.attempts);
    assert.equal(legacy.settings, null);
    assert.equal(legacy.sandbox.attempts.length, 0);
    saveSnapshot(e.home, before);
    assert.deepEqual(readSnapshot(e.home, before.id), before);
    const reset = projectOperation(before, before, operation(before, "reset"));
    let extras = e.extras;
    applyProjected(
      e.practice,
      e.sandbox,
      before,
      reset.projected,
      path.join(e.home, "journal.json"),
      (s) => {
        extras = s as any;
      },
    );
    assert.equal(e.practice.list().length, 0);
    assert.equal(e.sandbox.list().length, 0);
    assert.equal(e.practice.memory.list().length, 0);
    assert.equal(e.practice.memory.search().length, 0);
    assert.equal(e.practice.imported().length, 0);
    // Reopening must not resurrect initial profile or historical seeds.
    const reopened = new AttemptStore(path.join(e.home, "practice.sqlite"));
    assert.equal(reopened.memory.list().length, 0);
    assert.equal(reopened.imported().length, 0);
    assert.equal(reopened.memory.search().length, 0);
    reopened.db.close();
    const current = captureSnapshot(
      e.practice,
      e.sandbox,
      { settings: reset.projected.settings, browser: {}, pagesPreview: null },
      "Empty",
    );
    const restore = projectOperation(
      current,
      before,
      operation(before, "restore"),
    );
    applyProjected(
      e.practice,
      e.sandbox,
      current,
      restore.projected,
      path.join(e.home, "journal.json"),
      (s) => {
        extras = s as any;
      },
    );
    assert.deepEqual(e.practice.get(a.id), a);
    assert.deepEqual(e.sandbox.get(testAttempt.id), testAttempt);
    assert.deepEqual(captureLibrary(e.practice), before.practice);
    assert.equal(e.sandbox.memory.search().length, 0);
    assert.deepEqual(extras.settings, before.settings);
    const repeat = projectOperation(
      e.capture(),
      before,
      operation(before, "restore"),
    );
    assert.equal(repeat.preview.changed, false);
  } finally {
    e.close();
  }
});

test("selective coaching reset keeps judged progress and preferences, and new coaching gets distinct evidence identities", () => {
  const e = environment();
  try {
    const a = fixture(e.practice),
      b = fixture(e.practice);
    const before = e.capture(),
      selection = emptySelection();
    selection.practice.attempts = [a.id];
    const op: DataOperation = {
      action: "reset",
      selection,
      attemptMode: "coaching",
      conflicts: "keep",
    };
    const { projected, preview } = projectOperation(before, before, op);
    assert.equal(preview.counts["Practice · sessions"].coachingCleared, 1);
    e.practice.transaction(() =>
      replaceLibrary(e.practice, projected.practice),
    );
    const reset = e.practice.get(a.id);
    assert.equal(reset.reflection, undefined);
    assert.equal(reset.followup, undefined);
    assert.equal(reset.phase, "review");
    assert.deepEqual(reset.events, a.events);
    assert.deepEqual(reset.jobs, a.jobs);
    assert.deepEqual(e.practice.get(b.id), b);
    assert.deepEqual(
      e.practice.memory.list(),
      before.practice.memory.preferences,
    );
    const oldIds = e.practice.memory
      .search({ attemptId: a.id, includeSuperseded: true })
      .map((x) => x.id);
    reset.evaluations.push(a.evaluations[0]);
    e.practice.save(reset);
    const newIds = e.practice.memory
      .search({ attemptId: a.id, includeSuperseded: true })
      .map((x) => x.id);
    assert.ok(newIds.length > oldIds.length);
    assert.ok(oldIds.every((id) => newIds.includes(id)));
  } finally {
    e.close();
  }
});

test("selected evidence can stay without attempts, or stay cleared while attempts remain", () => {
  const e = environment();
  try {
    const a = fixture(e.practice),
      before = e.capture(),
      selection = emptySelection();
    selection.practice.evidence = before.practice.memory.evidence.map(
      (e) => e.id,
    );
    const { projected } = projectOperation(before, before, {
      action: "reset",
      selection,
      attemptMode: "whole",
      conflicts: "keep",
    });
    e.practice.transaction(() =>
      replaceLibrary(e.practice, projected.practice),
    );
    e.practice.save(e.practice.get(a.id));
    assert.equal(
      e.practice.memory.search({ includeSuperseded: true }).length,
      0,
    );
    const op = operation(before, "restore");
    op.selection = emptySelection();
    op.selection.practice.evidence = before.practice.memory.evidence.map(
      (e) => e.id,
    );
    const restored = projectOperation(e.capture(), before, op).projected;
    e.practice.transaction(() => replaceLibrary(e.practice, restored.practice));
    const del = emptySelection();
    del.practice.attempts = [a.id];
    const noAttempts = projectOperation(e.capture(), e.capture(), {
      action: "reset",
      selection: del,
      attemptMode: "whole",
      conflicts: "keep",
    }).projected;
    e.practice.transaction(() =>
      replaceLibrary(e.practice, noAttempts.practice),
    );
    assert.equal(e.practice.list().length, 0);
    assert.ok(e.practice.memory.search({ includeSuperseded: true }).length > 0);
  } finally {
    e.close();
  }
});

test("restore previews enforce explicit conflicts, validation and no duplicate records", () => {
  const e = environment();
  try {
    const a = fixture(e.practice),
      before = e.capture();
    const changed = e.practice.get(a.id);
    changed.followup!.feedback = "Updated feedback";
    e.practice.save(changed);
    const op = operation(before, "restore");
    op.conflicts = "keep";
    const keep = projectOperation(e.capture(), before, op);
    assert.equal(
      keep.projected.practice.attempts[0].followup?.feedback,
      "Updated feedback",
    );
    op.conflicts = "replace";
    assert.equal(
      projectOperation(e.capture(), before, op).projected.practice.attempts[0]
        .followup?.feedback,
      "Correct",
    );
    const corrupt = structuredClone(before);
    corrupt.practice.attempts[0].source += "tampered";
    assert.throws(() => parseSnapshot(corrupt), /checksum/);
    const { sha256, ...tampered } = corrupt;
    assert.throws(() => parseSnapshot(sealSnapshot(tampered)), /recording/);
    const duplicate = structuredClone(before);
    duplicate.practice.attempts.push(duplicate.practice.attempts[0]);
    const { sha256: _, ...dup } = duplicate;
    assert.throws(() => parseSnapshot(sealSnapshot(dup)), /Duplicate/);
    op.selection.practice.attempts.push("missing");
    assert.throws(() => projectOperation(e.capture(), before, op), /Selection/);
  } finally {
    e.close();
  }
});

test("failed cross-library apply rolls both libraries and settings back", () => {
  const e = environment();
  try {
    fixture(e.practice);
    fixture(e.sandbox, true);
    const before = e.capture(),
      after = projectOperation(
        before,
        before,
        operation(before, "reset"),
      ).projected;
    let fail = true;
    let settings = before.settings;
    assert.throws(
      () =>
        applyProjected(
          e.practice,
          e.sandbox,
          before,
          after,
          path.join(e.home, "journal"),
          (s) => {
            if (fail) {
              fail = false;
              throw new Error("disk failed");
            }
            settings = s.settings;
          },
        ),
      /disk failed/,
    );
    assert.deepEqual(captureLibrary(e.practice), before.practice);
    assert.deepEqual(captureLibrary(e.sandbox), before.sandbox);
    assert.deepEqual(settings, before.settings);
    assert.equal(existsSync(path.join(e.home, "journal")), false);
  } finally {
    e.close();
  }
});

test("startup recovery rolls back an interrupted operation before the app opens", () => {
  const e = environment();
  try {
    fixture(e.practice);
    fixture(e.sandbox, true);
    const before = e.capture(),
      after = projectOperation(
        before,
        before,
        operation(before, "reset"),
      ).projected;
    const snapshots = path.join(e.home, "snapshots");
    saveSnapshot(snapshots, before);
    writeFileSync(
      path.join(snapshots, ".pending-operation.json"),
      JSON.stringify(before),
    );
    e.practice.transaction(() => replaceLibrary(e.practice, after.practice));
    const child = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "tools/recover-data.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DUO_DATA_DIR: e.home,
          DUO_DATABASE: "",
          DUO_SETTINGS_FILE: path.join(e.home, "settings.json"),
          DUO_MODE: "practice",
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(captureLibrary(e.practice), before.practice);
    assert.deepEqual(captureLibrary(e.sandbox), before.sandbox);
    assert.equal(
      existsSync(path.join(snapshots, ".pending-operation.json")),
      false,
    );
    assert.deepEqual(
      readAgentSettings(path.join(e.home, "settings.json")),
      before.settings,
    );
  } finally {
    e.close();
  }
});

test("active snapshots are reviewable, restore paused and cannot resend pending judge operations", () => {
  const e = environment();
  try {
    const a = e.practice.create({ ...demoProblem, titleSlug: "active" }, 60000);
    a.jobs.push({
      id: crypto.randomUUID(),
      kind: "submit",
      state: "sending",
      seq: 0,
      createdAt: Date.now(),
      source: a.source,
    });
    e.practice.save(a);
    const before = e.capture();
    assert.throws(() => assertIdle(e.practice, e.sandbox), /Finish/);
    const blank = structuredClone(before);
    blank.practice.attempts = [];
    const restored = projectOperation(
      blank,
      before,
      operation(before, "restore"),
    ).projected.practice.attempts[0];
    assert.equal(restored.phase, "paused");
    assert.equal(restored.jobs[0].state, "unknown");
    assert.equal(restored.source, a.source);
  } finally {
    e.close();
  }
});

test("data API previews, blocks stale apply and stale tabs, preserves recovery snapshots, and isolates tests", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "duo-data-api-")),
    previous = { ...process.env };
  process.env.DUO_DATA_DIR = home;
  process.env.DUO_DATABASE = path.join(home, "practice.sqlite");
  process.env.DUO_SETTINGS_FILE = path.join(home, "settings.json");
  delete process.env.DUO_MODE;
  const req = (body: unknown, generation?: string) =>
    new Request("http://127.0.0.1:4318/api/data", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4318",
        "Content-Type": "application/json",
        ...(generation ? { "X-Duo-Data-Generation": generation } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    const created = await POST(
      req({ action: "snapshot", name: "API snapshot", browser: {} }),
    );
    assert.equal(created.status, 200);
    const { snapshot } = await created.json();
    const op = operation(snapshot, "reset");
    let response = await POST(
      req({ action: "preview", operation: op, browser: {} }),
    );
    assert.equal(response.status, 200);
    const { preview } = await response.json();
    response = await POST(
      req({
        action: "apply",
        operation: op,
        browser: {},
        token: "0".repeat(64),
        confirmation: "APPLY",
      }),
    );
    assert.equal(response.status, 400);
    response = await POST(
      req(
        {
          action: "apply",
          operation: op,
          browser: {},
          token: preview.token,
          confirmation: "APPLY",
        },
        "initial",
      ),
    );
    const applied = await response.json();
    assert.equal(response.status, 200, JSON.stringify(applied));
    assert.ok(applied.reloadRequired);
    assert.ok(applied.recoveryId);
    assert.notEqual(dataGeneration(), "initial");
    assert.equal(existsSync(operationJournal()), false);
    assert.ok(readSnapshot(snapshotHome(), applied.recoveryId));
    response = await POST(
      req({ action: "snapshot", name: "Stale", browser: {} }, "initial"),
    );
    assert.equal(response.status, 400);
    const restore = operation(snapshot, "restore");
    const nextPreview = await (
      await POST(
        req({
          action: "preview",
          operation: restore,
          sourceId: snapshot.id,
          browser: {},
        }),
      )
    ).json();
    response = await POST(
      req({
        action: "apply",
        operation: restore,
        sourceId: snapshot.id,
        browser: {},
        token: nextPreview.preview.token,
        confirmation: "APPLY",
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(readAgentSettings(), snapshot.settings);
    process.env.DUO_MODE = "test";
    response = await GET(
      new Request("http://127.0.0.1:4318/api/data", {
        headers: { host: "127.0.0.1:4318" },
      }),
    );
    assert.equal(response.status, 400);
  } finally {
    process.env = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
