import { cn } from "@/lib/utils";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { DRAWER_BOUNDS, type WidthBounds } from "@/lib/panelWidth";

const RESIZE_STEP = 16;

export function PanelResizeHandle({
  width,
  label,
  onResize,
  edge = "left",
  bounds = DRAWER_BOUNDS,
}: {
  width: number;
  label: string;
  onResize: (w: number | null) => void;
  edge?: "left" | "right";
  bounds?: WidthBounds;
}) {
  const dir = edge === "left" ? -1 : 1;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    // without capture, the pointer entering a page's iframe stops the moves from reaching this document
    el.setPointerCapture?.(e.pointerId);
    document.body.setAttribute("data-resizing", "");
    const startX = e.clientX;
    const move = (ev: PointerEvent) => onResize(width + dir * (ev.clientX - startX));
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
      document.body.removeAttribute("data-resizing");
      // a drag released outside the panel ends in a click there, which would otherwise close it
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const delta = e.key === "ArrowLeft" ? -dir * RESIZE_STEP : e.key === "ArrowRight" ? dir * RESIZE_STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    onResize(width + delta);
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max()}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(null)}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 z-10 w-1 cursor-col-resize outline-none hover:bg-primary/40 focus-visible:bg-primary/40",
        edge === "left" ? "-left-0.5" : "-right-0.5",
      )}
    />
  );
}
