import { STORAGE_KEYS } from './config'
import { OFFLINE } from './runtime'

/**
 * 离线版局域网合作文档引擎（Issue #112）。
 *
 * 设计约束：
 * 1. **严格仅在离线版（OFFLINE === true）启用**：线上构建不暴露入口，也不允许创建会话。
 * 2. **零外网依赖**：WebRTC 固定使用 `iceServers: []` 纯局域网主机/mDNS 候选直连，
 *    不包含任何远程域名、STUN/TURN 地址或外部信令 URL，100% 通过 `verify-offline.mjs`。
 * 3. **双通道传输**：
 *    - 跨局域网设备：通过压缩后的紧凑邀请码 / 响应码完成纯离线 WebRTC `RTCDataChannel` P2P 握手，
 *      房主支持星型拓扑同时接入多台局域网设备并广播操作与光标状态；
 *    - 同机多窗口：输入同一 6 位房间号即可通过 `BroadcastChannel` 免粘贴秒连。
 * 4. **增量变更同步 + 光标保持**：正文采用最小公共前后缀切片（`TextSplice`）+ 一维操作变换（OT）
 *    + FNV-1a 校验和自愈，多人同时在不同段落打字不会互相覆盖或打飞对方光标。
 */

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

export interface LanCollabPeer {
  peerId: string
  name: string
  color: string
  role: 'host' | 'guest'
  transport: 'webrtc' | 'local'
  cursor: LanCollabCursor | null
  connectedAt: number
  lastSeenAt: number
}

export type LanCollabRole = 'idle' | 'host' | 'guest'
export type LanCollabConnectionState = 'idle' | 'preparing' | 'waiting' | 'connecting' | 'connected' | 'closed'

export interface LanCollabState {
  role: LanCollabRole
  status: LanCollabConnectionState
  roomCode: string
  selfPeerId: string
  selfName: string
  selfColor: string
  inviteCode: string
  answerCode: string
  peers: LanCollabPeer[]
  seq: number
  error: string
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
const SIGNAL_PREFIX_DEFLATE = 'SL1Z.'
const SIGNAL_PREFIX_PLAIN = 'SL1P.'
const MAX_HISTORY_OPS = 240

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

export function generateRoomCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
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

  if (op.index < against.index) {
    return {
      index: op.index,
      deleteCount: leftSurvivingDel,
      insertText: op.insertText,
    }
  }

  return {
    index: against.index + agInsLen,
    deleteCount: rightSurvivingDel,
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

/* -------------------------------------------------------------------------- */
/*                            紧凑邀请码 / 响应码编解码                          */
/* -------------------------------------------------------------------------- */

export interface CollabSignalPayload {
  v: 1
  kind: 'offer' | 'answer'
  roomCode: string
  peerId: string
  peerName: string
  sdp: string
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

async function compressBytes(input: Uint8Array): Promise<{ compressed: boolean; bytes: Uint8Array }> {
  if (typeof globalThis.CompressionStream !== 'function') {
    return { compressed: false, bytes: input }
  }
  try {
    const cs = new CompressionStream('deflate-raw')
    const writer = cs.writable.getWriter()
    await writer.write(input as unknown as BufferSource)
    await writer.close()
    const buf = await new Response(cs.readable).arrayBuffer()
    const out = new Uint8Array(buf)
    if (out.length < input.length) {
      return { compressed: true, bytes: out }
    }
  } catch {
    // 回退到未压缩编码
  }
  return { compressed: false, bytes: input }
}

async function decompressBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('当前浏览器不支持解压该邀请码')
  }
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  await writer.write(input as unknown as BufferSource)
  await writer.close()
  const buf = await new Response(ds.readable).arrayBuffer()
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

/* -------------------------------------------------------------------------- */
/*                               协作消息协议定义                               */
/* -------------------------------------------------------------------------- */

type WireMessage =
  | {
      type: 'hello'
      roomCode: string
      peerId: string
      name: string
      color: string
      role: 'host' | 'guest'
    }
  | {
      type: 'welcome-snapshot'
      targetPeerId?: string
      snapshot: LanCollabDocSnapshot
      peers: LanCollabPeer[]
    }
  | {
      type: 'client-op'
      opId: string
      authorId: string
      baseSeq: number
      splice: TextSplice
    }
  | {
      type: 'host-op'
      seq: number
      opId: string
      authorId: string
      splice: TextSplice
      checksum: number
      length: number
    }
  | {
      type: 'meta-patch'
      authorId: string
      seq?: number
      patch: Partial<LanCollabMeta>
    }
  | {
      type: 'cursor'
      peerId: string
      name: string
      color: string
      cursor: LanCollabCursor | null
    }
  | {
      type: 'peers-sync'
      peers: LanCollabPeer[]
    }
  | {
      type: 'request-sync'
      peerId: string
    }
  | {
      type: 'bye'
      peerId: string
    }

interface PeerLink {
  peerId: string
  transport: 'webrtc' | 'local'
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
  _BroadcastChannelImpl?: typeof BroadcastChannel
}

async function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 1800): Promise<void> {
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
      quietTimer = setTimeout(finish, 450)
    }
    const hardTimer = setTimeout(finish, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onState)
    pc.addEventListener('icecandidate', onCandidate)
  })
}

export class LanCollabSessionManager {
  private readonly callbacks: LanCollabCallbacks
  private readonly BroadcastChannelCtor?: typeof BroadcastChannel
  private role: LanCollabRole = 'idle'
  private status: LanCollabConnectionState = 'idle'
  private roomCode = ''
  private readonly selfPeerId = generateId('peer')
  private selfName: string
  private readonly selfColor: string
  private inviteCode = ''
  private answerCode = ''
  private error = ''

  private seq = 0
  private shadowContent = ''
  private shadowMeta: LanCollabMeta

  private pendingOps: PendingClientOp[] = []
  private hostHistory: HostHistoryEntry[] = []
  private seenOpIds = new Set<string>()

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
      options._BroadcastChannelImpl ??
      (typeof globalThis.BroadcastChannel === 'function' ? globalThis.BroadcastChannel : undefined)
    this.selfName = (options.initialName?.trim() || loadSavedCollaboratorName()).slice(0, 24)
    this.selfColor = pickColorForPeer(this.selfPeerId)
    const init = options.getInitialSnapshot()
    this.shadowContent = init.content
    this.shadowMeta = { ...init.meta }
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

  /** 作为房主开启协作房间：支持同机房间号免配置直连 + 跨局域网设备 WebRTC 邀请码接入。 */
  async startHosting(customRoomCode?: string): Promise<string> {
    this.resetInternal(false)
    const init = this.callbacks.getInitialSnapshot()
    this.shadowContent = init.content
    this.shadowMeta = { ...init.meta }
    this.seq = 1
    this.roomCode = (customRoomCode?.trim().toUpperCase() || generateRoomCode()).slice(0, 12)
    this.role = 'host'
    this.status = 'preparing'
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
    this.emitState()

    this.openBroadcastChannel(this.roomCode)

    if (hasWebRtcSupport()) {
      try {
        await this.prepareNextHostOffer()
      } catch (err) {
        this.error = err instanceof Error ? err.message : '生成局域网 WebRTC 邀请码失败'
      }
    }

    if (this.status === 'preparing') {
      this.status = this.peers.size > 1 ? 'connected' : 'waiting'
    }
    this.emitState()
    return this.inviteCode
  }

  /** 为下一台准备接入的局域网设备生成新的 WebRTC 邀请码（支持多台设备依次加入）。 */
  async prepareNextHostOffer(): Promise<string> {
    if (this.role !== 'host') throw new Error('只有房主可以生成邀请码')
    if (!hasWebRtcSupport()) throw new Error('当前浏览器不支持 WebRTC 数据通道')

    if (this.pendingHostPc) {
      try {
        this.pendingHostDc?.close()
        this.pendingHostPc.close()
      } catch {
        // 忽略旧连接清理异常
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
      throw new Error('未能收集到本机局域网连接信息')
    }

    this.inviteCode = await encodeCollabSignal({
      v: 1,
      kind: 'offer',
      roomCode: this.roomCode,
      peerId: this.selfPeerId,
      peerName: this.selfName,
      sdp: localSdp,
    })
    this.status = this.peers.size > 1 ? 'connected' : 'waiting'
    this.emitState()
    return this.inviteCode
  }

  /** 房主填入协作者回传的响应码，完成局域网点对点握手。 */
  async acceptGuestAnswer(answerCodeInput: string): Promise<void> {
    if (this.role !== 'host') throw new Error('当前不是房主模式')
    if (!this.pendingHostPc || !this.pendingHostDc) {
      throw new Error('请先生成新的邀请码后再填入响应码')
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

    // 自动为下一位可能加入的局域网设备预备新的邀请槽位
    void this.prepareNextHostOffer().catch(() => undefined)
  }

  /** 协作者粘贴房主的邀请码加入，返回需回传给房主的紧凑响应码。 */
  async joinWithInviteCode(inviteCodeInput: string): Promise<string> {
    const signal = await decodeCollabSignal(inviteCodeInput)
    if (signal.kind !== 'offer') {
      throw new Error('粘贴的不是有效的房主邀请码')
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

    // 若恰在同一浏览器的不同标签页，BroadcastChannel 也能直接加速连通
    this.openBroadcastChannel(signal.roomCode)

    const pc = new RTCPeerConnection({ iceServers: [] })
    this.guestPc = pc

    pc.ondatachannel = (event) => {
      this.bindWebRtcChannel(pc, event.channel, signal.peerId, signal.peerName, 'host')
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

  /** 通过 6 位房间号在同一设备的多窗口间免粘贴快速加入。 */
  joinLocalRoom(roomCodeInput: string): void {
    const cleanRoom = roomCodeInput.trim().toUpperCase()
    if (!cleanRoom) {
      throw new Error('请输入房间号')
    }
    if (!this.BroadcastChannelCtor) {
      throw new Error('当前浏览器不支持本地多窗口广播，请使用邀请码连接')
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
    if (this.role !== 'idle') {
      this.sendToAll({ type: 'bye', peerId: this.selfPeerId })
    }
    this.resetInternal(true)
  }

  private resetInternal(emit: boolean): void {
    for (const link of this.peerLinks.values()) {
      try {
        link.close()
      } catch {
        // 忽略关闭异常
      }
    }
    this.peerLinks.clear()
    this.peers.clear()
    this.pendingOps = []
    this.hostHistory = []
    this.seenOpIds.clear()

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
        // 忽略畸形帧
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
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        handleDisconnect()
      }
    }

    if (dc.readyState === 'open') {
      onOpen()
    } else {
      dc.onopen = onOpen
    }
  }

  private sendBroadcast(msg: WireMessage): void {
    try {
      this.broadcastChannel?.postMessage(msg)
    } catch {
      // ignore
    }
  }

  private sendToAll(msg: WireMessage): void {
    for (const link of this.peerLinks.values()) {
      try {
        link.send(msg)
      } catch {
        // ignore broken channel
      }
    }
    this.sendBroadcast(msg)
  }

  private sendWelcomeSnapshot(targetPeerId?: string): void {
    if (this.role !== 'host') return
    const msg: WireMessage = {
      type: 'welcome-snapshot',
      targetPeerId,
      snapshot: {
        seq: this.seq,
        content: this.shadowContent,
        meta: { ...this.shadowMeta },
      },
      peers: [...this.peers.values()],
    }
    const direct = targetPeerId ? this.peerLinks.get(targetPeerId) : undefined
    if (direct) {
      direct.send(msg)
    } else {
      this.sendToAll(msg)
    }
  }

  private broadcastPeersSync(): void {
    if (this.role !== 'host') return
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

  private handleWireMessage(msg: WireMessage, transport: 'webrtc' | 'local'): void {
    if (this.role === 'idle') return

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

        // 若客端 baseSeq 早于最早历史缓存，直接回发完整快照让其对齐
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

        // 若检测到消息乱序或漏包，立即向房主请求快照自愈
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
        if (this.role === 'host' && transport === 'webrtc') {
          for (const [pid, link] of this.peerLinks.entries()) {
            if (pid !== msg.peerId) link.send(msg)
          }
          this.sendBroadcast(msg)
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
