---
name: tts
description: テキスト音声変換（TTS）。OpenAI gpt-4o-mini-tts（高品質クラウド）/ COEIROINK / VOICEVOX対応。バッチ音声生成・WAV結合・スタイル指示に対応。「読み上げて」「音声にして」「テキストをTTSで」で発動。
---

# Text-to-Speech

テキストを音声ファイル（WAV）に変換する。OpenAI / COEIROINK / VOICEVOX 対応のマルチプロバイダアーキテクチャ。

## 使用タイミング

- 「テキストを読み上げて」「音声にして」と依頼されたとき
- バッチで複数セグメントの音声を一括生成するとき
- WAVファイルを結合する必要があるとき
- 高品質な日本語音声が必要なとき（OpenAI推奨）

## Step 0: プロバイダ選択（AskUserQuestion）

ユーザーに使用するTTSプロバイダを確認する。

```
question: "どのTTSプロバイダを使用しますか？"
header: "TTS選択"
options:
  - label: "OpenAI TTS（推奨）"
    description: "gpt-4o-mini-tts。高品質クラウドTTS。13種のボイス、スタイル指示対応。OPENAI_API_KEY必須。"
  - label: "COEIROINK"
    description: "ローカルTTS。つくよみちゃん、AI声優-銀芽。localhost:50032で起動が必要。"
  - label: "VOICEVOX"
    description: "ローカルTTS。多数の話者。localhost:50021で起動が必要。"
```

### OpenAI選択時の追加ヒアリング

#### Step 1: ボイス選択

```
question: "使用するボイスを選んでください"
header: "Voice"
options:
  - label: "nova（推奨）"
    description: "自然で温かみのある女性声。日本語に最適。"
  - label: "alloy"
    description: "中性的でバランスの取れた声。"
  - label: "echo"
    description: "落ち着いた深みのある男性声。"
  - label: "shimmer"
    description: "明るくエネルギッシュな女性声。"
```

その他のボイス: ash, ballad, coral, fable, onyx, sage, verse, marin, cedar

#### Step 2: スタイル指示

instructions パラメータで発話スタイルを自然言語で指定できる。

よく使うスタイル例:
- `"Speak in a warm, friendly conversational tone in Japanese"` - 温かくフレンドリーな会話調
- `"Speak calmly and clearly like a professional narrator"` - 落ち着いたプロのナレーション
- `"Speak with energy and enthusiasm, like a podcast host"` - 元気なポッドキャストホスト
- `"Read in a gentle, soothing bedtime story voice"` - 穏やかな読み聞かせ

## 基本コマンド

### バッチ音声生成

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input <dialogue.json> \
  [options]
```

### WAV結合

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/concat-wav.js \
  --input-dir <parts-dir> \
  --output <combined.wav>
```

## オプション（batch-tts.js）

### 共通オプション

| オプション | 説明 | デフォルト |
|------------|------|------------|
| `--input` | 入力JSONファイル（必須） | - |
| `--concat` | 生成後に全ファイルを結合 | false |
| `--concat-name` | 結合ファイル名 | combined.wav |
| `--indices` | 再生成する特定セグメント（1-based, カンマ区切り） | 全て |
| `--provider` | TTSプロバイダ (openai / coeiroink / voicevox) | coeiroink |
| `--api-base` | API基本URL | プロバイダ依存 |
| `--speaker-map` | 話者マップJSONファイル | なし |

### OpenAI固有オプション

| オプション | 説明 | デフォルト |
|------------|------|------------|
| `--voice` | ボイス名 | nova |
| `--instructions` | 発話スタイル指示（自然言語） | なし |
| `--model` | TTSモデル | gpt-4o-mini-tts |

## JSON入力形式

### ローカルTTS（COEIROINK / VOICEVOX）

```json
{
  "segments": [
    { "speaker": "tsukuyomi", "text": "こんにちは", "speed": 1.3 },
    { "speaker": "ginga", "text": "はじめまして", "speed": 1.3 }
  ],
  "outputDir": "./output",
  "concat": true,
  "concatName": "dialogue.wav"
}
```

### OpenAI TTS

```json
{
  "segments": [
    { "speaker": "nova", "text": "こんにちは", "speed": 1.0 },
    { "speaker": "onyx", "text": "はじめまして", "speed": 1.0, "instructions": "Speak in a deep, authoritative tone" }
  ],
  "outputDir": "./output",
  "voice": "nova",
  "instructions": "Speak naturally in Japanese with a warm tone",
  "concat": true,
  "concatName": "dialogue.wav"
}
```

**instructions の優先順位**: セグメント > JSON設定 > CLIオプション

## プロバイダ

| プロバイダ | API | ボイス数 | 状態 |
|-----------|-----|---------|------|
| `openai` | https://api.openai.com | 13種 | 完全対応（推奨） |
| `coeiroink` | http://localhost:50032 | エンジン依存 | 完全対応 |
| `voicevox` | http://localhost:50021 | エンジン依存 | 対応 |

### OpenAI ボイス一覧

| ボイス | 特徴 |
|--------|------|
| `nova` | 自然で温かみのある女性声（日本語推奨） |
| `alloy` | 中性的でバランスの取れた声 |
| `echo` | 落ち着いた深みのある男性声 |
| `shimmer` | 明るくエネルギッシュな女性声 |
| `ash` | 穏やかで知的な声 |
| `ballad` | 表現力豊かな声 |
| `coral` | 親しみやすい声 |
| `fable` | 物語調の声 |
| `onyx` | 力強い低音の声 |
| `sage` | 落ち着いた知的な声 |
| `verse` | 多用途な声 |
| `marin` | 爽やかな声 |
| `cedar` | 穏やかで安定した声 |

### COEIROINK 話者

| ID | 名前 |
|----|------|
| `tsukuyomi` | つくよみちゃん |
| `ginga` | AI声優-銀芽 |

## 話者マップ（--speaker-map）

キャラクター名からTTS話者への変換を定義。

```json
{
  "narrator": { "ttsName": "つくよみちゃん", "fileId": "narrator" },
  "expert": { "ttsName": "AI声優-銀芽", "fileId": "expert" }
}
```

## 出力構造

```
outputDir/
├── parts/           # 個別の音声ファイル
│   ├── 001_nova.wav
│   ├── 002_onyx.wav
│   └── ...
├── combined.wav     # 結合ファイル（--concat時）
└── summary.json     # 生成サマリー
```

## 使用例

### OpenAI TTS（基本）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json \
  --provider openai \
  --voice nova
```

### OpenAI TTS（スタイル指示付き）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json \
  --provider openai \
  --voice nova \
  --instructions "Speak in a warm, friendly conversational tone in Japanese"
```

### OpenAI TTS（結合付き）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json \
  --provider openai \
  --voice nova \
  --concat
```

### COEIROINK（基本）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json
```

### COEIROINK（結合付き）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json --concat
```

### 特定セグメントのみ再生成

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json --indices 1,5,10
```

### VOICEVOX使用

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json --provider voicevox
```

### カスタム話者マップ

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/batch-tts.js \
  --input script.json --speaker-map characters.json
```

## 前提条件

- Node.js 18+
- OpenAI TTS: `OPENAI_API_KEY` 環境変数
- COEIROINK: localhost:50032 で起動
- VOICEVOX: localhost:50021 で起動

## 英単語の発音について

### ローカルTTS（COEIROINK / VOICEVOX）

英語の発音を正しくするには、事前に `tts-dict` プラグインで辞書登録を行ってください。

### OpenAI TTS

OpenAI TTSは英語・日本語のバイリンガル対応のため、辞書登録は不要です。
特殊な読み方が必要な場合は `instructions` パラメータで指示できます。

例: `"instructions": "Read 'LLM' as 'エルエルエム', 'API' as 'エーピーアイ'"`
