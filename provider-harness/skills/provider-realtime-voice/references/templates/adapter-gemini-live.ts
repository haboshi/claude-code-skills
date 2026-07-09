/**
 * Gemini Live API 向け RealtimeVoicePort アダプタ
 *
 * モデルIDは AI_MODELS 経由でマッピングする（port.ts 参照）。値は ../model-catalog.md を正とし、
 * stale_days を超えたら使用前に鮮度チェックする。
 *
 * このファイルはコピーして使う成果物。外部 import は ./port のみ。WebSocket 実装は
 * RealtimeSocketFactory として型のみ注入する（adapter-openai-realtime.ts と同一インターフェース）。
 *
 * 音声: Gemini Live の出力は PCM16 24kHz 固定（レート交渉不可。../model-catalog.md 参照）。
 * 入力は PCM16 16kHz で正準フォーマットと一致するため変換不要。したがって本アダプタは
 * 出力方向のみ実コーデック（24kHz→16kHz ダウンサンプル）が必要になる非対称な構成になる
 * （../port.md「コーデック分離の理由」参照）。
 *
 * 注意: Buffer を使用するため Node.js ランタイムを前提とする。
 */
import {
  AI_MODELS,
  RealtimeEventQueue,
  RealtimeVoiceError,
  type AudioChunk,
  type AudioCodecPort,
  type RealtimeCapabilities,
  type RealtimeSessionConfig,
  type RealtimeSocketFactory,
  type RealtimeVoicePort,
  type RealtimeVoiceSession,
} from './port'

export type { RealtimeSocket, RealtimeSocketFactory } from './port'

const DEFAULT_OPEN_TIMEOUT_MS = 10_000

function requireSocketFactory(): RealtimeSocketFactory {
  throw new Error(
    'GeminiLiveAdapter には RealtimeSocketFactory の実装（ws パッケージ等）を注入してください'
  )
}

/**
 * Gemini 出力 24kHz PCM16 → 正準 16kHz PCM16 の簡易ダウンサンプル実装（2/3 間引き）。
 * 本番品質のリサンプリングが必要な場合は適切な DSP ライブラリに置き換えること
 * （voice-agent の downsample24kTo16k と同型のアルゴリズム。__tests__/gemini-live.test.ts で
 * 検証済みの実績パターンを踏襲）。入力は PCM16 16kHz のためそのまま素通しする。
 */
export const geminiDownsampleCodec: AudioCodecPort = {
  toCanonical(raw: Uint8Array): Uint8Array {
    const inSamples = Math.floor(raw.length / 2)
    const outSamples = Math.floor((inSamples * 2) / 3)
    const out = new Uint8Array(outSamples * 2)
    const inView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const outView = new DataView(out.buffer)
    for (let i = 0; i < outSamples; i++) {
      const srcIndex = Math.floor((i * 3) / 2)
      outView.setInt16(i * 2, inView.getInt16(srcIndex * 2, true), true)
    }
    return out
  },
  fromCanonical(pcm16: Uint8Array): Uint8Array {
    // Gemini Live の入力は PCM16 16kHz をそのまま受け付ける（正準フォーマットと一致）。
    return pcm16
  },
}

// Gemini 固有イベント → 共有エラー分類へのマッピング。Gemini Live はエラーコード体系の詳細が
// ドキュメント横断で未確認のため（../model-catalog.md「未確認事項」参照）、close コードと
// message の文字列判定に頼る保守的な実装にしてある。
function mapGeminiCloseEvent(code: number, reason: string): RealtimeVoiceError {
  if (code === 1008 || /quota/i.test(reason)) {
    return new RealtimeVoiceError({ kind: 'quota_exhausted', message: reason, providerName: 'gemini', retryable: false, failoverable: true })
  }
  if (/unauthenticated|api.?key/i.test(reason)) {
    return new RealtimeVoiceError({ kind: 'auth', message: reason, providerName: 'gemini', retryable: false, failoverable: false })
  }
  return new RealtimeVoiceError({ kind: 'connection_dropped', message: reason || `WebSocket closed (${code})`, providerName: 'gemini', retryable: true, failoverable: true })
}

function buildSetupMessage(config: RealtimeSessionConfig, modelId: string): Record<string, unknown> {
  const geminiOptions = config.providerOptions?.gemini ?? {}
  const vad = config.vad
  return {
    setup: {
      model: modelId,
      generationConfig: {
        responseModalities: ['AUDIO'],
        ...(config.voice && {
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } },
        }),
      },
      ...(config.instructions && { systemInstruction: { parts: [{ text: config.instructions }] } }),
      // 意図的に非正規化。Gemini は { functionDeclarations: [...] } 形状のままプロバイダに渡す
      // （port.ts 冒頭コメント「tools」参照）。
      ...(config.tools && config.tools.length > 0 && { tools: config.tools }),
      // H3: 空オブジェクトでも明示しない限り transcript イベント（inputTranscription /
      // outputTranscription）は発火しない（既定で off）。フィールド名は inputTranscription /
      // outputTranscription を想定しているが一次情報での検証が済んでいないため
      // ../model-catalog.md「未確認事項」に明記してある。使用前に再確認すること。
      ...(config.transcription && { inputAudioTranscription: {}, outputAudioTranscription: {} }),
      ...(vad?.mode === 'server_vad' && {
        realtimeInputConfig: {
          automaticActivityDetection: {
            prefixPaddingMs: vad.prefixPaddingMs ?? 20,
            silenceDurationMs: vad.silenceDurationMs ?? 500,
          },
        },
      }),
      // 非ポータブル上書き（escape-hatch.md）。
      ...geminiOptions,
    },
  }
}

function handleGeminiEvent(
  event: Record<string, unknown>,
  queue: RealtimeEventQueue,
  codec: AudioCodecPort,
  onReady: () => void,
  pendingToolCalls: Map<string, string>
): void {
  if ('setupComplete' in event) {
    onReady()
    queue.push({ type: 'session.ready' })
    return
  }

  if ('toolCall' in event) {
    const toolCall = event['toolCall'] as { functionCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }
    for (const fc of toolCall.functionCalls ?? []) {
      // sendToolResult() で functionResponses.name を補完するため callId→name を記憶する
      // （Gemini の toolResponse は id だけでなく name も要求する。port.ts 冒頭コメント「tools」参照）。
      pendingToolCalls.set(fc.id, fc.name)
      queue.push({ type: 'tool.call', call: { callId: fc.id, name: fc.name, arguments: fc.args } })
    }
    return
  }

  if ('serverContent' in event) {
    const serverContent = event['serverContent'] as {
      modelTurn?: { parts?: Array<Record<string, unknown>> }
      turnComplete?: boolean
      interrupted?: boolean
      inputTranscription?: { text?: string }
      outputTranscription?: { text?: string }
    }

    // interrupted: barge-in の正常系イベント（エラーではない。port.ts 参照）。
    if (serverContent.interrupted) {
      queue.push({ type: 'speech.started' })
    }

    // H3: inputAudioTranscription/outputAudioTranscription を setup で明示要求した場合のみ届く
    // （buildSetupMessage() 参照）。final は turnComplete と同時に届く保証が未確認のため、turnComplete
    // フラグをそのまま転用する（暫定。要一次情報確認。../model-catalog.md「未確認事項」参照）。
    if (serverContent.inputTranscription?.text) {
      queue.push({ type: 'transcript', role: 'user', text: serverContent.inputTranscription.text, final: Boolean(serverContent.turnComplete) })
    }
    if (serverContent.outputTranscription?.text) {
      queue.push({ type: 'transcript', role: 'assistant', text: serverContent.outputTranscription.text, final: Boolean(serverContent.turnComplete) })
    }

    for (const part of serverContent.modelTurn?.parts ?? []) {
      const inlineData = part['inlineData'] as { data?: string; mimeType?: string } | undefined
      if (inlineData?.data) {
        // Uint8Array.from() で要素単位の新規コピーを作る（adapter-openai-realtime.ts の同一コメント
        // 参照）。Buffer.from(base64, ...) は Node の内部プールから非ゼロ byteOffset で割り当てられる
        // ことがあり、後で誰かが .buffer（プール全体の ArrayBuffer）を直接参照するコードに変更した
        // 場合に無関係なバイト列を巻き込む事故を防ぐため、byteOffset に依存しない要素コピー経路を
        // 明示的に使う。
        const raw = Uint8Array.from(Buffer.from(inlineData.data, 'base64'))
        queue.push({ type: 'audio.output', audio: { data: codec.toCanonical(raw), sampleRate: 16000 } })
      }
      const functionCall = part['functionCall'] as { id: string; name: string; args: Record<string, unknown> } | undefined
      if (functionCall) {
        pendingToolCalls.set(functionCall.id, functionCall.name)
        queue.push({ type: 'tool.call', call: { callId: functionCall.id, name: functionCall.name, arguments: functionCall.args } })
      }
    }

    if (serverContent.turnComplete) {
      queue.push({ type: 'response.done' })
    }
    return
  }

  // goAway（切断予告）等、正規化しきれないイベントは raw escape hatch でそのまま流す
  // （../drift-landmines.md 参照。timeLeft 等の構造化情報を落とさないための意図的な選択）。
  queue.push({ type: 'raw', providerEvent: event })
}

export class GeminiLiveAdapter implements RealtimeVoicePort {
  private readonly apiKey?: string
  private readonly socketFactory: RealtimeSocketFactory
  private readonly codec: AudioCodecPort
  private readonly modelId: string

  constructor(
    opts: {
      apiKey?: string
      socketFactory?: RealtimeSocketFactory
      codec?: AudioCodecPort
      internalModel?: keyof typeof AI_MODELS.gemini
    } = {}
  ) {
    this.apiKey = opts.apiKey
    this.socketFactory = opts.socketFactory ?? requireSocketFactory()
    // 既定は実ダウンサンプル実装（出力 24kHz→16kHz 変換が必須のため、image-gen 系のような
    // passthrough 既定は選ばない。上記ファイル冒頭コメント参照）。
    this.codec = opts.codec ?? geminiDownsampleCodec
    this.modelId = AI_MODELS.gemini[opts.internalModel ?? 'general-purpose']
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey ?? process.env.GEMINI_API_KEY)
  }

  capabilities(): RealtimeCapabilities {
    return {
      // serverContent.interrupted フラグは、サーバが進行中の応答を自動的に打ち切ったことの通知であり
      // （../model-catalog.md「VAD」節に一次情報あり）、アプリ側の明示操作なしに barge-in が起きる
      // ため serverAuto: true とする。一方、アプリ側から能動的に応答をキャンセルする公式な手段
      // （OpenAI の response.cancel 相当）は一次情報で確認できていないため clientCancel: false とする
      // （../model-catalog.md「未確認事項」参照。interrupt() 参照）。
      bargeIn: { serverAuto: true, clientCancel: false },
      serverVad: true,
      // Gemini はレート交渉不可の固定フォーマットのため素通し不可（codec 必須。上記ファイル冒頭コメント参照）。
      directRelayFormats: [],
      parallelToolCalls: false,
      // handle 方式のセッション再開に対応（終了後2時間有効。../session-lifecycle.md 参照）。
      sessionResumption: true,
      // 音声のみ15分・音声+映像2分の非対称な上限があるため、より厳しい方を保守的に採用する。
      maxSessionDurationMs: 15 * 60 * 1000,
    }
  }

  async open(config: RealtimeSessionConfig): Promise<RealtimeVoiceSession> {
    const apiKey = this.apiKey ?? process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new RealtimeVoiceError({
        kind: 'auth',
        message: 'GEMINI_API_KEY が未設定です',
        providerName: 'gemini',
        retryable: false,
        failoverable: false,
      })
    }

    const queue = new RealtimeEventQueue()
    const codec = this.codec
    // callId→name の記憶（sendToolResult() で functionResponses.name を補完するため。tool.call を
    // push するたびに handleGeminiEvent() が set し、応答送出後に sendToolResult() 側で削除する）。
    const pendingToolCalls = new Map<string, string>()
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`
    const socket = this.socketFactory.connect(url)

    // H1: ready が setupComplete でしか resolve されない実装だと、認証失敗等で WS が即座に
    // close/error した場合に open() が永久にハングする（adapter-openai-realtime.ts の同一節参照）。
    let settled = false
    let resolveReady: (() => void) | null = null
    let rejectReady: ((err: unknown) => void) | null = null
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const onReady = (): void => {
      if (settled) return
      settled = true
      resolveReady?.()
    }
    const failBeforeReady = (error: RealtimeVoiceError): void => {
      if (settled) return
      settled = true
      rejectReady?.(error)
    }

    const openTimeoutMs = config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
    const timeoutHandle = setTimeout(() => {
      failBeforeReady(
        new RealtimeVoiceError({
          kind: 'timeout',
          message: `open() が ${openTimeoutMs}ms 以内に session.ready へ到達しませんでした`,
          providerName: 'gemini',
          retryable: true,
          failoverable: true,
        })
      )
      socket.close()
    }, openTimeoutMs)

    socket.onOpen(() => {
      socket.send(JSON.stringify(buildSetupMessage(config, this.modelId)))
    })

    socket.onMessage((raw) => {
      let event: Record<string, unknown>
      try {
        event = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return
      }
      handleGeminiEvent(event, queue, codec, onReady, pendingToolCalls)
    })

    socket.onError((err) => {
      const error = new RealtimeVoiceError({
        kind: 'connection_dropped',
        message: err.message,
        providerName: 'gemini',
        retryable: true,
        failoverable: true,
        sourceError: err,
      })
      queue.push({ type: 'error', error })
      failBeforeReady(error)
    })

    socket.onClose((code, reason) => {
      // 正常クローズ（アプリ側 close() 呼び出し）以外は connection_dropped 等として通知する。
      // 1000（正常終了）はキュー終了のみで足り、エラーイベントは出さない。
      if (code !== 1000) {
        const error = mapGeminiCloseEvent(code, reason)
        queue.push({ type: 'error', error })
        failBeforeReady(error)
      } else if (!settled) {
        // 通常起きないが、ready 到達前に正常クローズした場合も open() を永久ハングさせない。
        failBeforeReady(
          new RealtimeVoiceError({ kind: 'connection_dropped', message: 'ready 到達前に接続が閉じられました', providerName: 'gemini', retryable: true, failoverable: true })
        )
      }
      queue.close()
    })

    try {
      await ready
    } finally {
      clearTimeout(timeoutHandle)
    }

    // close() 後の send 系呼び出しを無言で無視するためのローカルフラグ
    // （LOW: 未接続/close 後ガード。adapter-openai-realtime.ts の同一節参照）。
    let sessionClosed = false

    return {
      events: () => queue,
      sendAudio(chunk: AudioChunk): void {
        if (sessionClosed) return
        const wire = codec.fromCanonical(chunk.data)
        socket.send(
          JSON.stringify({
            realtimeInput: { media: { data: Buffer.from(wire).toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
          })
        )
      },
      sendToolResult(callId: string, result: unknown): void {
        if (sessionClosed) return
        const name = pendingToolCalls.get(callId)
        pendingToolCalls.delete(callId)
        // Gemini の toolResponse は id だけでなく name も要求する（欠落させると疎通しない）。
        // response はオブジェクトを要求するため、非オブジェクトの結果は { result } に包む
        // （port.ts 冒頭コメント「tools」参照）。
        const response = typeof result === 'object' && result !== null ? result : { result }
        socket.send(
          JSON.stringify({
            toolResponse: { functionResponses: [{ id: callId, name: name ?? '', response }] },
          })
        )
      },
      interrupt(_opts?: { itemId?: string; audioEndMs?: number }): void {
        if (sessionClosed) return
        // 自動 barge-in は serverContent.interrupted 経由で観測できる（capabilities().bargeIn.serverAuto）。
        // しかしアプリ側から能動的に応答をキャンセルする公式手段は一次情報で確認できていない
        // （../model-catalog.md「未確認事項」参照）。activityEnd（手動VADの発話終了通知であり応答
        // キャンセルではない）を送る疑似対応は意味論的に誤りだったため撤去し、非対応として明示的に
        // エラーを投げる。
        throw new RealtimeVoiceError({
          kind: 'unsupported',
          message:
            'GeminiLiveAdapter はクライアント起動の応答キャンセル（clientCancel）に対応していません。自動 barge-in は serverContent.interrupted 経由で観測してください。',
          providerName: 'gemini',
          retryable: false,
          failoverable: false,
        })
      },
      async close(): Promise<void> {
        sessionClosed = true
        socket.close()
        queue.close()
      },
    }
  }
}
