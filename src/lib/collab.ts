/**
 * 离线版「局域网协作」客户端传输层（issue #112，预览能力）。
 *
 * 离线单文件版不联网，但同一局域网里的几台设备可以共用一台**协作中继**
 * （`scripts/lan-collab-server.mjs`，零依赖的 Node 脚本）：
 * 谁把文章写进自己的本机文章库，就通过 WebSocket 把原始 Markdown 推送给中继，
 * 中继再转发给同一房间里的其他设备——这就是「局域网内共同编辑同一文档」。
 *
 * 设计上的硬约束：
 *   - 连接地址永远由用户在界面上显式填写，代码不会去猜任何公共端点；
 *     离线版的构建自检也会挡住在线端点，所以这里不引入任何远程默认地址。
 *   - 只有用户点击「连接」才会建立连接：离线版平时仍然一个包都不发。
 *   - 只依赖浏览器原生的 WebSocket，不引入第三方库。
 *   - 同步的是**原始 Markdown**（含 frontmatter 与加密字段），不是重新序列化的
 *     Post 对象：加密文章、自定义字段都不会在往返中丢失。
 *
 * 协议（JSON 文本帧，与 scripts/lan-collab-server.mjs 一一对应）：
 *   客户端 → 服务端：{kind:'hello', room, name} / {kind:'post', room, slug, raw, nonce} / {kind:'ping'}
 *   服务端 → 客户端：{kind:'welcome', room, peers, posts} / {kind:'update', room, slug, raw, from, nonce}
 *                   / {kind:'presence', room, peers} / {kind:'pong'} / {kind:'error', message}
 */

/** 协作连接状态 */
export type CollabStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

export interface LanCollabOptions {
  /** 房间号：同一房间的设备互相同步（1–32 位字母、数字、-、_） */
  room: string
  /** 展示在中继里的名字（默认「匿名设备」） */
  name?: string
  onStatus?: (status: CollabStatus) => void
  /** 收到协作房间里其他设备推送的文章（原始 Markdown） */
  onRemotePost?: (slug: string, raw: string, from?: string, nonce?: string) => void
  /** 房间里在线设备数变化 */
  onPresence?: (peers: number) => void
  /** 中继返回的错误说明 */
  onServerError?: (message: string) => void
}

export interface LanCollab {
  readonly status: CollabStatus
  /** 建立连接；地址非法时置为 error 并回调说明 */
  connect(url: string): void
  disconnect(): void
  /** 把一篇文章推送给协作房间里的其他设备；未连接时返回 false */
  sendPost(slug: string, raw: string, nonce?: string): boolean
  subscribe(handler: (status: CollabStatus) => void): () => void
}

/** 中继默认端口（与 scripts/lan-collab-server.mjs 一致） */
export const LAN_COLLAB_DEFAULT_PORT = 8787

/**
 * 默认填进输入框的地址。
 *
 * 离线版通常是 `file://` 直接打开的，此时 `window.location` 没有主机名，
 * 猜不出局域网地址，所以这里只给「跑中继的那台机器」的本机地址，
 * 并提示用户改成这台机器在局域网里的 IP（如 `ws://192.168.1.5:8787`）。
 */
export function defaultServerUrl(): string {
  return `ws://localhost:${LAN_COLLAB_DEFAULT_PORT}`
}

/** 浏览器是否支持 WebSocket（不支持时界面给出说明而不是静默失败） */
export function isLanCollabSupported(): boolean {
  return typeof WebSocket !== 'undefined'
}

/** 房间号是否合法（与中继的 isValidRoomCode 一致） */
export function isValidRoomCode(room: string): boolean {
  return room.length >= 1 && room.length <= 32 && /^[A-Za-z0-9_-]+$/.test(room)
}

/**
 * 规范化用户填写的中继地址：
 * 允许贴 `http://` / `https://`（自动换成 ws / wss），清掉凭据与多余路径，
 * 非 ws(s) 协议直接拒绝——离线版不需要、也不允许借这个入口访问别的协议。
 */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let url = raw
  if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, 'ws')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null
  if (!parsed.hostname) return null
  parsed.username = ''
  parsed.password = ''
  parsed.pathname = '/'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

interface WireMessage {
  kind: string
  room?: string
  name?: string
  slug?: string
  raw?: string
  posts?: { slug: string; raw: string }[]
  peers?: number
  from?: string
  nonce?: string
  message?: string
}

class LanCollabImpl implements LanCollab {
  private current: CollabStatus = 'idle'
  private socket: WebSocket | null = null
  private closedByUser = true
  private listeners = new Set<(status: CollabStatus) => void>()

  constructor(private readonly options: LanCollabOptions) {}

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

  private send(message: WireMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify({ ...message, room: this.options.room, name: this.options.name }))
    return true
  }

  connect(url: string) {
    const target = normalizeServerUrl(url)
    if (!target) {
      this.setStatus('error')
      return
    }
    if (!isValidRoomCode(this.options.room.trim())) {
      this.setStatus('error')
      return
    }
    this.disconnect()
    this.closedByUser = false
    this.setStatus('connecting')
    try {
      this.socket = new WebSocket(target)
    } catch {
      this.setStatus('error')
      return
    }
    this.socket.onopen = () => {
      this.setStatus('connected')
      this.send({ kind: 'hello' })
    }
    this.socket.onmessage = (event) => {
      let message: WireMessage
      try {
        message = JSON.parse(String(event.data)) as WireMessage
      } catch {
        return
      }
      if (message.kind === 'welcome') {
        for (const post of message.posts ?? []) {
          if (post.slug && typeof post.raw === 'string') {
            this.options.onRemotePost?.(post.slug, post.raw)
          }
        }
        if (typeof message.peers === 'number') this.options.onPresence?.(message.peers)
        return
      }
      if (message.kind === 'update') {
        if (message.slug && typeof message.raw === 'string') {
          this.options.onRemotePost?.(message.slug, message.raw, message.from, message.nonce)
        }
        return
      }
      if (message.kind === 'presence') {
        if (typeof message.peers === 'number') this.options.onPresence?.(message.peers)
        return
      }
      if (message.kind === 'error') {
        this.options.onServerError?.(message.message || '中继返回了错误')
      }
    }
    this.socket.onerror = () => {
      // 浏览器不暴露具体原因，界面上按「连不上」处理
      this.setStatus('error')
    }
    this.socket.onclose = () => {
      this.socket = null
      // onerror 先置 error 时不要让 close 把它盖成「已断开」，界面上要保留失败原因
      if (!this.closedByUser && this.current === 'error') return
      this.setStatus(this.closedByUser ? 'idle' : 'closed')
    }
  }

  disconnect() {
    this.closedByUser = true
    this.socket?.close()
    this.socket = null
    if (this.current !== 'idle') this.setStatus('idle')
  }

  sendPost(slug: string, raw: string, nonce?: string): boolean {
    if (this.current !== 'connected') return false
    return this.send({ kind: 'post', slug, raw, nonce })
  }

  /** 组件卸载时断开连接 */
  dispose() {
    this.disconnect()
  }
}

/** 创建一次协作连接；`dispose()` 用于组件卸载时断开。 */
export function createLanCollab(options: LanCollabOptions): LanCollab & { dispose(): void } {
  return new LanCollabImpl(options)
}
