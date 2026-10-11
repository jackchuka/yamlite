import { useState } from "react";

export type WidthBounds = { min: number; max: () => number };

export const DRAWER_BOUNDS: WidthBounds = {
  min: 320,
  max: () => Math.max(320, Math.floor(window.innerWidth * 0.7)),
};
export const SIDEBAR_BOUNDS: WidthBounds = {
  min: 180,
  max: () => Math.max(180, Math.min(480, Math.floor(window.innerWidth * 0.4))),
};

const clamp = (w: number, b: WidthBounds) => Math.min(b.max(), Math.max(b.min, Math.round(w)));

function read(key: string, initial: number, bounds: WidthBounds): number {
  try {
    const v = localStorage.getItem(key);
    return v !== null && Number.isFinite(Number(v)) ? clamp(Number(v), bounds) : initial;
  } catch {
    return initial;
  }
}

// a resizable panel's width, kept across reloads; null puts it back to the default
export function usePanelWidth(
  key: string,
  initial: number,
  bounds = DRAWER_BOUNDS,
): [number, (w: number | null) => void] {
  const [width, setWidth] = useState(() => read(key, initial, bounds));
  const set = (w: number | null) => {
    const next = w === null ? initial : clamp(w, bounds);
    setWidth(next);
    try {
      if (w === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(next));
    } catch {
      // the width still applies for this session
    }
  };
  return [width, set];
}
