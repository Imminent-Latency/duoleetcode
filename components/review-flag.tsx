"use client";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Button, Group, Modal, Select, Stack, Textarea } from "@mantine/core";
import { Flag, X } from "lucide-react";
import { api } from "@/lib/browser";
import {
  reviewCategories,
  type ReviewTarget,
  type ReviewFlagInput,
} from "@/lib/review-flag-types";
const ReviewContext = createContext<(target: ReviewTarget) => void>(() => {});
export const useReviewFlag = () => useContext(ReviewContext);
export function ReviewFlagProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ReviewFlagInput>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState<string>();
  const open = useCallback((target: ReviewTarget) => {
    setError("");
    setDraft({
      id: crypto.randomUUID(),
      category:
        target.kind === "editor"
          ? "Editor issue"
          : target.kind === "prescription"
            ? "Poor recommendation"
            : "Other",
      note: "",
      target: structuredClone(target),
    });
  }, []);
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/review-flags", {
        action: "create",
        flag: draft,
      });
      setSaved(result.id);
      setDraft(undefined);
      window.dispatchEvent(new Event("duo-review-flags-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ReviewContext.Provider value={open}>
      {children}
      <Modal
        opened={!!draft}
        onClose={() => {
          if (!busy) setDraft(undefined);
        }}
        title="Flag for review"
        centered
        size="md"
        returnFocus
      >
        <Stack>
          <p className="small">
            Save a note with this{" "}
            {draft?.target.kind === "editor" ? "editor snapshot" : "item"} and
            its available diagnostic context. You can keep practicing after
            saving.
          </p>
          {draft?.target.kind === "editor" && (
            <p className="small">
              Cursor: line {draft.target.editor.cursor.line}, column{" "}
              {draft.target.editor.cursor.column}
              {draft.target.editor.selection ? " · Selected code included" : ""}
              . Your assessment timer keeps its current state.
            </p>
          )}
          <Select
            label="What should we review?"
            data={[...reviewCategories]}
            value={draft?.category ?? "Other"}
            allowDeselect={false}
            onChange={(v) =>
              setDraft((d) =>
                d ? { ...d, category: v as ReviewFlagInput["category"] } : d,
              )
            }
          />
          <Textarea
            label="Note (optional)"
            placeholder="What happened, or what would have been more helpful?"
            value={draft?.note ?? ""}
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, note: e.target.value } : d))
            }
            autosize
            minRows={3}
            maxRows={7}
            maxLength={4000}
            data-autofocus
          />
          {error && (
            <p role="alert" className="error-text">
              {error} Your note is still here.
            </p>
          )}
          <Group justify="end">
            <Button
              variant="default"
              disabled={busy}
              onClick={() => setDraft(undefined)}
            >
              Cancel
            </Button>
            <Button
              leftSection={<Flag size={14} />}
              loading={busy}
              onClick={() => void save()}
            >
              Save flag
            </Button>
          </Group>
        </Stack>
      </Modal>
      {saved && (
        <div className="review-flag-toast" role="status">
          <Flag size={15} />
          <span>
            Flag saved.{" "}
            <a
              href={`/?flag=${saved}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review flags
            </a>
          </span>
          <button
            aria-label="Dismiss flag confirmation"
            onClick={() => setSaved(undefined)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </ReviewContext.Provider>
  );
}
export default function ReviewFlagButton({
  target,
  label = "Flag for review",
}: {
  target: ReviewTarget;
  label?: string;
}) {
  const open = useReviewFlag();
  return (
    <Button
      variant="subtle"
      color="gray"
      size="compact-xs"
      className="review-flag-button"
      leftSection={<Flag size={12} />}
      onClick={() => open(target)}
    >
      {label}
    </Button>
  );
}
