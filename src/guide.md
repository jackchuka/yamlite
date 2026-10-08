# Writing yamlite.yaml

yamlite keeps a folder of YAML (and Markdown) files and a local SQLite database in sync in both directions. `yamlite.yaml` at the data root is the schema of record: it names the tables, pins column types and declares the rules yamlite checks. This guide is how to write it well. The full reference is the README: https://github.com/jackchuka/yamlite#configuration

## Workflow

1. **Look at the data.** Which folders hold one record per file? Which files hold a list of records? Where do Markdown notes live?
2. **Start from inference, never from a blank file.**

   ```sh
   yamlite init --print   # show what init would write, write nothing
   yamlite init           # write yamlite.yaml
   ```

   `init` finds every folder and list file directly under the root and infers column types from the values (and from an existing database). It adds `date` / `datetime` formats where every value has that shape. It never creates Markdown tables or tables outside the root: declare those yourself.

3. **Edit only what inference cannot know**: tables outside the root, Markdown tables, types that must not follow the data, and rules. Add a YAML comment where a choice is not obvious.
4. **Preview** with `yamlite status`. It writes nothing. `↻ column title TEXT → JSON` means a table rebuild for a type change; `+ column … (will be added to yamlite.yaml)` means yamlite found a key not yet declared.
5. **Sync** with `yamlite sync`. It appends the columns of tables you declared by hand (and any other new key) to `yamlite.yaml`.
6. **Validate** with `yamlite check`. It exits 1 on a failing table, a rule warning, or a column or table not yet in `yamlite.yaml` (`+ column … (not in yamlite.yaml)`; `yamlite sync` adds those). `--json` gives machine-readable output. Fix the data or the rule until it exits 0.
7. **Commit** `yamlite.yaml` with the data, and add `.yamlite/` (the database and its state) to `.gitignore`.

yamlite edits `yamlite.yaml` too: when `sync` or `watch` meets a new table under the root, a new YAML key, or a column an app added to the database, it appends a line and leaves existing lines and comments alone. Review those diffs; don't revert them.

## Laying out tables

Every folder and YAML file directly under the root is a table, with no configuration:

| Data                                                  | Declare                                  | Key                                                         |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| A folder, one record per file (`tasks/buy-milk.yaml`) | nothing                                  | the path without extension (`buy-milk`, `archive/buy-milk`) |
| One YAML file holding a list (`people.yaml`)          | nothing                                  | the `id` field                                              |
| Files outside the root, or a narrower glob            | `files: "<folder>/**/*.yaml"`            | the path below the folder                                   |
| Markdown with YAML front matter                       | `files: "<folder>/**/*.md"` (or `*.mdx`) | the path; the text below the front matter goes in `body`    |

How to choose:

- **One file per record** when records are edited separately, are long, or hold nested data. Diffs, reviews and conflicts stay per record.
- **A list file** for small, flat lookup tables (tens of rows) such as people, labels or projects.
- **`path:`** is only for a list file. A folder takes `files:`; `path:` on a folder is an error.
- **`key:`** for a list table: the field that identifies a record uniquely and stably (default `id`). Choose it once: the key column's type can never change later without rebuilding the database.

```yaml
tables:
  people:
    key: slug # people.yaml items are identified by slug
  archive:
    files: "tasks/archive/*.yaml" # takes these files away from tasks/
  inbox:
    files: ~/Dropbox/inbox/*.yaml # a folder outside the root
  notes:
    files: "notes/**/*.md"
    body: content # the Markdown body column, default body
```

## Columns

Types are inferred: `true` → `BOOLEAN`, `1` → `INTEGER`, `1.5` → `REAL`, text and dates → `TEXT`, maps and lists → `JSON`. `init` writes every column it finds under `columns`, and later syncs append new ones, so the file lists the whole schema. Keep those lines, and change a type only where inference is wrong:

- codes, IDs or zip codes whose values are all numbers today but must stay `TEXT`
- a field about to change shape, such as `title` → `{ en, ja }` (declare `JSON`, then migrate the files)

Add a column by hand only when an app writes it before any YAML has it. Changing a declared type rebuilds the table on the next sync; `yamlite status` shows it as `↻`.

A field must be always a scalar or always a map/list across records. `min` / `max` need the column's type in `columns`: on a table you declared by hand, add the rule after `yamlite sync` has appended the columns.

## Rules

Rules are checked on every sync. A broken rule is a warning, never a failed sync, but `yamlite check` fails on it. Use them for real invariants; a rule that half the data breaks is noise.

| Key           | Use it for                                                                                                    | Avoid it for                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `formats`     | `date` / `datetime` on TEXT dates; `markdown` on long prose edited in the web UI                              | non-TEXT columns (an error)                       |
| `values`      | small closed sets: status, priority labels (about 20 or fewer)                                                | free text, open sets that keep growing            |
| `required`    | fields a record is meaningless without                                                                        | optional fields (`""` and `[]` count as values)   |
| `min` / `max` | numeric ranges on INTEGER/REAL; date bounds on `date` / `datetime` columns                                    | TEXT columns without a date format (an error)     |
| `references`  | a field holding another table's key (`people`) or column (`projects.slug`); list items are checked one by one | enforcement: these are not foreign keys           |
| `indexes`     | queries you actually run on large tables; `unique: true` to catch duplicates                                  | small tables, speculative queries                 |
| `expand`      | lists of maps you want to query as rows (read-only views named `<table>__<field>`)                            | lists of scalars you only filter with `json_each` |
| `group`       | a sidebar section in the web UI                                                                               | anything else: it never changes the database      |
| `split`       | browsing one table by category in the web UI's sidebar (a column declared in `columns`)                       | splitting the data: it never changes the database |

```yaml
tables:
  tasks:
    group: Work
    columns: { priority: INTEGER }
    formats: { due: date, notes: markdown }
    values:
      status: [todo, doing, done]
    required: [title, status]
    min: { priority: 1 }
    max: { priority: 5 }
    references:
      assignee: people
      project: projects.slug
    indexes:
      - [status, due]
    expand:
      milestones:
        values: { state: [open, closed] }
        required: [state]
```

## Things to avoid

- Writing `yamlite.yaml` from scratch instead of starting from `yamlite init`.
- Declaring rules for fields no record has. A misspelt field name gives a rule that checks nothing, or a `required` warning on every record; compare names against the data.
- Expecting `init` or `sync` to find Markdown: declare Markdown tables with `files:`.
- `path:` pointing at a folder.
- Changing an existing table's `key`, or its key column's type. That needs the database rebuilt (delete `.yamlite/` and sync).
- Deleting a column's line to tidy up. The next sync drops that column from the database; if files still have the key, the column is kept with a warning.
- Two tables with the same folder whose globs match the same file (an error). A table in a subfolder of another's folder is fine: the deeper folder wins.
- `body:` on a non-Markdown table, or a `body` named like the key column.
- `values` on a column with a `formats` entry (`markdown`, `date` or `datetime`): an error.
- Splitting one table into several to browse it by category: keep one table and use `split`.

## Full example

A root with `tasks/` (one file per task), `people.yaml` (a list) and `notes/` (Markdown):

```yaml
tables:
  tasks:
    group: Work
    columns: { status: TEXT }
    split: status # the sidebar lists todo, doing, done under tasks
    formats: { due: date }
    values:
      status: [todo, doing, done]
    required: [title, status]
    references:
      assignee: people # people's key column
  people:
    key: slug
    values:
      team: [platform, sales]
  notes:
    files: "notes/**/*.md"
    group: Notes
```

## Key reference

Keys of a table under `tables:`. Details: https://github.com/jackchuka/yamlite#configuration

| Key          | Value                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `path`       | a YAML file holding a list of records                                                                                        |
| `files`      | a glob of files, one record each, ending in `*.yaml`, `*.yml`, `*.{yaml,yml}`, `*.md` or `*.mdx`; may start outside the root |
| `key`        | the key column (default `id`)                                                                                                |
| `body`       | Markdown tables only: the column for the text below the front matter (default `body`)                                        |
| `columns`    | `{ column: INTEGER \| REAL \| TEXT \| BOOLEAN \| JSON }`                                                                     |
| `formats`    | `{ column: markdown \| date \| datetime }`, TEXT columns only                                                                |
| `values`     | `{ column: [allowed, values] }`                                                                                              |
| `required`   | `[column, …]`                                                                                                                |
| `min`        | `{ column: number or date }`, bound included                                                                                 |
| `max`        | `{ column: number or date }`, bound included                                                                                 |
| `references` | `{ column: table }` or `{ column: table.column }`                                                                            |
| `indexes`    | `[a, b]` (composite), `{ columns: a, unique: true }`, `{ expr: "json_extract(meta, '$.ja')" }`                               |
| `expand`     | `{ field: { columns, formats, references, values, required, min, max, expand } }`                                            |
| `group`      | the web UI's sidebar section                                                                                                 |
| `split`      | a column (declared in `columns`, not the key or body) whose values the sidebar lists under the table                         |

The top-level `pages:` key adds custom pages to the web UI; see the README's Pages section.
