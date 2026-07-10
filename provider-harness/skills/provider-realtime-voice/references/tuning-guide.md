<!-- last_verified: 2026-07-11 / stale_days: 45 -->

# チューニングガイド — VAD・reasoning effort の利用シーン別最適値

OpenAI Realtime API（gpt-realtime-2.1 世代）/ Gemini Live API のセッションパラメータを、利用シーンに
合わせて決めるためのガイド。モデルID・価格・セッション制約は `model-catalog.md` を正とし、本ガイドは
「ノブの回し方」だけを扱う。ポート上の指定方法は末尾「ポートへの写像」参照。

## 確信度ラベル（本ガイドの読み方）

推奨値は出典の強さでラベル分けする。ラベルなしの断定は書かない。

- **【公式】** 一次ドキュメント（platform.openai.com / developers.openai.com / ai.google.dev）に明記
- **【準公式】** Azure ミラー・Twilio / LiveKit / Pipecat 等、実装フレームワークの公式ドキュメント
- **【実測】** コミュニティの実測・経験則（複数ソースで一致）。採用前に自プロジェクトで計測すること
- 数値が確認できないものは「未確認」と明示し、推測で埋めない

## OpenAI: turn_detection の全体像

- **API の既定モードは `server_vad`**（「For sessions and models that support VAD, the default value
  is server_vad」）【公式】。LiveKit 等のフレームワークが semantic_vad を既定にしている場合があるが、
  それはフレームワーク側の既定であって生 API の既定ではない【準公式】
- `semantic_vad` は発話内容（言葉）から「話し終えた確率」を semantic classifier でスコアリングし、
  確率が低い（語尾が「えーと…」等）ときだけ長く待つ方式【公式】。server_vad より**ユーザーを
  割り込みにくい**代わりに、**レイテンシが増えうる**（確率が低いと最大待機まで待つため）【公式】
- 選択の目安: 相槌・言い淀みでの誤区切りが問題になる対話 → `semantic_vad`。単純な無音検出で十分・
  最速応答・プロバイダ互換性（Gemini と共通の型）→ `server_vad`（`session-lifecycle.md`「VAD 3方式の
  選び方」も参照）

### semantic_vad: `eagerness`（4値）

「モデルがどれだけ積極的にユーザーへ割り込むか＝最大待機タイムアウトの調整」【公式】。

| eagerness | 意味【公式】 | 最大待機の目安 | 使いどころ |
|:---|:---|:---|:---|
| `low` | ユーザーにゆっくり話させる（大きめチャンク） | 8秒【実測】 | ディクテーション・長い読み上げ・途中で切られたくない場面 |
| `medium` | 中間 | 4秒【実測】 | 電話・コールセンターの初期値に推す声が強い【実測】 |
| `high` | できるだけ早くチャンク化する | 2秒【実測】 | 短コマンド・速い応答が欲しい対話・transcription を速く返したい場面 |
| `auto`（**既定**） | `medium` と等価【公式】 | 4秒【実測】 | まず auto で開始し、誤割り込み/遅さを見て動かす |

最大待機の具体値（8/4/2秒）は公式本文に数値明記がなく、API リファレンス派生＋コミュニティ実測の
一致値。設計値として使う場合は実測で確認すること。transcription モードでも eagerness はチャンク
分割に影響する【公式】。

### server_vad: パラメータと既定値

既定値はいずれも公式 API リファレンスの `Defaults to` 表記【公式】。

| パラメータ | 既定 | 意味と上げ下げの挙動【公式】 |
|:---|:---|:---|
| `threshold` | 0.5（0.0–1.0） | VAD の起動しきい値。**上げると大きな声でないと起動しない＝騒音環境向き**。下げると小声も拾うが誤起動が増える |
| `prefix_padding_ms` | 300 | 発話検出位置より前に含める音声量。短くしすぎると語頭が欠ける |
| `silence_duration_ms` | 500 | 発話終了と判定する無音の長さ。**短くするとターン検出が速い＝応答が速い**が、考える間で分断されやすい。長くすると分断は減るが応答が遅くなる |
| `idle_timeout_ms` | なし（未設定=無効） | 無音がこの時間続いたら自動で応答を生成する。値域 5000–30000ms。「電話で長い沈黙が想定外の状況」向け（例: 「もしもし？」と促す）。server_vad のみ対応 |

### create_response / interrupt_response（両モード共通）

- `create_response`: VAD 停止イベントで自動的に応答を生成するか【公式】
- `interrupt_response`: VAD 開始イベントで進行中の応答を自動キャンセル（barge-in）するか。`false` に
  すると応答は完了まで続く【公式】
- 両方 `false` にすると「モデルは自動応答しないが VAD イベントは発火し続ける」＝発話区間の検出だけ
  借りて応答タイミングをアプリが制御する構成が組める【公式】。ディクテーションの手動 commit や
  複数話者の交通整理に有用
- **既定値（true/false）は一次 schema に `Defaults to` 注記が見つからず未確認**。公式コード例は
  true 相当の挙動を前提にしている（`interrupt_response: false` を明示指定する例あり）。既定に依存せず
  明示指定を推奨

### noise_reduction（VAD の前段フィルタ）

- GA のパスは `session.audio.input.noise_reduction`（**旧 Beta の `input_audio_noise_reduction` から
  改称**。`drift-landmines.md` 参照）。`null` で無効化、既定は未設定（オフ）【公式】
- 「VAD とモデルに送る**前**に入力音声をフィルタし、VAD / ターン検出の精度を改善（false positive を
  低減）」【公式】— **VAD 誤発火対策の第一手はしきい値いじりではなくこれ**
- `type`: `near_field`（ヘッドセット等の近接マイク）/ `far_field`（ノートPC・会議室等の遠距離マイク）
  【公式】。電話ハンドセット＝near_field、スピーカーフォン・車載＝far_field が妥当な推定（電話経路の
  公式明言はなし）

## reasoning.effort — 既定値の罠と VAD との関係

- **「low が既定」という通説は一次情報と矛盾する**。公式移行ガイドは「Set reasoning effort to `low`
  **instead of the default**」と書いており、**low は既定ではない**【公式】。既定値そのものは一次情報で
  未公表。したがって**本番では必ず明示指定する**（既定に依存しない）
- effort を上げるほどレイテンシと出力トークンが増える【公式】。5段階（minimal〜xhigh）の用途別
  選定表は `model-catalog.md`「reasoning.effort の指定と選び方」を参照（ここでは重複させない）
- reasoning 中の無音は VAD では解決できない。プロンプトで preamble（「確認しますね」等のつなぎ発話）
  を制御する【公式】（`model-catalog.md` 参照）
- **effort × VAD の公式推奨コンボ表は存在しない**（独立したノブ）。下のシーン別マトリクスの組み合わせ
  は、各パラメータの単独推奨を統合した設計提案であり、公式のセット推奨ではない

## Gemini Live: automaticActivityDetection

音響ベースの VAD のみで、**OpenAI の semantic_vad に相当する意味的ターン検出は存在しない**【公式】
（意味的な終了判定が要るなら手動 VAD ＋クライアント側ロジックで代替）。

| フィールド | 既定 | 意味【公式】 |
|:---|:---|:---|
| `disabled` | false（自動 VAD 有効） | true にするとクライアントが `activityStart` / `activityEnd`（フィールドなしの空メッセージ）を送る手動モード |
| `startOfSpeechSensitivity` | `START_SENSITIVITY_HIGH` | HIGH=発話開始をより頻繁に検出（機敏だが背景音で誤検出↑）。LOW=誤トリガ↓だが小声・語頭の取りこぼし↑ |
| `endOfSpeechSensitivity` | `END_SENSITIVITY_HIGH` | HIGH=発話終了をより頻繁に確定（機敏だがポーズで途切れやすい）。LOW=間に寛容だがレイテンシ↑ |
| `prefixPaddingMs` | **数値既定の公式明記なし** | 小=start 検出が敏感（誤検出↑）、大=誤検出↓だが短発話を取りこぼす |
| `silenceDurationMs` | **数値既定の公式明記なし** | 大=発話間ギャップに寛容（分断↓）だがレイテンシ↑ |

- **公式の数値はひとつだけ**: 手動 VAD 時の end-of-speech 無音判定は **500ms 以上**を推奨【公式】。
  公式コード例の `prefix_padding_ms: 20` / `silence_duration_ms: 100` は構文サンプルであり推奨値では
  ない（推奨値として引用しないこと）
- 発話「開始」判定は `startOfSpeechSensitivity` ＋ `prefixPaddingMs`、「終了」判定は
  `endOfSpeechSensitivity` ＋ `silenceDurationMs` のペアで効く【公式】
- barge-in 制御は `realtimeInputConfig.activityHandling`: 既定 `START_OF_ACTIVITY_INTERRUPTS`
  （発話開始で応答を打ち切る）、`NO_INTERRUPTION` で割り込み無効化【公式】
- `thinkingLevel` は既定 `minimal`（レイテンシ最適）【公式】。Live 専用の用途別指針は公式になく、
  汎用 thinking ドキュメントの「単純な照会= minimal/low、多段の複雑タスク= high」からの外挿になる
  （`model-catalog.md` 参照）

## 利用シーン別推奨マトリクス

各行は「そのシーンで最初に試す構成」。**公式のセット推奨ではなく、上記の単独推奨を統合した設計提案**。
必ず実測（下記「チューニングの進め方」）とセットで使う。

| シーン | OpenAI: turn_detection | OpenAI: noise_reduction / effort | Gemini: automaticActivityDetection | 根拠 |
|:---|:---|:---|:---|:---|
| 電話・コールセンター / IVR（G.711、番号読み上げあり） | `semantic_vad` `eagerness: medium`（low は 8秒待ちで遅い報告あり）。server_vad なら threshold 0.6–0.7・silence 600–800ms | ハンドセット= `near_field`。effort= `low`（純 IVR 分岐なら `minimal`）。`idle_timeout_ms` で無言時の促しを実装 | start= LOW（回線ノイズ対策）・silenceDurationMs 大きめ | eagerness の意味・threshold↑=騒音向き【公式】、具体値【実測】。effort=low はサポート/注文照会の公式例【公式】 |
| ブラウザ/アプリのボイスアシスタント（近接マイク・速いテンポ） | `semantic_vad` `eagerness: high` または auto。server_vad なら既定値のまま | `near_field`。effort= `low`（応答の軽快さ最優先なら `minimal`） | 既定（HIGH/HIGH）のまま | high=最速チャンク化【公式】 |
| ディクテーション・長い自由発話（住所・注文内容） | `semantic_vad` `eagerness: low`。server_vad なら silence 1000–2000ms、または `create_response: false` で手動 commit | effort= `minimal`〜`low`（推論より正確な取り込みが目的）。Entity Capture パターン（1値ずつ・復唱確認）併用【公式】 | end= LOW ＋ silenceDurationMs 大きめ | low=ゆっくり話させる【公式】、silence 具体値【実測】 |
| 騒音環境（店舗・車内・far-field） | `server_vad` threshold 0.6–0.8。semantic_vad も語ベースで雑音起動には強め | **`far_field` を必ず入れる**。effort= `low` ＋「音声が不明瞭なら推論せず聞き返す」プロンプト【公式】 | start= LOW ＋ prefixPaddingMs 大きめ | threshold↑=騒音向き・noise_reduction の位置づけ【公式】、具体値【実測】 |
| スマートスピーカー的な短コマンド | `semantic_vad` `eagerness: high`。server_vad なら silence 200–300ms | 部屋置きマイクなら `far_field`。effort= `minimal`（公式の例そのもの） | 既定のまま＋ silenceDurationMs 小さめ | effort 表【公式】、silence 具体値【実測】 |

## barge-in 誤爆・VAD 誤発火の対策順序

効く順・副作用が小さい順に:

1. **noise_reduction を有効化**（OpenAI）— VAD 前段フィルタで false positive を減らすのが公式の
   第一手【公式】
2. **threshold↑ / silence_duration_ms↑**（OpenAI server_vad）、**startOfSpeechSensitivity= LOW /
   prefixPaddingMs↑**（Gemini）— 物音・言い淀みでの誤起動と途中割り込みを抑制【公式（機序）】
3. **semantic_vad へ切替**（OpenAI のみ）— 「I understand, but…」のような発話途中を終了と誤認
   しにくい【公式】
4. **AI 音声の回り込み（エコー）はサーバ側パラメータでは解決しない** — エコーキャンセルは
   クライアント側で行う（ブラウザは `echoCancellation: true`、EC 非搭載端末は push-to-talk に
   フォールバック）【準公式】。アプリ実装は `session-lifecycle.md`「barge-in の実装型」の
   再生キュークリア＋先行ミュートを併用
5. **barge-in 自体を切る**最終手段 — OpenAI `interrupt_response: false` / Gemini
   `activityHandling: NO_INTERRUPTION`【公式】。読み上げ完了が業務要件（規約読み上げ等）の場合のみ

## チューニングの進め方

1. **既定値＋シーン別マトリクスの初期値で開始**し、いきなり多ノブを動かさない
2. **3指標を計測**する: 誤割り込み率（ユーザー発話が途中で切られた率）/ 誤起動率（発話していないのに
   VAD が起動した率）/ 応答レイテンシ（発話終了→最初の音声出力）
3. **1ノブずつ動かす**。誤割り込み→ silence↑ か eagerness を low 側へ。誤起動→ noise_reduction →
   threshold↑ の順。応答が遅い→ silence↓ / eagerness を high 側へ / effort↓
4. eagerness のタイムアウト実測値（8/4/2秒）のような【実測】ラベルの数値は、自プロジェクトの
   トラフィックで再計測してから確定値として扱う

## ポートへの写像（本スキルの型でどう指定するか）

- `VadConfig`（`templates/port.ts`）: `semantic_vad` の `eagerness`、`server_vad` の `threshold` /
  `prefixPaddingMs` / `silenceDurationMs` は正規化済みフィールドで指定する
- `idle_timeout_ms` / `create_response` / `interrupt_response` / `noise_reduction`（OpenAI）、
  `activityHandling` / `turnCoverage` / sensitivity 2軸（Gemini）は正規化対象外 —
  `providerOptions.openai` / `providerOptions.gemini` の escape hatch で渡す（両プロバイダに同じ
  意味論で存在するようになったら昇格を検討。メタスキル `escape-hatch.md`「escape hatch からの昇格」）
- `reasoningEffort` は正規化済み。既定値が未公表のため、**未指定なら wire に載せない**実装を崩さない
  こと（`drift-landmines.md`「世代ゲートされた能力ノブ」）

## 確認ソース

OpenAI: `platform.openai.com/docs/guides/realtime-vad`（eagerness の意味・auto=medium・server_vad の
挙動）、`developers.openai.com/api/reference/resources/realtime`（既定値 `Defaults to` 表記・
noise_reduction・idle_timeout_ms）、`.../guides/realtime-models-prompting`（effort 運用・
「instead of the default」）。準公式: LiveKit / Pipecat / Twilio の各公式ドキュメント（フレームワーク
既定値・電話経路の実装例）。Gemini: `ai.google.dev/api/live`（enum 逐語・既定 HIGH）、
`.../docs/live-api/capabilities`（手動 VAD ≥500ms）、`.../docs/live-guide`。いずれも 2026-07-11 時点の
スナップショット。`stale_days` 超過後は再検証必須。
