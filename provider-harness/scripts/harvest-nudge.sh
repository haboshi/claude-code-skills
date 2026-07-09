#!/usr/bin/env bash
#
# harvest-nudge.sh — SessionStart hook（未処理 harvest 候補の督促・1行のみ出力）
#
# harvest-detect.sh（SessionEnd）が ~/.claude/provider-harness/pending.jsonl に
# 書き残した検知結果のうち、現在のプロジェクトに一致するものがあれば1行だけ stdout に出す。
# SessionStart hook の stdout は次ターンの context に注入されるため、ここで出した1行が
# 実装者への督促になる。harvest-protocol.md の強制その2（SessionStart 督促）に対応する。
#
# 方針:
#   - pending.jsonl が存在しない/空なら無音で exit 0
#   - 一致するプロジェクトが無ければ無音で exit 0
#   - best-effort。数秒以内に完了し、内部で何が起きても最終的に exit 0 する
#
set -uo pipefail

PENDING_FILE="${HOME}/.claude/provider-harness/pending.jsonl"

[[ -s "$PENDING_FILE" ]] || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"

# project パスを JSON 文字列として安全化（harvest-detect.sh と同一のエスケープ規則）
escaped_project="$(printf '%s' "$PROJECT_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')"

matched_line="$(grep -F "\"project\":\"${escaped_project}\"" "$PENDING_FILE" 2>/dev/null | tail -n 1)"

[[ -n "$matched_line" ]] || exit 0

# ts の日付部分のみ抽出（"ts":"2026-07-09T12:00:00Z" → 2026-07-09）
detected_date="$(printf '%s' "$matched_line" | sed -n 's/.*"ts":"\([0-9-]*\)T.*/\1/p')"

[[ -n "$detected_date" ]] || exit 0

echo "[provider-harness] このプロジェクトに未還流のプロバイダ統合変更があります（${detected_date} 検知）。/provider-harvest で知見還流を実行できます。"

exit 0
