import type { ApiContext } from "../context.ts";
import type { Router } from "../http.ts";
import { agentRoutes } from "./agent.ts";
import { conflictRoutes } from "./conflicts.ts";
import { eventRoutes } from "./events.ts";
import { gitRoutes } from "./git.ts";
import { historyRoutes } from "./history.ts";
import { metaRoutes } from "./meta.ts";
import { pageAiRoutes } from "./pageai.ts";
import { pageRoutes } from "./pages.ts";
import { rowRoutes } from "./rows.ts";
import { rulesRoutes } from "./rules.ts";
import { schemaRoutes } from "./schema.ts";
import { searchRoutes } from "./search.ts";
import { sqlRoutes } from "./sql.ts";
import { tableRoutes } from "./tables.ts";

export type Routes = (router: Router, ctx: ApiContext) => void;

export const ROUTES: Routes[] = [
  metaRoutes,
  eventRoutes,
  rowRoutes,
  searchRoutes,
  historyRoutes,
  schemaRoutes,
  tableRoutes,
  rulesRoutes,
  sqlRoutes,
  pageRoutes,
  pageAiRoutes,
  conflictRoutes,
  agentRoutes,
  gitRoutes,
];
