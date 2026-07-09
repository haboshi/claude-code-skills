/**
 * OpenAI (gpt-image-2) 向け ImageGenPort アダプタ
 *
 * モデルIDは内部名経由でマッピングする（port-design.md）。値は ../model-catalog.md を正とし、
 * stale_days を超えたら使用前に鮮度チェックする（../freshness-check.md）。
 *
 * このファイルはコピーして使う成果物。外部 import は openai / ../port.ts のみ。
 * transport を注入できる構造にしてあるのは契約テスト（templates/contract-test.ts）で
 * 実 API を叩かずにエラー分類・出力形状を検証するため。
 *
 * 注意: コメント中の `../model-catalog.md` 等の相対参照は provider-image-gen スキル内の
 * ドキュメントを指す（コピー先プロジェクトには存在しない。port.ts のファイル冒頭コメント参照）。
 * また Buffer / process.env を使用するため Node.js ランタイムを前提とする。
 */
import type OpenAI from 'openai'
import {
  EditImageInputSchema,
  GenImageInputSchema,
  GenImageResultSchema,
  ImageGenError,
  type Aspect,
  type EditImageInput,
  type GenImageInput,
  type GenImageResult,
  type ImageGenCapabilities,
  type ImageGenPort,
} from './port'

// 安定した内部名 → 具体モデルID のマッピング（durable-vs-volatile.md）。
// 値は ../model-catalog.md を正とし、直接呼び出しコードに埋め込まない。
const OPENAI_MODEL_MAP = {
  'general-purpose': 'gpt-image-2',
} as const

export interface OpenAIImagesTransport {
  generate(req: {
    model: string
    prompt: string
    size: string
    n: number
    // providerOptions.openai の非ポータブル追加パラメータ（quality 等）をそのまま渡すための拡張。
    [key: string]: unknown
  }): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }>
  edit?(req: {
    model: string
    prompt: string
    image: Uint8Array
    mask?: Uint8Array
    [key: string]: unknown
  }): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }>
}

function createDefaultTransport(apiKey?: string): OpenAIImagesTransport {
  let client: OpenAI | undefined
  async function getClient(): Promise<OpenAI> {
    if (!client) {
      const { default: OpenAIClient } = await import('openai')
      client = new OpenAIClient({ apiKey: apiKey ?? process.env.OPENAI_API_KEY })
    }
    return client
  }
  return {
    async generate(req) {
      const c = await getClient()
      // req は providerOptions.openai 由来の非ポータブルな追加キーを含みうる（escape-hatch.md）。
      // SDK 側は images.generate が streaming/non-streaming の overload を持ち、引数に
      // 追加キーがあると overload 解決が曖昧になるため、境界でパラメータ・戻り値の両方を cast する。
      const response = await c.images.generate(req as Parameters<typeof c.images.generate>[0])
      return response as unknown as { data?: Array<{ b64_json?: string; url?: string }> }
    },
    // 既定実装は generate() のみ。edit() を使う場合は transport.edit を実装して注入すること
    // （capabilities().editing はこの配線状況を実際に反映する。下記 capabilities() 参照）。
  }
}

// gpt-image-2 の制約（../model-catalog.md 参照: 長辺≤3840px・16px倍数・比率≤3:1）を満たす具体例。
// プロジェクトの要件に応じて調整すること。
const ASPECT_TO_OPENAI_SIZE: Record<Aspect, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x864',
  '9:16': '864x1536',
  '4:3': '1024x768',
  '3:4': '768x1024',
}

function buildPrompt(prompt: string, _openaiOptions: Record<string, unknown>): string {
  // プロンプト加工はこのファイル内に閉じ込める（port-design.md: プロンプトはアダプタ側）。
  // モデル固有の言い回し調整が必要になったらここに追加する。
  return prompt
}

function toGenImageResult(response: { data?: Array<{ b64_json?: string; url?: string }> }): GenImageResult {
  const items = response.data ?? []
  if (items.length === 0) {
    throw new ImageGenError({
      kind: 'transient',
      message: 'OpenAI から画像データが返されませんでした',
      providerName: 'openai',
      retryable: true,
      failoverable: true,
    })
  }
  const images = items.map((item) => {
    if (!item.b64_json) {
      // 入力が不正なのではなく、本テンプレートが url 形式のレスポンスを扱う経路を実装していない
      // ことが原因（機能非対応）。invalid_input ではなく unsupported が正しい分類。
      throw new ImageGenError({
        kind: 'unsupported',
        message: 'b64_json 形式以外のレスポンスは本テンプレート未対応（url 形式は別途実装が必要）',
        providerName: 'openai',
        retryable: false,
        failoverable: false,
      })
    }
    return { data: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' }
  })
  return GenImageResultSchema.parse({ images, providerRaw: response })
}

// クライアント/サーバのタイムアウト検出。ステータスコードを持たない場合があるため
// status 判定より先に見る（408/504・AbortError・ETIMEDOUT・DEADLINE_EXCEEDED・メッセージ中の timeout 表記）。
function isTimeoutError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  const name = (err as { name?: string })?.name
  const code = (err as { code?: string })?.code
  const message = err instanceof Error ? err.message : String(err)
  return (
    status === 408 ||
    status === 504 ||
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    message.includes('DEADLINE_EXCEEDED') ||
    /timeout/i.test(message)
  )
}

// OpenAI 固有エラー → 共有エラー分類へのマッピング。
// 429 は2種類ある（pace超過=retryable / quota超過=課金設定が必要でretryable不可）。
// SDK が返すエラーコード文字列は変わりうるため、更新時は ../freshness-check.md の手順で再確認する。
function mapOpenAIError(err: unknown): ImageGenError {
  if (err instanceof ImageGenError) return err
  const status = (err as { status?: number })?.status
  const code = (err as { code?: string })?.code
  const type = (err as { type?: string })?.type
  const message = err instanceof Error ? err.message : String(err)

  if (isTimeoutError(err)) {
    return new ImageGenError({ kind: 'timeout', message, providerName: 'openai', retryable: true, failoverable: true, sourceError: err })
  }
  if (type === 'image_generation_user_error' && code === 'moderation_blocked') {
    // モデレーションブロック。同一プロバイダ内リトライは禁止。
    // フェイルオーバーを許すかは設計判断（../fallback-resilience.md）。ここでは許容する。
    return new ImageGenError({
      kind: 'content_blocked',
      message,
      providerName: 'openai',
      retryable: false,
      failoverable: true,
      sourceError: err,
    })
  }
  if (status === 429) {
    const isQuota = code === 'insufficient_quota'
    return new ImageGenError({
      kind: isQuota ? 'quota_exhausted' : 'rate_limited',
      message,
      providerName: 'openai',
      retryable: !isQuota,
      // taxonomy 上 rate_limited は同一プロバイダ内リトライが基本だが、ここでは failoverable も
      // true にしている（意図的な逸脱）。pace制限はプロバイダ固有の割当なので、他プロバイダに
      // 切り替えれば即座に成功する可能性が高く、フェイルオーバーを許した方が実利が大きいため。
      failoverable: true,
      sourceError: err,
    })
  }
  if (status === 401 || status === 403) {
    return new ImageGenError({ kind: 'auth', message, providerName: 'openai', retryable: false, failoverable: false, sourceError: err })
  }
  if (status === 400) {
    return new ImageGenError({ kind: 'invalid_input', message, providerName: 'openai', retryable: false, failoverable: false, sourceError: err })
  }
  if (typeof status === 'number' && status >= 500) {
    // Gemini アダプタと同様に 5xx 全般を transient として扱う（504 は isTimeoutError() で
    // 先に timeout に分類されるため、ここに来るのは実質 500/502/503 等）。
    return new ImageGenError({ kind: 'transient', message, providerName: 'openai', retryable: true, failoverable: true, sourceError: err })
  }
  // 未分類のエラーは安全側に倒し自動リトライしない（フェイルオーバーの余地だけ残す）。
  return new ImageGenError({ kind: 'transient', message, providerName: 'openai', retryable: false, failoverable: true, sourceError: err })
}

export class OpenAIImageAdapter implements ImageGenPort {
  private readonly transport: OpenAIImagesTransport
  private readonly modelId: string

  constructor(
    opts: {
      apiKey?: string
      transport?: OpenAIImagesTransport
      internalModel?: keyof typeof OPENAI_MODEL_MAP
    } = {}
  ) {
    const internalModel = opts.internalModel ?? 'general-purpose'
    this.modelId = OPENAI_MODEL_MAP[internalModel]
    this.transport = opts.transport ?? createDefaultTransport(opts.apiKey)
  }

  async generate(rawInput: GenImageInput): Promise<GenImageResult> {
    const input = GenImageInputSchema.parse(rawInput)
    const size = ASPECT_TO_OPENAI_SIZE[input.aspect ?? '1:1']
    const openaiOptions = input.providerOptions?.openai ?? {}

    // capabilities().transparentBackground=false と整合。gpt-image-2 は透過背景非対応
    // （../model-catalog.md 参照）。呼び出し側が capabilities() を見ずに指定してきた場合の保険として、
    // API に投げる前に検出して unsupported を返す（本筋は呼び出し側の事前チェック）。
    if (openaiOptions.background === 'transparent') {
      throw new ImageGenError({
        kind: 'unsupported',
        message: 'gpt-image-2 は透過背景（providerOptions.openai.background: "transparent"）に非対応です',
        providerName: 'openai',
        retryable: false,
        failoverable: false,
      })
    }

    try {
      const response = await this.transport.generate({
        model: this.modelId,
        prompt: buildPrompt(input.prompt, openaiOptions),
        size,
        n: input.n ?? 1,
        // 非ポータブル上書き: quality 等の追加パラメータを渡す、または size/n 等を明示的に
        // 上書きする経路（例: 共通 Aspect の5種を超える解像度を直接指定したい場合）。
        // 上記の名前付きフィールドと衝突するキーが providerOptions.openai にあれば、
        // ここでの指定が優先される（escape-hatch.md）。
        ...openaiOptions,
      })
      return toGenImageResult(response)
    } catch (err) {
      throw mapOpenAIError(err)
    }
  }

  async edit(rawInput: EditImageInput): Promise<GenImageResult> {
    const input = EditImageInputSchema.parse(rawInput)
    if (!this.transport.edit) {
      // capabilities().editing は transport.edit の有無をそのまま反映するため、
      // 呼び出し側が capabilities() を確認していれば通常ここには来ない（見ずに呼んだ場合の保険）。
      throw new ImageGenError({
        kind: 'unsupported',
        message: '注入された transport が edit() 未対応です',
        providerName: 'openai',
        retryable: false,
        failoverable: false,
      })
    }
    const openaiOptions = input.providerOptions?.openai ?? {}
    try {
      const response = await this.transport.edit({
        model: this.modelId,
        prompt: buildPrompt(input.prompt, openaiOptions),
        image: input.image.data,
        mask: input.mask?.data,
        // 非ポータブル上書き（generate() と同じ方針。escape-hatch.md）。
        ...openaiOptions,
      })
      return toGenImageResult(response)
    } catch (err) {
      throw mapOpenAIError(err)
    }
  }

  capabilities(): ImageGenCapabilities {
    return {
      // gpt-image-2 は透過背景非対応（../model-catalog.md 参照。gpt-image-1.5 からの機能退行）
      transparentBackground: false,
      // 実際に injected された transport が edit を実装しているかを正直に反映する。
      // createDefaultTransport() は generate() のみ実装するため既定では false になる
      // （edit を使うには transport.edit を実装して注入する必要がある。上記コンストラクタ参照）。
      editing: this.transport.edit !== undefined,
      // openai SDK 6.45.0 の型定義（ImageEditParamsBase.image: Uploadable | Array<Uploadable>）で
      // GPT image モデルは edit() に最大16枚の参照画像を渡せることを確認済み。ただし本テンプレートの
      // 共通契約 EditImageInputSchema は単一画像+マスクのみを公開しており、複数画像入力の経路は
      // 未実装（プロバイダ自体は対応・テンプレ未配線）。実装する場合は EditImageInputSchema の拡張
      // または providerOptions.openai 経由の追加画像配列が必要（port.md 参照）。
      referenceImages: { supported: true, max: 16 },
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      maxResolutionPx: 3840,
    }
  }
}
