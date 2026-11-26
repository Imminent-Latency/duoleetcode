import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
};
export type LspTextEdit = { range: LspRange; newText: string };

const LEETCODE_PREAMBLE = `#pragma once
#include <algorithm>
#include <array>
#include <bitset>
#include <cmath>
#include <concepts>
#include <cstdint>
#include <deque>
#include <functional>
#include <initializer_list>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <queue>
#include <ranges>
#include <set>
#include <span>
#include <sstream>
#include <stack>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>
#if __has_include(<expected>)
#include <expected>
#endif
#if __has_include(<flat_map>)
#include <flat_map>
#endif
#if __has_include(<flat_set>)
#include <flat_set>
#endif
#if __has_include(<format>)
#include <format>
#endif
#if __has_include(<generator>)
#include <generator>
#endif
#if __has_include(<mdspan>)
#include <mdspan>
#endif
#if __has_include(<print>)
#include <print>
#endif
#if __has_include(<spanstream>)
#include <spanstream>
#endif
#if __has_include(<stacktrace>)
#include <stacktrace>
#endif
using namespace std;
`;

function stripCommentsFromCpp(source: string): string {
  return source
    .replace(/R"([^()\s\\]{0,16})\([\s\S]*?\)\1"/g, " ")
    .replace(/"(?:\\[\s\S]|[^"\\\r\n])*"/g, " ")
    .replace(/'(?:\\[\s\S]|[^'\\\r\n])*'/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ");
}

/**
 * Extract LeetCode's commented helper types (e.g., struct ListNode, struct TreeNode,
 * class Node, class NestedInteger) so clangd can type-check starters without errors.
 */
export function extractLeetCodeCommentedTypes(source: string): string {
  const nonComment = stripCommentsFromCpp(source);
  const existingTypes = new Set<string>();
  for (const m of nonComment.matchAll(/\b(?:struct|class)\s+([A-Za-z_]\w*)\b/g)) {
    existingTypes.add(m[1]);
  }

  const extracted: string[] = [];
  const seen = new Set<string>();
  for (const block of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const inner = block[0]
      .replace(/^\/\*\*?/, "")
      .replace(/\*\/$/, "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, ""))
      .join("\n");

    const headerRe = /\b(struct|class)\s+([A-Za-z_]\w*)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = headerRe.exec(inner)) !== null) {
      const name = match[2];
      if (existingTypes.has(name) || seen.has(name)) continue;
      let depth = 0;
      let end = -1;
      for (let i = match.index + match[0].length - 1; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const rest = inner.slice(i + 1);
            const semi = /^\s*;/.exec(rest);
            if (semi) end = i + 1 + semi[0].length;
            break;
          }
        }
      }
      if (end > match.index) {
        seen.add(name);
        extracted.push(inner.slice(match.index, end).trim());
        headerRe.lastIndex = end;
      }
    }
  }
  return extracted.length ? extracted.join("\n") + "\n" : "";
}

export function wrapCppForLsp(source: string): { text: string; lineOffset: number } {
  const prefix = extractLeetCodeCommentedTypes(source);
  return {
    text: prefix + source,
    lineOffset: prefix ? prefix.split("\n").length - 1 : 0,
  };
}

export function shiftLspRange(range: LspRange, delta: number): LspRange {
  return {
    start: { line: range.start.line + delta, character: range.start.character },
    end: { line: range.end.line + delta, character: range.end.character },
  };
}

export function shiftLspEdit(edit: LspTextEdit, delta: number): LspTextEdit {
  return { ...edit, range: shiftLspRange(edit.range, delta) };
}

export function findClangdBinary(): string {
  const explicit = process.env.DUO_CLANGD_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of [
    "/opt/homebrew/opt/llvm/bin/clangd",
    "/usr/local/opt/llvm/bin/clangd",
    "/usr/bin/clangd",
  ]) {
    if (existsSync(/* turbopackIgnore: true */ candidate)) return candidate;
  }
  return "clangd";
}

export type CppLspStatus = {
  ready: boolean;
  state: string;
  version?: string;
  binary?: string;
  standard: "c++26";
  detail?: string;
};

type PendingRpc = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CppLspServer {
  private proc?: ChildProcessWithoutNullStreams;
  private tempDir?: string;
  private solutionPath?: string;
  private inspectPath?: string;
  private solutionUri = "";
  private inspectUri = "";
  private startup?: Promise<CppLspStatus>;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;
  private pending = new Map<number, PendingRpc>();
  private readBuffer = Buffer.alloc(0);
  private version = 0;
  private inspectVersion = 0;
  private inspectOpened = false;
  private currentSolutionText?: string;
  private publishedDiagnostics?: { version: number; diagnostics: LspDiagnostic[] };
  private diagWaiter?: {
    uri: string;
    minVersion: number;
    resolve: (diags: LspDiagnostic[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private latestStatus: CppLspStatus = {
    ready: false,
    state: "Not loaded",
    standard: "c++26",
  };
  private cleanupRegistered = false;

  status(): CppLspStatus {
    return { ...this.latestStatus };
  }

  private ensureTempWorkspace() {
    if (this.tempDir && existsSync(this.tempDir)) return;
    this.tempDir = mkdtempSync(path.join(os.tmpdir(), "duoleetcode-clangd-"));
    const preamblePath = path.join(this.tempDir, "leetcode_preamble.hpp");
    this.solutionPath = path.join(this.tempDir, "solution.cpp");
    this.inspectPath = path.join(this.tempDir, "inspect.cpp");
    this.solutionUri = "file://" + this.solutionPath;
    this.inspectUri = "file://" + this.inspectPath;
    writeFileSync(preamblePath, LEETCODE_PREAMBLE, "utf8");
    writeFileSync(
      path.join(this.tempDir, "compile_flags.txt"),
      ["-std=c++26", "-Wall", "-Wextra", "-Wno-unused-parameter", "-include", preamblePath].join(
        "\n",
      ) + "\n",
      "utf8",
    );
    writeFileSync(this.solutionPath, "", "utf8");
    writeFileSync(this.inspectPath, "", "utf8");
    if (!this.cleanupRegistered) {
      this.cleanupRegistered = true;
      process.once("exit", () => {
        this.closeSync();
      });
    }
  }

  private handleStdout(chunk: Buffer) {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    for (;;) {
      const headerEnd = this.readBuffer.indexOf("\r\n\r\n");
      const sepLen = headerEnd >= 0 ? 4 : 2;
      const altEnd = headerEnd >= 0 ? headerEnd : this.readBuffer.indexOf("\n\n");
      if (altEnd < 0) break;
      const headerText = this.readBuffer.subarray(0, altEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        this.readBuffer = this.readBuffer.subarray(altEnd + sepLen);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = altEnd + sepLen;
      if (this.readBuffer.length < bodyStart + length) break;
      const body = this.readBuffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.readBuffer = this.readBuffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // Ignore malformed JSON frames.
      }
    }
  }

  private onMessage(msg: any) {
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "clangd request failed"));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
      const { uri, diagnostics, version } = msg.params;
      if (uri === this.solutionUri) {
        const list = Array.isArray(diagnostics) ? diagnostics : [];
        const diagVersion =
          typeof version === "number" ? version : this.version;
        this.publishedDiagnostics = {
          version: diagVersion,
          diagnostics: list,
        };
        if (
          this.diagWaiter &&
          this.diagWaiter.uri === uri &&
          diagVersion >= this.diagWaiter.minVersion
        ) {
          const waiter = this.diagWaiter;
          this.diagWaiter = undefined;
          clearTimeout(waiter.timer);
          waiter.resolve(list);
        }
      }
    }
  }

  private writeFrame(payload: unknown) {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error("C++26 language server is not running.");
    }
    const json = JSON.stringify(payload);
    const bytes = Buffer.byteLength(json, "utf8");
    this.proc.stdin.write(`Content-Length: ${bytes}\r\n\r\n${json}`, "utf8");
  }

  private notify(method: string, params: unknown) {
    this.writeFrame({ jsonrpc: "2.0", method, params });
  }

  private requestRpc<T = any>(method: string, params: unknown, timeoutMs = 15000): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`clangd timed out on ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.writeFrame({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private teardownProcess(reason = "C++26 language server stopped") {
    if (this.diagWaiter) {
      const waiter = this.diagWaiter;
      this.diagWaiter = undefined;
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = undefined;
    }
    this.readBuffer = Buffer.alloc(0);
    this.inspectOpened = false;
    this.currentSolutionText = undefined;
    this.publishedDiagnostics = undefined;
    this.startup = undefined;
  }

  async prepare(): Promise<CppLspStatus> {
    if (this.startup) return this.startup;
    const job = (async (): Promise<CppLspStatus> => {
      try {
        const binary = findClangdBinary();
        let versionLine = "clangd";
        try {
          const out = execFileSync(/* turbopackIgnore: true */ binary, ["--version"], {
            encoding: "utf8",
            timeout: 5000,
          }).trim();
          versionLine = out.split(/\r?\n/)[0]?.trim() || "clangd";
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.latestStatus = {
            ready: false,
            state: "C++26 unavailable",
            standard: "c++26",
            binary,
            detail: `Could not launch ${binary}: ${detail}`,
          };
          throw new Error(this.latestStatus.detail);
        }

        this.ensureTempWorkspace();
        this.latestStatus = {
          ready: false,
          state: "Warming C++26…",
          version: versionLine,
          binary,
          standard: "c++26",
        };

        const proc = spawn(
          /* turbopackIgnore: true */ binary,
          [
            "--background-index=false",
            "--clang-tidy=false",
            "--pch-storage=memory",
            "--header-insertion=iwyu",
            "--log=error",
          ],
          { cwd: this.tempDir, stdio: "pipe" },
        );
        this.proc = proc;
        proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
        proc.stderr.on("data", () => {});
        proc.on("exit", () => {
          if (this.proc === proc) {
            this.teardownProcess("clangd process exited");
            this.latestStatus = {
              ready: false,
              state: "C++26 unavailable",
              version: versionLine,
              binary,
              standard: "c++26",
              detail: "clangd process exited unexpectedly.",
            };
          }
        });
        proc.on("error", (err) => {
          if (this.proc === proc) {
            this.teardownProcess(err.message);
            this.latestStatus = {
              ready: false,
              state: "C++26 unavailable",
              version: versionLine,
              binary,
              standard: "c++26",
              detail: err.message,
            };
          }
        });

        await this.requestRpc(
          "initialize",
          {
            processId: process.pid,
            rootUri: "file://" + this.tempDir,
            capabilities: {
              textDocument: {
                publishDiagnostics: {
                  versionSupport: true,
                },
                codeAction: {
                  codeActionLiteralSupport: {
                    codeActionKind: {
                      valueSet: ["quickfix"],
                    },
                  },
                },
                completion: {
                  completionItem: {
                    snippetSupport: true,
                    documentationFormat: ["markdown", "plaintext"],
                    resolveSupport: {
                      properties: ["documentation", "detail", "additionalTextEdits"],
                    },
                  },
                },
                hover: {
                  contentFormat: ["markdown", "plaintext"],
                },
                signatureHelp: {
                  signatureInformation: {
                    documentationFormat: ["markdown", "plaintext"],
                    parameterInformation: { labelOffsetSupport: true },
                  },
                },
              },
            },
          },
          20000,
        );
        this.notify("initialized", {});
        this.version = 1;
        this.currentSolutionText =
          "class Solution { public: int warm() { vector<int> v{1}; return (int)v.size(); } };\n";
        this.notify("textDocument/didOpen", {
          textDocument: {
            uri: this.solutionUri,
            languageId: "cpp",
            version: this.version,
            text: this.currentSolutionText,
          },
        });
        // Wait briefly for initial preamble warm-up via a hover request.
        await this.requestRpc(
          "textDocument/hover",
          {
            textDocument: { uri: this.solutionUri },
            position: { line: 0, character: 62 },
          },
          20000,
        ).catch(() => null);

        this.latestStatus = {
          ready: true,
          state: "C++26 ready",
          version: versionLine,
          binary,
          standard: "c++26",
          detail: `${versionLine} · -std=c++26`,
        };
        return this.status();
      } catch (err) {
        this.teardownProcess();
        const detail = err instanceof Error ? err.message : String(err);
        this.latestStatus = {
          ready: false,
          state: "C++26 unavailable",
          standard: "c++26",
          detail,
        };
        throw err;
      }
    })();
    this.startup = job;
    void job.catch(() => {
      if (this.startup === job) this.startup = undefined;
    });
    return job;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => {}).then(async () => {
      await this.prepare();
      return fn();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private syncSolutionDoc(wrapped: string): number {
    if (this.currentSolutionText === wrapped) {
      return this.version;
    }
    const nextVer = ++this.version;
    this.currentSolutionText = wrapped;
    this.notify("textDocument/didChange", {
      textDocument: { uri: this.solutionUri, version: nextVer },
      contentChanges: [{ text: wrapped }],
    });
    return nextVer;
  }

  async diagnostics(text: string): Promise<LspDiagnostic[]> {
    return this.enqueue(async () => {
      const { text: wrapped, lineOffset } = wrapCppForLsp(text);
      const willChange = this.currentSolutionText !== wrapped;
      const targetVersion = willChange ? this.version + 1 : this.version;
      if (
        !willChange &&
        this.publishedDiagnostics &&
        this.publishedDiagnostics.version >= targetVersion
      ) {
        return this.publishedDiagnostics.diagnostics
          .filter((d) => d.range.start.line >= lineOffset)
          .map((d) => ({
            ...d,
            range: shiftLspRange(d.range, -lineOffset),
          }));
      }
      const wait = new Promise<LspDiagnostic[]>((resolve, reject) => {
        if (this.diagWaiter) {
          const prev = this.diagWaiter;
          this.diagWaiter = undefined;
          clearTimeout(prev.timer);
          prev.reject(new Error("Superseded by newer diagnostics request"));
        }
        const timer = setTimeout(() => {
          if (this.diagWaiter?.minVersion === targetVersion) {
            this.diagWaiter = undefined;
            reject(new Error("clangd timed out publishing diagnostics"));
          }
        }, 12000);
        timer.unref?.();
        this.diagWaiter = {
          uri: this.solutionUri,
          minVersion: targetVersion,
          resolve,
          reject,
          timer,
        };
      });
      this.syncSolutionDoc(wrapped);
      const raw = await wait;
      return raw
        .filter((d) => d.range.start.line >= lineOffset)
        .map((d) => ({
          ...d,
          range: shiftLspRange(d.range, -lineOffset),
        }));
    });
  }

  async completion(text: string, position: LspPosition) {
    return this.enqueue(async () => {
      const { text: wrapped, lineOffset } = wrapCppForLsp(text);
      this.syncSolutionDoc(wrapped);
      const result = await this.requestRpc(
        "textDocument/completion",
        {
          textDocument: { uri: this.solutionUri },
          position: { line: position.line + lineOffset, character: position.character },
          context: { triggerKind: 1 },
        },
        15000,
      );
      const rawItems: any[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.items)
          ? result.items
          : [];
      const items = rawItems.map((item) => {
        const mapped: any = { ...item };
        if (mapped.textEdit?.range) {
          mapped.textEdit = shiftLspEdit(mapped.textEdit, -lineOffset);
        }
        if (Array.isArray(mapped.additionalTextEdits)) {
          mapped.additionalTextEdits = mapped.additionalTextEdits
            .map((e: LspTextEdit) => shiftLspEdit(e, -lineOffset))
            .filter((e: LspTextEdit) => e.range.start.line >= 0);
        }
        return mapped;
      });
      return {
        items,
        isIncomplete: Array.isArray(result) ? false : Boolean(result?.isIncomplete),
      };
    });
  }

  async codeActions(text: string, range: LspRange, diagnostics: LspDiagnostic[]) {
    return this.enqueue(async () => {
      const { text: wrapped, lineOffset } = wrapCppForLsp(text);
      this.syncSolutionDoc(wrapped);
      const result = await this.requestRpc(
        "textDocument/codeAction",
        {
          textDocument: { uri: this.solutionUri },
          range: shiftLspRange(range, lineOffset),
          context: {
            diagnostics: diagnostics.map((d) => ({
              ...d,
              range: shiftLspRange(d.range, lineOffset),
            })),
            only: ["quickfix"],
          },
        },
        15000,
      );
      const actions = Array.isArray(result) ? result : [];
      return actions
        .map((action: any) => {
          const editsByUri = action?.edit?.changes?.[this.solutionUri];
          const docChanges = Array.isArray(action?.edit?.documentChanges)
            ? action.edit.documentChanges
                .filter((dc: any) => dc?.textDocument?.uri === this.solutionUri)
                .flatMap((dc: any) => dc.edits ?? [])
            : [];
          const rawEdits: LspTextEdit[] = Array.isArray(editsByUri)
            ? editsByUri
            : docChanges;
          const shiftedEdits = rawEdits
            .filter((e) => e.range.start.line >= lineOffset)
            .map((e) => shiftLspEdit(e, -lineOffset));
          if (!shiftedEdits.length) return null;
          return {
            title: String(action.title || "Apply fix"),
            kind: action.kind || "quickfix",
            edits: shiftedEdits,
          };
        })
        .filter(Boolean);
    });
  }

  async inspect(text: string, position: LspPosition) {
    return this.enqueue(async () => {
      const { text: wrapped, lineOffset } = wrapCppForLsp(text);
      const nextVer = ++this.inspectVersion;
      if (!this.inspectOpened) {
        this.inspectOpened = true;
        this.notify("textDocument/didOpen", {
          textDocument: {
            uri: this.inspectUri,
            languageId: "cpp",
            version: nextVer,
            text: wrapped,
          },
        });
      } else {
        this.notify("textDocument/didChange", {
          textDocument: { uri: this.inspectUri, version: nextVer },
          contentChanges: [{ text: wrapped }],
        });
      }
      const pos = { line: position.line + lineOffset, character: position.character };
      const params = { textDocument: { uri: this.inspectUri }, position: pos };
      const hoverRaw = await this.requestRpc("textDocument/hover", params, 15000).catch(
        () => null,
      );
      const sigRaw = await this.requestRpc(
        "textDocument/signatureHelp",
        params,
        15000,
      ).catch(() => null);
      const defRaw = await this.requestRpc("textDocument/definition", params, 15000).catch(
        () => null,
      );
      const hover =
        hoverRaw?.range && hoverRaw.range.start.line >= lineOffset
          ? { ...hoverRaw, range: shiftLspRange(hoverRaw.range, -lineOffset) }
          : hoverRaw ?? null;
      const sanitizeDef = (loc: any) => {
        if (!loc || typeof loc !== "object") return loc;
        const out = { ...loc };
        if (out.uri === this.inspectUri || out.uri === this.solutionUri) {
          out.uri = "file:///solution.cpp";
          if (out.range && out.range.start.line >= lineOffset) {
            out.range = shiftLspRange(out.range, -lineOffset);
          }
        }
        return out;
      };
      const definition = Array.isArray(defRaw)
        ? defRaw.map(sanitizeDef)
        : sanitizeDef(defRaw ?? null);
      return {
        hover,
        signatures: sigRaw ?? null,
        definition: definition ?? null,
      };
    });
  }

  async restart(): Promise<CppLspStatus> {
    this.teardownProcess("Restarting clangd");
    return this.prepare();
  }

  private closeSync() {
    this.teardownProcess("C++26 language server closed");
    if (this.tempDir) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch {}
      this.tempDir = undefined;
    }
  }

  async close() {
    this.closeSync();
  }
}

const holder = globalThis as typeof globalThis & { duoCppLsp?: CppLspServer };
export function cppLsp(): CppLspServer {
  const instance = (holder.duoCppLsp ??= new CppLspServer());
  if (Object.getPrototypeOf(instance) !== CppLspServer.prototype) {
    Object.setPrototypeOf(instance, CppLspServer.prototype);
  }
  return instance;
}
