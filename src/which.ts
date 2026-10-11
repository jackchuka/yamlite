import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const path = join(dir, cmd + ext);
      try {
        if (!statSync(path).isFile()) continue;
        accessSync(path, constants.X_OK);
        return path;
      } catch {
        // not here
      }
    }
  }
  return null;
}
