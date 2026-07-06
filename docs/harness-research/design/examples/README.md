# examples/ — 参照コード雛形

Evaluator ハーネス設計（本ディレクトリの親 `../` にある 00〜06章）の**短期〜中期ロードマップの具体形**を、コピーして動かせる最小雛形にしたもの。設計本文が「契約」で、ここはその契約に厳密に一致する実装の出発点。設計判断の根拠は各章を参照し、ここでは配置と使い方に集中する。

## ファイル一覧

| ファイル | 何か | ロードマップ段 |
|---|---|---|
| `claude-code/settings.hooks.example.json` | 系統A hooks 3層（PreToolUse command → Stop prompt → Stop agent）の設定雛形 | 短期（command + prompt Stop）〜中期（agent Stop = Maker–Checker）の橋渡し |
| `claude-code/hooks/secret-scan.sh` | PreToolUse の決定論ゲート最小例（秘密情報代入・破壊的コマンドを block） | 短期（決定論チェックを hooks で挟む） |
| `claude-code/goal-conditions.md` | `/goal` 条件文テンプレ集（テスト収束 / backlog 消化 / docs 整合の3型） | 短期（`/goal` 条件文） |
| `custom-harness/evaluator_harness.py` | カスケード評価 + 三重 cap の実行可能スケルトン（stdlib のみ） | 中期（Agent SDK カスケード評価 + 三重 cap） |
| `custom-harness/verdict.schema.json` | 統一 Verdict 契約の JSON Schema（draft 2020-12） | 短期〜中期（verdict の機械可読化 / Structured Outputs の下地） |

## 使い方（コピー先と権限）

### 系統A（Claude Code ネイティブ）

1. `claude-code/settings.hooks.example.json` の `hooks` ブロックを、プロジェクトの `.claude/settings.json` にマージする（既存 hooks があれば配列に追記）。
2. `claude-code/hooks/secret-scan.sh` を `.claude/evaluators/secret-scan.sh` に置き、実行権限を付ける:
   ```bash
   mkdir -p .claude/evaluators
   cp claude-code/hooks/secret-scan.sh .claude/evaluators/secret-scan.sh
   chmod +x .claude/evaluators/secret-scan.sh
   ```
   （settings 側の `command` は `.claude/evaluators/secret-scan.sh` を指している。配置先を変えるなら両方を合わせる。）
3. `/goal` は `claude-code/goal-conditions.md` のテンプレを、実タスクの end_state / proof / constraints に置き換えて使う。`/goal` は **trust dialog を受諾した workspace** でのみ動作する。

### 系統B（独自ハーネス）

```bash
cd custom-harness
python3 evaluator_harness.py   # デモ（fail -> 修正 -> pass のカスケード遷移）が動く。exit 0
```

外部依存ゼロ（stdlib のみ）で動く。OpenTelemetry が入っていれば span を出し、無ければ no-op tracer にフォールバックする。`llm_critic` / `independent_done` は実 API を呼ばない**スタブ**なので、実運用では各関数の docstring が示す差し替え点で別モデルの critic / blind judge に置き換える。`verdict.schema.json` は、LLM 側に verdict を構造化出力させる際のスキーマとして使える。

## 2つの契約（4値 status と 10値 decision）の対応

設計には**2つの語彙**が出てくる。混同しないための対応表:

- **03章の4値 `status`（pass / fail / revise / escalate）**: **作業ループの断面**。1ターンを「停止・採用 / 同一方針で再試行 / 方針転換 / 上位へ委譲」のどれにするかを表す実務的な4分類。
- **06章の10値 `decision`（promote / hold / reject / merge / supersede / retrieve / drop / forget / continue / stop）**: **統一 Verdict 契約**。write / manage / read / outcome の全経路を1つの型で扱うための語彙。`evaluator_harness.py` と `verdict.schema.json` はこちらを実装する。
- **hook 境界（`{"ok": bool, "reason": ...}`）への写像**: hook が Claude Code ランタイムへ返す契約は真偽値。`pass`（＝ `decision: stop` で採用）→ `ok:true`、それ以外（`fail` / `revise` / `escalate`、および継続系 decision）→ `ok:false`（`reason` がそのまま次ターンのガイダンスになる）。`escalate` は加えて人間へ通知する。

つまり `status` は運用の粗い4分類、`decision` は経路横断の細かい統一契約、hook はその境界で真偽へ畳む、という三層構造になっている。

## 注意（雛形が依存しないこと・実装時に確認すること）

- **未確認の数値に依存しない**。「Stop hook は連続8回ブロックで上書き」「agent hook は最大50 tool-use turns」は、いずれも 2026-07 時点の公式 hooks docs に記述が見当たらない**未確認**の整理（00章参照）。本雛形はこれらに一切依存せず、暴走・空回りは**自前の3 cap（turn / budget / no-progress）**で必ず止める（`evaluator_harness.py` の `CAP` と `run_loop`）。
- **hook の戻り値契約は evolving**。`{"ok": bool, "reason": ...}` や hook 設定スキーマは調査時点の docs に沿った形。**実装時は最新の公式 hooks docs で戻り値仕様を必ず確認**すること。
- **非同期 hook を安全ゲートに使わない**。「同期＝ブロック可 / 非同期＝記録専用」が配置原則。非同期からの通知が要るなら、文書化された `asyncRewake`（exit code 2 で wake・stderr/stdout を system reminder 提示）を使う（00章参照）。
- **秘密情報・絶対パスを雛形に書かない**。`secret-scan.sh` のサンプルはすべてプレースホルダ（`XXXX`）。実値・作業端末の絶対パスはコミット対象に残さない。
