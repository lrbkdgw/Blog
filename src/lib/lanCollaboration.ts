import * as Y from 'yjs'

/** 仅在离线版中使用：同一篇文章的正文与可编辑元信息。 */
export interface CollaborationValue {
  content: string
  title: string
  slug: string
  date: string
  tagsText: string
  summary: string
  author: string
  cover: string
  draft: boolean
  pinned: boolean
}

export interface LanSignal {
  v: 1
  kind: 'offer' | 'answer'
  session: string
  document: string
  description: RTCSessionDescriptionInit
}

/** 本机 React 状态写入 Yjs 时使用的 origin；这些变更不需要再次回写 React。 */
export const LOCAL_COLLABORATION_ORIGIN = Symbol('starlog-local-collaboration')

const SIGNAL_PREFIX = 'STARLOG-LAN1.'
const WIRE_PROTOCOL = 'starlog-lan-yjs-v1'
const WIRE_CHUNK_CHARS = 16 * 1024
const MAX_WIRE_CHUNKS = 2048
const MAX_PENDING_MESSAGES = 64
const PENDING_TTL_MS = 60_000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // 分块避免 String.fromCharCode(...bytes) 在大文章上撑爆参数栈。
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

function base64ToText(encoded: string): string {
  return new TextDecoder().decode(base64ToBytes(encoded))
}

export function encodeLanSignal(signal: LanSignal): string {
  return `${SIGNAL_PREFIX}${textToBase64(JSON.stringify(signal))}`
}

export function decodeLanSignal(code: string, expectedKind?: 'offer' | 'answer'): LanSignal {
  const trimmed = code.trim()
  if (!trimmed.startsWith(SIGNAL_PREFIX)) {
    throw new Error('连接码格式不正确，请完整复制以 STARLOG-LAN1. 开头的内容')
  }
  if (trimmed.length > 1024 * 1024) throw new Error('连接码异常大，已拒绝读取')
  try {
    const encoded = trimmed.slice(SIGNAL_PREFIX.length).replace(/\s+/g, '')
    const parsed = JSON.parse(base64ToText(encoded)) as Partial<LanSignal>
    if (
      parsed.v !== 1 ||
      (parsed.kind !== 'offer' && parsed.kind !== 'answer') ||
      typeof parsed.session !== 'string' ||
      !parsed.session ||
      typeof parsed.document !== 'string' ||
      !parsed.description ||
      parsed.description.type !== parsed.kind ||
      typeof parsed.description.sdp !== 'string' ||
      !parsed.description.sdp
    ) {
      throw new Error('连接码缺少必要的会话信息')
    }
    if (expectedKind && parsed.kind !== expectedKind) {
      throw new Error(expectedKind === 'offer' ? '这里需要粘贴邀请码，而不是应答码' : '这里需要粘贴应答码，而不是邀请码')
    }
    return parsed as LanSignal
  } catch (error) {
    if (error instanceof Error && /连接码|邀请码|应答码/.test(error.message)) throw error
    throw new Error('无法解析连接码，请确认复制内容完整且没有被截断')
  }
}

/** 创建一篇协作文档。主机传当前文章，加入方传空值并等待主机完整状态。 */
export function createCollaborationDoc(initial?: CollaborationValue): Y.Doc {
  const doc = new Y.Doc()
  if (initial) applyLocalCollaborationValue(doc, initial)
  return doc
}

function replaceYText(text: Y.Text, nextValue: string): void {
  const previous = text.toString()
  if (previous === nextValue) return

  let prefix = 0
  const maxPrefix = Math.min(previous.length, nextValue.length)
  while (prefix < maxPrefix && previous[prefix] === nextValue[prefix]) prefix += 1

  let suffix = 0
  const maxSuffix = Math.min(previous.length, nextValue.length) - prefix
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const removedLength = previous.length - prefix - suffix
  if (removedLength > 0) text.delete(prefix, removedLength)
  const inserted = nextValue.slice(prefix, nextValue.length - suffix)
  if (inserted) text.insert(prefix, inserted)
}

/** 将 React 的最新值合并进 CRDT；正文的未变化前后缀不会重复插入。 */
export function applyLocalCollaborationValue(
  doc: Y.Doc,
  value: CollaborationValue,
  origin: unknown = LOCAL_COLLABORATION_ORIGIN,
): void {
  doc.transact(() => {
    replaceYText(doc.getText('content'), value.content)
    const meta = doc.getMap<string | boolean>('meta')
    const fields = ['title', 'slug', 'date', 'tagsText', 'summary', 'author', 'cover', 'draft', 'pinned'] as const
    for (const field of fields) {
      if (meta.get(field) !== value[field]) meta.set(field, value[field])
    }
  }, origin)
}

export function encodeCollaborationState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc)
}

export function applyRemoteCollaborationUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
  Y.applyUpdate(doc, update, origin)
}

export function readCollaborationValue(doc: Y.Doc): CollaborationValue {
  const meta = doc.getMap<string | boolean>('meta')
  const stringValue = (key: string): string => {
    const value = meta.get(key)
    return typeof value === 'string' ? value : ''
  }
  return {
    content: doc.getText('content').toString(),
    title: stringValue('title'),
    slug: stringValue('slug'),
    date: stringValue('date'),
    tagsText: stringValue('tagsText'),
    summary: stringValue('summary'),
    author: stringValue('author'),
    cover: stringValue('cover'),
    draft: meta.get('draft') === true,
    pinned: meta.get('pinned') === true,
  }
}

interface WireMessage {
  protocol: typeof WIRE_PROTOCOL
  id: string
  index: number
  total: number
  data: string
}

/** 把一次 Yjs 更新编码成可靠、有序 DataChannel 可安全发送的小消息。 */
export function encodeLanUpdate(update: Uint8Array, id: string): string[] {
  const encoded = bytesToBase64(update)
  const total = Math.max(1, Math.ceil(encoded.length / WIRE_CHUNK_CHARS))
  if (total > MAX_WIRE_CHUNKS) throw new Error('协作文档过大，单次同步已超过安全上限')
  return Array.from({ length: total }, (_unused, index) =>
    JSON.stringify({
      protocol: WIRE_PROTOCOL,
      id,
      index,
      total,
      data: encoded.slice(index * WIRE_CHUNK_CHARS, (index + 1) * WIRE_CHUNK_CHARS),
    } satisfies WireMessage),
  )
}

/** 每条点对点连接各持有一个重组器；只有完整更新才会交给 Yjs。 */
export class LanUpdateAssembler {
  private pending = new Map<string, { total: number; parts: string[]; received: number; touched: number }>()

  push(raw: string): Uint8Array | null {
    if (raw.length > WIRE_CHUNK_CHARS + 1024) throw new Error('收到异常大的协作数据包')
    const message = JSON.parse(raw) as Partial<WireMessage> | null
    if (!message || typeof message !== 'object') throw new Error('收到格式不正确的协作数据包')
    if (
      message.protocol !== WIRE_PROTOCOL ||
      typeof message.id !== 'string' ||
      !message.id ||
      message.id.length > 128 ||
      !Number.isInteger(message.index) ||
      !Number.isInteger(message.total) ||
      typeof message.total !== 'number' ||
      message.total < 1 ||
      message.total > MAX_WIRE_CHUNKS ||
      typeof message.index !== 'number' ||
      message.index < 0 ||
      message.index >= message.total ||
      typeof message.data !== 'string' ||
      message.data.length > WIRE_CHUNK_CHARS
    ) {
      throw new Error('收到格式不正确的协作数据包')
    }

    const now = Date.now()
    for (const [id, pending] of this.pending) {
      if (now - pending.touched > PENDING_TTL_MS) this.pending.delete(id)
    }
    if (message.total === 1) return base64ToBytes(message.data)

    let pending = this.pending.get(message.id)
    if (!pending) {
      if (this.pending.size >= MAX_PENDING_MESSAGES) {
        const oldest = [...this.pending.entries()].sort((a, b) => a[1].touched - b[1].touched)[0]?.[0]
        if (oldest) this.pending.delete(oldest)
      }
      pending = { total: message.total, parts: [], received: 0, touched: now }
      this.pending.set(message.id, pending)
    }
    if (pending.total !== message.total) {
      this.pending.delete(message.id)
      throw new Error('协作数据包编号冲突，请重新连接')
    }
    if (pending.parts[message.index] === undefined) {
      pending.parts[message.index] = message.data
      pending.received += 1
    }
    pending.touched = now
    if (pending.received < pending.total) return null

    const encoded = pending.parts.join('')
    this.pending.delete(message.id)
    return base64ToBytes(encoded)
  }

  clear(): void {
    this.pending.clear()
  }
}
