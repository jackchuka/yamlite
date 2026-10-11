import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type FakeReply, fakeAnthropic } from "../fixtures/fake-anthropic.ts";

const bin = resolve(import.meta.dirname, "../../dist/cli.mjs");

export async function agentEnv(replies: FakeReply[]): Promise<Record<string, string>> {
  const fake = await fakeAnthropic(replies);
  return { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: fake.url, OPENAI_API_KEY: "" };
}

export interface Running {
  root: string;
  url: string;
  child: ChildProcess;
}

export function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

export async function stop(child: ChildProcess): Promise<void> {
  if (exited(child)) return;
  const done = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGINT");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await done;
  clearTimeout(timer);
}

export async function start(
  files: Record<string, string>,
  track?: (r: Running) => void,
  config?: string,
  env: Record<string, string> = {},
  // runs on the files before serve starts, e.g. to make the folder a git repository
  prepare?: (root: string) => void,
): Promise<Running> {
  const root = mkdtempSync(join(tmpdir(), "yamlite-e2e-"));
  put(join(root, "yamlite.yaml"), config ?? "tables: {}\n");
  for (const [path, content] of Object.entries(files)) put(join(root, path), content);
  prepare?.(root);
  const child = spawn(process.execPath, [bin, "serve", root, "--port", "0"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...env },
  });
  const running: Running = { root, url: "", child };
  track?.(running);
  running.url = await new Promise<string>((done, fail) => {
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error(`serve did not print its URL within 15s: ${out}`));
    }, 15_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const m = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/.exec(out);
      if (m?.[1]) {
        clearTimeout(timer);
        done(m[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`serve exited with ${code}: ${out}`));
    });
  });
  return running;
}

export function sqlite(root: string, query: string): void {
  const db = new DatabaseSync(join(root, ".yamlite", "db.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(query);
  } finally {
    db.close();
  }
}

export const file = (app: Running, path: string) => readFileSync(join(app.root, path), "utf8");
