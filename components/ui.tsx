"use client";

import {
  ActionIcon,
  Button as MantineButton,
  Paper,
  Textarea as MantineTextarea,
  TextInput as MantineTextInput,
  UnstyledButton,
} from "@mantine/core";
import type { ComponentPropsWithRef, ComponentPropsWithoutRef } from "react";

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
