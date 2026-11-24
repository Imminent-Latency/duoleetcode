"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { api } from "@/lib/browser";
import {
  agentFeatures,
  agentPresets,
  normalizeBackgroundSettings,
  resolveBackgroundSettings,
  type AgentModel,
  type AgentSettings as Settings,
} from "@/lib/agent-settings";
import type { UsageSummary } from "@/lib/agent-trace-types";

export default function AgentSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [baseline, setBaseline] = useState<Settings>();
  const [saved, setSaved] = useState("");
  const [models, setModels] = useState<AgentModel[]>([]);
  const [usage, setUsage] = useState<UsageSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const [data, usageData] = await Promise.all([
        api("/api/agent/settings"),
        api("/api/diagnostics?usage=1&mode=practice").catch(() => undefined),
      ]);
      setSettings(data.settings);
      setBaseline(data.baseline);
      setSaved(JSON.stringify(data.settings));
      setModels(data.models);
      if (usageData) setUsage(usageData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const custom = settings?.preset === "custom";
  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api("/api/agent/settings", settings);
      setSettings(data.settings);
      setSaved(JSON.stringify(data.settings));
      setNotice("Saved. These settings apply to every new agent request.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-content">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">PLATFORM PREFERENCES</span>
          <h1>Agent settings</h1>
          <p>
            One preset for the whole learning team. Custom gives you control
            over each feature.
          </p>
        </div>
      </div>
      <Stack gap="lg">
        {error && (
          <Alert color="red" title="Settings unavailable">
            {error}
            <Button ml="md" variant="subtle" onClick={load} disabled={busy}>
              Retry
            </Button>
          </Alert>
        )}
        {!settings && !error && <Text c="dimmed">Loading agent settings…</Text>}
        {settings && (
          <>
            <Paper withBorder radius="md" p="xl">
              <Group justify="space-between" align="start" gap="xl">
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Title order={2}>Platform preset</Title>
                  <Text c="dimmed">
                    Applies across Java help, reflection, assessment feedback,
                    focused coaching, and planning.
                  </Text>
                  <Text size="sm" c="dimmed">
                    We’re tuning Low first: the current model with low reasoning
                    effort. Balanced, Optimal, and Thirsty will follow after
                    comparison testing.
                  </Text>
                </Stack>
                <Select
                  label="Preset"
                  aria-label="Platform preset"
                  w={280}
                  maw="100%"
                  value={settings.preset}
                  disabled={busy}
                  allowDeselect={false}
                  data={agentPresets.map((p) => ({
                    value: p.value,
                    label: p.label,
                    disabled: !p.enabled,
                  }))}
                  onChange={(v) => {
                    setNotice("");
                    if (v === "low" && baseline) {
                      const nextBg = normalizeBackgroundSettings(
                        settings.background,
                      );
                      setSettings({
                        ...structuredClone(baseline),
                        ...(nextBg ? { background: nextBg } : {}),
                      });
                    }
                    if (v === "custom")
                      setSettings({ ...settings, preset: "custom" });
                  }}
                />
              </Group>
            </Paper>
            <Paper withBorder radius="md" p="xl">
              <Stack gap="md">
                <div>
                  <Title order={3}>Background &amp; usage controls</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Non-essential background work is enabled by default on our
                    Low-effort baseline for faster, richer coaching. Toggle
                    either option off to conserve plan quota or API spend.
                  </Text>
                </div>
                <Checkbox
                  label="Background analysis while solving"
                  description="Saves private stretch summaries, Java documentation lookups, and candidate questions at natural milestones while you code (including test sessions, tracked separately under Test usage)."
                  checked={resolveBackgroundSettings(settings).solvingAnalysis}
                  disabled={busy}
                  onChange={(e) => {
                    setNotice("");
                    const current = resolveBackgroundSettings(settings);
                    const next = normalizeBackgroundSettings({
                      ...current,
                      solvingAnalysis: e.currentTarget.checked,
                    });
                    const { background: _old, ...rest } = settings;
                    setSettings(next ? { ...rest, background: next } : rest);
                  }}
                />
                <Checkbox
                  label="Prepare review during intake"
                  description="Starts the final evidence and question review while you fill out the 3-question reflection form (without generating a throwaway coach reply). Turn off so skipped reflections use zero calls."
                  checked={resolveBackgroundSettings(settings).preIntakeReview}
                  disabled={busy}
                  onChange={(e) => {
                    setNotice("");
                    const current = resolveBackgroundSettings(settings);
                    const next = normalizeBackgroundSettings({
                      ...current,
                      preIntakeReview: e.currentTarget.checked,
                    });
                    const { background: _old, ...rest } = settings;
                    setSettings(next ? { ...rest, background: next } : rest);
                  }}
                />
                {usage && (() => {
                  const fiveHour = usage.windows.find(
                    (w) => w.windowKey === "last5h",
                  );
                  const thirtyDay = usage.windows.find(
                    (w) => w.windowKey === "last30d",
                  );
                  if (!fiveHour || !thirtyDay) return null;
                  return (
                    <Text size="xs" c="dimmed">
                      Practice usage — Last 5h: {fiveHour.calls.toLocaleString()}{" "}
                      calls ({fiveHour.totalTokens.toLocaleString()} tokens) ·
                      Last 30d: {thirtyDay.calls.toLocaleString()} calls (
                      {thirtyDay.totalTokens.toLocaleString()} tokens
                      {thirtyDay.sessions
                        ? `, avg ${thirtyDay.avgCallsPerSession} calls/session`
                        : ""}
                      ). Open Agent diagnostics → Usage for full feature and
                      stage breakdowns.
                    </Text>
                  );
                })()}
              </Stack>
            </Paper>
            <Group justify="space-between">
              <Title order={3}>Feature configuration</Title>
              <Badge variant="light">
                {custom ? "Custom controls" : "Set by Low"}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              {agentFeatures.map((feature) => {
                const choice = settings.features[feature.id];
                const selectedModel = models.find(
                  (m) => m.model === choice.model,
                );
                return (
                  <Paper key={feature.id} withBorder radius="md" p="xl">
                    <Stack gap="md">
                      <div>
                        <Title order={4}>{feature.label}</Title>
                        <Text size="sm" c="dimmed" mt={4}>
                          {feature.description}
                        </Text>
                      </div>
                      <Select
                        label="Model"
                        aria-label={`${feature.label} model`}
                        value={choice.model}
                        disabled={!custom || busy}
                        styles={
                          !custom
                            ? {
                                input: {
                                  color: "var(--mantine-color-text)",
                                  opacity: 0.85,
                                },
                              }
                            : undefined
                        }
                        searchable
                        allowDeselect={false}
                        data={[
                          ...models.map((m) => ({
                            value: m.model,
                            label: m.name,
                          })),
                          ...(!selectedModel
                            ? [
                                {
                                  value: choice.model,
                                  label: choice.model + " (unavailable)",
                                },
                              ]
                            : []),
                        ]}
                        onChange={(v) => {
                          const m = models.find((m) => m.model === v);
                          if (!m) return;
                          setNotice("");
                          setSettings({
                            ...settings,
                            features: {
                              ...settings.features,
                              [feature.id]: {
                                model: m.model,
                                effort: m.efforts.includes(choice.effort)
                                  ? choice.effort
                                  : m.efforts.includes("low")
                                    ? "low"
                                    : m.efforts[0],
                              },
                            },
                          });
                        }}
                      />
                      <Select
                        label="Reasoning effort"
                        aria-label={`${feature.label} reasoning effort`}
                        value={choice.effort}
                        disabled={!custom || busy}
                        styles={
                          !custom
                            ? {
                                input: {
                                  color: "var(--mantine-color-text)",
                                  opacity: 0.85,
                                },
                              }
                            : undefined
                        }
                        allowDeselect={false}
                        data={(selectedModel?.efforts ?? [choice.effort]).map(
                          (v) => ({
                            value: v,
                            label: v.charAt(0).toUpperCase() + v.slice(1),
                          }),
                        )}
                        onChange={(v) => {
                          if (v) {
                            setNotice("");
                            setSettings({
                              ...settings,
                              features: {
                                ...settings.features,
                                [feature.id]: { ...choice, effort: v },
                              },
                            });
                          }
                        }}
                      />
                    </Stack>
                  </Paper>
                );
              })}
            </SimpleGrid>
            <Text size="sm" c="dimmed">
              Changes apply to the next request, including in an existing
              conversation. A running reply keeps its settings. Model choices
              come from your connected runtime; access is confirmed when a
              request runs.
            </Text>
            <Group justify="space-between">
              <Text size="sm" role="status">
                {notice ||
                  (JSON.stringify(settings) !== saved
                    ? "Unsaved changes"
                    : "Saved on this device")}
              </Text>
              <Button
                onClick={save}
                loading={busy}
                disabled={busy || JSON.stringify(settings) === saved}
              >
                Save agent settings
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </div>
  );
}
