import { setReadOnly } from "./mode";

export interface MountOptions {
  readOnly?: boolean;
  // "container": the host sizes the element and the shell fills it, instead of the whole viewport
  fit?: "viewport" | "container";
}

export function applyMountOptions(el: HTMLElement, o: MountOptions): void {
  setReadOnly(o.readOnly ?? false);
  if (o.fit === "container") el.style.setProperty("--y-shell-h", "100%");
  else el.style.removeProperty("--y-shell-h");
}
