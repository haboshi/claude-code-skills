#!/usr/bin/env bash
# PreToolUse(Read/Edit/Write): AWS 認証設定・契約・ハーネス自身への直接アクセスを deny する
# 入力の読み取り・保護対象の判定は hook-lib.sh に集約（3フックで共通）
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
. "$HOOK_DIR/hook-lib.sh"

hook_read_input                 # HOOK_INPUT に代入（サブシェルにしない）
hook_project_dir                # HOOK_PROJECT_DIR に代入

[ -f "$HOOK_PROJECT_DIR/.aws-harness" ] || exit 0

hook_require_jq "ファイル操作の検査"

printf '%s' "$HOOK_INPUT" | jq -e . >/dev/null 2>&1 || deny "フック入力が JSON ではありません"
path=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) \
  || deny "フック入力を解析できません"

[ -n "$path" ] || exit 0

harness_root="${AWS_HARNESS_HOME:-$HOME/.claude/aws-harness}"
plugin_root="${AWS_HARNESS_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"

# *"/.aws/"* は "~/.aws/..."（先頭がプレーンな文字列の場合）や "./.aws/..."・
# "../.aws/..."（"." の直後に "/.aws/" が続く）まで拾えるが、先頭に何も付かない
# 相対パス ".aws/credentials" のような形は「文字列の先頭から .aws/ で始まる」
# パターンでないと拾えない。".aws/"* を追加してこの穴を塞ぐ。
case "$path" in
  "$HOME/.aws/"*|*"/.aws/"*|".aws/"*)  deny "AWS 認証設定への直接アクセスを禁止しています" ;;
  "$harness_root"/*)          deny "契約およびハーネスの内部ファイルへのアクセスを禁止しています" ;;
esac

if [ -n "$plugin_root" ]; then
  case "$path" in
    "$plugin_root"/scripts/*) deny "ハーネス自身のスクリプトへのアクセスを禁止しています" ;;
  esac
fi

exit 0
