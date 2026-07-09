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

## ImageGenError でない生の例外の既定動作

アダプタのエラーマッピング（`mapOpenAIError()` / `mapGeminiError()`）に漏れがあった場合、`ImageGenError` でない生の例外が `withFallback()` に届くことがある。この場合の既定動作は `retryable:false`（同一プロバイダ内リトライはしない）/ `failoverable:true`（次のプロバイダへは進む）である。未分類の例外を安全側でリトライしない一方、マッピング漏れ1件でチェーン全体を無条件に止めないための意図的な非対称性で、`templates/port.ts` の `withFallback()` docstring と `templates/contract-test.ts` の経路テストで明文化している。

## 呼び出し前のプロバイダ選別（事前スキップ）

`withFallback()` は各プロバイダを実際に呼ぶ前に、そのプロバイダが入力を処理できる見込みがあるかを2段階でふるいにかける。実行時エラーで落ちるより速く、無駄な課金・レート消費も避けられる。

- **capabilities() ベースの適合判定**: 入力が `n`（`capabilities().maxImagesPerCall` 超過）や透過背景要求（`capabilities().transparentBackground: false`）など、`ImageGenCapabilities` で判定可能な条件を満たせないプロバイダはスキップする。既定判定に加えて `canHandle?: (input, caps) => boolean` を注入すれば呼び出し側の要件で上書きできる。実例: `n=4` の入力で `OpenAIImageAdapter` → `GeminiImageAdapter` の順にフォールバック設定した場合、旧実装では `GeminiImageAdapter` が `n>1` を実行時に `unsupported`（`failoverable: false`）として投げてチェーン全体が死んでいた。事前スキップにより `capabilities().maxImagesPerCall === 1` の Gemini は呼ばれる前に除外され、この問題が起きない。
- **isConfigured() ベースの構成確認**: `ImageGenPort` は任意メソッド `isConfigured?(): boolean` を持てる。API キー等が未設定のプロバイダは `auth` エラー（`failoverable: false`）を実行時に投げてチェーン全体を止めがちなため、`withFallback()` は `isConfigured() === false` を返すプロバイダを事前に除外する（メソッド自体を実装していないプロバイダは常に構成済み扱いとする）。

両方の選別を経てなお候補が0件の場合、`withFallback()` は `kind: 'unsupported'` の `ImageGenError` を集約して投げる（個々のプロバイダを呼ばずに失敗が確定するため、実行時エラーより高速に検出できる）。

## フェイルオーバー時の入力再交渉

フォールバック先プロバイダはポータブル入力（`aspect` 等）を同一条件で満たせるとは限らない。各アダプタが自身の変換マップ（`aspect→size` 等）で入力を解釈するのが正しい構造であり、フォールバック層で入力を書き換えない。ただし品質パラメータを暗黙に落とすフォールバックは「ユーザーが求めたものと違う結果を静かに返す」ことになるため、`providerName`（`GenImageResult` に追加。`port.md` 参照）で観測可能にするか、呼び出し側が拒否できるようにする。
