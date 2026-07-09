# RealtimeVoicePort の設計解説

## 単一イベントストリームにした理由（ハンドラ登録順のレース）

3実装（voice-agent の `ai-adapter.ts` / `openai-realtime.ts` / `gemini-live.ts`）を横断した結果、
`onAudioResponse` / `onToolCall` / `onInterrupt` のような個別 setter 群には共通の欠陥がある。

```
# voice-agent の実例（反面教師）
adapter.createSession(config)   // すでに WS が繋がりイベントが飛び始めうる
adapter.onAudioResponse(handler) // ← ここで登録するまでのイベントは静かに失われる
```

`createSession()` から `onAudioResponse()` 呼び出しまでの間に到着したイベントは、ハンドラ未登録のため
握りつぶされる。実際に `openai-realtime.ts` では `session.updated` 受信後に「音声応答ハンドラの登録完了を
待つため」`setTimeout(500ms)` で挨拶トリガーを遅延させる回避策が入っており、これは根本原因（登録順序
依存）を時間で誤魔化しているだけである。

本ポートは `open(config)` が返す `RealtimeVoiceSession.events(): AsyncIterable<RealtimeEvent>` に統合する
ことで、この種のレースを型レベルで起こらないようにする。`RealtimeEventQueue`（`templates/port.ts`）は
消費者がまだ `for await` を始めていなくてもイベントをバッファするため、「いつ購読を開始したか」に
依存しない。

## tools を非正規化にした理由

3実装すべてが、ツール定義スキーマ（tools）をプロバイダ形状のまま素通ししている。

- OpenAI: フラットな `[{ type: 'function', name, parameters }]`
- Gemini: `[{ functionDeclarations: [{ name, description, parameters }] }]`

両者は構造が異なるだけでなく、JSON Schema のサブセット対応範囲にも差がある（`additionalProperties` の
扱い等、`references/drift-landmines.md` 参照）。この差を吸収する統一スキーマを作るコストは、
「アプリ側がプロバイダごとに tools 定義を1つ持てば済む」という現実の便益を上回ると判断した。
`RealtimeSessionConfig.tools?: unknown[]` は意図的な非正規化であり、`escape-hatch.md` でいう
「存在しないふりをしない」の適用例である。ツール呼び出し結果（`NormalizedToolCall`）側は逆に正規化する
— こちらは `callId` / `name` / `arguments` の3フィールドで両プロバイダとも表現でき、正規化コストが低く
アプリ側の分岐を消せる便益が大きいため。

## コーデック分離の理由（WebRTC vs WebSocket）

`AudioCodecPort` を `RealtimeVoicePort` から独立させたのは、音声コーデック変換の要否がトランスポート
経路によって根本的に変わるため。

- **WebRTC 経路**（ブラウザ⇔プロバイダ直結、または SFU 経由）: ブラウザの `RTCPeerConnection` が
  SDP ネゴシエーションでコーデック（Opus 等）を抽象化する。アプリ側のコードはコーデック変換に
  一切関与しない。この経路では `passthroughCodec`（no-op）を注入すれば足りる。
- **WebSocket 生音声経路**（サーバサイドから直接接続。`templates/adapter-openai-realtime.ts` /
  `adapter-gemini-live.ts` が実装する経路）: アプリ（またはテレフォニー基盤）が生の PCM/G.711 バイト列を
  直接やり取りする。ここでは実コーデックの注入が必須になる。

同じ `RealtimeVoicePort` 実装を両方の経路で使い回せるよう、コーデックを注入可能な別ポートに切り出した。
`adapter-gemini-live.ts` の既定コーデックが `passthroughCodec` でなく実ダウンサンプル実装
（`geminiDownsampleCodec`）である理由は、Gemini Live の出力が 24kHz 固定でレート交渉ができないため
（`model-catalog.md` 参照）。OpenAI 側は GA API が `audio/pcm` のレートを明示指定できるため、本テンプレート
は最初から 16kHz でネゴシエートして変換自体を発生させない設計にしてある（`adapter-openai-realtime.ts`
冒頭コメント参照）。

## 二層エラーにした理由

provider-harness メタスキルの正準8種（`error-taxonomy.md`）は HTTP request/response 型のエラーを想定した
語彙であり、「セッションが接続されたまま時間経過で失効する」「WebSocket が突然切れる」「音声バッファの
コミットをサーバが拒否する」「VAD が発話を検出できない」といったリアルタイム固有の失敗モードを表現できない。
これらを無理に正準8種へ押し込めると（例: `session_expired` を `timeout` に丸めるなど）、アプリ側が
「再接続すべきか」「セッションを作り直すべきか」を区別できなくなる。

`RealtimeErrorKind` は正準8種をそのまま継承し、リアルタイム拡張4種（`session_expired` /
`connection_dropped` / `commit_rejected` / `no_speech`）を追加するだけに留めた。正準8種の語彙・意味
（`retryable` / `failoverable` の考え方）を変更していないため、既存のエラーハンドリングコードは
そのまま動く。この拡張が許容される理由・条件は provider-harness メタスキルの
`error-taxonomy.md`「ドメイン拡張条項」（references 配下）を参照。

拡張4種の recovery action は正準8種と性質が異なるため、`retryable` / `failoverable` の値だけでなく
「呼び出し側が具体的に何をすべきか」を明示しておく。

| 拡張種 | retryable | failoverable | recovery action |
|:---|:---|:---|:---|
| `session_expired` | 不可 | 可 | 同一プロバイダで新セッションを確立する。Gemini は resumption（`session-lifecycle.md` 参照）で会話コンテキストを引き継げるが、OpenAI は resumption 機能が無いため会話履歴をアプリ側で引き継いで作り直す |
| `connection_dropped` | 可（再接続後） | 可 | 指数バックオフで再接続ループを回す（`session-lifecycle.md`「再接続」参照）。ポート自体は自動再接続しないため、呼び出し側が `open()` を再実行する |
| `commit_rejected` | 不可 | 不可 | 空バッファのコミット等、呼び出し側の実装不備が原因である可能性が高い。同一入力でのリトライは無意味。バッファ管理ロジックを見直す |
| `no_speech` | 不可 | 不可 | VAD が発話を検出できなかっただけであり、プロバイダ側の異常ではない。ユーザに再度の発話を促すか、無音のまま次のターンへ進める（リトライ・フェイルオーバーいずれも意味がない） |

## barge-in はエラーでなく正常系イベント

ユーザ発話による AI 応答の割り込み（barge-in）は、プロバイダから見れば「進行中の応答が意図的に中断
された」という正常な制御フローであり、失敗ではない。OpenAI は `input_audio_buffer.speech_started` を
契機にアプリ側が `response.cancel` を送る形、Gemini は `serverContent.interrupted` フラグで通知する形と
経路は異なるが、いずれも `RealtimeEvent` の `speech.started` として表現し、`error` 型には含めていない。

## open() の失敗経路（H1: ready 前クローズで永久ハングしていた不具合）

`ready` Promise を `session.ready`（OpenAI: `session.updated` / Gemini: `setupComplete`）でしか
resolve しない実装だと、認証失敗・不正なモデルID指定等でサーバが接続直後に WebSocket を閉じた場合、
`open()` が永久にハングする（`await ready` が resolve も reject もされないため）。この不具合は
レビューで検出され、両アダプタとも以下の3経路すべてで `ready` を settle させるよう修正した。

1. `onError` 発火時 → `connection_dropped` で reject
2. `onClose`（非1000コード）発火時 → `mapOpenAICloseEvent` / `mapGeminiCloseEvent` の分類結果で reject
3. `openTimeoutMs`（`RealtimeSessionConfig`、既定 10000ms）超過時 → `timeout` で reject し、ソケットを
   明示的に閉じる

正準 `timeout` 種は本来 request/response の応答遅延を想定した分類だが、「セッション確立自体が完了
しない」という接続確立フェーズの遅延にも同じ意味論（retryable: 一時的な遅延の可能性があるため
リトライしてよい）が当てはまるため転用している。`resolveReady` / `rejectReady` の二重呼び出しを防ぐ
`settled` フラグは両アダプタで同型の実装にしてある（`templates/adapter-openai-realtime.ts` /
`adapter-gemini-live.ts` の `open()` 参照）。

## transcript が既定で発火しない（H3）

OpenAI・Gemini とも、サーバ側に明示指定しない限り transcript イベントは一切発火しない
（既定で off）。`RealtimeSessionConfig.transcription` を指定して初めて、OpenAI は
`audio.input.transcription`、Gemini は `inputAudioTranscription`/`outputAudioTranscription` を
setup メッセージへ含める。これを知らずに実装すると「音声は届くのに文字起こしイベントだけ来ない」状態で
ハマる（`templates/adapter-openai-realtime.ts` の `buildTranscriptionConfig()` /
`adapter-gemini-live.ts` の `buildSetupMessage()` 参照）。Gemini 側のフィールド名（`inputTranscription`/
`outputTranscription`）は一次情報での検証が済んでいないため `model-catalog.md`「未確認事項」に明記して
ある。

## providerOptions のマージ意味論（浅い・直下キー単位で置換）

`escape-hatch.md` の原則どおり `providerOptions` は非ポータブルなパススルー経路だが、そのマージは
**浅い（shallow）** ことに注意が必要である。`buildSessionUpdate()` / `buildSetupMessage()` は
`...openaiOptions` / `...geminiOptions` を `session` / `setup` オブジェクトの直下でスプレッドしている
ため、直下キー単位で丸ごと置換される。

```typescript
// NG: audio キーを丸ごと上書きしてしまう例
adapter.open({
  providerOptions: { openai: { audio: { input: { someExtra: true } } } },
})
// buildSessionUpdate() が構築した audio.input.format / audio.input.transcription /
// audio.input.turn_detection / audio.output ごと、この audio オブジェクトで丸ごと置換される。
// 「someExtra を追加したい」つもりが、正準フォーマット指定や transcription 設定が消える。
```

これは `provider-image-gen` の `quality` のようなフラットキーでは問題にならない（フラットキーの
上書きは意図どおり1つの値だけを置き換える）が、`audio` のようなネストされた構造キーでは特に踏みやすい
footgun である。部分的な追加をしたい場合は、呼び出し側が完全な `audio` オブジェクト（`format` /
`transcription` / `turn_detection` を含む）を再構築して `providerOptions` に渡す必要がある。ディープ
マージにしない理由は、ディープマージ自体が「どのキーがどちらの由来か」を曖昧にし、非ポータブル指定の
意図を追いにくくする別の問題を生むためで、ここでは「浅い・予測可能」を優先している。

## capabilities フラグでダックタイピングを禁止した理由

3実装の比較から、以下の非対称性が実装依存の分岐（`if (provider.type === 'openai-realtime')`）として
コード中に散在していた。`RealtimeCapabilities` はこれを事前確認可能な形で公開する。

| フラグ | OpenAI Realtime | Gemini Live | 実装実績の根拠 |
|:---|:---|:---|:---|
| `bargeIn` | true | false（本テンプレートでは保守的に false） | OpenAI は VAD 有効時にサーバ側が自動で応答をキャンセルする設計。Gemini は `interrupted` フラグの通知はあるがサーバ側自動キャンセルの保証をドキュメント上確認できていない |
| `serverVad` | true | true | 両者ともサーバ側 VAD を持つ（`automaticActivityDetection` / `turn_detection`） |
| `directRelayFormats` | `['g711_ulaw', 'g711_alaw']` | `[]` | OpenAI は g711 系を無変換で中継可能。Gemini は PCM16 固定レートのみで素通し不可 |
| `parallelToolCalls` | true | false（本テンプレートでは明示未確認のため false） | OpenAI は `parallel_tool_calls` を明示制御できる。Gemini 側の並列呼び出し制御は `drift-landmines.md` 参照 |
| `sessionResumption` | false | true | OpenAI に再開機能なし（ドキュメント横断確認済み）。Gemini は handle 方式で対応 |

## モデルIDの集中管理（AI_MODELS）

3実装のうち `openai-realtime.ts` はモデルIDを `config.model || process.env.OPENAI_REALTIME_MODEL ||
'gpt-realtime-2'` という形でコード中に直書きしていた（反面教師）。本テンプレートは `templates/port.ts`
の `AI_MODELS` 定数1箇所に集約し、両アダプタがそこから読む形にした。値そのものは volatile な情報のため
`model-catalog.md` を正とする（`durable-vs-volatile.md` 参照）。

## RealtimeEventQueue は単一コンシューマ

`RealtimeEventQueue`（`templates/port.ts`）は「1つの for-await ループが順番に消費する」ことだけを
想定した実装であり、複数箇所から同時に `events()` を購読する fan-out（1つのイベントを複数の購読者に
配ること）はサポートしない。`next()` の待機者は FIFO の1本のキューであり、複数コンシューマが同時に
`next()` を呼ぶと push されたイベントは待機順に1件ずつ排他的に配られる（ブロードキャストされない）。
アプリ内の複数箇所でイベントを使い回したい場合は、唯一の消費者として1本の for-await ループを回し、
そこから必要な数だけ再配信すること（例: `EventEmitter` へ再送する）。詳細は `templates/port.ts` の
`RealtimeEventQueue` docstring を参照。

## RealtimeSocket / RealtimeSocketFactory は port.ts に一本化

WebSocket 実装への型のみの注入インターフェース（`RealtimeSocket` / `RealtimeSocketFactory`）は、
以前は両アダプタファイルにそれぞれ定義しており、`connect()` のシグネチャ（`headers` を必須にするか
任意にするか）が乖離してテスト側の型が合わなくなる不具合を一度踏んだ。現在は `templates/port.ts` に
一本化し、両アダプタは `import type { RealtimeSocketFactory } from './port'` で参照する
（`export type {...} from './port'` で再エクスポートもしているため、アダプタファイル単体を import する
既存コードへの影響はない）。新しいトランスポート（WebRTC 用の型等）を追加する場合も、この一本化された
場所に追加すること。
