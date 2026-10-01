export interface BaseHashes {
  f: string | null;
  d: string | null;
}

export interface KeyState {
  key: string;
  f: string | null;
  d: string | null;
  base: BaseHashes | null;
  skip: boolean;
  equal: boolean;
  fTime?: number;
  dTime?: number;
}

export type Action = "none" | "base" | "drop" | "toDb" | "toFile";

export interface Decision {
  key: string;
  action: Action;
  conflict?: "file" | "db";
}

export interface Plan {
  decisions: Decision[];
  deleteDb: number;
  deleteFile: number;
  blocked: string | null;
}

export function decide(s: KeyState): Decision {
  const { key } = s;
  if (s.skip) return { key, action: "none" };
  const fileChanged = s.base ? s.f !== s.base.f : s.f !== null;
  const dbChanged = s.base ? s.d !== s.base.d : s.d !== null;
  if (!fileChanged && !dbChanged) return { key, action: "none" };
  if (fileChanged && !dbChanged) return { key, action: "toDb" };
  if (!fileChanged && dbChanged) return { key, action: "toFile" };
  if (s.f === null && s.d === null) return { key, action: "drop" };
  if (s.f !== null && s.d !== null && s.equal) return { key, action: "base" };
  const winner = s.dTime === undefined ? "db" : (s.fTime ?? 0) > s.dTime ? "file" : "db";
  return { key, action: winner === "file" ? "toDb" : "toFile", conflict: winner };
}

export function plan(states: readonly KeyState[], opts: { force: boolean }): Plan {
  const decisions: Decision[] = [];
  let deleteDb = 0;
  let deleteFile = 0;
  let baseCount = 0;
  let rowsLeft = 0;
  let filesLeft = 0;
  for (const s of states) {
    const d = decide(s);
    decisions.push(d);
    if (s.base) baseCount++;
    if (d.action === "toDb" && s.f === null && s.d !== null) deleteDb++;
    if (d.action === "toFile" && s.d === null && s.f !== null) deleteFile++;
    if (d.action === "toDb" ? s.f !== null : s.d !== null) rowsLeft++;
    if (d.action === "toFile" ? s.d !== null : s.f !== null) filesLeft++;
  }
  const limit = Math.max(10, Math.floor(baseCount * 0.5));
  // a single deletion may empty a one-record table; more than one that empties a side looks like a wipe
  const wipe = (deleteDb > 1 && rowsLeft === 0) || (deleteFile > 1 && filesLeft === 0);
  let blocked: string | null = null;
  if (!opts.force && (deleteDb > limit || deleteFile > limit)) {
    blocked = `refusing to delete ${deleteDb} rows and ${deleteFile} files (limit ${limit}); rerun with --force`;
  } else if (!opts.force && wipe) {
    blocked = `refusing to delete ${deleteDb} rows and ${deleteFile} files: that would delete every record of the table; rerun with --force`;
  }
  return { decisions, deleteDb, deleteFile, blocked };
}
