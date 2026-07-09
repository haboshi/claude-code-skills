/**
 * 共通契約テストスイート（vitest）
 *
 * contract-testing.md の原則:
 * - 全アダプタが同一の契約テストスイートを通ることを確認する
 * - モック中心（実 API は叩かない）+ 実 API を叩く Pin+Verify テストは最小1本ずつ
 * - このスイートが証明するのはポータブルな面のみ。providerOptions 経由の非ポータブル機能
 *   （例: Gemini の参照画像、OpenAI の quality 指定）は各アダプタ固有のテストで別途カバーする
 *
 * このファイルはコピーして使う成果物。外部 import は vitest / ../port.ts / 各アダプタのみ。
 *
 * 注意: コメント中の相対参照は provider-image-gen スキル内のドキュメントを指す
 * （コピー先プロジェクトには存在しない。port.ts のファイル冒頭コメント参照）。
 */
import { describe, expect, it } from 'vitest'
import { ImageGenError, withFallback, type ImageGenCapabilities, type ImageGenPort, type GenImageResult } from './port'
import { GeminiImageAdapter } from './adapter-gemini'
import { OpenAIImageAdapter } from './adapter-openai'

const baseCapabilities: ImageGenCapabilities = {
  transparentBackground: false,
  editing: false,
  referenceImages: { supported: false },
  aspectRatios: ['1:1'],
}

function fakeImage(): GenImageResult {
  return { images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] }
}

function toBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64')
}

// 各アダプタに共通して要求する契約。プロバイダ固有の内部実装には依存しない。
function runCommonContractTests(
  name: string,
  makeErrorAdapter: (status: number) => ImageGenPort,
  makeSuccessAdapter: () => ImageGenPort,
  makeTimeoutAdapter: () => ImageGenPort
) {
  describe(`${name} アダプタの共通契約`, () => {
    it('正常系: 出力形状が契約を満たす', async () => {
      const adapter = makeSuccessAdapter()
      const result = await adapter.generate({ prompt: 'test prompt' })
      expect(result.images.length).toBeGreaterThan(0)
      expect(result.images[0].mimeType).toBeTruthy()
      expect(result.images[0].data).toBeInstanceOf(Uint8Array)
    })

    it('エラー分類: 5xx は transient かつ retryable', async () => {
      const adapter = makeErrorAdapter(503)
      await expect(adapter.generate({ prompt: 'test prompt' })).rejects.toMatchObject({
        kind: 'transient',
        retryable: true,
      })
    })

    it('エラー分類: 502 も 500/503 と同じく transient/retryable になる（5xx判定の非対称の回帰確認）', async () => {
      const adapter = makeErrorAdapter(502)
      await expect(adapter.generate({ prompt: 'test prompt' })).rejects.toMatchObject({
        kind: 'transient',
        retryable: true,
      })
    })

    it('エラー分類: 429 はリトライ対象として扱われる', async () => {
      const adapter = makeErrorAdapter(429)
      await expect(adapter.generate({ prompt: 'test prompt' })).rejects.toMatchObject({
        retryable: true,
      })
    })

    it('エラー分類: タイムアウトは timeout として分類される', async () => {
      const adapter = makeTimeoutAdapter()
      await expect(adapter.generate({ prompt: 'test prompt' })).rejects.toMatchObject({
        kind: 'timeout',
        retryable: true,
      })
    })

    it('capabilities() が非対称性を正直な形状で返す', () => {
      const adapter = makeSuccessAdapter()
      const caps = adapter.capabilities()
      expect(typeof caps.transparentBackground).toBe('boolean')
      expect(typeof caps.editing).toBe('boolean')
      expect(Array.isArray(caps.aspectRatios)).toBe(true)
    })
  })
}

runCommonContractTests(
  'openai',
  (status) => new OpenAIImageAdapter({ transport: { generate: () => Promise.reject({ status }) } }),
  () =>
    new OpenAIImageAdapter({
      transport: { generate: () => Promise.resolve({ data: [{ b64_json: toBase64([1, 2, 3]) }] }) },
    }),
  () => new OpenAIImageAdapter({ transport: { generate: () => Promise.reject({ status: 408 }) } })
)

runCommonContractTests(
  'gemini',
  (status) => new GeminiImageAdapter({ transport: { generateContent: () => Promise.reject({ status }) } }),
  () =>
    new GeminiImageAdapter({
      transport: {
        generateContent: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ inlineData: { data: toBase64([1, 2, 3]), mimeType: 'image/png' } }] } }],
          }),
      },
    }),
  () => new GeminiImageAdapter({ transport: { generateContent: () => Promise.reject({ status: 408 }) } })
)

// unsupported の経路: capabilities() で false を返している機能を実際に要求すると unsupported になる。
// 非ポータブル/非対称な挙動は共通契約でなくアダプタ固有テストでカバーする（contract-testing.md）。
describe('openai アダプタ固有: 透過背景指定', () => {
  it('capabilities().transparentBackground=false の機能を要求すると unsupported を返す', async () => {
    const adapter = new OpenAIImageAdapter({
      transport: { generate: () => Promise.resolve({ data: [{ b64_json: toBase64([1, 2, 3]) }] }) },
    })
    expect(adapter.capabilities().transparentBackground).toBe(false)
    await expect(
      adapter.generate({ prompt: 'test prompt', providerOptions: { openai: { background: 'transparent' } } })
    ).rejects.toMatchObject({ kind: 'unsupported' })
  })
})

describe('gemini アダプタ固有: edit()', () => {
  it('capabilities().editing=false の edit() を呼ぶと unsupported を返す', async () => {
    const adapter = new GeminiImageAdapter({ transport: { generateContent: () => Promise.resolve({ candidates: [] }) } })
    expect(adapter.capabilities().editing).toBe(false)
    await expect(
      adapter.edit({ prompt: 'test prompt', image: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' } })
    ).rejects.toMatchObject({ kind: 'unsupported' })
  })
})

// escape hatch の配線確認: providerOptions が実際にリクエストへマージされているか
// （文字列で「渡せる」と主張するだけでなく、モック transport が受け取った内容で検証する）。
describe('openai アダプタ固有: providerOptions のマージ', () => {
  it('providerOptions.openai の追加パラメータが generate リクエストにマージされる', async () => {
    let capturedReq: unknown
    const adapter = new OpenAIImageAdapter({
      transport: {
        generate: (req) => {
          capturedReq = req
          return Promise.resolve({ data: [{ b64_json: toBase64([1, 2, 3]) }] })
        },
      },
    })
    await adapter.generate({ prompt: 'test prompt', providerOptions: { openai: { quality: 'low' } } })
    expect((capturedReq as { quality?: string }).quality).toBe('low')
  })

  it('b64_json が無いレスポンスは unsupported を返す（url形式は本テンプレート未対応）', async () => {
    const adapter = new OpenAIImageAdapter({
      transport: { generate: () => Promise.resolve({ data: [{ url: 'https://example.com/image.png' }] }) },
    })
    await expect(adapter.generate({ prompt: 'test prompt' })).rejects.toMatchObject({ kind: 'unsupported' })
  })
})

describe('gemini アダプタ固有: providerOptions のマージ / n の扱い', () => {
  it('providerOptions.gemini.imageConfig が共通 aspect を上書きする', async () => {
    let capturedReq: unknown
    const adapter = new GeminiImageAdapter({
      transport: {
        generateContent: (req) => {
          capturedReq = req
          return Promise.resolve({
            candidates: [{ content: { parts: [{ inlineData: { data: toBase64([1, 2, 3]), mimeType: 'image/png' } }] } }],
          })
        },
      },
    })
    await adapter.generate({
      prompt: 'test prompt',
      aspect: '1:1',
      providerOptions: { gemini: { imageConfig: { aspectRatio: '21:9', imageSize: '2K' } } },
    })
    const req = capturedReq as { config?: { imageConfig?: { aspectRatio?: string; imageSize?: string } } }
    expect(req.config?.imageConfig?.aspectRatio).toBe('21:9')
    expect(req.config?.imageConfig?.imageSize).toBe('2K')
  })

  it('n>1 を要求すると unsupported を返す（黙って1枚返さない）', async () => {
    const adapter = new GeminiImageAdapter({
      transport: {
        generateContent: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ inlineData: { data: toBase64([1, 2, 3]), mimeType: 'image/png' } }] } }],
          }),
      },
    })
    await expect(adapter.generate({ prompt: 'test prompt', n: 4 })).rejects.toMatchObject({ kind: 'unsupported' })
  })
})

// フォールバック decorator の経路テスト（fallback-resilience.md）。
// ここは共通契約でなく decorator 自体のふるまいを検証する。
describe('withFallback decorator', () => {
  it('primary が transient エラーなら secondary にフェイルオーバーする', async () => {
    const primary: ImageGenPort = {
      generate: () =>
        Promise.reject(
          new ImageGenError({ kind: 'transient', message: 'primary down', providerName: 'primary', retryable: false, failoverable: true })
        ),
      capabilities: () => baseCapabilities,
    }
    const secondary: ImageGenPort = { generate: () => Promise.resolve(fakeImage()), capabilities: () => baseCapabilities }

    const combined = withFallback([primary, secondary])
    const result = await combined.generate({ prompt: 'test prompt' })
    expect(result.images.length).toBe(1)
  })

  it('quota_exhausted は同一プロバイダ内でリトライせず即フェイルオーバーする', async () => {
    let callCount = 0
    const primary: ImageGenPort = {
      generate: () => {
        callCount++
        return Promise.reject(
          new ImageGenError({ kind: 'quota_exhausted', message: 'quota', providerName: 'primary', retryable: false, failoverable: true })
        )
      },
      capabilities: () => baseCapabilities,
    }
    const secondary: ImageGenPort = { generate: () => Promise.resolve(fakeImage()), capabilities: () => baseCapabilities }

    const combined = withFallback([primary, secondary])
    await combined.generate({ prompt: 'test prompt' })
    expect(callCount).toBe(1) // 同一プロバイダ内でリトライされていないこと
  })

  it('content_blocked は同一プロバイダ内でリトライしない（failoverable=false なら即エラー）', async () => {
    let callCount = 0
    const primary: ImageGenPort = {
      generate: () => {
        callCount++
        return Promise.reject(
          new ImageGenError({ kind: 'content_blocked', message: 'blocked', providerName: 'primary', retryable: false, failoverable: false })
        )
      },
      capabilities: () => baseCapabilities,
    }

    const combined = withFallback([primary])
    await expect(combined.generate({ prompt: 'test prompt' })).rejects.toMatchObject({ kind: 'content_blocked' })
    expect(callCount).toBe(1)
  })

  it('editing は常に false を返す（generate() のみを束ねる decorator で edit() は実装しないため）', () => {
    const primaryWithEditing: ImageGenPort = {
      generate: () => Promise.resolve(fakeImage()),
      capabilities: () => ({ ...baseCapabilities, editing: true }),
    }
    const combined = withFallback([primaryWithEditing])
    expect(combined.capabilities().editing).toBe(false)
  })
})

// Pin+Verify: 実 API を叩く最小テスト（最小サイズ・n=1）。キーが無ければ自動 skip される。
// pin-and-verify.md のタイミング（依存更新時・stale 検知時）で手動実行する想定。
describe.skipIf(!process.env.OPENAI_API_KEY)('Pin+Verify: OpenAI 実 API 疎通確認', () => {
  it('最小設定で1枚生成できる', async () => {
    const adapter = new OpenAIImageAdapter({ apiKey: process.env.OPENAI_API_KEY })
    const result = await adapter.generate({ prompt: 'a single red circle on a white background', n: 1, aspect: '1:1' })
    expect(result.images.length).toBe(1)
  }, 60_000)
})

describe.skipIf(!process.env.GEMINI_API_KEY)('Pin+Verify: Gemini 実 API 疎通確認', () => {
  it('最小設定で1枚生成できる', async () => {
    const adapter = new GeminiImageAdapter({ apiKey: process.env.GEMINI_API_KEY })
    const result = await adapter.generate({ prompt: 'a single red circle on a white background', n: 1, aspect: '1:1' })
    expect(result.images.length).toBeGreaterThan(0)
  }, 60_000)
})
