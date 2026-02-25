# Telnyx Node.js SDK Quickstart

Node.js (TypeScript対応) での Telnyx 実装ガイド。

## セットアップ

### インストール

```bash
npm install telnyx
```

**要件:** Node.js 20 LTS 以上（non-EOL）

### 初期化

```typescript
import Telnyx from 'telnyx'

const telnyx = new Telnyx(process.env.TELNYX_API_KEY!)
```

### 環境変数

```bash
# .env
TELNYX_API_KEY=KEY_xxxxxxxxxxxxxxx
TELNYX_PUBLIC_KEY=xxxxxxxxxxxxx  # Webhook署名検証用
TELNYX_CONNECTION_ID=conn_xxxxxxx  # Call Control App ID
TELNYX_MESSAGING_PROFILE_ID=xxxxx  # Messaging Profile ID
TELNYX_FROM_NUMBER=+1XXXXXXXXXX   # 送信元番号
```

## Voice実装例

### 基本的な着信応答（Express）

```typescript
import express from 'express'
import Telnyx from 'telnyx'

const app = express()
const telnyx = new Telnyx(process.env.TELNYX_API_KEY!)

// Webhook署名検証用: raw bodyが必要
app.use('/webhooks', express.raw({ type: 'application/json' }))

app.post('/webhooks/voice', (req, res) => {
  // 即座に200 OKを返す（重要）
  res.sendStatus(200)

  const event = JSON.parse(req.body.toString())
  handleVoiceEvent(event).catch(console.error)
})

async function handleVoiceEvent(event: any) {
  const { event_type, payload } = event.data
  const callControlId = payload.call_control_id

  switch (event_type) {
    case 'call.initiated':
      await telnyx.calls.answer(callControlId)
      break

    case 'call.answered':
      await telnyx.calls.speak(callControlId, {
        payload: 'お電話ありがとうございます。ご用件をお選びください。営業は1、サポートは2を押してください。',
        voice: 'female',
        language: 'ja-JP'
      })
      break

    case 'call.speak.ended':
      await telnyx.calls.gather(callControlId, {
        maximum_digits: 1,
        timeout_millis: 10000,
        valid_digits: '12'
      })
      break

    case 'call.gather.ended':
      const digits = payload.digits
      if (digits === '1') {
        await telnyx.calls.transfer(callControlId, {
          to: '+81XXXXXXXXXX'  // 営業部門
        })
      } else if (digits === '2') {
        await telnyx.calls.transfer(callControlId, {
          to: '+81YYYYYYYYYY'  // サポート部門
        })
      }
      break

    case 'call.hangup':
      console.log('Call ended:', payload.call_session_id)
      break
  }
}

app.listen(3000, () => console.log('Server running on port 3000'))
```

### 発信

```typescript
async function makeOutboundCall(to: string) {
  const response = await telnyx.calls.create({
    connection_id: process.env.TELNYX_CONNECTION_ID!,
    to,
    from: process.env.TELNYX_FROM_NUMBER!,
    webhook_url: 'https://your-app.com/webhooks/voice',
    command_id: crypto.randomUUID()  // 冪等性キー
  })

  return response.data
}
```

### 録音付き通話

```typescript
async function startRecording(callControlId: string) {
  await telnyx.calls.recordStart(callControlId, {
    format: 'mp3',
    channels: 'dual',  // 両方の音声を別チャンネルで録音
    play_beep: true     // 録音通知ビープ
  })
}

// call.recording.saved Webhookで録音URLを取得
function handleRecordingSaved(payload: any) {
  const { recording_urls } = payload
  console.log('Recording URL:', recording_urls.mp3)
  // URLを保存し、必要に応じてダウンロード
}
```

### AI連携（Call Control + OpenAI）

```typescript
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function handleAIConversation(callControlId: string, userSpeech: string) {
  // 1. OpenAIで応答生成
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'あなたはカスタマーサポートエージェントです。簡潔に日本語で応答してください。' },
      { role: 'user', content: userSpeech }
    ],
    max_tokens: 200
  })

  const aiResponse = completion.choices[0]?.message?.content || 'すみません、もう一度お願いします。'

  // 2. Telnyx TTSで音声再生
  await telnyx.calls.speak(callControlId, {
    payload: aiResponse,
    voice: 'female',
    language: 'ja-JP'
  })
}

// Gather + Transcription で音声入力を取得
async function gatherSpeech(callControlId: string) {
  await telnyx.calls.gather(callControlId, {
    maximum_digits: 0,          // DTMFではなく音声
    timeout_millis: 30000,
    speech_timeout_millis: 3000 // 3秒の沈黙で入力終了
  })
}
```

### WebSocket ストリーミング

```typescript
import WebSocket from 'ws'

// WebSocketサーバー起動
const wss = new WebSocket.Server({ port: 8080 })

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    // リアルタイム音声データを受信
    const audioChunk = JSON.parse(data.toString())

    if (audioChunk.event === 'media') {
      // 音声データを外部STT（Whisper等）に転送
      processAudioChunk(audioChunk.media.payload)
    }
  })
})

// Call Controlでストリーミング開始
async function startStreaming(callControlId: string) {
  await telnyx.calls.streamingStart(callControlId, {
    stream_url: 'wss://your-app.com:8080',
    stream_track: 'both_tracks'
  })
}
```

## Messaging実装例

### SMS送信

```typescript
async function sendSMS(to: string, text: string) {
  const response = await telnyx.messages.create({
    from: process.env.TELNYX_FROM_NUMBER!,
    to,
    text,
    messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID
  })

  return response.data
}
```

### MMS送信（画像付き）

```typescript
async function sendMMS(to: string, text: string, imageUrl: string) {
  const response = await telnyx.messages.create({
    from: process.env.TELNYX_FROM_NUMBER!,
    to,
    text,
    media_urls: [imageUrl],
    messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID
  })

  return response.data
}
```

### 着信SMS処理

```typescript
app.post('/webhooks/messaging', (req, res) => {
  res.sendStatus(200)

  const event = JSON.parse(req.body.toString())
  const { event_type, payload } = event.data

  if (event_type === 'message.received') {
    const { from, text } = payload
    console.log(`SMS from ${from.phone_number}: ${text}`)
    // 自動応答等の処理
  }
})
```

## Webhook署名検証

```typescript
import express from 'express'
import Telnyx from 'telnyx'

const telnyx = new Telnyx(process.env.TELNYX_API_KEY!)

function verifyWebhook(req: express.Request): any {
  const signature = req.headers['telnyx-signature-ed25519'] as string
  const timestamp = req.headers['telnyx-timestamp'] as string

  // telnyx-node SDKの組み込み検証
  return telnyx.webhooks.constructEvent(
    req.body,       // raw body (Buffer)
    signature,
    timestamp,
    process.env.TELNYX_PUBLIC_KEY!
  )
}

// ミドルウェアとして使用
function webhookMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    req.body = verifyWebhook(req)
    next()
  } catch (err) {
    console.error('Webhook verification failed:', err)
    res.sendStatus(400)
  }
}
```

## エラーハンドリング

```typescript
import Telnyx from 'telnyx'

async function safeApiCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof Telnyx.errors.TelnyxError) {
      console.error('Telnyx API Error:', {
        status: error.statusCode,
        message: error.message,
        code: error.code,
        detail: error.detail
      })

      // レート制限
      if (error.statusCode === 429) {
        const retryAfter = error.headers?.['retry-after']
        console.warn(`Rate limited. Retry after ${retryAfter}s`)
      }
    } else {
      console.error('Unexpected error:', error)
    }
    return null
  }
}

// 使用例
const result = await safeApiCall(() =>
  telnyx.calls.create({
    connection_id: 'conn_xxx',
    to: '+81XXXXXXXXXX',
    from: '+1XXXXXXXXXX'
  })
)
```

## 電話番号管理

### 番号検索と購入

```typescript
// 利用可能番号の検索
const available = await telnyx.availablePhoneNumbers.list({
  filter: {
    country_code: 'US',
    phone_number: { starts_with: '+1212' },  // エリアコード指定
    features: ['voice', 'sms']
  }
})

// 番号購入
const order = await telnyx.numberOrders.create({
  phone_numbers: [
    { phone_number: '+12125551234' }
  ],
  connection_id: process.env.TELNYX_CONNECTION_ID
})
```

## ローカル開発のヒント

### ngrokでトンネル設定

```bash
# ngrokインストール済みの場合
ngrok http 3000

# 表示されたHTTPS URLをTelnyx PortalのWebhook URLに設定
# 例: https://abc123.ngrok-free.app/webhooks/voice
```

### デバッグ用ログ

```typescript
// Webhook受信ログ
app.use('/webhooks', (req, res, next) => {
  const event = JSON.parse(req.body.toString())
  console.log(`[${new Date().toISOString()}] ${event.data.event_type}`, {
    call_control_id: event.data.payload?.call_control_id,
    from: event.data.payload?.from,
    to: event.data.payload?.to
  })
  next()
})
```

## GitHub リポジトリ

- **SDK**: https://github.com/team-telnyx/telnyx-node
- **デモ**: https://github.com/team-telnyx/demo-node-telnyx
  - Express Messaging
  - Voicemail Detection
  - Outbound Call IVR
