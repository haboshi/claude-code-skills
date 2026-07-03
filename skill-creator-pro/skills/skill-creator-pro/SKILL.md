---
name: skill-creator-pro
description: "作成済みのスキルを配布可能な状態に仕上げる配布パイプライン。検証（構造・frontmatter・パス参照）、サニタイズ、gitleaks + 正規表現によるセキュリティスキャン（ハードコードされた秘密情報・個人情報の検出）、zip パッケージング、Git 配布、marketplace.json への登録を担当する。スキルをパッケージ化・配布したいとき、marketplace に登録したいとき、配布前のセキュリティスキャンやサニタイズを行いたいときに使用する。スキルの新規作成・設計・執筆そのものは対象外（superpowers:writing-skills / plugin-dev:skill-development を使うこと）。"
---

# Skill Creator Pro（配布パイプライン）

作成済みスキルを配布可能な状態に仕上げるための配布ライフサイクル特化スキル。**検証 → サニタイズ → セキュリティスキャン → パッケージング → 配布 → marketplace 登録**を担当する。

## スコープと責務分担

**このスキルは配布作業のみを担当する。スキルの新規作成・設計・執筆は行わない。**

- **スキルを新しく書く / 設計する / 記述を改善する**: `superpowers:writing-skills` または `plugin-dev:skill-development` を使用する。デザインパターン選択、description の書き方、progressive disclosure などの執筆ガイドはそちらに集約されている。
- **書き上げたスキルを配布する**: 本スキルを使用する。検証・秘密情報スキャン・パッケージング・marketplace 登録の実スクリプトを提供する。

執筆と配布は別レーン。本スキルは「配布前のゲート」として機能し、秘密情報や壊れたパス参照を含んだままの配布を防ぐ。

## 配布前提の確認

- **編集はソース配置場所で行う**: `~/.claude/plugins/cache/` 配下は読み取り専用キャッシュであり、そこでの変更はキャッシュ更新時に失われる。対象パスに `/cache/` や `/plugins/cache/` が含まれないことを必ず確認する。
- **バージョン履歴を SKILL.md に書かない**: バージョンは `marketplace.json` / `plugin.json` で管理する。
- **不要ファイルを含めない**: README.md（人間向け）はリポジトリルートに置き、スキルディレクトリ内には入れない。CHANGELOG.md 等も同様。

## 配布パイプライン

作成済みスキルディレクトリを対象に、次の順で実行する。該当しない工程のみスキップする。

### Step 1: 構造検証（quick_validate）

frontmatter・命名規約・パス参照の整合性を早期チェックする。パッケージング（Step 4）でも自動実行されるが、手直しの前に単独で回すと素早くフィードバックが得られる。

```bash
python scripts/quick_validate.py <path/to/skill-folder>
```

検証項目:

- `SKILL.md` の存在と YAML frontmatter の妥当性（インデントに ASCII スペース以外が混入していないか）
- `name` が hyphen-case（小文字・数字・ハイフンのみ、先頭末尾ハイフン・連続ハイフン不可）か
- `description` に山括弧（`<` `>`）が含まれていないか
- SKILL.md が参照する `scripts/` `references/` `assets/` パスが実在するか

失敗した場合は指摘された項目を修正して再実行する。

### Step 2: サニタイズレビュー（任意）

業務プロジェクトから抽出したスキルの場合、公開前に業務固有情報を除去する。

**実行前にユーザーへ確認する**: 「このスキルは業務プロジェクト由来に見えます。サニタイズレビューを実施しますか？」

以下の場合はスキップ: 最初から公開用に作成された / ユーザーが辞退 / 内部利用限定。

手順（自動スキャン・手動レビュー・検証）の詳細は `references/sanitization_checklist.md` を読むこと。

### Step 3: セキュリティスキャン（必須）

ハードコードされた秘密情報・個人情報を検出する。パッケージング（Step 4）はこのスキャンの通過マーカーを必須要件とするため、配布前に必ず実行する。

```bash
python scripts/security_scan.py <path/to/skill-folder>
python scripts/security_scan.py <path/to/skill-folder> --verbose
```

- **検出レイヤ**: gitleaks（秘密情報の業界標準ツール）＋正規表現パターン（絶対パス・メールアドレス・危険なコードパターン等）
- **終了コード**: 0 = クリーン / 1 = HIGH 深刻度 / 2 = CRITICAL（配布前に必ず修正）/ 3 = gitleaks 未インストール / 4 = スキャンエラー
- **初回セットアップ**: gitleaks をインストールする（macOS は `brew install gitleaks`）
- **通過時の挙動**: クリーンなら `.security-scan-passed` マーカーを生成する。このマーカーはスキル内容のハッシュを含み、パッケージング時に内容が改変されていないことを検証する（改変後は再スキャンが必要）。

CRITICAL は配布前に必ず解消する。秘密情報は環境変数（`os.environ.get('KEY_NAME')`）へ置き換える。

### Step 4: パッケージング

配布用 zip を生成する。スクリプトは検証（Step 1）とセキュリティマーカー（Step 3）を自動チェックしてからパッケージ化する。

```bash
python scripts/package_skill.py <path/to/skill-folder>
python scripts/package_skill.py <path/to/skill-folder> ./dist
```

内部処理の順序:

1. 構造検証（`quick_validate` を呼び出す）
2. セキュリティマーカー検証（`.security-scan-passed` の存在確認＋内容ハッシュ照合。改変があれば再スキャンを要求してブロック）
3. ディレクトリ構造を保った zip を生成

いずれかで失敗した場合はエラーを修正して再実行する。

### Step 5: 配布

スキルを共有するには、そのディレクトリを公開 Git リポジトリでホストする。

推奨リポジトリ構成:

```
my-skill-repo/
├── .github/          # （任意）GitHub Actions
├── my-skill/         # スキルディレクトリ
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── .gitignore
├── LICENSE
└── README.md         # 人間向けドキュメント（スキルディレクトリの外に置く）
```

`SKILL.md` は AI エージェント向け、`README.md` は人間の開発者向けでリポジトリルートに置く（スキルディレクトリ内には入れない）。

配布方法の詳細は `references/distribution-guide.md` を参照。

### Step 6: marketplace への登録

マーケットプレイスのマニフェスト（`marketplace.json` および `.claude-plugin/marketplace.json`）の `plugins` 配列にエントリを追加する。

```json
{
  "name": "skill-name",
  "source": "./skill-name",
  "description": "SKILL.md の frontmatter description からコピー",
  "version": "1.0.0",
  "category": "developer-tools",
  "keywords": ["relevant", "keywords"]
}
```

**重要: プラグインエントリに `"skills"` フィールドを含めてはならない。** Claude Code のマーケットプレイススキーマでバリデーションエラーになり、インストールが失敗する。スキルの検出は `skills/<name>/SKILL.md` の自動ディスカバリで行われる。

```jsonc
// NG — インストール時にスキーマエラー
{ "name": "foo", "source": "./foo", "skills": ["skills/foo"] }

// OK — name / source / description 等のみ
{ "name": "foo", "source": "./foo", "description": "..." }
```

**二重管理に注意**: このリポジトリではマニフェストが `marketplace.json`（ルート、GitHub 公開用）と `.claude-plugin/marketplace.json`（インストール時に読み込まれる実体）の 2 箇所に存在し、内容を完全一致させる必要がある。プラグイン追加・更新時は必ず両方を同時に更新する。

バージョン更新は semver に従う: パッチ（バグ修正）/ マイナー（機能追加）/ メジャー（破壊的変更）。

## スクリプト一覧

| スクリプト | 役割 | 実行フェーズ |
|:---|:---|:---|
| `scripts/quick_validate.py` | 構造・frontmatter・パス参照の検証 | Step 1 / Step 4（自動） |
| `scripts/security_scan.py` | gitleaks + 正規表現による秘密情報・個人情報検出 | Step 3 |
| `scripts/package_skill.py` | 検証・セキュリティマーカー確認後に zip 生成 | Step 4 |
| `scripts/init_skill.py` | 新規スキルの雛形生成（作成フェーズ用の補助。執筆は superpowers:writing-skills を推奨） | 配布対象外 |

`init_skill.py` は雛形生成の補助として残置しているが、スキルの設計・執筆自体は `superpowers:writing-skills` / `plugin-dev:skill-development` を使うこと。

## リファレンス一覧

| リファレンス | 参照タイミング |
|:---|:---|
| `references/sanitization_checklist.md` | 業務固有情報の除去（Step 2） |
| `references/distribution-guide.md` | パッケージングと配布の詳細（Step 4–5） |

執筆・設計に関するリファレンス（デザインパターン、description 最適化、テスト手法等）は本スキルのスコープ外。`superpowers:writing-skills` / `plugin-dev:skill-development` を参照すること。
