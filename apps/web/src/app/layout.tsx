import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { homeTitle, origin, summary } from "@/seo/site";
import { siteSchema, StructuredData } from "@/seo/structured-data";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: homeTitle,
  description: summary,
  twitter: { card: "summary_large_image", images: [{ url: "/opengraph-image", alt: homeTitle }] },
  robots: { googleBot: { "max-image-preview": "large" } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <StructuredData data={siteSchema} />
      </head>
      <body>
        {/* The kit's Toast styles, served from a /kit/ path so stageshow's checks can tell kit rules from ours */}
        <link rel="stylesheet" href="/stageshow/kit/parts/Toast.css" precedence="default" />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
