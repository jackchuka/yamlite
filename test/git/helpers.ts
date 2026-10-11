import { join } from "node:path";
import { findRepo } from "../../src/git/repo.ts";
import { dataRoot, write } from "../helpers.ts";
import { withRemote } from "../gitrepo.ts";

export async function setup() {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const bare = withRemote(root);
  const repo = (await findRepo(root))!;
  return { root, bare, repo };
}
export const noop = { gh: async () => null, expectBranch: "main", afterTreeChange: async () => {} };
