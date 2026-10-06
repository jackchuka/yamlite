import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setCommandMenuOpen(next: boolean | ((open: boolean) => boolean)): void {
  open = typeof next === "function" ? next(open) : next;
  for (const l of listeners) l();
}

export const openCommandMenu = (): void => setCommandMenuOpen(true);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useCommandMenuOpen = (): boolean => useSyncExternalStore(subscribe, () => open);
