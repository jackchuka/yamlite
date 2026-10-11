import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { external, onRemove } from "../../src/browser/fs.ts";
import { registerVfs, sqlite3 } from "../../src/browser/sqlite.ts";
import { installNodeFsVfs } from "./sqlite-node-vfs.ts";

if (process.env.YAMLITE_FS === "browser") {
  // as in the browser, the database lives outside the in-memory tree (there in OPFS, here on the real disk), and the
  // tree hears of it through external and onRemove
  const root = mkdtempSync(join(tmpdir(), "yamlite-store-"));
  const store = (path: string) => join(root, path);
  installNodeFsVfs(sqlite3, "nodefs", store);
  external((path) => existsSync(store(path)));
  onRemove((path) => rmSync(store(path), { recursive: true, force: true }));
} else {
  installNodeFsVfs(sqlite3, "nodefs");
}
registerVfs("nodefs");
