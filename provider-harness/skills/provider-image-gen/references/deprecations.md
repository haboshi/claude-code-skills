# 廃止・引退情報（付録）

`model-catalog.md` の要点を時系列・教訓つきで補足する。カタログ本体を読む前提の付録であり、単独では使わない。

## OpenAI

- **DALL·E 廃止済み（2026-05-12 removed）**: `dall-e-2` / `dall-e-3` は API から削除済み。API reference のスキーマ上にまだ列挙が残っていることがあるが、実際に呼び出すとエラーになる（`freshness-check.md` のキャッシュ遅延の教訓を参照）。
- **`gpt-image-1` は 2026-10-23 shutdown 予定**、`gpt-image-1-mini` / `gpt-image-1.5` は 2026-12-01 shutdown 予定。いずれも deprecated 扱いで新規実装での採用は避ける。
- **`gpt-image-1.5` → `gpt-image-2` で透過背景が退行した事例**: `gpt-image-1.5` は固定3サイズながら透過背景に対応していたが、後継の flagship `gpt-image-2` は任意解像度を獲得した代わりに透過背景が非対応になった。**新しい flagship モデルが旧世代の上位互換とは限らない**という教訓。透過背景が必須要件のプロジェクトは、`gpt-image-1.5` の 2026-12-01 shutdown までに代替手段（後処理でのアルファチャンネル合成、他プロバイダへの切り替え等）を設計しておく必要がある。

## Gemini

- **preview 接尾辞の卒業**: `gemini-3-pro-image-preview` は正式版 `gemini-3-pro-image` に昇格済み。preview 接尾辞つきのモデルIDが実装や過去のスキルに残っていたら、正式IDへの置き換えを検討する（preview 版は将来的に別の非推奨スケジュールに乗る可能性がある）。

## この付録の使い方

- 新しいモデルへの切り替えを検討するとき、「新モデルが旧モデルの全機能を包含する」と無条件に仮定しない。`capabilities()` の差分を必ず確認する（`port.md` 参照）。
- shutdown 予定日が近づいたモデルへの依存が実装に残っていないか、`pin-and-verify.md` の Verify タイミングで確認する。
