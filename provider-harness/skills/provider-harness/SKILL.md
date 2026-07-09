---
name: provider-harness
description: "OpenAI/Gemini/STT(音声認識)/認証基盤など外部プロバイダ・外部SDKの統合を新規実装・設計するとき、またはマルチプロバイダ対応・プロバイダ差し替え・既存統合の保守判断のときに最初に読む設計原則の供給元。ユースケース中心のポート設計、Pin+Verify、アダプタ契約テスト、escape hatch の型を提供し、領域特化の雛形は provider-image-gen 等のドメインスキルへ委譲。既存リポジトリのコネクタ資産に1本追加するだけなら api-connector-builder、Anthropic API 実装は claude-api を使う"
---

# provider-harness — 外部プロバイダ統合メタスキル

外部プロバイダ（LLM・画像生成・音声・認証等）統合の設計原則を供給する。実装コードそのものは持たず、判断基準と参照先を提供する。

## いつ使うか / スコープ

新規のプロバイダ統合を実装し始める前に読む。既存統合の保守で判断に迷ったときも同様。

スコープ外（別スキルに委譲）:
- 既存リポジトリのコネクタ資産に1本追加するだけ → `api-connector-builder`
- Anthropic API 実装そのもの → `claude-api`
- 画像生成の実行そのもの（プロンプト実行・モデル呼び出し） → `image-creator` プラグイン

## コア原則

1. **durable / volatile 分離** — アーキテクチャの型は焼き込み、モデルID・料金・APIシグネチャは焼き込まない。判定は「12ヶ月後も正しいか」で問う。→ `references/durable-vs-volatile.md`
2. **ユースケース中心のポート設計** — 「プロバイダの能力」でなく「アプリの実際の用途」を抽象化する。狭いほど漏れにくく差し替えが効く。→ `references/port-design.md`
3. **偽の抽象化より escape hatch** — 写像できないプロバイダ固有機能は、存在しないふりをせず `providerOptions` で正直にパススルーする。→ `references/escape-hatch.md`
4. **プロンプトはアダプタ側** — プロンプトはモデル固有資産であり、ポートに置くと旧世代向け記述が新モデルを劣化させる。→ `references/port-design.md`
5. **Pin+Verify** — 依存は lockfile で固定し、更新時は契約テスト＋変更ログレビューで検証する。凍結は脆弱性・モデル引退で強制破壊される。→ `references/pin-and-verify.md`
6. **アダプタごとの契約テスト必須** — 「バージョンが上がっても動くか」に答えるのはテストであり文章ではない。→ `references/contract-testing.md`
7. **改善は示唆のみ** — スキルの自動書き換えはしない。harvest は提案 diff を出すだけで採否は人間が判断する。→ `references/harvest-protocol.md`

## 実装ワークフロー

**Step 1: ドメインスキル選択**
下記レジストリを確認する。該当ドメインスキルが実装済みならそちらを主として使い、本スキルは原則の参照元に留まる。予約領域（未実装）は本メタ原則のみで実装する。

**Step 2: ユースケースからポート定義**
アプリの実際の用途からポートを定義する。抽象化の厚さはドメインで一律にしない。→ `references/port-design.md`, `references/abstraction-thickness.md`

**Step 3: アダプタ実装**
Pin+Verify で依存を固定し、非対称機能は providerOptions でパススルーする。→ `references/pin-and-verify.md`, `references/escape-hatch.md`

**Step 4: 契約テスト**
全アダプタが同一の契約テストスイートを通ることを確認する。→ `references/contract-testing.md`

**Step 5: 知見還流（省略しない）**
実装完了後に `/provider-harvest` を実行する（提案 diff の提示のみでスキルは書き換えない。--dry-run はキュー消化なしのお試し実行オプション）。複利で型を太らせるための強制ステップであり、習慣任せにしない。→ `references/harvest-protocol.md`

## ドメインスキル・レジストリ

| ドメイン | スキル | ステータス |
|:---|:---|:---|
| 画像生成 | provider-image-gen | 実装済み |
| リアルタイム音声 | provider-realtime-voice | 予約（未実装） |
| 音声認識（STT） | provider-stt | 予約（未実装） |
| 認証基盤 | provider-auth | 予約（未実装） |
| テキストLLM | ドメインスキルなし（メタ原則のみで実装。コスト最適ルーティングが主目的なら cost-aware-llm-pipeline） | — |

予約領域は本メタ原則のみで実装し、完了後 harvest で型化候補として報告する（ドメインスキルへの昇格判断は人間が行う）。

## 既存資産との棲み分け

| スキル | 役割 | 使う場面 |
|:---|:---|:---|
| api-connector-builder | 既存リポジトリへのコネクタ資産追加 | 新規ポート設計が不要で1本追加するだけの時 |
| claude-api | Anthropic API 実装パターン | Claude / Anthropic SDK 実装そのもの |
| cost-aware-llm-pipeline | コスト最適化された LLM 呼び出しパイプライン | 複数モデルのコスト最適ルーティングが主目的の時 |
| image-creator（プラグイン） | 画像生成の実行そのもの | プロバイダ統合済みの生成コマンドを使うだけの時 |

## リファレンス一覧

| リファレンス | 参照タイミング |
|:---|:---|
| `references/port-design.md` | ポート定義時（Step 2） |
| `references/durable-vs-volatile.md` | スキル・ドキュメントに何を書くか迷った時 |
| `references/pin-and-verify.md` | 依存追加・バージョン更新時（Step 3） |
| `references/contract-testing.md` | アダプタ実装後のテスト設計時（Step 4） |
| `references/escape-hatch.md` | プロバイダ固有機能が統一モデルに写像できない時（Step 3） |
| `references/error-taxonomy.md` | エラー分類をプロバイダ固有から正準分類へマッピングする時（Step 3） |
| `references/abstraction-thickness.md` | ポートの抽象化の厚さを決める時（Step 2） |
| `references/harvest-protocol.md` | 実装完了後の知見還流時（Step 5） |

最初に全リファレンスを読む必要はない。該当ステップに到達したときに該当ファイルだけを読む（progressive disclosure）。
