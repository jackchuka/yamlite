import { createContext, useContext, useSyncExternalStore } from "react";
import { useRouteContext } from "@tanstack/react-router";

// an entry at -/apps/<name>/ opens that page as an app: it fills the screen, and the people it is shared with see none of the editor around it
// -/ is yamlite's own namespace, as in Cloud's /<owner>/<repo>/-/apps/<name>
export const useAppRoute = (): boolean => useRouteContext({ from: "__root__", select: (c) => c.app !== undefined });

// set by the shell, so parts inside the app (a record drawer's references) can leave out links into the editor
export const AppModeContext = createContext(false);
export const useAppMode = (): boolean => useContext(AppModeContext);

// a host links to the page where the latest data lives (Cloud: the default branch), which the current address may not be.
// null: a host that gave none, whose own address does not serve -/apps/, so there is no link to copy
let appLinkBuilder: ((page: string) => string) | null | undefined;
export const setAppLinkBuilder = (fn: ((page: string) => string) | null | undefined): void => {
  appLinkBuilder = fn;
};

// a host whose app link opens another branch than the one being viewed (Cloud: a review) also links to the page on
// this branch, so someone can see its edits before they are applied. get gives null where the app link already opens
// this branch; subscribe tells when the branch changes under a mounted UI
export interface BranchAppLink {
  get: (page: string) => string | null;
  subscribe: (onChange: () => void) => () => void;
}
let branchAppLinkSource: BranchAppLink | undefined;
export const setBranchAppLink = (s: BranchAppLink | undefined): void => {
  branchAppLinkSource = s;
};
const noSubscribe = () => () => {};
export function useBranchAppLink(page: string): string | null {
  const s = branchAppLinkSource;
  return useSyncExternalStore(s?.subscribe ?? noSubscribe, () => s?.get(page) ?? null);
}

// an element of the host's, shown at the left of the app's bar; the host renders into it whatever it adds there
let appFooterHost: HTMLElement | undefined;
export const setAppFooter = (el: HTMLElement | undefined): void => {
  appFooterHost = el;
};
export const appFooter = (): HTMLElement | undefined => appFooterHost;

export function appLink(page: string, base: string = document.baseURI): string | null {
  if (appLinkBuilder === null) return null;
  if (appLinkBuilder) return appLinkBuilder(page);
  return new URL(`-/apps/${encodeURIComponent(page)}/`, base).toString();
}

// the page an entry address opens as an app, read relative to the UI's base so a site under a sub-path works too
export function appEntry(href: string, base: string): string | undefined {
  const root = new URL(".", base).pathname;
  const path = new URL(href).pathname;
  if (!path.startsWith(root)) return undefined;
  const name = /^-\/apps\/([^/]+)\/?$/.exec(path.slice(root.length))?.[1];
  if (name === undefined) return undefined;
  try {
    return decodeURIComponent(name);
  } catch {
    return undefined;
  }
}
