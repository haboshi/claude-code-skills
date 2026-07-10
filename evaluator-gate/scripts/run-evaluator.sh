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

# 読取隔離: sandbox-exec が使えるなら、リポジトリ本体と $HOME の機密を read-deny する
# プロファイルで評価者を包む。これにより「サニタイズ済み evidence 以外を評価者が読む」経路を
# OS レベルで塞ぐ（read-only サンドボックスは書込のみ禁止で読取を防げないため）。
# EG_SANDBOX 配列に前置コマンドを入れる（空なら何も前置しない）。
# 評価者ごとに専用の作業ディレクトリを与える。codex と grok を並列で同じ cwd に置くと、
# 両者が Claude Code の hook を発火し、セッションログ等を同じ場所に書いて競合する
# （codex が os error 1 で落ちる）。cwd を分ければ書き込みが分離される。
run_cwd="$cwd/.run-$kind"
mkdir -p "$run_cwd" 2>/dev/null || run_cwd="$cwd"

# 読取隔離（opt-in）。評価者は untrusted な diff / 完了主張を読むため、注入された評価者が
# リポジトリ本体や $HOME 機密を読んだり、作業ディレクトリ外に書いたりできないようにする。
# 評価者 CLI 自身のサンドボックス（codex -s read-only / grok --deny Read...）は併用する。
EG_SANDBOX=()
if sandbox_available; then
  sb_profile="$run_cwd/.eg-sandbox.sb"
  write_sandbox_profile "$sb_profile" \
    "$(real_path "${EVALUATOR_GATE_PROJECT:-}")" "$(real_path "$cwd")"
  if [ -s "$sb_profile" ]; then
    EG_SANDBOX=(sandbox-exec -f "$sb_profile")
  fi
fi

case "$kind" in
  codex)
    command -v codex >/dev/null 2>&1 || { note "codex CLI 不在"; exit 127; }
    # env -u OPENAI_API_KEY: ChatGPT サブスク経路を強制（API 従量課金への転落防止）
    # プロンプトは stdin 渡し（引数クォート事故の回避）。-o: 最終メッセージのみをファイルへ
    #
    # 多層防御: codex 自身の -s read-only（書込禁止・承認ゲート）は常に維持し、
    # sandbox-exec が有効ならその外側で read/write をさらに絞る。
    # 外側 sandbox 下では codex の入れ子 sandbox_apply が拒否されるため、
    # モデル駆動のシェル実行も事実上できなくなる（プロンプト注入への耐性が上がる）。
    run_with_timeout "$tsec" ${EG_SANDBOX[@]+"${EG_SANDBOX[@]}"} \
      env -u OPENAI_API_KEY codex exec \
      -s read-only -C "$run_cwd" --skip-git-repo-check \
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
    # 毎 Stop で実行するバイナリなので、置き換えによる実行乗っ取りを避ける:
    # 実体（symlink は解決後の target）が自分または root 所有で、group/other から
    # 書き込み可能でないことを確認する。symlink 自体は 777 が普通なので必ず解決する。
    # stat が使えない環境ではチェックを省略する（best-effort な多層防御）
    GROK_REAL="$GROK_BIN"
    while [ -L "$GROK_REAL" ]; do
      link_target=$(readlink "$GROK_REAL" 2>/dev/null) || break
      case "$link_target" in
        /*) GROK_REAL="$link_target" ;;
        *)  GROK_REAL="$(dirname "$GROK_REAL")/$link_target" ;;
      esac
    done
    bin_owner=$(stat -f '%u' "$GROK_REAL" 2>/dev/null || stat -c '%u' "$GROK_REAL" 2>/dev/null || echo "")
    bin_perm=$(stat -f '%Lp' "$GROK_REAL" 2>/dev/null || stat -c '%a' "$GROK_REAL" 2>/dev/null || echo "")
    if [ -n "$bin_owner" ] && [ "$bin_owner" != "$(id -u)" ] && [ "$bin_owner" != "0" ]; then
      note "grok バイナリの所有者が想定外のため実行しません: $GROK_REAL"; exit 126
    fi
    if [ -n "$bin_perm" ]; then
      case "$bin_perm" in
        *[2367][0-7]|*[2367]) note "grok バイナリが group/other から書込可能なため実行しません: $GROK_REAL"; exit 126 ;;
      esac
    fi
    # --deny Read/Write/Edit/Bash: grok は ~/.claude/settings.json の allow ルールを継承するため明示 deny 必須。
    # Read も拒否する（証拠は prompt.md に同梱済み。evidence 外のローカルファイルを読ませない）。
    # prompt-file は CLI 自身が読むためツールの Read は不要。
    # --no-memory: fresh evaluator 原則（過去セッションの記憶を持ち込まない）
    run_with_timeout "$tsec" ${EG_SANDBOX[@]+"${EG_SANDBOX[@]}"} \
      "$GROK_BIN" \
      --prompt-file "$prompt" --output-format plain \
      -m "${EVALUATOR_GATE_GROK_MODEL:-grok-4.5}" --cwd "$run_cwd" \
      --no-subagents --no-memory --disable-web-search --max-turns 8 \
      --deny Read --deny Write --deny Edit --deny Bash \
      > "$outf" 2>> "$logf"
    exit $?
    ;;
  *)
    note "run-evaluator: 未知の評価者 '$kind'"
    exit 64
    ;;
esac
