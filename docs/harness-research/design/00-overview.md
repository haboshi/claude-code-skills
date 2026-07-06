# Evaluator ハーネス設計 — 概観と読み方

このパッケージの結論を先に述べる。**Evaluator は「1か所に置く採点部品」ではない。** micro（tool）/ meso（turn）/ macro（session・workflow）/ meta の各ループ接続点と、長期記憶の write / manage / read の各経路に、証拠・ブロック権・同期性・頻度×コストを変えた**別種の判定器を分散配置する「証拠生成ループの遷移関数」**として設計する。判定が「No」を返すこと自体が次ターンの指令になり、記憶の昇格・保留・却下・忘却を制御する政策になる。この二面性を軸に、6セクションで「定義 → 配置 → 実装 → 記憶 → 信頼性 → 参照実装」を貫く。

本ファイルは横断の地図であり、各セクションの本文を再掲しない。個別の擬似コード・表・スキーマは各章を参照。

## このパッケージの読み方（6セクションの地図）

| # | ファイル | 何が書いてあるか | いつ読むか |
|---|---|---|---|
| 01 | [01-evaluator-taxonomy.md](./01-evaluator-taxonomy.md) | Evaluator の厳密定義（ループ遷移関数 × 記憶政策エンジンの二面体）、grader/judge/verifier/critic/reward-model/policy-gate の正規化対応表、機能×実装方式の直交2軸、verdict 語彙 | まず概念を揃える |
| 02 | [02-layering-and-placement.md](./02-layering-and-placement.md) | micro/meso/macro/meta の4層に別種の判定器を分散する配置設計、Claude Code サーフェスと自前ハーネスへの写像、cheap→expensive カスケードの背骨 | どこに置くかを決める |
| 03 | [03-implementation-patterns.md](./03-implementation-patterns.md) | 判定器そのものの入出力契約（`Verdict` 4値）、証拠モデル、合成カスケード、Maker–Checker 分離、構造化出力、最小テンプレ3種 | 判定器をどう作るか |
| 04 | [04-memory-path-evaluators.md](./04-memory-path-evaluators.md) | 記憶固有の判断則。write の promote/hold/reject/merge/supersede、manage の「原典を上書きしない」、read の final_score 合成＋ hard gate、poisoning と削除権 | 記憶に効かせる |
| 05 | [05-reliability-and-meta-evaluation.md](./05-reliability-and-meta-evaluation.md) | judge を信頼してよい前提を否定し、バイアス緩和・fresh-context reviewer・gold set 定期点検・敵対的多票・Goodhart 対策・Evaluator 自体の8指標 | judge を信頼するために |
| 06 | [06-reference-implementation.md](./06-reference-implementation.md) | 単一 `Verdict` 契約で write/manage/read/outcome を統一する参照アーキ、データモデル、系統A（CC ネイティブ）/系統B（Agent SDK・自前ループ）、段階導入、回帰スイート | 組み上げる |

**推奨読了順**は番号順（01 → 06）。ただし関心別なら次の通り。判定器を作りたい：01 → 03 → 06。記憶を設計したい：01 → 02 → 04。judge の信頼性が心配：05 を先読み。02〜06 は 01 の定義語彙を共有しているので、用語で迷ったら 01 に戻る。

## 結論（crux）と中心原則

Evaluator を採点器としてしか見ないと、ハーネスは「賢い無駄働き」に陥る。設計対象は判定の**配線**と**証拠**であって、プロンプトの巧拙ではない。全セクションが次の4原則に収束する。

- **決定論を土台に cheap→expensive のカスケードで合成する。** test/lint/型/`git status`/regex/policy で割り切れる判定を最下層に置き、LLM judge は決定論で割り切れない残差にだけ、頻度に応じた粒度で投入する。単一判定器に全部を負わせない。
- **Maker–Checker を分離する（自己採点の禁止）。** 実装ループと評価ループを別 prompt・別 model・別 agent に分け、reviewer には diff と acceptance criteria（rubric）だけを渡す。「今回の狙い」「改善履歴」は渡さない（blind 化）。
- **完了は「証明」に落とす。** 「いい感じに」ではなく「`npm test` が exit 0、`git status` が clean」のように、証拠を transcript か environment outcome 上で実証可能な条件へ翻訳する。tool-less な判定器（`/goal`・prompt Stop hook）は会話に surface された証拠しか見られない。
- **judge を放置しない。** 判定器自身が position/verbosity/self-enhancement のバイアスと drift を持つため、gold set で定期点検する meta-eval を常設し、採点経路（rubric・合格ライン・評価スクリプト・judge プロンプト）を封印して Goodhart／reward hacking を防ぐ。

## 統合レイヤリング表（最重要）

Evaluator の配置を1枚に畳んだもの。上から下へ、頻度が下がりコストが上がる。**同期層（ブロック権あり）で不可逆を止め、非同期層（記録専用）で軌跡を残す**のが基本の振り分け。

| レイヤー | 何を評価するか | Claude Code 実装 | 独自ハーネス実装 | コスト・頻度 | 代表例 |
|---|---|---|---|---|---|
| **micro（tool）** | 個々の tool 呼び出しの妥当性・境界逸脱（危険コマンド／編集境界／pattern）。決定論で割り切れる範囲 | PreToolUse hook（block 可・`command` 型で決定論）／ PostToolUse（`additionalContext` 追記） | pre/post-tool ミドルウェア gate（regex／allowlist／policy の決定論チェック） | 最低 / 毎 tool 呼び出し | security-guidance の pattern-check、危険コマンド遮断 |
| **meso（turn）** | 1ターンの成果と暫定完了判定（transcript に surface された証拠のみ） | prompt 型 Stop hook ／ `/goal`（tool-less・小型高速モデル＝既定 Haiku） | turn-end gate（単発 LLM critic。決定論結果は worker が先に会話へ載せる前提） | 低〜中 / 毎ターン | `/goal` の完了判定、per-turn model review |
| **macro（session・workflow）** | セッション／ワークフロー全体の達成・実地検証（実コマンド実行・多票・敵対） | agent 型 Stop hook（ツール可・複数 tool-use turns）／ subagent reviewer ／ dynamic workflow 多票 | session-end gate、カスケードの Done 判定段、Agent SDK の independent-done ＋三重 cap（max_turns / max_budget_usd / no-progress） | 高 / 節目（commit・push・完了） | commit/push 時の agentic-review、fresh-context reviewer |
| **memory write** | 保存候補の promote / hold / reject / merge / supersede（新規性・根拠・矛盾 ＋ coverage/preservation/faithfulness） | memory 書き込みを捕捉する hook（設計案・公式イベント未確認）、compaction bulk ingest を起点 | memory write-gate ミドルウェア、quarantine 隔離 | 中 / 記憶更新候補ごと | TrustMem transition verifier、poisoning 第一防衛 |
| **memory manage** | consolidation／dreaming の妥当性（原典を上書きしない・派生として promote）と忘却式 | `/loop`・scheduled task 上のオフライン再整理（原典 tombstone は別ゲート） | consolidate/forget ミドルウェア、learned forgetting、tombstone は human/policy ゲート | 中〜高 / 低頻度（バッチ） | dreaming の原典不変、寒冷層への降格 |
| **memory read** | 再利用時の relevance ＋ freshness/authority/policy_fit − contradiction_risk、status/scope/sensitivity の hard gate | `MEMORY.md` 索引のオンデマンド読込みを対象に再ランク | retrieve ミドルウェア（final_score 合成＋ hard gate 先行除外） | 低〜中 / 想起・検索ごと | RETRIEVAL_HIT スコアリング、stale／scope 外の除外 |
| **meta** | judge 自身のバイアス・drift・calibration（human agreement／inter-run consistency／ECE／false accept-reject／drift） | gold set を定期投入する別ワークフロー（scheduled task／別 subagent） | meta-evaluator サービス、回帰スイート（task/trial/grader/transcript/outcome 分離）、採点経路の封印 | 最高 / 最低頻度（定期点検） | gold set 再計測→閾値割れで rubric 再調整／降格 |

補足（表の読み違い防止）:
- **write / manage / read** は 04・05章の設計枠組みであって Claude Code の公式機構名ではない。**micro/meso/macro/meta** は 02章の分析上の定義。両者の対応（例: write を meso 相当の頻度に、read を micro 相当に）は**分析上の割り当て**であり、最適な頻度・ループ位置は実測未検証（open questions 参照）。
- 「代表例」列は各章で扱う具体例への索引。詳細な擬似コード・スキーマ・閾値式は当該章にある。

## 横断設計原則（配置の判断基準）

上の4原則を、配置を決めるときのチェックリストに展開する。

1. **証拠が transcript／environment に落ちるものは、まずルール型（決定論）で。** 最安・最も誤魔化されにくい。LLM judge はここで割り切れない品質にだけ回す。
2. **ブロックが要る判定は同期層、記録・追記でよい判定は非同期層。** 不可逆・破壊的な操作は同期の micro/macro で止め、非同期の記録は軌跡として meta へ流す。
3. **制御権の階層に Evaluator 配置を一致させる。** subagent は親、agent team は lead、dynamic workflow は script が次遷移を決める。多票・敵対・監査可能性が要るなら判定器を workflow（script）層へ上げる。
4. **停止条件と保険を必ず別レイヤーに持つ。** ブロック層（Stop hook 等）とは独立に turn/budget/no-progress cap を置き、暴走とサイレント早期終了の両方を止める。
5. **verdict は機械可読な列挙で返す。** `status` を enum（pass/fail/revise/escalate 等）に固定し、`reason`／`evidence_refs`／`next_directive` を持たせて、ループ自動分岐と監査可能性の前提にする。
6. **記憶は「保存」でなく「評価された更新と再利用」。** write/manage/read の二重審査を挟み、統合（merge）は preservation が低ければスコアが高くても却下側へ倒す。dreaming は原典を上書きしない。
7. **単一指標を最適化させない。** metric monoculture は reward hacking を招く。多軸スコア＋複数レンズの敵対的多票で false accept を抑え、judge 自体を meta-evaluator で監査する。

## 段階導入ロードマップ

一度に全層を敷かない。決定論と tool-less 判定から入り、Maker–Checker と記憶審査を足し、最後に meta-eval と control plane 化へ進む。

- **短期**: 決定論チェック（test/lint/型/`git status`）＋ prompt Stop hook / `/goal`。記憶はストア（vector DB／ファイル）に provenance／freshness／scope／time のメタデータを付与し、write-path evaluator を1つ挟むだけでも大きく改善する。CC 面は `.claude/settings.json` の hooks と `/goal` 条件文。
- **中期**: Maker–Checker（agent Stop hook／reviewer subagent）＋ write-path evaluator ＋メタデータ審査。記憶を semantic／episodic／procedural に分離、event graph を部分導入。CC 面は dynamic workflow 多票、Agent SDK のカスケード評価＋三重 cap。
- **長期**: meta-evaluator ＋ consolidation／dreaming ＋ control plane 化（evaluate-write / retrieve / consolidate / forget / outcome の API に境界を保って切り出し、`trace_id` で observability／audit trail に接続）。OTel span で turn/tool/hook/token/cost を記録。

短期段の具体形（hooks 設定断片・`/goal` 条件文テンプレ・自前ループの実行可能スケルトン）は [./examples/](./examples/) に雛形として置く。

## Claude Code 仕様の注意書き（要再確認の項目のみ）

各セクションは調査時点（2026-07）のスナップショットで、公式 docs に照合済みの主張には `(確認済み・0X章)` を付している。ここでは検証で **uncertain / refuted だった項目だけ**を挙げる。確認済みの主張（`/goal` が tool-less・既定 Haiku・約4000字上限、Agent SDK の max_turns／max_budget_usd、`/loop` の cron 変換・7日失効、subagents／agent teams／dynamic workflows の16並列・総計1000 等）は各章の記述どおりで、ここでは再掲しない。

- **「Stop hook は連続8回ブロックで上書き」は未確認。** 02/03/06章が言及するが、公式 hooks docs に該当記述（連続ブロック上限・8回・自動上書き）が見当たらない（2026-07-04 に現行 docs を再取得し、記述なしを再確認）。**この数値には依存しない設計**（turn/budget/no-progress cap を別レイヤーに必ず置く）を採ること。
- **agent hook の「最大50 tool-use turns」という具体上限は未確認。** hook の `type` に `agent` があり、subagent を起動して実コマンド検証できること自体は確認済みだが、ターン数の上限値は公式 docs に明記が見当たらない（2026-07-04 再確認でも記述なし）。実装時に最新 docs で確認する。
- **hook の `type` は正しくは5種**: `command` / `prompt` / `agent` / `http` / `mcp_tool`（`mcp` ではなく `mcp_tool`）。各章が中心的に扱うのは前3種。
- **「async command hook は additionalContext を次ターンに返せるがブロック権を失う」は分析上の整理。** docs が明記するのは「`async: true` の hook はバックグラウンドで非ブロック実行される」までで（2026-07-04 再確認）、「additionalContext を次ターンに返す」という機構の記述はない。一方、非同期 hook の結果を Claude に届ける**文書化された機構は `asyncRewake`**（バックグラウンド実行し exit code 2 で Claude を起こし、stderr（無ければ stdout）を system reminder として提示・確認済み）。**「同期＝ブロック可／非同期＝記録専用」という配置原則は保持**しつつ、非同期からの通知が要る場合は `asyncRewake` を使う。

いずれも Claude Code の evolving な機能（`/goal`・`/loop`・agent teams・dynamic workflows・hooks schema）に関わるため、**実装着手時は最新の公式 docs で仕様を再確認する**こと。

## 統合 Open Questions

各セクションの未決事項を重複排除して束ねた。優先度の高い順。

1. **HITL の Claude Code ネイティブ実装。** permissions／auto mode の承認点が該当と推定（高確度）だが、記憶の promote／delete に対する明示的な HITL 承認フローの公式機構は資料上未確認。
2. **記憶書き込みの捕捉点。** memory 配下への書き込みを捕捉して write-path evaluator を挟む公式 hook イベント点があるか、compaction 時の ingest 粒度・タイミングの公式仕様が未確認（現状は設計案）。
3. **閾値・重み・cap の初期値。** promote/forget threshold・read の重み（relevance/freshness/authority/policy_fit）・gold set サイズ・max_budget_usd／no-progress cap は、運用ログ（false promotion rate／stale reuse rate／TCO 等）が無いと確定できず暫定。Outcome・Trace Evaluator でこれらを回収してから固める。
4. **verdict スキーマの単一 vs 経路別。** 作業経路と記憶3経路で単一統一の列挙にするか経路別スキーマにするか。06章は単一 `Verdict` 契約を採るが、実装コストとの得失は未評価。
5. **meta-eval の頻度と統合規則。** meta-evaluator をどのループ頻度で回すか、human agreement／bias／ECE の発火閾値、複数レンズ多票の統合規則（全 pass 採用／重み付き投票／閾値）の最適はタスク依存で未検証。
6. **meta-evaluation の再帰の停止点。** judge を点検する judge をどこまで重ねるか、gold set の人手保守をどう持続させるか。
7. **self-enhancement 回避と単一ベンダー制約の妥協点。** バイアス緩和には別モデル／別プロバイダ判定が有効だが、単一プロバイダ運用しか取れない現実制約とのバランスが未確定。
8. **経路 × 層の最適対応。** micro/meso/macro/meta と write/manage/read のどの経路をどの頻度・ループ位置で回すのが最適か、同期＝ブロック／非同期＝記録の境界を自前ハーネスでどこまで機構的に強制するかは実測未検証。
9. **hook schema の最終確認。** → 2026-07-04 に現行公式 docs で再確認済み。連続8回ブロック・agent hook のターン上限はいずれも**記述なし**（未確認のまま。数値に依存しない設計を維持する）。async hook は非ブロック実行を確認、非同期からの通知機構は `asyncRewake` が文書化済み。残るのは「記述なし＝実機挙動なし、とは限らない」ため、依存したくなった時点での実機確認のみ。
