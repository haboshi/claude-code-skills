/**
 * Google Gemini (gemini-3.1-flash-image / gemini-3-pro-image) 向け ImageGenPort アダプタ
 *
 * モデルIDは内部名経由でマッピングする（port-design.md）。値は ../model-catalog.md を正とし、
 * stale_days を超えたら使用前に鮮度チェックする（../freshness-check.md）。
 *
 * このファイルはコピーして使う成果物。外部 import は @google/genai / ../port.ts のみ。
 *
 * 注意: コメント中の `../model-catalog.md` 等の相対参照は provider-image-gen スキル内の
 * ドキュメントを指す（コピー先プロジェクトには存在しない。port.ts のファイル冒頭コメント参照）。
 * また Buffer / process.env を使用するため Node.js ランタイムを前提とする。
 */
import type { GoogleGenAI } from '@google/genai'
import {
  GenImageInputSchema,
  GenImageResultSchema,
  ImageGenError,
  type EditImageInput,
  type GenImageInput,
  type GenImageResult,
  type ImageGenCapabilities,
  type ImageGenPort,
} from './port'

// 安定した内部名 → 具体モデルID のマッピング（durable-vs-volatile.md）。
// 値は ../model-catalog.md を正とし、直接呼び出しコードに埋め込まない。
const GEMINI_MODEL_MAP = {
  'general-purpose': 'gemini-3.1-flash-image', // 汎用ワークホース（Nano Banana 2）
  'high-quality': 'gemini-3-pro-image', // 最高品質・参照画像14枚対応（Nano Banana Pro）
} as const

interface GeminiPart {
  text?: string
  // data / mimeType は SDK のレスポンス型では省略可能なため、呼び出し側で存在チェックする。
  inlineData?: { data?: string; mimeType?: string }
}

interface GeminiGenerateContentRequest {
  model: string
  contents: GeminiPart[]
  config?: { responseModalities?: string[]; imageConfig?: { aspectRatio?: string; imageSize?: string } }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] }
  }>
}

export interface GeminiImagesTransport {
  generateContent(req: GeminiGenerateContentRequest): Promise<GeminiGenerateContentResponse>
}

function createDefaultTransport(apiKey?: string): GeminiImagesTransport {
  let client: GoogleGenAI | undefined
  async function getClient(): Promise<GoogleGenAI> {
    if (!client) {
      const { GoogleGenAI: Client } = await import('@google/genai')
      client = new Client({ apiKey: apiKey ?? process.env.GEMINI_API_KEY })
    }
    return client
  }
  return {
    async generateContent(req) {
      const c = await getClient()
      return c.models.generateContent(req)
    },
  }
}

function toGenImageResult(response: GeminiGenerateContentResponse): GenImageResult {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  const images = parts
    .filter((part): part is GeminiPart & { inlineData: { data: string; mimeType?: string } } => !!part.inlineData?.data)
    .map((part) => ({ data: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType ?? 'image/png' }))
  if (images.length === 0) {
    throw new ImageGenError({
      kind: 'transient',
      message: 'Gemini から画像データが返されませんでした',
      providerName: 'gemini',
      retryable: true,
      failoverable: true,
    })
  }
  return GenImageResultSchema.parse({ images, providerRaw: response })
}

// クライアント/サーバのタイムアウト検出。ステータスコードを持たない場合があるため
// status 判定より先に見る（408/504・AbortError・DEADLINE_EXCEEDED は generate.py の
// _get_status_code() での実績あり・メッセージ中の timeout 表記）。
function isTimeoutError(err: unknown): boolean {
  const status = (err as { status?: number })?.status ?? (err as { code?: number })?.code
  const name = (err as { name?: string })?.name
  const message = err instanceof Error ? err.message : String(err)
  return (
    status === 408 ||
    status === 504 ||
    name === 'AbortError' ||
    message.includes('DEADLINE_EXCEEDED') ||
    /timeout/i.test(message)
  )
}

// Gemini 固有エラー → 共有エラー分類へのマッピング。
// 公式にリトライ対象と明言されているのは 429/408/5xx のみ（Retry-After ヘッダなし、
// クライアント側指数バックオフ前提。../model-catalog.md 参照）。408/504/DEADLINE_EXCEEDED は
// isTimeoutError() で timeout に、429 のみ rate_limited に分類する。
function mapGeminiError(err: unknown): ImageGenError {
  if (err instanceof ImageGenError) return err
  const status = (err as { status?: number })?.status ?? (err as { code?: number })?.code
  const message = err instanceof Error ? err.message : String(err)

  if (isTimeoutError(err)) {
    return new ImageGenError({ kind: 'timeout', message, providerName: 'gemini', retryable: true, failoverable: true, sourceError: err })
  }
  if (status === 429) {
    // taxonomy 上 rate_limited は同一プロバイダ内リトライが基本だが、failoverable も true にして
    // いる（意図的な逸脱。adapter-openai.ts の同コメント参照）。
    return new ImageGenError({ kind: 'rate_limited', message, providerName: 'gemini', retryable: true, failoverable: true, sourceError: err })
  }
  if (typeof status === 'number' && status >= 500) {
    return new ImageGenError({ kind: 'transient', message, providerName: 'gemini', retryable: true, failoverable: true, sourceError: err })
  }
  if (status === 401 || status === 403) {
    return new ImageGenError({ kind: 'auth', message, providerName: 'gemini', retryable: false, failoverable: false, sourceError: err })
  }
  if (status === 400) {
    return new ImageGenError({ kind: 'invalid_input', message, providerName: 'gemini', retryable: false, failoverable: false, sourceError: err })
  }
  // 未分類は安全側に倒し自動リトライしない（フェイルオーバーの余地だけ残す）。
  return new ImageGenError({ kind: 'transient', message, providerName: 'gemini', retryable: false, failoverable: true, sourceError: err })
}

export class GeminiImageAdapter implements ImageGenPort {
  private readonly transport: GeminiImagesTransport
  private readonly modelId: string

  constructor(
    opts: {
      apiKey?: string
      transport?: GeminiImagesTransport
      internalModel?: keyof typeof GEMINI_MODEL_MAP
    } = {}
  ) {
    const internalModel = opts.internalModel ?? 'general-purpose'
    this.modelId = GEMINI_MODEL_MAP[internalModel]
    this.transport = opts.transport ?? createDefaultTransport(opts.apiKey)
  }

  async generate(rawInput: GenImageInput): Promise<GenImageResult> {
    const input = GenImageInputSchema.parse(rawInput)

    if ((input.n ?? 1) > 1) {
      // Gemini の複数枚生成（candidateCount 経由の可能性）は ../model-catalog.md で未検証のため、
      // 誤った出力枚数を返すより明示的に unsupported とする方を選んでいる（1枚のみ生成）。
      throw new ImageGenError({
        kind: 'unsupported',
        message: 'GeminiImageAdapter は n>1 に対応していません（本テンプレートでは常に1枚のみ生成）',
        providerName: 'gemini',
        retryable: false,
        failoverable: false,
      })
    }

    // 参照画像は Gemini 固有機能（最大14枚）。imageConfig（21:9 等の比率・1K/2K/4K 解像度）も
    // 共通ポートの契約に存在しないため、いずれも providerOptions 経由の非ポータブルな指定とする
    // （escape-hatch.md）。
    const geminiOptions = (input.providerOptions?.gemini ?? {}) as unknown as {
      referenceImages?: Array<{ data: string; mimeType: string }>
      imageConfig?: { aspectRatio?: string; imageSize?: string }
    }

    const contents: GeminiPart[] = [{ text: input.prompt }]
    for (const ref of geminiOptions.referenceImages ?? []) {
      contents.push({ inlineData: ref })
    }

    try {
      const response = await this.transport.generateContent({
        model: this.modelId,
        contents,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: input.aspect ?? '1:1',
            // 非ポータブル上書き: providerOptions.gemini.imageConfig が共通 aspect と衝突する場合
            // （例: 21:9 指定や解像度ティア指定）は、こちらを優先する（escape-hatch.md）。
            ...geminiOptions.imageConfig,
          },
        },
      })
      return toGenImageResult(response)
    } catch (err) {
      throw mapGeminiError(err)
    }
  }

  // 本テンプレートでは edit() 相当は参照画像経由の合成が主で、OpenAI 流のマスク編集APIとは
  // 形が異なるため未実装。capabilities().editing=false で事前検出するのが本筋だが、
  // 呼び出し側がそれを見ずに edit() を呼んだ場合の保険として unsupported を返す。
  async edit(_input: EditImageInput): Promise<GenImageResult> {
    throw new ImageGenError({
      kind: 'unsupported',
      message: 'GeminiImageAdapter は edit() 非対応です（capabilities().editing を確認してください）',
      providerName: 'gemini',
      retryable: false,
      failoverable: false,
    })
  }

  capabilities(): ImageGenCapabilities {
    return {
      // 透過背景対応の記載なし。未確認情報のため保守的に false とする
      // （../model-catalog.md「未確認事項」参照。要鮮度チェック）。
      transparentBackground: false,
      // 本テンプレートは edit() を未実装（Gemini は参照画像経由の合成が主でOpenAI流の
      // マスク編集APIとは形が異なるため）。必要になったら追加すること。
      editing: false,
      referenceImages: { supported: true, max: 14 },
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      // 解像度は 1K/2K/4K の離散選択でアスペクト比とは別軸のため、ここでは表現しない。
      maxResolutionPx: undefined,
    }
  }
}
