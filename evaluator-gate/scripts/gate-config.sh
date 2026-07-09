#!/usr/bin/env bash
# evaluator-gate の per-project オン/オフ/状態確認（config.json のアトミック更新）
# usage: gate-config.sh on|off|status
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/gate-lib.sh"

command -v jq >/dev/null 2>&1 || { echo "jq が必要です" >&2; exit 1; }

cmd="${1:-status}"
proj_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
project=$(resolve_project_root "$proj_dir" || true)
[ -n "$project" ] || project="$proj_dir"

set_enabled() {
  ensure_dirs
  tmpf="$GATE_CONFIG.tmp.$$"
  if [ -f "$GATE_CONFIG" ]; then base=$(cat "$GATE_CONFIG"); else base='{"schema":1,"projects":{}}'; fi
  printf '%s' "$base" | jq --arg p "$project" --argjson e "$1" --arg ts "$(now_iso)" \
    '.schema = 1 | .projects[$p] = {enabled: $e, updated: $ts}' > "$tmpf" && mv "$tmpf" "$GATE_CONFIG"
}

case "$cmd" in
  on)
    set_enabled true
    printf 'evaluator-gate: ON  (%s)\n' "$project"
    ;;
  off)
    set_enabled false
    printf 'evaluator-gate: OFF (%s)\n' "$project"
    ;;
  status)
    printf 'project: %s\n' "$project"
    if is_enabled "$project"; then printf 'enabled: true\n'; else printf 'enabled: false\n'; fi
    found=0
    if [ -d "$GATE_STATE_DIR" ]; then
      for sf in "$GATE_STATE_DIR"/*.json; do
        [ -f "$sf" ] || continue
        p=$(jq -r '.project // ""' "$sf" 2>/dev/null || echo "")
        [ "$p" = "$project" ] || continue
        found=1
        printf -- '- session %s: verdict=%s blocks=%s last_eval=%s (codex=%s grok=%s)\n' \
          "$(basename "$sf" .json)" \
          "$(jq -r '.last_verdict // "-"' "$sf")" \
          "$(jq -r '.block_count // 0' "$sf")" \
          "$(jq -r '.last_eval.ts // "-"' "$sf")" \
          "$(jq -r '.last_eval.codex // "-"' "$sf")" \
          "$(jq -r '.last_eval.grok // "-"' "$sf")"
      done
    fi
    [ "$found" -eq 0 ] && printf 'sessions: (none)\n'
    # 評価者の利用可否（secret 値は一切出力しない軽量チェック）
    if command -v codex >/dev/null 2>&1; then
      printf 'codex: %s\n' "$(codex login status 2>&1 | head -1)"
    else
      printf 'codex: not installed\n'
    fi
    GROK_BIN="${EVALUATOR_GATE_GROK_BIN:-$HOME/.grok/bin/grok}"
    if [ -x "$GROK_BIN" ] || command -v grok >/dev/null 2>&1; then
      grok_auth="$HOME/.grok/auth.json"
      if [ -f "$grok_auth" ]; then
        age_days=$(( ( $(date +%s) - $(stat -f%m "$grok_auth" 2>/dev/null || echo 0) ) / 86400 ))
        if [ "$age_days" -ge 7 ]; then
          printf 'grok: installed (auth %s days old — likely expired, run: grok login)\n' "$age_days"
        else
          printf 'grok: installed (auth %s days old)\n' "$age_days"
        fi
      else
        printf 'grok: installed (not logged in? run: grok login)\n'
      fi
    else
      printf 'grok: not installed\n'
    fi
    ;;
  *)
    printf 'usage: gate-config.sh on|off|status\n' >&2
    exit 64
    ;;
esac
