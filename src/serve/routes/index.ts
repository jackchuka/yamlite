import type { ApiContext } from "../context.ts";
import type { Router } from "../http.ts";
import { conflictRoutes } from "./conflicts.ts";
import { eventRoutes } from "./events.ts";
import { metaRoutes } from "./meta.ts";
import { pageRoutes } from "./pages.ts";
import { rowRoutes } from "./rows.ts";
import { schemaRoutes } from "./schema.ts";
import { sqlRoutes } from "./sql.ts";
import { tableRoutes } from "./tables.ts";

export type Routes = (router: Router, ctx: ApiContext) => void;

export const ROUTES: Routes[] = [
  metaRoutes,
  eventRoutes,
  rowRoutes,
  schemaRoutes,
  tableRoutes,
  sqlRoutes,
  pageRoutes,
  conflictRoutes,
];
