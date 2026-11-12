/**
 * 局域网协作中继（issue #112，仅离线版使用）。
 *
 * 离线单文件版本身不联网、没有服务器，所以局域网协作需要一台「中继」：
 * 在局域网里任意一台设备上运行本脚本（`npm run lan`），其他设备只需**填房间号**：
 * 页面会自动在局域网里找到中继（src/lib/lanDiscovery.ts）；中继同时也把编译好的
 * offline/index.html 通过 http://IP:8787/ 提供给其他设备，从这个地址打开时零探测直连。
 *
 * 设计约束（与离线版「完全不联网」原则的边界）：
 *   - 本脚本只在用户显式运行时才监听；离线版平时一个包都不发，
 *     只有用户在界面点「连接」后才连到这里（见 src/lib/collab.ts）。
 *   - 零第三方依赖：只用 Node 内置的 http / crypto / os，Node 18+ 即可运行。
 *   - 只在局域网内使用：不要把端口暴露到公网（房间号不是密码，见下方说明）。
 *   - 房间号是唯一的「门」：同一房间的设备互相同步，不同房间互不可见。
 *     它不是安全凭证——同一局域网里任何人猜到房间号都能加入，
 *     所以只在可信局域网（家庭 / 办公室 / 课堂）里使用。
 *
 * 协议（JSON 文本帧，客户端见 src/lib/collab.ts）：
 *   客户端 → 服务端：
 *     {kind:'hello', room, name}            加入房间（连接后第一条）
 *     {kind:'hello', room, probe:true}      自动发现探针：只回 welcome、不加入房间
 *     {kind:'post', room, slug, raw, nonce} 推送一篇文章的原始 Markdown
 *     {kind:'ping'}                          心跳
 *   服务端 → 客户端：
 *     {kind:'welcome', room, peers, posts:[{slug, raw}]}  房间里已有的全部文章
 *     {kind:'update', room, slug, raw, from, nonce}       其他设备推送的文章
 *     {kind:'presence', room, peers}                      在线设备数变化
 *     {kind:'pong'} / {kind:'error', message}
 *
 * 用法：
 *   npm run lan [--port 8787] [--host 0.0.0.0] [--html offline/index.html]
 *   node scripts/lan-collab-server.mjs --port 8787
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const DEFAULT_PORT = 8787
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024 // 单篇 Markdown 上限（远大于正常文章，防误发撑爆内存）
const MAX_ROOM_CODE_LENGTH = 32

/** 校验房间号：只允许字母数字与少量分隔符，长度 1–32 */
export function isValidRoomCode(room) {
  return typeof room === 'string' && room.length >= 1 && room.length <= MAX_ROOM_CODE_LENGTH && /^[A-Za-z0-9_-]+$/.test(room)
}

/** 计算 WebSocket 握手 Accept（RFC 6455 §4.2.1） */
export function websocketAccept(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}

/** 编码一帧服务端文本消息（服务端帧不加掩码） */
export function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

/** 编码一帧控制帧（ping/pong/close） */
export function encodeControlFrame(opcode, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload])
}

/**
 * 解析客户端帧（客户端帧必须加掩码，RFC 6455 §5.3）。
 * 返回 {fin, opcode, payload} 或 null（数据不足，需要更多字节）。
 * 抛错表示协议错误（未掩码 / 长度过大），调用方应关闭连接。
 */
export function decodeClientFrame(buffer) {
  if (buffer.length < 2) return null
  const b0 = buffer[0]
  const b1 = buffer[1]
  const fin = (b0 & 0x80) !== 0
  const opcode = b0 & 0x0f
  const masked = (b1 & 0x80) !== 0
  if (!masked) throw new Error('客户端帧未加掩码')
  let offset = 2
  let len = b1 & 0x7f
  if (len === 126) {
    if (buffer.length < 4) return null
    len = buffer.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buffer.length < 10) return null
    const big = buffer.readBigUInt64BE(2)
    if (big > BigInt(MAX_MESSAGE_BYTES)) throw new Error('消息过大')
    len = Number(big)
    offset = 10
  }
  if (len > MAX_MESSAGE_BYTES) throw new Error('消息过大')
  if (buffer.length < offset + 4 + len) return null
  const mask = buffer.subarray(offset, offset + 4)
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len))
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
  return { fin, opcode, payload, consumed: offset + 4 + len }
}

/** 列出本机局域网 IPv4 地址（供启动时打印，方便用户在其他设备上填写） */
export function listLanAddresses() {
  const addrs = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) addrs.push(item.address)
    }
  }
  return addrs
}

/**
 * 默认提供给局域网其他设备的离线单文件：优先仓库里编译好的 offline/index.html，
 * 其次本地刚构建的 dist-offline/index.html；都没有时退回纯文本说明页。
 */
export function defaultHtmlPath() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const candidate of [
    resolve(repoRoot, 'offline/index.html'),
    resolve(repoRoot, 'dist-offline/index.html'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * 创建协作中继服务器（供 CLI 与测试共用）。
 * 返回 {server, close, rooms}，rooms 仅供测试断言。
 */
export function createLanCollabServer({
  port = DEFAULT_PORT,
  host = '0.0.0.0',
  htmlPath = defaultHtmlPath(),
} = {}) {
  /** room -> {clients:Set<socket>, posts:Map<slug,{raw,from}>, names:Map<socket,string>} */
  const rooms = new Map()
  /** 所有已升级的 socket（含还没加入房间的），关闭服务器时逐一断开 */
  const sockets = new Set()

  function getRoom(code) {
    let room = rooms.get(code)
    if (!room) {
      room = { clients: new Set(), posts: new Map(), names: new Map() }
      rooms.set(code, room)
    }
    return room
  }

  function send(socket, obj) {
    try {
      socket.write(encodeTextFrame(JSON.stringify(obj)))
    } catch {
      // 发送失败（连接已断）直接忽略，close 处理会清理
    }
  }

  function broadcast(room, obj, except = null) {
    for (const client of room.clients) {
      if (client !== except) send(client, obj)
    }
  }

  function broadcastPresence(roomCode) {
    const room = rooms.get(roomCode)
    if (!room) return
    broadcast(room, { kind: 'presence', room: roomCode, peers: room.clients.size })
  }

  function handleMessage(socket, state, text) {
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      send(socket, { kind: 'error', message: '消息不是有效的 JSON' })
      return
    }
    if (!msg || typeof msg !== 'object') {
      send(socket, { kind: 'error', message: '消息格式错误' })
      return
    }

    if (msg.kind === 'ping') {
      send(socket, { kind: 'pong' })
      return
    }

    if (msg.kind === 'hello') {
      const roomCode = typeof msg.room === 'string' ? msg.room.trim() : ''
      if (!isValidRoomCode(roomCode)) {
        send(socket, { kind: 'error', message: '房间号无效（1–32 位字母、数字、-、_）' })
        return
      }
      // 自动发现探针（src/lib/lanDiscovery.ts）：只回 welcome 确认「这里确实是中继」，
      // 不加入房间、不广播 presence，避免探测期间房间里凭空多出几十台设备。
      if (msg.probe === true) {
        const existing = rooms.get(roomCode)
        const posts = existing
          ? [...existing.posts.entries()].map(([slug, entry]) => ({ slug, raw: entry.raw }))
          : []
        send(socket, { kind: 'welcome', room: roomCode, peers: existing?.clients.size ?? 0, posts })
        return
      }
      // 换房间：先离开旧房间
      if (state.room && state.room !== roomCode) {
        const old = rooms.get(state.room)
        if (old) {
          old.clients.delete(socket)
          old.names.delete(socket)
          if (old.clients.size === 0) rooms.delete(state.room)
          else broadcastPresence(state.room)
        }
      }
      state.room = roomCode
      state.name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 40) : '匿名设备'
      const room = getRoom(roomCode)
      room.clients.add(socket)
      room.names.set(socket, state.name)
      const posts = [...room.posts.entries()].map(([slug, entry]) => ({ slug, raw: entry.raw }))
      send(socket, { kind: 'welcome', room: roomCode, peers: room.clients.size, posts })
      broadcast(room, { kind: 'presence', room: roomCode, peers: room.clients.size }, socket)
      return
    }

    if (msg.kind === 'post') {
      if (!state.room) {
        send(socket, { kind: 'error', message: '请先发送 hello 加入房间' })
        return
      }
      const slug = typeof msg.slug === 'string' ? msg.slug.trim() : ''
      const raw = typeof msg.raw === 'string' ? msg.raw : ''
      if (!slug || !raw) {
        send(socket, { kind: 'error', message: '文章内容为空' })
        return
      }
      if (raw.length > MAX_MESSAGE_BYTES) {
        send(socket, { kind: 'error', message: '文章过大，无法同步' })
        return
      }
      const room = getRoom(state.room)
      room.posts.set(slug, { raw, from: state.name })
      broadcast(room, { kind: 'update', room: state.room, slug, raw, from: state.name, nonce: msg.nonce }, socket)
      return
    }

    send(socket, { kind: 'error', message: `未知消息类型：${String(msg.kind)}` })
  }

  // 把编译好的离线单文件直接提供给局域网里的其他设备：
  // 从这个地址打开页面时，客户端能用 location.host 认出中继，做到「只填房间号」。
  let htmlBuffer = null
  if (htmlPath && existsSync(htmlPath)) {
    try {
      htmlBuffer = readFileSync(htmlPath)
    } catch {
      htmlBuffer = null
    }
  }

  const server = createServer((req, res) => {
    const pathname = String(req.url ?? '/').split('?')[0]
    if (htmlBuffer && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': htmlBuffer.length,
        'Cache-Control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : htmlBuffer)
      return
    }
    if (htmlBuffer && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('starlog-lan-collab-ok\n')
      return
    }
    res.writeHead(htmlBuffer ? 404 : 200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(
      htmlBuffer
        ? 'Not found\n'
        : 'Starlog 局域网协作中继已启动（未找到 offline/index.html，请先运行 npm run build:offline）。\n',
    )
  })

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key']
    if (!key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${websocketAccept(key)}\r\n` +
        '\r\n',
    )

    sockets.add(socket)
    const state = {
      room: null,
      name: '匿名设备',
      buffer: Buffer.alloc(0),
      fragments: [],
      fragmentBytes: 0,
    }
    const onData = (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk])
      try {
        for (;;) {
          const frame = decodeClientFrame(state.buffer)
          if (!frame) break
          state.buffer = state.buffer.subarray(frame.consumed)
          if (frame.opcode === 0x8) {
            // close
            socket.end(encodeControlFrame(0x8))
            socket.destroy()
            return
          }
          if (frame.opcode === 0x9) {
            // ping → pong（回显 payload，控制帧 payload 上限 125 字节）
            socket.write(encodeControlFrame(0xa, frame.payload.subarray(0, 125)))
            continue
          }
          if (frame.opcode === 0xa) continue // pong：忽略
          if (frame.opcode === 0x1 || frame.opcode === 0x0) {
            // text / continuation：拼装分片，并限制整条消息的总大小
            state.fragmentBytes += frame.payload.length
            if (state.fragmentBytes > MAX_MESSAGE_BYTES) throw new Error('消息过大')
            state.fragments.push(frame.payload)
            if (frame.fin) {
              const text = Buffer.concat(state.fragments).toString('utf8')
              state.fragments = []
              state.fragmentBytes = 0
              handleMessage(socket, state, text)
            }
          }
          // 二进制帧（0x2）协作协议不用，直接忽略
        }
      } catch {
        socket.destroy()
      }
    }
    socket.on('data', onData)
    // upgrade 事件带的 head 可能已经含第一帧的数据，不能丢
    if (head?.length) onData(head)

    const cleanup = () => {
      sockets.delete(socket)
      if (state.room) {
        const room = rooms.get(state.room)
        if (room) {
          room.clients.delete(socket)
          room.names.delete(socket)
          if (room.clients.size === 0) rooms.delete(state.room)
          else broadcastPresence(state.room)
        }
      }
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
  })

  const close = () =>
    new Promise((resolveClose) => {
      server.close(() => resolveClose())
      // 强制断开存量连接，避免 close() 挂起（测试与 CLI 退出都需要）
      for (const socket of [...sockets]) socket.destroy()
      sockets.clear()
      rooms.clear()
    })

  return { server, close, rooms, port, host }
}

/** 命令行入口：`npm run lan [--port 8787] [--host 0.0.0.0] [--html <path>]` */
function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, host: '0.0.0.0', htmlPath: defaultHtmlPath() }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) args.port = Number(argv[++i])
    else if (argv[i] === '--host' && argv[i + 1]) args.host = argv[++i]
    else if (argv[i] === '--html' && argv[i + 1]) args.htmlPath = resolve(argv[++i])
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) args.port = DEFAULT_PORT
  return args
}

const isMain = resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const { port, host, htmlPath } = parseArgs(process.argv.slice(2))
  const { server } = createLanCollabServer({ port, host, htmlPath })
  server.listen(port, host, () => {
    const lan = listLanAddresses()
    console.log(`\nStarlog 局域网协作中继已启动（端口 ${port}）`)
    console.log('其他设备只需填房间号：页面会自动在局域网里找到这台中继。\n')
    if (htmlPath && existsSync(htmlPath)) {
      console.log('最省事的方式：把下面这个邀请链接发给协作伙伴直接打开（房间号已带好）：')
      if (lan.length > 0) {
        for (const ip of lan) console.log(`  http://${ip}:${port}/?room=1234`)
      } else {
        console.log(`  http://<本机局域网 IP>:${port}/?room=1234`)
      }
      console.log('  （把 1234 换成你们约定的房间号；从这个地址打开页面时会零探测直连）')
    } else {
      console.log('未找到 offline/index.html：其他设备仍可用自己的离线 HTML + 房间号自动发现中继；')
      console.log('若想用邀请链接，请先运行 npm run build:offline 或用 --html 指定文件路径。')
    }
    console.log(`\n本机调试地址：ws://localhost:${port}`)
    console.log('只在可信局域网内使用，不要把此端口暴露到公网。按 Ctrl+C 停止。\n')
  })
  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
