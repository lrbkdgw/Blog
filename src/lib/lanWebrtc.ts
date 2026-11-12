/**
 * 离线版「局域网协作」的**零命令**通道（issue #112）。
 *
 * 浏览器不能监听 TCP 端口，两台设备要直连就必须有一台「中继」；为了让用户
 * **不必提前运行 `npm run lan`**，这里改用浏览器原生的 WebRTC DataChannel：
 *
 *   发起方 点「开始协作」→ 生成 offer，压缩成「邀请码」
 *      ↓ 复制给伙伴（粘贴 / 聊天 / 二维码，任意可信渠道）
 *   伙伴   粘贴邀请码 → 生成 answer，压缩成「回应码」→ 发回
 *      ↓
 *   发起方 粘贴回应码 → DTLS/ICE 握手完成 → 两台设备点对点直连
 *
 * 特点：
 *   - **不需要任何服务器、不需要预跑命令、不需要公网**：`iceServers: []`，
 *     只用局域网 host candidate（Chrome 的 mDNS `.local` 候选由 WebRTC 自己在 LAN 内解析）；
 *   - 离线版平时依然一个包都不发，只有点「开始协作」/「加入协作」后才开始收集候选；
 *   - 邀请码 / 回应码只是一次握手的 SDP，不是长期凭证，也不写进文章；
 *   - 传输协议与 WebSocket 中继一致（JSON：`hello` / `post`），上层卡片无需区分通道。
 *
 * 若用户确实运行了 `npm run lan`（高级设置里手填地址），仍可走「只填房间号」的
 * 中继通道（`src/lib/collab.ts` + `src/lib/lanDiscovery.ts`），两条通道并存。
 */
import {
  isValidRoomCode,
  type CollabStatus,
  type LanCollab,
} from './collab'

const CODE_PREFIX = 'SL1'
const CHANNEL_LABEL = 'starlog-lan'
const ICE_GATHER_TIMEOUT_MS = 2500
/** 单个连接码上限，防止粘贴超长内容撑爆内存 */
const MAX_CODE_LENGTH = 20000

export interface WebrtcCollabOptions {
  room: string
  name?: string
  onStatus?: (status: CollabStatus) => void
  onRemotePost?: (slug: string, raw: string, from?: string, nonce?: string) => void
  onPresence?: (peers: number) => void
  onServerError?: (message: string) => void
  /** 测试用：注入假的 RTCPeerConnection */
  RTCPeerConnectionImpl?: new (config: unknown) => RTCPeerConnection
}

export interface WebrtcTransport extends LanCollab {
  dispose(): void
}

interface HandshakeMessage {
  v: 1
  t: 'offer' | 'answer'
  room: string
  name: string
  sdp: string
}

/* ------------------------------- 连接码编解码 ------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 用 ArrayBuffer 作为流转媒介，避开 Uint8Array/BlobPart 的 SharedArrayBuffer 泛型问题 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length)
  new Uint8Array(out).set(bytes)
  return out
}

async function gzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

/** 把 SDP 压成可复制的短码（支持 gzip 时约几百字节，不支持时自动退回原文） */
export async function encodeHandshake(message: HandshakeMessage): Promise<string> {
  let buffer = toArrayBuffer(new TextEncoder().encode(JSON.stringify(message)))
  let flag = '0'
  if (typeof CompressionStream !== 'undefined') {
    try {
      buffer = await gzip(buffer)
      flag = '1'
    } catch {
      // 不支持或压缩失败时用原文
    }
  }
  return `${CODE_PREFIX}${flag}.${toBase64Url(new Uint8Array(buffer))}`
}

export async function decodeHandshake(input: string): Promise<HandshakeMessage> {
  const text = input.trim().replace(/\s+/g, '')
  if (text.length > MAX_CODE_LENGTH) throw new Error('连接码过长，请确认复制完整且没有混入别的文本')
  const dot = text.indexOf('.')
  if (!text.startsWith(CODE_PREFIX) || dot !== 4) throw new Error('这不是 Starlog 协作连接码')
  const flag = text[3]
  let buffer: ArrayBuffer
  try {
    buffer = toArrayBuffer(fromBase64Url(text.slice(dot + 1)))
    if (flag === '1') buffer = await gunzip(buffer)
    else if (flag !== '0') throw new Error('未知编码')
  } catch {
    throw new Error('连接码已损坏，请重新复制完整的一串字符')
  }
  let message: HandshakeMessage
  try {
    message = JSON.parse(new TextDecoder().decode(buffer)) as HandshakeMessage
  } catch {
    throw new Error('连接码内容无法解析')
  }
  if (
    message?.v !== 1 ||
    (message.t !== 'offer' && message.t !== 'answer') ||
    typeof message.sdp !== 'string' ||
    !message.sdp ||
    !isValidRoomCode(message.room)
  ) {
    throw new Error('连接码不是有效的 Starlog 协作邀请 / 回应')
  }
  return message
}

/* ------------------------------- DataChannel ------------------------------ */

interface WireMessage {
  kind: string
  room?: string
  name?: string
  slug?: string
  raw?: string
  from?: string
  nonce?: string
}

class WebrtcCollabImpl implements WebrtcTransport {
  private current: CollabStatus = 'idle'
  private channel: RTCDataChannel | null = null
  private listeners = new Set<(status: CollabStatus) => void>()
  private closedByUser = false

  constructor(
    private readonly options: WebrtcCollabOptions,
    private readonly pc: RTCPeerConnection,
  ) {}

  get status(): CollabStatus {
    return this.current
  }

  subscribe(handler: (status: CollabStatus) => void): () => void {
    this.listeners.add(handler)
    handler(this.status)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private setStatus(next: CollabStatus) {
    this.current = next
    for (const listener of [...this.listeners]) listener(next)
    this.options.onStatus?.(next)
  }

  /** 由 createWebrtcHost / createWebrtcGuest 在拿到 channel 后调用 */
  attachChannel(channel: RTCDataChannel) {
    this.channel = channel
    channel.onopen = () => {
      this.setStatus('connected')
      this.options.onPresence?.(2)
      this.send({ kind: 'hello', room: this.options.room, name: this.options.name })
    }
    channel.onmessage = (event) => {
      let message: WireMessage
      try {
        message = JSON.parse(String(event.data)) as WireMessage
      } catch {
        return
      }
      if (message.kind === 'post' && message.slug && typeof message.raw === 'string') {
        this.options.onRemotePost?.(message.slug, message.raw, message.from, message.nonce)
      }
    }
    channel.onclose = () => {
      if (!this.closedByUser && this.current !== 'error') this.setStatus('closed')
    }
    channel.onerror = () => {
      this.setStatus('error')
      this.options.onServerError?.('点对点连接中断，请重新发起协作')
    }
  }

  private send(message: WireMessage): boolean {
    if (!this.channel || this.channel.readyState !== 'open') return false
    this.channel.send(JSON.stringify(message))
    return true
  }

  /** WebRTC 通道不需要地址；调用即进入「正在连接」 */
  connect(_url = '') {
    this.closedByUser = false
    this.setStatus('connecting')
  }

  disconnect() {
    this.closedByUser = true
    try {
      this.channel?.close()
    } catch {
      // 已关闭时忽略
    }
    try {
      this.pc.close()
    } catch {
      // 已关闭时忽略
    }
    if (this.current !== 'idle') this.setStatus('idle')
  }

  dispose() {
    this.disconnect()
  }

  sendPost(slug: string, raw: string, nonce?: string): boolean {
    if (this.current !== 'connected') return false
    return this.send({
      kind: 'post',
      room: this.options.room,
      slug,
      raw,
      from: this.options.name,
      nonce,
    })
  }
}

/** 等 ICE 候选收集完成；超时也继续（localDescription 里已有部分候选） */
function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolveWait) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      pc.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolveWait()
    }
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

function makePeerConnection(options: WebrtcCollabOptions): RTCPeerConnection {
  const Ctor = options.RTCPeerConnectionImpl ?? globalThis.RTCPeerConnection
  if (!Ctor) throw new Error('当前浏览器不支持 WebRTC，无法使用免命令协作')
  // 不配置任何 STUN/TURN：只用局域网 host candidate，绝不连公网
  return new Ctor({ iceServers: [] })
}

/* -------------------------------- 发起方 --------------------------------- */

export interface WebrtcHost {
  offerCode: string
  collab: WebrtcTransport
  /** 收到伙伴的「回应码」后完成握手 */
  applyAnswer(answerCode: string): Promise<void>
}

export async function createWebrtcHost(options: WebrtcCollabOptions): Promise<WebrtcHost> {
  const room = options.room.trim()
  if (!isValidRoomCode(room)) throw new Error('房间号无效（1–32 位字母、数字、-、_）')
  const pc = makePeerConnection(options)
  const collab = new WebrtcCollabImpl({ ...options, room }, pc)
  try {
    collab.attachChannel(pc.createDataChannel(CHANNEL_LABEL))
    await pc.setLocalDescription(await pc.createOffer())
    await waitForIce(pc)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error('无法生成协作邀请')
    const offerCode = await encodeHandshake({
      v: 1,
      t: 'offer',
      room,
      name: options.name?.trim() || '匿名设备',
      sdp,
    })
    collab.connect()
    return {
      offerCode,
      collab,
      applyAnswer: async (answerCode: string) => {
        const message = await decodeHandshake(answerCode)
        if (message.t !== 'answer') throw new Error('需要粘贴伙伴的「回应码」，而不是邀请码')
        if (message.room !== room) throw new Error('回应码里的房间号与本次协作不一致')
        await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
      },
    }
  } catch (err) {
    collab.dispose()
    throw err
  }
}

/* -------------------------------- 加入方 --------------------------------- */

export interface WebrtcGuest {
  answerCode: string
  room: string
  collab: WebrtcTransport
}

export async function createWebrtcGuest(
  offerCode: string,
  options: WebrtcCollabOptions,
): Promise<WebrtcGuest> {
  const offer = await decodeHandshake(offerCode)
  if (offer.t !== 'offer') throw new Error('需要粘贴发起方的「邀请码」，而不是回应码')
  const pc = makePeerConnection(options)
  const collab = new WebrtcCollabImpl({ ...options, room: offer.room }, pc)
  try {
    pc.ondatachannel = (event) => collab.attachChannel(event.channel)
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
    await pc.setLocalDescription(await pc.createAnswer())
    await waitForIce(pc)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error('无法生成协作回应')
    const answerCode = await encodeHandshake({
      v: 1,
      t: 'answer',
      room: offer.room,
      name: options.name?.trim() || '匿名设备',
      sdp,
    })
    collab.connect()
    return { answerCode, room: offer.room, collab }
  } catch (err) {
    collab.dispose()
    throw err
  }
}
