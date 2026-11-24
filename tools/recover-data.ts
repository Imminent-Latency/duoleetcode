import { existsSync, readFileSync, rmSync } from "node:fs";
import { AttemptStore } from "../lib/store";
import { practiceFile, sandboxFile } from "../lib/practice-storage.mjs";
import {
  operationJournal,
  writeExtras,
  advanceGeneration,
} from "../lib/data-environment";
import { parseSnapshot, replaceLibrary } from "../lib/snapshots";
const journal = operationJournal();
if (existsSync(journal)) {
  const before = parseSnapshot(JSON.parse(readFileSync(journal, "utf8")));
  const practice = new AttemptStore(practiceFile()),
    sandbox = new AttemptStore(sandboxFile(), true);
  try {
    practice.transaction(() => replaceLibrary(practice, before.practice));
    sandbox.transaction(() => replaceLibrary(sandbox, before.sandbox));
    writeExtras(before);
    advanceGeneration();
    rmSync(journal);
    console.log(
      "Recovered the previous library after an interrupted data operation.",
    );
  } finally {
    practice.db.close();
    sandbox.db.close();
  }
}
