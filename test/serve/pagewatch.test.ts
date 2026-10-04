import { join } from "node:path";
import { test } from "vitest";
import { PageWatch } from "../../src/serve/pagewatch.ts";
import { tmpRoot, waitFor, write } from "../helpers.ts";

test("a save right after update resolves is never missed", async () => {
  for (let i = 0; i < 30; i++) {
    const root = tmpRoot();
    const file = join(root, ".pages/board.html");
    write(file, "<p>old</p>");
    const seen: string[][] = [];
    const watch = new PageWatch((pages) => seen.push(pages), 20);
    await watch.update([{ name: "board", path: file, title: "Board", access: {}, sql: false, network: [] }]);
    write(file, "<p>new</p>");
    await waitFor(() => seen.some((p) => p.includes("board")), 2000);
    await watch.close();
  }
}, 30000);
