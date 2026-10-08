---
name: yamlite
description: Use when managing YAML or Markdown files with yamlite (YAML files kept in sync with SQLite), or when creating, editing or reviewing a yamlite.yaml schema — choosing tables, column types and rules such as values, required, formats, references, indexes and split.
---

# yamlite

Before writing or changing `yamlite.yaml`, read the guide that matches the installed version:

    yamlite guide

(Without a global install: `npx @jackchuka/yamlite guide`.)

Follow its workflow: start from `yamlite init --print`, edit only what inference cannot know, preview with `yamlite status`, run `yamlite sync`, and finish only when `yamlite check` exits 0.
