import { setReadOnly } from "./mode";
import { readChoice, resolveTheme } from "./theme";

export interface MountOptions {
  readOnly?: boolean;
  // "container": the host sizes the element and the shell fills it, instead of the whole viewport
  fit?: "viewport" | "container";
}

export function applyMountOptions(el: HTMLElement, o: MountOptions): void {
  setReadOnly(o.readOnly ?? false);
  if (o.fit === "container") el.style.setProperty("--y-shell-h", "100%");
  else el.style.removeProperty("--y-shell-h");
  // yamlite's own page sets the theme in index.html before it loads; an embedding page has no such script
  document.documentElement.dataset.theme = resolveTheme(
    readChoice(),
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
