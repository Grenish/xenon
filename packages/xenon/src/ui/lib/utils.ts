import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({ prefix: "xe" });

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
