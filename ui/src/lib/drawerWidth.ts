import { useState } from "react";

export const DEFAULT_WIDTH = 360;
export const MIN_WIDTH = 320;
const KEY = "yamlite-drawer-width";

export const maxWidth = () => Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7));
const clamp = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

function read(key: string, initial: number): number {
  try {
    const v = localStorage.getItem(key);
    return v !== null && Number.isFinite(Number(v)) ? clamp(Number(v)) : initial;
  } catch {
    return initial;
  }
}

// the record panel's width, kept across records and reloads; null puts it back to the default
export function useDrawerWidth(key = KEY, initial = DEFAULT_WIDTH): [number, (w: number | null) => void] {
  const [width, setWidth] = useState(() => read(key, initial));
  const set = (w: number | null) => {
    const next = w === null ? initial : clamp(w);
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
