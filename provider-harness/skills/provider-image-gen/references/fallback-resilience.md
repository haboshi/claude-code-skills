# フォールバック・耐障害性: subprocess fan-out から in-process ポートへの翻訳

## image-creator/generate.py の型（読み取った設計判断）

`image-creator/scripts/generate.py` は subprocess fan-out 型の耐障害性を持つ。`FALLBACK_CODES = {503, 504, 429, 408}` を判定基準に、Gemini モデル間フォールバックに加えて `generate_codex.py` / `generate_openai.py` / `generate_fal.py` という**別スクリプトを subprocess.run で呼び分ける**チェーンになっている（`fallback_chain = {"pro": ["codex", "openai", "nb2", "fal", "flash"], ...}`）。

## なぜ in-process では形が変わるか

subprocess fan-out はコマンドラインツールとしての `image-creator` には合理的だった。しかし `provider-image-gen` はアプリに組み込む TypeScript のライブラリ層であり、同じ理由がそのまま当てはまらない:

- **プロセス分離が不要**: subprocess 版は各プロバイダの依存（Python パッケージ）を独立させ、1つが壊れても他の呼び出しに影響しない利点があった。in-process の TS では、プロバイダごとの依存は npm パッケージとして共存でき、プロセスを分ける必要がない。
- **エラー分類を型で共有できる**: subprocess 版は各スクリプトの exit code / stdout 文字列を親プロセスが正規表現やコード比較で解釈していた（`_get_status_code()` 参照）。in-process なら `ImageGenError`（`templates/port.ts`）という共有の型でエラーを表現でき、文字列パースに頼らない。
- **テスト可能性**: subprocess 版のフォールバックロジックをテストするには実際に子プロセスを起動する必要があった。in-process では `ImageGenPort` を実装するモックを注入するだけで、`templates/contract-test.ts` のようにフォールバック経路を高速・決定的にテストできる。

## リトライとフェイルオーバーの区別

- **リトライ**: 同一プロバイダ内で同じリクエストを再送する。`ImageGenError.retryable` が true のときのみ行う（例: `transient`, `rate_limited`）。
- **フェイルオーバー**: 次の優先順位のプロバイダに切り替える。`ImageGenError.failoverable` が true のときのみ行う。

この2つは独立した軸である。「リトライしてよいが、尽きたらフェイルオーバーもしてよい」（`transient`）と、「リトライは禁止だがフェイルオーバーはしてよい」（`quota_exhausted`）は別のケースとして扱う。

## リトライ禁止分類の扱い

- **`quota_exhausted`**（予算/上限超過）: 同一プロバイダ内リトライは禁止（課金設定を直さない限り何度呼んでも失敗する）。フェイルオーバーは推奨（`failoverable: true`）。
- **`content_blocked`**（モデレーション等でブロック）: 同一プロバイダ内リトライは禁止（同じ入力を再送しても結果は変わらない）。フェイルオーバーを許すかどうかはプロジェクトの設計判断とする。理由: モデレーションポリシーはプロバイダごとに異なり、あるプロバイダでブロックされたプロンプトが別プロバイダでは通ることも、逆により厳しく弾かれることもある。`templates/adapter-openai.ts` の `mapOpenAIError()` はデフォルトで `failoverable: true` を選んでいるが、コンプライアンス要件が強いプロジェクトでは `false` に倒す判断もありうる。

## decorator としての実装

フォールバックは `templates/port.ts` の `withFallback(providers: ImageGenPort[]): ImageGenPort` として実装している。個々のアダプタにフォールバックロジックを持たせず、複数の `ImageGenPort` を束ねて1つの `ImageGenPort` として振る舞う decorator にすることで:

- アダプタ自体はプロバイダ1つの呼び出しにだけ責務を持てる（単一責任）
- フォールバックの優先順位・リトライ回数はアプリ側の構成（`withFallback([primary, secondary], opts)`）で決められる
- `templates/contract-test.ts` の「フォールバック decorator の経路テスト」で、プロバイダ実装と独立してフォールバック挙動だけを検証できる
