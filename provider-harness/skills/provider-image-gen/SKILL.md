---
name: provider-image-gen
description: 画像生成プロバイダ（OpenAI gpt-image / Google Gemini image 等）の統合をアプリに実装・設計するときのポート定義・アダプタ雛形・契約テスト・モデルカタログの供給元。TypeScript(Zod/vitest)。設計原則そのものは provider-harness メタスキルを参照し、単発の画像生成実行（プロンプトを1回叩いて画像を得るだけ）は image-creator プラグインを使う。「画像生成 統合」「ImageGenPort」「OpenAI Gemini 画像 アダプタ」「マルチプロバイダ 画像生成」「画像生成 フォールバック」「画像生成 リトライ」「アプリに画像生成機能を組み込む」で発動。
---

# provider-image-gen — 画像生成プロバイダ統合ドメインスキル

OpenAI (`gpt-image-2`) / Google Gemini (`gemini-3.1-flash-image` 等) を対象に、アプリへ組み込む画像生成統合のポート・アダプタ・契約テスト・モデルカタログを供給する。

## いつ使うか / メタとの関係

新規に画像生成プロバイダ統合をアプリへ実装するときに使う。設計原則そのもの（durable/volatile分離・ユースケース中心ポート・escape hatch・Pin+Verify・契約テスト・harvest）は provider-harness メタスキルが定義しており、本スキルはそれを画像生成ドメインに適用した領域特化の差分（型スケッチ・モデルカタログ・非対称性の実例）だけを持つ。原則の説明はここでは繰り返さない。

スコープ外:
- 画像生成の実行そのもの（プロンプトを渡して画像を得るだけ） → `image-creator` プラグイン
- 設計原則の一般論（ポート設計・escape hatch 等） → provider-harness メタスキル

## 抽象化方針: 画像生成は薄い層にする

provider-harness メタスキルの abstraction-thickness.md（references 配下）は、画像生成を「薄く」抽象化すべきドメインと位置づけている。理由: プロンプトはモデル固有の資産であり、移植性がほぼない。厚い統一ポートを作っても、結局プロンプトはアダプタごとに書き直しになる。

このスキルの `ImageGenPort` は意図的に3メソッド（`generate` / `edit?` / `capabilities`）だけに絞ってある。差分の大半は `providerOptions` を通じたアダプタ側の escape hatch に押し出す。詳細は `references/port.md`。

## ポート定義

型の全体は `references/templates/port.ts` を参照（コピーして使う）。骨子:

```typescript
interface ImageGenPort {
  generate(input: GenImageInput): Promise<GenImageResult>
  edit?(input: EditImageInput): Promise<GenImageResult>
  capabilities(): ImageGenCapabilities
}
```

`GenImageInput` は `prompt` / `aspect`（全アダプタ共通のポータブルな比率のみ） / `n` / `providerOptions` を持つ。`ImageGenCapabilities` は `transparentBackground` / `editing` / `referenceImages` / `aspectRatios` 等、プロバイダ非対称性を正直に返す形になっている。

共有エラー分類 `ImageGenError`（`kind: 'rate_limited' | 'quota_exhausted' | 'auth' | 'invalid_input' | 'content_blocked' | 'timeout' | 'transient' | 'unsupported'`、`retryable` / `failoverable` フラグ付き）もこのファイルにある。この8種は provider-harness メタスキルの正準エラー分類（error-taxonomy.md、references 配下）と同じ語彙であり、独自の分類を作らない。アダプタは必ずプロバイダ固有の例外をこの型にマッピングしてから投げる。`unsupported` は「`capabilities()` での事前検出が本筋、実行時に来るのは呼び出し側がそれを見なかった場合の保険」という位置づけ（`references/templates/adapter-gemini.ts` の `edit()` 参照）。

## アダプタ実装

雛形は `references/templates/adapter-openai.ts` と `references/templates/adapter-gemini.ts`。両方とも:

- **プロンプト加工はアダプタ内**（`buildPrompt()`）に閉じ込め、ポートのシグネチャに漏らさない
- **モデルIDは内部名経由**（`OPENAI_MODEL_MAP` / `GEMINI_MODEL_MAP`）でマッピングし、呼び出しコードに直書きしない。値は `references/model-catalog.md` を正とする
- **`providerOptions` で非ポータブル機能をパススルー**する（例: Gemini の参照画像は `providerOptions.gemini.referenceImages`、1K/2K/4K解像度や21:9等は `providerOptions.gemini.imageConfig`、OpenAI の `quality` 等は `providerOptions.openai`）。実際にリクエストへマージする配線まで実装してあり、共通の `aspect`/`size` と衝突する場合は providerOptions 側が優先される。使用箇所には「非ポータブル」であることのコメントを必ず付ける
- **transport を注入できる構造**にしてあり、実 API を叩かずに契約テストできる
- **capabilities() は実際に配線された機能だけを true にする**（例: OpenAI の `editing` は注入された transport が `edit` を実装しているかで動的に決まる。Gemini は `n>1` を明示的に `unsupported` として拒否し、`capabilities().maxImagesPerCall` でも1枚上限を事前に公開する）

## 鮮度ゲート（能動）

`references/model-catalog.md` の冒頭には `last_verified` と `stale_days` が記載されている。**モデルIDを使う前に、今日の日付との差が `stale_days` を超えていないか確認すること。** 超えていた場合は、そのまま使わずに Context7 / WebSearch で再検証してからカタログ更新を提案する。手順は `references/freshness-check.md` に従う（OpenAI 公式ドキュメントは Cloudflare Bot Management で WebFetch が403になりやすいため、fetch-db MCP か Context7 を使うことも含む）。

このゲートを飛ばして stale なモデルIDのまま実装すると、shutdown済みモデルを呼び出すコードが静かに紛れ込む（`references/deprecations.md` の DALL·E 廃止事例を参照）。

## 契約テスト

`references/templates/contract-test.ts` が共通契約テストスイート。両アダプタに対して:

- 正常系の出力形状
- エラー分類のマッピング（5xx→transient・429→retryable・タイムアウト→timeout 等）
- `capabilities()` の形状

を同一スイートで検証する。加えて `withFallback()` decorator の経路テスト（フェイルオーバー・quota/contentブロック時の非リトライ・editing が常に false になること・`capabilities()`/`isConfigured()` による呼び出し前の事前スキップ・全プロバイダ非対応/未構成時の集約エラー・`ImageGenError` でない生例外の既定フェイルオーバー・成功結果への `providerName` 伝播）、`unsupported` の経路テスト（OpenAI に透過背景指定・Gemini の `edit()` / `n>1` 呼び出し、いずれも `capabilities()` で false/非対応の機能を実際に要求した場合）、および `providerOptions` の配線確認テスト（モック transport が実際に受け取ったリクエスト内容を検証し、`quality` 等の追加パラメータや `imageConfig` の上書きが本当にマージされているか）も含む。

**共通スイートの限界**: このスイートが証明するのは「ポータブルな面（全アダプタ共通の契約）」だけである。`providerOptions` 経由の非ポータブル機能（Gemini の参照画像合成、OpenAI の `quality` 指定等）は、この共通スイートではカバーされない。各アダプタ固有のテストで別途検証すること。「共通スイートが緑 = 全機能が保証された」と誤解しないこと。

実 API を叩く Pin+Verify テストは `describe.skipIf(!process.env.OPENAI_API_KEY)` / `describe.skipIf(!process.env.GEMINI_API_KEY)` 形式で最小サイズ・n=1のものを1本ずつ用意してある。環境にキーが無ければ自動 skip される。

## フォールバック/耐障害性

image-creator プラグインの generate.py（scripts 配下）は subprocess fan-out 型の耐障害性（別スクリプトを呼び分けるフォールバックチェーン）を持つが、in-process の TypeScript ポートではこの形をそのまま持ち込まない。プロセス分離が不要になり、エラー分類を型で共有でき、テスト可能性も上がるためである。リトライ（同一プロバイダ内）とフェイルオーバー（次プロバイダへ）の区別、`quota_exhausted` / `content_blocked` の扱い、decorator としての実装は `references/fallback-resilience.md` に詳述する。

## 最終ステップ: harvest の実行（省略しない）

実装が完了したら、必ず `/provider-harvest` を実行する。これは複利で型を太らせるための強制ステップであり、習慣任せにしない。通常実行でもスキルを自動編集することはなく提案 diff が出るだけなので、採否は別タスクとして起票し人間のレビューを経る（provider-harness メタスキルの harvest-protocol.md（references 配下）参照）。

## リファレンス一覧

| リファレンス | 参照タイミング |
|:---|:---|
| `references/port.md` | ポートの設計判断・非対称性の実例を確認したいとき |
| `references/model-catalog.md` | モデルIDを使う前・鮮度ゲートを通すとき |
| `references/freshness-check.md` | カタログが stale だったとき |
| `references/fallback-resilience.md` | フォールバック・リトライロジックを実装するとき |
| `references/deprecations.md` | 廃止済み/引退予定モデルへの依存が無いか確認するとき |
| `references/templates/port.ts` | ポート型・共有エラー型・フォールバック decorator をコピーするとき |
| `references/templates/adapter-openai.ts` | OpenAI アダプタをコピーするとき |
| `references/templates/adapter-gemini.ts` | Gemini アダプタをコピーするとき |
| `references/templates/contract-test.ts` | 契約テストスイートをコピーするとき |

最初に全リファレンスを読む必要はない。該当セクションに到達したときに該当ファイルだけを読む（progressive disclosure）。
