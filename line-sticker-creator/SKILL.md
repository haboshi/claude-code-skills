---
name: line-sticker-creator
description: LINEスタンプセットを作成。AI画像生成でキャラクター一貫性を保った静止画・アニメーションスタンプを生成し、LINE Creators Market仕様に準拠したバリデーション・リサイズ・パック整理まで対応。「LINEスタンプを作って」「LINEスタンプ」「スタンプセットを作成」「LINEのスタンプ」「LINE sticker」「スタンプを8個作って」「アニメーションスタンプ」で発動。image-creatorスキルと連携して画像生成を行う。
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# LINE Sticker Creator

AI画像生成を活用してLINEスタンプセットを作成するスキル。
image-creator スキルのスクリプト群と連携し、LINE Creators Market 仕様に準拠したスタンプパックを生成する。

前提: `image-creator` スキルが同一リポジトリ内にインストールされていること。

## ワークフロー概要

```
Phase 1: 計画
  Step 1  → スタンプタイプ選択（静止画 / アニメーション）
  Step 2  → セット枚数決定
  Step 3  → 完了フェーズ選択
  Step 4  → キャラクター定義（テキスト or 参照画像）
  Step 5  → プロバイダ選択
  Step 6  → テーマ選択（使用シーン）
  Step 6b → トーン選択（テーマの方向性）
  Step 7  → 感情・表情プラン作成
  Step 8a → テキスト有無選択
  Step 8b → テキスト方式選択（8aで「有り」の場合のみ）

Phase 2: 生成
  Step 9  → スタンプ画像のバッチ生成
  Step 9b → レビュー＆選択的再生成
  Step 10 → 背景処理（必要に応じて）
  Step 10b→ テキストオーバーレイ（後処理方式選択時のみ）
  Step 11 → リサイズ
  Step 12 → サマリー画像生成

Phase 3: 検証・整理（完了フェーズに応じて実行）
  Step 13 → バリデーション        ※「検証済みセット」以上
  Step 14 → メイン/タブ画像生成   ※「申請直前」のみ
  Step 15 → パック整理             ※「申請直前」のみ
  Step 16 → 最終サマリー
```

---

## Phase 1: 計画

### Step 1: スタンプタイプ選択（AskUserQuestion）

```json
{
  "questions": [{
    "question": "どのタイプのLINEスタンプを作成しますか？",
    "header": "スタンプタイプ",
    "options": [
      {"label": "静止画スタンプ", "description": "PNG画像。8/16/24/32/40個セット"},
      {"label": "アニメーションスタンプ", "description": "APNG動画。8/16/24個セット。5-20フレーム"}
    ],
    "multiSelect": false
  }]
}
```

### Step 2: セット枚数決定（AskUserQuestion）

タイプに応じた選択肢を提示する。

- 静止画: 8, 16, 24, 32, 40
- アニメーション: 8, 16, 24

### Step 3: 完了フェーズ選択（AskUserQuestion）

どこまでの工程を実行するか選択させる。

```json
{
  "questions": [{
    "question": "どこまでの工程を実行しますか？",
    "header": "完了フェーズ",
    "options": [
      {"label": "画像セットのみ", "description": "生成＋リサイズまで。自分で検証・整理する場合に"},
      {"label": "検証済みセット", "description": "＋LINE仕様バリデーション。仕様準拠確認済みの画像セット"},
      {"label": "申請直前（推奨）", "description": "メイン/タブ画像・パック整理まで全実行。そのままアップロード可能"}
    ],
    "multiSelect": false
  }]
}
```

**完了フェーズ別の実行ステップ**:

| 選択 | Phase 2 | Step 12 サマリー | Step 13 バリデーション | Step 14-15 | Step 16 最終報告 |
|:---|:---|:---|:---|:---|:---|
| 画像セットのみ | 全実行 | 実行 | スキップ | スキップ | 画像パス報告 |
| 検証済みセット | 全実行 | 実行 | 実行 | スキップ | 検証結果報告 |
| 申請直前 | 全実行 | 実行 | 実行 | 全実行 | フルサマリー |

### Step 4: キャラクター定義

参照画像が提供された場合:
1. 画像を読み込み、キャラクターの特徴を記述する
2. 複数キャラクターが存在する場合は AskUserQuestion でどのキャラクターを使うか確認する
3. 特徴リスト（体型、色、服装、アクセサリー等）を作成し、全スタンプで統一する

参照画像がない場合:
1. ユーザーにキャラクターの説明を求める
2. 「キャラクター基本プロンプト」を作成し、確認を取る

**キャラクター基本プロンプト** の構成:
```
[キャラクター描写], [スタイル], LINE sticker style, simple clean design,
transparent background, white outline around character
```

`no text` の付与はテキスト方式（Step 8a/8b）の選択に依存する。AI生成テキスト以外を選択した場合のみ末尾に `no text` を追加する。

### Step 5: プロバイダ選択（AskUserQuestion）

利用可能なプロバイダと推奨理由を提示して選択させる。

```json
{
  "questions": [{
    "question": "どの画像生成プロバイダを使用しますか？",
    "header": "プロバイダ選択",
    "options": [
      {"label": "Gemini (Nano Banana)", "description": "推奨: 日本語テキスト描画◎。参照画像対応。無料枠あり"},
      {"label": "OpenAI GPT Image", "description": "ネイティブ透過背景。約$0.04/枚（16枚≒$0.64）"},
      {"label": "GLM-Image (ZhipuAI)", "description": "テキスト描画精度が高い。約¥0.3/枚（最安）"},
      {"label": "fal.ai GPT Image", "description": "gen-ai-imageスキル経由。GPT Image 1.5。約$0.05/枚"}
    ],
    "multiSelect": false
  }]
}
```

### Step 6: テーマ選択（AskUserQuestion）

スタンプの使用シーンを選択させる。選択結果は Step 7 の感情プラン作成に使用する。

```json
{
  "questions": [{
    "question": "スタンプのテーマ（使用シーン）を選んでください",
    "header": "テーマ",
    "options": [
      {"label": "汎用（日常会話）", "description": "挨拶・感情・リアクション。幅広く使えるセット"},
      {"label": "ビジネス", "description": "職場向け。了解・お疲れ様・確認中・納期など"},
      {"label": "友達・カジュアル", "description": "くだけた表現。ウェーイ・草・マジか・それなど"},
      {"label": "恋人・家族", "description": "親密な表現。大好き・ハグ・会いたい・おやすみ"}
    ],
    "multiSelect": false
  }]
}
```

### Step 6b: トーン選択（AskUserQuestion）

Step 6 で選択されたテーマの中で、どんな方向性・雰囲気にするかを選択させる。
トーンはテキストの口調とプロンプトの雰囲気修飾に影響する。

各テーマに応じた選択肢を提示する。ユーザーは「Other」で自分の言葉で方向性を自由に記述することもできる。

**汎用（日常会話）の場合**:
```json
{
  "questions": [{
    "question": "スタンプの雰囲気・トーンを選んでください（自由入力も可）",
    "header": "トーン",
    "options": [
      {"label": "ほんわか・癒し系", "description": "ゆるくて柔らかい。見ると和む。ひらがな多め、語尾に「〜」"},
      {"label": "元気・ポップ", "description": "明るくて活発。カラフルでにぎやか。「！」多め、パンチのある言葉"},
      {"label": "クール・シンプル", "description": "ミニマルで洗練。落ち着いた色調。漢字＋句点で端的に"}
    ],
    "multiSelect": false
  }]
}
```

**ビジネスの場合**:
```json
{
  "questions": [{
    "question": "ビジネススタンプの雰囲気を選んでください（自由入力も可）",
    "header": "トーン",
    "options": [
      {"label": "きっちり敬語", "description": "上司・取引先向け。丁寧で礼儀正しい。「承知しました」「お疲れ様です」"},
      {"label": "ゆるビジネス", "description": "チーム内Slack向け。丁寧だけどくだけた表現。「りょ！」「おつです〜」"},
      {"label": "リモートワーク", "description": "在宅勤務の日常。ステータス共有重視。「カメラOFF勢」「ミュートし忘れた」"}
    ],
    "multiSelect": false
  }]
}
```

**友達・カジュアルの場合**:
```json
{
  "questions": [{
    "question": "カジュアルスタンプの雰囲気を選んでください（自由入力も可）",
    "header": "トーン",
    "options": [
      {"label": "ハイテンション", "description": "ノリ重視。勢いとテンション全振り。「ウケるｗｗ」「ﾏｼﾞか」"},
      {"label": "まったり・脱力", "description": "ゆるくてだるい。癒しと共感。「ねむ...」「もうむり...」"},
      {"label": "推し活・オタク", "description": "推し語り・感情の振れ幅大。「尊い...」「優勝」「しんどい（良い意味）」"}
    ],
    "multiSelect": false
  }]
}
```

**恋人・家族の場合**:
```json
{
  "questions": [{
    "question": "スタンプの親密さの方向性を選んでください（自由入力も可）",
    "header": "トーン",
    "options": [
      {"label": "あまあま", "description": "ラブラブ全開。ハートと甘い雰囲気。「すき♡」「ちゅ♡」"},
      {"label": "ほっこり日常", "description": "長年の安心感。生活に寄り添う温かさ。「ごはんできたよ」「おかえり」"},
      {"label": "親子・ファミリー", "description": "子育てや家族行事。「がんばったね」「だいすき」「いってらっしゃい」"}
    ],
    "multiSelect": false
  }]
}
```

**ユーザーが「Other」で自由入力した場合**: 記述された方向性から、テキスト口調とプロンプト修飾語を推定して適用する。

トーンの詳細（口調ガイド・プロンプト修飾語）は `references/theme_emotion_presets.md` の「トーン（方向性）」セクションを参照。

### Step 7: 感情・表情プラン作成

選択されたテーマとトーンに応じたリファレンスを参照し、セット枚数に合った感情リストを作成する。

- **汎用** → `references/emotion_expression_templates.md` を参照
- **ビジネス / 友達・カジュアル / 恋人・家族** → `references/theme_emotion_presets.md` の該当テーマを参照
- セット枚数がプリセット数（16個）を超える場合 → プリセット + `emotion_expression_templates.md` から補完

感情リスト作成時、Step 6b で選択されたトーンを反映する:
1. **テキスト例**: トーンの口調ガイドに沿って調整（例: 同じ「了解」でも、きっちり敬語なら「承知しました」、ゆるビジネスなら「りょ！」）
2. **プロンプトヒント**: トーンのプロンプト修飾語をスタイル指定に追加

ユーザーに感情リスト（感情 + テキスト例 + トーン適用後の調整内容）を提示して確認を取る。この段階で個別の感情やテキストの入れ替え・追加・削除を受け付ける。

### Step 8a: テキスト有無選択（AskUserQuestion）

まずテキストの有無を選択させる。

```json
{
  "questions": [{
    "question": "スタンプにテキスト（文字）を入れますか？",
    "header": "テキスト有無",
    "options": [
      {"label": "テキスト有り", "description": "感情やセリフをテキストで表現"},
      {"label": "テキストなし", "description": "イラストのみ。表情とポーズで感情を伝える"}
    ],
    "multiSelect": false
  }]
}
```

**「テキストなし」を選択した場合**: プロンプトに `no text` を含めて生成。Step 8b はスキップ。

### Step 8b: テキスト方式選択（AskUserQuestion）

Step 8a で「テキスト有り」を選択した場合のみ表示する。

```json
{
  "questions": [{
    "question": "テキストの追加方式を選んでください",
    "header": "テキスト方式",
    "options": [
      {"label": "AI生成テキスト", "description": "推奨（Gemini選択時）: AIが画像内にテキストを描画"},
      {"label": "後処理オーバーレイ", "description": "Pillowで後から追加。フォント・位置を確実に制御"},
      {"label": "両方生成", "description": "テキストなし版 + テキスト入り版の2セット"}
    ],
    "multiSelect": false
  }]
}
```

**AI生成テキスト**を選択した場合:
- プロバイダが Gemini（Nano Banana）の場合に推奨。日本語テキスト描画品質が高い
- `no text` をプロンプトから除外する
- テキスト内容は感情プランに基づいて各スタンプごとに設定
- **テキストデザイン思考プロセス**（後述）に従い、各スタンプのテキストを視覚要素として設計する

**後処理オーバーレイ**を選択した場合:
- 画像生成時は `no text` をプロンプトに含める
- 生成後に Pillow でテキストを追加（ヒラギノ角ゴシック W8 + 白縁取り）
- フォント・色・位置を正確に制御可能

**両方生成**を選択した場合:
- まずテキストなし版を生成し、その後選択された方式でテキスト入り版を追加生成

#### テキストデザイン思考プロセス（AI生成テキスト時）

テキストをプロンプトの `bold text "..."` で済ませず、**スタンプデザインの一部**として設計する。
各スタンプの生成前に以下の5要素を決定し、プロンプトに反映する。

**1. 配色（感情→色のマッピング）**

テキスト色は感情に連動させ、キャラクターの配色と補色・調和関係を考慮する。

| 感情カテゴリ | 推奨テキスト色 | 理由 |
|:---|:---|:---|
| 喜び・祝い | オレンジ / 明るい黄色 | 祝福感、温かさ |
| 悲しみ | ブルー / ライトブルー | 涙、水のイメージ |
| 怒り | レッド / ホットレッド | 強い感情、警告色 |
| 驚き | イエロー / 電撃イエロー | 注意、衝撃 |
| 感謝・愛情 | コーラルピンク / ホットピンク | 温もり、ハートの色調統一 |
| 肯定・応援 | グリーン / ティール | ポジティブ、GO信号 |
| 疲れ・眠い | グレー / ラベンダー | 脱力、夢 |
| 自信・得意 | ゴールド / アンバー | 輝き、プライド |
| 焦り | オレンジレッド | 緊急、警告 |
| 謝罪・照れ | ソフトピンク / ライトブルー | 控えめ、柔らかさ |

**2. 書体イメージ**

トーン（Step 6b）に応じて書体の方向性を決める。プロンプトに書体イメージを記述する。

- 元気・ポップ → `bold rounded bubbly hand-drawn style text`
- ほんわか・癒し系 → `soft rounded gentle handwritten style text`
- クール・シンプル → `clean sharp modern bold text`

**3. サイズと太さ**

`large bold text` を基本とする。LINEスタンプは小さく表示されるため、大きく太く描画させる。

**4. 位置と角度**

感情に応じて位置・角度を変える。プロンプトで指示する。

- 元気な感情 → `with playful slight tilt`（少し傾けて動きを出す）
- 落ち着いた感情 → `centered at bottom`（安定感）
- 激しい感情 → `with dynamic angle`（勢いを表現）

**5. 装飾要素**

テキスト周辺にテーマに合った装飾を指定する。テキストとイラストの一体感を高める。

- ハート系 → `hearts decorating around the text`
- キラキラ系 → `sparkles and stars around the text`
- 衝撃系 → `impact lines and exclamation effects around text`
- 脱力系 → `sweat drops near text`

#### テキスト入りスタンプのプロンプト構成

AI生成テキストの場合（テキストデザイン思考を反映）:
```
[キャラクター基本プロンプト], [今回の感情・ポーズ],
large bold [書体イメージ] text '[テキスト]' in [テキスト色] color
with thick white outline, text placed at [位置] [角度],
text feels integrated into the sticker composition,
[装飾要素]
```

テキストなし / 後処理オーバーレイの場合:
```
[キャラクター基本プロンプト], [今回の感情・ポーズ]
```

---

## Phase 2: 生成

### 中断からの再開

生成途中でセッションが中断した場合、`raw/` ディレクトリの既存ファイルを確認して未生成分のみ続行する。

```bash
# 既存ファイル確認
ls output/line-stickers/raw/
# → 01.png 02.png ... 12.png まで存在 → 13.png から再開
```

各ステップのディレクトリ（`raw/` → `nobg/` → `resized/`）を順にチェックし、最後に完了したステップから再開する。途中のファイルが破損している場合は該当ファイルのみ再生成する。

### Step 9: スタンプ画像のバッチ生成

選択されたプロバイダに応じて image-creator のスクリプトを使用する。
出力先ディレクトリ: `output/line-stickers/[タイトル]/`

#### Gemini（Nano Banana）

```bash
# 基本生成（マゼンタ背景で生成→後で背景除去）
uv run --with google-genai --with pillow \
  ../image-creator/scripts/generate.py "[プロンプト]" \
  --magenta-bg -o output/line-stickers/raw/01.png

# 参照画像あり
uv run --with google-genai --with pillow \
  ../image-creator/scripts/generate.py "[プロンプト]" \
  --magenta-bg -r reference.png -o output/line-stickers/raw/01.png
```

#### OpenAI GPT Image

```bash
# ネイティブ透過背景（背景除去不要）
uv run --with openai --with pillow \
  ../image-creator/scripts/generate_openai.py "[プロンプト]" \
  -b transparent -s 1024x1024 -o output/line-stickers/raw/01.png
```

#### GLM-Image

```bash
uv run --with httpx --with pillow \
  ../image-creator/scripts/generate_zhipu.py "[プロンプト]" \
  -s 1024x1024 -o output/line-stickers/raw/01.png
```

**重要**: 全スタンプに同一のキャラクター基本プロンプトを使用し、感情・ポーズ部分のみ変更する。参照画像がある場合は全スタンプで同じ参照画像を `-r` で指定する。

1枚ずつ順番に生成し、各生成後に結果を確認する。問題があれば再生成する。

#### テキスト方式別の生成

**AI生成テキスト**の場合: プロンプトにテキストを含める。
```
[キャラクター基本プロンプト], [感情・ポーズ], bold text "[テキスト]" at bottom
```
例: `..., waving cheerfully, bold text "こんにちは！" at bottom`

**後処理オーバーレイ**の場合: プロンプトに `no text` を含めて画像を生成。
生成完了後、Step 10b でテキストを追加する（後述）。

#### アニメーションスタンプの場合

1スタンプにつき複数フレームを生成する必要がある。
`references/animation_guidelines.md` を参照してフレーム構成を決定する。

```
output/line-stickers/frames/01/  ← スタンプ01のフレーム群
  frame_01.png
  frame_02.png
  ...
output/line-stickers/frames/02/  ← スタンプ02のフレーム群
  ...
```

### Step 9b: レビュー＆選択的再生成

全スタンプの raw 画像が揃った時点で、サマリー画像を生成してユーザーに提示する。

```bash
uv run --with pillow scripts/create_summary.py \
  output/line-stickers/raw/ \
  -o output/line-stickers/summary_raw.png \
  --title "[タイトル] - レビュー用"
```

サマリー画像を提示し、以下を確認する:

```json
{
  "questions": [{
    "question": "生成結果を確認してください。やり直したいスタンプはありますか？",
    "header": "レビュー",
    "options": [
      {"label": "全てOK", "description": "このまま背景処理・リサイズに進む"},
      {"label": "一部やり直したい", "description": "番号を指定して再生成（例: #3, #7）"},
      {"label": "全体的にやり直したい", "description": "プロンプトや方向性を調整して全枚再生成"}
    ],
    "multiSelect": false
  }]
}
```

**「一部やり直したい」** の場合:
1. やり直し対象の番号と理由をユーザーに聞く（例:「#3の表情が硬い、#7のポーズが違う」）
2. フィードバックを反映してプロンプトを調整し、対象番号のみ再生成
3. 再度サマリーを生成して確認（再生成ループは最大2ラウンドを目安とする）

**「全体的にやり直したい」** の場合:
1. 問題点を確認（キャラクターの一貫性、スタイル、テーマとのずれ等）
2. キャラクター基本プロンプトまたは感情プランを調整
3. Step 9 から全枚再生成

### Step 10: 背景処理

プロバイダ別の背景処理:

- **OpenAI**: `-b transparent` で生成すれば不要
- **Gemini（マゼンタ背景）**: マゼンタ背景除去スクリプトを実行

```bash
# マゼンタ背景除去
uv run --with pillow \
  ../image-creator/scripts/remove-bg-magenta.py \
  output/line-stickers/raw/01.png \
  -o output/line-stickers/nobg/01.png
```

- **GLM-Image / その他**: macOS Vision API で背景除去

```bash
uv run --with pillow --with pyobjc-framework-Vision \
  ../image-creator/scripts/remove-bg-vision.py \
  output/line-stickers/raw/01.png \
  -o output/line-stickers/nobg/01.png
```

### Step 10b: テキストオーバーレイ（後処理方式選択時のみ）

テキスト方式で「後処理オーバーレイ」または「両方生成」を選択した場合に実行する。
背景除去済みの画像に対してテキストを描画する。

テキスト描画仕様:
- フォント: ヒラギノ角ゴシック W8（macOS）。画像幅の85%以内に収まるサイズに自動計算
- 位置: 画像下部中央
- 縁取り: 白色アウトライン（フォントサイズの1/10幅）
- テキスト色: 感情に応じたアクセントカラー（例: 喜び→オレンジ、ビジネス→ブルー、緊急→レッド）

#### 単体テキスト合成

```bash
uv run --with pillow scripts/text_overlay.py \
  output/line-stickers/nobg/01.png "こんにちは！" \
  --text-color "#FF6600" \
  -o output/line-stickers/nobg_text/01.png
```

#### バッチテキスト合成

感情プラン（Step 7）に基づいた JSON マッピングファイルを作成し、一括処理する。

```json
{
  "01.png": "こんにちは！",
  "02.png": "ありがとう",
  "03.png": "OK！",
  "04.png": "えーん"
}
```

または配列形式（ファイル名の昇順に適用）:

```json
["こんにちは！", "ありがとう", "OK！", "えーん"]
```

```bash
uv run --with pillow scripts/text_overlay.py \
  --batch output/line-stickers/nobg/ texts.json \
  -o output/line-stickers/nobg_text/ \
  --text-color "#FF6600"
```

テキスト入り画像は別ディレクトリ（`nobg_text/` → リサイズ後 `resized_text/`）に出力し、テキストなし版は保持する。

### Step 11: リサイズ

LINE 仕様に合わせてリサイズする。

```bash
# 静止画スタンプ（最大 370x320、10pxマージン付き）
uv run --with pillow scripts/resize_sticker.py \
  output/line-stickers/nobg/01.png \
  --role sticker_static \
  -o output/line-stickers/resized/01.png

# アニメーションスタンプ（最大 320x270、10pxマージン付き）
uv run --with pillow scripts/resize_sticker.py \
  output/line-stickers/nobg/01.png \
  --role sticker_animated \
  -o output/line-stickers/resized/01.png
```

アニメーションスタンプの場合、リサイズ後にフレームから APNG を生成:

```bash
uv run --with pillow scripts/create_apng.py \
  output/line-stickers/frames/01/ \
  -o output/line-stickers/resized/01.png \
  --fps 10 --loops 2
```

APNG 制作の詳細は `references/animation_guidelines.md` を参照。

### Step 12: サマリー画像生成

リサイズ済みスタンプを一覧できる合成画像を生成する。

```bash
uv run --with pillow scripts/create_summary.py \
  output/line-stickers/resized/ \
  -o output/line-stickers/summary.png \
  --title "[スタンプタイトル]"
```

テキスト入り版がある場合はサマリーも2枚生成:

```bash
# テキストなし版サマリー
uv run --with pillow scripts/create_summary.py \
  output/line-stickers/resized/ \
  -o output/line-stickers/summary.png \
  --title "[タイトル]"

# テキスト入り版サマリー
uv run --with pillow scripts/create_summary.py \
  output/line-stickers/resized_text/ \
  -o output/line-stickers/summary_text.png \
  --title "[タイトル] (テキスト入り)"
```

サマリー画像はユーザーに提示し、全体の出来を確認してもらう。

---

## Phase 3: 検証・整理（完了フェーズに応じて実行）

### Step 13: バリデーション（「検証済みセット」以上で実行）

完了フェーズが「画像セットのみ」の場合はスキップする。

全スタンプを LINE 仕様に対して検証する。

```bash
# バッチ検証
uv run --with pillow scripts/validate_sticker.py \
  --batch output/line-stickers/resized/ \
  --type static

# アニメーション検証
uv run --with pillow scripts/validate_sticker.py \
  --batch output/line-stickers/resized/ \
  --type animated

# 単一ファイル検証（デバッグ用）
uv run --with pillow scripts/validate_sticker.py \
  output/line-stickers/resized/01.png --type static
```

エラーがある場合は Step 9-11 に戻って再生成またはリサイズを調整する。

LINE 仕様の詳細は `references/line_sticker_specs.md` を参照。

### Step 14: メイン画像・タブ画像生成（「申請直前」のみ実行）

完了フェーズが「申請直前」の場合のみ実行する。

スタンプセットの顔となるメイン画像とタブ画像を生成する。

1. メイン画像（240x240）: スタンプ01を代表としてリサイズ
2. タブ画像（96x74）: メイン画像を縮小

```bash
# メイン画像
uv run --with pillow scripts/resize_sticker.py \
  output/line-stickers/resized/01.png \
  --role main \
  -o output/line-stickers/resized/main.png

# タブ画像
uv run --with pillow scripts/resize_sticker.py \
  output/line-stickers/resized/01.png \
  --role tab \
  -o output/line-stickers/resized/tab.png
```

### Step 15: パック整理（「申請直前」のみ実行）

完了フェーズが「申請直前」の場合のみ実行する。

LINE Creators Market 提出形式のディレクトリに整理する。

```bash
uv run scripts/organize_pack.py \
  output/line-stickers/resized/ \
  -o output/line-stickers/pack/ \
  --title "[スタンプタイトル]" \
  --author "[作成者名]" \
  --type static \
  --zip
```

出力形式:
```
pack/
|- main.png
|- tab.png
|- png/
|  |- 01.png
|  |- 02.png
|  +- ...
+- pack_summary.json
pack.zip  ← --zip 指定時に生成（LINE Creators Market にそのままアップロード可能）
```

### Step 16: 最終サマリー

完了フェーズに応じて報告内容を分岐する。

#### 「画像セットのみ」の場合

1. 生成されたスタンプ枚数
2. リサイズ済み画像のディレクトリパス
3. サマリー画像のパス
4. 次のステップの案内（バリデーション・パック整理は手動で実行する旨）

#### 「検証済みセット」の場合

1. 生成されたスタンプ枚数とバリデーション結果
2. リサイズ済み画像のディレクトリパス
3. サマリー画像のパス
4. 次のステップの案内（メイン/タブ画像生成・パック整理は手動で実行する旨）

#### 「申請直前」の場合

1. 生成されたスタンプ枚数とバリデーション結果
2. パックディレクトリのパス
3. サマリー画像のパス
4. LINE Creators Market へのアップロード手順の案内:
   - https://creator.line.me/ にアクセス
   - 「マイスタンプ」→「新規作成」
   - 生成された `pack.zip` をそのままアップロード

---

## スクリプト一覧

| スクリプト | 用途 | 依存 |
|:---|:---|:---|
| `scripts/validate_sticker.py` | LINE仕様バリデーション | pillow |
| `scripts/resize_sticker.py` | LINE仕様リサイズ | pillow |
| `scripts/create_apng.py` | APNG作成 | pillow |
| `scripts/text_overlay.py` | テキストオーバーレイ（単体+バッチ） | pillow |
| `scripts/create_summary.py` | サマリー合成画像生成 | pillow |
| `scripts/organize_pack.py` | パック整理・ZIP作成 | なし（標準ライブラリ） |

## リファレンス

| ファイル | 内容 |
|:---|:---|
| `references/line_sticker_specs.md` | LINE公式仕様（寸法、形式、制限） |
| `references/emotion_expression_templates.md` | 感情・表情テンプレート（8/16/24/32/40セット） |
| `references/theme_emotion_presets.md` | テーマ別感情プリセット（ビジネス/友達/恋人・家族） |
| `references/animation_guidelines.md` | APNG制作ガイドライン |
