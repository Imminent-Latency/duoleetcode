"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  SegmentedControl,
  Select,
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
  onOpenUsage,
}: {
  onDefaultLanguageChange?: (lang: LanguageId) => void;
  onOpenUsage?: () => void;
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
      setNotice(
        "Saved. These settings apply to every new session and agent request.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const lockedInput = !custom
    ? {
        input: {
          color: "var(--mantine-color-text)",
          opacity: 0.85,
        },
      }
    : undefined;
  const dirty = !!settings && JSON.stringify(settings) !== saved;
  return (
    <div className="settings-subpage general-settings">
      <p className="subpage-description">
        Default language and AI learning team preferences. Custom gives you
        control over each feature.
      </p>
      <Stack gap="md">
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
            <Paper withBorder className="settings-card settings-rows">
              <div className="settings-row">
                <div className="settings-row-text">
                  <Title order={2} className="settings-row-title">
                    Default practice language
                  </Title>
                  <Text className="settings-help">
                    Preselected for new LeetCode sessions, local exercises, and
                    daily problem recommendations.
                  </Text>
                </div>
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
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <Title order={2} className="settings-row-title">
                    Platform preset
                  </Title>
                  <Text className="settings-help">
                    Applies across Reference help, reflection, assessment
                    feedback, focused coaching, and planning.
                  </Text>
                  <Text className="settings-caption">
                    We’re tuning Low first: the current model with low reasoning
                    effort. Balanced, Optimal, and Thirsty will follow after
                    comparison testing.
                  </Text>
                </div>
                <Select
                  aria-label="Platform preset"
                  className="settings-row-control"
                  value={settings.preset}
                  disabled={busy}
                  allowDeselect={false}
                  comboboxProps={{
                    classNames: { dropdown: "settings-dropdown" },
                  }}
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
              </div>
            </Paper>
            <Paper withBorder className="settings-card">
              <div className="settings-card-heading">
                <Title order={3} className="settings-section-title">
                  Background &amp; usage controls
                </Title>
                <Text className="settings-help">
                  Non-essential background work is enabled by default on our
                  Low-effort baseline for faster, richer coaching. Toggle either
                  option off to conserve plan quota or API spend.
                </Text>
              </div>
              <div className="settings-checks">
                <Checkbox
                  classNames={{ description: "settings-check-description" }}
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
                  classNames={{ description: "settings-check-description" }}
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
              </div>
              {usage &&
                (() => {
                  const fiveHour = usage.windows.find(
                    (w) => w.windowKey === "last5h",
                  );
                  const thirtyDay = usage.windows.find(
                    (w) => w.windowKey === "last30d",
                  );
                  if (!fiveHour || !thirtyDay) return null;
                  return (
                    <Text className="settings-caption settings-usage">
                      Practice usage: Last 5h: {fiveHour.calls.toLocaleString()}{" "}
                      calls ({fiveHour.totalTokens.toLocaleString()} tokens) ·
                      Last 30d: {thirtyDay.calls.toLocaleString()} calls (
                      {thirtyDay.totalTokens.toLocaleString()} tokens
                      {thirtyDay.sessions
                        ? `, avg ${thirtyDay.avgCallsPerSession} calls/session`
                        : ""}
                      ). Open{" "}
                      {onOpenUsage ? (
                        <Anchor
                          component="button"
                          className="settings-inline-link"
                          onClick={onOpenUsage}
                        >
                          Settings → Diagnostics → Usage
                        </Anchor>
                      ) : (
                        "Settings → Diagnostics → Usage"
                      )}{" "}
                      for full feature and stage breakdowns.
                    </Text>
                  );
                })()}
            </Paper>
            <Paper withBorder className="settings-card">
              {teamProfiles.length > 0 && (
                <>
                  <div className="settings-card-heading">
                    <Title order={3} className="settings-section-title">
                      Role-paired team profiles (Low effort)
                    </Title>
                    <Text className="settings-help">
                      Pairs each provider’s flagship reasoning model at Low
                      effort for nuanced reflection, evaluation, and coaching
                      with its fast coding model at Low effort for live
                      reference help and problem selection, or customize any
                      individual model below.
                    </Text>
                  </div>
                  <div className="team-profiles">
                    {teamProfiles.map((profile) => {
                      const active = matchesProfile(profile);
                      return (
                        <div
                          key={profile.id}
                          className="team-profile"
                          data-active={active || undefined}
                        >
                          <div className="team-profile-text">
                            <div className="team-profile-title">
                              <Text fw={600} className="team-profile-name">
                                {profile.label}
                              </Text>
                              <Badge
                                variant="light"
                                color={active ? "teal" : "gray"}
                              >
                                {active ? "Active" : profile.provider}
                              </Badge>
                            </div>
                            <Text className="settings-caption">
                              {profile.philosophy}
                            </Text>
                          </div>
                          {!active && (
                            <Button
                              size="xs"
                              variant="default"
                              className="team-profile-action"
                              disabled={busy}
                              onClick={() => applyTeamProfile(profile)}
                            >
                              {`Use ${profile.label}`}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <div
                className={
                  teamProfiles.length > 0
                    ? "settings-card-heading feature-heading divided"
                    : "settings-card-heading feature-heading"
                }
              >
                <div>
                  <Title order={3} className="settings-section-title">
                    Feature configuration
                  </Title>
                  <Text className="settings-help">
                    All discovered models across Codex and Claude (Claude SDK ·
                    ACP) can be mixed per feature.
                  </Text>
                </div>
                <Badge variant="light">
                  {custom ? "Custom controls" : "Set by Low"}
                </Badge>
              </div>
              <div className="feature-table">
                <div className="feature-table-head" aria-hidden="true">
                  <span>Feature</span>
                  <span>Model</span>
                  <span>Reasoning effort</span>
                </div>
                {agentFeatures.map((feature) => {
                  const choice = settings.features[feature.id];
                  const selectedModel = models.find(
                    (m) => m.model === choice.model,
                  );
                  return (
                    <div key={feature.id} className="feature-row">
                      <div className="feature-row-text">
                        <Title order={4} className="feature-row-title">
                          {feature.label}
                        </Title>
                        <Text className="settings-caption">
                          {feature.description}
                        </Text>
                      </div>
                      <Select
                        aria-label={`${feature.label} model`}
                        value={choice.model}
                        disabled={!custom || busy}
                        styles={lockedInput}
                        searchable
                        allowDeselect={false}
                        maxDropdownHeight={320}
                        comboboxProps={{
                          classNames: {
                            dropdown:
                              "settings-dropdown settings-model-dropdown",
                          },
                        }}
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
                        aria-label={`${feature.label} reasoning effort`}
                        value={choice.effort}
                        disabled={!custom || busy}
                        styles={lockedInput}
                        allowDeselect={false}
                        comboboxProps={{
                          classNames: { dropdown: "settings-dropdown" },
                        }}
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
                    </div>
                  );
                })}
              </div>
              <Text className="settings-caption feature-footnote">
                Changes apply to the next request, including in an existing
                conversation. A running reply keeps its settings. Model choices
                come from your connected runtime; access is confirmed when a
                request runs.
              </Text>
            </Paper>
            <div className="settings-savebar" data-dirty={dirty || undefined}>
              <Text size="sm" role="status" className="settings-savebar-status">
                {notice || (dirty ? "Unsaved changes" : "Saved on this device")}
              </Text>
              <Button onClick={save} loading={busy} disabled={busy || !dirty}>
                Save settings
              </Button>
            </div>
          </>
        )}
      </Stack>
    </div>
  );
}
