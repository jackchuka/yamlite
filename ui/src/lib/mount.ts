import { setAppLinkBuilder } from "./appMode";
import { setEmbedded } from "./embedded";
import { setReadOnly } from "./mode";
import { setPageFrame } from "./pageFrame";
import { readChoice, resolveTheme } from "./theme";

export interface MountOptions {
  readOnly?: boolean;
  // "container": the host sizes the element and the shell fills it, instead of the whole viewport
  fit?: "viewport" | "container";
  // the UI lives inside another product: no yamlite logo, no local paths or address
  embedded?: boolean;
  // a page on the host's origin running @jackchuka/yamlite/ui/page-frame, for a host whose policy refuses inline scripts
  pageFrame?: string;
  // shapes the link Copy app link produces, e.g. to point at the default branch; without it there is no Copy app link
  appLink?: (page: string) => string;
  // opens this page as an app: the editor stays out of reach, whatever the address says
  app?: string;
}

export function applyMountOptions(el: HTMLElement, o: MountOptions): void {
  setReadOnly(o.readOnly ?? false);
  setEmbedded(o.embedded ?? false);
  setPageFrame(o.pageFrame);
  setAppLinkBuilder(o.appLink ?? null);
  if (o.fit === "container") el.style.setProperty("--y-shell-h", "100%");
  else el.style.removeProperty("--y-shell-h");
  // yamlite's own page sets the theme in index.html before it loads; an embedding page has no such script
  document.documentElement.dataset.theme = resolveTheme(
    readChoice(),
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
