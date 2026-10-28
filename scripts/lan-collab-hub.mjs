#!/usr/bin/env node
/**
 * 离线版局域网合作文档本地直连中枢（零第三方依赖，仅使用 Node.js 标准库）。
 *
 * 作用：
 *   1. 让同一 Wi-Fi / 局域网内的设备只需输入「房主 IP」或「房间号」即可实时共同编辑离线文档；
 *   2. 同时提供离线单文件 HTML 访问（其他设备直接浏览器打开 http://<房主IP>:8765 也可直接加入协作）；
 *   3. 不访问任何外网，仅在局域网内转发协同房间消息。
 */
import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
export const DEFAULT_LAN_HUB_PORT = 8765
export const LAN_WS_PATH = '/__starlog_lan_ws'
export const LAN_INFO_PATH = '/__starlog_lan_info'

export function detectLanIpv4List() {
  const nets = os.networkInterfaces()
  const ips = []
  for (const list of Object.values(nets)) {
    for (const item of list || []) {
      const family = typeof item.family === 'string' ? item.family : item.family === 4 ? 'IPv4' : ''
      if (family === 'IPv4' && !item.internal && item.address) {
        ips.push(item.address)
      }
    }
  }
  // 优先展示常见家用/办公局域网网段（192.168.x.x / 10.x.x.x / 172.16-31.x.x）
  ips.sort((a, b) => {
    const score = (ip) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
    return score(a) - score(b)
  })
  return [...new Set(ips)]
}

function encodeWsFrame(opcode, payloadBuf) {
  const len = payloadBuf.length
  let header
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len])
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payloadBuf])
}

function createWsClient(socket) {
  let recvBuf = Buffer.alloc(0)
  let fragments = []
  let closed = false

  const client = {
    socket,
    peerId: '',
    peerName: '',
    hostedRoom: '',
    joinedRoom: '',
    send(obj) {
      if (closed || socket.destroyed || !socket.writable) return
      try {
        const raw = Buffer.from(JSON.stringify(obj), 'utf8')
        socket.write(encodeWsFrame(0x01, raw))
      } catch {
        // ignore write errors on closing sockets
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        socket.end(Buffer.from([0x88, 0x00]))
      } catch {
        socket.destroy()
      }
    },
    onMessage: null,
    onClose: null,
  }

  socket.setNoDelay(true)

  socket.on('data', (chunk) => {
    if (closed) return
    recvBuf = recvBuf.length === 0 ? chunk : Buffer.concat([recvBuf, chunk])
    // 防止异常超大包耗尽内存（上限 32MB）
    if (recvBuf.length > 32 * 1024 * 1024) {
      client.close()
      return
    }

    while (recvBuf.length >= 2) {
      const b0 = recvBuf[0]
      const b1 = recvBuf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      const len7 = b1 & 0x7f
      let offset = 2
      let payloadLen = len7

      if (len7 === 126) {
        if (recvBuf.length < 4) break
        payloadLen = recvBuf.readUInt16BE(2)
        offset = 4
      } else if (len7 === 127) {
        if (recvBuf.length < 10) break
        payloadLen = Number(recvBuf.readBigUInt64BE(2))
        offset = 10
      }

      let mask = null
      if (masked) {
        if (recvBuf.length < offset + 4) break
        mask = recvBuf.subarray(offset, offset + 4)
        offset += 4
      }

      if (recvBuf.length < offset + payloadLen) break

      const body = Buffer.from(recvBuf.subarray(offset, offset + payloadLen))
      recvBuf = recvBuf.subarray(offset + payloadLen)

      if (mask) {
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3]
      }

      if (opcode === 0x08) {
        client.close()
        return
      }
      if (opcode === 0x09) {
        if (!socket.destroyed && socket.writable) {
          socket.write(encodeWsFrame(0x0a, body))
        }
        continue
      }
      if (opcode === 0x0a) continue

      if (opcode === 0x01 || opcode === 0x02) {
        fragments = [body]
      } else if (opcode === 0x00) {
        fragments.push(body)
      }

      if (fin && fragments.length > 0) {
        const full = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments)
        fragments = []
        try {
          const parsed = JSON.parse(full.toString('utf8'))
          client.onMessage?.(parsed)
        } catch {
          // ignore malformed JSON frame
        }
      }
    }
  })

  const finishClose = () => {
    if (closed) return
    closed = true
    client.onClose?.()
  }
  socket.on('close', finishClose)
  socket.on('error', finishClose)
  socket.on('end', finishClose)

  return client
}

/**
 * 将局域网协同房间中枢挂载到任意 Node HTTP Server（支持独立脚本与 Vite preview/dev 共用）。
 */
export function attachLanCollabHub(httpServer, options = {}) {
  const rooms = new Map()
  const clients = new Set()

  const resolvePort = () => {
    if (typeof options.getPort === 'function') {
      const p = options.getPort()
      if (p) return p
    }
    const addr = httpServer.address()
    return addr && typeof addr === 'object' ? addr.port : DEFAULT_LAN_HUB_PORT
  }

  const summarizeRooms = () =>
    [...rooms.values()].map((r) => ({
      roomCode: r.roomCode,
      hostPeerId: r.hostPeerId,
      hostName: r.hostName,
      docTitle: r.docTitle || '未命名文章',
      peerCount: 1 + r.guests.size,
      createdAt: r.createdAt,
    }))

  const broadcastRoomList = () => {
    const payload = {
      type: 'hub-rooms',
      lanIps: detectLanIpv4List(),
      port: resolvePort(),
      rooms: summarizeRooms(),
    }
    for (const c of clients) c.send(payload)
  }

  const cleanupClientMembership = (client) => {
    if (client.hostedRoom) {
      const room = rooms.get(client.hostedRoom)
      client.hostedRoom = ''
      if (room && room.hostClient === client) {
        rooms.delete(room.roomCode)
        for (const guest of room.guests) {
          guest.joinedRoom = ''
          guest.send({
            type: 'hub-relay',
            roomCode: room.roomCode,
            payload: { type: 'bye', peerId: room.hostPeerId },
          })
        }
        broadcastRoomList()
      }
    }

    if (client.joinedRoom) {
      const room = rooms.get(client.joinedRoom)
      client.joinedRoom = ''
      if (room && room.guests.delete(client)) {
        const byeMsg = {
          type: 'hub-relay',
          roomCode: room.roomCode,
          payload: { type: 'bye', peerId: client.peerId },
        }
        room.hostClient.send(byeMsg)
        for (const other of room.guests) other.send(byeMsg)
        broadcastRoomList()
      }
    }
  }

  const handleInfoRequest = (req, res) => {
    const urlPath = (req.url || '/').split('?')[0]
    if (urlPath !== LAN_INFO_PATH) return false
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
    })
    if (req.method === 'OPTIONS') {
      res.end()
      return true
    }
    res.end(
      JSON.stringify({
        ok: true,
        service: 'starlog-lan-collab',
        lanIps: detectLanIpv4List(),
        port: resolvePort(),
        rooms: summarizeRooms(),
      }),
    )
    return true
  }

  httpServer.on('upgrade', (req, socket, head) => {
    const urlPath = (req.url || '/').split('?')[0]
    if (urlPath !== LAN_WS_PATH && urlPath !== '/__starlog_lan_ws/') {
      return
    }
    const key = req.headers['sec-websocket-key']
    if (!key || typeof key !== 'string') {
      socket.destroy()
      return
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    )

    const client = createWsClient(socket)
    if (head && head.length > 0) {
      socket.unshift(head)
    }
    clients.add(client)

    client.send({
      type: 'hub-welcome',
      lanIps: detectLanIpv4List(),
      port: resolvePort(),
      rooms: summarizeRooms(),
    })

    client.onMessage = (msg) => {
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case 'hub-list-rooms': {
          client.send({
            type: 'hub-rooms',
            lanIps: detectLanIpv4List(),
            port: resolvePort(),
            rooms: summarizeRooms(),
          })
          return
        }

        case 'hub-host-room': {
          cleanupClientMembership(client)
          const code = String(msg.roomCode || '').trim().toUpperCase()
          if (!code) {
            client.send({ type: 'hub-error', message: '房间号不能为空' })
            return
          }
          const existing = rooms.get(code)
          if (existing && existing.hostClient !== client) {
            // 通知旧房主让出同房间号或拒绝冲突
            client.send({
              type: 'hub-error',
              message: `房间号 ${code} 已被占用，请换一个房间号`,
            })
            return
          }
          client.peerId = String(msg.peerId || '')
          client.peerName = String(msg.peerName || '房主')
          client.hostedRoom = code
          rooms.set(code, {
            roomCode: code,
            hostClient: client,
            hostPeerId: client.peerId,
            hostName: client.peerName,
            docTitle: String(msg.docTitle || '未命名文章'),
            guests: new Set(),
            createdAt: Date.now(),
          })
          client.send({
            type: 'hub-room-hosted',
            roomCode: code,
            lanIps: detectLanIpv4List(),
            port: resolvePort(),
          })
          broadcastRoomList()
          return
        }

        case 'hub-update-room': {
          const room = client.hostedRoom ? rooms.get(client.hostedRoom) : null
          if (room && room.hostClient === client) {
            if (typeof msg.docTitle === 'string') room.docTitle = msg.docTitle || '未命名文章'
            if (typeof msg.peerName === 'string' && msg.peerName.trim()) {
              room.hostName = msg.peerName.trim()
            }
            broadcastRoomList()
          }
          return
        }

        case 'hub-join-room': {
          cleanupClientMembership(client)
          let targetCode = String(msg.roomCode || '').trim().toUpperCase()
          if (!targetCode) {
            if (rooms.size === 1) {
              targetCode = [...rooms.keys()][0]
            } else if (rooms.size === 0) {
              client.send({
                type: 'hub-error',
                message: '该 IP 上暂无开启中的协作房间，请确认房主已点击「创建协作房间」',
                rooms: [],
              })
              return
            } else {
              const allCodes = [...rooms.keys()].join('、')
              client.send({
                type: 'hub-error',
                message: `该 IP 上有多个房间（${allCodes}），请输入要加入的房间号`,
                rooms: summarizeRooms(),
              })
              return
            }
          }

          const room = rooms.get(targetCode)
          if (!room) {
            client.send({
              type: 'hub-error',
              message:
                rooms.size > 0
                  ? `未找到房间 ${targetCode}（当前可用房间：${[...rooms.keys()].join('、')}）`
                  : `未找到房间 ${targetCode}，请确认房主已开启房间且房间号输入正确`,
              rooms: summarizeRooms(),
            })
            return
          }

          client.peerId = String(msg.peerId || '')
          client.peerName = String(msg.peerName || '协作者')
          client.joinedRoom = targetCode
          room.guests.add(client)

          client.send({
            type: 'hub-room-joined',
            roomCode: targetCode,
            hostPeerId: room.hostPeerId,
            hostName: room.hostName,
            docTitle: room.docTitle,
          })
          broadcastRoomList()
          return
        }

        case 'hub-leave-room': {
          cleanupClientMembership(client)
          return
        }

        case 'hub-relay': {
          const code = String(msg.roomCode || client.hostedRoom || client.joinedRoom || '')
            .trim()
            .toUpperCase()
          const room = rooms.get(code)
          if (!room || !msg.payload) return
          const targetPeerId = typeof msg.targetPeerId === 'string' ? msg.targetPeerId : ''
          const envelope = {
            type: 'hub-relay',
            roomCode: code,
            fromPeerId: client.peerId,
            payload: msg.payload,
          }

          if (client === room.hostClient) {
            for (const guest of room.guests) {
              if (!targetPeerId || guest.peerId === targetPeerId) {
                guest.send(envelope)
              }
            }
          } else if (room.guests.has(client)) {
            room.hostClient.send(envelope)
            if (!targetPeerId) {
              for (const other of room.guests) {
                if (other !== client) other.send(envelope)
              }
            }
          }
          return
        }
      }
    }

    client.onClose = () => {
      clients.delete(client)
      cleanupClientMembership(client)
    }
  })

  return { handleInfoRequest, rooms, summarizeRooms }
}

function findOfflineHtmlFile(baseDir) {
  const candidates = [
    path.join(baseDir, 'offline', 'index.html'),
    path.join(baseDir, 'dist-offline', 'index.html'),
    path.join(baseDir, 'index.html'),
    path.join(process.cwd(), 'offline', 'index.html'),
    path.join(process.cwd(), 'index.html'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const head = fs.readFileSync(p, 'utf8').slice(0, 2048)
        if (head.includes('offline-single-file') || p.endsWith(path.join('offline', 'index.html'))) {
          return p
        }
      }
    } catch {
      // ignore
    }
  }
  return null
}

export function startStandaloneLanHub(port = DEFAULT_LAN_HUB_PORT) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '..')

  let hubRef = null
  const server = http.createServer((req, res) => {
    if (hubRef && hubRef.handleInfoRequest(req, res)) return

    const urlPath = (req.url || '/').split('?')[0]
    if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/offline' || urlPath === '/offline/index.html') {
      const htmlFile = findOfflineHtmlFile(repoRoot)
      if (htmlFile) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        })
        fs.createReadStream(htmlFile).pipe(res)
        return
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Starlog 离线局域网协作服务运行中。请在离线版网页中输入本机 IP 连接协作。\n')
  })

  hubRef = attachLanCollabHub(server)

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      const actualPort = server.address()?.port || port
      resolve({ server, port: actualPort, lanIps: detectLanIpv4List(), hub: hubRef })
    })
  })
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  const requestedPort = Number.parseInt(process.argv[2] || process.env.PORT || '', 10) || DEFAULT_LAN_HUB_PORT
  startStandaloneLanHub(requestedPort)
    .then(({ port, lanIps }) => {
      console.log('\n========================================================')
      console.log('  星野笔记 · 离线版局域网合作文档直连服务已启动')
      console.log('========================================================')
      if (lanIps.length > 0) {
        for (const ip of lanIps) {
          console.log(`  本机局域网 IP ： ${ip}:${port === DEFAULT_LAN_HUB_PORT ? `${port}（可直接填 ${ip}）` : port}`)
          console.log(`  浏览器直达地址： http://${ip}:${port}/`)
        }
      } else {
        console.log(`  本机监听地址  ： 127.0.0.1:${port}`)
      }
      console.log('--------------------------------------------------------')
      console.log('  用法：同伴在离线版点击「局域网协作 → 加入协作」，')
      console.log('        输入上方 IP（或房间号）即可实时共同编辑！')
      console.log('        按 Ctrl + C 可随时停止服务。')
      console.log('========================================================\n')
    })
    .catch((err) => {
      console.error('启动局域网协作服务失败：', err.message)
      process.exit(1)
    })
}
