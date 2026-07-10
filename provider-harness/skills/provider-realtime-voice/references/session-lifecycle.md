# セッションライフサイクル

## 確立: 2方式

- **WebSocket 直結**: サーバサイドから `wss://...` へ直接接続し、Authorization ヘッダに API キーを乗せる
  （`templates/adapter-openai-realtime.ts` / `adapter-gemini-live.ts` が実装する経路）。API キーがサーバ
  プロセス内に留まるため、テレフォニー基盤やバックエンド常駐プロセスに向く。
- **ephemeral key + SDP（WebRTC、OpenAI のみ）**: ブラウザ等クライアントに長期 API キーを渡さず、
  `/v1/realtime/client_secrets` で発行した短命トークンを使って `RTCPeerConnection` を確立する。
  クライアントサイド（ブラウザ/モバイル）に直接統合する場合はこちらを選ぶ。本スキルのテンプレートは
  WebSocket 経路のみを実装しており、WebRTC 経路を使う場合はコーデック層に `passthroughCodec` を注入する
  （`references/port.md`「コーデック分離の理由」参照）。

## 再接続: 指数バックオフの実績値

voice-agent の ICE 再接続実装は `1s → 2s → 4s`、最大3回のバックオフを採用している。この値自体は
volatile（環境依存）だが、「指数バックオフ + 上限回数」という型は durable な判断として踏襲してよい。

**欠落していた教訓**: voice-agent はクライアント側（ブラウザ/テレフォニー機器）の再接続方針は持っていた
が、**サーバ側 WebSocket アダプタ（`openai-realtime.ts` / `gemini-live.ts`）自体には再接続方針がなかった**
。`ws.on('close')` はハンドラをクリアするだけで、再接続を試みない。本ポートを実装する際は、
`RealtimeVoiceSession` を保持するアプリ側（またはアダプタのラッパー層）に、`connection_dropped` エラー
イベントを受けて `open()` を再実行する再接続ループを明示的に設計すること。ポート自体は再接続を自動で
行わない（`open()` は1セッション1接続の契約であり、再接続は呼び出し側の責務）。

## resumption

- **Gemini**: `handle` 方式。セッション終了後2時間、同じ `handle` を使って会話コンテキストを引き継いで
  再接続できる。`GoAway{timeLeft}` メッセージで切断予告が来るため、これを受けたら新しい接続を先に確立
  してから旧接続を閉じる（無停止切り替え）設計が可能。`GoAway` は本ポートでは `raw` イベントとして
  素通しする（`references/drift-landmines.md` 参照）。
- **OpenAI**: resumption 機能なし。60分のセッション上限内で完結する設計にするか、上限到達前
  （`capabilities().maxSessionDurationMs`）に新セッションを確立し会話履歴をアプリ側で引き継ぐ設計が必要。

## barge-in の実装型

1. ユーザ発話検出（`speech.started` イベント）を受けたら、**再生キューを即座にクリア**する（AI音声の
   再生を止める）。
2. 同時に **先行ミュート**（エコー防止）を行う。AI 音声がまだスピーカーから再生中の間にマイクへ回り込む
   のを防ぐため、`speech.started` から実際に無音になるまでの間、入力音声の送信を一時止めるか無視する。
3. `capabilities().bargeIn.clientCancel` が true なら `RealtimeVoiceSession.interrupt()` を呼び、進行中の
   応答をキャンセルする（OpenAI: `response.cancel` + `input_audio_buffer.clear`、再生済み位置が分かる場合は
   `interrupt({ itemId, audioEndMs })` で `conversation.item.truncate` も送りコンテキスト整合を保つ）。
   Gemini は clientCancel 非対応（`unsupported`）— サーバ自動 barge-in（`serverContent.interrupted`）に任せ、
   アプリ側は再生キューの即クリアだけを行う。

エコー減衰後の `input_audio_buffer.clear`（OpenAI）をタイミングよく送るには、AI音声の再生完了通知
（`response.done`）を待ってから実行する設計が安全（voice-agent の `responseDoneHandler` の実装意図を
踏襲）。

## VAD 3方式の選び方

| 方式 | 選ぶ場面 |
|:---|:---|
| `semantic_vad`（OpenAI のみ） | 発話の意味的な区切りまで待ちたい（相槌で誤って区切られたくない）場合。`eagerness` で早さと精度のトレードオフを調整する |
| `server_vad` | 単純な無音検出で十分な場合。プロバイダ間で最も互換性が高い（OpenAI/Gemini 両方が対応） |
| `local`（ローカル VAD、例: Silero） | クライアント側で発話区間を確定させてから送信量を絞りたい場合、または VAD ロジック自体をプロバイダ非依存にしたい場合。この方式では `speech.started`/`speech.stopped` イベントはプロバイダから届かないため、アプリ側が別途 `RealtimeVoiceSession` に通知する経路を設計する必要がある（本ポートはサーバ側 VAD イベントの受信のみを定義する。`templates/port.ts` の `VadConfigSchema` コメント参照） |

方式を選んだ後のパラメータ値の決定（`eagerness` / `threshold` / `silence_duration_ms` 等の既定値と
利用シーン別の初期値・barge-in 誤爆対策の順序）は `tuning-guide.md` を参照。
