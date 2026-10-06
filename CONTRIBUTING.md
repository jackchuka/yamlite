# Contributing

Thanks for taking a look. Issues and pull requests are both welcome.

## Setup

```sh
pnpm install
pnpm check               # typecheck, lint, test, build
```

Needs Node 24.16 or newer (yamlite uses the built-in `node:sqlite`). `pnpm build && node dist/cli.mjs <command>` runs the CLI from source.

## Working on the web UI

The UI lives in `ui/` (React, Vite, Tailwind, shadcn/ui) and is bundled into `dist/ui/` by `pnpm build`; none of its packages are runtime dependencies.

```bash
node dist/cli.mjs serve ./some-data      # prints http://127.0.0.1:4610/?token=…
YAMLITE_TOKEN=<token> pnpm dev:ui         # Vite with hot reload, proxying /api to that server
pnpm test:e2e                             # Playwright against dist/ (run pnpm build first)
```

UI text lives in `ui/messages/en.json` and `ui/messages/ja.json`; components call `m.<key>()` from `@/paraglide/messages.js`. Add every new key to both files: a test fails when their keys differ, and `pnpm lint` rejects hard-coded text in JSX. Run `pnpm i18n` after editing the messages if your editor's type checker does not pick them up.

## Scope

yamlite never loses data silently. A change that could overwrite a file, delete a row, or drop a column must be guarded the same way the existing paths are: unreadable files are skipped, mass deletions are refused without `--force`, and the losing side of a conflict is saved to `.yamlite/conflicts/`. Tests cover each of these; add one for any new path that writes.

## Pull requests

- Add tests for behavior changes. `vitest` covers the engine, sources, schema, CLI output and watch mode.
- Run `pnpm check` before pushing; CI runs the same thing on Node 24.16 and 26, on Linux and macOS.
- Keep commits conventional (`fix(engine): …`, `feat: …`), matching the existing history.
- Update the README when a command, option or `yamlite.yaml` field changes — it is the reference for both.

## Reporting bugs

Include the command you ran, your Node version and OS, the relevant part of `yamlite.yaml`, and a minimal set of YAML files that reproduces it. If a sync went wrong, the output of `yamlite status --json` before and after helps.
