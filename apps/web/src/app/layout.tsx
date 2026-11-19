import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xenon — the open-source CMS inside your Next.js app",
  description:
    "Xenon is a lightweight, code-first headless CMS. Define content in TypeScript, give editors a calm admin at /admin, keep everything in your own Postgres. MIT licensed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* The kit's Toast styles, served from a /kit/ path so stageshow's checks can tell kit rules from ours */}
        <link rel="stylesheet" href="/stageshow/kit/parts/Toast.css" precedence="default" />
        {children}
        <Analytics />
        <Script src="https://scripts.simpleanalyticscdn.com/latest.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
