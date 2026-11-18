"use client";
import { createContext, type ReactNode, useContext } from "react";
import type { AdminContextValue } from "./services";

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ value, children }: { value: AdminContextValue; children: ReactNode }) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

/** Admin config, current user and services. Only usable inside the admin shell. */
export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("[xenon] useAdmin() must be used inside <AdminProvider>.");
  return ctx;
}
