---
title: "設定"
description: "yamlite.yaml のスキーマ(カラム、フォーマット、ルール、参照、インデックス)を説明します。"
order: 8
---

## 設定

`<root>/yamlite.yaml`(または `yamlite.yml`)は必須で、スキーマの正本になります。`yamlite init` で作成し、データと一緒にコミットしてください。キー、型、インデックスを変更するときや、別の場所にあるテーブルを追加するときは、このファイルを編集します。YAMLite は、このファイルを最新に保ちます。`sync` や `watch` が、ルート直下の新しいテーブル、YAML の新しいキー、アプリがデータベースに追加したカラムを見つけると、それらを `yamlite.yaml` に追記します(既存の行、コメント、順序には手を付けません)。そのため、新しいスキーマはレビューできる差分として現れます。`yamlite status` は、これらをまず `+ column … (will be added to yamlite.yaml)` として表示します。`yamlite watch` は、保存されるたびに設定を再読み込みし、ルート直下に追加されたテーブルも拾うので、再起動は不要です。壊れたファイルは報告され、直前の設定がそのまま有効です。

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

`files:` にはルートからの glob を指定します。最初のワイルドカードより前の部分がテーブルのフォルダーになり(ルートの外でもかまいません)、キーは、そこからの相対パスから拡張子を除いたものです。`files: "**/*.{yaml,yml}"` と指定すると、ルート全体が 1 つのテーブルになります。この場合、慣例によるフォルダーのテーブルは、その下に追加されません。`yamlite.yaml` 自体がレコードになることもありません。2 つのテーブルに一致するファイルは、フォルダーが深いほうのテーブルに属します。フォルダーが同じ 2 つのテーブルが同じファイルに一致すると、エラーです。`path:` は、レコードのリストを持つ 1 つの YAML ファイルに使います。フォルダーを指定するとエラーになり、代わりに使う `files:` の行が示されます。

### ファイルを無視する

`ignore:` には、YAMLite に扱わせたくないファイルやフォルダーを、ルートからの glob で並べます。無視したフォルダーやルートのファイルはテーブルになりません。無視したファイルは、どのテーブルでも読み込まず、書き出しもしません。フォルダーに一致するパターンは、`.gitignore` と同じく、その中身すべてを無視します。`!` で始まるパターンは使えません。ルートの外にあるテーブルには影響しません。

```yaml
ignore:
  - scripts # フォルダーとその中身すべて
  - "**/*.draft.yaml" # すべてのテーブルの下書き
tables: {}
```

### Markdown ファイル

`files:` の glob が `*.md` または `*.mdx` で終わると、Markdown テーブルになります。各ファイルの先頭にある `---` の行に挟まれた YAML フロントマターがカラムになり、その下の本文は `body` カラムに入ります。`body` カラムは、Web UI で Markdown として編集できます。

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

- Web UI は、本文をレンダリングした Markdown としてプレビューします。`*.mdx` では、コンポーネント、`{expressions}`、`import` / `export` の行は、書かれたとおりに表示され、実行されることはありません。
- フロントマターのないファイルは、本文だけを持つレコードになります。フィールドを追加すると、フロントマターのブロックが追加されます。
- 書き込みで変わるのは、変更した部分だけです。本文だけを編集してもフロントマターのテキストはそのままで、フィールドを編集しても本文のバイト列には手を付けません。フィールドを編集すると、YAML ファイルと同じ方法でフロントマターが書き換えられます。コメントはおおむね元の行に残りますが、コメントだけのブロックは、最初のフィールドを追加するとコメントが消えます。そのほかの行の空白や数値の書式は、正規化されることがあります。CRLF の改行と BOM は保持されます。
- 読み取るのは YAML のフロントマターだけです。TOML(`+++`)や JSON のフロントマターを持つファイルは、警告を出してスキップし、書き込みません。
- Markdown テーブルは、`yamlite.yaml` で宣言した場所にだけ存在します。`yamlite init` は、YAML のテーブルではないトップレベルのフォルダーのうち、`.md` または `.mdx` ファイルを含むものごとに、Markdown テーブルを宣言します。宣言する場所は、それらのファイルをすべて含む最も深いフォルダーで、拡張子ごとに 1 つです。`sync` が自動で作ることはありません。YAML の隣やルートにある README は、README のままです。

### キャプチャしたカラム

`files:` の中の `<name>` フォルダーは、`*` と同じく 1 つのフォルダーに一致し、その名前がカラムになります。

```yaml
tables:
  notes:
    files: "notes/<team>/<project>/*.md"
    split: team
    references:
      team: teams
```

`notes/platform/search/plan.md` は、`team: platform`、`project: search` を持つ行になります。カラムは常に `TEXT` です。`01` と `1` は別のフォルダーだからです。

- ファイルには書き込まれません。値の元になるのはフォルダーだけです。データベースや Web UI で編集しても、次の同期で警告とともに元に戻され、Web UI ではそのフィールドが読み取り専用で表示されます。レコードを移動するには、ファイルを移動してください。
- 同じ名前のフィールドがファイルにあっても、そのまま残りますが、無視されます。フォルダーと値が違うときは警告が出ます。
- キャプチャしたカラムの split の項目の下に新しいレコードを作ると、キーはそのフォルダー(`platform/`)から始まります。
- キャプチャできるのはフォルダー全体です(`<year>-*` は使えません)。ファイル名にすることも、`**` の後ろに置くこともできません。キーや本文のカラムと同じ名前も付けられません。

### フィールドパス

`split`、`values`、`required`、`min`、`max`、`references` では、JSON カラム内のフィールドを `column.field` で指定できます。そのため、`metadata: { status: draft }` のようなフロントマターを、専用のカラムなしで検証したり、絞り込んだりできます。

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

- カラムとして存在する名前は、そのカラムを指します。そのため、`a.b` という名前のカラムも引き続き使えます。それ以外の場合は、最初の `.` より前の部分が、`columns` にある JSON カラムでなければなりません。
- パスの先がリストなら、項目を 1 つずつ検証し、`split` は各項目を一覧表示します。
- フィールドパスに対する `min` と `max` には、数値を指定します。
- データベースでは、`metadata` は 1 つの JSON カラムのままで、ファイル内と同じ形です。

### カラムの削除

`yamlite.yaml` からカラムの行を削除すると、次の同期でデータベースからも削除されます(そのカラムに YAMLite が管理しているインデックスがあれば、それも削除されます)。ただし、YAML ファイルにまだそのキーがある場合、ファイルが読み取れない場合、データベースの行にそのカラムの値が残っている場合(未同期の値や、アプリが書き込んだ値)は、カラムを残し、解決するか行を戻すまで警告に表示します。一度も宣言されていないカラム(たとえばアプリが追加したもの)は、削除されずに登録されます。

### カラムの型

`columns` も宣言的です。宣言した型がデータベースのカラムと違うと、次の同期でテーブルを新しい型で作り直します(1 つのトランザクション内で、SQLite が推奨する手順に従います)。作り直しの前に、`yamlite status` が `↻ column title TEXT → JSON` と表示します。

- 値は、可能な範囲で変換されます(`1` ↔ `"1"`、`"true"` → `BOOLEAN`、JSON テキスト → `JSON`)。
- 変換できない値は、消去されたあと YAML から入れ直されます。YAML が常に正本だからです。その値を SQL で変更していて、まだ同期していない場合は、作り直しが止まります。行を直すか、`--force-convert` を指定して消去してください。
- トリガー、CHECK、UNIQUE、外部キーの制約、COLLATE、AUTOINCREMENT、生成カラム、`STRICT`、`WITHOUT ROWID` を持つテーブル、YAMLite が管理していないインデックスがあるテーブル、ほかのテーブルから参照されているテーブルは、作り直しません。YAMLite はエラーを報告し、移行は利用者に任せます。
- キーのカラムの型は変更されません。変更するには、データベースを作り直してください(`.yamlite/` を削除します)。

### グループ

`group` は、Web UI のサイドバーで、テーブルを名前付きのセクションに入れます。データベースは変わりません。グループのあるテーブルは、グループのないテーブルの後ろに並び、グループは最初のテーブルが現れた順に並びます。セクションはクリックで折りたたまれ、そのブラウザーでは折りたたんだ状態が保たれます。テーブルのヘッダーにある「グループ」ボタンで、UI からテーブルのグループを設定・解除できます。この操作は `yamlite.yaml` に `group:` を書き込みます。「新しいテーブル」でもグループを指定できます。

### 分割

`split` には、カラムを 1 つ指定します。Web UI のサイドバーは、そのカラムの値をテーブルの下に、件数とともに一覧表示します。データベースは変わりません。メモのテーブルに `split: type` を指定しても、テーブルは 1 つのままで、サイドバーにはその下に `idea`、`todo` などが並びます。1 つをクリックすると、その値で絞り込んだテーブルが開き、そこで「新しいレコード」を実行すると、その値が入力済みの状態で始まります。JSON カラムは配列の各要素を一覧表示するので、`[a, b]` というタグを付けたレコードは、`a` と `b` の両方に入ります。値のないレコードは「(なし)」に入ります。「(なし)」が表示されるのは、該当するレコードがあるときだけです。項目は、テーブルのビューと一緒に、行の矢印の奥で折りたたまれます。最初は折りたたまれていて、開いたテーブルはそのブラウザーでは開いたままになり、項目やビューが表示されている間は、テーブルが自動的に開きます。カラムは `columns` で宣言されている必要があり(または、その中の[フィールドパス](#フィールドパス)でもかまいません)、キーや Markdown の本文は指定できません。

### フォーマット

`formats` は、`TEXT` または `JSON` のカラムを Web UI でどう編集するかを指定します。`markdown` を除いて、何を検証するかも決まります。

| フォーマット | カラム | 編集方法                                  | 検証内容                                                                    |
| ------------ | ------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| `markdown`   | `TEXT` | レンダリングした Markdown と、編集タブ    | —                                                                           |
| `date`       | `TEXT` | 日付ピッカー                              | `YYYY-MM-DD` で、実在する日付                                               |
| `datetime`   | `TEXT` | 日時ピッカー(オフセットを表示)            | `YYYY-MM-DD`、`T` または空白、`HH:MM[:SS[.fff]]`、省略可能な `Z` / `±HH:MM` |
| `list`       | `JSON` | テキストのリストはチップ、それ以外は JSON | リスト                                                                      |
| `map`        | `JSON` | キーと値。できない場合は JSON             | マップ                                                                      |

Markdown エディターは、入力したとおりのテキストを保持します。そのため、保存しても YAML 内の Markdown が整形し直されることはありません。`datetime` は、書かれている形式を保ちます。新しい時刻を選んでも、オフセット、区切り文字、秒の有無はそのままで、新しい値には、ブラウザーのオフセットが付きます。ピッカーで表示できない値は、テキストとして編集され、ボタンで 2 つの方法を切り替えられます。

フォーマットに合わない値は警告になり、同期は失敗しません。

```
! due "2026-02-31" not a date (buy-milk)
! tags {"a":1} not a list (buy-milk)
```

新しいレコードでは、`map` のフィールドはそのエディターで始まり、`list` のフィールドはチップか JSON(マップのリストの場合)だけが選べます。検証されるのはカラム自体の値だけで、中身は検証されません。リストの項目やマップの値を検証するには、展開して、そのビューに専用の `formats` を指定します。

```yaml
tables:
  projects:
    formats: { milestones: list }
    expand:
      milestones:
        formats: { tags: list, meta: map }
```

`init` は、値がすべて同じ形をしている `TEXT` カラムに、`date` または `datetime` を書き込みます。別の型で宣言されたカラムにフォーマットを指定するとエラーになります。`list` または `map` のカラムに `values`、`min`、`max` を指定した場合も同様です。`expand` の項目にも `formats` を指定できます。

### 値

カラムに入れてよい値を列挙すると、YAMLite は同期のたびに検証します。参照と同じく、強制はされません。リストにない値は警告になり、同期は失敗しません。

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

- 値はテキストとして比較します(`1` は `"1"` に一致します)。数値は数として比べるので、`2.0` は `2` に一致します。`true` / `false` は、`BOOLEAN` カラムが保存する `1` / `0` として比較します。フィールドがない場合は検証しません。
- Web UI は、このカラムをセレクトで編集します。リストにない値は、変更するまで、印が付いた状態で選択肢に残ります。
- `markdown` のカラムには、values を指定できません。

Web UI では、テーブルのスキーマ(**ルールを編集**)から編集できます。

### 必須

すべてのレコードに値が必要なカラムを列挙すると、YAMLite は同期のたびに検証します。キーがない場合と `null` は警告になり、同期は失敗しません。`""` と `[]` は値として扱います。

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

Web UI は、必須のフィールドに `*` を付け、空のフィールドを強調表示します。`yamlite check` は、これらの警告が 1 つでもあると失敗します。

Web UI では、テーブルのスキーマ(**ルールを編集**)から編集できます。

### 最小値と最大値

カラムに範囲を指定すると、YAMLite は同期のたびに検証します。範囲の端の値は範囲に含まれ、範囲外の値は警告になります。同期は失敗しません。

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

- 範囲に指定できるのは、`INTEGER` または `REAL` のカラムでは数値、`date` または `datetime` のカラムでは日付(`datetime` では日時)です。それ以外はエラーになります。`expand` では、そこでもカラムの型を宣言してください(`columns: { points: INTEGER }`)。
- 日時は時点として比較します。オフセットのない日時は UTC として扱い、日付の範囲は、その日の UTC の 0 時になります。
- 種類の違う値(`INTEGER` カラムのテキスト、壊れた日付)は比較しません。壊れた日付は、フォーマットの検証が報告します。
- Web UI は、範囲外の値を、そのフィールドの下に表示します。

Web UI では、テーブルのスキーマ(**ルールを編集**)から編集できます。

### 参照

どのフィールドがほかのテーブルを指しているかを宣言すると、YAMLite は同期のたびに検証します。強制はしないので、入力ミスや、まだ追加していないレコードは警告になり、同期は失敗しません。

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

値はテキストとして比較します(`"1"` は `1` に一致します)。`watch` の実行中に `people` が変わると、それを参照しているテーブルを再検証します。これらは SQLite の外部キーではありません。拒否も連鎖もなく、YAML を直すのは利用者です。

Web UI では、テーブルのスキーマ(**ルールを編集**)から編集できます。

### インデックス

`indexes` は宣言的で、同期のたびに、データベースをその内容に合わせます。YAMLite は、足りないインデックスを作成し、リストから削除したインデックスを削除します。SQL で自分で作成したインデックスには手を付けません(YAMLite が作るインデックスの名前は `yamlite_<table>_<hash>` です)。作成できないインデックス(`unique` インデックスに重複する値がある場合や、まだ存在しないカラムを指定した場合)は、警告として報告され、データの同期は続きます。`yamlite status` は、予定されているインデックスの変更を `+ index` / `− index` として表示します。

Web UI では、テーブルのスキーマ(**ルールを編集**)からインデックスを追加・削除できます。
