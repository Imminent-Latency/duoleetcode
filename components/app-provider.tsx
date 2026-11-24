"use client";

import {
  Button,
  createTheme,
  MantineProvider,
  Menu,
  Modal,
  NavLink,
  Paper,
  Select,
  Textarea,
  TextInput,
} from "@mantine/core";

const theme = createTheme({
  primaryColor: "mint",
  primaryShade: 5,
  autoContrast: true,
  fontFamily:
    '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace:
    '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  headings: { fontFamily: '"Manrope", "DM Sans", sans-serif' },
  defaultRadius: "md",
  colors: {
    mint: [
      "#eafaf2",
      "#d2f3e2",
      "#a9e6c9",
      "#7bd6ad",
      "#52c391",
      "#35ad78",
      "#269664",
      "#207c55",
      "#1d6246",
      "#194f3b",
    ],
    dark: [
      "#dce5e7",
      "#b2c2c7",
      "#8c9fa7",
      "#627780",
      "#3d5059",
      "#2b3b43",
      "#1e2b32",
      "#172128",
      "#111a20",
      "#0c1419",
    ],
  },
  components: {
    Button: Button.extend({
      defaultProps: { size: "sm", radius: "md" },
      classNames: { label: "duo-button-label" },
    }),
    TextInput: TextInput.extend({ defaultProps: { size: "sm" } }),
    Textarea: Textarea.extend({ defaultProps: { size: "sm" } }),
    Select: Select.extend({
      defaultProps: { size: "sm", radius: "md", checkIconPosition: "right" },
    }),
    Paper: Paper.extend({ defaultProps: { radius: "lg", withBorder: true } }),
    NavLink: NavLink.extend({
      defaultProps: { variant: "light" },
      classNames: { root: "duo-nav-link" },
    }),
    Menu: Menu.extend({
      defaultProps: {
        shadow: "lg",
        radius: "md",
        position: "bottom-end",
        withinPortal: true,
      },
    }),
    Modal: Modal.extend({
      defaultProps: {
        centered: true,
        radius: "lg",
        overlayProps: { backgroundOpacity: 0.65, blur: 4 },
      },
    }),
  },
});

export default function AppProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MantineProvider theme={theme} forceColorScheme="dark">
      {children}
    </MantineProvider>
  );
}
