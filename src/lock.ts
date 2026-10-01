import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireLock(stateDir: string): () => void {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "lock");
  const mine = String(process.pid);
  const tmpPath = join(stateDir, `lock.${process.pid}.tmp`);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(tmpPath, mine);
      try {
        linkSync(tmpPath, path);
      } finally {
        try {
          unlinkSync(tmpPath);
        } catch {
          // already gone
        }
      }
      return () => {
        try {
          if (readFileSync(path, "utf8") === mine) unlinkSync(path);
        } catch {
          // already gone
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Stale takeover: re-read immediately before unlinking
      try {
        const pidStr = readFileSync(path, "utf8");
        const pid = Number(pidStr);
        if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
          throw new Error(`another yamlite process (pid ${pid}) is running; lock file: ${path}`);
        }
        // Re-read to ensure we're still looking at the same stale lock
        const pidStrCheck = readFileSync(path, "utf8");
        if (pidStrCheck === pidStr) {
          unlinkSync(path);
        }
        // Otherwise loop again to retry
      } catch (innerE) {
        if ((innerE as NodeJS.ErrnoException).code === "ENOENT") {
          // Lock disappeared between reads; retry
          continue;
        }
        throw innerE;
      }
    }
  }
  throw new Error(`could not acquire lock: ${path}`);
}
