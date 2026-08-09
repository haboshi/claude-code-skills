#!/usr/bin/env bash
# PreToolUse(Read/Edit/Write/NotebookEdit/Grep/Glob): AWS 認証設定・契約・
# ハーネス自身への直接アクセスを deny する
# 入力の読み取り・保護対象の判定は hook-lib.sh に集約（3フックで共通）
# fix round 1: Grep/Glob はパスを tool_input.file_path ではなく tool_input.path に
# 持つ（公式 tools-reference で確認）。matcher にこの2ツールを追加しただけでは
# フィールド名の違いで検査が空振りするため、path も見るよう抽出を拡張した。
set -u

# 自身のディレクトリを解決する。dirname(1) は外部コマンドで PATH に依存するため使わず、
# bash 組込みのパラメータ展開だけで求める（PATH が壊れた環境でも hook-lib.sh を
# 読み込めるようにするため。cd/pwd はどちらもシェル組込みで PATH に依存しない）。
case "$0" in
  */*) HOOK_DIR=$(cd "${0%/*}" && pwd) ;;
  # $0 にスラッシュが無い（PATH 経由で名前解決された等）場合、自身の場所を
  # 特定できない。$PWD へ推測で倒すと fail-open になるため deny する。
  # hook-lib.sh を読み込む前なので deny() はまだ使えず、同等の処理をインラインで書く。
  *)   printf 'aws-harness: フックの自身のディレクトリを解決できません\n' >&2; exit 2 ;;
esac
# hook-lib.sh 自体が読めない（欠落・権限不備）場合も deny() はまだ使えないため、
# 同じくインラインで stderr メッセージと exit 2 を書く。読み込み失敗を無視すると
# 後続の hook_read_input 等が未定義関数呼び出しとなり、set -u の未束縛変数参照経由で
# bash が exit 1（非ブロッキング）に退化して素通りしてしまう（$0 バグと同じ経路）。
. "$HOOK_DIR/hook-lib.sh" || {
  printf 'aws-harness: hook-lib.sh を読み込めません\n' >&2
  exit 2
}

hook_read_input                 # HOOK_INPUT に代入（サブシェルにしない）
hook_project_dir                # HOOK_PROJECT_DIR に代入

[ -f "$HOOK_PROJECT_DIR/.aws-harness" ] || exit 0

hook_require_jq "ファイル操作の検査"

printf '%s' "$HOOK_INPUT" | jq -e . >/dev/null 2>&1 || deny "フック入力が JSON ではありません"
path=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null) \
  || deny "フック入力を解析できません"

[ -n "$path" ] || exit 0

# fix round 1: set -u 下で ${AWS_HARNESS_HOME:-$HOME/...} をそのまま評価すると、
# AWS_HARNESS_HOME 未設定時に default 側の $HOME が展開され、HOME も未設定なら
# 未束縛変数エラーで bash が exit 1（非ブロッキング）に退化して素通りする
# （$0/hook-lib.sh 読込失敗と同じ退化経路のバグの6例目）。harness_root
# （契約・ハーネス内部ファイルの保護境界）を決定できない状態は判定不能として deny する。
harness_root="${AWS_HARNESS_HOME:-}"
if [ -z "$harness_root" ]; then
  [ -n "${HOME:-}" ] || deny "HOME が未設定のため契約ディレクトリの場所を判定できません"
  harness_root="$HOME/.claude/aws-harness"
fi
plugin_root="${AWS_HARNESS_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"

# *"/.aws/"* は "~/.aws/..."（先頭がプレーンな文字列の場合）や "./.aws/..."・
# "../.aws/..."（"." の直後に "/.aws/" が続く）まで拾えるが、先頭に何も付かない
# 相対パス ".aws/credentials" のような形は「文字列の先頭から .aws/ で始まる」
# パターンでないと拾えない。".aws/"* を追加してこの穴を塞ぐ。
# fix round 1: 旧 "$HOME/.aws/"* は削除した。"$HOME/.aws/" で始まる文字列は
# 定義上必ず "/.aws/" という部分文字列を含むため *"/.aws/"* に完全に包含される
# （$HOME が空文字でも同様）。redundant だった上に $HOME への不要な依存を
# 生んでいたので、削除して case 自体を $HOME 非依存にした。
case "$path" in
  *"/.aws/"*|".aws/"*)  deny "AWS 認証設定への直接アクセスを禁止しています" ;;
  "$harness_root"/*)          deny "契約およびハーネスの内部ファイルへのアクセスを禁止しています" ;;
esac

if [ -n "$plugin_root" ]; then
  case "$path" in
    "$plugin_root"/scripts/*) deny "ハーネス自身のスクリプトへのアクセスを禁止しています" ;;
  esac
fi

exit 0
