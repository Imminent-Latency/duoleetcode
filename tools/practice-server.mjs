import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  bootstrapLegacy,
  dailyBackup,
  manualBackup,
  practiceFile,
  sandboxFile,
  snapshot,
} from "../lib/practice-storage.mjs";

const [command, ...args] = process.argv.slice(2);
if (command === "restore") {
  if (args.length !== 2)
    throw new Error("Usage: npm run practice:restore -- SNAPSHOT NEW_DATABASE");
  const [source, target] = args.map((a) => path.resolve(a));
  if (
    [practiceFile(), sandboxFile()].map((f) => path.resolve(f)).includes(target)
  )
    throw new Error(
      "Restore to a new file. Review it before switching databases.",
    );
  await snapshot(source, target);
  console.log("Verified restore:", target);
} else if (command === "backup") {
  console.log("Verified practice backup:", await manualBackup());
} else {
  const testing = command === "test" || process.env.DUO_MODE === "test";
  // Test startup does not open or migrate the personal database.
  if (!testing) {
    const recovery = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "tools/recover-data.ts"],
      { stdio: "inherit" },
    );
    if (recovery.status !== 0)
      throw new Error("Data recovery must finish before the app starts.");
    await bootstrapLegacy(
      path.join(process.cwd(), ".local", "duoleetcode.sqlite"),
    );
    await dailyBackup();
  }
  const next = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      command === "start" ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.DUO_PORT || "4318",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, DUO_MODE: testing ? "test" : "practice" },
    },
  );
  const takeBackup = () => {
    if (!testing)
      void dailyBackup().catch((error) =>
        console.error("Practice backup failed:", error.message),
      );
  };
  const first = setTimeout(takeBackup, 15000);
  const timer = setInterval(takeBackup, 60 * 60 * 1000);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => next.kill(signal));
  next.on("exit", (code, signal) => {
    clearTimeout(first);
    clearInterval(timer);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
