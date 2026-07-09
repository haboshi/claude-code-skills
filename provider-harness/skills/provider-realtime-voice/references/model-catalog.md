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
| `general-purpose`（本カタログの既定） | `gpt-realtime-2.1` | flagship | `reasoning.effort` パラメータあり |
| — | `gpt-realtime-2.1-mini` | 軽量版 | — |
| — | `gpt-realtime-2` | 画像入力対応 | — |
| — | `gpt-realtime-1.5` | 旧世代 | — |
| — | `gpt-realtime-mini` | 軽量版（旧） | — |
| — | `gpt-realtime-whisper` | 文字起こし専用 | `turn_detection: null` 必須 |
| — | `gpt-realtime-translate` | 翻訳専用 | 別エンドポイント `/v1/realtime/translations` |

`gpt-realtime`（バージョンサフィックスなし）は models 一覧に非掲載で**ステータス未確認**。存在を前提に
実装しないこと。

### トランスポート

WebRTC（`/v1/realtime/calls` + ephemeral key `/v1/realtime/client_secrets`）/ WebSocket
（`wss://api.openai.com/v1/realtime?model=...`）/ SIP の3方式。本スキルのテンプレートは WebSocket 経路
のみ実装する（`references/session-lifecycle.md` 参照）。

### 音声フォーマット

`audio/pcm`（レート指定可）・`audio/pcmu`（g711_ulaw）。`session.audio.input/output.format` で指定する。
レート指定が可能なため、本テンプレートは 16kHz PCM16 で直接ネゴシエートしコーデック変換を発生させない
（`references/port.md` 参照）。

### VAD

`server_vad`（既定）/ `semantic_vad`（`eagerness: low/medium/high/auto`）。barge-in は VAD 有効時に
自動発生し、`interrupt_response` / `create_response` で制御する。

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

### トランスポート

Stateful WebSocket のみ（WebRTC 経路なし）。

### 音声フォーマット

入力 PCM16 16kHz（正準フォーマットと一致、変換不要）/ 出力 PCM16 **24kHz固定**（レート交渉不可）。
本テンプレートが出力方向のみ実コーデック（`geminiDownsampleCodec`）を必要とする理由はこれ
（`references/port.md` 参照）。

### VAD

`automaticActivityDetection`（sensitivity 2軸 + `prefixPaddingMs` 推奨20ms + `silenceDurationMs` 推奨
500-800ms）/ 手動 `activityStart`・`activityEnd`。割り込みは `LiveServerContent.interrupted` フラグで
通知される。

### セッション制約

音声のみ15分 / 音声+映像2分、単一コネクション約10分の制約もある。**session resumption あり**
（handle 方式、終了後2時間有効、`GoAway{timeLeft}` メッセージで切断予告）。コンテキスト長: native audio
128k / その他 32k tokens。

### SDK

`@google/genai` 2.10.0 / `google-genai`（PyPI）2.11.0。

## 未確認事項（推測で埋めない）

以下は2026-07-10時点でドキュメント横断確認ができていない。実装前に必ず再確認すること。

- Gemini Live の課金体系
- `rate_limits.updated`（OpenAI）に相当する Gemini 側イベントのフィールド詳細
- OpenAI / Gemini 両者の WebSocket クローズコード仕様（`references/templates/adapter-gemini-live.ts` の
  `mapGeminiCloseEvent` は保守的な推測実装であり、正確な仕様確認前提で見直すこと）
- Gemini Live が `interrupted` フラグ通知時にサーバ側で進行中の response を自動キャンセルする保証
  （`references/templates/adapter-gemini-live.ts` の `capabilities().bargeIn` を保守的に `false` と
  している根拠。アプリ側での明示 `interrupt()` 呼び出しを前提とした設計にしてある）
- Gemini Live の transcript イベントの正確なフィールド名（`inputTranscription`/`outputTranscription`
  を想定して `references/templates/adapter-gemini-live.ts` に実装したが、命名・`final` 判定条件
  （`turnComplete` との同期保証）とも一次情報での検証が未了）

## 確認ソース

OpenAI: `platform.openai.com/docs/guides/realtime` 系（Cloudflare Bot Management 対象。fetch-db MCP /
Context7 経由推奨）。Gemini: `ai.google.dev/gemini-api/docs/live` 系。いずれも2026-07-10時点のスナップ
ショットであり、`stale_days` 超過後は再検証必須。
