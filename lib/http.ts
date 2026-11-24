import { existsSync } from "node:fs";
import { dataGeneration, operationJournal } from "./data-environment";
export function localRequest(req: Request) {
  const host = req.headers.get("host");
  const port = process.env.DUO_PORT || "4318";
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
    throw new Error("This app accepts local requests only.");
  const origin = req.headers.get("origin");
  if (origin && origin !== `http://${host}`)
    throw new Error("Cross-origin requests are not allowed.");
  if (
    req.method !== "GET" &&
    !req.headers.get("content-type")?.startsWith("application/json")
  )
    throw new Error("JSON request required.");
  if (existsSync(operationJournal()))
    throw new Error(
      "A data operation needs recovery. Restart the app to restore its previous state.",
    );
  const generation = req.headers.get("x-duo-data-generation");
  if (req.method !== "GET" && generation && generation !== dataGeneration())
    throw new Error(
      "Your library changed in another tab. Reload this page before making changes.",
    );
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Duo-Data-Generation": dataGeneration(),
    },
  });
}
export function failure(error: unknown) {
  return json(
    { error: error instanceof Error ? error.message : "Request failed" },
    400,
  );
}
