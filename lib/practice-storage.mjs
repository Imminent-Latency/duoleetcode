import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";

export const practiceHome = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.DUO_DATA_DIR ||
      (process.platform === "darwin"
        ? path.join(homedir(), "Library", "Application Support", "DuoLeetCode")
        : path.join(
            process.env.XDG_DATA_HOME ||
              path.join(homedir(), ".local", "share"),
            "duoleetcode",
          )),
  );
export const practiceFile = () =>
  process.env.DUO_DATABASE || path.join(practiceHome(), "practice.sqlite");
export const sandboxFile = () =>
  process.env.DUO_DATABASE === ":memory:"
    ? ":memory:"
    : process.env.DUO_DATABASE && !sandboxMode()
      ? path.resolve(process.env.DUO_DATABASE) + ".sandbox.sqlite"
      : path.join(practiceHome(), "sandbox.sqlite");
export const backupDir = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.DUO_BACKUP_DIR ||
      path.join(practiceHome(), "backups"),
  );
export const sandboxMode = () => process.env.DUO_MODE === "test";
const dir = (file) =>
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

export function checkSnapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (
      db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").get()
    )
      throw new Error("SQLite integrity check failed.");
    db.prepare("SELECT id,data FROM attempts LIMIT 1").get();
    db.prepare("SELECT attempt_id,seq FROM events LIMIT 1").get();
    db.prepare("SELECT attempt_id,seq FROM checkpoints LIMIT 1").get();
  } finally {
    db.close();
  }
}

// Publish only a verified snapshot. Restore and manual snapshots never overwrite.
// The rolling daily snapshot replaces only its previous verified file, atomically.
/** @param {string} source @param {string} destination @param {(copy: DatabaseSync) => void} [transform] @param {boolean} replace */
export async function snapshot(
  source,
  destination,
  transform,
  replace = false,
) {
  if (!replace && existsSync(destination))
    throw Object.assign(new Error("Destination already exists (EEXIST)."), {
      code: "EEXIST",
    });
  dir(destination);
  const temp = path.join(
    path.dirname(destination),
    ".snapshot-" + randomUUID(),
  );
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(temp);
    chmodSync(temp, 0o600);
    if (transform) {
      const copy = new DatabaseSync(temp);
      try {
        copy.exec("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON");
        transform(copy);
      } finally {
        copy.close();
      }
    }
    checkSnapshot(temp);
    if (replace) renameSync(temp, destination);
    else linkSync(temp, destination);
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(temp + suffix, { force: true });
  }
}

export async function bootstrapLegacy(legacy) {
  if (
    process.env.DUO_DATABASE ||
    existsSync(/* turbopackIgnore: true */ practiceFile()) ||
    !existsSync(legacy)
  )
    return;
  const keep = (demo) => (db) => {
    const remove = `SELECT id FROM attempts WHERE COALESCE(json_extract(data,'$.demonstration'),0) ${demo ? "=" : "!="} 0`;
    db.exec(
      `BEGIN; DELETE FROM events WHERE attempt_id IN (${remove}); DELETE FROM checkpoints WHERE attempt_id IN (${remove}); DELETE FROM attempts WHERE id IN (${remove}); ${demo ? "DELETE FROM historical_evidence;" : ""} COMMIT;`,
    );
    if (demo) {
      // A newer legacy snapshot can already contain personal coaching memory.
      // Never carry those derived records or preferences into the sandbox split.
      for (const table of [
        "coaching_memories",
        "coaching_memory_revisions",
        "forgotten_memories",
        "skill_evidence",
        "skill_evidence_search",
        "evidence_corrections",
        "memory_uses",
        "evidence_suppression",
      ]) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))
          db.exec(`DELETE FROM ${table}`);
      }
    }
  };
  // Both splits come from the same consistent snapshot, including committed WAL data.
  const original = path.join(backupDir(), "legacy-before-separation.sqlite");
  if (!existsSync(original)) await snapshot(legacy, original);
  if (!existsSync(sandboxFile()))
    await snapshot(original, sandboxFile(), keep(true));
  else {
    // The user may already have used test mode. Preserve those rows and recover
    // the older demo attempts without replacing the sandbox.
    const sandbox = new DatabaseSync(sandboxFile());
    try {
      sandbox.prepare("ATTACH DATABASE ? AS legacy").run(original);
      sandbox.exec(`BEGIN;
        INSERT OR IGNORE INTO main.attempts SELECT * FROM legacy.attempts WHERE COALESCE(json_extract(data,'$.demonstration'),0) != 0;
        INSERT OR IGNORE INTO main.events SELECT e.* FROM legacy.events e JOIN legacy.attempts a ON a.id=e.attempt_id WHERE COALESCE(json_extract(a.data,'$.demonstration'),0) != 0;
        INSERT OR IGNORE INTO main.checkpoints SELECT e.* FROM legacy.checkpoints e JOIN legacy.attempts a ON a.id=e.attempt_id WHERE COALESCE(json_extract(a.data,'$.demonstration'),0) != 0;
        COMMIT;`);
    } finally {
      sandbox.close();
    }
  }
  await snapshot(original, practiceFile(), keep(false));
}

const backupName =
  /^practice-(?:manual-)?\d{4}-\d{2}-\d{2}(?:-[a-f0-9]{8})?\.sqlite$/;
export function latestBackup() {
  const folder = backupDir();
  if (!existsSync(/* turbopackIgnore: true */ folder)) return null;
  return (
    readdirSync(/* turbopackIgnore: true */ folder)
      .filter((n) => backupName.test(n))
      .map((name) => ({ name, at: statSync(path.join(folder, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0] ?? null
  );
}

export async function dailyBackup(now = new Date()) {
  const source = practiceFile();
  if (!existsSync(/* turbopackIgnore: true */ source)) return null;
  const destination = path.join(
    backupDir(),
    `practice-${now.toISOString().slice(0, 10)}.sqlite`,
  );
  await snapshot(source, destination, undefined, true);
  return destination;
}

export async function manualBackup() {
  const name = `practice-manual-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.sqlite`;
  const destination = path.join(backupDir(), name);
  await snapshot(practiceFile(), destination);
  return destination;
}
