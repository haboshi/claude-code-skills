---
name: aws-harness
description: プロジェクトごとに AWS の Identity を Agent CLI の起動前に固定する。契約の作成・追跡マーカーの配置・起動元の切り替え・拒否されたときの復旧を扱う。Use when setting up per-project AWS identity pinning, when a session is refused with an aws-harness message, when adding a new project to the harness, or when an AWS operation is denied by the harness guards. Triggers — "aws-harness", "契約", "Identity 固定", "起動が拒否される", "profile を切り替えたい", "誤アカウント".
---

# aws-harness

契約のあるリポジトリで Agent CLI を起動すると、契約の AWS Account 以外を
SDK・CLI が名前で解決できない状態になる。契約が壊れていれば起動しない。

**この仕組みが防ぐもの**: 人間・Agent いずれによる Identity の誤選択。
**防がないもの**: prompt injection や悪意あるコードによる能動的な認証情報の窃取。
同一 OS ユーザーで動く以上、ファイルを直接読む経路は塞げない。

## 新しいプロジェクトを保護下に置く

1. 対象アカウントに読み取り専用ロールを作る（`templates/iam-policy.example.json` を出発点にする）。
   AWS 管理ポリシーは使わない — AWS 側で更新され権限が予告なく広がるため。
2. 契約 ID を生成する: `uuidgen | tr 'A-Z' 'a-z'`
3. 契約ディレクトリを作る:
   `~/.claude/aws-harness/contracts/<contract-id>/` に
   `contract.json`（`templates/contract.example.json` を編集）と
   `aws-config`（`templates/aws-config.example` を編集）を置く。
4. リポジトリに `.aws-harness` を追加してコミットする（`templates/aws-harness.example` 参照）。
   このファイルは契約 ID だけを含み、Account 名も実名も含まない。
5. 起動元を shim に向ける（下記）。

## 起動元を shim に向ける

shim は `~/.claude/aws-harness/bin/claude` に置く。**symlink ではなく wrapper script にする**。

```bash
mkdir -p ~/.claude/aws-harness/bin
cat > ~/.claude/aws-harness/bin/claude <<'EOF'
#!/usr/bin/env bash
exec "<プラグインのインストール先>/scripts/harness-launch.sh" "$@"
EOF
chmod +x ~/.claude/aws-harness/bin/claude
```

`<プラグインのインストール先>` は実際のパスに置き換える。

**symlink にしてはいけない**。symlink 経由だと `$0` が symlink のパスになり、
`harness-launch.sh` が同じディレクトリにあるはずの他のスクリプトを見つけられず、
**契約の無いプロジェクトを含むすべての起動が拒否される**。

実 Agent CLI のパスは既定で `$HOME/.local/bin/claude`。異なる場合は
環境変数 `AWS_HARNESS_REAL_CLI` で指定する。

起動経路は3つあり、すべてこの wrapper に向ける。

- **Operator Harness**: リポジトリの既定ターミナル設定の起動コマンドを shim パスにする
- **対話シェルの alias**: alias の指す先を shim パスに変更する
- **PATH**: shim のディレクトリを PATH 前段に置く（補助）

設置後、**契約の無いディレクトリで一度起動して、通常どおり動くこと**を確認する。
ここで拒否されるなら設置方法が誤っている。

## 起動が拒否されたとき

| メッセージ | 意味 | 対処 |
|---|---|---|
| 契約が見つかりません | `.aws-harness` はあるが契約実体がない | 契約ディレクトリを作る（新しい端末では未配布） |
| contract_id の形式が不正です | マーカーが壊れている | `.aws-harness` を修正する |
| AWS の認証情報を取得できません | credential の失効 | 再認証してから起動し直す |
| Account が契約と一致しません | 契約の期待値と実 Identity の食い違い | 契約か profile 設定を見直す |
| 現在の AWS Identity が契約と一致しません | セッション中に Identity が変わった | セッションを終了して再起動する |

## 制限

- credential は起動時に解決し、走行中は再取得しない。失効したセッションは再起動する。
- フックの文字列検査は検出であって境界ではない（難読化・SDK 直叩きで回避できる）。
  境界は IAM の権限と、将来の credential broker / 実行環境の隔離が担う。
