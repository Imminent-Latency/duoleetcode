import type { Metadata } from "next";
import "@mantine/core/styles.css";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import AppProvider from "@/components/app-provider";
import "./globals.css";
import "./mantine.css";
export const metadata: Metadata = {
  title: "DuoLeetCode · A little better, every session",
  description: "A focused loop for coding practice, evidence, and learning.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" {...mantineHtmlProps} style={{ colorScheme: "dark" }}>
      <head>
        <ColorSchemeScript forceColorScheme="dark" />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
