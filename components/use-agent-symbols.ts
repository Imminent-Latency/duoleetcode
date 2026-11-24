"use client";
import { useEffect } from "react";
import { api } from "@/lib/browser";
import { java } from "@/lib/java";
export function useAgentSymbols(id: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!id || !enabled) return;
    let stopped = false,
      polling = false;
    const working = new Set<string>();
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        const { jobs } = await api(`/api/agent/symbols?id=${id}`);
        for (const job of jobs) {
          if (working.has(job.id)) continue;
          working.add(job.id);
          void (async () => {
            try {
              const result = await java().request("inspect", {
                text: job.source,
                position: {
                  line: job.args.line - 1,
                  character: job.args.column - 1,
                },
              });
              if (!stopped)
                await api("/api/agent/symbols", {
                  attemptId: id,
                  id: job.id,
                  sourceHash: job.sourceHash,
                  result,
                });
            } catch (e) {
              if (!stopped)
                await api("/api/agent/symbols", {
                  attemptId: id,
                  id: job.id,
                  sourceHash: job.sourceHash,
                  error: String(e).slice(0, 1000),
                }).catch(() => {});
            }
          })();
        }
      } catch {
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, enabled]);
}
