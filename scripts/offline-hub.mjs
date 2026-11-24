#!/usr/bin/env node
/**
 * 离线版「局域网协作」中心（issue #112）。
 *
 * 离线单文件版完全不联网，所以协作的中心必须是用户自己机器上的一个小进程。这个文件：
 *   · 零依赖，只用 Node 内置模块（`node scripts/offline-hub.mjs` 就能跑，不用 npm install）；
 *   · 只监听局域网地址，**不向公网发出任何请求**；
 *   · 顺手把 `offline/index.html` 作为站点根路径发出去，局域网里其他设备直接用浏览器打开就加入了；
 *   · 文档只存在内存里，进程一停就没了 —— 要留档请在页面里「存为本地草稿」或导出文章包。
 *
 * 房间码（issue #112 的追加需求：加入者只输一个码就行）：
 *   · 每个房间带一个 6 位房间码，界面里显示成 483-902；不给 --room 就自动生成，
 *     --code 可以指定一个好念的；
 *   · 加入者只填这 6 位码：页面拿「当前站点 → 本机记住过的中心地址 → 手填地址」这几个候选
 *     逐个问 GET /api/rooms，谁列出了这个码就接进谁；
 *   · --open 让中心直接用默认浏览器打开带房间码的加入链接，发起者一个字段都不用填。
 *
 * 用法：
 *   node scripts/offline-hub.mjs                        # 端口 8787，随机房间码
 *   node scripts/offline-hub.mjs --room 机房四人 --open  # 指定房名并自动打开页面
 *   node scripts/offline-hub.mjs --code 483902          # 指定一个好记的房间码
 *   node scripts/offline-hub.mjs --file dist-offline/index.html --read-only
 *
 * 其他设备用浏览器打开 http://<本机局域网IP>:8787/（中心会把离线单文件版当站点发出去），
 * 或在自己的离线文件里填房间码即可加入。
 *
 * 协议（与 src/lib/lanSync.ts 一一对应）：
 *   GET  /api/rooms[?code=]                              → { ok, rooms: [{ code, name, rev, peers, chars }] }
 *   POST /api/join   { room | code, name }               → { rev, code, name, blocks, peers }
 *   POST /api/ops    { room | code, name, ops }          → { rev, code, name, blocks, peers }
 *   POST /api/leave  { room | code, name }               → { ok }
 *   GET  /api/state?room=&code=&name=                    → { rev, code, name, blocks, peers }
 *
 * `room` 填房间名或房间码都认（认不出来时按房间名新建）；带 `code` 时只接受已存在的房间，
 * 没有就返回 404 —— 加入者靠这条区分「找不到这个房间」与「我先开一个」。
 *   GET  /api/events?room=&name=  (SSE)    → event: starlog / data: { type, ops, by, rev, peers }
 *
 * 段落合并语义与 `src/lib/lanDoc.ts` 保持一致：按 (v, ts) 后写覆盖先写，删除打墓碑，
 * seq 挤在一起时中心负责重排。改动请同时跑 `npm test`（里面有协议级集成测试）。
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { spawn } from 'node:child_process'
import { extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* --------------------------------- 参数 --------------------------------- */

function defaultOfflineFile() {
  const candidates = [
    './starlog-offline-latest.html', './starlog.html', '../offline/index.html', '../dist-offline/index.html',
  ].map((path) => fileURLToPath(new URL(path, import.meta.url)))
  return candidates.find((path) => existsSync(path)) ?? candidates[0]
}

function parseArgs(argv) {
  const out = {
    port: 8787,
    host: '0.0.0.0',
    room: '',
    code: '',
    file: defaultOfflineFile(),
    readOnly: false,
    open: false,
    withHub: false,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--port' || arg === '-p') out.port = Number.parseInt(next(), 10)
    else if (arg === '--host' || arg === '-h') out.host = next()
    else if (arg === '--room') out.room = next()
    else if (arg === '--file') out.file = next()
    else if (arg === '--allow-write') out.allowWrite = true // 旧参数名，等价于「不加 --read-only」
    else if (arg === '--read-only') out.readOnly = true
    else if (arg === '--code') out.code = next()
    else if (arg === '--open') out.open = true
    else if (arg === '--with-hub') out.withHub = true
    else if (arg === '--quiet') out.quiet = true
    else if (arg === '--help') {
      out.help = true
    }
  }
  if (!Number.isFinite(out.port) || out.port <= 0 || out.port > 65535) {
    throw new Error(`--port 需要一个 1-65535 的端口，收到：${argv.join(' ')}`)
  }
  if (out.code && !normalizeRoomCode(out.code)) {
    throw new Error(`--code 需要 6 位数字房间码（如 483902），收到：${out.code}`)
  }
  return out
}

/* -------------------------------- 文档模型 -------------------------------- */

const SEQ_GAP = 1000

/** 只认 6 位数字（界面里写成 483-902 或 483 902 也一样）；不合法返回空串。 */
function normalizeRoomCode(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length === 6 ? digits : ''
}

/** 展示成 483-902：比一长串数字好念也好抄。 */
function formatRoomCode(code) {
  const digits = normalizeRoomCode(code)
  return digits ? `${digits.slice(0, 3)}-${digits.slice(3)}` : ''
}

/** 生成一个没被占用的码；避开 0 开头（口播时容易丢位）。 */
function generateRoomCode(taken) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = String(100000 + Math.floor(Math.random() * 900000))
    if (!taken.has(code)) return code
  }
  return String(Date.now()).slice(-6)
}

/** 房间：一个房间码 + 一份段落表 + 在线成员 + SSE 订阅者 */
class Room {
  constructor(name, code) {
    this.name = name
    this.code = code
    this.createdAt = Date.now()
    this.rev = 0
    /** @type {Map<string, object>} */
    this.blocks = new Map()
    /** @type {Map<string, { at: number }>} */
    this.peers = new Map()
    /** @type {Set<import('node:http').ServerResponse>} */
    this.clients = new Set()
  }

  snapshot() {
    const blocks = [...this.blocks.values()]
      .filter((block) => !block.dead)
      .sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1))
    return { rev: this.rev, code: this.code, name: this.name, blocks, peers: this.peerList() }
  }

  /** 给 /api/rooms 用的摘要：加入者靠它按码找人，不需要全文 */
  summary() {
    return {
      code: this.code,
      name: this.name,
      rev: this.rev,
      peers: this.peerList().length,
      chars: this.textLength(),
    }
  }

  peerList() {
    const now = Date.now()
    const peers = []
    for (const [name, info] of this.peers) {
      if (now - info.at > 90_000) {
        this.peers.delete(name)
        continue
      }
      peers.push({ name, at: info.at })
    }
    return peers.sort((a, b) => a.name.localeCompare(b.name))
  }

  touch(name) {
    if (!name) return
    this.peers.set(name, { at: Date.now() })
  }

  /**
   * 与 src/lib/lanDoc.ts 的 applyRemoteOps + resequence 等价：
   * (v, ts) 新的覆盖旧的，删除只打墓碑，seq 撞上就整表重排。
   */
  applyOps(ops, by) {
    let changed = 0
    for (const op of ops) {
      if (!op || typeof op.id !== 'string' || (op.kind !== 'put' && op.kind !== 'del')) continue
      const existing = this.blocks.get(op.id)
      const incomingVersion = Number.isFinite(op.v) ? op.v : 1
      const incomingTime = Number.isFinite(op.ts) ? op.ts : Date.now()
      if (existing) {
        const newer =
          incomingVersion > existing.v || (incomingVersion === existing.v && incomingTime >= existing.ts)
        if (!newer) continue
        if (op.kind === 'del') {
          existing.dead = true
        } else {
          existing.dead = false
          existing.text = typeof op.text === 'string' ? op.text : ''
          if (Number.isFinite(op.seq)) existing.seq = op.seq
        }
        existing.v = incomingVersion
        existing.by = by || existing.by
        existing.ts = incomingTime
      } else if (op.kind === 'put') {
        this.blocks.set(op.id, {
          id: op.id,
          text: typeof op.text === 'string' ? op.text : '',
          seq: Number.isFinite(op.seq) ? op.seq : SEQ_GAP,
          v: incomingVersion,
          by: by || 'unknown',
          ts: incomingTime,
          dead: false,
        })
      } else {
        // 没见过的段落要删：说明它已经被删过，直接忽略
        continue
      }
      changed += 1
    }
    if (changed === 0) return null
    this.resequenceIfNeeded()
    this.rev += 1
    return ops
  }

  resequenceIfNeeded() {
    const sorted = [...this.blocks.values()].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1))
    let needs = false
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].seq - sorted[i - 1].seq
      if (!(gap >= 1)) {
        needs = true
        break
      }
    }
    if (!needs) return
    sorted.forEach((block, index) => {
      block.seq = (index + 1) * SEQ_GAP
    })
  }

  broadcast(payload) {
    const frame = `event: starlog\ndata: ${JSON.stringify(payload)}\n\n`
    for (const res of this.clients) res.write(frame)
  }

  textLength() {
    let total = 0
    for (const block of this.blocks.values()) if (!block.dead) total += block.text.length
    return total
  }
}

const rooms = new Map()
/** 用过的房间码先记着：房间空了也不回收，避免新房间和别人手里的旧链接撞码 */
const usedCodes = new Set()

function takenCodes() {
  for (const room of rooms.values()) usedCodes.add(room.code)
  return usedCodes
}

/** 按房间码找（只认已存在的房间）。 */
function findRoomByCode(code) {
  const digits = normalizeRoomCode(code)
  if (!digits) return null
  for (const room of rooms.values()) if (room.code === digits) return room
  return null
}

/**
 * 拿到一个房间：先认码，再认名字，都没有就按输入新建。
 *
 * 输入正好是 6 位数字时**把码当成给定的那个**——发起者挑一个好念的码、或别人把自己的码
 * 抄过来时，不会莫名其妙变成另一个房间。
 */
function getRoom(input, fallbackName = 'default') {
  const raw = String(input ?? '').trim()
  const hit = findRoomByCode(raw)
  if (hit) return hit
  const key = raw || fallbackName
  const existing = rooms.get(key)
  if (existing) return existing
  const wanted = normalizeRoomCode(raw)
  const code = wanted && !takenCodes().has(wanted) ? wanted : generateRoomCode(takenCodes())
  usedCodes.add(code)
  const room = new Room(wanted ? `房间 ${formatRoomCode(code)}` : key.slice(0, 60), code)
  room.key = key
  rooms.set(key, room)
  return room
}

/* --------------------------------- HTTP --------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
/** 单段文字与整篇文档的上限（内存中心，不设限会被一张大图压垮） */
const MAX_OP_TEXT = 200 * 1024
const MAX_ROOM_TEXT = 4 * 1024 * 1024

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        rejectPromise(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', rejectPromise)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function serveApp(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(
      `找不到离线单文件版：${filePath}\n\n` +
        '先执行 npm run build:offline 生成 dist-offline/index.html，' +
        '或用 --file 指定你手上那个离线文件的位置。',
    )
    return
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Content-Length': statSync(filePath).size,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  })
  createReadStream(filePath).pipe(res)
}

/**
 * 用给定的房间名与房间码建一个房间（两者都可以省略）。
 *
 * `--code 483902 --room 机房四人` 要同时生效：码是指定的、名字也是指定的；
 * 只有 `--code` 时名字写成「房间 483-902」，只有 `--room` 时码随机。
 */
function createRoomWith(name, code) {
  const wanted = normalizeRoomCode(code)
  const existing = (wanted ? findRoomByCode(wanted) : null) || (name ? rooms.get(name) : null)
  if (existing) return existing
  const finalCode = wanted && !takenCodes().has(wanted) ? wanted : generateRoomCode(takenCodes())
  usedCodes.add(finalCode)
  const key = name || finalCode
  const room = new Room(name || `房间 ${formatRoomCode(finalCode)}`, finalCode)
  room.key = key
  rooms.set(key, room)
  return room
}

export { formatRoomCode, normalizeRoomCode }

/**
 * 建一个中心实例。**启动时就把默认房间建好**：加入者是靠 `GET /api/rooms` 扫房间码找到中心的，
 * 房间若懒加载着等第一次 join 才建，扫描阶段就会「谁都没有」，加入者只能退回手填地址。
 */
export function createLanHub(options = {}) {
  const initial = createRoomWith(
    typeof options.room === 'string' ? options.room.trim().slice(0, 60) : '',
    options.code,
  )
  const config = {
    file: resolve(process.cwd(), options.file ?? 'offline/index.html'),
    defaultRoom: initial.key ?? initial.name,
    roomCode: initial.code,
    readOnly: options.readOnly === true,
    port: options.port ?? 8787,
    onLog: typeof options.onLog === 'function' ? options.onLog : () => {},
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '600',
      })
      res.end()
      return
    }

    try {
      if (path === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          rooms: [...rooms.keys()],
          peers: [...rooms.values()].reduce((sum, room) => sum + room.peerList().length, 0),
        })
        return
      }
      // 自动发现：页面拿「候选中心地址」逐个问这个接口，谁列出了这个码就接进谁。
      // 它不建房间也不记账，扫错地址不会留下任何痕迹。
      if (path === '/api/rooms') {
        const code = normalizeRoomCode(url.searchParams.get('code') ?? '')
        const list = [...rooms.values()].map((room) => room.summary())
        sendJson(res, 200, { ok: true, rooms: code ? list.filter((item) => item.code === code) : list })
        return
      }
      if (path === '/api/join' && req.method === 'POST') {
        const body = await readBody(req)
        // 带 code 的加入只接受已存在的房间：加入者不该凭一个错码开出新房间
        if (body.code !== undefined && String(body.code).trim() !== '') {
          const byCode = findRoomByCode(body.code)
          if (!byCode) {
            sendJson(res, 404, {
              error: `这台中心上没有房间码 ${formatRoomCode(body.code) || String(body.code).slice(0, 12)} 的房间`,
            })
            return
          }
          const joiner = String(body.name ?? '').trim().slice(0, 40) || '匿名'
          byCode.touch(joiner)
          config.onLog(`加入「${byCode.name}」（${formatRoomCode(byCode.code)}）：@${joiner}`)
          byCode.broadcast({ type: 'presence', peers: byCode.peerList() })
          sendJson(res, 200, byCode.snapshot())
          return
        }
        const room = getRoom(body.room || config.defaultRoom, config.defaultRoom)
        const name = String(body.name ?? '').trim().slice(0, 40) || '匿名'
        room.touch(name)
        config.onLog(`加入「${room.name}」（${formatRoomCode(room.code)}）：@${name}`)
        room.broadcast({ type: 'presence', peers: room.peerList() })
        sendJson(res, 200, room.snapshot())
        return
      }
      if (path === '/api/ops' && req.method === 'POST') {
        if (config.readOnly) {
          sendJson(res, 403, { error: '中心当前是只读模式（--read-only），去掉这个参数即可写入' })
          return
        }
        const body = await readBody(req)
        const room = getRoom(body.code || body.room || config.defaultRoom, config.defaultRoom)
        const name = String(body.name ?? '').trim().slice(0, 40) || '匿名'
        room.touch(name)
        const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : []
        // 体积上限：整篇 4MB、单段 200KB，超限整批退回不应用（内存里的小中心不替你收超大文档）
        const oversized = ops.find((op) => typeof op?.text === 'string' && op.text.length > MAX_OP_TEXT)
        if (oversized) {
          sendJson(res, 413, { error: `单段文字超过 ${Math.round(MAX_OP_TEXT / 1024)}KB，请拆分段落` })
          return
        }
        if (room.textLength() > MAX_ROOM_TEXT) {
          sendJson(res, 413, { error: '共享文档已超过 4MB，先删减一点再提交' })
          return
        }
        if (ops.length > 0 && room.applyOps(ops, name)) {
          config.onLog(`「${room.name}」@${name} 提交 ${ops.length} 处改动（rev ${room.rev}）`)
          // 别人的改动只发 op 给对方，自己这条以 POST 响应为准，避免自己的回声把自己顶回去
          room.broadcast({ type: 'doc', ops, by: name, rev: room.rev, peers: room.peerList() })
        }
        sendJson(res, 200, room.snapshot())
        return
      }
      if (path === '/api/leave' && req.method === 'POST') {
        const body = await readBody(req)
        const raw = String(body.code ?? body.room ?? config.defaultRoom).trim()
        const room = findRoomByCode(raw) ?? rooms.get(raw.slice(0, 60))
        const name = String(body.name ?? '').trim()
        if (room) {
          room.peers.delete(name)
          room.broadcast({ type: 'presence', peers: room.peerList() })
        }
        sendJson(res, 200, { ok: true })
        return
      }
      if (path === '/api/state') {
        const room = getRoom(
          url.searchParams.get('room') || url.searchParams.get('code') || config.defaultRoom,
          config.defaultRoom,
        )
        const name = url.searchParams.get('name')
        room.touch(name ?? '')
        sendJson(res, 200, room.snapshot())
        return
      }
      if (path === '/api/events') {
        const room = getRoom(url.searchParams.get('room') || config.defaultRoom, config.defaultRoom)
        const name = url.searchParams.get('name')
        room.touch(name ?? '')
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        res.write('retry: 2000\n\n')
        res.write(`event: starlog\ndata: ${JSON.stringify({ type: 'hello', ...room.snapshot() })}\n\n`)
        room.clients.add(res)
        const heartbeat = setInterval(() => {
          room.touch(name ?? '')
          res.write(': ping\n\n')
        }, 25_000)
        req.on('close', () => {
          clearInterval(heartbeat)
          room.clients.delete(res)
          if (name) {
            room.peers.delete(name)
            room.broadcast({ type: 'presence', peers: room.peerList() })
          }
        })
        return
      }
      if (path === '/' || path === '/index.html' || path === '/404.html') {
        serveApp(res, config.file)
        return
      }
      sendJson(res, 404, { error: '未知路径', path })
    } catch (err) {
      config.onLog(`错误：${err instanceof Error ? err.message : String(err)}`)
      sendJson(res, 400, { error: err instanceof Error ? err.message : '请求失败' })
    }
  })

  return { server, rooms, config }
}

/* --------------------------------- 启动 --------------------------------- */

/** 本机在局域网里的第一个 IPv4（`--open` 与打印链接都用它）。 */
export function primaryLanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) return item.address
    }
  }
  return '127.0.0.1'
}

/**
 * 加入链接：路径与查询串都写在 hash 里。
 *
 * 离线单文件版用的是 HashRouter，`#/toolbox/lan?room=…` 才能直接被路由解析；
 * 而房间码本身就够加入者用了（中心地址由页面自己按「当前站点 → 记住的地址」去找），
 * 所以链接里默认只带 room，`--with-hub` 才把 hub 也写上（给从别的地址打开页面的人用）。
 */
export function lanInviteUrl(host, port, code, { withHub = false } = {}) {
  const base = `http://${host}:${port}`
  const query = `room=${formatRoomCode(code)}${withHub ? `&hub=${encodeURIComponent(base)}` : ''}`
  return `${base}/#/toolbox/lan?${query}`
}

/** 用系统默认浏览器打开链接；失败静默（无桌面环境的服务器本来就不该开浏览器）。 */
function openInBrowser(url) {
  const platform = process.platform
  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.unref()
  } catch {
    // 忽略：链接本来就打印在终端里
  }
}

function localAddresses(port) {
  const lines = []
  const interfaces = networkInterfaces()
  for (const [device, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        lines.push(`    http://${item.address}:${port}/   （${device}）`)
      }
    }
  }
  lines.push(`    http://127.0.0.1:${port}/   （本机）`)
  return lines
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
  if (options.help) {
    console.log(
      [
        '用法：node scripts/offline-hub.mjs [选项]',
        '',
        '  --port <n>        监听端口（默认 8787）',
        '  --host <addr>     监听地址（默认 0.0.0.0，即局域网可见）',
        '  --room <名称>     房间名（不填则自动取一个随机房间码）',
        '  --code <6 位数字> 指定房间码，例如 483902（界面里显示成 483-902）',
        '  --open            用默认浏览器直接打开带房间码的加入链接（发起者一步都不用填）',
        '  --with-hub        加入链接里同时写上中心地址（给从别的地址打开页面的人用）',
        '  --file <路径>     要作为站点发出的离线单文件（默认查找 Release 附件或仓库的离线版）',
        '  --read-only       只读模式：只能看别人的改动，不接受写入（默认允许写入）',
        '  --quiet           不打印日志',
        '',
        '其他设备打开该地址（或自己的离线 HTML 文件），在「百宝箱 → 局域网协作」里只填房间码：',
        '页面会自己找中心（当前站点 → 本机记住过的地址 → 手动填写兜底）。',
        '文档只存在内存里，进程停止就没了。',
      ].join('\n'),
    )
    process.exit(0)
  }
  const { server, config, rooms } = createLanHub({ ...options, readOnly: options.readOnly })
  const room = [...rooms.values()][0]
  const lanHost = primaryLanAddress()
  const invite = lanInviteUrl(lanHost, options.port, room.code, { withHub: options.withHub === true })
  server.listen(options.port, options.host, () => {
    if (options.open) openInBrowser(invite)
    if (options.quiet) return
    console.log(`\n  局域网协作中心 · ${hostname()}`)
    console.log(`  ─ ${'─'.repeat(46)}`)
    console.log(``)
    console.log(`      房间码   ${formatRoomCode(room.code)}      ← 其他人只要在页面里输这 6 位数字`)
    console.log(`      房间名   ${room.name}`)
    console.log(`      加入链接 ${invite}`)
    console.log(``)
    console.log(`  写入权限：${config.readOnly ? '只读（--read-only）' : '允许写入'}`)
    console.log(
      `  离线文件：${config.file}${existsSync(config.file) ? '' : '   ← 找不到；页面仍可用各自手上的离线文件，只填房间码即可'}`,
    )
    console.log(`\n  其他设备：用浏览器打开下面任一地址（页面由本中心发出时，填房间码就能直接连上）`)
    for (const line of localAddresses(options.port)) console.log(line)
    console.log(`\n  已经手上有离线 HTML 的设备：打开它 → 百宝箱 → 局域网协作 → 输房间码 ${formatRoomCode(room.code)}`)
    console.log('\n  Ctrl+C 停止（内存里的共享文档会一起消失）\n')
  })
  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
