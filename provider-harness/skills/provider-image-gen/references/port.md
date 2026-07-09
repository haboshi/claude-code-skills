# ImageGenPort の設計解説

## ユースケース中心の考え方を画像生成に適用する

provider-harness メタスキルの port-design.md は「プロバイダの能力でなくアプリの実際の用途を抽象化する」ことを説く。画像生成では `templates/port.ts` の `ImageGenPort` 自体をアプリの最終形として使うのではなく、さらに一段ユースケース特化したポートでラップすることを推奨する。

```
# NG: アプリコードが ImageGenPort を直接あちこちで呼ぶ
const result = await imageGenPort.generate({ prompt: buildProductPrompt(item) })

# OK: ユースケース特化ポートでラップし、プロンプト構築をアプリのドメイン層に閉じ込める
interface ProductThumbnailGenerator {
  generateFromDescription(description: string): Promise<ThumbnailResult>
}
```

`ImageGenPort` は「画像生成という機能」を表す共通基盤層であり、実際にアプリ全体へ露出させるのは `ProductThumbnailGenerator` のようなユースケース特化インターフェースにする。こうすることで、`ImageGenPort` 自体の差し替え（プロバイダ変更・アダプタ追加）がアプリの他の層に波及しない。

## capabilities() でプロバイダ非対称性を正直に公開する

画像生成は特にプロバイダ間の非対称性が大きいドメインである。実データに基づく非対称の実例:

- **透過背景**: OpenAI の現行 flagship `gpt-image-2` は透過背景に非対応（旧世代 `gpt-image-1.5` は対応していたが2026-12-01 shutdown予定。`deprecations.md` 参照）。Gemini 系は透過対応の記載がなく `model-catalog.md` に「未確認」と明記している。透過が必須な要件では、どちらのプロバイダも `capabilities().transparentBackground` で `false` を返す設計にしてあり、呼び出し側は生成前にこれを確認できる。
- **解像度指定の形**: OpenAI は任意解像度（長辺3840px以下・16px倍数・比率3:1以下）を受け付けるのに対し、Gemini はアスペクト比＋解像度ティア（1K/2K/4K）という離散的な軸で指定する。共通ポートの `Aspect` enum はどちらのプロバイダにも存在するアスペクト比のみで構成し、解像度の細かい制御は `providerOptions` 側に逃がす。
- **参照画像**: Gemini は最大14枚の参照画像に対応し、`providerOptions.gemini.referenceImages` を通す非ポータブルな経路として実装している（`templates/adapter-gemini.ts` 参照）。OpenAI 側も `edit()` は実は最大16枚の参照画像に対応する（openai SDK 6.45.0 の型定義 `ImageEditParamsBase.image: Uploadable | Array<Uploadable>` のコメントで確認済み。GPT image モデル共通、`dall-e-2` のみ1枚）。ただし本テンプレートの共通契約 `EditImageInputSchema` は単一画像+マスクのみを公開しており、複数画像入力の経路は未実装（プロバイダ自体は対応・テンプレ未配線）。`templates/adapter-openai.ts` の `capabilities().referenceImages` は `supported: true, max: 16` を返しつつ、この配線ギャップをコメントで明示している。複数画像を実際に使いたい場合は `EditImageInputSchema` の拡張か `providerOptions.openai` 経由の追加画像配列の実装が必要。

これらの非対称性を統一ポートで無理に揃えようとすると、どちらの機能も中途半端になる。`capabilities()` を呼び出し側が事前にチェックする設計にすることで、「呼んでみたらエラーだった」ではなく「呼ぶ前に非対応だと分かる」状態を保つ。

`providerOptions` はプロバイダ名で名前空間化してある（`{ openai?: {...}, gemini?: {...} }`）。各アダプタは自分宛ての名前空間だけを読み、他プロバイダ宛ての値には触れない。フラットな `Record<string, unknown>` にしないのは、複数プロバイダ向けの設定が1つの `providerOptions` に混在したときに、キー名の衝突やどのプロバイダ向けか曖昧な状態を防ぐため。

## モデル参照は内部名を経由する

`templates/adapter-openai.ts` の `OPENAI_MODEL_MAP` と `templates/adapter-gemini.ts` の `GEMINI_MODEL_MAP` が、安定した内部名（`general-purpose` 等）から具体モデルIDへのマッピング層になっている。呼び出しコードはモデルIDを直接指定しない。マッピングの値そのものは `model-catalog.md` を正とする（`durable-vs-volatile.md` でいう volatile な情報のため）。

## プロンプトはアダプタ側に閉じ込める

`templates/adapter-openai.ts` / `templates/adapter-gemini.ts` の `buildPrompt()` がその置き場所。現状は素通しの実装だが、モデル固有の言い回し調整が必要になったらこの関数の中だけを変更すればよい。ポートのシグネチャ（`GenImageInput.prompt: string`）自体は変更不要になる設計にしている。
