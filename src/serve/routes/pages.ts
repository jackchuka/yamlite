import { readFileSync, statSync } from "node:fs";
import type { PageSpec } from "../../types.ts";
import { type ApiContext, displayPath } from "../context.ts";
import { HttpError } from "../http.ts";
import type { Routes } from "./index.ts";

const MAX_PAGE_BYTES = 1_048_576;

export function readPageHtml(path: string, shown: string): string {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new HttpError(404, `page file is not a file: ${shown}`);
    size = st.size;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(404, `page file not found: ${shown}`);
  }
  if (size > MAX_PAGE_BYTES) throw new HttpError(413, `${shown} is larger than 1 MB`);
  return readFileSync(path, "utf8");
}

export function pageSpec(ctx: ApiContext, name: string): PageSpec {
  const page = ctx.y.pages.find((p) => p.name === name);
  if (!page) throw new HttpError(404, `unknown page: ${name}`);
  return page;
}

export const pageRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/pages/:page/html", ({ params }) => {
    const page = pageSpec(ctx, params.page as string);
    return { html: readPageHtml(page.path, displayPath(ctx.root, page.path)) };
  });
};
