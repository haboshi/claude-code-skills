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
- `--project` は絶対パスで渡すのが基本（省略時はカレントディレクトリ）。登録済みプロジェクト id も解決されるが、typo や未登録の id はパスとして解釈され意図しない新規プロジェクトを発番し得るため、id 指定は避ける
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
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" open [--project <path|id> | --group <key|label>]
```

- hub 直下の `index.html` を開く。存在しなければ先に reindex してから開く
- `--project` を付けると該当プロジェクト（`#p-<id>`）を選択した状態で開く。グループは `#g-<key>`
- 一覧ページ側の操作: `/` で検索（空白区切りは AND。タイトル・種別・タグ・プロジェクト名が対象）、`↑` `↓` で行移動、`Enter` で開く、`Esc` で絞り込み解除。左の一覧でプロジェクト／グループ／未分類を切り替え、上の期間・種別・タグのチップで絞り込む
- 絞り込みの作法: 左の件数は検索・絞り込みに連動する（どのプロジェクトに何件あるかが同時に読める）。チップの件数は「押したら何件になるか」で、タグは選択済みと共起するものだけが残る。種別を選ぶと表記の近い種別（報告書 → ご報告 / 内部報告）が「同じ系統」として提案される。チップを全展開するとその場で絞れる入力が出る。期間チップは実際に絞れるときだけ、左一覧の名前フィルタはプロジェクトが 20 件以上のときだけ現れる

### group — プロジェクトの名寄せ（グループ）

ディレクトリ構成と案件の帰属は一致しないことがある（例: `~/Projects` 直下にあるが JBR 案件）。
グループは `<hub>/overrides.json` に置く**非破壊の上書き層**で、`project.json` には一切書き込まない。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" group list [--json]
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" group add <ラベル> <project...>   # 作成（既存ラベルなら追加）
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" group remove <project...>          # 未分類へ戻す
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" group rename <グループ> <新ラベル>
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" group delete <グループ>            # メンバーは未分類へ
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" group suggest                      # パス階層からの候補を表示（適用はしない）
```

- `<project>` は登録済みの project id またはパス。未登録を渡すと**中止**する（発番しない）
- `<グループ>` はキー（`g_1`）でもラベル（`JBR`）でも引ける
- `group suggest` は「親ディレクトリを 2 つ以上のプロジェクトが共有していれば候補」とし、他の候補の祖先にあたるディレクトリ（`~/Projects` のような汎用の置き場）は除く。**提案を出すだけ**で、反映は `group add` を実行したときのみ

### project — 表示名・一覧掲載の調整

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" project label <project> [表示名]   # 省略で上書き解除
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" project hide <project...>
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" project show <project...>
```

- `hide` は一覧から隠すだけでデータは消さない。一覧ページの「非表示のプロジェクトも出す」で確認でき、`open --project` で名指しされたときは自動的に表示される

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
| 「◯◯を JBR にまとめて」「名寄せして」「◯◯の下にぶら下げて」 | `group add "<親の名前>" <project...>`（対象が曖昧なら先に `group suggest` と `list` で確認） |
| 「グループ分けの候補を出して」 | `group suggest`（提案のみ。適用は確認を取ってから） |
| 「この一覧に出さないで」「非表示にして」 | `project hide <project>` |
| 「表示名を変えて」 | `project label <project> "<表示名>"` |

- グループ・表示名・非表示の変更は**それ自体は破壊的ではない**（`overrides.json` のみを書き、SSOT には触れない）が、ユーザーの見え方を変えるため、対象が推測になるときは実行前に確認する

## 3. データ設計の要点

- SSOT は `projects/**` の `project.json`（プロジェクト単位。id / label / abs_path / aliases / accent）と `manifest.json`（文書単位。title / slug / type / created / updated / tags 等）
- `index.html` はこれら2つから機械的に導出される二次生成物。削除しても `reindex` で同一内容が再生成される（タイムスタンプは埋め込まない設計）
- プロジェクトの id は初回発番後は不変。プロジェクトディレクトリが移動した場合は `project.json` の `abs_path` を手で書き換えて追随させる（id は変えない）
- 壊れた `project.json` / `manifest.json` はエラーにせず「破損」エントリとして index 上に残る（データを黙って消さない設計）
- `<hub>/overrides.json` はグループ・表示名・非表示だけを持つ**非破壊の上書き層**（`{version, groups:{g_N:{label}}, projects:{<id>:{group,label,hidden}}}`）。プロジェクト検出も `project.json` も無改変のまま、一覧の組み立て時にだけ効く。壊れていても警告して無視するだけで一覧は出る。手で編集してもよい（次の `reindex` で反映）
- 一覧ページは埋め込んだ JSON からクライアント側で描画する。相対日付（「3日前」）は表示時に計算しており HTML には入らないため、`reindex` は同じ入力から同じバイト列を出す

## 4. manifest 公開契約（他スキルからの直接登録）

hub は `hub.mjs add` 経由の取り込みだけを前提にしていない。他スキルは（既に `project.json` が存在する登録済みプロジェクトの）`projects/<id>/docs/<name>/` 配下に自前で `manifest.json`（`schema_version` / `title` / `slug` / `type` / `created` / `updated` / `entry` / `tags` 等、`hub.mjs` の add が書き出す形式に準拠）と `index.html`（`entry` が指すファイル）を置き、最後に `node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" reindex` を1回呼ぶだけで hub の一覧に反映できる（`project.json` 自体が無いディレクトリは「破損」プロジェクト扱いになるので、未登録プロジェクト向けには先に一度 `add` を通して発番させる）。hub CLI 自身の絶対パスは `<hub>/.hub-cli`（1行のプレーンテキスト）に書き出されており、そこから解決できる。

## 5. エラー対処

- 「同じ slug のドキュメントが既にあります」→ 上書きしてよいか（更新）か、別文書として残すかをユーザーに確認してから `--update` / `--new` を付けて再実行する
- 「SVG #N が不正な XML です（add を中止）」→ 該当 SVG を修正してから `add` を再実行する。なお xmllint が環境に無い場合は検証自体がスキップされ warning のみで add は成立する点に注意
