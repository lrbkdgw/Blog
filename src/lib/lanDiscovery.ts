/**
 * 局域网协作中继的「自动发现」（issue #112）。
 *
 * 目标：**只输入房间号就能连上**。浏览器（尤其是 file:// 打开的离线单文件）
 * 没有 mDNS / UDP 广播能力，也不允许预先内置任何公网地址，因此这里用
 * 「本机地址提示 + 局域网候选探测」的方式找出用户自己启动的那台中继：
 *
 *   1. 若离线 HTML 是由中继本身提供的（打开 http://中继IP:8787/），
 *      直接用 location.host —— **零探测**，输入房间号即可连接；
 *   2. 否则先试上次成功的中继、本机 localhost、WebRTC 暴露的局域网 IP、
 *      常见网关地址，再按需扫描常见私网网段上的 8787 端口；
 *   3. 探测不是只看 TCP 通不通：必须发一条 hello 并收到同房间的 welcome，
 *      确认那确实是 Starlog 协作中继，避免误连别的 WebSocket 服务。
 *
 * 所有探测都只在用户点击「连接」之后发生，且可以被取消（AbortSignal）；
 * 找不到时界面会引导手动填地址，或从中继打印的 http:// 地址打开页面。
 */
import { LAN_COLLAB_DEFAULT_PORT, normalizeServerUrl } from './collab'

/** 常见私网网段：完整扫描的与只试常见主机号的 */
const FULL_SCAN_SUBNETS = ['192.168.0', '192.168.1', '10.0.0', '10.0.1']
const QUICK_SCAN_SUBNETS = [
  '192.168.2', '192.168.3', '192.168.4', '192.168.5',
  '172.16.0', '172.17.0', '172.18.0', '172.19.0', '172.20.0', '172.31.0',
]
const QUICK_HOSTS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25,
  30, 40, 50, 64, 65, 66, 67, 68, 77, 88, 99,
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
  120, 130, 140, 150, 160, 180, 200, 201, 254,
]

export interface DiscoveryProgress {
  tried: number
  total: number
  /** 当前正在探测的地址（用于界面提示） */
  url?: string
}

export interface DiscoveryOptions {
  room: string
  port?: number
  signal?: AbortSignal
  onProgress?: (progress: DiscoveryProgress) => void
  /** 上次成功连接过的中继地址（优先探测，重连基本瞬时） */
  lastUrl?: string
  /** 覆盖 location，测试用 */
  locationLike?: { protocol?: string; host?: string; hostname?: string }
  /** 覆盖本机地址提示（IP 或 .local 域名），测试用 */
  addressHints?: string[]
  /** 完全自定义候选（测试用） */
  candidates?: string[]
  /** 跳过 WebRTC 地址提示探测（测试用） */
  skipLocalHints?: boolean
  /** 单个地址的探测超时（毫秒） */
  probeTimeoutMs?: number
  /** 并发探测数 */
  concurrency?: number
  /** 覆盖 WebSocket 实现（测试用） */
  WebSocketImpl?: typeof WebSocket
}

/** 是否是可用的私网 IPv4（排除回环、组播与 0.0.0.0） */
export function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number)
  if ([a, b, c, d].some((n) => n > 255)) return false
  if (a === 127 || a === 0 || a >= 224) return false
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/**
 * 从当前页面地址推断中继地址：离线 HTML 由中继本身提供时（http://IP:8787/）
 * 不需要任何扫描，直接返回 ws://IP:8787。
 */
export function relayUrlFromLocation(
  loc?: { protocol?: string; host?: string; hostname?: string },
  port = LAN_COLLAB_DEFAULT_PORT,
): string | null {
  const target = loc ?? (typeof location !== 'undefined' ? location : undefined)
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) return null
  if (!target.hostname) return null
  // 中继是纯 HTTP/WebSocket（没有 TLS），所以固定用 ws://
  const host = target.host === `${target.hostname}:${port}` ? target.host : `${target.hostname}:${port}`
  return normalizeServerUrl(`ws://${host}`)
}

/** 构造按优先级排序、去重后的候选地址列表（纯函数，便于测试） */
export function buildCandidateUrls(options: DiscoveryOptions = { room: '' }): string[] {
  const port = options.port ?? LAN_COLLAB_DEFAULT_PORT
  const result: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const url = normalizeServerUrl(raw)
    if (url && !seen.has(url)) {
      seen.add(url)
      result.push(url)
    }
  }
  const addHost = (host: string, p = port) => {
    if (host) add(`ws://${host}:${p}`)
  }
  const addRawHost = (host: string) => {
    if (host) add(`ws://${host}`)
  }

  // ① 上次连过的中继 / 中继自己提供的页面 / 本机
  if (options.lastUrl) add(options.lastUrl)
  const loc = options.locationLike ?? (typeof location !== 'undefined' ? location : undefined)
  if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:')) {
    const fromPage = relayUrlFromLocation(loc, port)
    if (fromPage) add(fromPage)
    // 页面若跑在其他端口（如 vite preview），中继仍可能在同一台机器的 8787
    addHost(loc.hostname ?? '', port)
  }
  addHost('localhost')
  addHost('127.0.0.1')

  // ② WebRTC 暴露的本机地址 + 该网段网关（最快命中真实局域网）
  const hints = options.addressHints ?? []
  const subnets = new Set<string>()
  for (const hint of hints) {
    if (/\.local$/i.test(hint)) {
      addHost(hint)
      continue
    }
    if (!isPrivateIPv4(hint)) continue
    addHost(hint)
    const prefix = hint.split('.').slice(0, 3).join('.')
    subnets.add(prefix)
    addHost(`${prefix}.1`)
    addHost(`${prefix}.254`)
  }

  // ③ 已知网段全量 /24；④ 常见网段只试 DHCP 常见主机号
  for (const prefix of subnets) {
    for (let i = 1; i <= 254; i += 1) addHost(`${prefix}.${i}`)
  }
  for (const prefix of FULL_SCAN_SUBNETS) {
    for (let i = 1; i <= 254; i += 1) addHost(`${prefix}.${i}`)
  }
  for (const prefix of QUICK_SCAN_SUBNETS) {
    for (const i of QUICK_HOSTS) addHost(`${prefix}.${i}`)
  }
  // ⑤ 兜底：.local 域名（部分系统浏览器可解析 mDNS）
  for (const hint of hints) {
    if (/\.local$/i.test(hint)) addRawHost(`${hint}:${port}`)
  }
  return result
}

/**
 * 用 WebRTC 的 host candidate 拿到本机局域网 IP。
 * 现代浏览器常把它们混淆成 `<uuid>.local`，这时也返回该域名作为候选
 * （macOS / Safari 等能直接解析）；拿不到就返回空数组，交给网段扫描兜底。
 */
export async function getLocalAddressHints(timeoutMs = 900): Promise<string[]> {
  const Ctor = (globalThis as unknown as { RTCPeerConnection?: new (config: unknown) => any })
    .RTCPeerConnection
  if (!Ctor) return []
  try {
    const pc = new Ctor({ iceServers: [] })
    const hints = new Set<string>()
    pc.onicecandidate = (event: { candidate?: { candidate?: string } }) => {
      const line = String(event?.candidate?.candidate ?? '')
      for (const m of line.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)) {
        if (isPrivateIPv4(m[1])) hints.add(m[1])
      }
      for (const m of line.matchAll(/\b([0-9a-f]{8}-[0-9a-f-]{20,}\.local)\b/gi)) {
        hints.add(m[1])
      }
    }
    pc.createDataChannel('starlog-lan')
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise((resolveWait) => setTimeout(resolveWait, timeoutMs))
    try {
      pc.close()
    } catch {
      // 某些实现在已关闭后调用 close 会抛错，忽略即可
    }
    return [...hints]
  } catch {
    return []
  }
}

/** 单个候选：连上后发 hello，必须收到同房间的 welcome 才算找到中继 */
function probeRelay(
  url: string,
  room: string,
  timeoutMs: number,
  Impl: typeof WebSocket,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    if (signal?.aborted) {
      resolveProbe(false)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket
    try {
      ws = new Impl(url)
    } catch {
      resolveProbe(false)
      return
    }
    let done = false
    const onAbort = () => finish(false)
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        ws.close()
      } catch {
        // 连接尚未建立时 close 可能抛错，忽略
      }
      resolveProbe(ok)
    }
    timer = setTimeout(() => finish(false), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    ws.onopen = () => {
      try {
        // probe 标记让中继只回 welcome 确认身份，不把探针算作在线设备
        ws.send(JSON.stringify({ kind: 'hello', room, name: 'discover', probe: true }))
      } catch {
        finish(false)
      }
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { kind?: string; room?: string }
        if (msg.kind === 'welcome' && msg.room === room) finish(true)
        else if (msg.kind === 'error') finish(false)
      } catch {
        // 不是 JSON：忽略，等超时
      }
    }
    ws.onerror = () => finish(false)
    ws.onclose = () => finish(false)
  })
}

/** 自动发现中继；返回可直接传给 createLanCollab().connect() 的地址，或 null */
export async function discoverLanRelay(options: DiscoveryOptions): Promise<string | null> {
  const {
    room,
    signal,
    onProgress,
    probeTimeoutMs = 800,
    concurrency = 32,
    WebSocketImpl = globalThis.WebSocket,
    skipLocalHints = false,
  } = options
  if (!WebSocketImpl) return null
  const hints =
    options.addressHints ?? (skipLocalHints ? [] : await getLocalAddressHints())
  if (signal?.aborted) return null
  const candidates = (options.candidates ?? buildCandidateUrls({ ...options, addressHints: hints }))
    .map((url) => normalizeServerUrl(url))
    .filter((url): url is string => url !== null)
  onProgress?.({ tried: 0, total: candidates.length })

  let index = 0
  let tried = 0
  let found: string | null = null
  const worker = async () => {
    while (found === null && !signal?.aborted) {
      const i = index++
      if (i >= candidates.length) break
      const url = candidates[i]
      const ok = await probeRelay(url, room, probeTimeoutMs, WebSocketImpl, signal)
      tried += 1
      // 探测上千个地址时避免每个都触发一次 React 重渲染
      if (tried % 16 === 0 || tried === candidates.length || ok) {
        onProgress?.({ tried, total: candidates.length, url })
      }
      if (ok) found = url
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, candidates.length)) },
    () => worker(),
  )
  await Promise.all(workers)
  return signal?.aborted ? null : found
}
