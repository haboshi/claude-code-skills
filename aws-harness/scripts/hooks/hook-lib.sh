#!/usr/bin/env bash
# aws-harness フック共通ライブラリ（bash 3.2 互換）
#
# 入力の読み取り・保護対象の判定・deny への倒し方は guard-bash.sh / guard-files.sh /
# guard-prompt.sh の3フックで完全に同じで、しかも fail-closed の要になる。ここに
# 集約することで、修正が1箇所で済み、フック間の挙動のずれも起きない。
#
# 重要: 各関数は結果を標準出力ではなくグローバル変数へ代入する。
# `x=$(hook_read_input)` のようにサブシェル経由で呼び出すと、関数内の `exit 2` は
# サブシェルを終えるだけで親スクリプトは続行してしまい、deny がすべて無効化される。
# 呼び出し側は関数を直接実行し、代入されたグローバル変数を読むこと。

deny() { printf 'aws-harness: %s\n' "$1" >&2; exit 2; }

# 標準入力を HOOK_INPUT に読み込む。外部コマンド（cat）に依存せず bash 組込みの read
# だけで行う。jq や PATH が壊れた環境でも「保護対象でなければ素通しする」を成立させるため。
#
# 0バイト入力は「JSON 破損」と違い jq が rc=0/空文字で通してしまうため .cwd 抽出の
# 成否だけでは検知できない。入力自体が読めない状態は保護対象かどうかも判定できない
# 「想定外入力」として、保護対象・非保護対象を問わず一律 deny する（安全側に倒す）。
hook_read_input() {
  HOOK_INPUT=""
  IFS= read -r -d '' HOOK_INPUT
  [ -n "$HOOK_INPUT" ] || deny "フック入力が空です"
}

# 作業ディレクトリを HOOK_PROJECT_DIR に決定する。
# CLAUDE_PROJECT_DIR → 入力の .cwd → $PWD の順で解決する（jq を使わずに済む経路を先に
# 試す）。cwd 欠落（空文字）は正常系として $PWD へフォールバックする一方、JSON 自体が
# 壊れていて jq が解釈できない場合はフォールバックせず即座に deny する（「想定外入力は
# 必ず exit 2」の原則。cwd を特定できないまま $PWD を信用しない）。
hook_project_dir() {
  HOOK_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
  if [ -z "$HOOK_PROJECT_DIR" ] && command -v jq >/dev/null 2>&1; then
    HOOK_PROJECT_DIR=$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null) \
      || deny "フック入力を解析できません"
  fi
  [ -n "$HOOK_PROJECT_DIR" ] || HOOK_PROJECT_DIR="$PWD"
}

# jq が無ければ deny する。保護対象と判定した後（依存が要る検査の直前）にだけ呼ぶこと。
# $1: 何の検査ができないかを表す短い説明（例: "Bash の検査"）
hook_require_jq() {
  command -v jq >/dev/null 2>&1 || deny "jq が無いため、${1:-検査}ができません"
}
