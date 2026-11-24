"use client";
type Waiter = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class JavaEngine {
  worker?: Worker;
  state = "Not loaded";
  ready = false;
  startup?: Promise<void>;
  next = 0;
  pending = new Map<number, Waiter>();
  listeners = new Set<() => void>();
  private cancelStartup?: (error: Error) => void;
  update(state: string) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  prepare() {
    if (this.startup) return this.startup;
    const startup = new Promise<void>((resolve, reject) => {
      this.update("Warming Java…");
      this.worker = new Worker("/java/worker.js");
      const timeout = setTimeout(() => {
        this.update("Java took too long to start");
        reject(new Error(this.state));
        this.stop();
      }, 90000);
      this.cancelStartup = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      this.worker.onmessage = ({ data }) => {
        if (data.type === "status") this.update(data.message);
        if (data.type === "ready") {
          clearTimeout(timeout);
          this.ready = true;
          this.cancelStartup = undefined;
          this.update("Java ready");
          resolve();
        }
        if (data.type === "error") {
          clearTimeout(timeout);
          this.update("Java unavailable");
          reject(new Error(data.message));
          for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error(data.message));
          }
          this.pending.clear();
          this.stop();
        }
        if (data.id) {
          const p = this.pending.get(data.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(data.id);
            data.error
              ? p.reject(new Error(data.error))
              : p.resolve(data.result);
          }
        }
      };
      this.worker.onerror = () => {
        clearTimeout(timeout);
        this.update("Java worker could not load");
        reject(new Error(this.state));
        this.stop();
      };
    });
    this.startup = startup;
    void startup.catch(() => {
      if (this.startup === startup) this.stop();
    });
    return startup;
  }
  stop(error = new Error("Java checks restarted")) {
    this.cancelStartup?.(error);
    this.cancelStartup = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = false;
    this.startup = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  async request(method: string, data: Record<string, unknown>) {
    await this.prepare();
    return new Promise<any>((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(
        () => {
          this.update("Java request timed out");
          this.stop(new Error(this.state));
        },
        method === "inspect" ? 50000 : 20000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, method, ...data });
    });
  }
}
let engine: JavaEngine | undefined;
export function java() {
  return (engine ??= new JavaEngine());
}
