<!-- last_verified: 2026-07-10 / stale_days: 45 -->

# リアルタイム音声モデルカタログ

`stale_days: 45` — 画像生成ドメイン（`provider-image-gen/references/model-catalog.md` の 60日）より
短い。理由: リアルタイム音声は Beta→GA 移行や個別モデルの shutdown が短い周期で起きており
（本カタログの「直近の deprecation」参照）、13日後失効のような通知リードタイムの短い実例もあるため、
より能動的な鮮度チェックが必要と判断した。

`last_verified` から今日の日付までの差が `stale_days` を超えていたら、使用前に Context7 / WebSearch /
公式ドキュメント（openai.com 系は Cloudflare Bot Management で WebFetch が403になりやすいため fetch-db
MCP か Context7 を使う）で再検証すること。

## OpenAI Realtime API（GA。Preview 表記なし）

| 内部名候補 | モデルID | 用途 | 備考 |
|:---|:---|:---|:---|
| `general-purpose`（本カタログの既定） | `gpt-realtime-2.1` | flagship | reasoning 5段階＋画像入力対応（下記「gpt-realtime-2.1 / 2.1-mini の詳細」参照）。2026-07-06 リリース |
| — | `gpt-realtime-2.1-mini` | 軽量版 | 2.1 の蒸留版 reasoning モデル。reasoning・画像入力とも対応。2026-07-06 リリース |
| — | `gpt-realtime-2` | 前世代 flagship | reasoning・画像入力対応（2.1 は本モデルの改良版） |
| — | `gpt-realtime-1.5` | 旧世代 | — |
| — | `gpt-realtime-mini` | 軽量版（旧） | — |
| — | `gpt-realtime-whisper` | 文字起こし専用 | `turn_detection: null` 必須 |
| — | `gpt-realtime-translate` | 翻訳専用 | 別エンドポイント `/v1/realtime/translations` |

`gpt-realtime`（バージョンサフィックスなし）は models 一覧に非掲載で**ステータス未確認**。存在を前提に
実装しないこと。

### gpt-realtime-2.1 / 2.1-mini の詳細（2026-07-06 リリース、公式 changelog 確認済み）

gpt-realtime-2 からの改良点（公式 changelog）: 英数字認識・無音/ノイズ処理・割り込み挙動の改善。
2.1-mini は公式表現で「faster, lower-cost distilled reasoning model」。

#### reasoning.effort の指定と選び方

session 設定直下の `reasoning: { effort: '...' }`（`session.update` / `client_secrets` 共通）。
5段階 `minimal / low / medium / high / xhigh`。effort を上げるほどレイテンシと出力トークンが増える。
公式プロンプティングガイドは「本番音声エージェントは `low` を明示指定して開始し、タスク複雑度・
レイテンシ許容度・失敗コストに応じて上げ下げ」を推奨。**既定値は一次情報で未公表。ただし「low は
既定ではない」ことは移行ガイド原文「Set reasoning effort to `low` instead of the default」で確定**
（2026-07-11 検証。「未確認事項」参照）。本番は既定に依存せず必ず明示指定する。本スキルのポートでは
`RealtimeSessionConfig.reasoningEffort` として正規化してある（`templates/port.ts` 参照）。

用途別の選定目安（公式プロンプティングガイドの表を要約）:

| effort | 使いどころ |
|:---|:---|
| minimal | 最低レイテンシ最優先の単純タスク（スマートホーム操作・タイマー） |
| low | 応答性＋基本推論（カスタマーサポート・注文照会）。本番の推奨初期値 |
| medium | 多段タスクの推論（テクニカルサポート・診断・複雑なルーティング） |
| high | 深い推論が成功率を実質的に上げる場面（制約付き高精度ワークフロー・エスカレーション判断） |
| xhigh | レイテンシ・コスト増に見合う最大推論（複雑な計画・高リスクのツールオーケストレーション） |

reasoning 中の無音対策として、プロンプトで preamble（「確認しますね」等の短いつなぎ発話）を
制御する運用が公式ガイドに詳述されている（gpt-realtime-2 系は既定で preamble を生成する）。

#### 画像入力

2.1 / 2.1-mini / 2 とも対応（入力モダリティ: text, audio, image）。セッション設定ではなく
`conversation.item.create` で会話アイテムとして送る:

```json
{ "type": "conversation.item.create",
  "item": { "type": "message", "role": "user",
    "content": [{ "type": "input_image", "image_url": "data:image/{format};base64,..." }] } }
```

本スキルのポートは画像送信 API を持たない（YAGNI — 実利用プロジェクトが出たら harvest で型化を
検討する）。必要な場合はコピー先で `RealtimeVoiceSession` に送信メソッドを追加すること。

#### 価格（1M tokens、2026-07-10 時点の公式モデルページ）

| モデル | text in / cached / out | audio in / cached / out | image in |
|:---|:---|:---|:---|
| gpt-realtime-2.1 | $4 / $0.40 / $24 | $32 / $0.40 / $64 | $5 |
| gpt-realtime-2.1-mini | $0.60 / $0.06 / $2.40 | $10 / $0.30 / $20 | $0.80 |

いずれも 128k context / 32k max output tokens。

### トランスポート

WebRTC（`/v1/realtime/calls` + ephemeral key `/v1/realtime/client_secrets`）/ WebSocket
（`wss://api.openai.com/v1/realtime?model=...`）/ SIP の3方式。本スキルのテンプレートは WebSocket 経路
のみ実装する（`references/session-lifecycle.md` 参照）。

### 音声フォーマット

`audio/pcm`（レート指定可）・`audio/pcmu`（g711_ulaw）。`session.audio.input/output.format` で指定する。
レート指定が可能なため、本テンプレートは 16kHz PCM16 で直接ネゴシエートしコーデック変換を発生させない
（`references/port.md` 参照）。

### VAD

`server_vad`（既定）/ `semantic_vad`（`eagerness: low/medium/high/auto`、既定 `auto` = medium 相当）。
barge-in は VAD 有効時に自動発生し、`interrupt_response` / `create_response` で制御する。パラメータの
既定値・利用シーン別の初期値は `references/tuning-guide.md` を参照。

### セッション制約

上限60分。**resumption 機能なし**（ドキュメント横断確認済み）。課金はトークン建て（ユーザー音声
100ms=1token、AI音声 50ms=1token）。

### 直近の deprecation

| 対象 | 状態 |
|:---|:---|
| Beta Realtime API（`realtime=v1` ヘッダ） | 2026-05-12 削除済み |
| `gpt-4o-realtime-preview` 系 | 2026-05-07 削除済み → `gpt-realtime-1.5` へ移行 |
| `gpt-realtime-mini-2025-10-06` | **2026-07-23 shutdown**（本カタログ検証時点で13日後） |

GA移行時の破壊的変更の実録は `references/drift-landmines.md` 参照。

### SDK

`openai` 6.46.0 / `@openai/agents` 0.13.0 / `@openai/agents-realtime` 0.13.0。公式サンプルの一部が
SDK でなく生 `ws` を使用している点に注意（SDK のラップが薄い/未成熟な領域がある可能性）。

## Gemini Live（3モデルとも明示的 Preview — OpenAI と成熟度表記が非対称）

| 内部名候補 | モデルID | 用途 |
|:---|:---|:---|
| `general-purpose`（本カタログの既定） | `gemini-3.1-flash-live-preview` | 汎用 |
| — | `gemini-2.5-flash-native-audio-preview-12-2025` | ネイティブ音声特化 |
| — | `gemini-3.5-live-translate-preview` | 翻訳特化 |

旧 `gemini-2.0-flash-live` 系は現行一覧に非掲載（voice-agent の `gemini-live.ts` が `models/
gemini-2.0-flash-live` を使用中で、旧世代滞留の実例になっている）。

### thinking（OpenAI の reasoning.effort に相当）

`gemini-3.1-flash-live-preview` は `thinkingConfig.thinkingLevel`（`minimal / low / medium / high` の
4段階、**既定 `minimal`** = 最低レイテンシ最適化。公式ドキュメント明記）を持つ。OpenAI の
`reasoning.effort` と同じ「レイテンシと知能のトレードオフ」ノブだが **xhigh がない**非対称がある。
本スキルのポートは `reasoningEffort` として正規化し、非対応レベルは `unsupported`
（failoverable: true）で拒否する（`templates/port.ts` 参照）。

`gemini-2.5-flash-native-audio` 系は thinkingLevel でなく **`thinkingBudget`（thinking トークン数
指定）** の別形状で、ポートの正規化対象外（`providerOptions.gemini` 経由で渡す）。
`includeThoughts: true` で thought summaries も取得できる。

生 setup メッセージ上の `thinkingConfig` の位置は SDK（`LiveConnectConfig.thinkingConfig`）からの
推定で `setup.generationConfig.thinkingConfig` に配線してある（「未確認事項」参照）。

### トランスポート

Stateful WebSocket のみ（WebRTC 経路なし）。

### 音声フォーマット

入力 PCM16 16kHz（正準フォーマットと一致、変換不要）/ 出力 PCM16 **24kHz固定**（レート交渉不可）。
本テンプレートが出力方向のみ実コーデック（`geminiDownsampleCodec`）を必要とする理由はこれ
（`references/port.md` 参照）。

### VAD

`automaticActivityDetection`（sensitivity 2軸: `startOfSpeechSensitivity` / `endOfSpeechSensitivity`、
どちらも既定 HIGH。`prefixPaddingMs` / `silenceDurationMs` に公式の数値既定・推奨値はない — 公式
コード例の 20ms / 100ms は構文サンプルであり推奨値ではない。旧記載「推奨20ms / 推奨500-800ms」は
2026-07-11 の一次再検証で裏取りできず撤回）/ 手動 `activityStart`・`activityEnd`（この場合のみ
end-of-speech 無音 ≥500ms が公式推奨値）。割り込みは `LiveServerContent.interrupted` フラグで通知され、
`realtimeInputConfig.activityHandling: NO_INTERRUPTION` で barge-in 自体を無効化できる。チューニングは
`references/tuning-guide.md` 参照。

### セッション制約

音声のみ15分 / 音声+映像2分、単一コネクション約10分の制約もある。**session resumption あり**
（handle 方式、終了後2時間有効、`GoAway{timeLeft}` メッセージで切断予告）。コンテキスト長: native audio
128k / その他 32k tokens。

### SDK

`@google/genai` 2.10.0 / `google-genai`（PyPI）2.11.0。

## 未確認事項（推測で埋めない）

以下は2026-07-10時点でドキュメント横断確認ができていない。実装前に必ず再確認すること。

- OpenAI `reasoning.effort` の**既定値の具体値**（2026-07-11 更新: 移行ガイド原文「Set reasoning
  effort to `low` instead of the default」により **low が既定でないこと自体は確定**した。二次報道の
  「low 既定」は誤り。既定値そのものは未公表のままなので、本番は明示指定が必須）
- Gemini Live の生 setup メッセージにおける `thinkingConfig` の位置。SDK レベル
  （`LiveConnectConfig.thinkingConfig.thinkingLevel`）は公式ドキュメントで確認済みだが、
  BidiGenerateContentSetup リファレンスの generationConfig フィールド一覧には thinkingConfig が
  未掲載（2026-07-10 時点）。本テンプレートは speechConfig と同型の generationConfig 配下と推定して
  配線しており、実疎通（Pin+Verify）時に必ず確認すること
- Gemini Live の課金体系
- `rate_limits.updated`（OpenAI）に相当する Gemini 側イベントのフィールド詳細
- OpenAI / Gemini 両者の WebSocket クローズコード仕様（`references/templates/adapter-gemini-live.ts` の
  `mapGeminiCloseEvent` は保守的な推測実装であり、正確な仕様確認前提で見直すこと）
- Gemini Live のクライアント起動応答キャンセル（clientCancel）の公式な実装方法。`interrupted` フラグ
  自体はサーバ側が自動的に進行中の response を打ち切ったことの通知として一次情報で確認できているため
  `references/templates/adapter-gemini-live.ts` の `capabilities().bargeIn.serverAuto` は `true` と
  している。一方、アプリ側から能動的に応答をキャンセルする公式 API は未確認のため `clientCancel` は
  `false` とし、`interrupt()` は `kind: 'unsupported'` の `RealtimeVoiceError` を投げる実装にしてある
- Gemini Live の transcript イベントの正確なフィールド名（`inputTranscription`/`outputTranscription`
  を想定して `references/templates/adapter-gemini-live.ts` に実装したが、命名・`final` 判定条件
  （`turnComplete` との同期保証）とも一次情報での検証が未了）

## 確認ソース

OpenAI: `platform.openai.com/docs/guides/realtime` 系（Cloudflare Bot Management 対象。fetch-db MCP /
Context7 経由推奨）。モデル詳細・価格は `platform.openai.com/docs/models/gpt-realtime-2.1`（2.1-mini も
同様）、リリース事実は `developers.openai.com/api/docs/changelog`（2026-07-06 エントリ）、reasoning
運用は `.../guides/realtime-models-prompting`。Gemini: `ai.google.dev/gemini-api/docs/live` 系
（thinking は `.../live-api/capabilities`、setup メッセージ仕様は `ai.google.dev/api/live`）。
いずれも2026-07-10時点のスナップショットであり、`stale_days` 超過後は再検証必須。
