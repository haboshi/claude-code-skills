# image-creator fal.ai フォールバック追加

## 概要

image-creator プラグインに fal.ai プロバイダーを追加し、Gemini Pro/NB2 が応答しない場合のフォールバック先として機能させる。

## 背景

- Gemini の NB2 (Nano Banana 2) モデルが頻繁にダウンする
- 既存のフォールバックは Gemini モデル間のみ（Pro -> NB2 -> Flash）
- gen-ai-image プラグインが fal.ai に対応しているが、image-creator とは独立しており自動フォールバックできない
- `FAL_AI_API_KEY` は既に環境変数として設定済み

## 設計

### フォールバックチェーン

変更前:

```
Pro -> NB2 -> Flash
NB2 -> Flash
```

変更後:

```
Pro -> NB2 -> fal.ai -> Flash
NB2 -> fal.ai -> Flash
```

トリガー条件は既存と同一: HTTP 503, 504, 429, 408

### generate_fal.py（新規）

他プロバイダー（generate_openai.py, generate_zhipu.py）と同じパターンで独立スクリプトとして作成。

#### 関数シグネチャ

```python
def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1536x1024",
    quality: str = "low",
) -> str:
```

#### API仕様

- エンドポイント: `https://queue.fal.run/fal-ai/gpt-image-1.5`
- 認証: `Authorization: Key {FAL_AI_API_KEY}`
- リクエスト:

```json
{
  "prompt": "...",
  "image_size": "1536x1024",
  "quality": "low"
}
```

- レスポンス:

```json
{
  "images": [{"url": "https://..."}]
}
```

#### サイズ制約

fal.ai は固定サイズのみ対応:

| サイズ | 用途 |
|--------|------|
| `1024x1024` | 正方形 (1:1) |
| `1536x1024` | 横長 (3:2) |
| `1024x1536` | 縦長 (2:3) |

#### Gemini アスペクト比からの変換

```python
ASPECT_TO_FAL_SIZE = {
    "1:1":  "1024x1024",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "4:3":  "1536x1024",
    "3:4":  "1024x1536",
    "1:4":  "1024x1536",
    "4:1":  "1536x1024",
}
```

#### セキュリティ

- SSRF 保護: generate_openai.py と同等の URL 検証を移植
  - HTTPS スキーム検証
  - プライベート IP 範囲ブロック
  - IPv4 マップド IPv6 検出
  - 8 進数/10 進数 IP 表記バイパス検出
  - リダイレクト先 URL 再検証（最大 5 回）
- ダウンロードサイズ上限: 20MB
- アトミック書き込み: tmpfile + rename

#### CLI

```bash
uv run --with requests generate_fal.py "prompt" -o output.png -s 1536x1024 -q low
```

引数:

| 引数 | 短形式 | 説明 | デフォルト | 選択肢 |
|------|--------|------|-----------|--------|
| prompt | - | 画像生成プロンプト | 必須 | - |
| --output | -o | 出力ファイルパス | `generated_image.png` | - |
| --size | -s | 画像サイズ | `1536x1024` | `1024x1024`, `1536x1024`, `1024x1536` |
| --quality | -q | 品質 | `low` | `low`, `medium`, `high` |

#### エラーハンドリング

- API キー未設定: セットアップ手順を表示して終了
- API エラー（4xx/5xx）: エラーメッセージを表示して終了（フォールバック元の generate.py がハンドリング）
- ダウンロード失敗: リトライなし（フォールバック元に委譲）

### generate.py 変更

#### フォールバックチェーン拡張

```python
fallback_chain = {
    "pro": ["nb2", "fal", "flash"],
    "nb2": ["fal", "flash"],
}
```

#### fal.ai フォールバック実行

fal.ai は Gemini と異なる API のため、subprocess で `generate_fal.py` を呼び出す:

```python
if fb_key == "fal":
    fal_size = ASPECT_TO_FAL_SIZE.get(aspect_ratio, "1536x1024")
    result = subprocess.run(
        [sys.executable, str(script_dir / "generate_fal.py"),
         prompt, "-o", str(output_file), "-s", fal_size, "-q", "low"],
        capture_output=True, text=True, timeout=120
    )
    if result.returncode == 0:
        print(f"保存完了 (fal.ai): {output_file.absolute()}")
        return str(output_file.absolute())
    # 失敗時は次のフォールバック（Flash）へ
    continue
```

### SKILL.md 更新

プロバイダー表に fal.ai を追加:

| プロバイダー | 強み | APIキー環境変数 |
|-------------|------|----------------|
| Gemini | 日本語プロンプト、参照画像のスタイルコピー | `GEMINI_API_KEY` |
| OpenAI | 高品質、ネイティブ透過背景対応、複数枚同時生成 | `OPENAI_API_KEY` |
| GLM-Image | テキスト描画精度91.16%、日本語・中国語プロンプト、低コスト | `GLM_API_KEY` or `ZAI_API_KEY` |
| **fal.ai** | **Gemini フォールバック、GPT Image 1.5** | `FAL_AI_API_KEY` |

フォールバック動作の説明を追加:

```
Gemini Pro/NB2 が応答しない場合（503/504/429/408）、
自動的に fal.ai → Flash の順でフォールバックします。
--no-fallback オプションで無効化可能。
```

### テスト

`test_generate_fal.py` で以下をカバー:

- SSRF 保護（プライベート IP、localhost、IPv4 マップド IPv6）
- API レスポンスパース（正常系、画像なし、エラー）
- サイズバリデーション（無効サイズの拒否）
- ダウンロードサイズ上限
- アトミック書き込み

## 変更対象ファイル

| ファイル | 操作 |
|---------|------|
| `image-creator/scripts/generate_fal.py` | 新規作成 |
| `image-creator/scripts/test_generate_fal.py` | 新規作成 |
| `image-creator/scripts/generate.py` | フォールバックチェーン拡張 |
| `image-creator/skills/image-creator/SKILL.md` | プロバイダー表・フォールバック説明更新 |
