#!/usr/bin/env node
/**
 * 星野笔记 · 离线版局域网协作中继（issue #112，预览能力）
 *
 * 一台局域网内的设备跑这个脚本，同一局域网里的其他设备（打开离线单文件版的
 * 浏览器）就能通过它共享同一份文档：谁保存了文章，就推给文档里的其他设备，
 * 实现「多台设备共同编辑同一文档」。
 *
 * 零依赖：WebSocket 服务端（RFC 6455 的握手、分帧与掩码）全部用 Node 内置模块实现，
 * 所以 `node scripts/lan-collab-server.mjs` 就能直接跑，不需要 npm install。
 * 需要 Node >= 18（用了 `node:http`、`node:crypto`、`node:util`）。
 *
 * 用法：
 *   node scripts/lan-collab-server.mjs                # ws://0.0.0.0:8787
 *   node scripts/lan-collab-server.mjs --port 9000    # 指定端口
 *   PORT=9000 node scripts/lan-collab-server.mjs      # 也可以用环境变量
 *
 * 浏览器端（离线版「设置 → 局域网协作」）填这台机器在局域网里的地址，
 * 例如 `ws://192.168.1.5:8787`。
 *
 * 协议（JSON 文本帧，与 src/lib/collab.ts 的客户端一一对应）：
 *   客户端 → 服务端：{kind:'hello'} / {kind:'request'} / {kind:'post'}
 *   服务端 → 客户端：{kind:'hello'} / {kind:'sync'} / {kind:'update'} / {kind:'error'}
 *
 * 内存里每个文档最多保留 MAX_POSTS_PER_DOC 条，只做协作同步用，不做持久化——
 * 真正的文章仍然保存在每个设备的本机文章库里。
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { parseArgs } from 'node:util'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_POSTS_PER_DOC = 200
const IDLE_TIMEOUT_MS = 60_000
const HEARTBEAT_MS = 25_000

/** 从 --port / --host / 环境变量里解析监听地址 */
function resolveOptions() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(
      [
        '星野笔记 · 离线版局域网协作中继',
        '',
        '  node scripts/lan-collab-server.mjs [--port 8787] [--host 0.0.0.0]',
        '',
        '  默认 ws://0.0.0.0:8787，可用环境变量 PORT / HOST 覆盖。',
        '  同一局域网里的设备在离线版的「设置 → 局域网协作」里填这台机器的地址即可。',
      ].join('\n'),
    )
    process.exit(0)
  }
  const port = Number(values.port || process.env.PORT || 8787)
  const host = values.host || process.env.HOST || '0.0.0.0'
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`❌ 端口不合法：${values.port || process.env.PORT}`)
    process.exit(1)
  }
  return { port, host }
}

/** 计算 Sec-WebSocket-Accept */
function acceptKey(key) {
  return crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
}

/** 编码一个服务端 → 客户端的帧（不掩码） */
function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload))
  const length = data.length
  let header
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length < 65_536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeUInt32BE(0, 2)
    header.writeUInt32BE(length, 6)
  }
  return Buffer.concat([header, data])
}

/**
 * 从缓冲区里解析出尽量多的完整帧。
 * 返回 { frames, rest }：rest 是不足一帧的尾巴，留在下次 data 事件里继续拼。
 */
function parseFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    if (buffer.length - offset < 2) break
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let payloadLength = second & 0x7f
    let headerLength = 2
    if (payloadLength === 126) {
      if (buffer.length - offset < 4) break
      payloadLength = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) break
      if (buffer.readUInt32BE(offset + 2) !== 0) break // 超过 32 位的帧直接拒绝
      payloadLength = buffer.readUInt32BE(offset + 6)
      headerLength = 10
    }
    let mask = null
    if (masked) {
      if (buffer.length - offset < headerLength + 4) break
      mask = buffer.subarray(offset + headerLength, offset + headerLength + 4)
      headerLength += 4
    }
    if (buffer.length - offset < headerLength + payloadLength) break
    const payload = Buffer.from(
      buffer.subarray(offset + headerLength, offset + headerLength + payloadLength),
    )
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
    }
    frames.push({ opcode, fin: (first & 0x80) !== 0, payload })
    offset += headerLength + payloadLength
  }
  return { frames, rest: offset === 0 ? buffer : buffer.subarray(offset) }
}

/** 文档仓库：docId -> Map(postId -> post) */
const documents = new Map()
/** 客户端注册表：socket -> { docId, name } */
const clients = new Map()
/** 每个 socket 未解析完的字节 */
const buffers = new Map()
/** 分片帧的中间结果：socket -> Buffer */
const fragments = new Map()

function storePost(docId, post) {
  let doc = documents.get(docId)
  if (!doc) {
    doc = new Map()
    documents.set(docId, doc)
  }
  const id = post && typeof post.slug === 'string' && post.slug ? post.slug : `post-${doc.size + 1}`
  doc.set(id, { post, savedAt: Date.now() })
  while (doc.size > MAX_POSTS_PER_DOC) {
    const oldest = doc.keys().next()
    if (oldest.done) break
    doc.delete(oldest.value)
  }
}

function broadcast(docId, message, except) {
  const frame = encodeFrame(0x1, JSON.stringify(message))
  for (const [socket, info] of clients) {
    if (socket === except) continue
    if (info.docId !== docId) continue
    try {
      socket.write(frame)
    } catch {
      // 写失败的连接在 close / error 事件里统一清理
    }
  }
}

function send(socket, message) {
  socket.write(encodeFrame(0x1, JSON.stringify(message)))
}

function handleText(socket, text) {
  let message
  try {
    message = JSON.parse(text)
  } catch {
    send(socket, { kind: 'error', message: '消息不是合法 JSON' })
    return
  }
  const docId = typeof message.docId === 'string' ? message.docId : ''
  const name = typeof message.name === 'string' ? message.name : ''

  if (message.kind === 'hello') {
    clients.set(socket, { docId, name })
    send(socket, { kind: 'hello', docId })
    return
  }

  if (message.kind === 'request') {
    clients.set(socket, { docId, name })
    const doc = documents.get(docId)
    const posts = doc ? [...doc.values()].map((entry) => entry.post) : []
    send(socket, { kind: 'sync', docId, posts, nonce: message.nonce })
    return
  }

  if (message.kind === 'post') {
    clients.set(socket, { docId, name })
    storePost(docId, message.post)
    broadcast(docId, { kind: 'update', docId, post: message.post, nonce: message.nonce }, socket)
    return
  }

  send(socket, { kind: 'error', message: `未知消息类型：${String(message.kind)}` })
}

/** 把 socket 包装成一个 WebSocket 客户端连接（握手已经在 upgrade 里完成） */
function attachWebSocket(socket) {
  socket.lastActivity = Date.now()

  socket.on('data', (chunk) => {
    socket.lastActivity = Date.now()
    const buffer = Buffer.concat([buffers.get(socket) ?? Buffer.alloc(0), chunk])
    const { frames, rest } = parseFrames(buffer)
    buffers.set(socket, rest)

    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end()
        return
      }
      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(0xa, frame.payload))
        continue
      }
      if (frame.opcode === 0xa) continue
      // 文本帧（可能分片）：拼完整之后再交给协议层
      const previous = fragments.get(socket)
      const body = previous ? Buffer.concat([previous, frame.payload]) : frame.payload
      if (frame.fin) {
        fragments.delete(socket)
        handleText(socket, body.toString('utf8'))
      } else {
        fragments.set(socket, body)
      }
    }
  })

  socket.on('close', () => {
    buffers.delete(socket)
    fragments.delete(socket)
    clients.delete(socket)
  })

  socket.on('error', () => {
    socket.destroy()
  })
}

/** 一个最小的 WebSocket 服务端：HTTP 升级 + 分帧 */
function createWebSocketServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/status') {
      const rows = [...documents.entries()].map(
        ([docId, doc]) =>
          `<tr><td><code>${docId}</code></td><td>${doc.size}</td><td>${clients.size}</td></tr>`,
      )
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>星野笔记 · 局域网协作中继</title>
<style>body{font-family:system-ui;margin:3rem auto;max-width:44rem;line-height:1.7;color:#1f2937}
code{background:#f3f4f6;padding:.1rem .35rem;border-radius:.25rem}table{border-collapse:collapse}
td,th{border:1px solid #e5e7eb;padding:.35rem .7rem}</style>
<h1>星野笔记 · 局域网协作中继</h1>
<p>当前连接设备 <strong>${clients.size}</strong> 台，共享文档 <strong>${documents.size}</strong> 个。</p>
<table><thead><tr><th>文档 ID</th><th>缓存的文章</th><th>连接中的设备</th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="3">还没有设备连接</td></tr>'}</tbody></table>`,
      )
      return
    }
    res.writeHead(404).end('not found')
  })

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.destroy()
      return
    }
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        '\r\n',
      ].join('\r\n'),
    )
    socket.setNoDelay(true)
    attachWebSocket(socket)
  })

  return server
}

const { port, host } = resolveOptions()
const server = createWebSocketServer()

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host
  console.log('\n🌐 星野笔记 · 局域网协作中继已启动')
  console.log(`   本机地址：ws://${shown}:${port}`)
  console.log(`   状态页面：http://${shown}:${port}/`)
  console.log('   把上面的地址填进离线版的「设置 → 局域网协作」，同一局域网内的设备即可共同编辑同一文档。')
  console.log('   按 Ctrl+C 停止。\n')
})

server.on('error', (error) => {
  console.error(`❌ 启动失败：${error.message}`)
  process.exit(1)
})

/** 心跳：长时间没收到任何帧的连接直接断开，避免半开连接占着文档不放。 */
const heartbeat = setInterval(() => {
  for (const [socket] of clients) {
    if (typeof socket.lastActivity !== 'number' || Date.now() - socket.lastActivity > IDLE_TIMEOUT_MS) {
      socket.destroy()
      continue
    }
    try {
      socket.write(encodeFrame(0x9, Buffer.alloc(0)))
    } catch {
      socket.destroy()
    }
  }
}, HEARTBEAT_MS)
heartbeat.unref()
