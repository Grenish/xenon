"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Set this to the shell's .xenon-admin element so overlays inherit scoped tokens. */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({ value, children }: { value: HTMLElement | null; children: ReactNode }) {
  return <PortalContainerContext.Provider value={value}>{children}</PortalContainerContext.Provider>;
}

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
