import { createRootRoute, createRoute } from "@tanstack/react-router";
import type { Filter } from "./lib/types";

export interface TableSearch {
  key?: string;
  sort?: string;
  q?: string;
  filter?: Filter[];
}

export const rootRoute = createRootRoute();

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
