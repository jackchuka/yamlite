import { join } from "node:path";
import { expect, test } from "vitest";
import { open } from "../src/index.ts";
import { dataRoot, read, sql, write } from "./helpers.ts";

const db = (root: string) => join(root, ".yamlite", "db.sqlite");

test("an Obsidian-like vault syncs both ways and leaves everything but notes alone", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), 'tables:\n  notes:\n    files: "**/*.md"\n');
  write(join(root, "inbox.md"), "just text\n");
  write(join(root, "daily/2026-10-04.md"), "---\n# mood\ntitle: Day\ntags: [d]\n---\n\nBody\n---\nmore\n");
  write(join(root, ".obsidian/app.md"), "# settings\n");
  write(join(root, "img.png"), "PNG");
  write(join(root, "hugo.md"), "+++\ntitle = 'A'\n+++\nbody\n");
  const y = await open({ root });
  const [r] = await y.sync();
  expect(r?.ok).toBe(true);
  expect(r?.warnings.join("\n")).toContain("TOML front matter is not supported; skipped");
  expect(sql(db(root), "SELECT id, body FROM notes ORDER BY id")).toEqual([
    { id: "daily/2026-10-04", body: "\nBody\n---\nmore\n" },
    { id: "inbox", body: "just text\n" },
  ]);

  sql(db(root), "UPDATE notes SET title = 'Monday' WHERE id = 'daily/2026-10-04'");
  sql(db(root), "UPDATE notes SET body = 'new text' || char(10) WHERE id = 'inbox'");
  sql(db(root), "INSERT INTO notes (id, title, body) VALUES ('ideas/x', 'X', 'hi' || char(10))");
  await y.sync();
  expect(read(join(root, "daily/2026-10-04.md"))).toBe(
    "---\n# mood\ntitle: Monday\ntags: [d]\n---\n\nBody\n---\nmore\n",
  );
  expect(read(join(root, "inbox.md"))).toBe("new text\n");
  expect(read(join(root, "ideas/x.md"))).toBe("---\ntitle: X\n---\nhi\n");
  expect(read(join(root, "hugo.md"))).toBe("+++\ntitle = 'A'\n+++\nbody\n");
  expect(read(join(root, ".obsidian/app.md"))).toBe("# settings\n");
  await y.close();
});

test("an Astro-like posts folder: an UPDATE changes one front matter line and nothing else", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), 'tables:\n  posts:\n    files: "blog/**/*.md"\n    body: content\n');
  const post = "---\ntitle: Hello # shown in lists\ndraft: true\n---\n\n## Intro\n\nText.\n";
  write(join(root, "blog/hello.md"), post);
  const y = await open({ root });
  await y.sync();
  sql(db(root), "UPDATE posts SET draft = 0 WHERE id = 'hello'");
  await y.sync();
  expect(read(join(root, "blog/hello.md"))).toBe(post.replace("draft: true", "draft: false"));
  expect(sql(db(root), "SELECT content FROM posts")).toEqual([{ content: "\n## Intro\n\nText.\n" }]);
  await y.close();
});
