import { useState } from "react";

export const DEFAULT_WIDTH = 360;
export const MIN_WIDTH = 320;
const KEY = "yamlite-drawer-width";

export const maxWidth = () => Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7));
const clamp = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

function read(): number {
  try {
    const v = localStorage.getItem(KEY);
    return v !== null && Number.isFinite(Number(v)) ? clamp(Number(v)) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

// the record panel's width, kept across records and reloads; null puts it back to the default
export function useDrawerWidth(): [number, (w: number | null) => void] {
  const [width, setWidth] = useState(read);
  const set = (w: number | null) => {
    const next = w === null ? DEFAULT_WIDTH : clamp(w);
    setWidth(next);
    try {
      if (w === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(next));
    } catch {
      // the width still applies for this session
    }
  };
  return [width, set];
}
