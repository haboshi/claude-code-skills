---
name: image-creator
description: Google Gemini、OpenAI GPT Image、またはZhipuAI GLM-Imageの画像生成モデルで画像を生成・編集。「画像を生成して」「イラストを作って」「この画像を編集して」などの指示で自動的に使用される。「ステッカーを何個か作って」「複数のアイコンを生成して分割」などステッカーシート生成・分割にも対応。Gemini（Nano Banana）、OpenAI（gpt-image-2 / gpt-image-1.5）、GLM-Image（ZhipuAI）の3プロバイダーから選択可能。
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Image Creator - AI画像生成スキル

Google Gemini、OpenAI GPT Image、または ZhipuAI GLM-Image を使用して画像を生成・編集するスキル。

---

## デフォルト設定（明示指示がない場合に適用）

**強制ではなく推奨デフォルト**。ユーザーから別の指示があればそちらを優先する。

| 項目 | デフォルト | 例外 |
|---|---|---|
| **画像内テキストの言語** | **日本語**（タイトル・ラベル・本文など描画する文字列） | 「英語で」「in English」等の明示時／モデル名・型番・コード識別子・通貨記号・技術略語（API/RGB等）はそれぞれ適切な表記 |
| **OpenAI モデル** | `gpt-image-2` | `background=transparent` 指定時は自動的に `gpt-image-1.5` へフォールバック |
| **Gemini モデル** | `nb2`（Nano Banana 2） | `--model pro` または `--model flash` 明示時 |
| **情報密度の扱い** | プロンプトに書いた項目を**省略せず**全て描画 | 「要約して」「シンプルに」等の指示時は適宜割愛 |

> **注**: 日本語テキストを大量に描画する場合は `quality=medium` 以上を推奨。`quality=low` は文字が崩れる場合がある。

---

## Step 0: ユースケース判定（最初に実行）

**重要**: 画像生成を依頼されたら、技術的な詳細（プロバイダー等）を聞く前に、まず「何を作りたいか」を確認する。

### 最初の質問（AskUserQuestion）

| 選択肢 | 説明 | 次のステップ |
|--------|------|-------------|
| **YouTubeサムネイル・ブログヘッダー** | 目を引くサムネイル画像 | → Step 1A (リッチ画像) |
| **説明図・図解・比較図** | 概念を視覚的に説明する画像 | → Step 1A (リッチ画像) |
| **アイコン・ステッカー（透過背景）** | 背景なしの単体オブジェクト | → Step 1B (シンプル画像) |
| **一般的なイラスト・写真** | 自由形式の画像生成 | → Step 1B (シンプル画像) |
| **テキスト入り画像（文字精度重視）** | 正確なテキスト描画が必要 | → Step 1C (GLM-Image) |

### ツール選択の判断基準

```
ユースケース判定
├─ サムネイル・ヘッダー・説明図 → generate_rich.py（テンプレート使用）
├─ 透過アイコン → generate_openai.py --background transparent
├─ 参照画像スタイルコピー → generate.py --reference
├─ テキスト描画重視 → generate_zhipu.py
└─ その他シンプル画像 → generate.py or generate_openai.py
```

### AskUserQuestion 実装例

**Step 0: 最初の質問**
```json
{
  "questions": [{
    "question": "どのような画像を作成しますか？",
    "header": "画像タイプ",
    "options": [
      {"label": "YouTubeサムネイル・ヘッダー", "description": "目を引くサムネイルやブログヘッダー画像"},
      {"label": "説明図・図解・比較図", "description": "概念を視覚的に説明する画像"},
      {"label": "アイコン・ステッカー（透過）", "description": "背景なしの単体オブジェクト"},
      {"label": "テキスト入り画像", "description": "正確なテキスト描画が必要な画像"}
    ],
    "multiSelect": false
  }]
}
```

### Step 0.5: 図種サジェストテーブル（「説明図・図解」を選んだ場合）

ユーザーが「説明図・図解・比較図」を選んだ、または「〇〇を図にして」「〇〇を可視化して」「〇〇を1枚にまとめて」等の入力をした場合、
以下の判定テーブルから**伝えたい内容に最も近い行を1つ選び**、推奨図種 top3 を AskUserQuestion で提示する。

| 伝えたい内容（ユーザー文脈） | 推奨図種 top3 | 推奨ツール |
|---|---|---|
| 論文・記事の要点を1枚に凝縮 | ビジュアルアブストラクト / インフォグラフィック / ワンページャー | `generate_rich.py --mode graphrec` |
| 処理・意思決定の流れ・手順 | フローチャート / シーケンス図 / 状態遷移図 | **mermaid-to-webp**（記法が正確） |
| 担当者別の業務フロー | スイムレーン図 / BPMN / フローチャート | mermaid-to-webp |
| 時系列・スケジュール | タイムライン / ガントチャート / カスタマージャーニー | ガント=mermaid / 他=`generate_rich.py --mode process` |
| 階層・分解構造 | ロジックツリー / マインドマップ / 組織図 | mermaid-to-webp（mindmap/flowchart） |
| 概念の優先度・段階 | ピラミッド図 / マトリクス図 / ロジックツリー | `generate_rich.py --mode comparison` |
| 集合・重なり・関係性 | ベン図 / 概念図 / ネットワーク図 | `generate_rich.py --mode comparison` |
| 比較・評価軸（4象限/SWOT） | マトリクス図 / レーダーチャート / 比較表 | `generate_rich.py --mode comparison` |
| データベース構造 | ER図 | **mermaid-to-webp** |
| システム・モジュール構成 | アーキテクチャ図 / シーケンス図 / ネットワーク図 | アーキ=`generate_rich.py` / シーケンス=mermaid |
| 数値データの可視化 | 棒/折/円グラフ / ヒートマップ / ツリーマップ | mermaid (xychart) または matplotlib |
| 流量・遷移・絞り込み | サンキー / ファネル / フロー図 | サンキー=mermaid / ファネル=`generate_rich.py` |
| 事業戦略フレーム | ビジネスモデルキャンバス / バリューチェーン / ピラミッド | `generate_rich.py --mode comparison` |
| 体験・ストーリー | カスタマージャーニー / タイムライン / プロセス図 | `generate_rich.py --mode process` |

**判定ルール**:
- **構造記法系**（フロー/シーケンス/ER/ガント/組織図など）→ 図形の正確性が重要なため `mermaid-to-webp` プラグインへルーティング
- **ビジュアル発信系**（ビジュアルアブストラクト/インフォグラフィック/BMC/ジャーニーなど）→ レイアウト自由度が重要なため `generate_rich.py` を使用
- 迷ったら「両方のサンプルを見たいか」を確認してから絞る

**AskUserQuestion 実装例**:
```json
{
  "questions": [{
    "question": "どの図種で表現しますか？（top3を提示）",
    "header": "図種",
    "options": [
      {"label": "ビジュアルアブストラクト", "description": "1枚に要点を凝縮（generate_rich）"},
      {"label": "インフォグラフィック", "description": "情報を視覚統合（generate_rich）"},
      {"label": "フローチャート", "description": "正確な記法で描画（mermaid-to-webp）"}
    ],
    "multiSelect": false
  }]
}
```

---

**Step 1A: サムネイルのスタイル確認**
```json
{
  "questions": [
    {
      "question": "サムネイルのスタイルはどれがいいですか？",
      "header": "スタイル",
      "options": [
        {"label": "アニメ風（推奨）", "description": "目を引くアニメ調のデザイン"},
        {"label": "ビジネス風", "description": "フォーマルで信頼感のあるデザイン"},
        {"label": "写真風", "description": "リアリスティックな写真調"}
      ],
      "multiSelect": false
    },
    {
      "question": "キャラクターを入れますか？",
      "header": "キャラ",
      "options": [
        {"label": "入れる", "description": "キャラクターを含めたデザイン"},
        {"label": "入れない", "description": "テキストと背景のみ"}
      ],
      "multiSelect": false
    }
  ]
}
```

**Step 1B: シンプル画像の詳細確認**
```json
{
  "questions": [{
    "question": "画像の特殊な要件はありますか？",
    "header": "要件",
    "options": [
      {"label": "透過背景が必要（推奨: OpenAI）", "description": "背景なしのPNG画像が必要"},
      {"label": "参照画像のスタイルをコピー", "description": "既存画像のスタイルを維持"},
      {"label": "複数枚同時生成", "description": "同じプロンプトで複数枚生成"},
      {"label": "特になし", "description": "通常の画像生成"}
    ],
    "multiSelect": true
  }]
}
```

---

## Step 1A: リッチ画像（サムネイル・説明図）

`generate_rich.py` を使用。10のテンプレートモードから最適なものを選択。

### 追加で確認する項目（AskUserQuestion）

**サムネイル（thumbnail）の場合:**

| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **スタイル** | アニメ風 / ビジネス風 / 写真風 | 全体の雰囲気 |
| **雰囲気**（アニメ風の場合） | 驚き(wow) / インパクト / ポップ / 明るい | 細分化 |
| **キャラクター** | あり / なし | キャラを含めるか |
| **キャラプリセット**（ありの場合） | idol / vtuber / business / tech / teacher | プリセット選択 |

**説明図（illustration）の場合:**

| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **タイプ** | 図解(graphrec) / 比較(comparison) / プロセス(process) / カスタム | 説明図のスタイル |

### モード自動判定表

| ユースケース | スタイル | モード | コマンド例 |
|-------------|---------|--------|-----------|
| YouTubeサムネ（楽しい系） | アニメ風・驚き | `anime-wow` | `--mode anime-wow` |
| YouTubeサムネ（技術系） | アニメ風・明るい | `anime-bright` | `--mode anime-bright` |
| YouTubeサムネ（エンタメ） | アニメ風・ポップ | `anime-pop` | `--mode anime-pop` |
| YouTubeサムネ（インパクト） | アニメ風・強い | `anime-impact` | `--mode anime-impact` |
| ビジネスプレゼン | ビジネス風 | `formal-default` | `--mode formal-default` |
| 写真風サムネ | 写真風 | `real-default` | `--mode real-default` |
| 説明図・図解 | - | `graphrec` | `--pattern illustration --mode graphrec` |
| 比較・対比図 | - | `comparison` | `--pattern illustration --mode comparison` |
| プロセス・手順図 | - | `process` | `--pattern illustration --mode process` |

---

## Step 1B: シンプル画像（アイコン・イラスト）

`generate.py` または `generate_openai.py` を使用。

### 追加で確認する項目（AskUserQuestion）

| 項目 | 選択肢 | 推奨ツール |
|------|--------|-----------|
| **透過背景が必要** | はい | `generate_openai.py -b transparent` |
| **参照画像のスタイルをコピー** | はい | `generate.py -r <参照画像>` |
| **複数枚同時生成** | はい | `generate_openai.py -n <枚数>` |
| **上記いずれでもない** | - | `generate.py`（デフォルト） |

### プロバイダー自動選択表

| 条件 | プロバイダー | ツール | 理由 |
|------|-------------|--------|------|
| 透過背景必須 | OpenAI | `generate_openai.py` | ネイティブ透過サポート |
| 参照画像あり | Gemini | `generate.py` | スタイルコピーに強い |
| 複数枚同時生成 | OpenAI | `generate_openai.py` | `-n` オプション対応 |
| 日本語プロンプト | Gemini | `generate.py` | 日本語理解に強い |
| デフォルト | Gemini | `generate.py` | バランスが良い |

---

## Step 1C: テキスト入り画像（GLM-Image）

`generate_zhipu.py` を使用。テキスト描画精度91.16%。

### 推奨ユースケース

- バナー・看板のテキスト
- タイトルカード・ロゴ風画像
- 日本語・中国語のテキスト描画
- 低コスト大量生成（$0.015/枚）

### 追加で確認する項目（AskUserQuestion）

| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **アスペクト比** | 正方形 / 横長 / 縦長 / ワイド | サイズ選択 |
| **品質** | HD / Standard | 品質 vs 速度のトレードオフ |

---

## Step 2: 詳細オプション確認（必要に応じて）

Step 0〜1 でツールが決まった後、追加で詳細を確認する場合に参照。

### 確認項目

**共通（常に確認）:**
| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **プロバイダー** | `gemini` / `openai` / `glm-image` | 使用するAIプロバイダー |
| **モデル** | Gemini: `pro`/`flash`、OpenAI: `gpt-image-2`/`gpt-image-1.5`/`gpt-image-1`/`gpt-image-1-mini`、GLM-Image: `glm-image` | 詳細は下記参照 |
| **参照画像** | あり / なし | スタイルをコピーする元画像があるか |
| **背景除去** | Vision API / マゼンタ除去 / OpenAI透過 / 不要 | 方法は下記参照 |

**複数画像生成の場合のみ追加で確認:**
| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **生成方式** | シート→split / 並列生成 | シート→split推奨（効率的） |

### プロバイダー別の特徴

| プロバイダー | 強み | APIキー環境変数 |
|-------------|------|----------------|
| **Gemini** | 日本語プロンプト、参照画像のスタイルコピー | `GEMINI_API_KEY` |
| **OpenAI** | 高品質、ネイティブ透過背景対応、複数枚同時生成 | `OPENAI_API_KEY` |
| **GLM-Image** | テキスト描画精度91.16%、日本語・中国語プロンプト、低コスト | `GLM_API_KEY` or `ZAI_API_KEY` |
| **fal.ai** | Geminiフォールバック、GPT Image 1.5 | `FAL_AI_API_KEY` |

### モデル比較

**Gemini (Nano Banana):**
| モデル | ID | ブランド名 | 特徴 |
|-------|-----|-----------|------|
| NB2 | `gemini-3.1-flash-image-preview` | Nano Banana 2 | **推奨** Pro品質+Flash速度、参照画像10枚、thinking制御（Preview） |
| Flash | `gemini-2.5-flash-image` | Nano Banana | 高速、コスト効率、最安定（GA） |
| Pro | `gemini-3-pro-image-preview` | Nano Banana Pro | 最高品質、キャラクター一貫性（Preview） |

**OpenAI:**
| モデル | ID | 特徴 |
|-------|-----|------|
| GPT Image 2 | `gpt-image-2` | **推奨** 最新・最高品質、テキスト描画大幅向上、柔軟なサイズ（透過背景未対応） |
| GPT Image 2 (snapshot) | `gpt-image-2-2026-04-21` | 固定スナップショット版 |
| GPT Image 1.5 | `gpt-image-1.5` | 透過背景対応、`-b transparent`時の自動フォールバック先 |
| GPT Image 1 | `gpt-image-1` | 旧モデル |
| GPT Image Mini | `gpt-image-1-mini` | 軽量・高速・低コスト |

> **gpt-image-2 の制約**: `background=transparent` 非対応。透過要求時は自動的に `gpt-image-1.5` にフォールバック（生成自体は成功）。

**GLM-Image (ZhipuAI):**
| モデル | ID | 特徴 |
|-------|-----|------|
| GLM-Image | `glm-image` | 16Bパラメータ、テキスト描画精度91.16%、$0.015/枚 |

### 背景除去方法の選び方

| 方法 | 適したケース | プロバイダー |
|------|-------------|-------------|
| **OpenAI透過** | OpenAI使用時は`--background transparent`で直接透過生成 | OpenAI専用 |
| **Vision API** | 実写画像、写真風、複雑な背景、グラデーション背景 | Gemini |
| **マゼンタ除去** | イラスト、シンプルな図形、線画、フラットデザイン | Gemini |

### 推奨設定

| ケース | プロバイダー | モデル | 背景除去 |
|--------|-------------|--------|----------|
| 汎用・高品質画像生成 | Gemini / OpenAI | nb2 / gpt-image-2 | 不要 or Vision API |
| 透過アイコン・ステッカー | OpenAI | gpt-image-1.5 | `--background transparent` |
| 参照画像のスタイルコピー | Gemini | nb2 / pro | Vision API |
| シンプルなイラスト | Gemini | flash | マゼンタ除去 |
| 高品質イラスト | Gemini / OpenAI | nb2 / gpt-image-2 | 不要 |
| テキスト描画重視（英語） | OpenAI | gpt-image-2 | 不要 |
| プロトタイプ・テスト | OpenAI | gpt-image-1-mini | 不要 |
| テキスト入り画像（日中） | GLM-Image | glm-image | 不要 |
| 日本語/中国語重視 | GLM-Image | glm-image | 不要 |
| 低コスト大量生成 | GLM-Image | glm-image | 不要 |

---

## ツール一覧

| ツール | 説明 |
|-------|------|
| `generate.py` | Gemini画像生成 |
| `generate_rich.py` | パターン/モード対応リッチ画像生成（Gemini） |
| `generate_openai.py` | OpenAI画像生成 |
| `generate_zhipu.py` | GLM-Image画像生成（ZhipuAI） |
| `remove-bg-magenta.py` | マゼンタ背景除去（1px収縮含む） |
| `remove-bg-vision.py` | Vision API背景除去 |
| `erode.py` | 透過画像エッジ収縮 |
| `split_transparent.py` | 透過画像を個別オブジェクトに分割 |

## 前提条件

1. **uv**: `curl -LsSf https://astral.sh/uv/install.sh | sh` でインストール
2. **Gemini使用時**: 環境変数 `GEMINI_API_KEY` を設定
3. **OpenAI使用時**: 環境変数 `OPENAI_API_KEY` を設定
4. **GLM-Image使用時**: 環境変数 `GLM_API_KEY` または `ZAI_API_KEY` を設定（https://z.ai で取得）
5. **Vision API**: macOS 14.0 (Sonoma) 以降が必要

---

## 1. generate.py - Gemini画像生成

```bash
uv run --with google-genai --with pillow scripts/generate.py "プロンプト" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力ファイルパス | `generated_image.png` |
| `-a`, `--aspect-ratio` | アスペクト比 (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `1:4`, `4:1`) | `1:1` |
| `-m`, `--model` | モデル (`nb2`, `flash`, `pro`) | `nb2` |
| `--magenta-bg` | マゼンタ背景で生成 | なし |
| `-r`, `--reference` | 参照画像のパス | なし |
| `--no-fallback` | フォールバックを無効化 | なし |

### 耐障害性

- **リトライ**: 503/429/408エラー時、最大2回の指数バックオフリトライ（10秒→20秒）。504は即座にフォールバック
- **フォールバックチェーン**: Pro→**OpenAI gpt-image-2**→NB2→fal.ai→Flash、NB2→**OpenAI gpt-image-2**→fal.ai→Flash の自動フォールバック（`--no-fallback`で無効化可能）
- **OpenAIフォールバック**: `OPENAI_API_KEY` 環境変数が設定されている場合、Gemini Pro/NB2 障害時に第1優先で OpenAI gpt-image-2 へフォールバック。参照画像指定時は edit API のインターフェース差異のためスキップ。未設定時はスキップして次の候補へ
- **fal.aiフォールバック**: `FAL_AI_API_KEY` 環境変数が設定されている場合、OpenAI もスキップされた際に fal.ai（GPT Image 1.5）へフォールバック
- **モデル別タイムアウト**: NB2/Pro=300秒、Flash=600秒、OpenAI=180秒、fal.ai=120秒

> **Note**: NB2 (`gemini-3.1-flash-image-preview`) と Pro (`gemini-3-pro-image-preview`) はPreview段階のモデルであり、サーバー過負荷による503/504エラーが発生することがあります。フォールバックチェーンにより、上位モデルが応答しない場合はfal.ai→Flashの順に自動フォールバックされます。最高の安定性が必要な場合はFlashモデル（GA）を直接指定してください。

### 例

```bash
# シンプルな生成
uv run --with google-genai --with pillow scripts/generate.py "かわいい猫のイラスト"

# 参照画像のスタイルをコピー
uv run --with google-genai --with pillow scripts/generate.py "Same exact style as this image. Object: coffee cup. NO text." -r reference.png -o coffee.png

# マゼンタ背景で生成（後で透過処理用）
uv run --with google-genai --with pillow scripts/generate.py "シンプルな星のアイコン" --magenta-bg -o star.png
```

---

## 1.5. generate_rich.py - パターン/モード対応リッチ画像生成

10のテンプレートモードでサムネイルや説明画像を簡単に生成。Gemini API専用。

```bash
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py --prompt "入力" --output output.png [オプション]
```

### パターン/モード判定表

| パターン | モード | 用途 |
|---------|-------|------|
| **thumbnail** | `anime-wow` | アニメ風・驚き表現のサムネイル |
| | `anime-impact` | アニメ風・インパクト重視 |
| | `anime-pop` | アニメ風・ポップで明るい |
| | `anime-bright` | アニメ風・鮮やかで清潔感 |
| | `formal-default` | ビジネス・フォーマル向け |
| | `real-default` | 写真風リアリスティック |
| **illustration** | `comparison` | 比較・対比の説明画像 |
| | `graphrec` | 図解・グラフィックレコーディング風 |
| | `process` | プロセス・フロー図 |
| | `custom` | カスタムプロンプト自由形式 |

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--prompt`, `-p` | 入力テキストまたはJSON | **必須** |
| `--output`, `-o` | 出力ファイルパス | `generated_rich.png` |
| `--pattern` | `thumbnail` / `illustration` | `thumbnail` |
| `--mode` | 上記モード名 | `anime-wow` |
| `--aspect`, `-a` | アスペクト比 (`16:9`, `1:1`, `9:16`, `4:3`, `3:4`, `21:9`) | モードに応じて自動 |
| `--model`, `-m` | `pro` / `flash` | `pro` |
| `--character-preset`, `-c` | キャラクタープリセット（下記参照） | なし |
| `--ref-image` | 参照画像のパス | なし |
| `--ref-search` | SerpAPIで参照画像検索（`SERPAPI_KEY`必要） | なし |
| `--ref-instruction` | 参照画像への追加指示 | なし |
| `--list-modes` | パターン/モード一覧表示 | - |
| `--list-presets` | キャラクタープリセット一覧表示 | - |

### キャラクタープリセット

`character` を JSON で明示しない場合に適用されるプリセット。

| プリセット | 説明 |
|-----------|------|
| `default` | 汎用キャラクター |
| `idol` | アイドル風キャラクター（衣装・アクセサリ・エネルギッシュ） |
| `vtuber` | VTuber風キャラクター（カラフル髪・配信セットアップ） |
| `business` | ビジネス・フォーマル風キャラクター |
| `tech` | テック・エンジニア風キャラクター |
| `teacher` | 講師・解説者風キャラクター |
| `mascot` | マスコット風キャラクター（デフォルメ・丸み・ブランドキャラ風） |
| `cool` | クール系キャラクター（鋭い目つき・ダークカラー・ミステリアス） |

### 入力形式

**JSON入力**（テンプレート変数を個別指定）:
```bash
--prompt '{"title": "Claude Code完全攻略", "subtitle": "初心者向けガイド"}'
```

**テキスト入力**（自動的にtitle/contentに割り当て）:
```bash
--prompt "プログラミング入門ガイド"
```

### 例

```bash
# anime-wow モードでサムネイル
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py \
  --output /tmp/wow.png \
  --prompt '{"title": "Claude Code完全攻略"}' \
  --pattern thumbnail --mode anime-wow

# graphrec モードで図解
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py \
  --output /tmp/graphrec.png \
  --prompt '{"content": "AI駆動開発の3つの原則", "title": "AI開発入門"}' \
  --pattern illustration --mode graphrec

# フォーマル・ビジネス向け
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py \
  --output /tmp/formal.png \
  --prompt '{"title": "Q4業績レポート", "subtitle": "2026年度"}' \
  --mode formal-default

# テキスト直接指定（自動テンプレート適用）
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py \
  --output /tmp/simple.png \
  --prompt "プログラミング入門ガイド"

# 利用可能なモード一覧
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py --list-modes

# アイドルプリセットでサムネイル
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py \
  --output /tmp/idol.png \
  --prompt '{"title": "RUNA", "subtitle": "〜Next Melody〜"}' \
  --mode anime-wow --character-preset idol

# キャラクタープリセット一覧
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py --list-presets
```

---

## 2. generate_openai.py - OpenAI画像生成

```bash
uv run --with openai --with pillow scripts/generate_openai.py "プロンプト" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力ファイルパス | `generated_image.png` |
| `-s`, `--size` | サイズ (`1024x1024`, `1536x1024`, `1024x1536`, `auto`) | `1024x1024` |
| `-m`, `--model` | モデル (`gpt-image-2`, `gpt-image-2-2026-04-21`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`) | `gpt-image-2` |
| `-q`, `--quality` | 品質 (`low`, `medium`, `high`) | `medium` |
| `-b`, `--background` | 背景 (`transparent`, `opaque`, `auto`) | `auto` |
| `-f`, `--format` | 出力形式 (`png`, `jpeg`, `webp`) | `png` |
| `-r`, `--reference` | 編集する画像のパス | なし |
| `-n`, `--number` | 生成枚数 (1-10) | `1` |

### 例

```bash
# シンプルな生成
uv run --with openai --with pillow scripts/generate_openai.py "かわいい猫のイラスト"

# 透過背景で生成（背景除去不要）
uv run --with openai --with pillow scripts/generate_openai.py "シンプルな星のアイコン" -b transparent -o star.png

# 高品質・横長で生成
uv run --with openai --with pillow scripts/generate_openai.py "夕焼けの風景" -s 1536x1024 -q high -o sunset.png

# 複数枚同時生成
uv run --with openai --with pillow scripts/generate_openai.py "かわいい動物のアイコン" -n 5 -b transparent -o animals.png

# 画像編集
uv run --with openai --with pillow scripts/generate_openai.py "背景を夜空に変更" -r input.png -o edited.png
```

---

## 3. generate_zhipu.py - GLM-Image画像生成（ZhipuAI）

```bash
uv run --with requests --with pillow scripts/generate_zhipu.py "プロンプト" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力ファイルパス | `generated_image.png` |
| `-s`, `--size` | 画像サイズ（推奨7種） | `1280x1280` |
| `-q`, `--quality` | 品質 (`hd`, `standard`) | `hd` |

### 推奨サイズ

| サイズ | アスペクト比 |
|--------|-------------|
| `1280x1280` | 正方形 |
| `1568x1056` | 横長 |
| `1056x1568` | 縦長 |
| `1472x1088` | 横長 |
| `1088x1472` | 縦長 |
| `1728x960` | ワイド |
| `960x1728` | トール |

### 例

```bash
# シンプルな生成
uv run --with requests --with pillow scripts/generate_zhipu.py "かわいい猫のイラスト"

# 横長サイズで技術図解
uv run --with requests --with pillow scripts/generate_zhipu.py "技術文書の図解" -s 1568x1056 -o diagram.png

# 高速生成（standard品質）
uv run --with requests --with pillow scripts/generate_zhipu.py "ロゴデザイン" -q standard -o logo.png
```

---

## 4. remove-bg-magenta.py - マゼンタ背景除去

マゼンタ/ピンク背景を色ベースで透過にする。

```bash
uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py 入力画像 [-o 出力画像]
```

### 仕組み
- R>180, G<100, B>100 の色を透過
- 1px収縮でエッジのピンク残りを除去

---

## 5. remove-bg-vision.py - Vision API背景除去

macOS Vision APIで背景を自動検出して透過にする。

```bash
python3 scripts/remove-bg-vision.py 入力画像 [-o 出力画像]
```

> Note: このスクリプトは内部で`remove-bg.swift`を呼び出すため、追加依存なしで動作。

### 特徴
- 前景を自動検出
- 参照画像のスタイル（背景含む）を維持した画像に最適
- macOS 14.0以降が必要

---

## 6. erode.py - エッジ収縮

透過画像のエッジを任意のピクセル数だけ収縮する。

```bash
uv run --with pillow --with numpy --with scipy scripts/erode.py 入力画像 [-o 出力画像] [-i 収縮量]
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力画像パス | 入力を上書き |
| `-i`, `--iterations` | 収縮量（ピクセル数） | `1` |

---

## 7. split_transparent.py - 透過画像分割

透過PNGを個別オブジェクトに分割（ステッカーシート用）。

```bash
uv run --with opencv-python --with numpy scripts/split_transparent.py 入力画像 [出力ディレクトリ]
```

### 仕組み
- アルファチャンネル（透明部分）で境界を検出
- 連結成分ごとに切り出し
- 左上→右下の順で番号付け

---

## ワークフロー例

### OpenAI: 透過アイコン生成（推奨・最も簡単）

```bash
# 1ステップで透過PNG生成
uv run --with openai --with pillow scripts/generate_openai.py "シンプルな星のアイコン" -b transparent -o star.png
```

### OpenAI: 複数アイコン同時生成

```bash
# 5枚同時に透過PNG生成
uv run --with openai --with pillow scripts/generate_openai.py "かわいい動物のアイコン、1つの動物" -n 5 -b transparent -o animal.png
# → animal_01.png, animal_02.png, ... が生成される
```

### GLM-Image: テキスト入り画像生成

```bash
# テキスト描画精度91.16%で文字入りの画像を生成
uv run --with requests --with pillow scripts/generate_zhipu.py "「祝・開店」と書かれた和風バナー" -o banner.png

# 高速生成（standard品質）
uv run --with requests --with pillow scripts/generate_zhipu.py "技術ブログのヘッダー画像" -s 1728x960 -q standard -o header.png
```

### Gemini: 透過ステッカー生成（単純なオブジェクト）

```bash
# 1. マゼンタ背景で生成
uv run --with google-genai --with pillow scripts/generate.py "シンプルな星のアイコン" --magenta-bg -o star.png

# 2. マゼンタ除去
uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py star.png
```

### Gemini: 参照画像スタイルコピー + 透過

```bash
# 1. 参照画像のスタイルで生成（スタイル維持のためマゼンタ指定なし）
uv run --with google-genai --with pillow scripts/generate.py "Same exact style as this image. Object: coffee cup. NO text." -r reference.png -o coffee.png

# 2. Vision APIで背景除去
python3 scripts/remove-bg-vision.py coffee.png
```

### Gemini: ステッカーシート生成 → 分割

```bash
# 1. マゼンタ背景で複数ステッカー生成
uv run --with google-genai --with pillow scripts/generate.py \
  "Multiple separate kawaii stickers with LARGE gaps: coffee cup, donut, cat, star. Arranged in 2x2 grid, well separated." \
  --magenta-bg -o sheet.png

# 2. 背景透過
uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py sheet.png

# 3. 個別分割
uv run --with opencv-python --with numpy scripts/split_transparent.py sheet.png ./stickers/
```

**プロンプトのコツ:**
- `LARGE gaps between them` - 間隔を広く
- `well separated` - 重ならないように
- `Arranged in XxY grid` - グリッド配置指定

---

## ファイル構成

```
image-creator/
├── SKILL.md                   # このドキュメント
├── config/
│   └── rich_patterns.json     # リッチ画像テンプレート設定（9モード）
└── scripts/
    ├── generate.py            # Gemini画像生成
    ├── generate_rich.py       # パターン/モード対応リッチ画像生成
    ├── template_engine.py     # Mustache風テンプレートエンジン
    ├── generate_openai.py     # OpenAI画像生成
    ├── generate_zhipu.py      # GLM-Image画像生成（ZhipuAI）
    ├── remove-bg-magenta.py   # マゼンタ背景除去（1px収縮含む）
    ├── remove-bg-vision.py    # Vision API背景除去
    ├── remove-bg.swift        # Vision API実装（Swift）
    ├── erode.py               # エッジ収縮（単体）
    └── split_transparent.py   # 透過画像分割
```
