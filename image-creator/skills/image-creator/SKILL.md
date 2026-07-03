---
name: image-creator
description: Codex サブスク枠（無課金・既定）、Google Gemini、OpenAI GPT Image、またはZhipuAI GLM-Imageの画像生成モデルで画像を生成・編集。「画像を生成して」「イラストを作って」「この画像を編集して」などの指示で自動的に使用される。何も指定しない汎用生成は codex サブスク枠（ChatGPTログイン認証・API従量課金なし）を優先し、利用不可時は自動で Gemini にフォールバック。「ステッカーを何個か作って」「複数のアイコンを生成して分割」などステッカーシート生成・分割にも対応。Codex（gpt-image-2/無課金）、Gemini（Nano Banana）、OpenAI（gpt-image-2 / gpt-image-1.5）、GLM-Image（ZhipuAI）から選択可能。
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Image Creator - AI画像生成スキル

Google Gemini / OpenAI GPT Image / ZhipuAI GLM-Image / fal.ai を使った画像生成・編集。

詳細なCLIオプション・モデルID・全ワークフローは `docs/reference.md` を必要時に参照。

---

## デフォルト設定（明示指示がない場合に適用）

**強制ではなく推奨デフォルト**。ユーザー指示があればそちらを優先。

| 項目 | デフォルト | 例外 |
|---|---|---|
| 既定プロバイダ（汎用生成） | **codex サブスク枠（無課金）** | 利用不可時は Gemini nb2 へ自動フォールバック／透過・正確な比率・2K/4K 指定時は OpenAI |
| 画像内テキストの言語 | **日本語** | 「英語で」等の明示時／型番・通貨記号・API等は原表記 |
| Gemini モデル | `nb2`（Nano Banana 2） | `--model pro`/`flash` 明示時 |
| OpenAI モデル | `gpt-image-2` | `-b transparent` 時は自動的に `gpt-image-1.5` へフォールバック |
| 情報密度 | プロンプト項目を**省略せず**全て描画 | 「要約」「シンプル」指示時は割愛 |
| 日本語テキスト quality | `medium` 以上 | `low` は文字崩れ可能性 |

---

## Step 0: ユースケース判定（最初に実行）

画像生成依頼時は技術詳細（プロバイダー等）より先に、「何を作りたいか」を AskUserQuestion で確認する。

### 画像タイプ5択

| タイプ | 次のステップ |
|---|---|
| YouTubeサムネイル・ブログヘッダー | → Step 1: リッチ画像（`generate_rich.py`） |
| 説明図・図解・比較図 | → Step 0.5: 図種サジェスト |
| アイコン・ステッカー（透過背景） | → Step 1: シンプル画像（透過） |
| 一般的なイラスト・写真 | → Step 1: シンプル画像 |
| テキスト入り画像（文字精度重視） | → Step 1: GLM-Image |

AskUserQuestion で上記5択を提示する。JSONスキーマは Claude 自身で構築可能。

### Step 0.5: 図種サジェストテーブル

ユーザーが「説明図・図解・比較図」を選んだ、または「〇〇を図にして」「〇〇を可視化して」等の入力をした場合、以下から最も近い行を1つ選び、推奨図種 top3 を AskUserQuestion で提示する。

| 伝えたい内容 | 推奨図種 top3 | 推奨ツール |
|---|---|---|
| 論文・記事の要点を1枚に凝縮 | ビジュアルアブストラクト / インフォグラフィック / ワンページャー | `generate_rich.py --mode graphrec` |
| 処理・意思決定の流れ・手順 | フローチャート / シーケンス図 / 状態遷移図 | **`mermaid-to-webp`**（記法正確） |
| 担当者別の業務フロー | スイムレーン図 / BPMN / フローチャート | `mermaid-to-webp` |
| 時系列・スケジュール | タイムライン / ガントチャート / カスタマージャーニー | ガント=mermaid / 他=`generate_rich.py --mode process` |
| 階層・分解構造 | ロジックツリー / マインドマップ / 組織図 | `mermaid-to-webp` |
| 概念の優先度・段階 | ピラミッド図 / マトリクス図 / ロジックツリー | `generate_rich.py --mode comparison` |
| 集合・重なり・関係性 | ベン図 / 概念図 / ネットワーク図 | `generate_rich.py --mode comparison` |
| 比較・評価軸（4象限/SWOT） | マトリクス図 / レーダーチャート / 比較表 | `generate_rich.py --mode comparison` |
| データベース構造 | ER図 | **`mermaid-to-webp`** |
| システム・モジュール構成 | アーキテクチャ図 / シーケンス図 / ネットワーク図 | アーキ=`generate_rich.py` / シーケンス=mermaid |
| 数値データの可視化 | 棒/折/円グラフ / ヒートマップ | mermaid (xychart) または matplotlib |
| 流量・遷移・絞り込み | サンキー / ファネル / フロー図 | サンキー=mermaid / ファネル=`generate_rich.py` |
| 事業戦略フレーム | ビジネスモデルキャンバス / バリューチェーン | `generate_rich.py --mode comparison` |
| 体験・ストーリー | カスタマージャーニー / タイムライン | `generate_rich.py --mode process` |

**判定ルール**:
- **構造記法系**（フロー/シーケンス/ER/ガント/組織図）→ 図形の正確性重視 → `mermaid-to-webp` にルーティング
- **ビジュアル発信系**（ビジュアルアブストラクト/インフォグラフィック/BMC/ジャーニー）→ レイアウト自由度重視 → `generate_rich.py`

---

## Step 1: ツール選択マトリクス

| 要件 | ツール | 主なオプション |
|---|---|---|
| **汎用生成（何も指定なし・無課金）** | **`generate_codex.py`** | `--effort` / `-n <枚数>` |
| リッチサムネイル・説明図 | `generate_rich.py` | `--mode anime-wow` / `--mode graphrec` / `--character-preset` |
| 透過背景アイコン・ステッカー | `generate_openai.py` | `-b transparent` |
| 正確な比率・2K/4K・印刷用 | `generate_openai.py` | `-s <size>` `-q high` |
| 参照画像のスタイルコピー | `generate.py` | `-r <ref.png>` |
| 複数枚同時生成 | `generate_codex.py` / `generate_openai.py` | `-n <枚数>` |
| テキスト描画精度重視（日中） | `generate_zhipu.py` | - |
| 日本語プロンプト | `generate.py` / `generate_zhipu.py` | - |
| デフォルト | `generate_codex.py`（サブスク・無課金／不可時 Gemini） | - |

### プロバイダー別の強み

- **Codex サブスク枠（既定）**: ChatGPTログイン認証で gpt-image-2 を**無課金**利用。汎用生成の既定。ただし size/quality/厳密比率は制御不可・透過不可（→ 必要時は OpenAI へ）
- **Gemini**: 日本語理解・参照画像スタイルコピー・フォールバックチェーン豊富
- **OpenAI**: 高品質・ネイティブ透過背景・正確なサイズ/2K/4K・複数枚同時生成（`-n`）。従量課金
- **GLM-Image**: 日中テキスト描画精度91.16%、低コスト（$0.015/枚）
- **fal.ai**: Gemini障害時の自動フォールバック（GPT Image 1.5）

### モデル選択ヒューリスティック

**Gemini**:
- 既定 `nb2` - Pro品質+Flash速度・参照画像10枚・thinking制御（Preview）
- キャラクター一貫性重視 → `pro`（Preview）
- 速度・安定性（GA）優先 → `flash`

**OpenAI**:
- 既定 `gpt-image-2` - 最新・最高品質・テキスト描画強
- 透過背景 → `gpt-image-1.5` に自動フォールバック（`-b transparent`時）
- 軽量・低コスト → `gpt-image-1-mini`

---

## Step 2: リッチ画像モード（`generate_rich.py`）

### パターン/モード対応表

| pattern | mode | 用途 |
|---|---|---|
| **thumbnail** | `anime-wow` | アニメ風・驚き表現 |
| | `anime-impact` | アニメ風・インパクト重視 |
| | `anime-pop` | アニメ風・ポップ/明るい |
| | `anime-bright` | アニメ風・鮮やか/清潔感 |
| | `formal-default` | ビジネス・フォーマル |
| | `real-default` | 写真風リアリスティック |
| **illustration** | `comparison` | 比較・対比 |
| | `graphrec` | 図解・グラフィックレコーディング風 |
| | `process` | プロセス・フロー図 |
| | `custom` | カスタムプロンプト自由形式 |

### キャラクタープリセット（`--character-preset`）

`default` / `idol` / `vtuber` / `business` / `tech` / `teacher` / `mascot` / `cool`

詳細は `--list-presets` で取得可能。

### 追加で確認する項目（AskUserQuestion）

- **サムネイル**: スタイル（アニメ/ビジネス/写真）、アニメ風なら雰囲気（驚き/インパクト/ポップ/明るい）、キャラクター有無
- **説明図**: タイプ（図解=graphrec / 比較=comparison / プロセス=process / カスタム）

---

## Step 3: 推奨設定早見表

| ケース | プロバイダー | モデル | オプション |
|---|---|---|---|
| 汎用・高品質 | Gemini or OpenAI | nb2 / gpt-image-2 | - |
| 透過アイコン・ステッカー | OpenAI | gpt-image-1.5（自動） | `-b transparent` |
| 参照画像コピー | Gemini | nb2 / pro | `-r <ref>` |
| シンプルイラスト | Gemini | flash | `--magenta-bg` + マゼンタ除去 |
| キャラ一貫性重視 | Gemini | pro | `-r <参照キャラ>` |
| テキスト重視（英語） | OpenAI | gpt-image-2 | - |
| テキスト重視（日本語/中国語） | GLM-Image | glm-image | - |
| プロトタイプ・軽量 | OpenAI | gpt-image-1-mini | - |
| 低コスト大量生成 | GLM-Image | glm-image | - |

### 背景除去の選び方

| 方法 | 適したケース |
|---|---|
| OpenAI `-b transparent` | OpenAI使用時（最も簡単） |
| `remove-bg-vision.py` | 実写・写真風・複雑背景・グラデーション（macOS 14+） |
| `remove-bg-magenta.py` | イラスト・シンプル図形・フラットデザイン（`--magenta-bg`で生成後） |

---

## ツール一覧

| ツール | 用途 |
|---|---|
| `generate_codex.py` | **codex サブスク枠・無課金の汎用生成（既定）** |
| `generate.py` | Gemini 汎用生成 |
| `generate_rich.py` | パターン/モード対応リッチ画像 |
| `generate_openai.py` | OpenAI 生成・編集 |
| `generate_zhipu.py` | GLM-Image (ZhipuAI) 生成 |
| `generate_fal.py` | fal.ai 生成（フォールバック用） |
| `remove-bg-magenta.py` | マゼンタ背景除去（1px収縮含む） |
| `remove-bg-vision.py` | macOS Vision API 背景除去 |
| `erode.py` | 透過画像エッジ収縮 |
| `split_transparent.py` | 透過画像を個別オブジェクトに分割 |

詳細オプションは各スクリプト `--help` または `docs/reference.md` 参照。

---

## codex サブスク枠生成（無課金の既定経路）

Codex CLI 組み込みの built-in `image_gen`（gpt-image-2）を **ChatGPT ログイン認証（サブスクリプション枠）** で呼び出す。`OPENAI_API_KEY` を明示的に外して起動するため **API 従量課金が発生しない**。「何も指定しない汎用生成」の既定。

```bash
# 可用性判定（利用可=exit 0 / 不可=exit 3）
uv run python scripts/generate_codex.py --check

# 生成（単発）
uv run python scripts/generate_codex.py "青空と一本桜のシンプルなイラスト" -o sakura.png

# 複数枚（共有スタイルで連続生成）／作り込みは effort を上げる
uv run python scripts/generate_codex.py "章扉の装飾" -n 3 --effort xhigh -o slide.png
```

**前提**:
- Codex CLI がインストール済みで、`codex login` により **ChatGPT でログイン**していること（API キー不要）。
- 未導入・未ログイン環境では exit 3 を返す。SKILL の既定ルーティングは自動で Gemini へフォールバックする。

**制約（built-in image_gen 由来）**:
- **size/quality/厳密な比率を制御できない**（`--aspect` は prose ヒントで、密な縦長内容では無視されがち）。
- **透過背景を出力できない**。
- → **正確な比率・2K/4K・quality=high・透過が必要なときは `generate_openai.py`（従量課金）** を使う。

**品質向上（augment・既定ON）**: built-in は size/quality を制御できないため、品質は**プロンプト設計**で引き上げる。`generate_codex.py` は既定で「専門デザイナー役の付与＋品質バー＋（構造的内容なら）レイアウト委譲・補助ラベル補完」を自動付与する（ユーザーの明示テイストは尊重し不要な装飾は足さない）。これが effort より効く最大の品質レバー。特にインフォグラフィック・図解・ポスターで顕著。`--no-augment` で無効化可。
- **effort の目安**: 単発の簡単な画像は `low`、作り込み（インフォグラフィック・図解・複数枚のスタイル統一）は `high`/`xhigh`。effort を上げても解像度は伸びない（built-in 上限〜1〜2K）。
- **比率**: `--aspect` は向き（portrait/landscape/square）を強い prose で誘導する。向きの一貫性は上がるが、**解像度・厳密な比率は built-in の制御外**（ピクセル固定が要る納品物は `generate_openai.py -s` の従量課金経路へ）。

**偽装検証（自動）**: codex は稀に image_gen を呼ばず SVG/PIL 等で自作した画像や既存流用で「生成した」と偽装する。本スクリプトはプロンプトの偽装禁止文言＋「codex が報告した生成パスが開始マーカーより新しい実ファイルであること」の検証で弾く（検証に落ちると exit 2）。**報告パスを正典とするため、複数セッション同時実行時も他セッションの生成物と混同しない**。

**トークン期限切れ**: 認証エラー（`token_expired`/`unauthorized` 等）検出時は exit 4。ユーザーに `! codex login`（対話 OAuth、Claude 代行不可）での再ログインを依頼する。

---

## 重要ワークフロー（非自明なもの）

### 透過アイコン（最も簡単）

```bash
uv run --with openai --with pillow scripts/generate_openai.py \
  "シンプルな星のアイコン" -b transparent -o star.png
```

### ステッカーシート生成 → 分割

```bash
# 1. マゼンタ背景で複数配置生成（LARGE gaps で重なり回避）
uv run --with google-genai --with pillow scripts/generate.py \
  "Multiple separate kawaii stickers with LARGE gaps: coffee cup, donut, cat, star. Arranged in 2x2 grid, well separated." \
  --magenta-bg -o sheet.png

# 2. 背景透過
uv run --with pillow --with numpy --with scipy scripts/remove-bg-magenta.py sheet.png

# 3. 個別分割
uv run --with opencv-python --with numpy scripts/split_transparent.py sheet.png ./stickers/
```

**プロンプトのコツ**: `LARGE gaps between them`, `well separated`, `Arranged in XxY grid`

### 参照画像スタイルコピー + 透過

```bash
# 1. 参照画像のスタイルで生成（スタイル維持のためマゼンタ指定なし）
uv run --with google-genai --with pillow scripts/generate.py \
  "Same exact style as this image. Object: coffee cup. NO text." \
  -r reference.png -o coffee.png

# 2. Vision API で背景除去
python3 scripts/remove-bg-vision.py coffee.png
```

### 複数枚同時生成（OpenAI）

```bash
uv run --with openai --with pillow scripts/generate_openai.py \
  "かわいい動物のアイコン、1つの動物" -n 5 -b transparent -o animal.png
# → animal_01.png, animal_02.png, ... が生成される
```

### テキスト入り画像（GLM-Image）

```bash
uv run --with requests --with pillow scripts/generate_zhipu.py \
  "「祝・開店」と書かれた和風バナー" -o banner.png
```

---

## 耐障害性・フォールバック

### Gemini のフォールバックチェーン

- **Pro** → codex（無課金） → OpenAI `gpt-image-2` → NB2 → fal.ai → Flash
- **NB2** → codex（無課金） → OpenAI `gpt-image-2` → fal.ai → Flash
- **Flash** は GA モデルで最安定
- codex サブスク枠（無課金）を従量課金 OpenAI の前段に置き、コストを最小化

### 条件

- codex フォールバック: codex CLI＋ChatGPT ログイン時のみ（不可なら静かに次へ）。参照画像指定時は比率制御不可のためスキップ
- OpenAI フォールバック: `OPENAI_API_KEY` 設定時のみ。参照画像指定時は edit API の差異でスキップ
- fal.ai フォールバック: `FAL_AI_API_KEY` 設定時のみ
- `--no-fallback` でチェーン無効化

### リトライ・タイムアウト

- 503/429/408 は最大2回の指数バックオフ（10秒→20秒）。504 は即フォールバック
- NB2/Pro: 300秒、Flash: 600秒、OpenAI: 180秒、fal.ai: 120秒

> **Note**: NB2/Pro は Preview 段階。サーバー過負荷による 503/504 があり得る。最高安定性が必要なら Flash（GA）を直接指定。

---

## 前提条件

- `uv` インストール: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- macOS Vision API 使用時: macOS 14.0 (Sonoma) 以降

### 環境変数

| プロバイダー | 環境変数 |
|---|---|
| Codex サブスク枠（既定） | **不要**（`codex login` で ChatGPT ログインのみ。`OPENAI_API_KEY` は自動で外して起動） |
| Gemini | `GEMINI_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| GLM-Image | `GLM_API_KEY` or `ZAI_API_KEY`（https://z.ai で取得） |
| fal.ai | `FAL_AI_API_KEY` |
| 参照画像検索（`generate_rich.py --ref-search`） | `SERPAPI_KEY` |
