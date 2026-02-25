# Telnyx Common Pitfalls & Troubleshooting

コミュニティ・サポート記事・実装経験から収集した頻出問題と解決策。

## 1. Webhook関連

### 問題: Webhookが届かない / 再送され続ける

**原因:** Telnyx Call Control エンジンは全Webhookに対して200 OKレスポンスを要求する。レスポンスがない場合、リトライし続ける。

**解決策:**
```javascript
// WRONG: 重い処理を同期で実行してからレスポンス
app.post('/webhook', async (req, res) => {
  await processCall(req.body)  // タイムアウトの原因
  res.sendStatus(200)
})

// CORRECT: 即座に200を返し、非同期で処理
app.post('/webhook', (req, res) => {
  res.sendStatus(200)  // 即時応答
  processCall(req.body).catch(console.error)  // 非同期処理
})
```

### 問題: 重複Webhookによる二重コマンド

**原因:** ネットワーク遅延等でWebhookが重複配信される場合がある。

**解決策:** `command_id` パラメータで冪等性を確保。同一command_idのコマンドは60秒以内に重複実行されない。

```javascript
import { randomUUID } from 'crypto'

await telnyx.calls.create({
  connection_id: 'conn_id',
  to: '+81XXXXXXXXXX',
  from: '+1XXXXXXXXXX',
  command_id: randomUUID()  // 冪等性キー
})
```

### 問題: Failover URLに切り替わってしまう

**原因:** Primary URLが非200レスポンスを返すか、名前解決に失敗。

**チェックリスト:**
- Primary URLがHTTPSであること
- DNS解決が正常であること
- SSL証明書が有効であること
- サーバーが5秒以内にレスポンスを返すこと
- HTTP 200-299 のステータスコードを返すこと

## 2. Call Control関連

### 問題: SIP Connection経由の着信でCall Controlコマンドが失敗

**原因:** 最も多い誤解。SIP Connectionに紐付いた番号に着信し、Webhookでcall_control_idを取得しても、**Voice API Application** が番号に関連付けられていなければCall Controlコマンドは使えない。

**解決策:**
1. Telnyx Portalで Call Control Application を作成
2. Webhook URLを設定
3. 電話番号をそのApplicationに紐付け
4. SIP ConnectionではなくApplicationベースで受信

### 問題: 通話中のコマンドがタイムアウト

**原因:** コマンド発行のレイテンシが高い、または前のコマンドの完了を待たずに次を発行。

**解決策:**
- Webhookイベントを待ってから次のコマンドを発行
- `call.speak.ended` を待ってから次の `speak` を呼ぶ
- 非同期キュー（Bull, BullMQ等）でコマンドを順序管理

### 問題: Gather（DTMF収集）が反応しない

**チェックリスト:**
- `valid_digits` パラメータが正しいか（デフォルトは "0123456789*#"）
- `inter_digit_timeout` が短すぎないか（推奨: 5000ms以上）
- `maximum_digits` が設定されているか
- `terminating_digit` がユーザーの入力と被っていないか

## 3. テレフォニー関連

### 問題: 発信時に "call rejected" エラー

**チェックリスト:**
- 発信元番号がTelnyxで所有しているか
- Outbound Voice Profileが設定されているか
- 発信先の国が許可されているか
- アカウント残高が十分か
- E.164形式で番号を指定しているか（`+` プレフィックス必須）

### 問題: 通話品質が低い

**チェックリスト:**
- コーデック設定（G.711推奨、opus対応）
- ネットワーク品質（ジッター、パケットロス）
- TelnyxのPrivate Network / WireGuard VPN活用
- 地理的に近いTelnyx PoPを選択

### 問題: 録音ファイルが空 / 取得できない

**原因:** 録音完了前にアクセスしようとしている、または`call.recording.saved` Webhookを待っていない。

**解決策:**
- `call.recording.saved` Webhookを必ず待つ
- Webhook payloadに含まれるURLから取得
- 録音URLは一定時間後に期限切れになるため、早めにダウンロード

## 4. SDK関連

### 問題: telnyx-node のバージョン互換性

**注意:** v1 APIは非推奨。必ずv2 SDKを使用。

```bash
# 最新版をインストール
npm install telnyx
```

```javascript
// v2 SDK の正しい初期化
import Telnyx from 'telnyx'

const telnyx = new Telnyx('YOUR_API_KEY')
```

### 問題: Webhook署名検証の失敗

**原因:** リクエストボディのパースタイミングが不正。

**解決策:**
```javascript
import express from 'express'

const app = express()

// Webhook検証にはrawBodyが必要
app.use('/webhook', express.raw({ type: 'application/json' }))

app.post('/webhook', (req, res) => {
  const signature = req.headers['telnyx-signature-ed25519']
  const timestamp = req.headers['telnyx-timestamp']

  try {
    const event = telnyx.webhooks.constructEvent(
      req.body,       // raw body (Buffer)
      signature,
      timestamp,
      process.env.TELNYX_PUBLIC_KEY
    )
    res.sendStatus(200)
    handleEvent(event)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    res.sendStatus(400)
  }
})
```

## 5. 番号・ポーティング関連

### 問題: 番号検索で結果が出ない

**チェックリスト:**
- 検索パラメータが正しいか（country_code, phone_number_type）
- 地域指定が広すぎないか
- 利用可能な番号タイプか（local, toll-free, mobile）

### 問題: ポーティングに時間がかかる

**注意事項:**
- 米国内ポーティング: 通常7-10営業日
- 国際ポーティング: 国によって大きく異なる（数週間〜数ヶ月）
- LOA（Letter of Authorization）の情報が正確であることが最重要
- 既存キャリアへの解約通知は時期に注意

## 6. Messaging関連

### 問題: SMSが届かない

**チェックリスト:**
- Messaging Profileが正しく設定されているか
- 送信元番号がMessaging Profileに紐付いているか
- 10DLC登録が完了しているか（米国向けA2P SMS）
- 送信先番号がE.164形式か
- 宛先の国への送信が有効か

### 問題: 10DLC Campaign が却下される

**よくある原因:**
- Usecase Descriptionが不十分
- Sample Messageがない
- Opt-in/Opt-outフローが記載されていない
- Brandの情報が不正確

## 7. パフォーマンス最適化

### レート制限

APIエンドポイントにはレート制限あり。429エラー時は:
- `Retry-After` ヘッダーを確認
- 指数バックオフでリトライ
- バッチAPIの活用（番号操作等）

### Webhookエンドポイントの設計

- ステートレスに設計する
- 重い処理はキューに入れて非同期実行
- データベースへの書き込みは最小限に
- ヘルスチェックエンドポイントを別に用意
