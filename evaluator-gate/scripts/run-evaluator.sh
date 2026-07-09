#!/usr/bin/env bash
# 単一評価者の起動（codex | grok）。ゲート/advisory 両用。
# usage: run-evaluator.sh <codex|grok> <prompt-file> <out-file> <cwd> <timeout-sec> [log-file]
# - 評価者の最終出力は <out-file> に書く。進捗・ログは log-file へ（フック stdout を汚染しない）
# - サブスク認証のみ使用（API 従量課金に落とさない）。read-only で実行する。
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/gate-lib.sh"

kind="${1:-}"; prompt="${2:-}"; outf="${3:-}"; cwd="${4:-$PWD}"; tsec="${5:-240}"; logf="${6:-/dev/null}"
if [ -z "$kind" ] || [ ! -f "$prompt" ] || [ -z "$outf" ]; then
  note "run-evaluator: 引数不正 (usage: run-evaluator.sh <codex|grok> <prompt-file> <out-file> <cwd> <timeout-sec> [log-file])"
  exit 64
fi

case "$kind" in
  codex)
    command -v codex >/dev/null 2>&1 || { note "codex CLI 不在"; exit 127; }
    # env -u OPENAI_API_KEY: ChatGPT サブスク経路を強制（API 従量課金への転落防止）
    # -s read-only: サンドボックスで書き込み禁止 / -o: 最終メッセージのみをファイルへ
    # プロンプトは stdin 渡し（引数クォート事故の回避）
    run_with_timeout "$tsec" env -u OPENAI_API_KEY codex exec \
      -s read-only -C "$cwd" --skip-git-repo-check \
      ${EVALUATOR_GATE_CODEX_MODEL:+-m "$EVALUATOR_GATE_CODEX_MODEL"} \
      -c model_reasoning_effort="${EVALUATOR_GATE_CODEX_EFFORT:-medium}" \
      -o "$outf" - < "$prompt" >> "$logf" 2>&1
    exit $?
    ;;
  grok)
    GROK_BIN="${EVALUATOR_GATE_GROK_BIN:-$HOME/.grok/bin/grok}"
    if [ ! -x "$GROK_BIN" ]; then
      GROK_BIN=$(command -v grok 2>/dev/null || true)
    fi
    if [ -z "$GROK_BIN" ] || [ ! -x "$GROK_BIN" ]; then note "grok CLI 不在"; exit 127; fi
    # --deny Write/Edit/Bash: grok は ~/.claude/settings.json の allow ルールを継承するため明示 deny 必須
    # --no-memory: fresh evaluator 原則（過去セッションの記憶を持ち込まない）
    run_with_timeout "$tsec" "$GROK_BIN" \
      --prompt-file "$prompt" --output-format plain \
      -m "${EVALUATOR_GATE_GROK_MODEL:-grok-4.5}" --cwd "$cwd" \
      --no-subagents --no-memory --disable-web-search --max-turns 8 \
      --deny Write --deny Edit --deny Bash \
      > "$outf" 2>> "$logf"
    exit $?
    ;;
  *)
    note "run-evaluator: 未知の評価者 '$kind'"
    exit 64
    ;;
esac
