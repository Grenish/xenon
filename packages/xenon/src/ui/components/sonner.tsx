"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { RiCheckboxCircleLine, RiInformationLine, RiErrorWarningLine, RiCloseCircleLine, RiLoaderLine } from "@remixicon/react";
import { usePortalContainer } from "../lib/portal-container";

/** Toasts share the admin root's theme rather than the host application's theme. */
export function Toaster(props: ToasterProps) {
  const container = usePortalContainer();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    if (!container) return;
    const update = () => setTheme(container.classList.contains("dark") ? "dark" : "light");
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [container]);
  if (!container) return null;
  return createPortal(<Sonner
    position="bottom-right"
    closeButton
    {...props}
    theme={props.theme ?? theme}
    className="xe:group xe:font-sans"
    icons={{
      success: <RiCheckboxCircleLine className="xe:size-4" />,
      info: <RiInformationLine className="xe:size-4" />,
      warning: <RiErrorWarningLine className="xe:size-4" />,
      error: <RiCloseCircleLine className="xe:size-4" />,
      loading: <RiLoaderLine className="xe:size-4 xe:animate-spin" />,
    }}
    style={{ "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)", "--normal-border": "var(--border)", "--border-radius": "var(--radius)", ...props.style } as CSSProperties}
    toastOptions={{ ...props.toastOptions, classNames: {
      toast: "xe:font-sans xe:shadow-lg", description: "xe:text-muted-foreground!",
      ...props.toastOptions?.classNames,
    } }}
  />, container);
}
