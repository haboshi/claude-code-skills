---
name: doc-hub
description: 生成ドキュメントの統合管理 hub（~/Documents/doc-hub）の操作。プロジェクト別ドキュメント一覧の表示・indexを開く・散逸したHTMLの取込・再インデックス。「ドキュメント一覧」「資料どこ」「doc hub 開いて」「このHTMLをhubに入れて」「ドキュメントハブ」「hubに登録」で発動。
user-invocable: true
argument-hint: "[open | list | add <html-path>]"
---

# doc-hub

生成済み HTML ドキュメントを一箇所（hub ルート: `~/Documents/doc-hub`。`DOC_HUB_DIR` 環境変数で上書き可）に集約する CLI のフロントエンド。全操作は次の形で呼ぶ:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" <add|list|open|reindex> ...
```

`$ARGUMENTS` が `open` / `list` / `add <html-path>` のいずれかならそのまま対応するサブコマンドに変換する。自然文の依頼は §2 の対応表で判定する。

## 1. サブコマンド

### add — HTML を hub に取り込む

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" add <html> --project <path> \
  [--title <t>] [--slug <s>] [--type <t>] [--tags a,b] [--assets <dir>] [--update|--new]
```

- 成功時、stdout に保存先 `index.html` の絶対パスが1行だけ出る。後続操作（open・PDF化等）はこのパスを使う
- `--title` 省略時は HTML の `<title>` から取得する
- **日本語タイトルのみだと slug が `project` に潰れる**（slugify が非 ASCII を除去するため）。`--slug` に英語 kebab-case を明示するのを推奨
- `--project` は対象プロジェクトの絶対パス（省略時はカレントディレクトリ）。`list`/`open` の `--project` とは異なり、**id は受け付けない**（発番・新規プロジェクト作成に関わるコマンドのため、パス以外を渡すと別パス扱いで意図しない新規プロジェクトを発番しかねない）
- 同じ slug の文書が既にあると **既定でエラー停止**（勝手に上書きしない）。更新なら `--update`、別文書として残すなら `--new`
- HTML 内に不正な XML の SVG があると xmllint 検証で add 自体が拒否される（§5 参照）

### list — 一覧表示

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" list [--project <path|id>] [--json]
```

- `--project` 省略時は全プロジェクトを一覧
- `--project` に**未登録のパス/idを渡すと空結果**を返す（list は発番しない。プロジェクトが hub に現れるのは add 実行後のみ）
- `--json` は構造化出力（他スキルが accent 確認等で読み取る用途。`bizdoc` スキルの Phase 4 参照）

### open — index.html を開く

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" open [--project <path|id>]
```

- hub 直下の `index.html` を開く。存在しなければ先に reindex してから開く
- `--project` を付けると該当プロジェクトのセクション（`#p-<id>`）にジャンプする

### reindex — index.html を再生成

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" reindex
```

- `projects/**` の `project.json` / `manifest.json` から `index.html` を丸ごと再生成する
- `add` は内部で自動的に reindex を呼ぶため、明示的に叩くのは「index.html を手で壊した/消した」「他スキルが manifest を直接書いた」等の復旧・反映用途のみ

## 2. ユーザー要求 → コマンド対応表

| ユーザー要求 | コマンド |
|---|---|
| 「一覧見せて」「資料どこ」（このプロジェクトの） | `list --project "$(pwd)"` |
| 「一覧見せて」（hub全体） | `list` |
| 「開いて」「doc hub 開いて」 | 既定 `open --project "$(pwd)"`（このプロジェクトのセクションへジャンプ）。hub 全体の閲覧が明示された場合のみ `open` |
| 「この HTML を hub に」 | `add <path> --project "$(pwd)"` |
| 「別プロジェクトのだから」 | `--project <そのプロジェクトのパス>` を明示して add/list/open |
| 「更新して」（同 slug で add がエラーになった後） | `--update` を付けて再実行 |
| 「別ドキュメントとして残して」 | `--new` を付けて再実行 |
| index.html が壊れている/消えている | `reindex` |

## 3. データ設計の要点

- SSOT は `projects/**` の `project.json`（プロジェクト単位。id / label / abs_path / aliases / accent）と `manifest.json`（文書単位。title / slug / type / created / updated / tags 等）
- `index.html` はこれら2つから機械的に導出される二次生成物。削除しても `reindex` で同一内容が再生成される（タイムスタンプは埋め込まない設計）
- プロジェクトの id は初回発番後は不変。プロジェクトディレクトリが移動した場合は `project.json` の `abs_path` を手で書き換えて追随させる（id は変えない）
- 壊れた `project.json` / `manifest.json` はエラーにせず「破損」エントリとして index 上に残る（データを黙って消さない設計）

## 4. manifest 公開契約（他スキルからの直接登録）

hub は `hub.mjs add` 経由の取り込みだけを前提にしていない。他スキルは（既に `project.json` が存在する登録済みプロジェクトの）`projects/<id>/docs/<name>/` 配下に自前で `manifest.json`（`schema_version` / `title` / `slug` / `type` / `created` / `updated` / `entry` / `tags` 等、`hub.mjs` の add が書き出す形式に準拠）と `index.html`（`entry` が指すファイル）を置き、最後に `node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" reindex` を1回呼ぶだけで hub の一覧に反映できる（`project.json` 自体が無いディレクトリは「破損」プロジェクト扱いになるので、未登録プロジェクト向けには先に一度 `add` を通して発番させる）。hub CLI 自身の絶対パスは `<hub>/.hub-cli`（1行のプレーンテキスト）に書き出されており、そこから解決できる。

## 5. エラー対処

- 「同じ slug のドキュメントが既にあります」→ 上書きしてよいか（更新）か、別文書として残すかをユーザーに確認してから `--update` / `--new` を付けて再実行する
- 「SVG #N が不正な XML です（add を中止）」→ 該当 SVG を修正してから `add` を再実行する。なお xmllint が環境に無い場合は検証自体がスキップされ warning のみで add は成立する点に注意
