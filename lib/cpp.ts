"use client";
import { api } from "./browser";

export class CppEngine {
  state = "Not loaded";
  detail = "C++26 · local clangd LSP";
  ready = false;
  startup?: Promise<void>;
  listeners = new Set<() => void>();

  update(state: string, detail?: string) {
    this.state = state;
    if (detail !== undefined) this.detail = detail;
    for (const listener of this.listeners) listener();
  }

  prepare() {
    if (this.ready) return Promise.resolve();
    if (this.startup) return this.startup;
    const startup = (async () => {
      this.update("Warming C++26…", "Starting local clangd (-std=c++26)…");
      try {
        const res = await api("/api/cpp/lsp", { method: "prepare" });
        const status = res?.status;
        if (status?.ready) {
          this.ready = true;
          this.update(status.state || "C++26 ready", status.detail);
        } else {
          this.ready = false;
          this.update(status?.state || "C++26 unavailable", status?.detail);
          throw new Error(status?.detail || "C++26 language server unavailable");
        }
      } catch (e) {
        this.ready = false;
        const msg = e instanceof Error ? e.message : String(e);
        this.update("C++26 unavailable", msg);
        throw e;
      }
    })();
    this.startup = startup;
    void startup.finally(() => {
      if (this.startup === startup) this.startup = undefined;
    });
    return startup;
  }

  stop() {
    this.ready = false;
    this.startup = undefined;
    this.update("Not loaded");
  }

  async request(method: string, data: Record<string, unknown> = {}) {
    if (method !== "prepare" && method !== "restart") {
      await this.prepare();
    }
    const res = await api("/api/cpp/lsp", { method, ...data });
    if (method === "restart" && res?.status) {
      this.ready = Boolean(res.status.ready);
      this.update(res.status.state || "C++26 ready", res.status.detail);
    }
    return res?.result;
  }
}

let engine: CppEngine | undefined;
export function cpp() {
  return (engine ??= new CppEngine());
}
