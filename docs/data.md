---
title: "Working with your data"
description: "How files map to tables, how types are inferred, and how nested values and lists are expanded."
order: 7
---

## Working with your data

### Tables

| Under the root       | Table    | Records                                                                                                                                           | Key                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `tasks/` (directory) | `tasks`  | one per `*.yaml` / `*.yml` file in the folder and its subfolders; the same as `files: "tasks/**/*.{yaml,yml}"`, which you only write to change it | the path without extension (`id`): `buy-milk`, `archive/buy-milk` |
| `people.yaml` (file) | `people` | each item of the top-level list                                                                                                                   | the `id` field                                                    |

Dotfiles, dot-folders and `node_modules` are ignored at every level, and `yamlite.yaml` at the root; to skip others, list them under [`ignore:`](configuration.md#ignoring-files). A YAML file at the root that holds a map or a scalar instead of a list, such as `pnpm-lock.yaml`, is not a table unless `yamlite.yaml` declares it. Symlinked files and directories are followed.

In a directory table, a file's own `id` field may hold the full key (`archive/buy-milk`) or just the file name (`buy-milk`); anything else is a warning and the path wins. Inserting a row with a nested key creates its folders, and deleting the last record in a folder removes the emptied folder. A table declared inside another one's folder takes the files its glob matches (`archive: { files: "tasks/archive/*.yaml" }`), and the outer table leaves them alone. Renaming a folder deletes and re-adds its records, so renaming a large folder can trip the mass-deletion guard and need `--force` (see [Safety](how-it-works.md#safety)).

### Types

| YAML value              | Column type | Stored as                          |
| ----------------------- | ----------- | ---------------------------------- |
| `true` / `false`        | `BOOLEAN`   | `1` / `0`                          |
| `42`                    | `INTEGER`   | integer (big values stay exact)    |
| `1.5`, or ints + floats | `REAL`      | real                               |
| `hello`, `2026-10-01`   | `TEXT`      | text (YAML 1.2: dates are strings) |
| maps and lists          | `JSON`      | JSON text                          |

New YAML keys become new columns automatically. Inference never changes an existing column's type (scalar values that don't fit are stored as-is with a warning); to change it, declare the type in `yamlite.yaml` — see [Column types](configuration.md#column-types).

### Nested values

Nested data stays in one `JSON` column per top-level key. Use SQLite's JSON functions:

```yaml
# tasks/release.yaml
title:
  en: Write release notes
  ja: リリースノートを書く
```

```sql
select json_extract(title, '$.ja') from tasks;                    -- read a nested value
update tasks set title = json_set(title, '$.ja', '書き直す');      -- written back as a map
select * from tasks, json_each(tags) where json_each.value = 'a'; -- filter on list items
```

A field must be **always a scalar or always a map/list** across records. Mixing them in a new field stops the table with an error listing which records are which; a record that doesn't fit an existing column is skipped with a warning. If a JSON column in the database holds something that isn't a map or list (for example after a manual `UPDATE`), that row is not written back to YAML until you fix it in SQL or edit the file. To migrate a field (say, `title` → `{en, ja}`), declare it in `yamlite.yaml` (`columns: { title: JSON }`) and sync: the column is converted, and every record not yet converted shows up as a warning until you change its file.

### Expanded views

Lists inside records — milestones of a project, tasks of a milestone — can be queried as rows. Declare them under `expand`, and every sync keeps a read-only SQLite view per list:

```yaml
tables:
  projects:
    expand:
      milestones: # the JSON column → view projects__milestones
        columns: { points: INTEGER } # optional: pin a type
        expand:
          tasks: # a field of each milestone → view projects__milestones__tasks
            references: { owner: people }
```

```sql
select p.title, m.title, t.owner
from projects p
join projects__milestones m on m.projects_id = p.id
join projects__milestones__tasks t on t.projects_id = m.projects_id and t.milestones_idx = m.idx;
```

- A view's first columns name the row: the table's key (`projects_id`), the positions of the lists above it (`milestones_idx`; a repeated name gets `_2`, `_3`, … as in `children_idx_2`), and its own position — `idx` for a list, `key` for a map. Then one column per field of the items; items that aren't maps (`tags: [a, b]`) go to a `value` column.
- Columns and types are inferred from the data on every sync; `columns` pins a type. Nothing is written back to `yamlite.yaml`.
- Views are read-only: edit the YAML, or update the JSON column of the table. `serve` lists them under their table and opens the record a row comes from.
- `references` on a view are checked like a table's, and `status` shows planned `+ view` / `− view` changes. A list that can't become a view (the field isn't a JSON column, or a view of that name was made by hand) is a warning.
- The web UI can add or remove expanded views from the table's schema (**Edit rules**); removing one also removes its rules.
