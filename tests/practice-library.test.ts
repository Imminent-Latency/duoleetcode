import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AttemptStore } from "../lib/store";
import {
  bootstrapLegacy,
  dailyBackup,
  latestBackup,
  manualBackup,
  practiceFile,
  sandboxFile,
  snapshot,
} from "../lib/practice-storage.mjs";
import { demoProblem } from "../lib/demo";
import {
  GET as libraryGet,
  POST as libraryPost,
} from "../app/api/library/route";
import { GET as stateGet, POST as statePost } from "../app/api/state/route";
import { GET as attemptGet } from "../app/api/attempts/[id]/route";

test("legacy WAL records migrate into isolated libraries, with recoverable replay and coaching", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "duo-library-"));
  const old = { ...process.env };
  const change = (name: string, value?: string) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  change("DUO_DATA_DIR", home);
  change("DUO_DATABASE");
  change("DUO_BACKUP_DIR");
  change("DUO_MODE");
  const file = path.join(home, "legacy.sqlite");
  const legacy = new AttemptStore(file);
  const now = Date.now();
  const a = legacy.create(
    { ...demoProblem, titleSlug: "real-one" },
    60_000,
    false,
    now,
  );
  legacy.append(a.id, [{ seq: 1, at: now + 1, type: "focus" }]);
  const saved = legacy.get(a.id);
  saved.reflection = {
    messages: [
      {
        id: "saved-coach-message",
        role: "assistant",
        text: "Look at the first loop.",
        createdAt: now + 2,
      },
    ],
  };
  legacy.save(saved);
  const demo = legacy.create(demoProblem, 60_000, true, now);
  const existing = new AttemptStore(sandboxFile(), true);
  const another = existing.create(demoProblem, 60_000);
  existing.db.close();
  const url = "http://127.0.0.1:4318";
  const req = (pathname: string, body?: unknown) =>
    new Request(url + pathname, {
      method: body === undefined ? "GET" : "POST",
      headers: { host: "127.0.0.1:4318", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    await bootstrapLegacy(file);
    await bootstrapLegacy(file);
    assert.deepEqual(
      legacy
        .list()
        .map((x) => x.id)
        .sort(),
      [a.id, demo.id].sort(),
    );
    const practice = new AttemptStore(practiceFile());
    const testDb = new AttemptStore(sandboxFile(), true);
    try {
      assert.deepEqual(
        practice.list().map((x) => x.id),
        [a.id],
      );
      assert.deepEqual(
        testDb
          .list()
          .map((x) => x.id)
          .sort(),
        [demo.id, another.id].sort(),
      );
      assert.equal(practice.get(a.id).events.length, 1);
      assert.equal(testDb.imported().length, 0);
      assert.equal(testDb.memory.list().length, 0);
      assert.equal(testDb.memory.search().length, 0);
      const daily = await dailyBackup(new Date("2026-11-10T12:00:00Z"));
      assert.ok(daily);
      assert.equal(await dailyBackup(new Date("2026-11-10T22:00:00Z")), daily);
      const manual = await manualBackup();
      assert.ok(latestBackup());
      const restoredFile = path.join(home, "restored.sqlite");
      await snapshot(manual, restoredFile);
      await assert.rejects(snapshot(manual, restoredFile), /EEXIST/);
      const restored = new AttemptStore(restoredFile);
      try {
        assert.deepEqual(restored.get(a.id), practice.get(a.id));
        assert.equal(restored.has(demo.id), false);
      } finally {
        restored.db.close();
      }

      writeFileSync(
        path.join(home, "pages-import-preview.json"),
        JSON.stringify({ rows: [{ key: "preview-record" }] }),
      );
      const preview = await libraryGet(req("/api/library?kind=preview"));
      assert.equal(
        (await preview.json()).preview.rows[0].key,
        "preview-record",
      );
      assert.equal(
        (await libraryPost(req("/api/library", { action: "import" }))).status,
        400,
      );
      const exported = await libraryGet(req("/api/library?kind=export"));
      const data = await exported.json();
      assert.deepEqual(
        data.attempts.map((item: { id: string }) => item.id),
        [a.id],
      );
      assert.equal(
        data.attempts[0].reflection.messages[0].id,
        "saved-coach-message",
      );
      assert.equal(
        data.importedEvidence.some(
          (e: { id: string }) => e.id === "preview-record",
        ),
        false,
      );

      change("DUO_MODE", "test");
      const sandboxState = await (await stateGet(req("/api/state"))).json();
      assert.equal(sandboxState.sandboxMode, true);
      assert.equal(
        sandboxState.attempts.some((x: { id: string }) => x.id === a.id),
        false,
      );
      assert.equal(
        (
          await attemptGet(req("/api/attempts/" + a.id), {
            params: Promise.resolve({ id: a.id }),
          })
        ).status,
        400,
      );
      assert.equal(
        (await libraryGet(req("/api/library?kind=export"))).status,
        400,
      );
      assert.equal(
        (await libraryGet(req("/api/library?kind=preview"))).status,
        400,
      );
      assert.equal(
        (await libraryPost(req("/api/library", { action: "backup" }))).status,
        400,
      );
      testDb.transition(another.id, "finish");
      testDb.transition(demo.id, "finish");
      const created = await statePost(
        req("/api/state", {
          problem: { ...demoProblem, titleSlug: "test-another" },
          budgetMs: 60000,
        }),
      );
      const createdBody = await created.json();
      assert.equal(created.status, 200, JSON.stringify(createdBody));
      assert.equal(createdBody.attempt.demonstration, true);
      assert.equal(practice.has(createdBody.attempt.id), false);
      assert.equal(testDb.has(createdBody.attempt.id), true);
    } finally {
      practice.db.close();
      testDb.db.close();
    }
  } finally {
    legacy.db.close();
    for (const key of [
      "DUO_DATA_DIR",
      "DUO_DATABASE",
      "DUO_BACKUP_DIR",
      "DUO_MODE",
    ])
      change(key, old[key]);
    rmSync(home, { recursive: true, force: true });
  }
});
