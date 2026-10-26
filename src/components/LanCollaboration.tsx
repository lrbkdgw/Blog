import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Copy, Link2, Loader2, UsersRound, X } from 'lucide-react'
import * as Y from 'yjs'
import { OFFLINE } from '../lib/runtime'

const REMOTE_ORIGIN = Symbol('lan-collaboration-remote')
type Role = 'host' | 'guest'
type SharedDocument = { title: string; content: string }

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      if (pc.iceGatheringState !== 'complete') return
      pc.removeEventListener('icegatheringstatechange', finish)
      resolve()
    }
    pc.addEventListener('icegatheringstatechange', finish)
    // A browser may not emit the final state-change event in a file:// context.
    window.setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', finish)
      resolve()
    }, 12_000)
  })
}

function sendBytes(channel: RTCDataChannel, kind: 0 | 1, data: Uint8Array) {
  const frame = new Uint8Array(data.length + 1)
  frame[0] = kind
  frame.set(data, 1)
  channel.send(frame.buffer)
}

function applyTextChange(text: Y.Text, nextValue: string, doc: Y.Doc) {
  const before = text.toString()
  if (before === nextValue) return
  // Compare Unicode code points (not UTF-16 code units) so a changed emoji can never
  // leave a lone surrogate in the shared CRDT text.
  const beforeChars = Array.from(before)
  const nextChars = Array.from(nextValue)
  let prefixChars = 0
  while (
    prefixChars < beforeChars.length &&
    prefixChars < nextChars.length &&
    beforeChars[prefixChars] === nextChars[prefixChars]
  ) prefixChars += 1
  let suffixChars = 0
  while (
    suffixChars < beforeChars.length - prefixChars &&
    suffixChars < nextChars.length - prefixChars &&
    beforeChars[beforeChars.length - suffixChars - 1] === nextChars[nextChars.length - suffixChars - 1]
  ) suffixChars += 1
  const prefix = beforeChars.slice(0, prefixChars).join('').length
  const beforeSuffix = beforeChars.slice(beforeChars.length - suffixChars).join('').length
  const nextSuffix = nextChars.slice(nextChars.length - suffixChars).join('').length
  doc.transact(() => {
    const deleteLength = before.length - prefix - beforeSuffix
    if (deleteLength > 0) text.delete(prefix, deleteLength)
    const insertText = nextValue.slice(prefix, nextValue.length - nextSuffix)
    if (insertText.length > 0) text.insert(prefix, insertText)
  })
}

/** Offline-only, direct WebRTC collaboration. Signaling is exchanged by copying JSON between devices. */
export function LanCollaboration({
  title,
  content,
  onChange,
}: {
  title: string
  content: string
  onChange: (document: SharedDocument) => void
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role | null>(null)
  const [signalInput, setSignalInput] = useState('')
  const [signalOutput, setSignalOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const docRef = useRef<Y.Doc | null>(null)
  const roleRef = useRef<Role | null>(null)
  const readyRef = useRef(false)
  const pendingLocalRef = useRef<SharedDocument | null>(null)
  const onChangeRef = useRef(onChange)
  const initialSnapshotRef = useRef<SharedDocument>({ title, content })

  onChangeRef.current = onChange

  const releaseSession = () => {
    channelRef.current?.close()
    peerRef.current?.close()
    docRef.current?.destroy()
    channelRef.current = null
    peerRef.current = null
    docRef.current = null
    roleRef.current = null
    readyRef.current = false
    pendingLocalRef.current = null
    setConnected(false)
    setRole(null)
    setSignalInput('')
    setSignalOutput('')
    setStatus('')
    setBusy(false)
  }

  useEffect(() => () => releaseSession(), [])

  // Apply local textarea edits to Y.Text. Remote updates are applied to the textarea
  // through the Y.Doc listener and are not reinterpreted as new local edits.
  useEffect(() => {
    const doc = docRef.current
    if (!doc) return
    if (!readyRef.current) {
      if (roleRef.current === 'guest') pendingLocalRef.current = { title, content }
      return
    }
    applyTextChange(doc.getText('title'), title, doc)
    applyTextChange(doc.getText('content'), content, doc)
  }, [title, content])

  const setupDataChannel = (channel: RTCDataChannel, doc: Y.Doc, sessionRole: Role) => {
    channel.binaryType = 'arraybuffer'
    channelRef.current = channel
    channel.onopen = () => {
      setConnected(true)
      setStatus('已通过局域网直连。当前文章会与对端同步。')
      if (sessionRole === 'host') {
        channel.send(JSON.stringify({ type: 'snapshot', ...initialSnapshotRef.current }))
      }
      sendBytes(channel, 0, Y.encodeStateVector(doc))
    }
    channel.onclose = () => {
      setConnected(false)
      setStatus('连接已断开；本机内容仍会保留。')
    }
    channel.onerror = () => setError('数据通道异常。请重新交换连接码，并确认设备在同一局域网。')
    channel.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          return
        }
        if (message.type === 'snapshot' && sessionRole === 'guest') {
          initialSnapshotRef.current = {
            title: typeof message.title === 'string' ? message.title : '',
            content: typeof message.content === 'string' ? message.content : '',
          }
          onChangeRef.current(initialSnapshotRef.current)
        } else if (message.type === 'sync-done' && sessionRole === 'guest') {
          const pending = pendingLocalRef.current
          const snapshot = initialSnapshotRef.current
          const sharedTitle = doc.getText('title')
          const sharedContent = doc.getText('content')
          // Preserve edits typed while the initial document was still synchronizing.
          if (pending && pending.title !== snapshot.title) applyTextChange(sharedTitle, pending.title, doc)
          if (pending && pending.content !== snapshot.content) applyTextChange(sharedContent, pending.content, doc)
          pendingLocalRef.current = null
          readyRef.current = true
          const shared = {
            title: sharedTitle.toString() || snapshot.title,
            content: sharedContent.toString() || snapshot.content,
          }
          onChangeRef.current(shared)
          setStatus('同步完成。两台设备现在可以共同编辑；断开后各自保留本机副本。')
        }
        return
      }
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new Uint8Array(event.data as ArrayBufferLike)
      if (data.length < 1) return
      if (data[0] === 0) {
        const update = Y.encodeStateAsUpdate(doc, data.subarray(1))
        sendBytes(channel, 1, update)
        if (sessionRole === 'host') channel.send(JSON.stringify({ type: 'sync-done' }))
      } else if (data[0] === 1) {
        Y.applyUpdate(doc, data.subarray(1), REMOTE_ORIGIN)
        if (sessionRole === 'host') {
          // The initial state-vector response is followed by sync-done; later updates
          // are ordinary collaboration changes and need no additional handshake.
          readyRef.current = true
        }
      }
    }
  }

  const createDocument = (sessionRole: Role) => {
    const doc = new Y.Doc()
    roleRef.current = sessionRole
    docRef.current = doc
    readyRef.current = sessionRole === 'host'
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return
      const channel = channelRef.current
      if (channel?.readyState === 'open') sendBytes(channel, 1, update)
    })
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE_ORIGIN || !readyRef.current) return
      onChangeRef.current({
        title: doc.getText('title').toString(),
        content: doc.getText('content').toString(),
      })
    })
    return doc
  }

  const beginHost = async () => {
    setBusy(true)
    setError('')
    setRole('host')
    setStatus('正在生成连接码…')
    initialSnapshotRef.current = { title, content }
    try {
      const doc = createDocument('host')
      doc.getText('title').insert(0, title)
      doc.getText('content').insert(0, content)
      const peer = new RTCPeerConnection({ iceServers: [] })
      peerRef.current = peer
      setupDataChannel(peer.createDataChannel('starlog-document', { ordered: true }), doc, 'host')
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await waitForIceGathering(peer)
      setSignalOutput(JSON.stringify(peer.localDescription))
      setStatus('连接码已生成。把它发给同一局域网内的另一台设备。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法建立局域网连接')
      releaseSession()
    } finally {
      setBusy(false)
    }
  }

  const beginGuest = async () => {
    setBusy(true)
    setError('')
    setRole('guest')
    setStatus('正在读取对方连接码…')
    initialSnapshotRef.current = { title, content }
    try {
      const offer = JSON.parse(signalInput) as RTCSessionDescriptionInit
      if (offer.type !== 'offer' || typeof offer.sdp !== 'string') throw new Error('这不是有效的发起方连接码')
      const doc = createDocument('guest')
      const peer = new RTCPeerConnection({ iceServers: [] })
      peerRef.current = peer
      peer.ondatachannel = (event) => setupDataChannel(event.channel, doc, 'guest')
      await peer.setRemoteDescription(offer)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await waitForIceGathering(peer)
      setSignalOutput(JSON.stringify(peer.localDescription))
      setStatus('应答码已生成。把它发回发起方；等待对方完成连接。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法生成应答码')
      releaseSession()
    } finally {
      setBusy(false)
    }
  }

  const acceptAnswer = async () => {
    setBusy(true)
    setError('')
    try {
      const answer = JSON.parse(signalInput) as RTCSessionDescriptionInit
      if (answer.type !== 'answer' || typeof answer.sdp !== 'string') throw new Error('这不是有效的应答码')
      await peerRef.current?.setRemoteDescription(answer)
      setStatus('已收到应答码，正在建立直连…')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法应用应答码')
    } finally {
      setBusy(false)
    }
  }

  const copySignal = async () => {
    try {
      await navigator.clipboard.writeText(signalOutput)
      setStatus('连接码已复制。请通过你信任的方式发送给对方。')
    } catch {
      setError('自动复制失败，请手动全选并复制连接码。')
    }
  }

  const updateSignalInput = (event: ChangeEvent<HTMLTextAreaElement>) => setSignalInput(event.target.value)

  if (!OFFLINE) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-ghost h-9 w-9 !px-0"
        title="与局域网内另一台设备协作"
        aria-label="局域网协作"
      >
        <UsersRound size={16} className={connected ? 'text-emerald-500' : ''} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="局域网协作">
          <div className="card flex max-h-[min(44rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden">
            <header className="flex items-start justify-between border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
              <div>
                <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white"><UsersRound size={18} className="text-brand-500" />局域网协作</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">无需服务器或互联网。两台设备在同一局域网，通过手动交换连接码建立浏览器点对点连接。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-8 w-8 !px-0" aria-label="关闭"><X size={16} /></button>
            </header>
            <div className="overflow-y-auto p-5">
              {connected ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-500" />已建立局域网直连</p>
                  <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">当前标题和正文正在与对端同步。关闭这个弹窗不会断开协作；点击下方按钮才会断开。</p>
                  <button type="button" onClick={releaseSession} className="btn-outline mt-4 h-9">断开协作</button>
                </div>
              ) : role ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600 dark:bg-white/5 dark:text-ink-300">{status || (busy ? '处理中…' : '等待操作')}</div>
                  {role === 'guest' && !signalOutput && (
                    <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                      粘贴发起方连接码
                      <textarea value={signalInput} onChange={updateSignalInput} rows={5} spellCheck={false} className="input mt-2 w-full resize-y font-mono text-xs" placeholder="粘贴完整的 JSON 连接码" />
                      <span className="mt-1 block text-xs font-normal text-ink-400">加入协作后，本编辑器当前内容将被发起方的文档替换。</span>
                    </label>
                  )}
                  {signalOutput && (
                    <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                      {role === 'host' ? '发起方连接码' : '发起方应答码'}
                      <textarea readOnly value={signalOutput} rows={6} onFocus={(event) => event.currentTarget.select()} className="input mt-2 w-full resize-y font-mono text-xs" />
                      <button type="button" onClick={() => void copySignal()} className="btn-outline mt-2 h-9"><Copy size={14} />复制连接码</button>
                    </label>
                  )}
                  {role === 'host' && signalOutput && !connected && (
                    <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                      粘贴对方应答码
                      <textarea value={signalInput} onChange={updateSignalInput} rows={5} spellCheck={false} className="input mt-2 w-full resize-y font-mono text-xs" placeholder="收到对方返回的 JSON 后粘贴到这里" />
                    </label>
                  )}
                  {role === 'host' && signalOutput && !connected && (
                    <button type="button" onClick={() => void acceptAnswer()} disabled={busy || !signalInput.trim()} className="btn-primary h-9">{busy && <Loader2 size={14} className="animate-spin" />}使用应答码连接</button>
                  )}
                  {role === 'guest' && !signalOutput && (
                    <button type="button" onClick={() => void beginGuest()} disabled={busy || !signalInput.trim()} className="btn-primary h-9">{busy && <Loader2 size={14} className="animate-spin" />}生成应答码</button>
                  )}
                  {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
                  {status && !busy && <p className="text-xs text-ink-500">{status}</p>}
                  <button type="button" onClick={releaseSession} className="btn-ghost h-9">取消并返回</button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => void beginHost()} disabled={busy} className="card flex flex-col items-start gap-2 p-4 text-left transition hover:border-brand-400">
                    <span className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Link2 size={16} className="text-brand-500" />发起协作</span>
                    <span className="text-sm text-ink-500">以当前文章作为共享文档，生成连接码发给另一台设备。</span>
                  </button>
                  <button type="button" onClick={() => { setRole('guest'); setSignalInput(''); setSignalOutput(''); setError('') }} className="card flex flex-col items-start gap-2 p-4 text-left transition hover:border-brand-400">
                    <span className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><UsersRound size={16} className="text-brand-500" />加入协作</span>
                    <span className="text-sm text-ink-500">粘贴发起方提供的连接码，并把生成的应答码发回去。</span>
                  </button>
                  {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
                  <p className="sm:col-span-2 text-xs leading-relaxed text-ink-400">连接码含有本次连接所需的局域网网络信息。只分享给可信任的人；连接码不是加密密码。浏览器不使用 STUN/TURN 服务器，不会通过互联网中继。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
