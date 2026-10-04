import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LoadFailure } from "@/components/LoadFailure";
import { isStaticPage } from "../mode";
import { buildPageLoader, LoadError, loadStatic } from "./load";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test("the page is static only when index.html says so", () => {
  expect(isStaticPage()).toBe(false);
  const meta = document.createElement("meta");
  meta.name = "yamlite-mode";
  meta.content = "static";
  document.head.append(meta);
  expect(isStaticPage()).toBe(true);
  meta.remove();
});

test("a missing database names the file that failed", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith("snapshot.json")
      ? json({ version: 1 })
      : new Response("", { status: 404, statusText: "Not Found" }),
  );
  const err = await loadStatic({ base: "https://x.test/repo/", fetcher: fetcher as typeof fetch }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LoadError);
  expect((err as LoadError).file).toBe("data/db.sqlite");
  expect(fetcher).toHaveBeenCalledWith("https://x.test/repo/data/db.sqlite");
});

test("loadYaml encodes the table name", async () => {
  const { buildYamlLoader } = await import("./load");
  const fetcher = vi.fn(async () => json({}));
  await buildYamlLoader("https://x.test/repo/", fetcher as unknown as typeof fetch)("a b#1");
  expect(fetcher).toHaveBeenCalledWith("https://x.test/repo/data/yaml/a%20b%231.json");
});

test("a file:// page explains that a web server is needed", () => {
  render(<LoadFailure error={new LoadError("data/snapshot.json", "Failed to fetch")} protocol="file:" />);
  expect(screen.getByRole("alert").textContent).toContain("data/snapshot.json");
  expect(screen.getByRole("alert").textContent).toContain("Web サーバー");
});

test("loadPage fetches the page's html next to the data", async () => {
  const fetcher = vi.fn(async () => new Response("<p>x</p>", { status: 200 }));
  const load = buildPageLoader("https://x.test/repo/", fetcher as typeof fetch);
  expect(await load("board")).toBe("<p>x</p>");
  expect(fetcher).toHaveBeenCalledWith("https://x.test/repo/data/pages/board.html");
});
