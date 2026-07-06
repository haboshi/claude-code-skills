# ハーネス構築リサーチ資料

独自の LLM ハーネス（Claude を中心に据えた実行基盤）を構築するために実施したディープリサーチの成果物を格納する。各ファイルは調査時点（2026-07 時点）のスナップショットであり、一次資料（Anthropic 公式 docs / engineering blog、主要論文）を優先して統合したもの。

## このディレクトリの目的

「ハーネス = モデル本体の外側にある、入出力契約・ワークフロー・ツール接続・記憶・評価・観測・運用・ガバナンスまでを含む実行基盤」と定義した上で、自前ハーネスを設計・構築する際の設計判断の土台をまとめる。テーマは大きく3つ（**ハーネス全体像 / ループエンジニアリング / 長期記憶とエバリュエーター**）に収束する。

## 収録資料（推奨読了順）

| # | ファイル | テーマ | 概要 |
|---|---|---|---|
| 01 | [01-claude-harness-overview.md](./01-claude-harness-overview.md) | ハーネス総覧 | Claude 中心 LLM ハーネスの全体像。マイクロ/マクロ/メタの三層、参照アーキテクチャ、実装パターン（直結・構造化出力・アダプタ）、公式スタック比較、評価/ベンチマーク/安全/ガバナンス、運用・コスト・エコシステム |
| 02 | [02-loop-engineering-claude-code.md](./02-loop-engineering-claude-code.md) | ループエンジニアリング | Claude Code の内側/外側ループ、`/goal`・`/loop`・Stop hook、subagents/agent teams/dynamic workflows の使い分け、理論基盤（制御理論・RL・ReAct系・分散合意）、設計パターン集、評価プロトコル |
| 03 | [03-loop-engineering-deep-dive.md](./03-loop-engineering-deep-dive.md) | ループエンジニアリング | ループの5層分解と **Evaluator 中心設計**、証拠生成ループという捉え方、普遍理論（MAPE-K・active inference・GAN的分離）、実践パターン/アンチパターン、プラットフォーム比較、実装サンプル |
| 04 | [04-agent-long-term-memory.md](./04-agent-long-term-memory.md) | 長期記憶 | AI エージェントの多層メモリーアーキテクチャ（原典/イベント/意味/手続き/作業/再整理/ガバナンス層）、学術研究の到達点、企業プロダクト比較、Obsidian/LLM Wiki の位置づけ、dreaming/sleep-time compute |
| 05 | [05-long-term-memory-and-evaluators.md](./05-long-term-memory-and-evaluators.md) | 長期記憶+評価 | write–manage–read 循環に **エバリュエーターを組み込む二重審査型アーキテクチャ**、参照 ER/フロー図と API 設計、ツール比較（Mem0/LangGraph/GraphRAG 他）、評価ベンチマーク、倫理・法務・セキュリティ（memory poisoning・削除権） |
| 06 | [06-claude-code-hooks.md](./06-claude-code-hooks.md) | フック大全 | Claude Code の**全フックイベント（約30種）一覧とライフサイクル内の位置（フロー図）**、設定・実行モデル（type 5種・exit code 意味論・多重フック合成）、5機能軸分類（制御ゲート/文脈注入/観測/変換/ループ制御）、国内外の活用事例カタログ＋実装フック実例、Stop hook 一般化のマルチエージェント拡張（PostToolBatch/SubagentStop/TeammateIdle）、evaluator 設置点としての本質論。**図解付き1枚 HTML 版**: [html/05-claude-code-hooks.html](./html/05-claude-code-hooks.html) |

## テーマ別の読み方

- **まず全体像を掴む** → 01。ハーネスを設計対象として扱う視点と、三層 × 横断セグメントの見取り図。
- **実行ループを設計する** → 02 → 03。02 が Claude Code の機能とパターンの実務面、03 が Evaluator を中核に据えた理論的深掘り。両者は補完関係。
- **フックを設計する** → 06。全イベントの介入点マップと、02/03 の停止規則・evaluator 理論をフック面に写像した実装カタログ。
- **記憶を設計する** → 04 → 05。04 が多層メモリーの全体設計、05 が「評価された更新・評価された再利用」という制御面としての記憶。

## 横断する設計原則（各資料の共通結論）

- **ハーネスの質はモデル単体より外側構造で決まる** — system prompt より tools / memory / loop 設計が性能を左右する。
- **良いループは「作業ループ」ではなく「証拠生成ループ」** — 完了は transcript または environment outcome 上で実証可能にする。Maker と Checker を分離する。
- **長期記憶は保存の問題ではなく、評価された更新と再利用の問題** — 中心部品は vector DB でも note vault でもなく、エバリュエーターを内包した memory control plane。
- **停止条件と保険（turn/budget/no-progress cap）を必ず持つ** — 暴走とサイレント早期終了の両方を防ぐ。
- **並列化は責務分割が可能なときだけ** — same-file 競合を避け、worktree/ファイル所有権で隔離する。

## 設計パッケージ（design/）

リサーチ5本を根拠に合成した「Evaluator をループエンジニアリング用ハーネス部品として実装するための設計」を [design/](./design/) に置く。入口は [design/00-overview.md](./design/00-overview.md)（統合レイヤリング表・中心原則・段階導入ロードマップ・仕様の確信度注記）。実装の雛形（hooks 設定断片・`/goal` 条件文テンプレ・自前ループの実行可能スケルトン）は `design/examples/` 配下。

## 注意事項

- 各ファイル末尾等に残る `citeturn…` は調査ツール由来の引用マーカー。リンクとしては解決しないが、原文の出典対応を保つためそのまま残している。
- 2026 年時点で `macro-harness` / `micro-harness` / `loop engineering` などは新興語彙であり、厳密な標準定義は流動的。各資料内でも「公式定義」と「分析上の定義」を区別して記載している。
- 内容は調査時点のスナップショット。Claude Code の `/goal`・`/loop`・agent teams・dynamic workflows は evolving な機能を含むため、実装時は最新の公式 docs で仕様を確認すること。
