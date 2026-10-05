#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Command } from "commander";
import { checkReport, displayPath, painter, reloadLine, report, watchEvents, watchHeader } from "./format.ts";
import { check, exportSite, formatCsv, formatJson, formatTable, generateConfig, init, open, query } from "./index.ts";
import { serve } from "./serve/index.ts";
import { isLoopback } from "./serve/security.ts";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const collect = (value: string, previous: string[]) => [...previous, value];
const out = painter(process.stdout);
const err = painter(process.stderr);

function withRoot(cmd: Command): Command {
  return cmd
    .argument("[root]", "data directory", ".")
    .option("--db <path>", "SQLite database (default: <root>/.yamlite/db.sqlite)");
}

const program = new Command()
  .name("yamlite")
  .description("Sync YAML files and SQLite in both directions")
  .version(version);

withRoot(program.command("init").description("create yamlite.yaml from the YAML files and the existing database"))
  .option("--force", "overwrite an existing yamlite.yaml")
  .option("--print", "print the generated yamlite.yaml instead of writing it")
  .action((root: string, o: { db?: string; force?: boolean; print?: boolean }) => {
    if (o.print) {
      process.stdout.write(generateConfig({ root, db: o.db, force: true }));
      return;
    }
    const result = init({ root, db: o.db, force: o.force });
    const tables = result.tables.length > 0 ? result.tables.join(", ") : "no tables yet";
    console.log(`${out("green", "✓")} wrote ${displayPath(result.path)} ${out("dim", `· ${tables}`)}`);
    console.log(`  next: ${out("bold", "yamlite status")} to preview, ${out("bold", "yamlite sync")} to apply`);
  });

program
  .command("check")
  .description("check the YAML files against yamlite.yaml without writing anything; exits 1 on any problem")
  .argument("[root]", "data directory", ".")
  .option("--table <name>", "only this table (repeatable)", collect, [])
  .option("--json", "print JSON")
  .action(async (root: string, o: { table: string[]; json?: boolean }) => {
    const result = await check({ root, tables: o.table });
    if (o.json) console.log(JSON.stringify(result, null, 2));
    else console.log(checkReport(result, { root: resolve(root), paint: out }));
    if (!result.ok) process.exitCode = 1;
  });

const FORMATS = { table: formatTable, json: formatJson, csv: formatCsv } as const;

program
  .command("query")
  .description("run one read-only SQL statement against the YAML files (or --db) and print the rows")
  .argument("<sql>", "the statement")
  .argument("[root]", "data directory", ".")
  .option("--db <path>", "read this database as it is instead of the YAML files")
  .option("--format <format>", "table, json or csv", "table")
  .option("--limit <n>", "at most this many rows; 0 for no limit", "1000")
  .action(async (sql: string, root: string, o: { db?: string; format: string; limit: string }) => {
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format}: use table, json or csv`);
    const format = FORMATS[o.format as keyof typeof FORMATS];
    const limit = Number(o.limit);
    if (!Number.isInteger(limit) || limit < 0) throw new Error(`--limit must be a whole number, not ${o.limit}`);
    const r = await query({ root, db: o.db, sql, limit });
    for (const w of r.warnings) console.error(`${err("yellow", "!")} ${w}`);
    process.stdout.write(o.format === "csv" ? format(r) : `${format(r)}\n`);
    if (o.format === "table") console.error(err("dim", `${r.rows.length} ${r.rows.length === 1 ? "row" : "rows"}`));
    if (r.truncated) console.error(err("yellow", `… truncated at ${limit} rows (use --limit)`));
  });

withRoot(program.command("status").description("show what sync would change, without writing"))
  .option("--table <name>", "only this table (repeatable)", collect, [])
  .option("--json", "print JSON")
  .action(async (root: string, o: { db?: string; table: string[]; json?: boolean }) => {
    const y = await open({ root, db: o.db });
    try {
      const results = await y.status({ tables: o.table });
      if (o.json) console.log(JSON.stringify(results, null, 2));
      else console.log(report(results, { mode: "status", root: resolve(root), paint: out }));
    } finally {
      await y.close();
    }
  });

withRoot(program.command("sync").description("sync once"))
  .option("--table <name>", "only this table (repeatable)", collect, [])
  .option("--force", "allow mass deletions")
  .option("--force-convert", "clear values that cannot be converted when a column type changes")
  .option("--json", "print JSON")
  .action(
    async (
      root: string,
      o: { db?: string; table: string[]; force?: boolean; forceConvert?: boolean; json?: boolean },
    ) => {
      const y = await open({ root, db: o.db });
      try {
        const started = performance.now();
        const results = await y.sync({ tables: o.table, force: o.force, forceConvert: o.forceConvert });
        const elapsedMs = performance.now() - started;
        if (o.json) console.log(JSON.stringify(results, null, 2));
        else console.log(report(results, { mode: "sync", root: resolve(root), paint: out, elapsedMs }));
        if (results.some((r) => !r.ok)) process.exitCode = 1;
      } finally {
        await y.close();
      }
    },
  );

withRoot(program.command("watch").description("sync continuously"))
  .option("--quiet", "only print conflicts and errors")
  .action(async (root: string, o: { db?: string; quiet?: boolean }) => {
    const y = await open({ root, db: o.db });
    const nameWidth = () => Math.max(0, ...y.tables.map((t) => t.name.length));
    const w = y.watch({
      onSync: (r) => {
        const opts = {
          root: resolve(root),
          now: new Date(),
          paint: out,
          quiet: o.quiet ?? false,
          nameWidth: nameWidth(),
        };
        for (const line of watchEvents(r, opts)) console.log(line);
      },
      onReload: (tables) => {
        if (!o.quiet) console.log(reloadLine(tables, new Date(), out));
      },
      onError: (e, table) => {
        if (table === undefined) console.error(painter(process.stderr)("red", `error: ${e.message}`));
      },
    });
    await w.ready;
    if (!o.quiet)
      console.log(
        `${watchHeader(
          y.tables.map((t) => t.name),
          resolve(root),
          out,
        )}\n`,
      );
    const stop = () => {
      void y.close().then(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  // a missing opener is not an error: the URL is printed anyway
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

withRoot(program.command("serve").description("open the web UI and sync continuously"))
  .option("--port <number>", "port to listen on", "4610")
  .option("--host <address>", "address to listen on", "127.0.0.1")
  .option("--open", "open the UI in the browser")
  .action(async (root: string, o: { db?: string; port: string; host: string; open?: boolean }) => {
    const port = Number(o.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${o.port}`);
    const s = await serve({ root, db: o.db, port, host: o.host });
    if (!isLoopback(o.host)) {
      console.error(
        painter(process.stderr)(
          "yellow",
          `warning: listening on ${o.host}; anyone who can reach it and has the token can read and change the data`,
        ),
      );
    }
    console.log(`${out("green", "✓")} yamlite UI · ${out("bold", s.url)}`);
    console.log(out("dim", `  watching ${displayPath(resolve(root))} · Ctrl+C to stop`));
    if (o.open) openBrowser(s.url);
    let stopping = false;
    const stop = () => {
      // a second signal gives up on a close that hangs
      if (stopping) process.exit(130);
      stopping = true;
      s.close().then(
        () => process.exit(0),
        (e: unknown) => {
          console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        },
      );
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

program
  .command("export")
  .description("write the web UI as a read-only static site")
  .argument("[root]", "data directory", ".")
  .option("--out <dir>", "output folder", ".yamlite-export")
  .option("--table <name>", "only this table (repeatable)", collect, [])
  .option("--force", "replace an output folder that is not a previous export")
  .action(async (root: string, o: { out: string; table: string[]; force?: boolean }) => {
    const r = await exportSite({ root, out: o.out, tables: o.table, force: o.force });
    const count = `${r.tables.length} ${r.tables.length === 1 ? "table" : "tables"}`;
    console.log(`${out("green", "✓")} exported ${count} to ${displayPath(r.out)}`);
    for (const [table, warnings] of Object.entries(r.warnings)) {
      for (const w of warnings) console.log(`  ${out("yellow", "!")} ${table}: ${w}`);
    }
    for (const [page, reason] of Object.entries(r.skippedPages)) {
      console.log(`  ${out("yellow", "!")} page ${page} not exported: ${reason}`);
    }
    console.log(out("dim", "  serve the folder over HTTP to open it; file:// does not work"));
  });

program.parseAsync().catch((e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
