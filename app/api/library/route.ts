import { readFileSync } from "node:fs";
import path from "node:path";
import { database } from "@/lib/store";
import {
  latestBackup,
  manualBackup,
  practiceHome,
  sandboxMode,
} from "@/lib/practice-storage.mjs";
import { failure, json, localRequest } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    if (sandboxMode())
      throw new Error("Practice library is unavailable in test mode.");
    const kind = new URL(req.url).searchParams.get("kind");
    if (kind === "export") {
      return new Response(JSON.stringify(database().exportLibrary(), null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="duoleetcode-practice.json"',
          "Cache-Control": "no-store",
        },
      });
    }
    if (kind === "preview") {
      const file = path.join(practiceHome(), "pages-import-preview.json");
      try {
        return json({ preview: JSON.parse(readFileSync(file, "utf8")) });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return json({ preview: null });
        throw error;
      }
    }
    return json({ backup: latestBackup() });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    if (sandboxMode())
      throw new Error("Practice backups are unavailable in test mode.");
    const body = await req.json();
    if (body?.action !== "backup") throw new Error("Unknown library action.");
    database(); // Ensure the database exists, even before the first practice attempt.
    await manualBackup();
    return json({ backup: latestBackup() });
  } catch (error) {
    return failure(error);
  }
}
