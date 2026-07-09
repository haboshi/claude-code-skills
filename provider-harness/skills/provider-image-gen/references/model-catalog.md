<!-- last_verified: 2026-07-09 / stale_days: 60 -->

# 画像生成モデルカタログ

**このカタログの値を使う前に鮮度ゲートを通すこと。** `last_verified` から `stale_days` を超えて経過している場合、`freshness-check.md` の手順で再検証してから使う。

## OpenAI

| モデル | ステータス | 透過背景 | 解像度 | edit | 参照画像/マスク | streaming |
|:---|:---|:---|:---|:---|:---|:---|
| `gpt-image-2`（snapshot `gpt-image-2-2026-04-21`） | 現行 flagship | 非対応 | 任意（長辺≤3840px・16px倍数・比率≤3:1） | 対応 | 対応 | 対応（partial_images） |
| `gpt-image-1.5` | deprecated（2026-12-01 shutdown） | 対応 | 固定3種（1024x1024 / 1024x1536 / 1536x1024） | — | — | — |
| `gpt-image-1` | deprecated（2026-10-23 shutdown） | — | — | — | — | — |
| `gpt-image-1-mini` | deprecated（2026-12-01 shutdown） | — | — | — | — | — |
| `dall-e-2` / `dall-e-3` | **廃止済み（2026-05-12 removed）** | — | — | — | — | — |

確認ソース: OpenAI Platform Docs（Images / gpt-image guide, 2026-07-09 閲覧）。

注意事項:
- API reference のスキーマ（`ImageModel` enum）に `gpt-image-2` が未掲載で、廃止済みの `dall-e-*` が残っているキャッシュ遅延を確認済み。**guide ページのコード例を正とする**（詳細は `deprecations.md` / `freshness-check.md`）。
- `edit()` の参照画像は GPT image モデル共通で最大16枚（`dall-e-2` のみ1枚・正方形png限定）。確認ソース: npm `openai` 6.45.0 の型定義 `resources/images.d.ts` の `ImageEditParamsBase.image: Uploadable | Array<Uploadable>` doc コメント（SDK 同梱の一次情報、2026-07-09 確認）。

エラー分類（アダプタ実装の前提）:
- 429 は2種類: pace超過（リトライ可）/ quota超過（リトライ禁止・課金設定が必要）
- `error.type="image_generation_user_error"` かつ `error.code="moderation_blocked"` は自動リトライ禁止（プロンプト修正が必要）
- 500/503 はリトライ可
- 標準 `Retry-After` ヘッダなし。独自の `x-ratelimit-remaining-requests` / `x-ratelimit-reset-requests` 等を返す

SDK: npm `openai` 6.45.0（2026-06-29 リリース確認）

## Gemini（preview 接尾辞なしの正式ID）

| モデル | 通称 | 用途 | 参照画像上限 | アスペクト比 | 解像度 |
|:---|:---|:---|:---|:---|:---|
| `gemini-3-pro-image` | Nano Banana Pro | 最高品質 | 14枚（オブジェクト6+キャラ5+スタイル3） | 1:1〜21:9（10種） | 1K既定・2K/4K対応 |
| `gemini-3.1-flash-image` | Nano Banana 2 | 汎用ワークホース | 14枚（オブジェクト10+キャラ4） | 同上 | — |
| `gemini-3.1-flash-lite-image` | — | 最速最安 | オブジェクトのみ | 同上 | — |
| `gemini-2.5-flash-image` | — | 旧世代 | — | — | — |

確認ソース: Google AI for Developers（Gemini API Image Generation ガイド, 2026-07-09 閲覧）。

**未確認事項**（推測で埋めない。カタログとして「未確認」を明示する）:
1. 透過背景対応 — ドキュメントに言及なし
2. 0.5K 解像度が `flash` と `flash-lite` のどちらの対応か — 一次情報の文言が曖昧

エラー分類（アダプタ実装の前提）:
- リトライ対象は 429/408/5xx（公式明言）
- `Retry-After` ヘッダなし。クライアント側指数バックオフが前提

SDK: npm `@google/genai` 2.10.0（2026-06-24 リリース確認）

## このカタログの使い方

- `templates/adapter-openai.ts` の `OPENAI_MODEL_MAP` / `templates/adapter-gemini.ts` の `GEMINI_MODEL_MAP` は、このカタログの「現行モデル」列を正として値を持つ
- deprecated モデルへの参照が残っていないか、`stale_days` 超過時のカタログ更新のたびに確認する（`deprecations.md` 参照）
