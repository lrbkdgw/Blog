/**
 * 离线版「局域网协作」客户端传输层（issue #112，预览能力）。
 *
 * 离线单文件版不联网，但同一局域网里的几台设备可以共用一台**协作中继**
 * （`scripts/lan-collab-server.mjs`，零依赖的 Node 脚本）：
 * 谁把文章写进自己的本机文章库，就通过 WebSocket 把它推送给中继，
 * 中继再转发给同一文档里的其他设备——这就是「局域网内共同编辑同一文档」。
 *
 * 设计上的硬约束：
 *   - 连接地址永远由用户在界面上显式填写，代码不会去猜任何公共端点；
 *     离线版的构建自检也会挡住在线端点，所以这里不引入任何远程默认地址。
 *   - 只有用户点击「连接」才会建立连接：离线版平时仍然一个包都不发。
 *   - 只依赖浏览器原生的 WebSocket，不引入第三方库。
 *
 * 协议（JSON 文本帧，与 scripts/lan-collab-server.mjs 一一对应）：
 *   客户端 → 服务端：{kind:'hello'} / {kind:'request'} / {kind:'post'}
 *   服务端 → 客户端：{kind:'hello'} / {kind:'sync'} / {kind:'update'} / {kind:'error'}
 */

/** 协作连接状态 */
export type CollabStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

export interface LanSyncOptions {
  /** 文档 ID：同一文档里的设备互相同步 */
  docId: string
  /** 展示在中继状态页里的名字 */
  name?: string
  onStatus?: (status: CollabStatus) => void
  /** 收到协作文档里其他设备推送的文章 */
  onRemotePost?: (docId: string, post: unknown, nonce?: string) => void
  /** 中继返回的错误说明 */
  onServerError?: (message: string) => void
}

export interface LanSync {
  readonly status: CollabStatus
  /** 建立连接；地址非法时置为 error 并回调说明 */
  connect(url: string): void
  disconnect(): void
  /** 把一篇文章推送给协作文档里的其他设备；未连接时返回 false */
  sendPost(post: unknown, nonce?: string): boolean
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
  docId?: string
  name?: string
  post?: unknown
  posts?: unknown[]
  nonce?: string
  message?: string
}

class LanSyncImpl implements LanSync {
  private current: CollabStatus = 'idle'
  private socket: WebSocket | null = null
  private closedByUser = true
  private listeners = new Set<(status: CollabStatus) => void>()

  constructor(private readonly options: LanSyncOptions) {}

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
    this.socket.send(JSON.stringify({ ...message, docId: this.options.docId, name: this.options.name }))
    return true
  }

  connect(url: string) {
    const target = normalizeServerUrl(url)
    if (!target) {
      this.setStatus('error')
      return
    }
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
      this.send({ kind: 'request', nonce: 'initial' })
    }
    this.socket.onmessage = (event) => {
      let message: WireMessage
      try {
        message = JSON.parse(String(event.data)) as WireMessage
      } catch {
        return
      }
      if (message.kind === 'sync') {
        // 中继把这份文档里已有的文章一次性推回来：写入本机文章库，避免各设备各写一份
        for (const post of message.posts ?? []) {
          this.options.onRemotePost?.(message.docId ?? this.options.docId, post, message.nonce)
        }
        return
      }
      if (message.kind === 'update') {
        this.options.onRemotePost?.(message.docId ?? this.options.docId, message.post, message.nonce)
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
      this.setStatus(this.closedByUser ? 'idle' : 'closed')
    }
  }

  disconnect() {
    this.closedByUser = true
    this.socket?.close()
    this.socket = null
    if (this.current !== 'idle') this.setStatus('idle')
  }

  sendPost(post: unknown, nonce?: string): boolean {
    if (this.current !== 'connected') return false
    return this.send({ kind: 'post', post, nonce })
  }

  /** 组件卸载时断开连接 */
  dispose() {
    this.disconnect()
  }
}

/** 创建一次协作连接；`dispose()` 用于组件卸载时断开。 */
export function createLanSync(options: LanSyncOptions): LanSync & { dispose(): void } {
  return new LanSyncImpl(options)
}
