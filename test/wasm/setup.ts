import { registerVfs, sqlite3 } from "../../src/browser/sqlite.ts";
import { installNodeFsVfs } from "./sqlite-node-vfs.ts";

installNodeFsVfs(sqlite3, "nodefs");
registerVfs("nodefs");
