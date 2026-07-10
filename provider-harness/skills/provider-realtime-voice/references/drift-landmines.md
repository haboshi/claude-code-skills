# ドリフト地雷集（GA API 実録）

リアルタイム音声は Beta→GA 移行や個別モデルの世代交代が速く、静かに壊れる箇所が多い。以下は
voice-agent の実装履歴・model-catalog.md の検証過程で見つかった実録。新しいアダプタを書くとき、
または既存アダプタを Pin+Verify で更新するときに確認すること。

## `parallel_tool_calls` を旧モデルに送るとセッション切断

`openai-realtime.ts` の `sendSessionUpdate()` には以下のコメントが残っている。

> 並列ツール呼び出しは明示指定時のみ送信する。session.update では既に session に紐づくモデルが決まって
> いるため、旧モデル（gpt-realtime 等）で暗黙 default true を送ると OpenAI が "Unsupported option" を
> 返し session 切断を招くため。

`templates/adapter-openai-realtime.ts` の `buildSessionUpdate()` はこれを踏襲し、
`config.parallelToolCalls !== undefined` の場合のみ `parallel_tool_calls` を送出する。新しいセッション
設定フィールドを追加する際は、「モデルによって対応状況が違うパラメータを暗黙 default で送らない」を
一般原則として踏襲すること。

## 世代ゲートされた能力ノブ（reasoning.effort / thinkingConfig）も暗黙送出しない

上記 `parallel_tool_calls` と同型の地雷が reasoning 系ノブにもある。

- OpenAI の `session.reasoning.effort` は reasoning 対応世代（gpt-realtime-2 以降）にのみ存在する。
  非 reasoning モデル（`gpt-realtime-1.5` / `gpt-realtime-mini` 等）を使うセッションに送った場合の
  挙動は未検証であり、"Unsupported option" 系の拒否を招く前提で扱う
- Gemini は**同一プロバイダ内でも世代で形状が違う**: `gemini-3.1-flash-live` 系は
  `thinkingConfig.thinkingLevel`（enum）、`gemini-2.5-flash-native-audio` 系は
  `thinkingConfig.thinkingBudget`（トークン数）。世代を跨いでモデルIDを差し替えると、同じ
  thinkingConfig が invalid になりうる

`templates/` の両アダプタは `config.reasoningEffort !== undefined` の場合のみ wire に載せる
（暗黙 default 禁止）。プロバイダ非対称（xhigh は OpenAI のみ）は `capabilities().reasoningEffortLevels`
で公開し、非対応レベルは黙って丸めずに `unsupported` で拒否する。一般原則はメタスキルの
`escape-hatch.md`「escape hatch からの昇格」を参照。

## build-time env inline でモデルID凍結 → 400

環境変数からモデルIDを読む構成（`process.env.OPENAI_REALTIME_MODEL`）で、ビルドツールが環境変数を
ビルド時に静的インライン化する設定になっていると、デプロイ後に環境変数を変更してもモデルIDが古いまま
凍結される。廃止済みモデルIDのままリクエストし 400 を返され続ける事故につながる。モデルIDは
実行時に解決されることを確認すること（`AI_MODELS` 定数経由でも、ビルド構成次第では同じ罠を踏みうる）。

## ephemeral key 応答形状の変化

OpenAI の ephemeral key 発行エンドポイント（WebRTC 経路用）は、Beta→GA 移行で応答形状が変わった
実績がある（`{value, expires_at}` を直接返す形に変化）。ネストされたラッパーオブジェクトを期待した
パース処理は GA 移行時に静かに壊れる。パース処理は移行時に必ず実レスポンスで確認すること。

## イベント名の rename（`modalities` → `output_modalities` 等）

GA 移行の実録として以下の破壊的変更があった。

- `modalities` → `output_modalities`
- `temperature` パラメータの削除
- `session.type` の必須化
- イベント名の変更（例: `response.output_audio.delta` は旧 Beta の別名から改称されている）

イベント名の prefix 変種を吸収する場合、`handleOpenAIEvent()`（`templates/adapter-openai-realtime.ts`）
の `switch (type)` に新旧両方の分岐を足すのではなく、正規化前に prefix を統一するタプル吸収パターン
（例: `type.replace(/^response\.audio\./, 'response.output_audio.')`）を検討すること。ただし本テンプレート
は GA API のみを対象にしており、Beta 互換コードは持たない（Beta は2026-05-12に削除済み。
`model-catalog.md` 参照）。

## モデルIDをクエリに付けるか本文に入れるかの実装間矛盾（要一次情報確認）

WebSocket 接続時、OpenAI は `wss://api.openai.com/v1/realtime?model=...` のようにクエリパラメータで
モデルIDを渡す形が実績として確認できている（`openai-realtime.ts`）。一方 WebRTC 経路（
`/v1/realtime/calls`）ではリクエストボディにモデルIDを含める形になる。同じ「モデルID指定」でも
トランスポートによって渡し方が異なる点は、新しいトランスポート対応を追加する際に見落としやすい。

## STT プロンプトへのキーワード注入がハルシネーションを誘発する実例

`openai-realtime.ts` の音声入力設定は `transcription.model: 'gpt-4o-transcribe'` に固定言語（`language:
'ja'`）を付与している。文字起こしモデルに業務固有キーワードのプロンプト（辞書的なヒント）を注入する
運用は、キーワード一覧が長い・汎用性が低いプロンプトになるほど、無音区間や雑音を「それらしい単語」に
誤変換するハルシネーションを誘発する実例が確認されている。文字起こし精度改善のためのプロンプト注入は、
小規模なキーワードセットに留め、効果測定（誤変換率の計測）とセットで導入すること。

## Gemini の並列ツール呼び出し制御は未確認（`parallelToolCalls: false` の根拠）

OpenAI は `parallel_tool_calls` フィールドで並列ツール呼び出しを明示制御できることが実装・ドキュメント
双方で確認できている（`buildSessionUpdate()` 参照）。Gemini Live 側にも `functionCallingConfig` 等を
通じた類似の制御が存在する可能性があるが、本カタログの検証時点（`model-catalog.md` の
`last_verified`）では一次情報での確認ができていない。`RealtimeCapabilities.parallelToolCalls` を
Gemini アダプタで `false` に倒しているのはこの未確認を理由にした保守的な判断であり、「Gemini が並列
ツール呼び出しに対応していないと確認された」という意味ではない。並列呼び出し制御の実装が必要になった
場合は、まず一次情報（Gemini Live API ドキュメント）でフィールドの有無を確認してから
`capabilities().parallelToolCalls` の値と `buildSetupMessage()` の配線を見直すこと。

## Gemini `GoAway` は raw escape hatch で素通しする

`adapter-gemini-live.ts` の `handleGeminiEvent()` は `GoAway`（切断予告、`timeLeft` フィールドを持つ）を
正規化した `RealtimeEvent` 型に含めていない。理由: `session_expired` は「すでに失効した」を意味する
エラー分類であり、`GoAway` は「まもなく失効する」という予告（正常系のライフサイクル通知）で意味が異なる。
無理に既存の型へ押し込めず `raw` として `timeLeft` 等の構造化情報を落とさずに素通しし、アプリ側で
`providerEvent` の形を見て resumption（`session-lifecycle.md` 参照）をトリガーする設計にしている。
