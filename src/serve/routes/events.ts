import { STREAMED } from "../http.ts";
import type { Routes } from "./index.ts";

export const eventRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/events", ({ res }) => {
    ctx.hub.subscribe(res);
    return STREAMED;
  });
};
