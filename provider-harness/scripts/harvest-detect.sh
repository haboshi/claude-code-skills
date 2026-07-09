#!/usr/bin/env bash
#
# harvest-detect.sh — SessionEnd hook（決定論検知・pending キューへの追記のみ）
#
# セッション中に触られた可能性のあるファイルにプロバイダ SDK（openai/gemini/deepgram 等）の
# 痕跡があれば、~/.claude/provider-harness/pending.jsonl に1行追記する。
# harvest-protocol.md（skills/provider-harness/references/harvest-protocol.md）が定める
# 「還流を人間の習慣に頼らない3点の強制機構」のうち、強制その1（SessionEnd 検知）に対応する。
#
# 方針:
#   - best-effort。ネットワークアクセスなし、数秒以内に完了する
#   - stdout には何も出さない（ノイズを避ける。ユーザー向け督促は harvest-nudge.sh の役割）
#   - セッション終了を絶対にブロックしてはならない。内部で何が起きても最終的に exit 0 する
#   - 連想配列（declare -A）は使わない。macOS 標準の /bin/bash はバージョン3.2系であり
#     連想配列は非対応のため、case 文で provider→pattern を引く
#
set -uo pipefail

PENDING_DIR="${HOME}/.claude/provider-harness"
PENDING_FILE="${PENDING_DIR}/pending.jsonl"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"

# --- git リポジトリでなければ何もしない -------------------------------------

if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# --- 今セッションで触られた可能性のあるファイル一覧 -------------------------
# HEAD との差分（コミット済み変更）と、ステージ/未追跡の変更（status --porcelain）の両方を見る。
# porcelain の各行は "XY PATH" 形式なので先頭3文字を cut で落とし PATH 部分だけを取り出す。

changed_files="$(
  {
    git -C "$PROJECT_DIR" diff HEAD --name-only 2>/dev/null
    git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | cut -c4-
  } | sort -u
)"

[[ -n "$changed_files" ]] || exit 0

# --- プロバイダ SDK パターン（provider 名 → grep -E パターン） --------------
# ここでは決定論の grep のみを行い、LLM 判断は混ぜない。

provider_pattern() {
  case "$1" in
    openai) printf '%s' "from openai|import openai|require\\(['\"]openai" ;;
    gemini) printf '%s' "@google/genai|google\\.genai" ;;
    google-cloud) printf '%s' "@google-cloud/" ;;
    deepgram) printf '%s' "deepgram" ;;
    assemblyai) printf '%s' "assemblyai" ;;
    elevenlabs) printf '%s' "elevenlabs" ;;
  esac
}

PROVIDERS_LIST="openai gemini google-cloud deepgram assemblyai elevenlabs"

found_providers=()

while IFS= read -r rel_path; do
  [[ -z "$rel_path" ]] && continue

  # 対象拡張子のソースファイルのみ（.tsx を .ts より先に判定）
  if [[ ! "$rel_path" =~ \.(tsx|ts|mjs|js|py)$ ]]; then
    continue
  fi

  abs_path="${PROJECT_DIR}/${rel_path}"
  [[ -f "$abs_path" ]] || continue

  for provider in $PROVIDERS_LIST; do
    pattern="$(provider_pattern "$provider")"
    if grep -qiE "$pattern" "$abs_path" 2>/dev/null; then
      found_providers+=("$provider")
    fi
  done
done <<< "$changed_files"

[[ "${#found_providers[@]}" -gt 0 ]] || exit 0

# --- 重複除去 ----------------------------------------------------------------

unique_providers="$(printf '%s\n' "${found_providers[@]}" | sort -u)"

mkdir -p "$PENDING_DIR" 2>/dev/null || exit 0

today="$(date -u +%Y-%m-%d)"

# project パスを JSON 文字列として安全化（バックスラッシュ・二重引用符のエスケープ）
escaped_project="$(printf '%s' "$PROJECT_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')"

# --- 同一 project + 同一日付のエントリが既にあれば追記しない（重複防止） ----

if [[ -f "$PENDING_FILE" ]]; then
  if grep -F "\"project\":\"${escaped_project}\"" "$PENDING_FILE" 2>/dev/null \
      | grep -qF "\"ts\":\"${today}T"; then
    exit 0
  fi
fi

# --- providers 配列を JSON として組み立てる ----------------------------------

providers_json=""
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  if [[ -z "$providers_json" ]]; then
    providers_json="\"${p}\""
  else
    providers_json="${providers_json},\"${p}\""
  fi
done <<< "$unique_providers"
providers_json="[${providers_json}]"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '{"ts":"%s","project":"%s","providers":%s}\n' "$ts" "$escaped_project" "$providers_json" \
  >> "$PENDING_FILE" 2>/dev/null

exit 0
