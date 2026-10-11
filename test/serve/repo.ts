import { join } from "node:path";
import { commit, git, withRemote } from "../gitrepo.ts";
import { dataRoot, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

export const CONFIG = "tables:\n  tasks:\n    columns:\n      title: TEXT\n  people:\n    columns:\n      name: TEXT\n";

export async function repoServe(): Promise<{ t: Served; bare: string }> {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), CONFIG);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  write(join(root, "people.yaml"), "- id: 1\n  name: Alice\n");
  const bare = withRemote(root);
  const t = await startServe({}, undefined, { root, gh: null });
  // serve fills in yamlite.yaml on start; that is not part of what the tests change
  commit(root, "config");
  git(root, "push", "-q");
  return { t, bare };
}

export const edit = (t: Served, key: string, from: string, to: string) =>
  t.api(`/api/tables/tasks/rows/${key}`, { method: "PATCH", body: { values: { title: to }, base: { title: from } } });

export const gitOf = async (t: Served) => (await t.api("/api/git")).body.git;
