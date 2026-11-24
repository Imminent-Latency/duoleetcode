import { openDB } from "idb";
import { isBrowserDataKey } from "./snapshot-types";
export function captureBrowserData(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(localStorage)
      .filter(isBrowserDataKey)
      .map((k) => [k, localStorage.getItem(k)!]),
  );
}
export async function finishDataChange(
  browser: Record<string, string> | null,
  affected: string[],
) {
  if (browser) {
    for (const key of Object.keys(localStorage).filter(isBrowserDataKey))
      localStorage.removeItem(key);
    for (const [key, value] of Object.entries(browser))
      if (isBrowserDataKey(key)) localStorage.setItem(key, value);
  } else
    for (const id of affected)
      localStorage.removeItem("duo-reflection-intake-" + id);
  for (const key of ["duo-open-attempt", "duo-test-open-attempt"])
    if (affected.includes(localStorage.getItem(key) ?? ""))
      localStorage.removeItem(key);
  const db = await openDB("duoleetcode-recovery", 1, {
    upgrade(d) {
      d.createObjectStore("events", { keyPath: ["attemptId", "seq"] });
    },
  });
  try {
    const tx = db.transaction("events", "readwrite");
    for (const row of await tx.store.getAll())
      if (affected.includes(row.attemptId))
        await tx.store.delete([row.attemptId, row.seq]);
    await tx.done;
  } finally {
    db.close();
  }
}
