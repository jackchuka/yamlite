import { join } from "node:path";
import { withRemote } from "../gitrepo.ts";
import { dataRoot, write } from "../helpers.ts";
import type { ServeOptions } from "../../src/serve/index.ts";
import { type Served, startServe } from "./helpers.ts";

export const CONFIG = "tables:\n  tasks:\n    columns:\n      title: TEXT\n  people:\n    columns:\n      name: TEXT\n";

export async function repoServe(opts: Partial<ServeOptions> = {}): Promise<{ t: Served; bare: string }> {
  const root = dataRoot();
  // as serve fills it in on start, so the first commit already has it
  write(join(root, "yamlite.yaml"), `${CONFIG}      id: INTEGER\n`);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  write(join(root, "people.yaml"), "- id: 1\n  name: Alice\n");
  const bare = withRemote(root);
  const t = await startServe({}, undefined, { root, gh: null, ...opts });
  return { t, bare };
}

export const edit = (t: Served, key: string, from: string, to: string) =>
  t.api(`/api/tables/tasks/rows/${key}`, { method: "PATCH", body: { values: { title: to }, base: { title: from } } });

export const gitOf = async (t: Served) => (await t.api("/api/git")).body.git;
