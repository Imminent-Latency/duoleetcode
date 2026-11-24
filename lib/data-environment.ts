import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { practiceHome, practiceFile } from "./practice-storage.mjs";
import { readAgentSettings, saveAgentSettings } from "./agent-settings-store";
import type { SnapshotData } from "./snapshot-types";

export const snapshotHome = () =>
  process.env.DUO_DATABASE
    ? path.resolve(practiceFile() + ".snapshots")
    : path.join(practiceHome(), "snapshots");
export const operationJournal = () =>
  path.join(snapshotHome(), ".pending-operation.json");
export const dataGeneration = () => {
  try {
    return readFileSync(path.join(snapshotHome(), ".generation"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "initial";
    throw e;
  }
};
export function advanceGeneration() {
  mkdirSync(snapshotHome(), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(snapshotHome(), ".generation"), randomUUID(), {
    mode: 0o600,
  });
}
export function readExtras() {
  const file = path.join(practiceHome(), "pages-import-preview.json");
  return {
    settings: readAgentSettings(),
    pagesPreview: existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : null,
  };
}
export function writeExtras(s: SnapshotData) {
  if (s.settings) saveAgentSettings(s.settings);
  const file = path.join(practiceHome(), "pages-import-preview.json");
  if (s.pagesPreview === null) rmSync(file, { force: true });
  else {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file + ".tmp", JSON.stringify(s.pagesPreview, null, 2), {
      mode: 0o600,
    });
    renameSync(file + ".tmp", file);
  }
}
