import { z } from "zod";
import { cppLsp } from "@/lib/cpp-lsp";
import { failure, json, localRequest } from "@/lib/http";

export const runtime = "nodejs";

const positionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});

const rangeSchema = z.object({
  start: positionSchema,
  end: positionSchema,
});

const bodySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("prepare") }),
  z.object({ method: z.literal("restart") }),
  z.object({
    method: z.literal("diagnostics"),
    text: z.string().max(200000),
  }),
  z.object({
    method: z.literal("completion"),
    text: z.string().max(200000),
    position: positionSchema,
  }),
  z.object({
    method: z.literal("codeActions"),
    text: z.string().max(200000),
    range: rangeSchema,
    diagnostics: z
      .array(
        z.object({
          range: rangeSchema,
          severity: z.number().optional(),
          code: z.union([z.string(), z.number()]).optional(),
          source: z.string().optional(),
          message: z.string().max(4000),
        }),
      )
      .max(50),
  }),
  z.object({
    method: z.literal("inspect"),
    text: z.string().max(200000),
    position: positionSchema,
  }),
]);

export async function GET(req: Request) {
  try {
    localRequest(req);
    return json({ status: cppLsp().status() });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    localRequest(req);
    const body = bodySchema.parse(await req.json());
    const server = cppLsp();
    if (body.method === "prepare") {
      return json({ status: await server.prepare(), result: true });
    }
    if (body.method === "restart") {
      return json({ status: await server.restart(), result: true });
    }
    if (body.method === "diagnostics") {
      return json({ result: await server.diagnostics(body.text) });
    }
    if (body.method === "completion") {
      return json({
        result: await server.completion(body.text, body.position),
      });
    }
    if (body.method === "codeActions") {
      return json({
        result: await server.codeActions(
          body.text,
          body.range,
          body.diagnostics,
        ),
      });
    }
    if (body.method === "inspect") {
      return json({
        result: await server.inspect(body.text, body.position),
      });
    }
    throw new Error("Unsupported C++26 LSP operation.");
  } catch (e) {
    return failure(e);
  }
}
