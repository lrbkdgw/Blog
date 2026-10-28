import { STORAGE_KEYS } from './config'
import { OFFLINE } from './runtime'

/**
 * 离线版局域网合作文档引擎（Issue #112）。
 *
 * 设计约束：
 * 1. **严格仅在离线版（OFFLINE === true）启用**：线上构建不暴露入口，也不允许创建会话。
 * 2. **极简连接体验（房间号 / 局域网 IP 直连）**：
 *    - **同机多窗口 / 同局域网直达页面**：输入 4 位房间号（或点击自动发现的房间）毫秒级秒连；
 *    - **跨局域网设备 IP 直连**：输入房主局域网 IP（如 `192.168.1.23`，默认端口 `8765` 自动补全；
 *      若该 IP 仅开启了一个房间，连房间号都可省略直接进入），基于纯局域网 WebSocket 实时同步；
 *    - **备用无服务配对码**：按需手动触发纯局域网 `RTCPeerConnection({ iceServers: [] })`，绝不在开启房间时阻塞等待。
 * 3. **零外网依赖**：不包含任何远程域名、STUN/TURN 地址或外部信令 URL，100% 通过 `verify-offline.mjs`。
 * 4. **增量变更同步 + 光标保持**：正文采用最小公共前后缀切片（`TextSplice`）+ 一维操作变换（OT）
 *    + FNV-1a 校验和自愈，多人同时在不同段落打字不会互相覆盖或打飞对方光标。
 */

export const DEFAULT_LAN_HUB_PORT = 8765
export const FALLBACK_PREVIEW_PORT = 5180
export const LAN_WS_PATH = '/__starlog_lan_ws'

export interface LanCollabMeta {
  title: string
  slug: string
  date: string
  summary: string
  author: string
  tagsText: string
  cover: string
  draft: boolean
  pinned: boolean
}

export interface LanCollabDocSnapshot {
  seq: number
  content: string
  meta: LanCollabMeta
}

export interface TextSplice {
  index: number
  deleteCount: number
  insertText: string
}

export interface LanCollabCursor {
  selectionStart: number
  selectionEnd: number
  line: number
  column: number
}

export type LanTransportKind = 'lan' | 'local' | 'webrtc'

export interface LanCollabPeer {
  peerId: string
  name: string
  color: string
  role: 'host' | 'guest'
  transport: LanTransportKind
  cursor: LanCollabCursor | null
  connectedAt: number
  lastSeenAt: number
}

export interface DiscoveredLanRoom {
  roomCode: string
  hostName: string
  docTitle: string
  peerCount: number
  source: 'local' | 'lan'
  hostAddress?: string
}

export type LanCollabRole = 'idle' | 'host' | 'guest'
export type LanCollabConnectionState =
  | 'idle'
  | 'preparing'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'closed'

export interface LanCollabState {
  role: LanCollabRole
  status: LanCollabConnectionState
  roomCode: string
  selfPeerId: string
  selfName: string
  selfColor: string
  /** 是否已连上局域网 IP 直连中枢（`npm run lan` / `preview:offline` / 独立助手脚本） */
  hubConnected: boolean
  /** 当前连接的局域网中枢端口 */
  hubPort: number
  /** 房主可供其他设备输入的局域网 IP 列表（如 `['192.168.1.23']`） */
  lanIps: string[]
  /** 客端当前连接的房主地址（如 `'192.168.1.23:8765'`） */
  connectedHostAddress: string
  /** 自动发现的可一键加入房间列表（同机窗口 + 局域网中枢） */
  discoveredRooms: DiscoveredLanRoom[]
  /** 备用无服务 WebRTC 邀请码（仅用户按需点击时生成，绝不自动阻塞） */
  inviteCode: string
  /** 备用无服务 WebRTC 响应码 */
  answerCode: string
  peers: LanCollabPeer[]
  seq: number
  error: string
}

export interface CollabSignalPayload {
  v: 1
  kind: 'offer' | 'answer'
  roomCode: string
  peerId: string
  peerName: string
  sdp: string
}

export interface ParsedLanTarget {
  wsUrls: string[]
  displayHost: string
  roomCode: string
}

const PEER_COLORS = [
  '#3563f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
]

const COLLAB_NAME_STORAGE_KEY = `${STORAGE_KEYS.drafts}:lan-collab-name`
const COLLAB_LAST_IP_STORAGE_KEY = `${STORAGE_KEYS.drafts}:lan-collab-last-ip`
const LOBBY_CHANNEL_NAME = 'starlog:lan-collab-lobby:v1'
const SIGNAL_PREFIX_DEFLATE = 'SL1Z.'
const SIGNAL_PREFIX_PLAIN = 'SL1P.'
const MAX_HISTORY_OPS = 240
const MAX_SEEN_WIRE_IDS = 600

export function isLanCollabSupportedInBuild(): boolean {
  return Boolean(OFFLINE)
}

export function hasWebRtcSupport(): boolean {
  return typeof globalThis.RTCPeerConnection === 'function'
}

export function loadSavedCollaboratorName(): string {
  try {
    const saved = localStorage.getItem(COLLAB_NAME_STORAGE_KEY)?.trim()
    if (saved) return saved.slice(0, 24)
  } catch {
    // 忽略受限存储
  }
  const suffix = Math.floor(100 + Math.random() * 900)
  return `协作者-${suffix}`
}

export function saveCollaboratorName(name: string): void {
  const trimmed = name.trim().slice(0, 24)
  if (!trimmed) return
  try {
    localStorage.setItem(COLLAB_NAME_STORAGE_KEY, trimmed)
  } catch {
    // 忽略受限存储
  }
}

export function loadSavedHostIp(): string {
  try {
    return localStorage.getItem(COLLAB_LAST_IP_STORAGE_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function saveHostIp(ip: string): void {
  const trimmed = ip.trim()
  try {
    if (trimmed) localStorage.setItem(COLLAB_LAST_IP_STORAGE_KEY, trimmed)
  } catch {
    // ignore
  }
}

/** 默认生成简洁好记的 4 位数字房间号（如 `4829`），便于口头告知或手机输入。 */
export function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function generateId(prefix = 'p'): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

function pickColorForPeer(peerId: string): string {
  let hash = 0
  for (let i = 0; i < peerId.length; i++) {
    hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0
  }
  return PEER_COLORS[hash % PEER_COLORS.length]
}

export function fnv1aHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 智能解析用户输入的「房主 IP / 链接」与「房间号」：
 * - 支持直接填 `192.168.1.23`（自动尝试默认端口 `:8765` 与 `:5180`）；
 * - 支持填 `192.168.1.23:8765`、`ws://192.168.1.23:8765`、`192.168.1.23/4829`；
 * - 支持直接粘贴完整协作链接 `http://192.168.1.23:8765/#/admin/new?collab=join&ip=...&room=4829`；
 * - 支持只填房间号 `4829`（自动尝试当前 HTTP 页面同源地址 + 本机 `127.0.0.1:8765` + `BroadcastChannel`）。
 */
export function parseLanTargetInput(ipOrUrlRaw: string, roomRaw = ''): ParsedLanTarget {
  let raw = (ipOrUrlRaw || '').trim()
  let extractedRoom = (roomRaw || '').trim().toUpperCase()

  if (raw) {
    // 若用户直接把整条分享链接粘进了输入框，自动提取 host 与 room 参数
    if (/^(?:https?|wss?):\/\//i.test(raw)) {
      try {
        const u = new URL(raw)
        if (!extractedRoom) {
          const directRoom = u.searchParams.get('room')
          if (directRoom) extractedRoom = directRoom.trim().toUpperCase()
          else if (u.hash.includes('?')) {
            const hashQuery = u.hash.slice(u.hash.indexOf('?') + 1)
            const hp = new URLSearchParams(hashQuery)
            if (hp.get('room')) extractedRoom = hp.get('room')!.trim().toUpperCase()
          }
        }
        const wsProto = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:'
        if (u.port) {
          return {
            wsUrls: [`${wsProto}//${u.host}${LAN_WS_PATH}`],
            displayHost: u.host,
            roomCode: extractedRoom,
          }
        }
        return {
          wsUrls: [
            `${wsProto}//${u.hostname}:${DEFAULT_LAN_HUB_PORT}${LAN_WS_PATH}`,
            `${wsProto}//${u.hostname}:${FALLBACK_PREVIEW_PORT}${LAN_WS_PATH}`,
          ],
          displayHost: u.hostname,
          roomCode: extractedRoom,
        }
      } catch {
        // 继续走常规 host:port 解析
      }
    }

    // 支持 `192.168.1.23/4829` 或 `192.168.1.23#4829` 简写
    const slashOrHash = raw.match(/^([^/#?\s]+)[/#]([A-Za-z0-9_-]{1,12})$/)
    if (slashOrHash) {
      raw = slashOrHash[1]
      if (!extractedRoom) extractedRoom = slashOrHash[2].toUpperCase()
    }

    // IPv6 `[::1]:8765` 或 IPv4/主机名 `192.168.1.23:8765`
    const ipv6Port = raw.match(/^\[([^\]]+)\](?::(\d+))?$/)
    if (ipv6Port) {
      const host = `[${ipv6Port[1]}]`
      const port = ipv6Port[2]
      return {
        wsUrls: port
          ? [`ws://${host}:${port}${LAN_WS_PATH}`]
          : [
              `ws://${host}:${DEFAULT_LAN_HUB_PORT}${LAN_WS_PATH}`,
              `ws://${host}:${FALLBACK_PREVIEW_PORT}${LAN_WS_PATH}`,
            ],
        displayHost: port ? `${host}:${port}` : host,
        roomCode: extractedRoom,
      }
    }

    const hostPort = raw.match(/^([^:\s]+)(?::(\d+))?$/)
    if (hostPort) {
      const host = hostPort[1]
      const port = hostPort[2]
      return {
        wsUrls: port
          ? [`ws://${host}:${port}${LAN_WS_PATH}`]
          : [
              `ws://${host}:${DEFAULT_LAN_HUB_PORT}${LAN_WS_PATH}`,
              `ws://${host}:${FALLBACK_PREVIEW_PORT}${LAN_WS_PATH}`,
            ],
        displayHost: port ? `${host}:${port}` : host,
        roomCode: extractedRoom,
      }
    }
  }

  // 未填写 IP：自动探测当前 HTTP 页面同源地址与本机默认端口
  const autoUrls: string[] = []
  let displayHost = ''
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol) && window.location.host) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    autoUrls.push(`${wsProto}//${window.location.host}${LAN_WS_PATH}`)
    displayHost = window.location.host
  }
  const localDefault = `ws://127.0.0.1:${DEFAULT_LAN_HUB_PORT}${LAN_WS_PATH}`
  if (!autoUrls.includes(localDefault)) {
    autoUrls.push(localDefault)
  }

  return {
    wsUrls: autoUrls,
    displayHost,
    roomCode: extractedRoom,
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** 计算从 `prev` 到 `next` 的最小单段文本变更（不拆散 UTF-16 代理对）。 */
export function computeTextSplice(prev: string, next: string): TextSplice | null {
  if (prev === next) return null
  const minLen = Math.min(prev.length, next.length)

  let start = 0
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1
  }
  if (
    start > 0 &&
    start < minLen &&
    isHighSurrogate(prev.charCodeAt(start - 1)) &&
    (isLowSurrogate(prev.charCodeAt(start)) || isLowSurrogate(next.charCodeAt(start)))
  ) {
    start -= 1
  }

  let endPrev = prev.length
  let endNext = next.length
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev -= 1
    endNext -= 1
  }
  if (
    endPrev < prev.length &&
    isLowSurrogate(prev.charCodeAt(endPrev)) &&
    isHighSurrogate(prev.charCodeAt(endPrev - 1))
  ) {
    endPrev += 1
    endNext += 1
  }

  return {
    index: start,
    deleteCount: endPrev - start,
    insertText: next.slice(start, endNext),
  }
}

export function applyTextSplice(text: string, splice: TextSplice): string {
  const idx = Math.max(0, Math.min(text.length, splice.index))
  const del = Math.max(0, Math.min(text.length - idx, splice.deleteCount))
  return text.slice(0, idx) + splice.insertText + text.slice(idx + del)
}

/** 将光标偏移映射到远端 splice 应用后的新位置，防止远端输入打乱本机光标。 */
export function transformCursorPosition(
  pos: number,
  splice: TextSplice,
  biasRight = false,
): number {
  const start = splice.index
  const end = splice.index + splice.deleteCount
  const insLen = splice.insertText.length
  const delta = insLen - splice.deleteCount

  if (pos < start) return pos
  if (pos === start) {
    if (splice.deleteCount === 0) return biasRight ? pos + insLen : pos
    return start
  }
  if (pos <= end) {
    return start + insLen
  }
  return Math.max(0, pos + delta)
}

/**
 * 一维单段文本 OT 变换：已知 `op` 与 `against` 基于同一文档版本生成，且 `against` 已先行应用，
 * 返回在 `against` 之后等价应用的 `op'`。
 */
export function transformSplice(
  op: TextSplice,
  against: TextSplice,
  tieBreakAfter: boolean,
): TextSplice {
  const opEnd = op.index + op.deleteCount
  const agEnd = against.index + against.deleteCount
  const agInsLen = against.insertText.length
  const agDelta = agInsLen - against.deleteCount

  if (op.deleteCount === 0 && against.deleteCount === 0 && op.index === against.index) {
    return {
      index: tieBreakAfter ? op.index + agInsLen : op.index,
      deleteCount: 0,
      insertText: op.insertText,
    }
  }

  if (opEnd < against.index || (opEnd === against.index && !tieBreakAfter)) {
    return { ...op }
  }

  if (op.index > agEnd || (op.index === agEnd && (against.deleteCount > 0 || tieBreakAfter))) {
    return {
      index: Math.max(0, op.index + agDelta),
      deleteCount: op.deleteCount,
      insertText: op.insertText,
    }
  }

  const leftSurvivingDel = Math.max(0, against.index - op.index)
  const rightSurvivingDel = Math.max(0, opEnd - agEnd)

  if (agInsLen === 0) {
    return {
      index: Math.min(op.index, against.index),
      deleteCount: leftSurvivingDel + rightSurvivingDel,
      insertText: op.insertText,
    }
  }

  if (tieBreakAfter) {
    return {
      index: Math.min(op.index, against.index) + agInsLen,
      deleteCount: rightSurvivingDel,
      insertText: op.insertText,
    }
  }

  return {
    index: Math.min(op.index, against.index),
    deleteCount: leftSurvivingDel,
    insertText: op.insertText,
  }
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(text.length, offset))
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lastNewline = i
    }
  }
  return { line, column: clamped - lastNewline }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const normalized = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const binary = atob(normalized + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

/**
 * 并发消费 `cs.readable` 防止 Chromium TransformStream 背压死锁，并带 250ms 超时秒回退明文编码。
 */
async function compressBytes(input: Uint8Array): Promise<{ compressed: boolean; bytes: Uint8Array }> {
  if (typeof globalThis.CompressionStream !== 'function') {
    return { compressed: false, bytes: input }
  }
  try {
    const task = (async () => {
      const cs = new CompressionStream('deflate-raw')
      const readPromise = new Response(cs.readable).arrayBuffer()
      const writer = cs.writable.getWriter()
      await writer.write(input as unknown as BufferSource)
      await writer.close()
      const buf = await readPromise
      const out = new Uint8Array(buf)
      return out.length < input.length
        ? { compressed: true, bytes: out }
        : { compressed: false, bytes: input }
    })()
    const timeout = new Promise<{ compressed: boolean; bytes: Uint8Array }>((resolve) =>
      setTimeout(() => resolve({ compressed: false, bytes: input }), 250),
    )
    return await Promise.race([task, timeout])
  } catch {
    return { compressed: false, bytes: input }
  }
}

async function decompressBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('当前浏览器不支持解压该邀请码')
  }
  const ds = new DecompressionStream('deflate-raw')
  const readPromise = new Response(ds.readable).arrayBuffer()
  const writer = ds.writable.getWriter()
  await writer.write(input as unknown as BufferSource)
  await writer.close()
  const buf = await readPromise
  return new Uint8Array(buf)
}

export async function encodeCollabSignal(payload: CollabSignalPayload): Promise<string> {
  const json = JSON.stringify(payload)
  const rawBytes = new TextEncoder().encode(json)
  const { compressed, bytes } = await compressBytes(rawBytes)
  return `${compressed ? SIGNAL_PREFIX_DEFLATE : SIGNAL_PREFIX_PLAIN}${bytesToBase64Url(bytes)}`
}

export async function decodeCollabSignal(code: string): Promise<CollabSignalPayload> {
  const trimmed = code.trim().replace(/\s+/g, '')
  let bytes: Uint8Array
  if (trimmed.startsWith(SIGNAL_PREFIX_DEFLATE)) {
    const raw = base64UrlToBytes(trimmed.slice(SIGNAL_PREFIX_DEFLATE.length))
    bytes = await decompressBytes(raw)
  } else if (trimmed.startsWith(SIGNAL_PREFIX_PLAIN)) {
    bytes = base64UrlToBytes(trimmed.slice(SIGNAL_PREFIX_PLAIN.length))
  } else {
    throw new Error('协作码格式不正确（应以 SL1Z. 或 SL1P. 开头）')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('协作码内容已损坏，请重新复制完整的邀请码或响应码')
  }

  const obj = parsed as Partial<CollabSignalPayload>
  if (
    !obj ||
    obj.v !== 1 ||
    (obj.kind !== 'offer' && obj.kind !== 'answer') ||
    typeof obj.sdp !== 'string' ||
    !obj.sdp ||
    typeof obj.roomCode !== 'string' ||
    typeof obj.peerId !== 'string'
  ) {
    throw new Error('协作码版本或字段无效')
  }

  return {
    v: 1,
    kind: obj.kind,
    roomCode: obj.roomCode,
    peerId: obj.peerId,
    peerName: typeof obj.peerName === 'string' && obj.peerName.trim() ? obj.peerName.trim() : '协作者',
    sdp: obj.sdp,
  }
}

/**
 * 生成可脱离仓库单独运行的零依赖 Node.js 局域网直连脚本（仅用内置 `http`/`crypto`/`os`/`fs`/`path`）。
 * 用户只拿着单个 `offline/index.html` 时也能一键下载或复制命令启动 IP 直连服务。
 */
export function buildStandaloneHubMjsSource(defaultPort = DEFAULT_LAN_HUB_PORT): string {
  return [
    '#!/usr/bin/env node',
    '// 星野笔记 · 离线版局域网合作文档直连助手（零依赖，仅使用 Node.js 标准库）',
    "import http from 'node:http';",
    "import crypto from 'node:crypto';",
    "import os from 'node:os';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    `const PORT = Number(process.argv[2] || process.env.PORT || ${defaultPort});`,
    "const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';",
    'const rooms = new Map(), clients = new Set();',
    'function lanIps() {',
    '  const out = [];',
    '  for (const list of Object.values(os.networkInterfaces())) {',
    '    for (const i of list || []) {',
    "      if ((i.family === 'IPv4' || i.family === 4) && !i.internal && i.address) out.push(i.address);",
    '    }',
    '  }',
    '  return [...new Set(out)];',
    '}',
    'function frame(op, buf) {',
    '  const n = buf.length;',
    '  if (n < 126) return Buffer.concat([Buffer.from([0x80 | op, n]), buf]);',
    '  if (n < 65536) { const h = Buffer.allocUnsafe(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); return Buffer.concat([h, buf]); }',
    '  const h = Buffer.allocUnsafe(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return Buffer.concat([h, buf]);',
    '}',
    'function roomList() {',
    "  return [...rooms.values()].map((r) => ({ roomCode: r.roomCode, hostPeerId: r.hostPeerId, hostName: r.hostName, docTitle: r.docTitle || '未命名文章', peerCount: 1 + r.guests.size }));",
    '}',
    'function bcastRooms() {',
    "  const msg = { type: 'hub-rooms', lanIps: lanIps(), port: PORT, rooms: roomList() };",
    '  for (const c of clients) c.send(msg);',
    '}',
    'function leave(c) {',
    '  if (c.hostedRoom) {',
    '    const r = rooms.get(c.hostedRoom); c.hostedRoom = "";',
    '    if (r && r.host === c) { rooms.delete(r.roomCode); for (const g of r.guests) { g.joinedRoom = ""; g.send({ type: "hub-relay", roomCode: r.roomCode, payload: { type: "bye", peerId: r.hostPeerId } }); } bcastRooms(); }',
    '  }',
    '  if (c.joinedRoom) {',
    '    const r = rooms.get(c.joinedRoom); c.joinedRoom = "";',
    '    if (r && r.guests.delete(c)) { const bye = { type: "hub-relay", roomCode: r.roomCode, payload: { type: "bye", peerId: c.peerId } }; r.host.send(bye); for (const g of r.guests) g.send(bye); bcastRooms(); }',
    '  }',
    '}',
    'const srv = http.createServer((req, res) => {',
    '  const u = (req.url || "/").split("?")[0];',
    '  if (u === "/__starlog_lan_info") {',
    '    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Private-Network": "true" });',
    '    res.end(JSON.stringify({ ok: true, service: "starlog-lan-collab", lanIps: lanIps(), port: PORT, rooms: roomList() }));',
    '    return;',
    '  }',
    '  for (const f of ["index.html", "starlog-offline-latest.html", "offline/index.html"]) {',
    '    const p = path.resolve(process.cwd(), f);',
    '    if (fs.existsSync(p) && fs.statSync(p).isFile()) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); fs.createReadStream(p).pipe(res); return; }',
    '  }',
    '  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });',
    '  res.end("Starlog LAN Collaboration Hub is running.\\n");',
    '});',
    'srv.on("upgrade", (req, sock) => {',
    '  const key = req.headers["sec-websocket-key"]; if (!key) { sock.destroy(); return; }',
    '  const acc = crypto.createHash("sha1").update(key + GUID).digest("base64");',
    '  sock.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + acc + "\\r\\n\\r\\n");',
    '  sock.setNoDelay(true);',
    '  let buf = Buffer.alloc(0), frags = [], dead = false;',
    '  const c = { peerId: "", hostedRoom: "", joinedRoom: "", send(o) { if (!dead && sock.writable) sock.write(frame(1, Buffer.from(JSON.stringify(o), "utf8"))); } };',
    '  clients.add(c);',
    '  c.send({ type: "hub-welcome", lanIps: lanIps(), port: PORT, rooms: roomList() });',
    '  sock.on("data", (ch) => {',
    '    buf = buf.length ? Buffer.concat([buf, ch]) : ch;',
    '    while (buf.length >= 2) {',
    '      const fin = (buf[0] & 128) !== 0, op = buf[0] & 15, msk = (buf[1] & 128) !== 0; let len = buf[1] & 127, off = 2;',
    '      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }',
    '      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }',
    '      let mask = null; if (msk) { if (buf.length < off + 4) break; mask = buf.subarray(off, off + 4); off += 4; }',
    '      if (buf.length < off + len) break;',
    '      const body = Buffer.from(buf.subarray(off, off + len)); buf = buf.subarray(off + len);',
    '      if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];',
    '      if (op === 8) { dead = true; sock.end(Buffer.from([0x88, 0])); return; }',
    '      if (op === 9) { sock.write(frame(10, body)); continue; }',
    '      if (op === 1 || op === 2) frags = [body]; else if (op === 0) frags.push(body);',
    '      if (fin && frags.length) {',
    '        const msg = JSON.parse(Buffer.concat(frags).toString("utf8")); frags = [];',
    '        if (msg.type === "hub-list-rooms") c.send({ type: "hub-rooms", lanIps: lanIps(), port: PORT, rooms: roomList() });',
    '        else if (msg.type === "hub-host-room") {',
    '          leave(c); const code = String(msg.roomCode || "").trim().toUpperCase();',
    '          c.peerId = String(msg.peerId || ""); c.hostedRoom = code;',
    '          rooms.set(code, { roomCode: code, host: c, hostPeerId: c.peerId, hostName: String(msg.peerName || "房主"), docTitle: String(msg.docTitle || ""), guests: new Set() });',
    '          c.send({ type: "hub-room-hosted", roomCode: code, lanIps: lanIps(), port: PORT }); bcastRooms();',
    '        } else if (msg.type === "hub-join-room") {',
    '          leave(c); let code = String(msg.roomCode || "").trim().toUpperCase();',
    '          if (!code && rooms.size === 1) code = [...rooms.keys()][0];',
    '          const r = rooms.get(code);',
    '          if (!r) { c.send({ type: "hub-error", message: rooms.size ? "请选择或输入房间号：" + [...rooms.keys()].join(" / ") : "该 IP 上暂无开启中的协作房间", rooms: roomList() }); }',
    '          else { c.peerId = String(msg.peerId || ""); c.joinedRoom = code; r.guests.add(c); c.send({ type: "hub-room-joined", roomCode: code, hostPeerId: r.hostPeerId }); bcastRooms(); }',
    '        } else if (msg.type === "hub-relay") {',
    '          const r = rooms.get(String(msg.roomCode || c.hostedRoom || c.joinedRoom || "").toUpperCase());',
    '          if (!r) continue; const env = { type: "hub-relay", roomCode: r.roomCode, payload: msg.payload };',
    '          if (c === r.host) { for (const g of r.guests) if (!msg.targetPeerId || g.peerId === msg.targetPeerId) g.send(env); }',
    '          else if (r.guests.has(c)) { r.host.send(env); if (!msg.targetPeerId) for (const g of r.guests) if (g !== c) g.send(env); }',
    '        }',
    '      }',
    '    }',
    '  });',
    '  const clean = () => { if (!dead) { dead = true; clients.delete(c); leave(c); } };',
    '  sock.on("close", clean); sock.on("error", clean);',
    '});',
    'srv.listen(PORT, "0.0.0.0", () => {',
    '  const ips = lanIps();',
    '  console.log("\\n[星野笔记] 局域网协作服务已就绪！房主 IP：", ips.length ? ips.map((x) => x + ":" + PORT).join(" , ") : "127.0.0.1:" + PORT);',
    '});',
    '',
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/*                               协作消息协议定义                               */
/* -------------------------------------------------------------------------- */

type WireMessage =
  | {
      _mid?: string
      type: 'hello'
      roomCode: string
      peerId: string
      name: string
      color: string
      role: 'host' | 'guest'
    }
  | {
      _mid?: string
      type: 'welcome-snapshot'
      targetPeerId?: string
      snapshot: LanCollabDocSnapshot
      peers: LanCollabPeer[]
    }
  | {
      _mid?: string
      type: 'client-op'
      opId: string
      authorId: string
      baseSeq: number
      splice: TextSplice
    }
  | {
      _mid?: string
      type: 'host-op'
      seq: number
      opId: string
      authorId: string
      splice: TextSplice
      checksum: number
      length: number
    }
  | {
      _mid?: string
      type: 'meta-patch'
      authorId: string
      seq?: number
      patch: Partial<LanCollabMeta>
    }
  | {
      _mid?: string
      type: 'cursor'
      peerId: string
      name: string
      color: string
      cursor: LanCollabCursor | null
    }
  | {
      _mid?: string
      type: 'peers-sync'
      peers: LanCollabPeer[]
    }
  | {
      _mid?: string
      type: 'request-sync'
      peerId: string
    }
  | {
      _mid?: string
      type: 'bye'
      peerId: string
    }

type LobbyMessage =
  | {
      type: 'lobby-announce'
      roomCode: string
      hostPeerId: string
      hostName: string
      docTitle: string
      peerCount: number
    }
  | {
      type: 'lobby-closed'
      roomCode: string
      hostPeerId: string
    }
  | {
      type: 'lobby-query'
    }

interface PeerLink {
  peerId: string
  transport: LanTransportKind
  send: (msg: WireMessage) => void
  close: () => void
}

interface PendingClientOp {
  opId: string
  splice: TextSplice
}

interface HostHistoryEntry {
  seq: number
  opId: string
  authorId: string
  splice: TextSplice
}

export interface LanCollabCallbacks {
  getInitialSnapshot: () => { content: string; meta: LanCollabMeta }
  onRemoteContentOperation: (nextContent: string, transformedSplice: TextSplice) => void
  onRemoteSnapshot: (snapshot: LanCollabDocSnapshot) => void
  onRemoteMetaPatch: (patch: Partial<LanCollabMeta>) => void
  onStateChange: (state: LanCollabState) => void
}

export interface CreateLanCollabOptions extends LanCollabCallbacks {
  initialName?: string
  /** 仅供自动化测试在非 OFFLINE 构建下验证协同算法，生产代码严禁传入。 */
  _allowInTest?: boolean
  /** 仅供测试注入自定义 BroadcastChannel 构造器。 */
  _BroadcastChannelImpl?: typeof BroadcastChannel | null
  /** 仅供测试注入自定义 WebSocket 构造器。 */
  _WebSocketImpl?: typeof WebSocket | null
}

async function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 700): Promise<void> {
  if (pc.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    let settled = false
    let quietTimer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (quietTimer) clearTimeout(quietTimer)
      clearTimeout(hardTimer)
      pc.removeEventListener('icegatheringstatechange', onState)
      pc.removeEventListener('icecandidate', onCandidate)
      resolve()
    }
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    const onCandidate = (ev: RTCPeerConnectionIceEvent) => {
      if (!ev.candidate) {
        finish()
        return
      }
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(finish, 160)
    }
    const hardTimer = setTimeout(finish, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onState)
    pc.addEventListener('icecandidate', onCandidate)
  })
}

export class LanCollabSessionManager {
  private readonly callbacks: LanCollabCallbacks
  private readonly BroadcastChannelCtor?: typeof BroadcastChannel
  private readonly WebSocketCtor?: typeof WebSocket

  private role: LanCollabRole = 'idle'
  private status: LanCollabConnectionState = 'idle'
  private roomCode = ''
  private readonly selfPeerId = generateId('peer')
  private selfName: string
  private readonly selfColor: string
  private inviteCode = ''
  private answerCode = ''
  private error = ''

  private hubWs: WebSocket | null = null
  private hubConnected = false
  private hubPort = DEFAULT_LAN_HUB_PORT
  private lanIps: string[] = []
  private connectedHostAddress = ''

  private localDiscovered = new Map<string, DiscoveredLanRoom>()
  private lanDiscovered: DiscoveredLanRoom[] = []
  private lobbyChannel: BroadcastChannel | null = null

  private seq = 0
  private shadowContent = ''
  private shadowMeta: LanCollabMeta

  private pendingOps: PendingClientOp[] = []
  private hostHistory: HostHistoryEntry[] = []
  private seenOpIds = new Set<string>()
  private seenWireIds: string[] = []
  private seenWireSet = new Set<string>()

  private peers = new Map<string, LanCollabPeer>()
  private peerLinks = new Map<string, PeerLink>()
  private broadcastChannel: BroadcastChannel | null = null

  private pendingHostPc: RTCPeerConnection | null = null
  private pendingHostDc: RTCDataChannel | null = null
  private guestPc: RTCPeerConnection | null = null

  constructor(options: CreateLanCollabOptions) {
    if (!OFFLINE && !options._allowInTest) {
      throw new Error('局域网合作文档仅在离线版中支持')
    }
    this.callbacks = options
    this.BroadcastChannelCtor =
      options._BroadcastChannelImpl !== undefined
        ? options._BroadcastChannelImpl ?? undefined
        : typeof globalThis.BroadcastChannel === 'function'
          ? globalThis.BroadcastChannel
          : undefined
    this.WebSocketCtor =
      options._WebSocketImpl !== undefined
        ? options._WebSocketImpl ?? undefined
        : typeof globalThis.WebSocket === 'function'
          ? globalThis.WebSocket
          : undefined
    this.selfName = (options.initialName?.trim() || loadSavedCollaboratorName()).slice(0, 24)
    this.selfColor = pickColorForPeer(this.selfPeerId)
    const init = options.getInitialSnapshot()
    this.shadowContent = init.content
    this.shadowMeta = { ...init.meta }
    this.initLobbyChannel()
  }

  private initLobbyChannel(): void {
    if (!this.BroadcastChannelCtor || this.lobbyChannel) return
    try {
      const ch = new this.BroadcastChannelCtor(LOBBY_CHANNEL_NAME)
      ch.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as LobbyMessage | undefined
        if (!msg || typeof msg.type !== 'string') return
        if (msg.type === 'lobby-query') {
          if (this.role === 'host' && this.roomCode) {
            this.announceLobbyRoom()
          }
          return
        }
        if (msg.type === 'lobby-announce') {
          if (msg.hostPeerId === this.selfPeerId) return
          this.localDiscovered.set(msg.roomCode, {
            roomCode: msg.roomCode,
            hostName: msg.hostName,
            docTitle: msg.docTitle || '未命名文章',
            peerCount: msg.peerCount,
            source: 'local',
          })
          this.emitState()
          return
        }
        if (msg.type === 'lobby-closed') {
          if (this.localDiscovered.delete(msg.roomCode)) {
            this.emitState()
          }
        }
      }
      this.lobbyChannel = ch
      ch.postMessage({ type: 'lobby-query' } satisfies LobbyMessage)
    } catch {
      // ignore
    }
  }

  private announceLobbyRoom(): void {
    if (!this.lobbyChannel || this.role !== 'host' || !this.roomCode) return
    try {
      this.lobbyChannel.postMessage({
        type: 'lobby-announce',
        roomCode: this.roomCode,
        hostPeerId: this.selfPeerId,
        hostName: this.selfName,
        docTitle: this.shadowMeta.title || '未命名文章',
        peerCount: Math.max(1, this.peers.size),
      } satisfies LobbyMessage)
    } catch {
      // ignore
    }
  }

  private mergedDiscoveredRooms(): DiscoveredLanRoom[] {
    const merged = new Map<string, DiscoveredLanRoom>()
    for (const r of this.lanDiscovered) {
      merged.set(r.roomCode, r)
    }
    for (const r of this.localDiscovered.values()) {
      if (!merged.has(r.roomCode)) {
        merged.set(r.roomCode, r)
      }
    }
    return [...merged.values()]
  }

  getState(): LanCollabState {
    const peerList = [...this.peers.values()].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'host' ? -1 : 1
      return a.connectedAt - b.connectedAt
    })
    return {
      role: this.role,
      status: this.status,
      roomCode: this.roomCode,
      selfPeerId: this.selfPeerId,
      selfName: this.selfName,
      selfColor: this.selfColor,
      hubConnected: this.hubConnected,
      hubPort: this.hubPort,
      lanIps: [...this.lanIps],
      connectedHostAddress: this.connectedHostAddress,
      discoveredRooms: this.mergedDiscoveredRooms(),
      inviteCode: this.inviteCode,
      answerCode: this.answerCode,
      peers: peerList,
      seq: this.seq,
      error: this.error,
    }
  }

  private emitState(): void {
    this.callbacks.onStateChange(this.getState())
  }

  setSelfName(name: string): void {
    const trimmed = name.trim().slice(0, 24)
    if (!trimmed || trimmed === this.selfName) return
    this.selfName = trimmed
    saveCollaboratorName(trimmed)
    const me = this.peers.get(this.selfPeerId)
    if (me) {
      me.name = trimmed
      me.lastSeenAt = Date.now()
      if (this.role === 'host') {
        this.broadcastPeersSync()
        this.announceLobbyRoom()
        this.sendHubRaw({
          type: 'hub-update-room',
          peerName: this.selfName,
          docTitle: this.shadowMeta.title || '未命名文章',
        })
      } else {
        this.sendToAll({
          type: 'hello',
          roomCode: this.roomCode,
          peerId: this.selfPeerId,
          name: this.selfName,
          color: this.selfColor,
          role: 'guest',
        })
      }
    }
    this.emitState()
  }

  /**
   * 作为房主立即创建协作房间（毫秒级同步就绪，绝不阻塞等待邀请码）：
   * - 同机窗口立即通过房间号（`BroadcastChannel`）连通；
   * - 后台自动探测并挂载本机局域网直连服务（若已启动则自动展示本机局域网 IP）。
   */
  async startHosting(customRoomCode?: string): Promise<string> {
    this.resetInternal(false)
    const init = this.callbacks.getInitialSnapshot()
    this.shadowContent = init.content
    this.shadowMeta = { ...init.meta }
    this.seq = 1
    this.roomCode = (customRoomCode?.trim().toUpperCase() || generateRoomCode()).slice(0, 12)
    this.role = 'host'
    this.status = 'waiting'
    this.error = ''

    const now = Date.now()
    this.peers.set(this.selfPeerId, {
      peerId: this.selfPeerId,
      name: this.selfName,
      color: this.selfColor,
      role: 'host',
      transport: 'local',
      cursor: null,
      connectedAt: now,
      lastSeenAt: now,
    })

    this.openBroadcastChannel(this.roomCode)
    this.announceLobbyRoom()
    this.emitState()

    // 后台非阻塞自动连接本机局域网 IP 直连中枢
    void this.tryAttachHostToLocalHub()
    return this.roomCode
  }

  /** 房主界面定时或手动探测本机局域网直连服务是否已启动，一旦启动自动转为绿灯并展示局域网 IP。 */
  async tryAttachHostToLocalHub(customHubHost?: string): Promise<boolean> {
    if (this.role !== 'host' || this.hubConnected || !this.WebSocketCtor) {
      return this.hubConnected
    }
    const target = parseLanTargetInput(customHubHost || '', this.roomCode)
    for (const wsUrl of target.wsUrls) {
      const ok = await this.connectHostHubSocket(wsUrl)
      if (ok) return true
    }
    return false
  }

  private connectHostHubSocket(wsUrl: string): Promise<boolean> {
    if (!this.WebSocketCtor || this.role !== 'host') return Promise.resolve(false)
    const WsCtor = this.WebSocketCtor
    const expectedRoom = this.roomCode

    return new Promise<boolean>((resolve) => {
      let settled = false
      let ws: WebSocket
      try {
        ws = new WsCtor(wsUrl)
      } catch {
        resolve(false)
        return
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          try {
            ws.close()
          } catch {
            // ignore
          }
          resolve(false)
        }
      }, 1200)

      ws.onopen = () => {
        if (this.role !== 'host' || this.roomCode !== expectedRoom) {
          clearTimeout(timer)
          ws.close()
          if (!settled) {
            settled = true
            resolve(false)
          }
          return
        }
        ws.send(
          JSON.stringify({
            type: 'hub-host-room',
            roomCode: this.roomCode,
            peerId: this.selfPeerId,
            peerName: this.selfName,
            docTitle: this.shadowMeta.title || '未命名文章',
          }),
        )
      }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          return
        }

        if (msg.type === 'hub-welcome' || msg.type === 'hub-rooms') {
          if (Array.isArray(msg.lanIps)) {
            this.lanIps = msg.lanIps.map(String)
          }
          if (typeof msg.port === 'number') {
            this.hubPort = msg.port
          }
          this.emitState()
          return
        }

        if (msg.type === 'hub-room-hosted') {
          clearTimeout(timer)
          this.closeHubWsOnly()
          this.hubWs = ws
          this.hubConnected = true
          if (Array.isArray(msg.lanIps)) this.lanIps = msg.lanIps.map(String)
          if (typeof msg.port === 'number') this.hubPort = msg.port
          this.error = ''
          this.emitState()
          if (!settled) {
            settled = true
            resolve(true)
          }
          return
        }

        if (msg.type === 'hub-error') {
          clearTimeout(timer)
          if (typeof msg.message === 'string') {
            this.error = msg.message
            this.emitState()
          }
          if (!settled) {
            settled = true
            ws.close()
            resolve(false)
          }
          return
        }

        if (msg.type === 'hub-relay' && msg.payload && typeof msg.payload === 'object') {
          this.handleWireMessage(msg.payload as WireMessage, 'lan')
        }
      }

      const handleCloseOrErr = () => {
        clearTimeout(timer)
        if (this.hubWs === ws) {
          this.hubWs = null
          this.hubConnected = false
          this.emitState()
        }
        if (!settled) {
          settled = true
          resolve(false)
        }
      }

      ws.onerror = handleCloseOrErr
      ws.onclose = handleCloseOrErr
    })
  }

  /**
   * 探测可用房间列表（同机多窗口 + 可选指定局域网 IP 上的开启房间）。
   */
  async refreshDiscoveredRooms(ipInput = ''): Promise<DiscoveredLanRoom[]> {
    this.lobbyChannel?.postMessage({ type: 'lobby-query' } satisfies LobbyMessage)
    if (!this.WebSocketCtor) return this.mergedDiscoveredRooms()

    const parsed = parseLanTargetInput(ipInput, '')
    const WsCtor = this.WebSocketCtor

    for (const wsUrl of parsed.wsUrls) {
      const found = await new Promise<DiscoveredLanRoom[] | null>((resolve) => {
        let done = false
        let ws: WebSocket
        try {
          ws = new WsCtor(wsUrl)
        } catch {
          resolve(null)
          return
        }
        const timer = setTimeout(() => {
          if (!done) {
            done = true
            try {
              ws.close()
            } catch {
              // ignore
            }
            resolve(null)
          }
        }, 900)

        ws.onmessage = (ev) => {
          if (done || typeof ev.data !== 'string') return
          try {
            const msg = JSON.parse(ev.data) as {
              type?: string
              rooms?: Array<{
                roomCode: string
                hostName: string
                docTitle: string
                peerCount: number
              }>
              port?: number
              lanIps?: string[]
            }
            if ((msg.type === 'hub-welcome' || msg.type === 'hub-rooms') && Array.isArray(msg.rooms)) {
              done = true
              clearTimeout(timer)
              const hostAddr =
                parsed.displayHost ||
                (Array.isArray(msg.lanIps) && msg.lanIps[0]
                  ? `${msg.lanIps[0]}:${msg.port || DEFAULT_LAN_HUB_PORT}`
                  : '')
              const list: DiscoveredLanRoom[] = msg.rooms.map((r) => ({
                roomCode: r.roomCode,
                hostName: r.hostName,
                docTitle: r.docTitle || '未命名文章',
                peerCount: r.peerCount,
                source: 'lan',
                hostAddress: hostAddr,
              }))
              ws.close()
              resolve(list)
            }
          } catch {
            // ignore
          }
        }
        const fail = () => {
          if (!done) {
            done = true
            clearTimeout(timer)
            resolve(null)
          }
        }
        ws.onerror = fail
        ws.onclose = fail
      })

      if (found) {
        this.lanDiscovered = found
        this.emitState()
        return this.mergedDiscoveredRooms()
      }
    }

    return this.mergedDiscoveredRooms()
  }

  /**
   * 极简加入协作：支持「仅输入房间号」、「仅输入房主 IP」或「IP + 房间号」一键直连。
   */
  async joinByIpOrRoom(ipOrHostInput: string, roomCodeInput = ''): Promise<void> {
    const parsed = parseLanTargetInput(ipOrHostInput, roomCodeInput)
    const hasExplicitIp = Boolean(ipOrHostInput.trim())

    if (!hasExplicitIp && !parsed.roomCode && parsed.wsUrls.length === 0) {
      throw new Error('请输入房间号或房主局域网 IP')
    }

    if (hasExplicitIp) {
      saveHostIp(ipOrHostInput.trim())
    }

    this.resetInternal(false)
    this.role = 'guest'
    this.status = 'connecting'
    this.roomCode = parsed.roomCode
    this.connectedHostAddress = parsed.displayHost
    this.error = ''

    const now = Date.now()
    this.peers.set(this.selfPeerId, {
      peerId: this.selfPeerId,
      name: this.selfName,
      color: this.selfColor,
      role: 'guest',
      transport: hasExplicitIp ? 'lan' : 'local',
      cursor: null,
      connectedAt: now,
      lastSeenAt: now,
    })
    this.emitState()

    // 1. 若未指定跨机 IP 且填写了房间号，同时启用同机 BroadcastChannel 秒连
    if (!hasExplicitIp && parsed.roomCode) {
      this.openBroadcastChannel(parsed.roomCode)
      this.sendBroadcast({
        type: 'hello',
        roomCode: parsed.roomCode,
        peerId: this.selfPeerId,
        name: this.selfName,
        color: this.selfColor,
        role: 'guest',
      })
    }

    // 2. 尝试通过局域网 WebSocket 直连房主 IP / 当前服务端口
    if (this.WebSocketCtor && parsed.wsUrls.length > 0) {
      let lastHubError = ''
      for (const wsUrl of parsed.wsUrls) {
        const res = await this.tryJoinViaWebSocket(wsUrl, parsed.roomCode)
        if (res.ok) {
          return
        }
        if (res.hubError) {
          lastHubError = res.hubError
          // 已经连上目标 IP 的服务并返回了明确业务提示（如需要选择具体房间号），无需继续试备用端口
          break
        }
      }

      if (hasExplicitIp) {
        this.status = 'closed'
        this.error =
          lastHubError ||
          `无法连接到 ${parsed.displayHost || ipOrHostInput.trim()}，请确认房主已启动局域网直连服务且双方在同一局域网`
        this.emitState()
        throw new Error(this.error)
      }

      // 未填 IP 且本地 BroadcastChannel 也没在短时间内收到房主响应时，若没填房间号则提示
      if (!parsed.roomCode) {
        this.status = 'closed'
        this.error = lastHubError || '请输入 4 位房间号，或填写房主的局域网 IP 地址'
        this.emitState()
        throw new Error(this.error)
      }
    }
  }

  private tryJoinViaWebSocket(
    wsUrl: string,
    requestedRoomCode: string,
  ): Promise<{ ok: boolean; hubError?: string }> {
    if (!this.WebSocketCtor) return Promise.resolve({ ok: false })
    const WsCtor = this.WebSocketCtor

    return new Promise((resolve) => {
      let settled = false
      let ws: WebSocket
      try {
        ws = new WsCtor(wsUrl)
      } catch {
        resolve({ ok: false })
        return
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          try {
            ws.close()
          } catch {
            // ignore
          }
          resolve({ ok: false })
        }
      }, 2200)

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'hub-join-room',
            roomCode: requestedRoomCode,
            peerId: this.selfPeerId,
            peerName: this.selfName,
          }),
        )
      }

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          return
        }

        if (msg.type === 'hub-room-joined') {
          clearTimeout(timer)
          const joinedCode = String(msg.roomCode || requestedRoomCode).toUpperCase()
          this.closeHubWsOnly()
          this.hubWs = ws
          this.hubConnected = true
          this.roomCode = joinedCode
          try {
            const parsedUrl = new URL(wsUrl)
            this.connectedHostAddress = parsedUrl.host
          } catch {
            // ignore
          }
          const selfPeer = this.peers.get(this.selfPeerId)
          if (selfPeer) selfPeer.transport = 'lan'
          this.error = ''
          this.emitState()

          // 向房主发送握手请求拉取最新全文快照
          this.sendHubRelay({
            type: 'hello',
            roomCode: joinedCode,
            peerId: this.selfPeerId,
            name: this.selfName,
            color: this.selfColor,
            role: 'guest',
          })

          if (!settled) {
            settled = true
            resolve({ ok: true })
          }
          return
        }

        if (msg.type === 'hub-error') {
          clearTimeout(timer)
          const errText = typeof msg.message === 'string' ? msg.message : '加入局域网房间失败'
          if (Array.isArray(msg.rooms)) {
            let hostAddr = this.connectedHostAddress
            try {
              hostAddr = new URL(wsUrl).host
            } catch {
              // ignore
            }
            this.lanDiscovered = (
              msg.rooms as Array<{
                roomCode: string
                hostName: string
                docTitle: string
                peerCount: number
              }>
            ).map((r) => ({
              roomCode: r.roomCode,
              hostName: r.hostName,
              docTitle: r.docTitle || '未命名文章',
              peerCount: r.peerCount,
              source: 'lan',
              hostAddress: hostAddr,
            }))
            this.emitState()
          }
          if (!settled) {
            settled = true
            ws.close()
            resolve({ ok: false, hubError: errText })
          }
          return
        }

        if (msg.type === 'hub-relay' && msg.payload && typeof msg.payload === 'object') {
          this.handleWireMessage(msg.payload as WireMessage, 'lan')
        }
      }

      const handleDisconnect = () => {
        clearTimeout(timer)
        if (this.hubWs === ws) {
          this.hubWs = null
          this.hubConnected = false
          if (this.role === 'guest' && !this.broadcastChannel && this.peerLinks.size === 0) {
            this.status = 'closed'
            this.error = '与房主的局域网连接已断开'
          }
          this.emitState()
        }
        if (!settled) {
          settled = true
          resolve({ ok: false })
        }
      }

      ws.onerror = handleDisconnect
      ws.onclose = handleDisconnect
    })
  }

  /** 通过房间号在同一设备的多窗口间免粘贴快速加入（同步接口，兼容自动化测试与快捷调用）。 */
  joinLocalRoom(roomCodeInput: string): void {
    const cleanRoom = roomCodeInput.trim().toUpperCase()
    if (!cleanRoom) {
      throw new Error('请输入房间号')
    }
    if (!this.BroadcastChannelCtor && !this.WebSocketCtor) {
      throw new Error('当前浏览器不支持本地房间连接')
    }

    this.resetInternal(false)
    this.role = 'guest'
    this.status = 'connecting'
    this.roomCode = cleanRoom
    this.error = ''
    const now = Date.now()
    this.peers.set(this.selfPeerId, {
      peerId: this.selfPeerId,
      name: this.selfName,
      color: this.selfColor,
      role: 'guest',
      transport: 'local',
      cursor: null,
      connectedAt: now,
      lastSeenAt: now,
    })
    this.emitState()

    this.openBroadcastChannel(cleanRoom)
    this.sendBroadcast({
      type: 'hello',
      roomCode: cleanRoom,
      peerId: this.selfPeerId,
      name: this.selfName,
      color: this.selfColor,
      role: 'guest',
    })

    // 若当前在 HTTP 局域网服务下打开，也顺带尝试同源 WebSocket 房间
    if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol) && window.location.host) {
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      void this.tryJoinViaWebSocket(`${wsProto}//${window.location.host}${LAN_WS_PATH}`, cleanRoom)
    }
  }

  /** 按需为备用无服务模式生成 WebRTC 配对邀请码（不会在 startHosting 时自动调用阻塞）。 */
  async prepareNextHostOffer(): Promise<string> {
    if (this.role !== 'host') throw new Error('只有房主可以生成配对码')
    if (!hasWebRtcSupport()) throw new Error('当前浏览器环境不支持 WebRTC 数据通道')

    if (this.pendingHostPc) {
      try {
        this.pendingHostDc?.close()
        this.pendingHostPc.close()
      } catch {
        // ignore
      }
      this.pendingHostPc = null
      this.pendingHostDc = null
    }

    const pc = new RTCPeerConnection({ iceServers: [] })
    const dc = pc.createDataChannel('starlog-lan-collab', { ordered: true })
    this.pendingHostPc = pc
    this.pendingHostDc = dc

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceGathering(pc)

    const localSdp = pc.localDescription?.sdp
    if (!localSdp) {
      throw new Error('未能收集到本机 WebRTC 连接信息，请改用上方 IP 直连模式')
    }

    this.inviteCode = await encodeCollabSignal({
      v: 1,
      kind: 'offer',
      roomCode: this.roomCode,
      peerId: this.selfPeerId,
      peerName: this.selfName,
      sdp: localSdp,
    })
    this.emitState()
    return this.inviteCode
  }

  /** 备用无服务模式：房主填入协作者回传的响应码完成握手。 */
  async acceptGuestAnswer(answerCodeInput: string): Promise<void> {
    if (this.role !== 'host') throw new Error('当前不是房主模式')
    if (!this.pendingHostPc || !this.pendingHostDc) {
      throw new Error('请先点击「生成配对码」后再填入响应码')
    }

    const signal = await decodeCollabSignal(answerCodeInput)
    if (signal.kind !== 'answer') {
      throw new Error('粘贴的是邀请码而非响应码，请粘贴对方生成的「响应码」')
    }
    if (signal.roomCode !== this.roomCode) {
      throw new Error(`房间号不匹配（当前房间 ${this.roomCode}，响应码属于 ${signal.roomCode}）`)
    }

    const pc = this.pendingHostPc
    const dc = this.pendingHostDc
    this.pendingHostPc = null
    this.pendingHostDc = null
    this.inviteCode = ''
    this.error = ''

    this.bindWebRtcChannel(pc, dc, signal.peerId, signal.peerName, 'guest')
    await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
  }

  /** 备用无服务模式：协作者粘贴房主配对码加入，返回响应码。 */
  async joinWithInviteCode(inviteCodeInput: string): Promise<string> {
    const signal = await decodeCollabSignal(inviteCodeInput)
    if (signal.kind !== 'offer') {
      throw new Error('粘贴的不是有效的房主配对码')
    }
    if (!hasWebRtcSupport()) {
      throw new Error('当前浏览器不支持 WebRTC 数据通道')
    }

    this.resetInternal(false)
    this.role = 'guest'
    this.status = 'connecting'
    this.roomCode = signal.roomCode
    this.error = ''
    const now = Date.now()
    this.peers.set(this.selfPeerId, {
      peerId: this.selfPeerId,
      name: this.selfName,
      color: this.selfColor,
      role: 'guest',
      transport: 'webrtc',
      cursor: null,
      connectedAt: now,
      lastSeenAt: now,
    })
    this.emitState()

    const pc = new RTCPeerConnection({ iceServers: [] })
    this.guestPc = pc
    pc.ondatachannel = (ev) => {
      this.bindWebRtcChannel(pc, ev.channel, signal.peerId, signal.peerName, 'host')
    }

    await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceGathering(pc)

    const localSdp = pc.localDescription?.sdp
    if (!localSdp) {
      throw new Error('无法生成本机响应码')
    }

    this.answerCode = await encodeCollabSignal({
      v: 1,
      kind: 'answer',
      roomCode: this.roomCode,
      peerId: this.selfPeerId,
      peerName: this.selfName,
      sdp: localSdp,
    })
    this.emitState()
    return this.answerCode
  }

  /** 本机正文变化时由编辑器调用，自动计算增量切片并广播。 */
  notifyLocalContentChange(nextContent: string): void {
    if (this.role === 'idle' || nextContent === this.shadowContent) return
    const splice = computeTextSplice(this.shadowContent, nextContent)
    if (!splice) return
    this.shadowContent = nextContent

    const opId = generateId('op')
    this.seenOpIds.add(opId)

    if (this.role === 'host') {
      this.seq += 1
      this.pushHostHistory({
        seq: this.seq,
        opId,
        authorId: this.selfPeerId,
        splice,
      })
      this.sendToAll({
        type: 'host-op',
        seq: this.seq,
        opId,
        authorId: this.selfPeerId,
        splice,
        checksum: fnv1aHash(this.shadowContent),
        length: this.shadowContent.length,
      })
      this.emitState()
      return
    }

    this.pendingOps.push({ opId, splice })
    this.sendToAll({
      type: 'client-op',
      opId,
      authorId: this.selfPeerId,
      baseSeq: this.seq,
      splice,
    })
  }

  /** 本机元信息（标题、摘要、标签等）变化时广播增量补丁。 */
  notifyLocalMetaChange(nextMeta: LanCollabMeta): void {
    if (this.role === 'idle') return
    const patch: Partial<LanCollabMeta> = {}
    let changed = false
    const assignMetaField = <K extends keyof LanCollabMeta>(
      target: Partial<LanCollabMeta>,
      key: K,
      val: LanCollabMeta[K],
    ) => {
      target[key] = val
    }
    for (const key of Object.keys(nextMeta) as (keyof LanCollabMeta)[]) {
      if (this.shadowMeta[key] !== nextMeta[key]) {
        assignMetaField(patch, key, nextMeta[key])
        assignMetaField(this.shadowMeta, key, nextMeta[key])
        changed = true
      }
    }
    if (!changed) return

    if (this.role === 'host') {
      this.seq += 1
      this.sendToAll({
        type: 'meta-patch',
        authorId: this.selfPeerId,
        seq: this.seq,
        patch,
      })
      if (patch.title !== undefined) {
        this.announceLobbyRoom()
        this.sendHubRaw({
          type: 'hub-update-room',
          docTitle: this.shadowMeta.title || '未命名文章',
        })
      }
      this.emitState()
    } else {
      this.sendToAll({
        type: 'meta-patch',
        authorId: this.selfPeerId,
        patch,
      })
    }
  }

  /** 广播本机光标与选区位置。 */
  notifyLocalCursor(selectionStart: number, selectionEnd: number): void {
    if (this.role === 'idle') return
    const pos = offsetToLineColumn(this.shadowContent, selectionStart)
    const cursor: LanCollabCursor = {
      selectionStart,
      selectionEnd,
      line: pos.line,
      column: pos.column,
    }
    const me = this.peers.get(this.selfPeerId)
    if (me) {
      me.cursor = cursor
      me.lastSeenAt = Date.now()
    }
    this.sendToAll({
      type: 'cursor',
      peerId: this.selfPeerId,
      name: this.selfName,
      color: this.selfColor,
      cursor,
    })
    this.emitState()
  }

  disconnect(): void {
    if (this.role === 'host' && this.roomCode) {
      try {
        this.lobbyChannel?.postMessage({
          type: 'lobby-closed',
          roomCode: this.roomCode,
          hostPeerId: this.selfPeerId,
        } satisfies LobbyMessage)
      } catch {
        // ignore
      }
    }
    if (this.role !== 'idle') {
      this.sendToAll({ type: 'bye', peerId: this.selfPeerId })
      this.sendHubRaw({ type: 'hub-leave-room' })
    }
    this.resetInternal(true)
  }

  private closeHubWsOnly(): void {
    if (this.hubWs) {
      const old = this.hubWs
      this.hubWs = null
      this.hubConnected = false
      try {
        old.close()
      } catch {
        // ignore
      }
    }
  }

  private resetInternal(emit: boolean): void {
    for (const link of this.peerLinks.values()) {
      try {
        link.close()
      } catch {
        // ignore
      }
    }
    this.peerLinks.clear()
    this.peers.clear()
    this.pendingOps = []
    this.hostHistory = []
    this.seenOpIds.clear()
    this.seenWireIds = []
    this.seenWireSet.clear()

    this.closeHubWsOnly()
    this.lanIps = []
    this.connectedHostAddress = ''

    if (this.pendingHostDc) {
      try {
        this.pendingHostDc.close()
      } catch {
        // ignore
      }
      this.pendingHostDc = null
    }
    if (this.pendingHostPc) {
      try {
        this.pendingHostPc.close()
      } catch {
        // ignore
      }
      this.pendingHostPc = null
    }
    if (this.guestPc) {
      try {
        this.guestPc.close()
      } catch {
        // ignore
      }
      this.guestPc = null
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch {
        // ignore
      }
      this.broadcastChannel = null
    }

    this.role = 'idle'
    this.status = 'idle'
    this.roomCode = ''
    this.inviteCode = ''
    this.answerCode = ''
    this.error = ''
    this.seq = 0
    if (emit) this.emitState()
  }

  private openBroadcastChannel(roomCode: string): void {
    if (!this.BroadcastChannelCtor) return
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch {
        // ignore
      }
    }
    const channel = new this.BroadcastChannelCtor(`starlog:lan-collab:${roomCode}`)
    channel.onmessage = (event: MessageEvent) => {
      const msg = event.data as WireMessage | undefined
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
      this.handleWireMessage(msg, 'local')
    }
    this.broadcastChannel = channel
  }

  private bindWebRtcChannel(
    pc: RTCPeerConnection,
    dc: RTCDataChannel,
    remotePeerId: string,
    remoteName: string,
    remoteRole: 'host' | 'guest',
  ): void {
    const onOpen = () => {
      this.peerLinks.set(remotePeerId, {
        peerId: remotePeerId,
        transport: 'webrtc',
        send: (msg) => {
          if (dc.readyState === 'open') {
            dc.send(JSON.stringify(msg))
          }
        },
        close: () => {
          dc.close()
          pc.close()
        },
      })

      const now = Date.now()
      this.peers.set(remotePeerId, {
        peerId: remotePeerId,
        name: remoteName,
        color: pickColorForPeer(remotePeerId),
        role: remoteRole,
        transport: 'webrtc',
        cursor: null,
        connectedAt: now,
        lastSeenAt: now,
      })
      this.status = 'connected'
      this.error = ''

      dc.send(
        JSON.stringify({
          _mid: generateId('m'),
          type: 'hello',
          roomCode: this.roomCode,
          peerId: this.selfPeerId,
          name: this.selfName,
          color: this.selfColor,
          role: this.role === 'host' ? 'host' : 'guest',
        } satisfies WireMessage),
      )

      if (this.role === 'host') {
        this.sendWelcomeSnapshot(remotePeerId)
        this.broadcastPeersSync()
      }
      this.emitState()
    }

    dc.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        const msg = JSON.parse(event.data) as WireMessage
        if (msg && typeof msg.type === 'string') {
          this.handleWireMessage(msg, 'webrtc')
        }
      } catch {
        // ignore
      }
    }

    const handleDisconnect = () => {
      if (this.peerLinks.get(remotePeerId)?.transport === 'webrtc') {
        this.peerLinks.delete(remotePeerId)
        this.peers.delete(remotePeerId)
        if (this.role === 'host') {
          this.status = this.peers.size > 1 ? 'connected' : 'waiting'
          this.broadcastPeersSync()
        } else if (this.peers.size <= 1) {
          this.status = 'closed'
          this.error = '与房主的局域网连接已断开'
        }
        this.emitState()
      }
    }

    dc.onclose = handleDisconnect
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      ) {
        handleDisconnect()
      }
    }

    if (dc.readyState === 'open') {
      onOpen()
    } else {
      dc.onopen = onOpen
    }
  }

  private stampMessage(msg: WireMessage): WireMessage {
    if (msg._mid) return msg
    return { ...msg, _mid: generateId('m') }
  }

  private rememberWireId(mid?: string): boolean {
    if (!mid) return true
    if (this.seenWireSet.has(mid)) return false
    this.seenWireSet.add(mid)
    this.seenWireIds.push(mid)
    if (this.seenWireIds.length > MAX_SEEN_WIRE_IDS) {
      const oldest = this.seenWireIds.shift()
      if (oldest) this.seenWireSet.delete(oldest)
    }
    return true
  }

  private sendHubRaw(obj: Record<string, unknown>): void {
    if (!this.hubWs || this.hubWs.readyState !== 1) return
    try {
      this.hubWs.send(JSON.stringify(obj))
    } catch {
      // ignore
    }
  }

  private sendHubRelay(msg: WireMessage, targetPeerId?: string): void {
    if (!this.hubWs || this.hubWs.readyState !== 1 || !this.roomCode) return
    const stamped = this.stampMessage(msg)
    this.rememberWireId(stamped._mid)
    this.sendHubRaw({
      type: 'hub-relay',
      roomCode: this.roomCode,
      targetPeerId,
      payload: stamped,
    })
  }

  private sendBroadcast(msg: WireMessage): void {
    try {
      const stamped = this.stampMessage(msg)
      this.rememberWireId(stamped._mid)
      this.broadcastChannel?.postMessage(stamped)
    } catch {
      // ignore
    }
  }

  private sendToAll(msg: WireMessage): void {
    const stamped = this.stampMessage(msg)
    this.rememberWireId(stamped._mid)
    for (const link of this.peerLinks.values()) {
      try {
        link.send(stamped)
      } catch {
        // ignore
      }
    }
    this.sendHubRelay(stamped)
    this.sendBroadcast(stamped)
  }

  private sendWelcomeSnapshot(targetPeerId?: string): void {
    if (this.role !== 'host') return
    const stamped = this.stampMessage({
      type: 'welcome-snapshot',
      targetPeerId,
      snapshot: {
        seq: this.seq,
        content: this.shadowContent,
        meta: { ...this.shadowMeta },
      },
      peers: [...this.peers.values()],
    })
    this.rememberWireId(stamped._mid)
    const direct = targetPeerId ? this.peerLinks.get(targetPeerId) : undefined
    if (direct) {
      direct.send(stamped)
      return
    }
    if (this.hubWs && this.hubWs.readyState === 1) {
      this.sendHubRelay(stamped, targetPeerId)
    }
    this.sendBroadcast(stamped)
  }

  private broadcastPeersSync(): void {
    if (this.role !== 'host') return
    this.announceLobbyRoom()
    this.sendToAll({
      type: 'peers-sync',
      peers: [...this.peers.values()],
    })
  }

  private pushHostHistory(entry: HostHistoryEntry): void {
    this.hostHistory.push(entry)
    if (this.hostHistory.length > MAX_HISTORY_OPS) {
      this.hostHistory.splice(0, this.hostHistory.length - MAX_HISTORY_OPS)
    }
  }

  private handleWireMessage(msg: WireMessage, transport: LanTransportKind): void {
    if (this.role === 'idle') return
    if (!this.rememberWireId(msg._mid)) return

    switch (msg.type) {
      case 'hello': {
        if (msg.peerId === this.selfPeerId || msg.roomCode !== this.roomCode) return
        const now = Date.now()
        const existing = this.peers.get(msg.peerId)
        this.peers.set(msg.peerId, {
          peerId: msg.peerId,
          name: msg.name,
          color: msg.color || pickColorForPeer(msg.peerId),
          role: msg.role,
          transport: existing?.transport === 'webrtc' ? 'webrtc' : transport,
          cursor: existing?.cursor ?? null,
          connectedAt: existing?.connectedAt ?? now,
          lastSeenAt: now,
        })
        if (this.role === 'host') {
          this.status = 'connected'
          this.sendWelcomeSnapshot(msg.peerId)
          this.broadcastPeersSync()
        }
        this.emitState()
        return
      }

      case 'welcome-snapshot': {
        if (this.role !== 'guest') return
        if (msg.targetPeerId && msg.targetPeerId !== this.selfPeerId) return

        this.seq = msg.snapshot.seq
        this.shadowContent = msg.snapshot.content
        this.shadowMeta = { ...msg.snapshot.meta }
        this.pendingOps = []
        this.status = 'connected'
        this.error = ''

        for (const p of msg.peers) {
          if (p.peerId === this.selfPeerId) continue
          this.peers.set(p.peerId, { ...p, lastSeenAt: Date.now() })
        }
        this.callbacks.onRemoteSnapshot({
          seq: this.seq,
          content: this.shadowContent,
          meta: { ...this.shadowMeta },
        })
        this.emitState()
        return
      }

      case 'client-op': {
        if (this.role !== 'host') return
        if (msg.authorId === this.selfPeerId || this.seenOpIds.has(msg.opId)) return
        this.seenOpIds.add(msg.opId)

        const peer = this.peers.get(msg.authorId)
        if (peer) peer.lastSeenAt = Date.now()

        const oldestSeq = this.hostHistory.length > 0 ? this.hostHistory[0].seq - 1 : this.seq
        if (msg.baseSeq < oldestSeq) {
          this.sendWelcomeSnapshot(msg.authorId)
          return
        }

        let transformed = msg.splice
        for (const hist of this.hostHistory) {
          if (hist.seq > msg.baseSeq) {
            transformed = transformSplice(transformed, hist.splice, true)
          }
        }

        this.shadowContent = applyTextSplice(this.shadowContent, transformed)
        this.seq += 1
        this.pushHostHistory({
          seq: this.seq,
          opId: msg.opId,
          authorId: msg.authorId,
          splice: transformed,
        })

        this.callbacks.onRemoteContentOperation(this.shadowContent, transformed)
        this.sendToAll({
          type: 'host-op',
          seq: this.seq,
          opId: msg.opId,
          authorId: msg.authorId,
          splice: transformed,
          checksum: fnv1aHash(this.shadowContent),
          length: this.shadowContent.length,
        })
        this.emitState()
        return
      }

      case 'host-op': {
        if (this.role !== 'guest') return
        if (msg.seq <= this.seq) return

        if (msg.seq > this.seq + 1) {
          this.sendToAll({ type: 'request-sync', peerId: this.selfPeerId })
          return
        }

        this.seq = msg.seq

        const ownIdx = this.pendingOps.findIndex((p) => p.opId === msg.opId)
        if (ownIdx !== -1) {
          this.pendingOps.splice(ownIdx, 1)
          if (
            this.pendingOps.length === 0 &&
            (this.shadowContent.length !== msg.length ||
              fnv1aHash(this.shadowContent) !== msg.checksum)
          ) {
            this.sendToAll({ type: 'request-sync', peerId: this.selfPeerId })
          }
          this.emitState()
          return
        }

        let incoming = msg.splice
        const nextPending: PendingClientOp[] = []
        for (const localPending of this.pendingOps) {
          const transformedLocal = transformSplice(localPending.splice, incoming, true)
          incoming = transformSplice(incoming, localPending.splice, false)
          nextPending.push({ opId: localPending.opId, splice: transformedLocal })
        }
        this.pendingOps = nextPending

        this.shadowContent = applyTextSplice(this.shadowContent, incoming)
        this.callbacks.onRemoteContentOperation(this.shadowContent, incoming)

        if (
          this.pendingOps.length === 0 &&
          (this.shadowContent.length !== msg.length ||
            fnv1aHash(this.shadowContent) !== msg.checksum)
        ) {
          this.sendToAll({ type: 'request-sync', peerId: this.selfPeerId })
        }
        this.emitState()
        return
      }

      case 'meta-patch': {
        if (msg.authorId === this.selfPeerId) return
        if (this.role === 'guest' && typeof msg.seq === 'number') {
          if (msg.seq <= this.seq) return
          this.seq = msg.seq
        }

        let changed = false
        const applyMetaKey = <K extends keyof LanCollabMeta>(
          key: K,
          val: LanCollabMeta[K] | undefined,
        ) => {
          if (val !== undefined && this.shadowMeta[key] !== val) {
            this.shadowMeta[key] = val
            changed = true
          }
        }
        for (const k of Object.keys(msg.patch) as (keyof LanCollabMeta)[]) {
          applyMetaKey(k, msg.patch[k])
        }
        if (changed) {
          this.callbacks.onRemoteMetaPatch(msg.patch)
        }

        if (this.role === 'host') {
          this.seq += 1
          this.sendToAll({
            type: 'meta-patch',
            authorId: msg.authorId,
            seq: this.seq,
            patch: msg.patch,
          })
          this.emitState()
        }
        return
      }

      case 'cursor': {
        if (msg.peerId === this.selfPeerId) return
        const now = Date.now()
        const existing = this.peers.get(msg.peerId)
        if (existing) {
          existing.cursor = msg.cursor
          existing.name = msg.name || existing.name
          existing.lastSeenAt = now
        } else {
          this.peers.set(msg.peerId, {
            peerId: msg.peerId,
            name: msg.name || '协作者',
            color: msg.color || pickColorForPeer(msg.peerId),
            role: 'guest',
            transport,
            cursor: msg.cursor,
            connectedAt: now,
            lastSeenAt: now,
          })
        }
        if (this.role === 'host' && (transport === 'webrtc' || transport === 'lan')) {
          this.sendToAll(msg)
        }
        this.emitState()
        return
      }

      case 'peers-sync': {
        if (this.role !== 'guest') return
        const nextMap = new Map<string, LanCollabPeer>()
        const selfPeer = this.peers.get(this.selfPeerId)
        if (selfPeer) nextMap.set(this.selfPeerId, selfPeer)
        for (const p of msg.peers) {
          if (p.peerId === this.selfPeerId) continue
          const prev = this.peers.get(p.peerId)
          nextMap.set(p.peerId, {
            ...p,
            cursor: p.cursor ?? prev?.cursor ?? null,
            lastSeenAt: Date.now(),
          })
        }
        this.peers = nextMap
        this.emitState()
        return
      }

      case 'request-sync': {
        if (this.role === 'host' && msg.peerId !== this.selfPeerId) {
          this.sendWelcomeSnapshot(msg.peerId)
        }
        return
      }

      case 'bye': {
        if (msg.peerId === this.selfPeerId) return
        const departing = this.peers.get(msg.peerId)
        this.peers.delete(msg.peerId)
        const link = this.peerLinks.get(msg.peerId)
        if (link) {
          try {
            link.close()
          } catch {
            // ignore
          }
          this.peerLinks.delete(msg.peerId)
        }
        if (this.role === 'host') {
          this.status = this.peers.size > 1 ? 'connected' : 'waiting'
          this.broadcastPeersSync()
        } else if (departing?.role === 'host') {
          this.status = 'closed'
          this.error = '房主已结束本次局域网协作'
        }
        this.emitState()
        return
      }
    }
  }
}

export function createLanCollabSession(options: CreateLanCollabOptions): LanCollabSessionManager {
  return new LanCollabSessionManager(options)
}
