/**
 * ImageGenPort — 画像生成のユースケース中心ポート定義
 *
 * provider-harness メタスキルの port-design.md / escape-hatch.md に従う:
 * - ポートは薄く保つ（画像生成はプロンプトがモデル固有資産のため厚い抽象化が効かない。
 *   provider-harness メタスキルの references/abstraction-thickness.md 参照）
 * - プロバイダ固有機能は providerOptions で正直にパススルーする（存在しないふりをしない）
 * - capabilities() でプロバイダ非対称性を隠さず公開する
 *
 * このファイルはコピーして使う成果物。外部 import は zod のみ。
 * 注意: 本ファイル・adapter-openai.ts・adapter-gemini.ts・contract-test.ts 内のコメントにある
 * `../model-catalog.md` 等の相対参照は、コピー元スキル（provider-image-gen）内のドキュメントを指す。
 * コピー先プロジェクトにはそのファイルは存在しないため、必要なら該当箇所の記述内容も
 * コメントとして書き写すか、provider-image-gen スキルへのリンクとして残すこと。
 */
import { z } from 'zod'

// 全アダプタ共通のポータブルなアスペクト比のみを列挙する。
// これを超える比率（例: Gemini の 21:9）は providerOptions.gemini 経由の非ポータブル指定とする。
export const AspectSchema = z.enum(['1:1', '16:9', '9:16', '4:3', '3:4'])
export type Aspect = z.infer<typeof AspectSchema>

export const ImageBytesSchema = z.object({
  data: z.instanceof(Uint8Array),
  mimeType: z.string(),
})
export type ImageBytes = z.infer<typeof ImageBytesSchema>

// プロバイダ固有パラメータの非ポータブルなパススルー経路。プロバイダ名で名前空間化し、
// 各アダプタは自分宛ての名前空間だけを読み、他プロバイダ宛ての値は読まない。
// ここを使うコードは差し替え時に動作確認が必須（escape-hatch.md 参照）。
export const ProviderOptionsSchema = z.object({
  openai: z.record(z.string(), z.unknown()).optional(),
  gemini: z.record(z.string(), z.unknown()).optional(),
})
export type ProviderOptions = z.infer<typeof ProviderOptionsSchema>

export const GenImageInputSchema = z.object({
  prompt: z.string().min(1),
  aspect: AspectSchema.optional(),
  n: z.number().int().min(1).max(10).optional(),
  providerOptions: ProviderOptionsSchema.optional(),
})
export type GenImageInput = z.infer<typeof GenImageInputSchema>

export const GenImageResultSchema = z.object({
  images: z.array(ImageBytesSchema).min(1),
  // デバッグ用の生レスポンス。非ポータブルなので値の形に依存したコードを書かないこと。
  providerRaw: z.unknown().optional(),
  // 実際に生成したプロバイダ名（'openai' / 'gemini' 等）。ImageGenError は失敗時に providerName を
  // 持つが成功時の型には元々無く非対称だった。withFallback() 経由でフェイルオーバーが起きた場合に、
  // 呼び出し側がどのプロバイダの結果かを観測できるようにする（port.md「成功時にも providerName を残す」参照）。
  providerName: z.string().optional(),
})
export type GenImageResult = z.infer<typeof GenImageResultSchema>

export const EditImageInputSchema = z.object({
  prompt: z.string().min(1),
  image: ImageBytesSchema,
  mask: ImageBytesSchema.optional(),
  providerOptions: ProviderOptionsSchema.optional(),
})
export type EditImageInput = z.infer<typeof EditImageInputSchema>

export const ImageGenCapabilitiesSchema = z.object({
  transparentBackground: z.boolean(),
  editing: z.boolean(),
  referenceImages: z.object({
    supported: z.boolean(),
    max: z.number().int().optional(),
  }),
  aspectRatios: z.array(AspectSchema),
  // 1回の generate() 呼び出しで生成できる最大枚数。未設定は「上限不明」を意味し、withFallback() の
  // 事前スキップ判定では制約なし（常に候補に残す）として扱う（fallback-resilience.md 参照）。
  maxImagesPerCall: z.number().int().optional(),
  maxResolutionPx: z.number().int().optional(),
})
export type ImageGenCapabilities = z.infer<typeof ImageGenCapabilitiesSchema>

/**
 * 共有エラー分類。provider-harness メタスキルの正準エラー分類（error-taxonomy.md、references 配下）
 * と同じ8種の語彙を使う。プロバイダ固有の例外は、アダプタ側で必ずこの型にマッピングしてから投げる。
 * retryable / failoverable の意味は fallback-resilience.md を参照。
 */
export type ImageGenErrorKind =
  | 'rate_limited' // pace超過。同一プロバイダ内でリトライしてよい
  | 'quota_exhausted' // 予算/上限超過。同一プロバイダ内リトライ禁止、フェイルオーバー推奨
  | 'auth' // 認証・認可エラー。リトライ・フェイルオーバーいずれも無意味
  | 'invalid_input' // 入力不正。リトライ・フェイルオーバーいずれも無意味
  | 'content_blocked' // モデレーション等でブロック。同一プロバイダ内リトライ禁止
  | 'timeout' // クライアント/サーバのタイムアウト。リトライ可、フェイルオーバーも可
  | 'transient' // 5xx 等の一時障害。リトライ・フェイルオーバーともに可
  | 'unsupported' // このアダプタ/プロバイダでは非対応の機能。capabilities() での事前検出が本筋で、
  // 実行時にここへ来るのは呼び出し側が capabilities() を確認しなかった場合の保険

export class ImageGenError extends Error {
  readonly kind: ImageGenErrorKind
  readonly retryable: boolean
  readonly failoverable: boolean
  readonly providerName: string
  // 元のプロバイダ SDK 例外（デバッグ用）。非ポータブルなので値の形に依存しないこと。
  readonly sourceError?: unknown

  constructor(params: {
    kind: ImageGenErrorKind
    message: string
    providerName: string
    retryable: boolean
    failoverable: boolean
    sourceError?: unknown
  }) {
    super(params.message)
    this.name = 'ImageGenError'
    this.kind = params.kind
    this.retryable = params.retryable
    this.failoverable = params.failoverable
    this.providerName = params.providerName
    this.sourceError = params.sourceError
  }
}

export interface ImageGenPort {
  generate(input: GenImageInput): Promise<GenImageResult>
  edit?(input: EditImageInput): Promise<GenImageResult>
  capabilities(): ImageGenCapabilities
  // 任意: 構成済み（API キー等が揃っている）かどうかを返す。未実装のプロバイダは常に構成済み扱い。
  // withFallback() はこれが false を返すプロバイダを呼ぶ前に除外する（fallback-resilience.md 参照）。
  isConfigured?(): boolean
}

// 入力とプロバイダの capabilities() を突き合わせ、明らかに満たせない場合は事前にスキップする既定判定。
// ImageGenCapabilities で判定可能な範囲（n / maxImagesPerCall・透過背景要求 / transparentBackground）に
// 限る。より厳密な判定が必要な場合は withFallback() の opts.canHandle で上書きすること。
function defaultCanHandle(input: GenImageInput, caps: ImageGenCapabilities): boolean {
  if (input.n !== undefined && caps.maxImagesPerCall !== undefined && input.n > caps.maxImagesPerCall) {
    return false
  }
  if (wantsTransparentBackground(input) && !caps.transparentBackground) {
    return false
  }
  return true
}

// providerOptions は名前空間ごとに非ポータブルだが、透過背景要求は複数アダプタが同じ
// `background: 'transparent'` の慣習（templates/adapter-openai.ts 参照）を使っているため、
// どの名前空間であっても検出できるようにしている（意図的な横断読み。宛先プロバイダ以外の
// namespace まで見に行く精度上のトレードオフより、「透過を頼まれたのに非透過画像を黙って
// 返す」事故を防ぐ方を優先した設計判断。port.md「透過背景要求の横断的な検出」参照）。
// Object.values() で ProviderOptionsSchema の名前空間を動的に列挙しており、新しい名前空間が
// 追加されてもこの関数を手動で同期する必要がない。
function wantsTransparentBackground(input: GenImageInput): boolean {
  const opts = input.providerOptions
  if (!opts) return false
  return Object.values(opts).some((ns) => (ns as Record<string, unknown> | undefined)?.background === 'transparent')
}

// 事前スキップの除外理由。全プロバイダが除外された際のエラー種別の投げ分けに使う（下記 generate() 参照）。
type ExclusionReason = 'not_configured' | 'unsupported_input'

function evaluateProviderEligibility(
  provider: ImageGenPort,
  input: GenImageInput,
  canHandle: (input: GenImageInput, caps: ImageGenCapabilities) => boolean
): { eligible: boolean; reason?: ExclusionReason } {
  if (provider.isConfigured?.() === false) {
    return { eligible: false, reason: 'not_configured' }
  }
  if (!canHandle(input, provider.capabilities())) {
    return { eligible: false, reason: 'unsupported_input' }
  }
  return { eligible: true }
}

/**
 * フォールバック decorator — 複数の ImageGenPort を優先順で束ね、1つの ImageGenPort として振る舞う。
 *
 * fallback-resilience.md の設計:
 * - retryable なエラーは同一プロバイダ内で指数バックオフ再試行する
 * - retryable でない、または再試行を使い切った場合は failoverable なら次のプロバイダへ進む
 * - failoverable でない（例: invalid_input, auth）は即座に投げ直し、フェイルオーバーしない
 * - ImageGenError でない生の例外（アダプタ側のエラーマッピング漏れ）は retryable:false（同一プロバイダ内
 *   リトライしない）/ failoverable:true（次プロバイダへ進む）を既定動作とする。未分類の例外を安全側で
 *   リトライしない一方、マッピング漏れ1件でチェーン全体を無条件に止めないための意図的な非対称性
 *   （下記 generateWithRetry / generate() のコメントと contract-test.ts の経路テスト参照）。
 * - 各プロバイダを呼ぶ前に capabilities()/isConfigured() で入力に適合するか・構成済みかを判定し、
 *   満たせないプロバイダは呼ばずにスキップする（事前スキップ。fallback-resilience.md「呼び出し前の
 *   プロバイダ選別」参照）。既定判定は opts.canHandle で上書きできる。
 *
 * capabilities() は束ねた集合の代表値として先頭プロバイダの値を返す。ただし editing は常に false
 * を返す（withFallback が束ねるのは generate() のみで edit() は実装しないため、先頭プロバイダが
 * editing:true でもこの合成ポート経由の edit() 呼び出しは失敗する。誤解を避けるための誠実化）。
 * 個別プロバイダの厳密な非対称性を確認したい場合は providers を直接参照すること。
 */
export function withFallback(
  providers: ImageGenPort[],
  opts: {
    maxRetriesPerProvider?: number
    baseDelayMs?: number
    canHandle?: (input: GenImageInput, caps: ImageGenCapabilities) => boolean
  } = {}
): ImageGenPort {
  if (providers.length === 0) {
    throw new Error('withFallback には最低1つの ImageGenPort が必要')
  }
  const maxRetries = opts.maxRetriesPerProvider ?? 2
  const baseDelay = opts.baseDelayMs ?? 500
  const canHandle = opts.canHandle ?? defaultCanHandle

  async function generateWithRetry(provider: ImageGenPort, input: GenImageInput): Promise<GenImageResult> {
    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await provider.generate(input)
      } catch (err) {
        lastError = err
        // ImageGenError でない生の例外は retryable:false 扱い（同一プロバイダ内リトライしない）。
        // 上記クラス docstring 参照。
        const retryable = err instanceof ImageGenError ? err.retryable : false
        if (!retryable || attempt === maxRetries) break
        await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt))
      }
    }
    throw lastError
  }

  return {
    async generate(input: GenImageInput): Promise<GenImageResult> {
      // 事前スキップ: 構成済み（isConfigured() !== false）かつ capabilities() が入力を満たせる
      // プロバイダだけを候補にする（fallback-resilience.md「呼び出し前のプロバイダ選別」）。
      const evaluations = providers.map((provider) => evaluateProviderEligibility(provider, input, canHandle))
      const eligible = providers.filter((_, i) => evaluations[i].eligible)
      if (eligible.length === 0) {
        const notConfiguredCount = evaluations.filter((e) => e.reason === 'not_configured').length
        const unsupportedCount = evaluations.filter((e) => e.reason === 'unsupported_input').length
        // 除外理由が isConfigured のみなら構成エラー（auth）、capability 不適合が1件でも含まれるなら
        // unsupported として投げ分ける（MEDIUM-1: 呼び出し側が対処法を判別できるようにするため）。
        const kind: ImageGenErrorKind = unsupportedCount > 0 ? 'unsupported' : 'auth'
        throw new ImageGenError({
          kind,
          message: `入力を処理できる構成済みプロバイダがありません（候補 ${providers.length} 件中 0 件が対応。未構成: ${notConfiguredCount} 件、入力非対応: ${unsupportedCount} 件）`,
          providerName: 'withFallback',
          retryable: false,
          failoverable: false,
        })
      }

      let lastError: unknown
      for (const provider of eligible) {
        try {
          return await generateWithRetry(provider, input)
        } catch (err) {
          lastError = err
          // ImageGenError でない生の例外は failoverable:true 扱い（次プロバイダへ進む）。
          // 上記クラス docstring 参照。
          const failoverable = err instanceof ImageGenError ? err.failoverable : true
          if (!failoverable) throw err
          // failoverable なら次のプロバイダへ進む
        }
      }
      throw lastError
    },
    capabilities(): ImageGenCapabilities {
      // editing は常に false（このオブジェクトは edit() を実装していないため。上記 docstring 参照）。
      // maxImagesPerCall も providers[0] の値をそのまま返すため、後続プロバイダがより大きい上限を
      // 持つ場合はチェーン全体の真の上限を過小報告しうる（正確な値が必要なら providers を直接参照）。
      return { ...providers[0].capabilities(), editing: false }
    },
  }
}
