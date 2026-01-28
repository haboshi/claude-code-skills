---
name: image-creator
description: Google GeminiまたはOpenAI GPT Imageの画像生成モデルで画像を生成・編集。「画像を生成して」「イラストを作って」「この画像を編集して」などの指示で自動的に使用される。「ステッカーを何個か作って」「複数のアイコンを生成して分割」などステッカーシート生成・分割にも対応。GeminiとOpenAIの2つのプロバイダーから選択可能。
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Image Creator - AI画像生成スキル

Google Gemini または OpenAI GPT Image を使用して画像を生成・編集するスキル。

---

## 生成前の確認フロー

**重要**: 画像生成を開始する前に、必ず `AskUserQuestion` ツールで以下を確認すること。

### 確認項目

**共通（常に確認）:**
| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **プロバイダー** | `gemini` / `openai` | 使用するAIプロバイダー |
| **モデル** | Gemini: `pro`/`flash`、OpenAI: `1.5`/`1`/`mini` | 詳細は下記参照 |
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

### モデル比較

**Gemini:**
| モデル | ID | 特徴 |
|-------|-----|------|
| Flash | `gemini-2.5-flash-image` | 高速、コスト効率 |
| Pro | `gemini-3-pro-image-preview` | 高品質、複雑な指示に対応 |

**OpenAI:**
| モデル | ID | 特徴 |
|-------|-----|------|
| GPT Image 1.5 | `gpt-image-1.5` | 最新・最高品質（推奨） |
| GPT Image 1 | `gpt-image-1` | 標準モデル |
| GPT Image Mini | `gpt-image-1-mini` | 軽量・高速・低コスト |

### 背景除去方法の選び方

| 方法 | 適したケース | プロバイダー |
|------|-------------|-------------|
| **OpenAI透過** | OpenAI使用時は`--background transparent`で直接透過生成 | OpenAI専用 |
| **Vision API** | 実写画像、写真風、複雑な背景、グラデーション背景 | Gemini |
| **マゼンタ除去** | イラスト、シンプルな図形、線画、フラットデザイン | Gemini |

### 推奨設定

| ケース | プロバイダー | モデル | 背景除去 |
|--------|-------------|--------|----------|
| 透過アイコン・ステッカー | OpenAI | 1.5 | `--background transparent` |
| 参照画像のスタイルコピー | Gemini | pro | Vision API |
| シンプルなイラスト | Gemini | flash | マゼンタ除去 |
| 高品質イラスト | OpenAI | 1.5 | 不要 or transparent |
| プロトタイプ・テスト | OpenAI | mini | 不要 |

---

## ツール一覧

| ツール | 説明 |
|-------|------|
| `generate.py` | Gemini画像生成 |
| `generate_openai.py` | OpenAI画像生成 |
| `remove-bg-magenta.py` | マゼンタ背景除去（1px収縮含む） |
| `remove-bg-vision.py` | Vision API背景除去 |
| `erode.py` | 透過画像エッジ収縮 |
| `split_transparent.py` | 透過画像を個別オブジェクトに分割 |

## 前提条件

1. **uv**: `curl -LsSf https://astral.sh/uv/install.sh | sh` でインストール
2. **Gemini使用時**: 環境変数 `GEMINI_API_KEY` を設定
3. **OpenAI使用時**: 環境変数 `OPENAI_API_KEY` を設定
4. **Vision API**: macOS 14.0 (Sonoma) 以降が必要

---

## 1. generate.py - Gemini画像生成

```bash
uv run --with google-genai --with pillow scripts/generate.py "プロンプト" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力ファイルパス | `generated_image.png` |
| `-a`, `--aspect-ratio` | アスペクト比 (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`) | `1:1` |
| `-m`, `--model` | モデル (`flash`, `pro`) | `pro` |
| `--magenta-bg` | マゼンタ背景で生成 | なし |
| `-r`, `--reference` | 参照画像のパス | なし |

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

## 2. generate_openai.py - OpenAI画像生成

```bash
uv run --with openai --with pillow scripts/generate_openai.py "プロンプト" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力ファイルパス | `generated_image.png` |
| `-s`, `--size` | サイズ (`1024x1024`, `1536x1024`, `1024x1536`, `auto`) | `1024x1024` |
| `-m`, `--model` | モデル (`gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`) | `gpt-image-1.5` |
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

## 3. remove-bg-magenta.py - マゼンタ背景除去

マゼンタ/ピンク背景を色ベースで透過にする。

```bash
uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py 入力画像 [-o 出力画像]
```

### 仕組み
- R>180, G<100, B>100 の色を透過
- 1px収縮でエッジのピンク残りを除去

---

## 4. remove-bg-vision.py - Vision API背景除去

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

## 5. erode.py - エッジ収縮

透過画像のエッジを任意のピクセル数だけ収縮する。

```bash
uv run --with pillow --with numpy --with scipy scripts/erode.py 入力画像 [-o 出力画像] [-i 収縮量]
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力画像パス | 入力を上書き |
| `-i`, `--iterations` | 収縮量（ピクセル数） | `1` |

---

## 6. split_transparent.py - 透過画像分割

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
├── SKILL.md               # このドキュメント
└── scripts/
    ├── generate.py            # Gemini画像生成
    ├── generate_openai.py     # OpenAI画像生成
    ├── remove-bg-magenta.py   # マゼンタ背景除去（1px収縮含む）
    ├── remove-bg-vision.py    # Vision API背景除去
    ├── remove-bg.swift        # Vision API実装（Swift）
    ├── erode.py               # エッジ収縮（単体）
    └── split_transparent.py   # 透過画像分割
```
