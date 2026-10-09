import type { Snapshot } from "./types";

let snapshot: Snapshot | null = null;

export const isStaticPage = (): boolean =>
  document.querySelector('meta[name="yamlite-mode"]')?.getAttribute("content") === "static";

export function enterStatic(s: Snapshot | null): void {
  snapshot = s;
}

export const staticSnapshot = (): Snapshot | null => snapshot;

let forced = false;

// a host app turns the UI read-only, for example when the user may only view the repository
export function setReadOnly(on: boolean): void {
  forced = on;
}

// a static export answers from a snapshot, so nothing in it can be written
export const isReadOnly = (): boolean => snapshot !== null || forced;
