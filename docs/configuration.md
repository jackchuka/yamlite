---
title: "Configuration"
description: "The yamlite.yaml schema: columns, formats, rules, references and indexes."
order: 8
---

## Configuration

`<root>/yamlite.yaml` (or `yamlite.yml`) is required — it is the schema of record. Create it with `yamlite init`, commit it with your data, and edit it to change keys, types, indexes or to add tables that live elsewhere. YAMLite keeps it current for you: when `sync` or `watch` meets a new table under the root, a new YAML key, or a column an app added to the database, it appends it to `yamlite.yaml` (existing lines, comments and order are left untouched) — so new schema shows up as a reviewable diff. `yamlite status` lists these as `+ column … (will be added to yamlite.yaml)` first. `yamlite watch` reloads it on save — and picks up tables added under the root — without a restart; a broken file is reported and the previous configuration stays in effect.

```yaml
tables:
  people:
    key: slug # default: id
    group: CRM # the web UI's sidebar section
    split: team # the web UI's sidebar lists one item per value
    values: { team: [platform, sales] }
    columns: { team: TEXT, age: INTEGER, tags: JSON } # INTEGER | REAL | TEXT | BOOLEAN | JSON
    formats: { bio: markdown } # how the web UI edits a TEXT column
    expand: { tags: {} } # lists as views — see Expanded views
    indexes:
      - [team, age] # composite index
      - { columns: slug, unique: true }
      - { expr: "json_extract(meta, '$.ja')" } # index a nested value
  inbox:
    files: ~/Dropbox/inbox/*.yaml
```

`files:` takes a glob from the root: everything before the first wildcard is the table's folder (it may be outside the root), and the key is the path below it without the extension. `files: "**/*.{yaml,yml}"` makes the whole root one table; the conventions then add no folder tables under it, and `yamlite.yaml` itself is never a record. A file two tables match belongs to the one whose folder is deeper; two tables with the same folder matching the same file is an error. `path:` is for a single YAML file holding a list of records — a folder there is an error that names the `files:` line to use instead.

### Ignoring files

`ignore:` lists globs, relative to the root, for files and folders YAMLite leaves alone: an ignored folder or root file never becomes a table, and an ignored file is neither read into nor written from any table. A pattern that matches a folder ignores everything inside it, as in `.gitignore`. Patterns cannot start with `!`, and tables outside the root are not affected.

```yaml
ignore:
  - scripts # the folder and everything in it
  - "**/*.draft.yaml" # drafts in every table
tables: {}
```

### Markdown files

A `files:` glob ending in `*.md` or `*.mdx` makes a Markdown table: the YAML front matter between the `---` lines at the top of each file becomes columns, and the text below it goes into a `body` column, which the web UI edits as Markdown.

```yaml
tables:
  notes:
    files: "**/*.md" # an Obsidian vault, notes at any depth
  posts:
    files: "src/content/blog/**/*.md"
    body: content # name the body column something else
  docs:
    files: "content/**/*.mdx" # MDX: JSX in the body is kept as text
```

- The web UI previews the body as rendered Markdown. For `*.mdx`, components, `{expressions}` and `import`/`export` lines are shown as written, never run.
- A file without front matter is a record with only a body; adding a field adds a front matter block.
- Writes change only what changed: editing only the body leaves the front matter text as it was, and editing a field leaves the body's bytes alone. A field edit rewrites the front matter the way it does for a YAML file: comments mostly stay on their lines, but a comment-only block loses its comment when the first field is added, and spacing or number formatting on other lines can be normalised. CRLF line endings and a BOM are kept.
- Only YAML front matter is read. A file with TOML (`+++`) or JSON front matter is skipped with a warning and never written.
- A Markdown table exists only where `yamlite.yaml` declares one. `yamlite init` declares one for each top-level folder that holds `.md` or `.mdx` files and is not a YAML table, at the deepest folder holding them all and one per extension; `sync` never creates one, and a README next to your YAML or at the root stays a README.

### Captured columns

A `<name>` folder in `files:` matches one folder like `*`, and its name becomes a column:

```yaml
tables:
  notes:
    files: "notes/<team>/<project>/*.md"
    split: team
    references:
      team: teams
```

`notes/platform/search/plan.md` is a row with `team: platform` and `project: search`. The column is always `TEXT`: `01` and `1` are different folders.

- It is never written to a file: the folder is its only source. An edit in the database or the web UI is undone on the next sync with a warning, and the web UI shows the field read-only. To move a record, move its file.
- A file field with the same name is left in the file but ignored, with a warning when it differs from the folder.
- New record under a split item of a captured column starts its key in that folder (`platform/`).
- A capture is a whole folder (`<year>-*` is not one), cannot be the file name or come after `**`, and cannot be named like the key or body column.

### Field paths

`split`, `values`, `required`, `min`, `max` and `references` take `column.field` for a field inside a JSON column, so front matter like `metadata: { status: draft }` can be checked and browsed without its own column:

```yaml
tables:
  notes:
    files: "notes/**/*.md"
    columns: { metadata: JSON }
    split: metadata.status
    values:
      metadata.status: [draft, review, done]
    required: [metadata.reviewer]
```

- A name that is a column is that column, so a column named `a.b` keeps working. Otherwise the part before the first `.` must be a JSON column in `columns`.
- A list at the path is checked item by item, and `split` lists each item.
- `min` and `max` on a field path take numbers.
- `metadata` stays one JSON column in the database, the same shape as in the file.

### Removing columns

Delete a column's line from `yamlite.yaml` and the next sync drops it from the database (with any yamlite-managed index on it). If YAML files still have that key, a file can't be read, or a row in the database still holds a value in that column (an unsynced or app-written value), the column is kept and listed in a warning until you resolve it or add the line back. Columns that were never declared — say, one an app added — are registered instead, never dropped.

### Column types

`columns` is declarative too. When a declared type differs from the column in the database, the next sync rebuilds the table with the new type (in one transaction, following SQLite's recommended procedure) and shows `↻ column title TEXT → JSON` beforehand in `yamlite status`.

- Values are converted where possible (`1` ↔ `"1"`, `"true"` → `BOOLEAN`, JSON text → `JSON`).
- A value that can't be converted is cleared and refilled from YAML, which stays the source of truth. If that value was changed in SQL and never synced, the rebuild stops instead; fix the row or pass `--force-convert` to clear it.
- Tables with triggers, CHECK, UNIQUE or foreign-key constraints, COLLATE, AUTOINCREMENT, generated columns, `STRICT` or `WITHOUT ROWID`, indexes YAMLite doesn't manage, or other tables referencing them are never rebuilt; YAMLite reports an error and leaves the migration to you.
- The key column's type is never changed; to change it, recreate the database (delete `.yamlite/`).

### Groups

`group` puts a table under a named section in the web UI's sidebar; it never changes the database. Grouped tables follow the ungrouped ones, and groups are listed in the order their first table appears. A section folds away with a click and stays folded in that browser. The table header's Group button sets or clears a table's group from the UI, writing `group:` into `yamlite.yaml`, and New table takes one too.

### Split

`split` names a column whose values the web UI's sidebar lists under the table, each with its count; it never changes the database. A table of notes with `split: type` stays one table, and the sidebar shows `idea`, `todo` and so on under it. Clicking one opens the table filtered to that value, and New record there starts with the value filled in. A JSON column lists each element of its arrays, so a record tagged `[a, b]` is under both `a` and `b`. Records with no value are under "(none)", shown only when there are some. The items fold with the table's views behind the arrow on its row: they start folded, an open table stays open in that browser, and a table opens by itself while one of its items or views is shown. The column must be declared in `columns` (or be a [field path](#field-paths) into one), and cannot be the key or the Markdown body.

### Formats

`formats` tells the web UI how to edit a `TEXT` or `JSON` column, and for all but `markdown` also what to check:

| Format     | Column | Edited with                                   | Checked                                                                   |
| ---------- | ------ | --------------------------------------------- | ------------------------------------------------------------------------- |
| `markdown` | `TEXT` | rendered Markdown, with an Edit tab           | —                                                                         |
| `date`     | `TEXT` | a date picker                                 | `YYYY-MM-DD`, a real date                                                 |
| `datetime` | `TEXT` | a date and time picker, with the offset shown | `YYYY-MM-DD`, `T` or a space, `HH:MM[:SS[.fff]]`, optional `Z` / `±HH:MM` |
| `list`     | `JSON` | chips for a list of text, or JSON             | a list                                                                    |
| `map`      | `JSON` | keys and values, else JSON                    | a map                                                                     |

The Markdown editor keeps the text exactly as you type it, so saving doesn't reformat the Markdown in your YAML. A `datetime` keeps how it is written: picking a new time leaves its offset, separator and seconds as they were, and a new value gets your browser's offset. A value the picker can't show is edited as text, and a button switches between the two.

A value that doesn't match its format is a warning, not a failed sync:

```
! due "2026-02-31" not a date (buy-milk)
! tags {"a":1} not a list (buy-milk)
```

A new record starts a `map` field with its editor, and offers a `list` field only chips or JSON (for a list of maps). Only the column's own value is checked, not what it holds: to check the items of a list, or the values of a map, expand it and give the view its own `formats`:

```yaml
tables:
  projects:
    formats: { milestones: list }
    expand:
      milestones:
        formats: { tags: list, meta: map }
```

`init` writes `date` or `datetime` for a `TEXT` column whose values all have that shape. A format on a column declared with another type is an error, and so are `values`, `min` and `max` on a `list` or `map` column. `expand` entries take `formats` too.

### Values

List the values a column may hold, and YAMLite checks them on every sync. Like references, they are never enforced: a value outside the list is a warning, not a failed sync.

```yaml
tables:
  tasks:
    values:
      status: [todo, doing, done]
      tags: [errand, home, work] # each item of a list is checked
    expand:
      milestones:
        values: { state: [open, closed] }
```

```
! status "doen" not in values (buy-milk)
```

- Values are compared as text (`1` matches `"1"`), numbers also as numbers (`2.0` matches `2`), and `true` / `false` as the `1` / `0` a `BOOLEAN` column stores. A missing field is not checked.
- The web UI edits the column with a select. A value outside the list stays in it, marked, until you change it.
- A `markdown` column cannot have values.

The web UI can edit them from the table's schema (**Edit rules**).

### Required

List the columns every record must have a value in, and YAMLite checks them on every sync. A missing key or `null` is a warning, not a failed sync; `""` and `[]` count as values.

```yaml
tables:
  tasks:
    required: [title, status]
    expand:
      milestones:
        required: [state]
```

```
! title missing (buy-milk, call-mom)
```

The web UI marks required fields with `*` and highlights the empty ones. `yamlite check` fails on any of these warnings.

The web UI can edit them from the table's schema (**Edit rules**).

### Min and max

Bound a column, and YAMLite checks it on every sync. Bounds are included, and a value outside them is a warning, not a failed sync.

```yaml
tables:
  tasks:
    columns: { priority: INTEGER }
    formats: { due: date }
    min: { priority: 1, due: 2026-01-01 }
    max: { priority: 5 }
```

```
! priority 7 above max 5 (buy-milk)
! due "2025-12-31" below min 2026-01-01 (call-mom)
```

- A bound takes a number on an `INTEGER` or `REAL` column, and a date (or, for `datetime`, a datetime) on a `date` or `datetime` column; anything else is an error. In `expand`, declare the column's type there too (`columns: { points: INTEGER }`).
- Datetimes compare as points in time: one without an offset is UTC, and a date bound is its midnight UTC.
- A value of the wrong kind (text in an `INTEGER` column, a broken date) is not compared; the format check reports a broken date.
- The web UI marks a value out of bounds under its field.

The web UI can edit them from the table's schema (**Edit rules**).

### References

Declare which fields point at other tables, and YAMLite checks them on every sync — it never enforces them, so a typo or a record you haven't added yet is a warning, not a failed sync:

```yaml
tables:
  tasks:
    references:
      assignee: people # matches people's key column
      project: projects.slug # matches a specific column
      tags: labels # each item of a list is checked
```

```
! assignee "9" not found in people.id (buy-milk, call-mom)
```

Values are compared as text (`"1"` matches `1`). While watching, a change to `people` re-checks the tables that reference it. These are not SQLite foreign keys: nothing is rejected or cascaded, and you fix the YAML.

The web UI can edit them from the table's schema (**Edit rules**).

### Indexes

`indexes` is declarative: every sync makes the database match it. YAMLite creates missing indexes and drops the ones you removed from the list, and leaves indexes you created yourself in SQL alone (its own are named `yamlite_<table>_<hash>`). An index that can't be created — a duplicate value for a `unique` index, or a column that doesn't exist yet — is reported as a warning and data keeps syncing. `yamlite status` shows planned index changes as `+ index` / `− index`.

The web UI can add or remove indexes from the table's schema (**Edit rules**).
