"use client";
import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Radio,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { Attempt } from "@/lib/types";
import {
  familiarityLabels,
  reflectionIntakeSchema,
} from "@/lib/reflection-intake";

export default function ReflectionIntakeForm({
  attempt,
  analyzing,
  onSave,
  onRetry,
  onError,
}: {
  attempt: Attempt;
  analyzing: boolean;
  onSave: (body: unknown) => Promise<void>;
  onRetry: () => void;
  onError: (error: unknown) => void;
}) {
  const [familiarity, setFamiliarity] = useState("");
  const [space, setSpace] = useState("");
  const [runtime, setRuntime] = useState("");
  const [requestId, setRequestId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const storageKey = `duo-reflection-intake-${attempt.id}`;
  useEffect(() => {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    } catch {}
    setFamiliarity(
      ["new", "revisit", "solved"].includes(saved?.familiarity)
        ? saved.familiarity
        : "",
    );
    setSpace(
      typeof saved?.spaceComplexity === "string" ? saved.spaceComplexity : "",
    );
    setRuntime(
      typeof saved?.timeComplexity === "string" ? saved.timeComplexity : "",
    );
    setRequestId(
      typeof saved?.id === "string" ? saved.id : crypto.randomUUID(),
    );
    setLoaded(true);
  }, [storageKey]);
  const answers = {
    id: requestId,
    familiarity,
    spaceComplexity: space,
    timeComplexity: runtime,
  };
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(storageKey, JSON.stringify(answers));
      } catch {}
  }, [loaded, requestId, familiarity, space, runtime, storageKey]);
  const complete = loaded && reflectionIntakeSchema.safeParse(answers).success;
  const hasFamiliarity =
    loaded && ["new", "revisit", "solved"].includes(familiarity);
  const prepared = attempt.reflection?.analysisReady;
  const submitMode = async (mode: "continue" | "defer" | "skip-coaching") => {
    if (!complete || saving) return;
    setSaving(mode);
    try {
      await onSave({ action: "reflection-intake", answers, mode });
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    } catch (e) {
      onError(e);
    } finally {
      setSaving(null);
    }
  };
  const submitSkipCheckIn = async () => {
    if (!hasFamiliarity || saving) return;
    setSaving("skip-checkin");
    try {
      await onSave({ action: "skip-checkin", familiarity });
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    } catch (e) {
      onError(e);
    } finally {
      setSaving(null);
    }
  };
  return (
    <section
      className="reflection-intake-panel"
      aria-label="Initial reflection"
    >
      <div className="reflection-intake-heading">
        <Title order={2} size="h3">
          Quick check-in
        </Title>
        <Text c="dimmed" size="sm" mt="xs">
          Review your solution, then share three quick answers.
        </Text>
      </div>
      <form
        className="reflection-intake-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submitMode("continue");
        }}
      >
        <div className="reflection-intake-fields">
          <Stack gap="lg">
            <Radio.Group
              label="1. Have you seen or solved this problem before?"
              value={familiarity}
              onChange={setFamiliarity}
              required
            >
              <Group mt="sm" gap="md">
                {Object.entries(familiarityLabels).map(([value, label]) => (
                  <Radio
                    key={value}
                    value={value}
                    label={label}
                    disabled={!!saving}
                  />
                ))}
              </Group>
            </Radio.Group>
            <Textarea
              label="2. What is your solution’s runtime complexity?"
              description="How running time grows as the input gets larger."
              placeholder="Use Big O or explain in your own words."
              required
              autosize
              minRows={2}
              maxRows={6}
              maxLength={5000}
              value={runtime}
              onChange={(e) => setRuntime(e.currentTarget.value)}
              disabled={!!saving}
            />
            <Textarea
              label="3. What is your solution’s auxiliary space complexity?"
              description="The extra memory your solution uses, beyond the input."
              placeholder="Use Big O or explain in your own words."
              required
              autosize
              minRows={2}
              maxRows={6}
              maxLength={5000}
              value={space}
              onChange={(e) => setSpace(e.currentTarget.value)}
              disabled={!!saving}
            />
            <Text size="sm" c="dimmed">
              A brief answer is enough. “I’m not sure” is a valid answer, too.
            </Text>
          </Stack>
        </div>
        <div className="reflection-intake-footer">
          <Group justify="space-between" gap="xs">
            <Text size="xs" c="dimmed" role="status">
              {prepared ? (
                <>
                  <Check size={14} /> Recording analyzed
                </>
              ) : analyzing ? (
                <>
                  <LoaderCircle size={14} /> Analyzing your recording…
                </>
              ) : (
                "Preparing your recording…"
              )}
            </Text>
            {!analyzing && !prepared && (
              <Button variant="subtle" size="compact-xs" onClick={onRetry}>
                Retry analysis
              </Button>
            )}
          </Group>
          <Button
            type="submit"
            fullWidth
            disabled={!complete || !!saving}
            loading={saving === "continue"}
            rightSection={<ArrowRight size={16} />}
          >
            Continue to reflection
          </Button>
          <Group grow gap="xs" mt="xs">
            <Button
              type="button"
              variant="light"
              disabled={!complete || !!saving}
              loading={saving === "defer"}
              onClick={() => void submitMode("defer")}
            >
              Come back later
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={!complete || !!saving}
              loading={saving === "skip-coaching"}
              onClick={() => void submitMode("skip-coaching")}
            >
              Submit &amp; skip coaching
            </Button>
          </Group>
          <Button
            type="button"
            variant="subtle"
            size="xs"
            fullWidth
            mt="xs"
            disabled={!hasFamiliarity || !!saving}
            loading={saving === "skip-checkin"}
            onClick={() => void submitSkipCheckIn()}
          >
            {hasFamiliarity
              ? "Skip check-in (unlock next problem)"
              : "Select familiarity above to skip check-in"}
          </Button>
        </div>
      </form>
    </section>
  );
}
