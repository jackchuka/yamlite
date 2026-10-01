#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Command } from "commander";
import { displayPath, painter, reloadLine, report, watchEvents, watchHeader } from "./format.ts";
import { generateConfig, init, open } from "./index.ts";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const collect = (value: string, previous: string[]) => [...previous, value];
const out = painter(process.stdout);

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

program.parseAsync().catch((e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
