---
description: transcript ログを増分分析し、失敗クラスターと改善示唆を人間向けHTMLレポートで出す運用改善ループ
---

harness-analytics スキルを起動して運用改善ループを実行してください。

引数（任意）: `$ARGUMENTS`
- `--backfill` … 全セッションを再生成（初回・分類ロジック更新後）
- `--window 14d` … 分析窓（既定 14d、`8w` 等）
- `--no-llm` … 決定論クラスターのみ（LLM 分析なし・低コスト）
- `--report-only` … インジェスト/集計せず既存データからレポートのみ再生成
- `--no-open` … 生成後にブラウザを自動で開かない（既定は固定ポート7788のサーバで開く）
- `--no-images` … codex インフォグラフィック生成をスキップ（決定論SVGのみ・即時）

`skills/harness-analytics/SKILL.md` の実行手順に従い、ingest → cluster →（`--no-llm` でなければ）
fresh-context subagent による上位クラスター分析 → build-report の順で実行し、最後にレポートのパスと
上位の改善バックログを簡潔に報告してください。**自動書き換えはせず示唆のみ**、確信度を明示すること。
