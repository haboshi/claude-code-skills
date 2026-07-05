---
name: harness-analytics
description: Claude Code の transcript ログを増分ダイジェスト化し、セッション横断で失敗パターン（ツールエラー・リトライ・権限拒否・compaction・ドリフト）を分析して、どのスキル/ルール/CLAUDE.md/settings を直すべきかを人間向けHTMLレポートで示唆する運用改善スキル。「ハーネス分析」「運用改善レポート」「失敗パターン分析」「harness analytics」「/harness-loop」「ログを分析して改善点」「ツールエラーの傾向」で発動。自動書き換えはせず示唆のみ（採否は人間）。
---

# harness-analytics — ハーネス運用改善ループ

Claude Code の transcript（`~/.claude/projects/**/*.jsonl`）を一次ソースに、**増分ダイジェスト**を
`~/.claude/harness-analytics/` に蓄積し、失敗クラスターを分析して改善対象を示唆する。
Quality Flywheel（評価→失敗クラスター分析→最適化）のメタ層実装。turn-review 非依存。

## 設計原則（厳守）

- **自動書き換えをしない**。出力は「示唆」であり、スキル/ルール/CLAUDE.md/settings の採否は人間が判断する。
- **改善役と判定役を分離**（self-improvement-integrity R2/R7）。LLM 分析は fresh-context の subagent に、
  改善履歴を渡さず（blind）成果物と目的だけを見せて根因を出させる。
- **secret/パスは書き込み前にマスク**（scripts が既定で実施。生 tool_result は既定で保存しない）。
- **重い処理は subagent**、SKILL は薄いオーケストレーションに徹する。

## 実行手順（/harness-loop）

引数: `--backfill`（全再生成）, `--window 14d`（既定 14d、`8w` 等可）, `--no-llm`（決定論のみ）, `--report-only`（集計せずレポートのみ）。
スクリプトは `${CLAUDE_PLUGIN_ROOT}/scripts/` にある（Bash から絶対パスで呼ぶ）。

1. **増分インジェスト**（`--report-only` 時はスキップ）
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/ingest.js [--backfill] --window <window>
   ```
   変更セッションのみダイジェスト化（サイズ未変化はスキップ）。初回や分類ロジック更新後は `--backfill`。

2. **決定論クラスタリング＋KPI**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/cluster.js --window <window>
   ```
   `clusters/latest.json`（失敗クラスター＋remediation）と `rollups/` を生成。

3. **LLM 分析**（`--no-llm` 時はスキップ）
   - `~/.claude/harness-analytics/clusters/latest.json` を Read し、上位 K 件（既定 8、config の `analysis.top_k_clusters`）を取る。
   - 各クラスターについて **fresh-context の subagent**（Explore または general-purpose）を1体起動し、
     **改善履歴を渡さず**次だけを与える: `error_class` / `tool` / `suggested_fix` / `target_surface` / `examples`（マスク済）/ `count` / `affected_sessions`。
     subagent への指示: 「この失敗クラスターの**根本原因仮説**、変更すべき**具体ファイルパス**（スキル/ルール/CLAUDE.md/settings.json）、
     **提案編集テキスト**（適用はしない）、`confidence`(0-1)、`priority`(0=最優先) を返せ。裏が取れない推測は confidence を下げよ」。
   - 収集結果を次の形で `~/.claude/harness-analytics/clusters/llm-latest.json` に **Write**:
     ```json
     { "analyses": [
       { "cluster_id": "file_not_read-Edit", "root_cause": "...", "target_files": ["CLAUDE.md"],
         "proposed_edit": "...", "confidence": 0.8, "priority": 1 }
     ] }
     ```

4. **インフォグラフィック生成**（上位クラスターの「問題→改善」1枚絵・任意・`--no-images` でスキップ）
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/infographic.js --limit 10   # 計画だけ見るなら --dry-run
   ```
   codex image_gen（ChatGPTサブスク枠・金銭コスト0）で上位10件の概念図を生成し、**コンテンツハッシュでキャッシュ**（内容不変なら再生成せず流用）、`infographics/<hash>/` にアーカイブ。数値は含めず概念のみ描く（偽造は出自検証で破棄）。codex 不在なら黙ってスキップ（レポートは決定論SVGで成立）。初回は最大10〜15分、2回目以降はほぼ0秒。

5. **レポート生成＋自動表示**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/build-report.js   # 開かないときは --no-open
   ```
   `reports/latest.html`（**ライト既定・レスポンシブ**）と `latest.md` を生成。構成は「まず直すべき1件」ヒーロー→優先度マップ（バブル図）→内訳チャート（inline SVG）→**指摘の詳細（master-detail：一覧＋詳細・インフォグラフィックor before/after SVG・根因・提案編集）**→改善バックログ→詳細表（折りたたみ）。
   **生成後に固定ポート7788のローカルサーバを起動して `http://127.0.0.1:7788/` を開く**（turn-review 流。使用中なら自動割当・SSH headless 時はスキップ・サーバ不可なら file:// フォールバック）。開きたくない場合や CI では `--no-open`。
   インフォグラフィックを画像込みで反映するには、手順4の後に本手順を（再）実行する。PDF 化は `latest.md` を pdf-creator-jp に渡す。生成物のパスも報告する。

6. **FetchDB 連携ドレイン**（config `sinks.fetchdb.enabled=true` かつ MCP `fetch-db` 接続時のみ・任意）
   - `mcp__fetch-db__data_stats` を1回呼び到達性を確認（失敗したらスキップし、その旨を報告）。
   - `~/.claude/harness-analytics/outbox/fetchdb.jsonl` を Read し、各行を `mcp__fetch-db__record_interaction` に送る
     （`type`/`content`/`tags`/`impact_scope`/`tool_source` をそのまま渡す）。送信済みで outbox を空にする（Write で空文字）。
   - 未接続・未設定なら何もしない（ローカルで完結）。

7. **報告**: 開いた URL（またはパス）、上位クラスター（件数・傾向）、注目すべき改善バックログ上位を簡潔に伝える。
   確信度は3段階（確認済み/高確度/未確認）で明示し、示唆であって自動適用しないことを添える。

## config（`~/.claude/harness-analytics/config.json`、無ければ既定。部分指定でも欠けたセクションは既定で補完）

```json
{
  "sinks": { "local_jsonl": { "enabled": true },
             "fetchdb": { "enabled": false, "min_severity": "failure" } },
  "analysis": { "window": "14d", "top_k_clusters": 8 },
  "privacy": { "store_raw_tool_result": false },
  "server": { "port": 7788, "idle_timeout_min": 30 },
  "infographics": { "enabled": true, "limit": 10, "timeout_sec": 600, "model": "gpt-5.4-mini", "reasoning": "low" },
  "auto_refresh": { "enabled": true, "stale_days": 7, "cooldown_hours": 12, "window": "14d" }
}
```

## 自動リフレッシュ（stale 検知・決定論・Claude不要）

SessionEnd フックは増分収集の後、**前回レポートから `stale_days`（既定7日）以上経過**していれば、
detached で `cluster`→`build-report` を走らせサーバ起動＋ブラウザ自動オープンする（`cooldown_hours` で二重起動を抑止）。
これは**決定論のみ**で、LLM 分析・codex 画像の"新規生成"は行わない（既存キャッシュは表示）。深掘りは手動 `/harness-loop`。
無効化は config の `auto_refresh.enabled=false`。SSH headless 時はオープンをスキップ（再生成のみ）。

## 保存先

`~/.claude/harness-analytics/` 配下（gitignore 前提のローカル状態・非配布）: `cursors.json` / `digests/` /
`rollups/` / `clusters/` / `reports/` / `outbox/` / `logs/`。

## テスト

```bash
cd ${CLAUDE_PLUGIN_ROOT} && npm test   # 純関数（digest/classify/cluster/rollup）のユニットテスト
```

## 既存資産との棲み分け

- **turn-review**: 人間向け per-turn 想起UI。本スキルは非依存で、クロスセッションの失敗分析を担う。
- **audit-tools**: 静的なツール資産棚卸し。本スキルは動的なセッション挙動/失敗の分析。
- **continuous-learning-v2**: 振る舞いの自動学習・自動適用。本スキルは示唆のみ（自動適用しない）。
- **FetchDB (`record_interaction`/`reflect`/`flywheel_health`)**: 永続メモリ/フライホイールKPI。本スキルは
  再実装せず、高シグナルを outbox 経由で供給する（任意）。
