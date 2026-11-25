import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { readPreview } from "./preview";
import { Switcher } from "./switcher";
import "./starter.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
const syne = Syne({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-syne" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

export const metadata: Metadata = { title: "Starter preview · My Site" };

export default function StarterLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`starter-root ${plex.variable} ${plexMono.variable} ${syne.variable} ${bricolage.variable}`}>
      {children}
      <Suspense fallback={null}>
        <SwitcherSlot />
      </Suspense>
    </div>
  );
}

async function SwitcherSlot() {
  const { variant, state } = await readPreview();
  return <Switcher variant={variant} state={state} />;
}
