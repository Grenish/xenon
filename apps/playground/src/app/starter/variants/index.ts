import type { ComponentType } from "react";
import type { PostCard, Setup } from "../data";
import type { Variant } from "../preview-shared";
import * as glow from "./glow";
import * as sheet from "./sheet";
import * as tiles from "./tiles";

export interface VariantModule {
  Home: ComponentType<{ posts: PostCard[]; setup: Setup }>;
  Article: ComponentType<{ card: PostCard }>;
}

export const variants: Record<Variant, VariantModule> = { sheet, glow, tiles };
