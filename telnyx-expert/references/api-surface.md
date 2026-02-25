# Telnyx API Surface Map

Telnyx API v2 の全体マップ。500+エンドポイントを6カテゴリに分類。
Voice関連を重点的に記載。

## 1. Voice API (Primary)

### Call Control

通話を個別のRESTコマンドで制御するAPI。最も柔軟。

**通話管理:**
- `POST /v2/calls` — 発信
- `POST /v2/calls/{id}/actions/answer` — 応答
- `POST /v2/calls/{id}/actions/hangup` — 切断
- `POST /v2/calls/{id}/actions/reject` — 着信拒否
- `GET /v2/calls` — アクティブ通話一覧
- `GET /v2/calls/{id}` — 通話情報取得

**音声操作:**
- `POST /v2/calls/{id}/actions/playback_start` — 音声ファイル再生
- `POST /v2/calls/{id}/actions/playback_stop` — 再生停止
- `POST /v2/calls/{id}/actions/speak` — TTS再生
- `POST /v2/calls/{id}/actions/send_dtmf` — DTMF送信
- `POST /v2/calls/{id}/actions/transfer` — 転送

**DTMF/音声収集:**
- `POST /v2/calls/{id}/actions/gather` — DTMF収集
- `POST /v2/calls/{id}/actions/gather_using_audio` — 音声再生しながらDTMF収集
- `POST /v2/calls/{id}/actions/gather_using_speak` — TTS再生しながらDTMF収集

**録音:**
- `POST /v2/calls/{id}/actions/record_start` — 録音開始
- `POST /v2/calls/{id}/actions/record_stop` — 録音停止
- `POST /v2/calls/{id}/actions/record_pause` — 録音一時停止
- `POST /v2/calls/{id}/actions/record_resume` — 録音再開

**文字起こし:**
- `POST /v2/calls/{id}/actions/transcription_start` — リアルタイム文字起こし開始
- `POST /v2/calls/{id}/actions/transcription_stop` — 文字起こし停止

**通話操作:**
- `POST /v2/calls/{id}/actions/bridge` — 2つの通話をブリッジ
- `POST /v2/calls/{id}/actions/fork_start` — メディアフォーク開始
- `POST /v2/calls/{id}/actions/fork_stop` — メディアフォーク停止
- `POST /v2/calls/{id}/actions/streaming_start` — WebSocketストリーミング開始
- `POST /v2/calls/{id}/actions/streaming_stop` — ストリーミング停止
- `POST /v2/calls/{id}/actions/refer` — SIP REFER
- `POST /v2/calls/{id}/actions/enqueue` — キューに追加
- `POST /v2/calls/{id}/actions/leave_queue` — キューから離脱

**ノイズ抑制 (BETA):**
- `POST /v2/calls/{id}/actions/suppression_start` — ノイズ抑制開始
- `POST /v2/calls/{id}/actions/suppression_stop` — ノイズ抑制停止

**AI統合:**
- `POST /v2/calls/{id}/actions/ai_assistant_start` — AI Assistantを通話に接続
- `POST /v2/calls/{id}/actions/ai_assistant_stop` — AI Assistant切断
- `POST /v2/calls/{id}/actions/gather_using_ai` — AI駆動のDTMF/音声収集

### Call Control Applications

- `POST /v2/call_control_applications` — アプリケーション作成
- `GET /v2/call_control_applications` — 一覧
- `GET /v2/call_control_applications/{id}` — 取得
- `PATCH /v2/call_control_applications/{id}` — 更新
- `DELETE /v2/call_control_applications/{id}` — 削除

### Conference API

- `POST /v2/conferences` — 会議作成
- `GET /v2/conferences` — 会議一覧
- `GET /v2/conferences/{id}` — 会議取得
- `POST /v2/conferences/{id}/actions/join` — 参加
- `POST /v2/conferences/{id}/actions/leave` — 退出
- `POST /v2/conferences/{id}/actions/mute` — ミュート
- `POST /v2/conferences/{id}/actions/unmute` — ミュート解除
- `POST /v2/conferences/{id}/actions/hold` — 保留
- `POST /v2/conferences/{id}/actions/unhold` — 保留解除
- `POST /v2/conferences/{id}/actions/play` — 音声再生
- `POST /v2/conferences/{id}/actions/speak` — TTS再生
- `POST /v2/conferences/{id}/actions/record_start` — 録音開始
- `POST /v2/conferences/{id}/actions/record_stop` — 録音停止
- `POST /v2/conferences/{id}/actions/end` — 会議終了

### TeXML

TwiML互換のXMLベース通話制御。WebhookでXMLを返すだけで動作。

**主要Verb:**
- `<Dial>` — 発信/転送（`<Number>`, `<Sip>`, `<Conference>` ネスト可）
- `<Gather>` — DTMF/音声入力収集
- `<Say>` — TTS再生
- `<Play>` — 音声ファイル再生
- `<Record>` — 録音
- `<Hangup>` — 切断
- `<Pause>` — 一時停止
- `<Redirect>` — 別URLへリダイレクト
- `<Reject>` — 着信拒否
- `<Stream>` — WebSocketストリーミング
- `<AI>` — AI Assistant接続

### SIP Trunking

既存PBX/UCシステムとTelnyxを接続。

**設定要素:**
- SIP Connection — 認証・コーデック・暗号化設定
- Outbound Voice Profile — 発信ルーティング
- Phone Numbers — 着信ルーティング先の紐付け

### Voice Webhookイベント

通話ライフサイクル全体をカバーする50+イベント:
- `call.initiated` — 通話開始
- `call.answered` — 応答
- `call.bridged` — ブリッジ完了
- `call.hangup` — 切断
- `call.dtmf.received` — DTMF受信
- `call.gather.ended` — Gather完了
- `call.playback.started/ended` — 再生開始/完了
- `call.speak.started/ended` — TTS開始/完了
- `call.recording.saved` — 録音保存完了
- `call.transcription` — 文字起こし結果
- `call.machine.detection.ended` — 留守電検出結果
- `call.fork.started/stopped` — フォーク開始/停止
- `streaming.started/stopped` — ストリーミング開始/停止

## 2. AI / Inference API

### Chat Completions
- `POST /v2/ai/chat/completions` — LLM対話（OpenAI互換フォーマット）
- 対応モデル: Meta Llama, OpenAI GPT等
- Function Calling対応

### Embeddings
- `POST /v2/ai/embeddings` — テキスト/URL埋め込みベクトル生成
- `POST /v2/ai/embeddings/url` — URLコンテンツの埋め込み
- `GET /v2/ai/embeddings/{bucket_name}/status` — 埋め込みステータス
- `POST /v2/ai/similarity_search` — 類似検索

### Audio
- `POST /v2/ai/audio/transcriptions` — 音声→テキスト（STT）
- `POST /v2/ai/generate/audio` — テキスト→音声（TTS）

### Summarization
- `POST /v2/ai/summarize` — ファイル要約（PDF, HTML, CSV, 音声等）

### AI Assistants
- `POST /v2/ai/assistants` — Assistant作成
- `GET /v2/ai/assistants` — 一覧
- `PATCH /v2/ai/assistants/{id}` — 更新
- `DELETE /v2/ai/assistants/{id}` — 削除
- `POST /v2/ai/assistants/{id}/clone` — 複製
- Canary Deploy, Scheduled Events, Test機能あり
- Knowledge Base (ドキュメントアップロード) 対応

### Clustering
- `POST /v2/ai/clusters` — クラスタリング実行
- `GET /v2/ai/clusters/{id}` — 結果取得
- `GET /v2/ai/clusters/{id}/visualization` — 可視化

## 3. Messaging API

### SMS/MMS
- `POST /v2/messages` — メッセージ送信
- `GET /v2/messages/{id}` — メッセージ取得

**送信パラメータ:**
- `from`: 送信元番号（Messaging Profile ID or 番号）
- `to`: 送信先番号（E.164形式）
- `text`: テキスト本文
- `media_urls`: MMS添付画像URL配列
- `send_at`: 予約送信（ISO 8601）
- `messaging_profile_id`: プロファイルID

### Messaging Profile
- `POST /v2/messaging_profiles` — プロファイル作成
- `GET /v2/messaging_profiles` — 一覧
- Webhook URL, Failover URL設定

### 10DLC / Campaign Registry
- Brand管理: 作成/取得/更新/削除
- Campaign管理: 提出/取得/更新/無効化
- Usecase適格性確認
- External Vetting

### Messaging Webhookイベント
- `message.received` — 着信メッセージ
- `message.sent` — 送信完了
- `message.finalized` — 最終ステータス（delivered/failed）

## 4. Numbers & Identity

### Phone Numbers
- `GET /v2/available_phone_numbers` — 購入可能番号検索
- `POST /v2/number_orders` — 番号購入
- `GET /v2/phone_numbers` — 所有番号一覧
- `PATCH /v2/phone_numbers/{id}` — 番号設定更新
- `DELETE /v2/phone_numbers/{id}` — 番号リリース
- バッチ操作: 一括更新、一括削除

### Number Porting
- `POST /v2/porting_orders` — ポーティング注文
- `GET /v2/porting_orders` — 注文一覧
- LOA (Letter of Authorization) 管理

### Verification
- `POST /v2/verifications/sms` — SMS OTP送信
- `POST /v2/verifications/verify` — OTP検証

### Address / Emergency
- `POST /v2/addresses` — 住所登録
- 動的緊急アドレス管理 (E911)

## 5. Connectivity & Networking

- Wireless SIM管理（IoT向け）
- Private Network / WireGuard VPN
- Cross-Connect
- eSIM管理

## 6. Account & Billing

- Billing Group管理
- CDRレポート生成
- 残高確認
- 自動チャージ設定
- 監査ログ

## 認証

全APIリクエストに `Authorization: Bearer YOUR_API_KEY` ヘッダーが必要。
API Keyは Telnyx Portal > API Keys から取得。
OAuth 2.0によるアクセストークン発行も可能。
