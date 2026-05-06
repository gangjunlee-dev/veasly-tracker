import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veasly Tracker",
  description: "Cross-border order extraction console"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
