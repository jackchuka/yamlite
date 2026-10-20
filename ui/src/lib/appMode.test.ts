import { expect, test } from "vitest";
import { appEntry, appLink, setAppLinkBuilder } from "./appMode";

test("an app link is -/apps/<name>/ under the UI's base", () => {
  expect(appLink("team board", "http://127.0.0.1:4610/")).toBe("http://127.0.0.1:4610/-/apps/team%20board/");
  expect(appLink("board", "https://example.github.io/showcase/x/")).toBe(
    "https://example.github.io/showcase/x/-/apps/board/",
  );
  expect(appLink("board", "https://example.github.io/showcase/x/index.html")).toBe(
    "https://example.github.io/showcase/x/-/apps/board/",
  );
});

test("a host's builder shapes the app link", () => {
  setAppLinkBuilder((p) => "https://host/acme/tasks/-/apps/" + p);
  expect(appLink("board")).toBe("https://host/acme/tasks/-/apps/board");
  setAppLinkBuilder(undefined);
  expect(appLink("board", "http://127.0.0.1:4610/")).toBe("http://127.0.0.1:4610/-/apps/board/");
});

test("a host that gave no builder has no app link", () => {
  setAppLinkBuilder(null);
  expect(appLink("board", "http://127.0.0.1:4610/")).toBeNull();
  setAppLinkBuilder(undefined);
});

test("the entry address names the app, relative to the UI's base", () => {
  expect(appEntry("http://127.0.0.1:4610/-/apps/board/", "http://127.0.0.1:4610/")).toBe("board");
  expect(appEntry("http://127.0.0.1:4610/-/apps/board", "http://127.0.0.1:4610/")).toBe("board");
  expect(appEntry("http://127.0.0.1:4610/-/apps/team%20board/#/t/x", "http://127.0.0.1:4610/")).toBe("team board");
  expect(appEntry("https://h.io/showcase/x/-/apps/board/", "https://h.io/showcase/x/")).toBe("board");
  expect(appEntry("http://127.0.0.1:4610/", "http://127.0.0.1:4610/")).toBeUndefined();
  expect(appEntry("http://127.0.0.1:4610/#/app/board", "http://127.0.0.1:4610/")).toBeUndefined();
  expect(appEntry("https://h.io/-/apps/board/", "https://h.io/-/apps/board/")).toBeUndefined();
  expect(appEntry("http://127.0.0.1:4610/apps/board/", "http://127.0.0.1:4610/")).toBeUndefined();
  expect(appEntry("http://127.0.0.1:4610/-/apps/a/b/", "http://127.0.0.1:4610/")).toBeUndefined();
  expect(appEntry("http://127.0.0.1:4610/-/apps/%E0/", "http://127.0.0.1:4610/")).toBeUndefined();
});
