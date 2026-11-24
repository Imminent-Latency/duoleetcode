"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function SplitPane({
  first,
  second,
  direction = "horizontal",
  storageKey,
  initial = 35,
  firstHidden = false,
  secondHidden = false,
  label,
}: {
  first: ReactNode;
  second: ReactNode;
  direction?: "horizontal" | "vertical";
  storageKey: string;
  initial?: number;
  firstHidden?: boolean;
  secondHidden?: boolean;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initial);
  const [compact, setCompact] = useState(false);
  const axis = direction === "horizontal" && compact ? "vertical" : direction;
  const clamp = (value: number) => Math.max(18, Math.min(82, value));
  const resize = (value: number) => {
    const next = clamp(value);
    setSize(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {}
  };
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && Number.isFinite(Number(saved)))
        setSize(clamp(Number(saved)));
    } catch {}
    const observer = new ResizeObserver(([entry]) =>
      setCompact(entry.contentRect.width < 720),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [storageKey]);
  return (
    <div className="split-pane" data-direction={axis} ref={root}>
      <div
        className="split-content"
        style={{
          display: firstHidden ? "none" : undefined,
          flex: secondHidden ? 1 : `0 0 ${size}%`,
        }}
      >
        {first}
      </div>
      {!firstHidden && !secondHidden && (
        <div
          className="split-handle"
          role="separator"
          tabIndex={0}
          aria-label={label}
          aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(size)}
          aria-valuemin={18}
          aria-valuemax={82}
          title="Drag to resize · arrow keys to adjust · double-click to reset"
          onDoubleClick={() => resize(initial)}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (
              !e.currentTarget.hasPointerCapture(e.pointerId) ||
              !root.current
            )
              return;
            const rect = root.current.getBoundingClientRect();
            resize(
              axis === "horizontal"
                ? ((e.clientX - rect.left) / rect.width) * 100
                : ((e.clientY - rect.top) / rect.height) * 100,
            );
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
          onKeyDown={(e) => {
            const lower = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
            const higher = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
            if (![lower, higher, "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            resize(
              e.key === "Home"
                ? 18
                : e.key === "End"
                  ? 82
                  : size + (e.key === lower ? -3 : 3),
            );
          }}
        >
          <span />
        </div>
      )}
      <div
        className="split-content"
        style={{ display: secondHidden ? "none" : undefined, flex: 1 }}
      >
        {second}
      </div>
    </div>
  );
}
