import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { JavaEngine } from "../lib/java";

test("diagnostics survive outline failures only with fresh compiler results, never stale results or timeouts", async () => {
  const source = await readFile("public/java/worker.js", "utf8");
  let emit: (type: string, data: any) => void;
  let publish = true,
    failure = false,
    timeout = false;
  const markers = [{ message: "cannot find symbol", severity: 1 }];
  const messages: any[] = [];
  class Client {
    constructor(_bridge: unknown, callback: typeof emit) {
      emit = callback;
    }
    async notify(method: string) {
      if (method === "textDocument/didSave" && publish)
        emit("notification", {
          method: "textDocument/publishDiagnostics",
          params: {
            uri: "file:///files/project/Solution.java",
            diagnostics: markers,
          },
        });
    }
    async request(method: string) {
      if (method === "textDocument/documentSymbol") {
        if (timeout) throw Error("timed out");
        if (failure) throw Error('{"code":-32603,"message":"outline failure"}');
      }
      return [];
    }
  }
  const context = vm.createContext({
    importScripts() {},
    createJarTransport: () => ({ natives: {}, bridge: {} }),
    cheerpjInit: async () => {},
    cheerpjRunJar: () => new Promise(() => {}),
    BrowserLanguageClient: Client,
    postMessage: (message: unknown) => messages.push(message),
  });
  vm.runInContext(source, context);
  const request = async (id: number) => {
    context.onmessage({
      data: { id, method: "diagnostics", text: "class Solution {}" },
    });
    await vm.runInContext("queue", context);
    return messages.find((message) => message.id === id);
  };
  assert.deepEqual((await request(1)).result, markers);
  failure = true;
  assert.deepEqual((await request(2)).result, markers);
  publish = false;
  assert.match((await request(3)).error, /outline failure/);
  failure = false;
  assert.match((await request(4)).error, /did not publish/);
  publish = true;
  timeout = true;
  assert.match((await request(5)).error, /timed out/);
});

test("Java worker failure rejects outstanding requests and permits a fresh worker", async (t) => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: any) => void;
    onerror?: () => void;
    terminated = false;
    constructor() {
      workers.push(this);
    }
    terminate() {
      this.terminated = true;
    }
    postMessage() {}
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: FakeWorker,
  });
  const engine = new JavaEngine();
  t.after(() => {
    engine.stop();
    if (original) Object.defineProperty(globalThis, "Worker", original);
    else Reflect.deleteProperty(globalThis, "Worker");
  });
  const ready = engine.prepare();
  workers[0].onmessage?.({ data: { type: "ready" } });
  await ready;
  const pending = engine.request("diagnostics", { text: "class Solution {}" });
  await Promise.resolve();
  const rejected = assert.rejects(pending, /restarted/);
  workers[0].onerror?.();
  await rejected;
  assert.equal(workers[0].terminated, true);
  assert.equal(engine.pending.size, 0);
  const retry = engine.prepare();
  assert.equal(workers.length, 2);
  workers[1].onmessage?.({ data: { type: "ready" } });
  await retry;
  assert.equal(engine.ready, true);
});
