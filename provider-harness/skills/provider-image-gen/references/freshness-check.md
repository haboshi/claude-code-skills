# 鮮度チェックの実行手順

`model-catalog.md` の `last_verified` は、実装がそのまま信じてよい期限を持つ。以下の手順で能動的にチェックする。

## 手順

1. **stale 判定**: `model-catalog.md` 冒頭の `<!-- last_verified: YYYY-MM-DD / stale_days: N -->` を読み、今日の日付との差を計算する。差が `stale_days`（既定60日）を超えていたら stale。
2. **再検証**: stale の場合、モデルIDを実装で使う前に以下のいずれかで現行IDと能力を再検証する。
   - Context7（ライブラリ・SDK ドキュメントのミラー）
   - WebSearch + 公式ドキュメント
   - OpenAI 公式ドキュメント（`openai.com` 配下）は Cloudflare Bot Management により WebFetch が403になりやすいため、`fetch-db` MCP（`mcp__fetch-db__fetch_web`）または Context7 を使う
3. **差分反映**: 現行カタログとの間に差分があれば、更新案の diff を作成し `/provider-harvest` の採用手順（Maker/Checker分離 → reviewer 承認 → コミット）に流す。事実の修正（誤った記述の訂正）は patch 扱い。

## 教訓: API reference のキャッシュ遅延

`model-catalog.md` に記録した実例: OpenAI API reference の `ImageModel` enum スキーマには `gpt-image-2` が未掲載で、廃止済みの `dall-e-*` がまだ残っていることを確認した。リファレンスの型定義ページは更新が遅れることがあるため、**guide ページの実行可能なコード例を優先する**。スキーマページと guide ページで記載が食い違ったら、guide 側を正とする。

## チェックリスト

- [ ] `last_verified` から今日までの経過日数を計算したか（暗算せず日付を明示的に引き算する）
- [ ] stale なら実装前に Context7 / WebSearch / 公式ドキュメントで再検証したか
- [ ] OpenAI ドキュメント取得で403に当たったら、リトライせず `fetch-db` MCP か Context7 に切り替えたか
- [ ] スキーマページと guide ページの記載が食い違う場合、guide 側を優先したか
- [ ] 差分があれば `/provider-harvest` の採用手順（人間レビュー必須）に流したか、その場でカタログを無断書き換えしていないか
