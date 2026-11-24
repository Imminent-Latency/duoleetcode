export class SpellingClient {
  private worker?: Worker;
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (result: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  request<T>(data: Record<string, unknown>): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker("/spell/worker.js");
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(data.id);
        data.error
          ? pending.reject(new Error(data.error))
          : pending.resolve(data.result);
      };
      this.worker.onerror = () => this.dispose();
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => this.dispose(), 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ ...data, id });
    });
  }
  dispose() {
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Spell check unavailable"));
    }
    this.pending.clear();
  }
}
