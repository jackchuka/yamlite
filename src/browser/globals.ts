// what a Node module expects to find as globals, for the worker that runs yamlite's core in a browser
import { Buffer } from "buffer";

const g = globalThis as Record<string, unknown>;
g.Buffer ??= Buffer;
g.global ??= globalThis;
g.process ??= {
  env: {},
  pid: 1,
  platform: "browser",
  argv: [],
  versions: {},
  cwd: () => "/",
  kill: () => true,
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  emitWarning: () => {},
  on: () => {},
  once: () => {},
  getuid: () => 1000,
};
