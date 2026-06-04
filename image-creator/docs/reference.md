# Image Creator - 詳細リファレンス

`SKILL.md` の補完リソース。ルーティング・デフォルト設定・判定ロジックは `SKILL.md` を参照。本ファイルは各スクリプトの詳細CLI、全モデルID、完全なワークフロー例を記載。

---

## モデル一覧（完全版）

### Gemini (Nano Banana)

| モデル | ID | ブランド名 | 特徴 |
|---|---|---|---|
| NB2 | `gemini-3.1-flash-image-preview` | Nano Banana 2 | **推奨** Pro品質+Flash速度、参照画像10枚、thinking制御（Preview） |
| Flash | `gemini-2.5-flash-image` | Nano Banana | 高速、コスト効率、最安定（GA） |
| Pro | `gemini-3-pro-image-preview` | Nano Banana Pro | 最高品質、キャラクター一貫性（Preview） |

### OpenAI

| モデル | ID | 特徴 |
|---|---|---|
| GPT Image 2 | `gpt-image-2` | **推奨** 最新・最高品質、テキスト描画大幅向上、柔軟なサイズ（透過背景未対応） |
| GPT Image 2 (snapshot) | `gpt-image-2-2026-04-21` | 固定スナップショット版 |
| GPT Image 1.5 | `gpt-image-1.5` | 透過背景対応、`-b transparent`時の自動フォールバック先 |
| GPT Image 1 | `gpt-image-1` | 旧モデル |
| GPT Image Mini | `gpt-image-1-mini` | 軽量・高速・低コスト |

> **gpt-image-2 の制約**: `background=transparent` 非対応。透過要求時は自動的に `gpt-image-1.5` にフォールバック（生成自体は成功）。

### GLM-Image (ZhipuAI)

| モデル | ID | 特徴 |
|---|---|---|
| GLM-Image | `glm-image` | 16Bパラメータ、テキスト描画精度91.16%、$0.015/枚 |

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

### 例

```bash
# シンプルな生成
uv run --with google-genai --with pillow scripts/generate.py "かわいい猫のイラスト"

# 参照画像のスタイルをコピー
uv run --with google-genai --with pillow scripts/generate.py \
  "Same exact style as this image. Object: coffee cup. NO text." \
  -r reference.png -o coffee.png

# マゼンタ背景で生成（後で透過処理用）
uv run --with google-genai --with pillow scripts/generate.py \
  "シンプルな星のアイコン" --magenta-bg -o star.png
```

---

## 2. generate_rich.py - パターン/モード対応リッチ画像生成

10のテンプレートモードでサムネイル・説明画像を生成。Gemini API専用。

```bash
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py --prompt "入力" --output output.png [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--prompt`, `-p` | 入力テキストまたはJSON | **必須** |
| `--output`, `-o` | 出力ファイルパス | `generated_rich.png` |
| `--pattern` | `thumbnail` / `illustration` | `thumbnail` |
| `--mode` | モード名（下記参照） | `anime-wow` |
| `--aspect`, `-a` | アスペクト比 (`16:9`, `1:1`, `9:16`, `4:3`, `3:4`, `21:9`) | モードに応じて自動 |
| `--model`, `-m` | `pro` / `flash` | `pro` |
| `--character-preset`, `-c` | キャラクタープリセット | なし |
| `--ref-image` | 参照画像のパス | なし |
| `--ref-search` | SerpAPIで参照画像検索（`SERPAPI_KEY`必要） | なし |
| `--ref-instruction` | 参照画像への追加指示 | なし |
| `--list-modes` | パターン/モード一覧表示 | - |
| `--list-presets` | キャラクタープリセット一覧表示 | - |

### キャラクタープリセット詳細

| プリセット | 説明 |
|-----------|------|
| `default` | 汎用キャラクター |
| `idol` | アイドル風（衣装・アクセサリ・エネルギッシュ） |
| `vtuber` | VTuber風（カラフル髪・配信セットアップ） |
| `business` | ビジネス・フォーマル風 |
| `tech` | テック・エンジニア風 |
| `teacher` | 講師・解説者風 |
| `mascot` | マスコット風（デフォルメ・丸み・ブランドキャラ風） |
| `cool` | クール系（鋭い目つき・ダークカラー・ミステリアス） |

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

# アイドルプリセットでサムネイル
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py \
  --output /tmp/idol.png \
  --prompt '{"title": "RUNA", "subtitle": "〜Next Melody〜"}' \
  --mode anime-wow --character-preset idol

# 一覧確認
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py --list-modes
uv run --with google-genai --with pillow --with requests \
  scripts/generate_rich.py --list-presets
```

---

## 3. generate_openai.py - OpenAI画像生成

```bash
uv run --with openai --with pillow scripts/generate_openai.py "プロンプト" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力ファイルパス | `generated_image.png` |
| `-s`, `--size` | サイズ（基本: `1024x1024`, `1536x1024`, `1024x1536` / 2K: `2048x2048`, `2048x1152` / 4K: `3840x2160`, `2160x3840` / `auto`。2K・4Kは gpt-image-2 のみ） | `1024x1024` |
| `-m`, `--model` | モデル (`gpt-image-2`, `gpt-image-2-2026-04-21`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`) | `gpt-image-2` |
| `-q`, `--quality` | 品質 (`low`, `medium`, `high`, `auto`) | `medium` |
| `-b`, `--background` | 背景 (`transparent`, `opaque`, `auto`) | `auto` |
| `-f`, `--format` | 出力形式 (`png`, `jpeg`, `webp`) | `png` |
| `-r`, `--reference` | 編集する画像のパス | なし |
| `-n`, `--number` | 生成枚数 (1-10) | `1` |

### 例

```bash
# シンプルな生成
uv run --with openai --with pillow scripts/generate_openai.py "かわいい猫のイラスト"

# 透過背景で生成（背景除去不要）
uv run --with openai --with pillow scripts/generate_openai.py \
  "シンプルな星のアイコン" -b transparent -o star.png

# 高品質・横長で生成
uv run --with openai --with pillow scripts/generate_openai.py \
  "夕焼けの風景" -s 1536x1024 -q high -o sunset.png

# 複数枚同時生成
uv run --with openai --with pillow scripts/generate_openai.py \
  "かわいい動物のアイコン" -n 5 -b transparent -o animals.png

# 画像編集
uv run --with openai --with pillow scripts/generate_openai.py \
  "背景を夜空に変更" -r input.png -o edited.png
```

---

## 4. generate_zhipu.py - GLM-Image画像生成（ZhipuAI）

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
uv run --with requests --with pillow scripts/generate_zhipu.py \
  "技術文書の図解" -s 1568x1056 -o diagram.png

# 高速生成（standard品質）
uv run --with requests --with pillow scripts/generate_zhipu.py \
  "ロゴデザイン" -q standard -o logo.png

# テキスト描画精度の活用
uv run --with requests --with pillow scripts/generate_zhipu.py \
  "「祝・開店」と書かれた和風バナー" -o banner.png
```

---

## 5. remove-bg-magenta.py - マゼンタ背景除去

マゼンタ/ピンク背景を色ベースで透過にする。

```bash
uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py 入力画像 [-o 出力画像]
```

### 仕組み
- R>180, G<100, B>100 の色を透過
- 1px収縮でエッジのピンク残りを除去

---

## 6. remove-bg-vision.py - Vision API背景除去

macOS Vision APIで背景を自動検出して透過にする。

```bash
python3 scripts/remove-bg-vision.py 入力画像 [-o 出力画像]
```

> Note: 内部で`remove-bg.swift`を呼び出す。追加依存なし。macOS 14.0以降が必要。

### 特徴
- 前景を自動検出
- 参照画像のスタイル（背景含む）を維持した画像に最適

---

## 7. erode.py - エッジ収縮

透過画像のエッジを任意のピクセル数だけ収縮する。

```bash
uv run --with pillow --with numpy --with scipy scripts/erode.py 入力画像 [-o 出力画像] [-i 収縮量]
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 出力画像パス | 入力を上書き |
| `-i`, `--iterations` | 収縮量（ピクセル数） | `1` |

---

## 8. split_transparent.py - 透過画像分割

透過PNGを個別オブジェクトに分割（ステッカーシート用）。

```bash
uv run --with opencv-python --with numpy scripts/split_transparent.py 入力画像 [出力ディレクトリ]
```

### 仕組み
- アルファチャンネル（透明部分）で境界を検出
- 連結成分ごとに切り出し
- 左上→右下の順で番号付け

---

## ファイル構成

```
image-creator/
├── skills/
│   └── image-creator/
│       └── SKILL.md              # スキル本体（ルーティング）
├── docs/
│   └── reference.md              # 本ファイル（詳細リファレンス）
├── config/
│   └── rich_patterns.json        # リッチ画像テンプレート設定
└── scripts/
    ├── generate.py               # Gemini画像生成
    ├── generate_rich.py          # パターン/モード対応リッチ画像生成
    ├── template_engine.py        # Mustache風テンプレートエンジン
    ├── generate_openai.py        # OpenAI画像生成
    ├── generate_zhipu.py         # GLM-Image画像生成（ZhipuAI）
    ├── generate_fal.py           # fal.ai画像生成（フォールバック用）
    ├── remove-bg-magenta.py      # マゼンタ背景除去（1px収縮含む）
    ├── remove-bg-vision.py       # Vision API背景除去
    ├── remove-bg.swift           # Vision API実装（Swift）
    ├── erode.py                  # エッジ収縮（単体）
    └── split_transparent.py      # 透過画像分割
```
