import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veasly Tracker",
  description: "Veasly order and invoice tracker"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
