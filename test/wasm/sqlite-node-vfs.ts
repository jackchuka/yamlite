// A synchronous VFS over node:fs for sqlite-wasm, standing in for the browser's OPFS SAH pool:
// real files at real paths, rollback journal only (no shared memory, so no WAL), locks kept in this process
import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync,
  constants as fsc,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NONE = 0;
const SHARED = 1;
const RESERVED = 2;
const EXCLUSIVE = 4;

interface OpenFile {
  path: string;
  fd: number;
  flags: number;
  level: number;
}

interface LockState {
  shared: Set<OpenFile>;
  reserved: OpenFile | null;
  pending: OpenFile | null;
  exclusive: OpenFile | null;
}

// oxlint-disable-next-line typescript/no-explicit-any
export function installNodeFsVfs(sqlite3: any, name = "nodefs"): void {
  const { capi, wasm } = sqlite3;
  const files = new Map<number, OpenFile>();
  const locks = new Map<string, LockState>();
  const lockOf = (path: string): LockState => {
    let l = locks.get(path);
    if (!l) locks.set(path, (l = { shared: new Set(), reserved: null, pending: null, exclusive: null }));
    return l;
  };
  const heap = (p: number | bigint, n: number) => wasm.heap8u().subarray(Number(p), Number(p) + n);
  let tmp = 0;

  const io = {
    xCheckReservedLock(pFile: number, pOut: number) {
      const f = files.get(pFile) as OpenFile;
      const l = lockOf(f.path);
      const held = [l.reserved, l.pending, l.exclusive].some((o) => o !== null && o !== f);
      wasm.poke32(pOut, held ? 1 : 0);
      return 0;
    },
    xClose(pFile: number) {
      const f = files.get(pFile);
      if (!f) return 0;
      files.delete(pFile);
      try {
        closeSync(f.fd);
        if (f.flags & capi.SQLITE_OPEN_DELETEONCLOSE) unlinkSync(f.path);
      } catch {
        return capi.SQLITE_IOERR_CLOSE;
      }
      return 0;
    },
    xDeviceCharacteristics: () => 0,
    xFileControl: () => capi.SQLITE_NOTFOUND,
    xFileSize(pFile: number, pSz64: number) {
      wasm.poke64(pSz64, BigInt(fstatSync((files.get(pFile) as OpenFile).fd).size));
      return 0;
    },
    xLock(pFile: number, level: number) {
      const f = files.get(pFile) as OpenFile;
      const l = lockOf(f.path);
      if (f.level >= level) return 0;
      const other = (o: OpenFile | null) => o !== null && o !== f;
      if (level === SHARED) {
        if (other(l.pending) || other(l.exclusive)) return capi.SQLITE_BUSY;
        l.shared.add(f);
      } else if (level === RESERVED) {
        if (other(l.reserved) || other(l.pending) || other(l.exclusive)) return capi.SQLITE_BUSY;
        l.reserved = f;
      } else if (level === EXCLUSIVE) {
        if (other(l.pending) || other(l.exclusive)) return capi.SQLITE_BUSY;
        l.pending = f;
        if ([...l.shared].some((o) => o !== f)) return capi.SQLITE_BUSY;
        l.exclusive = f;
      }
      f.level = level;
      return 0;
    },
    xRead(pFile: number, pDest: number, n: number, offset: bigint) {
      const f = files.get(pFile) as OpenFile;
      try {
        const got = readSync(f.fd, heap(pDest, n), 0, n, Number(offset));
        if (got < n) {
          heap(pDest, n).fill(0, got);
          return capi.SQLITE_IOERR_SHORT_READ;
        }
        return 0;
      } catch {
        return capi.SQLITE_IOERR_READ;
      }
    },
    xSectorSize: () => 4096,
    xSync: () => 0,
    xTruncate(pFile: number, size: bigint) {
      ftruncateSync((files.get(pFile) as OpenFile).fd, Number(size));
      return 0;
    },
    xUnlock(pFile: number, level: number) {
      const f = files.get(pFile) as OpenFile;
      const l = lockOf(f.path);
      if (level < EXCLUSIVE) {
        if (l.exclusive === f) l.exclusive = null;
        if (l.pending === f) l.pending = null;
      }
      if (level < RESERVED && l.reserved === f) l.reserved = null;
      if (level < SHARED) l.shared.delete(f);
      f.level = level;
      return 0;
    },
    xWrite(pFile: number, pSrc: number, n: number, offset: bigint) {
      const f = files.get(pFile) as OpenFile;
      try {
        return writeSync(f.fd, heap(pSrc, n), 0, n, Number(offset)) === n ? 0 : capi.SQLITE_IOERR_WRITE;
      } catch {
        return capi.SQLITE_IOERR_WRITE;
      }
    },
  };
  const ioStruct = new capi.sqlite3_io_methods();
  ioStruct.$iVersion = 1;
  sqlite3.vfs.installVfs({ io: { struct: ioStruct, methods: io } });

  const vfs = {
    xAccess(_pVfs: number, zName: number, _flags: number, pOut: number) {
      wasm.poke32(pOut, existsSync(wasm.cstrToJs(zName)) ? 1 : 0);
      return 0;
    },
    xCurrentTime(_pVfs: number, pOut: number) {
      wasm.poke(pOut, 2440587.5 + Date.now() / 864e5, "double");
      return 0;
    },
    xCurrentTimeInt64(_pVfs: number, pOut: number) {
      wasm.poke(pOut, 0xbfc83e532200 + Date.now(), "i64");
      return 0;
    },
    xDelete(_pVfs: number, zName: number) {
      try {
        unlinkSync(wasm.cstrToJs(zName));
        return 0;
      } catch {
        return capi.SQLITE_IOERR_DELETE_NOENT;
      }
    },
    xFullPathname(_pVfs: number, zName: number, nOut: number, pOut: number) {
      const full = wasm.allocCString(resolve(wasm.cstrToJs(zName)));
      try {
        return wasm.cstrncpy(pOut, full, nOut) < nOut ? 0 : capi.SQLITE_CANTOPEN;
      } finally {
        wasm.dealloc(full);
      }
    },
    xGetLastError: () => 0,
    xOpen(_pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number) {
      const named = zName && wasm.peek8(zName);
      const path = named ? wasm.cstrToJs(zName) : join(tmpdir(), `yamlite-wasm-${process.pid}-${tmp++}`);
      if (!named) flags |= capi.SQLITE_OPEN_DELETEONCLOSE;
      let mode = flags & capi.SQLITE_OPEN_READWRITE ? fsc.O_RDWR : fsc.O_RDONLY;
      if (flags & capi.SQLITE_OPEN_CREATE) mode |= fsc.O_CREAT;
      try {
        const fd = openSync(path, mode, 0o644);
        files.set(pFile, { path, fd, flags, level: NONE });
      } catch {
        return capi.SQLITE_CANTOPEN;
      }
      const s3 = new capi.sqlite3_file(pFile);
      s3.$pMethods = ioStruct.pointer;
      s3.dispose();
      if (pOutFlags) wasm.poke32(pOutFlags, flags);
      return 0;
    },
    xRandomness(_pVfs: number, nOut: number, pOut: number) {
      const h = wasm.heap8u();
      for (let i = 0; i < nOut; i++) h[Number(pOut) + i] = (Math.random() * 256) & 255;
      return nOut;
    },
    // single-threaded: whoever holds the lock cannot let go while we wait, so waiting gains nothing
    xSleep: () => 0,
  };
  const vfsStruct = new capi.sqlite3_vfs();
  vfsStruct.$iVersion = 2;
  vfsStruct.$szOsFile = capi.sqlite3_file.structInfo.sizeof;
  vfsStruct.$mxPathname = 1024;
  sqlite3.vfs.installVfs({ vfs: { struct: vfsStruct, methods: vfs, name, asDefault: true } });
}
