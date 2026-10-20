import { expect, test } from "vitest";
import { createAppRouter } from "./router";

test("no navigation leaves an app: other screens and pages land back on the app's page", async () => {
  const router = createAppRouter("team board");
  const at = () => {
    const leaf = router.state.matches.at(-1);
    return [leaf?.routeId, (leaf?.params as { page?: string } | undefined)?.page];
  };
  await router.load();
  expect(at()).toEqual(["/app/$page", "team board"]);
  await router.navigate({ to: "/sync" });
  expect(at()).toEqual(["/app/$page", "team board"]);
  await router.navigate({ to: "/t/$table", params: { table: "tasks" } });
  expect(at()).toEqual(["/app/$page", "team board"]);
  await router.navigate({ to: "/app/$page", params: { page: "other" } });
  expect(at()).toEqual(["/app/$page", "team board"]);
});
