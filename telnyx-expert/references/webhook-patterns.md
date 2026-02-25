# Telnyx Webhook Design Patterns

Voice APIを中心としたWebhook設計パターンとベストプラクティス。

## Webhook アーキテクチャ概要

```
[Telnyx Platform]
    │
    ├── Primary Webhook URL (HTTPS)
    │      ↓
    │   [Your Application]
    │      ├── 200 OK (即時返却)
    │      └── 非同期処理 → コマンド発行
    │
    └── Failover Webhook URL (HTTPS)
           ↓ (Primary失敗時)
        [Backup Application / Dead Letter Queue]
```

## Webhook設定

### アプリケーション別の設定

| アプリケーション | 設定場所 | 主なイベント |
|---|---|---|
| Call Control App | Portal > Voice > Applications | call.* イベント |
| TeXML App | Portal > Voice > TeXML Apps | texml.* イベント |
| Messaging Profile | Portal > Messaging > Profiles | message.* イベント |
| SIP Connection | Portal > SIP > Connections | SIP関連イベント |

### 必須設定項目

- **Webhook URL**: HTTPS必須。HTTP非推奨。
- **Failover URL**: Primary失敗時の代替URL。必ず設定すること。
- **HTTP Method**: GET or POST（POST推奨）
- **API Version**: v2（v1は非推奨）

## Voice Webhook イベントフロー

### 基本着信フロー

```
call.initiated
    │ (アプリ: answer コマンド)
    ↓
call.answered
    │ (アプリ: speak/play/gather 等)
    ↓
call.speak.started → call.speak.ended
    │ (アプリ: gather コマンド)
    ↓
call.gather.ended (with digits/speech)
    │ (アプリ: transfer/bridge/hangup 等)
    ↓
call.hangup
```

### 発信フロー

```
POST /v2/calls (dial コマンド)
    ↓
call.initiated
    ↓
call.answered (相手が応答)
    │ (アプリ: speak/gather 等)
    ↓
...（着信と同様のフロー）
    ↓
call.hangup
```

### IVR（自動応答）フロー

```
call.initiated
    ↓ answer
call.answered
    ↓ gather_using_speak("メニューを選択してください: 1.営業, 2.サポート")
call.gather.ended { digits: "1" }
    ↓ transfer("+81XXXXXXXXXX")  // 営業部門
call.bridged
    ↓
call.hangup
```

### Conference（会議通話）フロー

```
call.initiated (参加者A)
    ↓ answer → conference.join
conference.participant.joined
    │
call.initiated (参加者B)
    ↓ answer → conference.join
conference.participant.joined
    │
conference.ended (全員退出)
```

### 録音 + 文字起こしフロー

```
call.answered
    ↓ record_start + transcription_start
call.recording.saved { recording_urls: {...} }
call.transcription { transcription_data: "..." }
    ↓ record_stop + transcription_stop
call.hangup
```

## Webhook ペイロード構造

### 共通フィールド

```json
{
  "data": {
    "event_type": "call.answered",
    "id": "evt_xxxxx",
    "occurred_at": "2025-01-15T10:30:00.000Z",
    "payload": {
      "call_control_id": "v3:xxxxx",
      "call_leg_id": "xxxxx",
      "call_session_id": "xxxxx",
      "connection_id": "conn_xxxxx",
      "from": "+1XXXXXXXXXX",
      "to": "+81XXXXXXXXXX",
      "direction": "incoming",
      "state": "answered"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-app.com/webhook"
  }
}
```

### 重要フィールド

- `call_control_id`: コマンド発行に使うID（通話ごとにユニーク）
- `call_session_id`: 通話セッション全体のID
- `call_leg_id`: 通話レッグのID（転送・ブリッジ時に複数）
- `connection_id`: アプリケーション/接続のID

## 設計パターン

### Pattern 1: State Machine（推奨）

通話の状態をステートマシンで管理する。

```javascript
const CALL_STATES = {
  INITIATED: 'initiated',
  GREETING: 'greeting',
  GATHERING_INPUT: 'gathering_input',
  PROCESSING: 'processing',
  TRANSFERRING: 'transferring',
  COMPLETED: 'completed'
}

// Redis等で通話状態を管理
const callStates = new Map()

function handleWebhook(event) {
  const { call_control_id, event_type } = event
  const currentState = callStates.get(call_control_id) || CALL_STATES.INITIATED

  switch (event_type) {
    case 'call.initiated':
      callStates.set(call_control_id, CALL_STATES.INITIATED)
      return answerCall(call_control_id)

    case 'call.answered':
      callStates.set(call_control_id, CALL_STATES.GREETING)
      return speakGreeting(call_control_id)

    case 'call.speak.ended':
      if (currentState === CALL_STATES.GREETING) {
        callStates.set(call_control_id, CALL_STATES.GATHERING_INPUT)
        return gatherInput(call_control_id)
      }
      break

    case 'call.gather.ended':
      callStates.set(call_control_id, CALL_STATES.PROCESSING)
      return processInput(call_control_id, event.payload.digits)

    case 'call.hangup':
      callStates.delete(call_control_id)
      return cleanup(call_control_id)
  }
}
```

### Pattern 2: Command Queue

複数コマンドの順序を保証する。

```javascript
import { Queue, Worker } from 'bullmq'

const commandQueue = new Queue('telnyx-commands')

// Webhook受信時: キューにジョブを追加
app.post('/webhook', (req, res) => {
  res.sendStatus(200)
  commandQueue.add('process-event', req.body)
})

// Worker: 順序通りに処理
const worker = new Worker('telnyx-commands', async (job) => {
  const event = job.data
  const { call_control_id, event_type } = event.data

  switch (event_type) {
    case 'call.answered':
      await telnyx.calls.speak(call_control_id, {
        payload: 'Welcome to our service.',
        voice: 'female',
        language: 'en-US'
      })
      break
    // ...
  }
})
```

### Pattern 3: Webhook Router

イベントタイプごとにハンドラーを分離する。

```javascript
class WebhookRouter {
  constructor() {
    this.handlers = new Map()
  }

  on(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, [])
    }
    this.handlers.get(eventType).push(handler)
  }

  async dispatch(event) {
    const eventType = event.data.event_type
    const handlers = this.handlers.get(eventType) || []

    for (const handler of handlers) {
      await handler(event.data.payload)
    }
  }
}

const router = new WebhookRouter()
router.on('call.initiated', handleCallInitiated)
router.on('call.answered', handleCallAnswered)
router.on('call.gather.ended', handleGatherResult)
router.on('call.hangup', handleHangup)

app.post('/webhook', (req, res) => {
  res.sendStatus(200)
  router.dispatch(req.body).catch(console.error)
})
```

## セキュリティ

### Webhook署名検証

Telnyx は Ed25519 で全Webhookに署名する。必ず検証すること。

**必要なヘッダー:**
- `telnyx-signature-ed25519`: 署名値
- `telnyx-timestamp`: タイムスタンプ

**公開鍵取得:** Telnyx Portal > Account Settings > Public Key

### タイムスタンプ検証

古いWebhookの再送攻撃を防ぐため、タイムスタンプが5分以内であることを確認。

## モニタリング

### 監視すべきメトリクス

- Webhook配信成功率（目標: 99.9%以上）
- Webhook処理レイテンシ（目標: 200ms以内で200 OK返却）
- Failover URL切り替わり回数
- 通話成功率 / 失敗率
- CDR (Call Detail Record) の異常パターン

### デバッグツール

- **Telnyx Portal > Debugging Tools**: Webhook配信ログ
- **Call Events API**: `GET /v2/call_events` で通話イベント検索
- **CDR Reports**: 詳細な通話記録
