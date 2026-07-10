---
name: provider-realtime-voice
description: リアルタイム音声会話（OpenAI Realtime API / Gemini Live API）の統合をアプリに実装・設計するときのポート定義・アダプタ雛形・conformance テスト・モデルカタログの供給元。TypeScript(Zod/vitest)。セッション+イベントストリーム型ポート、barge-in、VAD 3方式、reasoning effort（gpt-realtime-2.1 の reasoning.effort / Gemini の thinkingLevel）、音声コーデック分離を扱う。設計原則そのものは provider-harness メタスキルを参照する。単発のテキスト読み上げ（一方向TTS）は tts プラグインを使い、本スキルは双方向のリアルタイム音声「対話」統合が対象。「リアルタイム音声」「音声会話 統合」「Realtime API」「Gemini Live」「音声エージェント」「electron/ブラウザで音声対話」「アプリに音声通話機能を組み込む」「電話ボット」「コールセンターAI」「Twilio 音声連携」で発動。
---

# provider-realtime-voice — リアルタイム音声プロバイダ統合ドメインスキル

OpenAI Realtime API / Google Gemini Live API を対象に、アプリへ組み込むリアルタイム音声統合のポート・
アダプタ・conformance テスト・モデルカタログを供給する。

> `references/templates/` のアダプタ雛形は WebSocket サーバーサイド経路の実装であり、コピーしてすぐ動く。
> WebRTC 経路（ephemeral key + SDP、ブラウザ直結）は `RealtimeVoicePort` 自体で対応できる設計にしてあるが
> （`references/session-lifecycle.md`「確立: 2方式」参照）、雛形コードとしては提供していない。設計指針の
> みを参照し、WebRTC トランスポート実装は別途用意すること。

## いつ使うか / メタとの関係

新規にリアルタイム音声プロバイダ統合をアプリへ実装するときに使う。設計原則そのもの（durable/volatile分離・
escape hatch・Pin+Verify・harvest 等）は provider-harness メタスキルが定義しており、本スキルはそれを
リアルタイム音声ドメインに適用した領域特化の差分（型スケッチ・モデルカタログ・非対称性の実例）だけを
持つ。原則の説明はここでは繰り返さない。

スコープ外:
- 単発の音声認識（STT）統合 → 予約領域（provider-harness メタスキルのレジストリ参照）
- 設計原則の一般論（ポート設計・escape hatch 等） → provider-harness メタスキル

## 抽象化方針: イベント正規化は最小限、raw escape hatch 必須

provider-harness メタスキルの `abstraction-thickness.md`（references 配下）は、リアルタイム音声を
「抽象化より型を持つ」ドメインと位置づけている。理由: プロバイダのイベント体系差が大きく、全イベントを
統一スキーマへ写像しようとするのは幻想に近い。正規化するのは実用上アプリが必ず扱う面
（音声出力・ツール呼び出し・主要ライフサイクル）だけに絞り、それ以外は `raw` escape hatch でプロバイダ
固有イベントをそのまま流す。

さらに、メソッド呼び出し型（`onAudioResponse(handler)` のような setter 群）ではなく、`open(config)` が
返す単一の `events(): AsyncIterable<RealtimeEvent>` ストリーム購読型にしてある。個別ハンドラ登録は
「登録前に届いたイベントが握りつぶされる」レースを生む実例が確認されており（`references/port.md` 参照）、
単一ストリームへの統合はこれを型レベルで防ぐための意図的な設計判断である。

tools（ツール定義スキーマ）も意図的に非正規化する。OpenAI はフラット schema、Gemini は
`{ functionDeclarations: [...] }` と形が異なり、正規化コストが便益を上回るため `tools?: unknown[]` で
素通しする（`references/port.md`「tools を非正規化にした理由」参照）。

## ポート定義

型の全体は `references/templates/port.ts` を参照（コピーして使う）。骨子:

```typescript
interface RealtimeVoicePort {
  open(config: RealtimeSessionConfig): Promise<RealtimeVoiceSession>
  capabilities(): RealtimeCapabilities
  isConfigured?(): boolean
}

interface RealtimeVoiceSession {
  events(): AsyncIterable<RealtimeEvent>       // 単一イベントストリーム購読
  sendAudio(chunk: AudioChunk): void            // fire-and-forget
  sendToolResult(callId: string, result: unknown): void
  interrupt(opts?): void                        // クライアント起動キャンセル（capabilities.bargeIn.clientCancel 対応時）
  close(): Promise<void>
}
```

`RealtimeEvent` は `session.ready` / `audio.output`（常に正準 PCM16 16kHz） / `transcript` /
`tool.call`（`NormalizedToolCall`） / `speech.started` / `speech.stopped` / `response.started` /
`response.done` / `error`（`RealtimeVoiceError`） / `raw`（正規化前の生イベント）の union。

共有エラー型 `RealtimeVoiceError` は二層構造: provider-harness メタスキルの正準8種
（`kind: 'rate_limited' | 'quota_exhausted' | 'auth' | 'invalid_input' | 'content_blocked' | 'timeout' |
'transient' | 'unsupported'`）に加え、リアルタイム固有の拡張4種（`session_expired` /
`connection_dropped` / `commit_rejected` / `no_speech`）を持つ。barge-in による応答中断はエラーでなく
`speech.started` の正常系イベントとして表現する（`references/port.md`「二層エラーにした理由」参照）。

`RealtimeCapabilities` は `bargeIn` / `serverVad` / `directRelayFormats`（例: `g711_ulaw` の素通し可否）/
`parallelToolCalls` / `reasoningEffortLevels` / `sessionResumption` 等でプロバイダ非対称性を正直に公開する。
ダックタイピング（`if (provider.type === 'openai-realtime')` のような分岐）を撲滅するための型である。

`reasoningEffort`（`minimal`〜`xhigh` の5段階）は、OpenAI `reasoning.effort` と Gemini `thinkingLevel` が
「レイテンシと知能のトレードオフ」として両プロバイダに対称化したため、providerOptions 素通しから
正規化フィールドへ昇格させた面（メタスキル `escape-hatch.md`「escape hatch からの昇格」の実例）。
値の集合は非対称（xhigh は OpenAI のみ）なので、対応レベルは `capabilities().reasoningEffortLevels` で
公開し、非対応レベルは黙って丸めずに `unsupported` で拒否する。世代ゲートされたノブのため
明示指定時のみ wire に送出する（`references/drift-landmines.md` 参照）。

コーデック変換は `AudioCodecPort`（`toCanonical`/`fromCanonical`）として別ポートに分離してある。
正準フォーマットは PCM16 16kHz。WebRTC 経路ではブラウザが Opus/SDP でコーデックを抽象化するため
`passthroughCodec`（no-op）を差せ、WebSocket 生音声経路のみ実コーデックの注入が必要になる
（`references/port.md`「コーデック分離の理由」参照）。

モデルIDは `AI_MODELS` 定数（`port.ts`）に集中管理する。アダプタ内にモデルIDを直書きするのは反面教師
（`references/port.md` 参照）。値そのものは `references/model-catalog.md` を正とする。

## アダプタ実装

雛形は `references/templates/adapter-openai-realtime.ts` と `references/templates/adapter-gemini-live.ts`。
両方とも:

- **WebSocket 実装は型のみの注入インターフェース**（`RealtimeSocketFactory`）にしてあり、`ws` パッケージ
  に依存しない。実装（`ws` 等）はコピー先プロジェクトで注入する。契約テストはこのインターフェースを
  `EventEmitter` でモックして実 WS を張らずに検証する
- **プロバイダ固有イベントは `handleXxxEvent()` に閉じ込め**、正規化しきれないものは `raw` へ逃がす
- **VAD 設定は `VadConfig`（`semantic_vad` / `server_vad` / `local` の3方式）を受け取り、プロバイダの
  wire フォーマットへアダプタ内で変換する**（`references/session-lifecycle.md`「VAD 3方式の選び方」参照）
- **`reasoningEffort` は明示指定時のみ wire に載せる**: OpenAI は `session.reasoning.effort`、Gemini は
  `generationConfig.thinkingConfig.thinkingLevel` へ写像する。Gemini は xhigh 非対応のため接続前に
  `unsupported`（failoverable）で拒否する。5段階の使い分けは `references/model-catalog.md`
  「reasoning.effort の指定と選び方」参照
- **barge-in は二軸（`bargeIn.serverAuto` / `bargeIn.clientCancel`）で符号化する**: 両プロバイダとも
  サーバ VAD による自動割り込みは対応。クライアント起動の明示キャンセル `interrupt()` は OpenAI のみ
  （`response.cancel` + `input_audio_buffer.clear`、再生位置が分かる場合は `conversation.item.truncate` 併用を
  推奨）。Gemini は公式のキャンセル手段が未確認のため `unsupported` を投げる。アプリ側の再生キュークリアは
  どちらでも必須（`references/session-lifecycle.md`「barge-in の実装型」参照）
- **`capabilities()` は実際の非対称性を反映する**（例: Gemini の `directRelayFormats` は常に空配列。
  出力が24kHz固定でレート交渉できないため素通し不可）

## 鮮度ゲート（能動）

`references/model-catalog.md` の冒頭には `last_verified` と `stale_days: 45` が記載されている
（画像生成ドメインの60日より短い。Realtime 系は個別モデルの shutdown 通知リードタイムが短い実例がある
ため、より能動的な鮮度チェックが必要と判断した）。**モデルIDを使う前に、今日の日付との差が
`stale_days` を超えていないか確認すること。** 超えていた場合はそのまま使わず、Context7 / WebSearch /
fetch-db MCP（OpenAI 公式ドキュメントは Cloudflare Bot Management で WebFetch が403になりやすいため）で
再検証してからカタログ更新を提案する。

このゲートを飛ばして stale なモデルIDのまま実装すると、shutdown済みモデルを呼び出すコードが静かに
紛れ込む（`references/model-catalog.md`「直近の deprecation」の `gpt-realtime-mini-2025-10-06` 事例参照）。

## conformance テスト

`references/templates/conformance-test.ts` が共通コンフォーマンステストスイート。両アダプタに対して:

- `open()` が `session.ready` を最初に発火すること
- `audio.output` イベントが常に正準 PCM16 16kHz で届くこと
- `tool.call` イベントが `NormalizedToolCall` 形状で届くこと
- `sendAudio()` / `sendToolResult()` が fire-and-forget で wire メッセージを送出すること
- `close()` がソケットを閉じること
- `capabilities()` が `RealtimeCapabilities` の形状を満たすこと

を同一スイートで検証する。加えて各アダプタ固有のテスト（OpenAI: エラー分類マッピング・raw escape
hatch・`interrupt()` の wire メッセージ・VAD 設定の配線・`reasoningEffort` の配線。Gemini: 24kHz→16kHz
ダウンサンプルの正確性・tools 非正規化の配線・`thinkingLevel` への写像と xhigh の `unsupported` 拒否・
`sessionResumption`/`bargeIn` の非対称性・`interrupted` が正常系イベントとして届くこと）も含む。

**共通スイートの限界**: 実 WebSocket 接続を張る Pin+Verify テストは、本テンプレートには含めていない。
image-gen の REST API と異なり、実 WS ハンドシェイク+セッションライフサイクル全体を模擬する必要があり、
`ws` パッケージ非依存を保つ本テンプレートのスコープを超えるため意図的に外してある
（`conformance-test.ts` 冒頭コメント参照）。実装する場合は `pin-and-verify.md` のタイミングで別途追加
すること。

## セッションライフサイクル

接続確立（WebSocket直結 / ephemeral key+SDP の2方式）・再接続（指数バックオフの実績値とサーバ側アダプタの
再接続方針の欠落という教訓）・resumption（Gemini の handle方式）・barge-in の実装型・VAD 3方式の選び方は
`references/session-lifecycle.md` に詳述する。

## 最終ステップ: harvest の実行（省略しない）

実装が完了したら、必ず `/provider-harvest` を実行する。これは複利で型を太らせるための強制ステップで
あり、習慣任せにしない。通常実行でもスキルを自動編集することはなく提案 diff が出るだけなので、採否は
別タスクとして起票し人間のレビューを経る（provider-harness メタスキルの `harvest-protocol.md`
（references 配下）参照）。

## リファレンス一覧

| リファレンス | 参照タイミング |
|:---|:---|
| `references/port.md` | ポートの設計判断・非対称性の実例を確認したいとき |
| `references/model-catalog.md` | モデルIDを使う前・鮮度ゲートを通すとき |
| `references/session-lifecycle.md` | 接続確立・再接続・resumption・barge-in を実装するとき |
| `references/drift-landmines.md` | GA API の破壊的変更・実装間矛盾を確認したいとき |
| `references/templates/port.ts` | ポート型・共有エラー型・AI_MODELS・RealtimeEventQueue をコピーするとき |
| `references/templates/adapter-openai-realtime.ts` | OpenAI Realtime アダプタをコピーするとき |
| `references/templates/adapter-gemini-live.ts` | Gemini Live アダプタをコピーするとき |
| `references/templates/conformance-test.ts` | コンフォーマンステストスイートをコピーするとき |

最初に全リファレンスを読む必要はない。該当セクションに到達したときに該当ファイルだけを読む
（progressive disclosure）。
