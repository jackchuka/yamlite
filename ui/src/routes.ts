import { createRootRouteWithContext, createRoute, redirect } from "@tanstack/react-router";
import type { Filter } from "./lib/types";

export interface TableSearch {
  key?: string;
  sort?: string;
  q?: string;
  filter?: Filter[];
}

// app: the page the entry opened as an app; the router never leaves it for the editor or another page
export interface RouterContext {
  app: string | undefined;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, matches }) => {
    if (context.app === undefined) return;
    const leaf = matches.at(-1);
    if (leaf?.routeId === "/app/$page" && (leaf.params as { page?: string }).page === context.app) return;
    throw redirect({ to: "/app/$page", params: { page: context.app }, replace: true });
  },
});

export const tableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/t/$table",
  validateSearch: (s: Record<string, unknown>): TableSearch => ({
    key: typeof s.key === "string" ? s.key : undefined,
    sort: typeof s.sort === "string" ? s.sort : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    filter: Array.isArray(s.filter) ? (s.filter as Filter[]) : undefined,
  }),
});

export const sqlRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sql" });
export const syncRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sync" });
export const erdRoute = createRoute({ getParentRoute: () => rootRoute, path: "/erd" });
export const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$page" });
// reached only from an app entry; a typed or old #/app/ address opens the page in the editor
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/$page",
  beforeLoad: ({ context, params }) => {
    if (context.app === undefined) throw redirect({ to: "/p/$page", params: { page: params.page }, replace: true });
  },
});

export interface SearchPageSearch {
  q?: string;
}

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (s: Record<string, unknown>): SearchPageSearch => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
});
