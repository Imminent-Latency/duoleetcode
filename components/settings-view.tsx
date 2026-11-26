"use client";
import type { ReactNode } from "react";
import { PageHeader, PageTabPanel, PageTabs } from "./ui";

export type SettingsPage = "general" | "connections" | "data" | "diagnostics";
export const SETTINGS_PAGE_LABELS: Record<SettingsPage, string> = {
  general: "General",
  connections: "Connections",
  data: "Data & snapshots",
  diagnostics: "Diagnostics",
};
const ORDER: SettingsPage[] = ["general", "connections", "data", "diagnostics"];

// Settings hub: one page title plus the second-level tab strip. Workspace
// builds each nested page element (they need its state) and passes them in;
// only the active one is mounted.
export type SettingsViewProps = {
  page: SettingsPage;
  onPageChange: (page: SettingsPage) => void;
  pages: Record<SettingsPage, ReactNode>;
};

export default function SettingsView({
  page,
  onPageChange,
  pages,
}: SettingsViewProps) {
  return (
    <div className="page-content settings-page">
      <PageHeader title="Settings" />
      <PageTabs
        aria-label="Settings sections"
        value={page}
        onChange={onPageChange}
        tabs={ORDER.map((value) => ({
          value,
          label: SETTINGS_PAGE_LABELS[value],
        }))}
      >
        {ORDER.map((value) => (
          <PageTabPanel key={value} value={value}>
            {pages[value]}
          </PageTabPanel>
        ))}
      </PageTabs>
    </div>
  );
}
