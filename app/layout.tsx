import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vivegam | Quality Lab",
  description: "A GenAI-assisted workspace for non-functional testing with open-source tools.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
