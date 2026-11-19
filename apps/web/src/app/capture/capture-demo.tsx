"use client";

import { HeroDemo, TypesDemo } from "@/demos/client";

export function CaptureDemo({ demo }: { demo: "hero" | "types" }) {
  return demo === "types" ? (
    <div className="dev-demo mx-auto max-w-[800px]">
      <TypesDemo />
    </div>
  ) : (
    <div className="px-gutter">
      <div className="band-demo">
        <HeroDemo />
      </div>
    </div>
  );
}
