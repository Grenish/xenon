"use client";

import dynamic from "next/dynamic";

// The stages measure the DOM and run on a clock, so they render on the client only.
// Their wrappers reserve the design's aspect ratio, so nothing shifts when they mount.
export const HeroDemo = dynamic(() => import("./hero-demo").then((m) => m.HeroDemo), { ssr: false });
export const TypesDemo = dynamic(() => import("./types-demo").then((m) => m.TypesDemo), { ssr: false });
