import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TikTok Studio",
  description: "Personal editor for short vertical videos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
