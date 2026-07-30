# bizdoc プラグイン設計書

- 日付: 2026-07-30
- 状態: 承認済み設計（実装計画は別紙）
- 対象リポジトリ: claude-code-skills（haboshi-skills マーケットプレイス）

## 1. 背景・目的

解決する課題は2つ。

1. **ビジネス品質の図解ドキュメント生成**: 既存の `run-explainer-page` スキル（`~/.claude/skills/run-explainer-page/`）は図解付き1枚 HTML を生成できるが、図解がイラスト風ラスタ画像でありビジネスシーンに使いづらい。白基調・鮮明な図解・目的駆動の構成を持つビジネス文書生成を新スキルとして立てる（既存スキルは無変更で温存）。
2. **生成ドキュメントの散逸**: 生成 HTML が Artifact・各プロジェクトの一時ディレクトリ・ダウンロードディレクトリに散らばる。プロジェクト別に一箇所へ保存し、一覧から各ドキュメントへ入れる統合管理層（hub)を設ける。

付随要件:

- 関係部署展開用の PDF 書き出し（`~/Downloads` への一時出力）
- v2 拡張ポイント: decision-board（決裁）連携、Jiku MCP（中長期軸）連携

## 2. 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| 図解方式 | インライン SVG 既定。ラスタ画像（codex-imagegen）は明示指示時のみ |
| ストア方式 | ファイル SSOT + 静的 index.html 再生成。DB・常駐サーバーなし（後付け可能なメタ設計） |
| スキル配置 | claude-code-skills リポジトリの新プラグイン `bizdoc` |
| hub 配置 | `~/Documents/doc-hub/`（iCloud 同期有効と確認済みの上で受諾。原子書き込み＋壊れ耐性で防御） |
| 構造の柔軟性 | HTML 構造を固定テンプレ化しない（目的・テーマ駆動で毎回構成を設計）が大前提 |
| 開発体制 | 設計: Fable5 + Opus アドバイザー / 実装: Sonnet・Codex / 評価: Fable5 |

## 3. プラグイン構成

1プラグイン・2スキル構成。hub を別プラグインに分離しない（`${CLAUDE_PLUGIN_ROOT}` は自プラグインのスキル文脈でしか解決されないため、分離しても他スキルからの再利用は実現しない。再利用の接点はプラグイン境界ではなく on-disk の manifest 契約に置く）。

```
bizdoc/
├── .claude-plugin/plugin.json      # name: bizdoc
├── skills/
│   ├── bizdoc/SKILL.md             # 生成 orchestrator
│   └── doc-hub/SKILL.md            # hub 操作（一覧 / open / 取込 / 再index）
├── scripts/
│   ├── hub.mjs                     # hub CLI（Node、依存パッケージなし）
│   └── project-id.mjs              # プロジェクト ID 解決
├── templates/
│   ├── tokens.css                  # 白基調 design tokens + A4 印刷 CSS
│   ├── components.md               # HTML コンポーネントカタログ（伝達目的キー）
│   └── svg-patterns/               # SVG 図解パターン集（1パターン1ファイル）
└── tests/                          # node:test によるテスト
```

- スクリプト・テンプレートの参照はすべて `${CLAUDE_PLUGIN_ROOT}/...`（相対参照は CWD 依存で壊れるため禁止）。
- macOS 標準環境で完結（Node は既存プラグイン同様に前提。追加 npm 依存なし）。

## 4. hub データ設計

### 4.1 ディレクトリ構成

```
~/Documents/doc-hub/
├── index.html                      # 導出物: reindex が毎回再生成（原子書き込み）
├── .hub-cli                        # hub.mjs の絶対パス（他スキル接続用ポインタ。初回実行時に書き出し）
└── projects/
    └── <project-id>/
        ├── project.json            # authored（正データ）
        └── docs/
            └── <YYYYMMDD>-<doc-slug>/
                ├── index.html      # ドキュメント本体（CSS/SVG インライン・自己完結1枚）
                ├── manifest.json   # authored（正データ）
                └── assets/         # ラスタ画像を使った場合のみ
```

**SSOT の線引き**: `projects/**`（project.json / manifest.json / ドキュメント本体）が authored の正データ。hub 直下の `index.html` は使い捨ての導出物であり、消しても `reindex` で完全再生成できる。

- 受け入れ基準: `rm index.html` 後の `hub.mjs reindex` が同一内容の index を再生成する（テスト化する）。

### 4.2 project.json

```json
{
  "id": "claude-code-skills-ef186db6",
  "label": "claude-code-skills",
  "abs_path": "/abs/path/to/project",
  "aliases": [],
  "accent": null,
  "created": "2026-07-30T00:00:00+09:00"
}
```

- **id は発番時に確定し、以後不変**。形式は turn-review 方式 `<basename-slug>-<sha256(絶対パス)[:8]>`（`~/.claude/plugins/marketplaces/turn-review-fork/skills/turn-review-book/scripts/cwd-to-id.js` と同一計算）。ID はあくまで初回発番の材料であり、以後パスが変わっても再計算しない。
- **プロジェクト解決順**（`hub.mjs` 内部）: (1) `abs_path` 完全一致 → (2) `aliases` 一致 → (3) 新規発番。リポジトリを移動・改名した場合は既存 project の `abs_path` を書き換えて追随（ID は変えない）。
- worktree 対応: ID 計算前に git main worktree のルートへ解決する（`git rev-parse --git-common-dir` 起点。decision-board の `detect-project.mjs` のロジックを踏襲コピーし、依存はしない）。git 管理外ディレクトリはそのままの絶対パスで発番する。
- `label` 既定は basename。`accent` はプロジェクト全ドキュメントで共有するアクセント色（§6.4）。

### 4.3 manifest.json（公開契約）

```json
{
  "schema_version": 1,
  "title": "◯◯システム更改 提案書",
  "slug": "system-renewal-proposal",
  "type": "提案書",
  "created": "2026-07-30T00:00:00+09:00",
  "updated": "2026-07-30T00:00:00+09:00",
  "entry": "index.html",
  "source_skill": "bizdoc",
  "project_id": "claude-code-skills-ef186db6",
  "tags": [],
  "links": { "decision_ids": [], "jiku_focus_ids": [] }
}
```

- `type` は自由文字列（推奨値: 提案書 / 報告書 / 解説 / 手順書 / 議事録 / その他）。
- `links` は v2 連携（decision-board / Jiku）用の器。v1 では常に空配列で書き出す。
- PDF 出力は manifest に**記録しない**（`~/Downloads` は一時置き場でありパス記録が誤誘導になるため）。
- この manifest スキーマ＋「manifest を書いて reindex を呼べば hub に載る」という冪等な取込手順が、他スキル（client-report 等）接続の公開契約。

### 4.4 hub CLI（scripts/hub.mjs）

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs <subcommand>

add <html-path> [--project <abs-path>] [--title <t>] [--type <t>] [--slug <s>]
                [--tags a,b] [--assets <dir>] [--update | --new]
list [--project <path|id>] [--json]
reindex
open [--project <path|id>]
```

- `add`: HTML（と assets）を hub 内へコピーし manifest を書き、reindex まで実行。`--project` 省略時は cwd から解決。
  - **衝突規則**: 同一 doc ディレクトリ（`<YYYYMMDD>-<slug>`）が既存なら既定はエラーで既存情報を提示。明示 `--update` で上書き更新（`updated` を進める）、`--new` で `-2` 連番の別ドキュメント化。黙って上書きしない。
  - **SVG ゲート（決定論）**: HTML 内の各 `<svg>` ブロックを抽出し `xmllint --noout`（macOS 標準）で XML 検証。不正なら reject して理由を表示。`xmllint` 不在環境では警告して続行（graceful degradation）。
- `reindex`: `projects/*/docs/*/manifest.json` を走査して `index.html` を再生成。
  - manifest 単位の try/catch。壊れ・欠損 manifest はディレクトリ名を仮タイトルにした「破損」エントリとして index に表示する（沈黙で捨てない・全体を失敗させない）。
  - 書き込みは tmp ファイル → rename の原子書き込み（iCloud 同期・並行実行への防御）。
- `open`: hub の `index.html` を `open` で開く（`--project` 指定時はプロジェクトセクションのアンカー付き）。
- hub ルートは環境変数 `DOC_HUB_DIR` で上書き可能（既定 `~/Documents/doc-hub`。テスト分離のために必要）。
- 初回実行時に `<hub>/.hub-cli` へ自身の絶対パスを書き出す（他スキルはこのポインタ経由で CLI を解決できる）。

### 4.5 hub index.html（導出物）

- 白基調のビジネスデザイン（tokens.css と同系統）。プロジェクトカード一覧 → 各プロジェクトのドキュメント一覧（`updated` 降順）。
- 検索データ（タイトル・種別・タグ・日付の要約 JSON）は index.html にインライン埋め込み、クライアントサイド JS でフィルタ。`file://` で開いた HTML は opaque origin となり外部 JSON への fetch が CORS で失敗するため、インライン以外の選択肢はない。
- スケール見積り: 1件 300–500B の要約で 1000 件でも 300–500KB。移行トリガーは件数でなく「index.html が 1–2MB を超えたとき」または「ブラウザ外から検索したくなったとき」。その時点で SQLite / ビューアサーバーを検討する（manifest 群が SSOT なので移行はいつでも可能）。

## 5. 生成スキル（skills/bizdoc）

`run-explainer-page` の実証済みフェーズ構造を踏襲し、ビジネス文書向けに改変する。1ターンで全フェーズを完走する（compaction 対策も踏襲）。

### Phase 0: 目的確定（新設）

- 会話・入力から「目的（なぜ作る）・読者（誰が読む）・文書種別・トーン」を確定する。
- 自明でない場合のみ AskUserQuestion を**1問だけ**使う（選択肢に種別と読者の組合せ候補を並べる）。
- ここで確定した目的・読者が Phase 2 の構成判断と各ブロックの `why` の判定基準になる。

### Phase 1: 調査

- `run-explainer-page` の Phase 1 と同一方式: コードベース題材は `Explore`、抽象トピックは general-purpose subagent の web research、両方なら並列 fire。親は要約のみ受け取り `context.md` に統合。
- Agent ツールが使えない文脈での縮退モード（自前 Read / WebSearch）も踏襲。
- 数字（価格・性能・日付）は出典 URL と取得日を必須とする。

### Phase 2: アウトライン（構造固定化の回避が核心）

`outline.json` を書く。**固定 skeleton は持たない**。

- **必須要素は2つだけ**（ビジネス文書の作法）: 表紙相当（タイトル・日付・目的・読者）と結論先出し（エグゼクティブサマリ）。それ以外の構成は目的・読者から毎回設計する。
- 文書種別ごとの構成ヒントは「順序付きテンプレ」ではなく「**この種別で読者が最初に知りたい問い**」の形で SKILL.md に置く（例: 提案書 →「結局いくらで何が良くなるのか」「なぜ今か」「リスクは何か」）。順序を与えると LLM がそのまま採ってしまい固定化するため、順序は書かない。
- `templates/components.md` は**伝達目的キー**で引くカタログとする: 「比較させる」「時系列を示す」「判断を促す」「根拠を示す」「全体像を掴ませる」「手順を追わせる」等。各目的に**最低2つの異なる表現**（例: 比較 = 表 / 2カラム対比 / スコアカード）を載せ、単一表現への収束を防ぐ。
- **outline の各ブロックに `why` フィールドを必須化**: そのブロックが Phase 0 の目的・読者にどう効くかを1行で書く。書けないブロックは削る。これが構成の惰性への実効的な歯止め。

### Phase 3: 図解（インライン SVG）

- 図解は Claude がインライン SVG を直接記述する。白基調・アクセント1色。
- `templates/svg-patterns/` の実証済みパターンを参照する。初期パターン: プロセスフロー / 比較・対比 / タイムライン・ロードマップ / アーキテクチャ構成図 / 2x2 マトリクス / KPI カード / ファネル / 関係図。
- SVG 記述の予防則（svg-patterns に明文化し、全パターンが従う）:
  - 文字幅は **CJK 1文字 = 1em、半角 = 0.5em** で見積り、パターンごとにラベル文字数上限を固定する（LLM は文字幅を測れないため、はみ出しの予防はここでしか効かない）
  - `viewBox` のみ指定し `width` / `height` の px 直書きをしない（レスポンシブ・印刷両対応）
  - `role="img"` + `<title>` / `<desc>` を必須（図中テキストの検索・読み上げ対応。ラスタ図の弱点の解消）
  - font-family は本文と同じ system font stack を継承する
  - 色は tokens.css の CSS 変数を参照（アクセント1色の原則を SVG にも適用）
- ラスタ画像（codex-imagegen）はユーザーが明示指示したときのみ。その場合も `run-explainer-page` の偽装検証（marker 方式）を踏襲する。

### Phase 4: HTML 組立

- `templates/tokens.css` をインライン化した自己完結1枚 HTML。CDN 参照禁止・JS は検索等の自己完結スクリプトのみ可。
- tokens.css の内容: 白基調（#fff ベース + グレースケール文字階調）、アクセント1色（CSS 変数 `--accent`）、system font stack（ヒラギノ系）、A4 印刷 CSS（`@page` / `break-inside` 回避 / `print-color-adjust: exact`）。
- アクセント色の優先順位: **project.json の `accent` が最優先**（プロジェクト内で文書の見た目を一貫させる）。未設定なら文書生成時に Claude が選び、その値を project.json に永続化する（次回以降はそれが勝つ）。
- path-privacy: 生成 HTML・PDF の本文/フッターに `/Users/` 始まりのフルパス・OS アカウント名を出さない（`~/` 表記か論理名）。

### Phase 5: hub 保存 + 確認

1. scratchpad で組み立てた HTML を `hub.mjs add` で hub へ保存（SVG ゲート→manifest→reindex まで CLI が実施）
2. `open` でブラウザ目視確認
3. **決定論ゲート2**: headless Chrome でページ全体を PNG 化し、Read で画像として確認する（テキストのはみ出し・SVG の視覚崩れは HTML ソースの目視では原理的に検出できないため）。崩れがあれば該当 SVG / セクションを修正して `--update` で再保存

### Phase 6: PDF 書き出し（要求時のみ）

- headless Chrome `--print-to-pdf` で `~/Downloads/<doc-slug>.pdf` に出力（一時配布用）。
- 手順・オプションは `run-explainer-page` Phase 6 を踏襲。インライン SVG のみの文書ではラスタ軽量化前処理は不要。ラスタ画像を明示利用した文書では `run-explainer-page` 同様に印刷用一時コピーで軽量化してから書き出す。
- manifest への記録はしない。

## 6. doc-hub スキル（skills/doc-hub）

hub CLI の薄いラッパー。トリガー例: 「ドキュメント一覧」「資料どこ」「doc hub 開いて」「このHTMLをhubに入れて」。

- 一覧表示・open・散逸ファイルの取込（`add` に既存 HTML を渡す）・reindex を担う。
- 取込時のプロジェクト判定は cwd 起点。別プロジェクトの成果物は `--project` で明示させる。

## 7. 品質担保・テスト

### 決定論ゲート（LLM の自己申告に頼らない）

1. `hub.mjs add` の SVG XML 検証（§4.4）
2. PNG 化 + Read による視覚確認（§5 Phase 5）

### 自動テスト（tests/、node:test）

- project-id: ID 計算の一致（cwd-to-id.js と同値）・worktree 解決・git 管理外 fallback
- hub CLI: add の衝突規則（既定エラー / --update / --new）・reindex 再現性（`rm index.html` → 同一出力）・壊れ manifest 耐性（破損エントリ化して続行）・SVG ゲートの reject
- すべて `DOC_HUB_DIR` で一時ディレクトリに分離して実行

### E2E（実装完了の受け入れ）

- サンプル文書1本を実生成 → hub 登録 → index 表示 → PDF 出力までを実走で確認
- 成果物に `/Users/` パスが含まれないことを grep で確認

## 8. リポジトリ規約チェックリスト（実装タスクに含める）

- [ ] `marketplace.json`（ルート）と `.claude-plugin/marketplace.json` の**両方**に同一エントリを追加
- [ ] marketplace エントリに `skills` フィールドを**入れない**（スキーマエラーになる）
- [ ] プロジェクト CLAUDE.md の収録プラグイン一覧・テスト実行節を更新
- [ ] コミット対象ファイルにユーザディレクトリ絶対パス・個人名を残さない

## 9. v2 拡張ポイント（今回は器のみ）

| 連携先 | v1 で用意する器 | v2 の想定 |
|---|---|---|
| decision-board | `manifest.links.decision_ids[]` | 決裁を伴う文書の生成時に起票を提案し、決裁 ID を相互リンク |
| Jiku MCP | `manifest.links.jiku_focus_ids[]` | 中長期軸（focus）と文書の紐付け・軸からの文書逆引き |
| 既存スキル接続 | manifest 公開契約 + `.hub-cli` ポインタ | client-report 等の成果物を hub へ自動登録 |
| ビューア強化 | manifest 群 = SSOT の維持 | index.html が 1–2MB 超で SQLite / ローカルサーバー閲覧を追加 |

## 10. 実装体制とトラック分割（概要。詳細は実装計画で確定）

| トラック | 内容 | 担当 | 評価 |
|---|---|---|---|
| A | hub.mjs + project-id.mjs + tests | Sonnet (executor) | Fable5 コードレビュー + テスト実走 |
| B | templates（tokens.css / components.md / svg-patterns） | Sonnet (designer) または Codex | Fable5 視覚評価（サンプル描画） |
| C | SKILL.md ×2 | Sonnet 起草 | Fable5 が実走評価・修正 |
| D | marketplace 両ファイル + CLAUDE.md + E2E | Sonnet (executor) | Fable5 が受け入れ確認 |

トラック A/B は独立並列可。C は A/B のインターフェース確定後。D は最後。

## 11. 参考: アドバイザーレビューの主要反映点

Opus アドバイザーによる設計レビュー（2026-07-30）から反映した主な変更:

- project ID を「毎回計算する導出値」から「一度発番して project.json に永続化」へ変更（移動・改名でドキュメントが孤立する欠陥の解消）
- SSOT の線引きを「hub ルート = 導出物 / projects/** = authored」に明文化。当初案の hub.json（レジストリキャッシュ）は読み手が存在しないため削除
- 文書種別ごとの「順序付き構成ヒント」を廃止し、「読者が最初に知りたい問い」形式へ（固定テンプレ化の力学を回避）
- SVG 品質担保を目視依存から決定論ゲート2つ（XML 検証・PNG 化確認）へ
- `~/Documents` の iCloud 同期が有効である事実を確認し、ユーザー承認の上で受諾。原子書き込み＋壊れ耐性を必須化
- PDF 出力の manifest 記録を廃止（一時ファイルのパス記録は誤誘導になるため）
