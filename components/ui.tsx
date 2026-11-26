"use client";

import {
  ActionIcon,
  Button as MantineButton,
  Paper,
  SegmentedControl,
  Tabs,
  Textarea as MantineTextarea,
  TextInput as MantineTextInput,
  UnstyledButton,
} from "@mantine/core";
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  ReactNode,
} from "react";

// Preserve the app's action callbacks and layout hooks while standardizing its
// controls on Mantine. Complex list rows stay unstyled buttons deliberately.
export function Button({
  className = "",
  children,
  ...props
}: ComponentPropsWithRef<"button">) {
  if (/\b(icon-button|workspace-home|modal-close)\b/.test(className))
    return (
      <ActionIcon variant="subtle" size="lg" className={className} {...props}>
        {children}
      </ActionIcon>
    );
  const standard = /\b(button|text-button|workspace-toggle|toggle)\b/.test(
    className,
  );
  if (!standard)
    return (
      <UnstyledButton className={className} {...props}>
        {children}
      </UnstyledButton>
    );
  const variant = className.includes("primary")
    ? "filled"
    : className.includes("secondary")
      ? "default"
      : className.includes("workspace-toggle") && className.includes("active")
        ? "light"
        : "subtle";
  return (
    <MantineButton
      variant={variant}
      size={className.includes("text-button") ? "compact-xs" : "sm"}
      className={className}
      {...props}
    >
      {children}
    </MantineButton>
  );
}

export function TextInput({
  className = "",
  ...props
}: Omit<ComponentPropsWithRef<"input">, "size">) {
  return (
    <MantineTextInput
      className="duo-text-input"
      classNames={{ input: className }}
      {...props}
    />
  );
}
export function Textarea({
  className = "",
  ...props
}: ComponentPropsWithRef<"textarea">) {
  return (
    <MantineTextarea
      className="duo-textarea"
      classNames={{ input: className }}
      {...props}
    />
  );
}
export function Panel({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"section">) {
  const card = className.split(" ").includes("panel");
  return (
    <Paper
      component="section"
      withBorder={card}
      radius={card ? "lg" : 0}
      className={className}
      {...props}
    />
  );
}

// One page title block for every top-level page. Emits the legacy
// `.page-heading.compact` layout so existing responsive rules keep applying.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading compact page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {description && (
          <p className="page-header-description">{description}</p>
        )}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

export type PageTab<T extends string> = {
  value: T;
  label: ReactNode;
  /** Optional count shown as a small badge after the label. */
  count?: number;
};

// The single second-level tab strip (Settings, Progress, Coach memory).
// Compose with <PageTabPanel value="…"> children; only the active panel mounts.
export function PageTabs<T extends string>({
  tabs,
  value,
  defaultValue,
  onChange,
  children,
  "aria-label": ariaLabel,
}: {
  tabs: PageTab<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  children?: ReactNode;
  "aria-label": string;
}) {
  return (
    <Tabs
      className="page-tabs"
      value={value}
      defaultValue={defaultValue}
      onChange={(next) => {
        if (next) onChange?.(next as T);
      }}
      keepMounted={false}
    >
      <Tabs.List className="page-tabs-list" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className="page-tabs-tab"
            rightSection={
              tab.count === undefined ? undefined : (
                <span className="page-tabs-count">{tab.count}</span>
              )
            }
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {children}
    </Tabs>
  );
}

export function PageTabPanel({
  value,
  children,
}: {
  value: string;
  children?: ReactNode;
}) {
  return (
    <Tabs.Panel value={value} className="page-tabs-panel">
      {children}
    </Tabs.Panel>
  );
}

// Third-level switch inside a nested page (visually subordinate to PageTabs).
export function SectionSwitch<T extends string>({
  value,
  onChange,
  data,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  data: { value: T; label: ReactNode }[];
  "aria-label": string;
}) {
  return (
    <SegmentedControl
      className="section-switch"
      size="sm"
      aria-label={ariaLabel}
      value={value}
      onChange={(next) => onChange(next as T)}
      data={data}
    />
  );
}
