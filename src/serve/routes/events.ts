import type { Routes } from "./index.ts";

export const eventRoutes: Routes = (router, ctx) => {
  router.add(
    "GET",
    "/api/events",
    ({ signal }) =>
      new Response(ctx.hub.stream(signal), {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        },
      }),
  );
};
