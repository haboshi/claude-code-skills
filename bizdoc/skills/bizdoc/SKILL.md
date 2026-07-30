---
name: bizdoc
description: ビジネスシーン向けの白基調・SVG図解付き1枚HTML文書（提案書/報告書/解説/手順書/議事録）を生成し、doc-hub に保存する。「ビジネス資料作って」「提案書作って」「報告書をHTMLで」「白基調で資料」「図解入りの業務資料」「business document」で発動。イラスト風でない業務文書・関係部署に展開する資料が必要なときに使う。
user-invocable: true
argument-hint: "[topic | URL | file path]"
---

# bizdoc

ユーザー入力（topic 文字列 / URL / ローカルファイルパス / 直前会話）を起点に、**白基調・図解付き1枚 HTML のビジネス文書**を生成し、doc-hub（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs"`）に保存する orchestrator。

## 1. Input / Output

- **Input**: `$ARGUMENTS` = topic 文字列 / URL / ローカルファイルパス のいずれか。空または曖昧なら直前会話を context として拾う。
- **Output**: doc-hub に保存済みのドキュメント。保存先パスは Phase 5 の `hub.mjs add` の stdout（保存先 `index.html` の絶対パス1行）で確定する。会話の最後にこのパスをユーザーへ提示する。
- **副産物（doc-hub には保存しない）**: 調査結果 `context.md`、構成案 `outline.json`。スクラッチ領域の一時ファイルとして扱い、doc-hub に保存するのは組み立て済みの最終 HTML のみ。

## 2. 最重要（compaction 対策）

- **1 ターンで Phase 0〜5 を完走する**（フェーズ間で応答を終了しない）。Phase 0 の目的・読者・種別が会話から一意に定まる場合は AskUserQuestion で止めず即着手する。
- **1枚 HTML 縛り**（CDN 禁止。CSS は `<style>` にインライン、SVG も文書内にインライン。外部ファイル参照や `<link>` での読み込みはしない）
- **図解はインライン SVG が既定**。ラスタ画像（PNG/JPEG）は**ユーザーが明示指示したときだけ** codex-imagegen 経由で使う

詳細な落とし穴は §11 Gotchas に集約する。

## 3. いつ使う / いつ使わない

| 用途 | 使うスキル |
|---|---|
| **図解付きビジネス文書（提案書・報告書・解説・手順書・議事録）を関係部署に展開** | **`bizdoc`** ← この skill |
| カジュアルな図解解説ページ（技術ネタ・個人の理解用） | `run-explainer-page` |
| スライド（HTML/PDF） | `frontend-slides` |
| Markdown 資料の PDF 化 | `pdf-creator-jp` |

判断基準: 「業務の意思決定・報告・引き継ぎに使う、フォーマルな文書か」= bizdoc。「わかりやすさ優先のカジュアルな解説か」= run-explainer-page。

## 4. Phase 0: 目的確定

会話から次の4項目を確定する。ここで確定した内容が `.cover`（表紙相当）の中身になり、Phase 2 で各ブロックに書く `why` の判定基準になる。

1. **目的**（なぜ作るか。例: 予算承認を得る／進捗を共有する／手順を周知する）
2. **読者**（誰が読むか。例: 経営層／情報システム部／現場担当者）
3. **文書種別**（提案書 / 報告書 / 解説 / 手順書 / 議事録 のいずれか、または相当するもの）
4. **トーン**（フォーマル度・断定の強さ。読者との関係性から判断）

4項目が会話から一意に定まらないときだけ、AskUserQuestion で1問に絞って確認する。選択肢は「種別 × 読者」の組合せ候補（例: 「提案書・経営層向け」「報告書・現場向け」等）にし、自由記述の余地も残す。定まっているときは質問せず即 Phase 1 へ進む（§2 の1ターン完走を優先）。

## 5. Phase 1: 調査

入力をパースし、以下のいずれか or 両方の subagent を起動する。**親は要約だけ受け取り**、探索結果の全文を主コンテキストに吸わせない。

### 判定ルール

- 入力が**社内のコードベース・システム・ローカルファイル**に関する題材 → `Explore` エージェント
- 入力が**抽象的なトピック・社外事情・市場動向**など → `general-purpose` エージェントによる web research
- 両方ありうるなら **1 メッセージで並列 fire**

### Explore エージェントの呼び方（コードベース・社内システム題材）

```
Agent({
  description: "bizdoc Phase 1 code research",
  subagent_type: "Explore",
  prompt: "<対象コードベース/システムで何を読んで欲しいか具体的に。例: '<repo>の認証まわり\
           (src/auth/*) を読んで、報告書の読者（情報システム部）が知りたい実装状況・\
           残課題を300語以内で。数字（件数・所要時間等）は取得元を明記して'>"
})
```

### Web research subagent の呼び方（抽象トピック・社外事情）

```
Agent({
  description: "bizdoc Phase 1 web research",
  subagent_type: "general-purpose",
  prompt: "<下記の指示文をそのまま渡す>"
})
```

指示文テンプレ:

```
あなたはビジネス文書（種別: <Phase0で確定した種別>）作成のための調査役。
トピック: 「<TOPIC>」/ 目的: <Phase0で確定した目的> / 読者: <Phase0で確定した読者>

以下を500語以内のサマリで返す:
1. 読者が前提として知っておくべき事実（3-5点）
2. 数字（価格・実績・比較値等）— 必ず出典 URL と取得日を併記する。出典が確認できない数字は
   「未確認」と明記し、断定形で書かない
3. 論点・リスク・反対意見になりうる材料
4. 意思決定や行動を後押しする材料（推奨・比較の根拠になりうるもの）
5. 図解にできそうな構造（比較・時系列・構成・手順・関係・分類 のどれに近いか）

出力はマークダウン書式。親が context.md に統合する。
```

### 縮退モード

Agent ツールが使えない文脈（自分がサブエージェントとして実行されている等）では、subagent を起動せず自分で調査して `context.md` を書く: ローカル題材は Read / Grep で読み、社外事情は WebSearch / WebFetch で公式情報を取得し、上記5項目を自分で埋める。

### context.md への統合

subagent の要約（または縮退モードでの自前調査）を、スクラッチ領域の `context.md` に統合する。数字には必ず出典 URL と取得日を添える（出典なしの断定は禁止）。

## 6. Phase 2: アウトライン

`context.md` を読んで `outline.json` をスクラッチ領域に Write する。**構成は毎回ゼロから設計し、順序付きの章立てテンプレは書かない**（「提案書は背景→課題→提案→効果→費用の順」のような固定型を持ち出さない）。

必須要素はビジネス文書の作法として次の2つだけ:

1. **表紙相当**（タイトル・日付・目的・読者。`.cover` で表現する）
2. **結論先出し**（`.exec-summary`。文書の要点を冒頭で言い切る）

それ以外の構成は `${CLAUDE_PLUGIN_ROOT}/templates/components.md` を**伝達目的**（比較させる／時系列・計画を示す／判断を促す／根拠・数値を示す／全体像を掴ませる／手順を追わせる／注意を促す／規模感・絞り込みを示す／関係・体制を示す）で毎回引き、その文書の目的・読者に効くブロックだけを選ぶ。**各ブロックに `why`（目的・読者にどう効くか1行）を必須とし、書けないブロックは削る**。

### 文書種別ごとの「読者が最初に知りたい問い」（構成のヒント。順序ではない）

構成を組み立てる前に、この文書の読者が最初に何を知りたがるかを自問する。以下は例であり、固定の章立てではない — 実際の問いは Phase 0 の目的・読者に応じて毎回立て直す。

| 種別 | 読者が最初に知りたい問い（例） |
|---|---|
| 提案書 | 「結局いくらで何が良くなるのか」「なぜ今か」「リスクは何か」 |
| 報告書 | 「結論はどうだったか」「次に何をするのか」 |
| 手順書 | 「自分は何をすればよいか」 |
| 解説 | 「これは何か」「なぜ重要か」「自分に何が関係するか」 |
| 議事録 | 「何が決まったか」「誰が何をいつまでにやるか」 |

### outline.json の形

```json
{
  "slug": "kebab-case-slug",
  "type": "提案書",
  "cover": {
    "title": "...",
    "date": "2026-07-31",
    "purpose": "Phase0で確定した目的",
    "reader": "Phase0で確定した読者"
  },
  "exec_summary": {
    "why": "結論を冒頭で言い切ることで、多忙な読者が本文を読まなくても要点を掴めるため",
    "points": ["...", "...", "..."]
  },
  "blocks": [
    {
      "purpose_key": "根拠・数値を示す",
      "expression": "kpi-grid",
      "why": "<この目的・読者にどう効くか1行>",
      "content": { "...": "..." }
    }
  ]
}
```

アクセント色は outline.json では決めない（Phase 4 で hub 側の既存プロジェクト状態を見て決める。§8 参照）。

`blocks` の並び順はこの文書にとって自然な流れを都度考えて決める（固定順は持たない）。`expression` は `components.md` に列挙された表現名（`kpi-grid` / `compare-cols` / `steps` / SVG パターン名 等）を使う。

## 7. Phase 3: SVG 図解

`outline.json` の `blocks` のうち SVG 表現を選んだものについて、埋め込む前に必ず `${CLAUDE_PLUGIN_ROOT}/templates/svg-patterns/README.md`（全パターン共通の予防則8項目）と、該当パターンファイル（例: `${CLAUDE_PLUGIN_ROOT}/templates/svg-patterns/process-flow.md`）を Read してから書く。

- 各パターンファイルが定めるラベル文字数上限を守る（超える場合はラベルを短くするか図を分割）
- 色は `var(--accent)` 等 tokens.css の CSS 変数で参照する（アクセントは1色のみ）
- 同一文書内に複数の SVG を貼るときは `marker id` の衝突がないか確認する（README.md 参照）
- `kpi-cards` は SVG ではなく `.kpi-grid`（HTML）に委譲するパターンなので Phase 4 で直接組み立てる

### ラスタ画像（ユーザーが明示指示したときだけ）

図解の代わりに写真的・イラスト的な画像が明示的に求められた場合のみ、codex-imagegen スキルの標準実行コマンド（`env -u OPENAI_API_KEY codex exec` によるサブスク枠生成 + Claude 側コピー）に倣い、偽装防止の marker 検証を必ず行う:

```bash
# Step 0: 偽装検証用の開始マーカー
touch /tmp/bizdoc-imagegen-start.marker

# Step 1: 生成（プロンプトは内容+テイスト+品質バーのみ渡し、レイアウトは委譲する）
env -u OPENAI_API_KEY codex exec --skip-git-repo-check -C "$(pwd)" \
  -c model_reasoning_effort=high \
  -o /tmp/bizdoc-imagegen-last.txt \
  '<プロンプト本文> 画像は必ず image_gen ツールで生成すること。SVG/HTML/コードでの自作や既存ファイルの流用は禁止。失敗時は何も作らず IMAGEGEN-UNAVAILABLE とだけ報告して終了。生成後、保存された最終PNGの絶対パスだけを最後に1行で報告して。 $imagegen'

# Step 2: マーカーより新しい実ファイルのみ採用（偽装・流用・失敗を弾く）
SRC=$(grep -oE "${HOME}/.+/generated_images/[^ ]+\.png" /tmp/bizdoc-imagegen-last.txt | tail -1)
if [ -n "$SRC" ] && [ -n "$(find "$SRC" -newer /tmp/bizdoc-imagegen-start.marker 2>/dev/null)" ]; then
  cp "$SRC" "<保存先の一時ディレクトリ>/<kebab-name>.png"
else
  echo "警告: image_gen 未実行の疑い（偽装/流用/失敗）— コピー中止、同じプロンプトで再実行する"
fi
```

検証に落ちた画像は文書に使わない。コピー後は Read で目視し、文字化け・情報の薄さがないか確認する。

## 8. Phase 4: HTML 組立

`${CLAUDE_PLUGIN_ROOT}/templates/tokens.css` を Read し、内容をそのまま `<style>` にインライン展開する（`tokens.css` 自体は書き換えない）。

### アクセント色の決め方

Phase 5 で hub に保存する前に、このプロジェクトで過去に決まったアクセントがあるか確認する:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" list --project "$(pwd)" --json
```

- 該当プロジェクトが存在し `accent` が非 null → その値を最優先で使う（tokens.css の `--accent` / `--accent-soft` をこの値に置換）
- プロジェクトが未登録、または `accent` が null → 今回の文書用に選んだ色（迷えば tokens.css の既定 `#2563eb` のまま）を使う。Phase 5 の `hub.mjs add` 実行後、返ってきた `index.html` パスから dirname を3回上がった `project.json`（`.../projects/<id>/docs/<日付-slug>/index.html` → `.../projects/<id>/project.json`。書き換え前にパスが `projects/<id>/project.json` 形であることを確認する）を直接読み書きし、`accent` が null のときだけ選んだ色を書き戻す（他フィールドは変更しない）。既に値がある場合は上書きしない。**書き戻したら `node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" reindex` を1回再実行する** — `add` 内部の reindex は書き戻し前の値で走り終わっているため、再実行しないと hub 一覧（導出物 index.html）に古い accent が残る。

アクセントは1色のみ。`--accent-soft` は同系の薄色に揃える。

### 組み立て

`outline.json` の `cover` → `.cover`、`exec_summary` → `.exec-summary`、`blocks` を順番どおりに `components.md` / `svg-patterns` のスニペットへ差し込んで本文を組み立てる。数値ブロックには `<p class="src">※ 出典: ...</p>` を必ず添える（Phase 1 で確認した出典）。

本文・フッターに OS のユーザーホーム配下を指すフルパスや個人アカウント名を書かない（`~/` 表記か論理名を使う。題材がローカルファイルの場合も同様）。

組み立てた HTML はスクラッチ領域の一時ファイル（例: セッションのスクラッチディレクトリ、または `mktemp` で作った一時パス）に Write する。次の Phase でこのファイルパスを `hub.mjs add` に渡す。

## 9. Phase 5: hub 保存 + 検証

```bash
# 保存（SVG 検証→manifest→reindex まで CLI が実施。出力 = 保存先 index.html のパス）
node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" add "<組み立てたHTML>" \
  --project "$(pwd)" --title "<タイトル>" --slug "<英語kebab-caseスラッグ>" \
  --type "<種別>" --tags "<a,b>"

# 決定論ゲート2: PNG 化して Read で視覚確認（はみ出しは HTML 目視では検出できない）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --screenshot="<scratchpad>/check.png" --window-size=1280,4000 --hide-scrollbars \
  --virtual-time-budget=10000 "file://<保存先index.html>"
```

- `<組み立てたHTML>` = Phase 4 でスクラッチ領域に書き出した一時ファイルのパス
- `<タイトル>` / `<英語kebab-caseスラッグ>` / `<種別>` / `<a,b>` = Phase 0/2 で確定した内容
- `hub.mjs add` は内部処理の最初に SVG の XML 妥当性を検証する（決定論ゲート1。stdout の1行目＝保存先パスのことではない）。不正な SVG があれば add がここで中止するので、Phase 3 のスニペットを見直す
- 同じ slug のドキュメントが既にあると `add` は既定で停止する（勝手に上書きしない）。ユーザーの意図が更新なら `--update`、別ドキュメントとして残すなら `--new` を確認してから付ける
- `<scratchpad>/check.png` = 一時的なスクリーンショット保存先（`mktemp -d` 等で作った一時ディレクトリ）

Read でスクリーンショットを開き、はみ出し・文字化け・アクセント色の破綻がないか確認する。加えて**図中テキストの実表示サイズを明示的に見る**: viewBox 幅が本文幅（約780px）より大きい SVG は縮小表示されるため、図中文字が本文と同等以上の大きさで読めるか・複数の図の間で文字サイズが揃っているかを確認する（縮小率の高い図は viewBox 座標系の font-size を上げる。svg-patterns/README.md 予防則9）。崩れがあれば HTML を修正し、`--update` を付けて `add` を再実行する。再保存後は再度 PNG 化 → Read の確認を、崩れがなくなるまで繰り返す（修正後の再検証なしで完了しない）。最後に保存先を `open` し、doc-hub 全体の一覧（`node "${CLAUDE_PLUGIN_ROOT}/scripts/hub.mjs" open --project "$(pwd)"` で開ける）の場所をユーザーに案内する。

## 10. Phase 6: PDF（要求時のみ）

「PDF でも」「配布用に」と言われたときだけ実行する。

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --print-to-pdf="$HOME/Downloads/<slug>.pdf" --no-pdf-header-footer \
  --virtual-time-budget=20000 "file://<保存先index.html>"
```

PDF は一時配布物なので manifest に記録しない（`hub.mjs add` を再実行しない）。ラスタ画像（codex-imagegen 生成分）を使った文書は、そのまま書き出すと容量が膨らむため、印刷用の一時コピーを作って画像だけ軽量化してから書き出す（元の HTML・保存済みドキュメントは変更しない）。書き出し後は Read で先頭数ページを目視し、分断・色抜け・文字化けがないか確認する。

## 11. Gotchas

- **同じ slug の再生成は勝手に上書きしない** — `hub.mjs add` が既定で停止する。ユーザーに更新意図を確認してから `--update`（別ドキュメントとして残すなら `--new`）を付ける
- **アクセントは1色のみ** — 複数のアクセント色を併用しない（tokens.css の `--accent` を1つだけ振る）
- **図でしか言っていない要点を作らない** — SVG/画像は本文の補強。図にしかない情報は検索・選択・読み上げに対応できない
- **数字に出典なし断定禁止** — Phase 1 で出典が確認できなかった数字は「未確認」と明記し、`<p class="src">` を省略しない
- **SVG の入れ子禁止** — hub の SVG 検証（xmllint 経由）が入れ子に対応しない。1文書内で `<svg>` は並列に配置する
- **SVG は必ずインライン** — `<img src="pattern.svg">` にすると `var(--accent)` 等の CSS 変数が解決できず無色・黒塗りになる
- **project.json の accent は既存値があれば上書きしない** — 同一プロジェクトの文書間でアクセントがぶれるのを防ぐ
- **codex-imagegen の marker 検証を省略しない** — 省略すると偽装・流用画像をそのまま納品してしまう
