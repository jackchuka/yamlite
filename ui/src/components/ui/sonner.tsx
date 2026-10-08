"use client";

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// applyTheme() sets data-theme on <html>; follow it so open toasts re-theme
const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const currentTheme = () => document.documentElement.dataset.theme as ToasterProps["theme"];

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // an open modal turns pointer events off on <body>; a toast's action must stay clickable over it
          pointerEvents: "auto",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
