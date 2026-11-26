"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  SegmentedControl,
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
  availableTeamProfiles,
  normalizeBackgroundSettings,
  normalizeDefaultLanguage,
  resolveBackgroundSettings,
  resolveDefaultLanguage,
  type AgentModel,
  type AgentSettings as Settings,
  type AgentTeamProfile,
} from "@/lib/agent-settings";
import type { LanguageId } from "@/lib/languages";
import type { UsageSummary } from "@/lib/agent-trace-types";

export default function AgentSettings({
  onDefaultLanguageChange,
}: {
  onDefaultLanguageChange?: (lang: LanguageId) => void;
} = {}) {
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
  const groupedModels = (() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const m of models) {
      const groupName = m.providerLabel ?? "Connected runtime";
      let items = groups.get(groupName);
      if (!items) {
        items = [];
        groups.set(groupName, items);
      }
      items.push({ value: m.model, label: m.name });
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  })();
  const teamProfiles = availableTeamProfiles(models);
  const matchesProfile = (profile: AgentTeamProfile) =>
    settings?.preset === "custom" &&
    agentFeatures.every(
      (f) =>
        settings.features[f.id].model === profile.features[f.id].model &&
        settings.features[f.id].effort === profile.features[f.id].effort,
    );
  const applyTeamProfile = (profile: AgentTeamProfile) => {
    if (!settings) return;
    setNotice("");
    setSettings({
      ...settings,
      preset: "custom",
      features: structuredClone(profile.features),
    });
  };
  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api("/api/agent/settings", settings);
      setSettings(data.settings);
      setSaved(JSON.stringify(data.settings));
      onDefaultLanguageChange?.(resolveDefaultLanguage(data.settings));
      setNotice("Saved. These settings apply to every new session and agent request.");
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
          <h1>Settings</h1>
          <p>
            Default language and AI learning team preferences. Custom gives you
            control over each feature.
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
        {!settings && !error && <Text c="dimmed">Loading settings…</Text>}
        {settings && (
          <>
            <Paper withBorder radius="md" p="xl">
              <Group justify="space-between" align="start" gap="xl">
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Title order={2}>Default practice language</Title>
                  <Text c="dimmed">
                    Preselected for new LeetCode sessions, local exercises, and
                    daily problem recommendations.
                  </Text>
                </Stack>
                <SegmentedControl
                  aria-label="Default practice language"
                  value={resolveDefaultLanguage(settings)}
                  disabled={busy}
                  data={[
                    { value: "java", label: "Java 25" },
                    { value: "cpp", label: "C++26" },
                  ]}
                  onChange={(value) => {
                    setNotice("");
                    const nextLang = normalizeDefaultLanguage(
                      value as LanguageId,
                    );
                    const { defaultLanguage: _old, ...rest } = settings;
                    setSettings(
                      nextLang ? { ...rest, defaultLanguage: nextLang } : rest,
                    );
                  }}
                />
              </Group>
            </Paper>
            <Paper withBorder radius="md" p="xl">
              <Group justify="space-between" align="start" gap="xl">
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Title order={2}>Platform preset</Title>
                  <Text c="dimmed">
                    Applies across Reference help, reflection, assessment feedback,
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
                      const nextLang = normalizeDefaultLanguage(
                        settings.defaultLanguage,
                      );
                      setSettings({
                        ...structuredClone(baseline),
                        ...(nextBg ? { background: nextBg } : {}),
                        ...(nextLang ? { defaultLanguage: nextLang } : {}),
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
                  description="Saves private stretch summaries, documentation lookups, and candidate questions at natural milestones while you code (including test sessions, tracked separately under Test usage)."
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
            {teamProfiles.length > 0 && (
              <Paper withBorder radius="md" p="xl">
                <Stack gap="md">
                  <div>
                    <Title order={3}>Role-paired team profiles (Low effort)</Title>
                    <Text size="sm" c="dimmed" mt={4}>
                      Pairs each provider’s flagship reasoning model at Low
                      effort for nuanced reflection, evaluation, and coaching
                      with its fast coding model at Low effort for live reference
                      help and problem selection — or customize any individual
                      model below.
                    </Text>
                  </div>
                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                    {teamProfiles.map((profile) => {
                      const active = matchesProfile(profile);
                      return (
                        <Paper
                          key={profile.id}
                          withBorder
                          radius="md"
                          p="md"
                          style={
                            active
                              ? {
                                  borderColor:
                                    "var(--mantine-color-teal-filled)",
                                }
                              : undefined
                          }
                        >
                          <Stack gap="xs" justify="space-between" h="100%">
                            <div>
                              <Group justify="space-between" gap="xs">
                                <Text fw={600} size="sm">
                                  {profile.label}
                                </Text>
                                <Badge
                                  size="xs"
                                  variant="light"
                                  color={active ? "teal" : "gray"}
                                >
                                  {active ? "Active" : profile.provider}
                                </Badge>
                              </Group>
                              <Text size="xs" c="dimmed" mt={6}>
                                {profile.philosophy}
                              </Text>
                            </div>
                            <Button
                              size="xs"
                              variant={active ? "light" : "default"}
                              disabled={busy || active}
                              onClick={() => applyTeamProfile(profile)}
                            >
                              {active ? "Selected" : `Use ${profile.label}`}
                            </Button>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </SimpleGrid>
                </Stack>
              </Paper>
            )}
            <Group justify="space-between" align="end">
              <div>
                <Title order={3}>Feature configuration</Title>
                <Text size="sm" c="dimmed" mt={2}>
                  All discovered models across Codex, Claude (Claude SDK · ACP),
                  and Antigravity (Gemini · ACP) can be mixed per feature.
                </Text>
              </div>
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
                          ...groupedModels,
                          ...(!selectedModel
                            ? [
                                {
                                  group: "Saved selection",
                                  items: [
                                    {
                                      value: choice.model,
                                      label: choice.model + " (unavailable)",
                                    },
                                  ],
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
                Save settings
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </div>
  );
}
