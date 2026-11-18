"use client";

import { HeroDemo, TypesDemo } from "@/demos/client";

export function CaptureDemo({ demo }: { demo: "hero" | "types" }) {
  return demo === "types" ? (
    <div className="dev-demo">
      <TypesDemo />
    </div>
  ) : (
    <div className="hero">
      <div className="hero-demo">
        <HeroDemo />
      </div>
    </div>
  );
}
