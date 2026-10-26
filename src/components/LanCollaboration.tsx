import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clipboard, Loader2, Network, Plus, Radio, StopCircle, Users, X } from 'lucide-react'
import type { Doc } from 'yjs'
import {
  LanUpdateAssembler,
  LOCAL_COLLABORATION_ORIGIN,
  applyLocalCollaborationValue,
  applyRemoteCollaborationUpdate,
  createCollaborationDoc,
  decodeLanSignal,
  encodeLanSignal,
  encodeLanUpdate,
  encodeCollaborationState,
  readCollaborationValue,
  type CollaborationValue,
  type LanSignal,
} from '../lib/lanCollaboration'

interface PeerEntry {
  connection: RTCPeerConnection
  channel: RTCDataChannel | null
  assembler: LanUpdateAssembler
  closed: boolean
}

interface LanCollaborationProps {
  /** 路由中的文章标识，防止把两篇不同文章接到同一会话。 */
  documentKey: string
  documentLabel: string
  value: CollaborationValue
  onChange: (value: CollaborationValue) => void
}

type PanelView = 'home' | 'host' | 'join'

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function waitForLanCandidates(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(done, 8000)
      function done() {
        window.clearTimeout(timeout)
        connection.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
      function check() {
        if (connection.iceGatheringState === 'complete') done()
      }
      connection.addEventListener('icegatheringstatechange', check)
    })
  }
  const sdp = connection.localDescription?.sdp ?? ''
  if (!/^a=candidate:/m.test(sdp)) {
    throw new Error('没有收集到局域网候选地址。请确认浏览器允许 WebRTC，且设备已连接局域网后重试')
  }
}

async function copyText(text: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    if (!copied) throw new Error('复制失败，请手动全选连接码复制')
  }
}

function SignalOutput({ label, code, onCopy }: { label: string; code: string; onCopy: () => void }) {
  if (!code) return null
  return (
    <div className="rounded-xl border border-ink-200/80 bg-ink-50/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{label}</span>
        <button type="button" onClick={onCopy} className="btn-outline h-7 !px-2.5 text-xs">
          <Clipboard size={12} />复制
        </button>
      </div>
      <textarea
        value={code}
        readOnly
        rows={4}
        onFocus={(event) => event.currentTarget.select()}
        className="input resize-none break-all font-mono !text-[10px] leading-relaxed"
        aria-label={label}
      />
    </div>
  )
}

/**
 * 离线版局域网协作：手动交换 SDP，WebRTC DataChannel 直连，Yjs 合并文档更新。
 * iceServers 永远为空，因此不会访问 STUN / TURN 或任何外部信令服务。
 */
export default function LanCollaboration({ documentKey, documentLabel, value, onChange }: LanCollaborationProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PanelView>('home')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [offerCode, setOfferCode] = useState('')
  const [answerCode, setAnswerCode] = useState('')
  const [offerInput, setOfferInput] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [sessionActive, setSessionActive] = useState(false)
  const [connectedPeers, setConnectedPeers] = useState(0)

  const docRef = useRef<Doc | null>(null)
  const peersRef = useRef(new Set<PeerEntry>())
  const pendingHostPeerRef = useRef<PeerEntry | null>(null)
  const sessionRef = useRef('')
  const updateCounterRef = useRef(0)
  const readyRef = useRef(false)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const documentKeyRef = useRef(documentKey)
  valueRef.current = value
  onChangeRef.current = onChange
  documentKeyRef.current = documentKey

  const refreshPeerCount = useCallback(() => {
    const count = [...peersRef.current].filter((peer) => peer.channel?.readyState === 'open').length
    setConnectedPeers(count)
  }, [])

  const closePeer = useCallback((peer: PeerEntry) => {
    if (peer.closed) return
    peer.closed = true
    peersRef.current.delete(peer)
    if (pendingHostPeerRef.current === peer) pendingHostPeerRef.current = null
    peer.assembler.clear()
    try { peer.channel?.close() } catch { /* 已关闭 */ }
    try { peer.connection.close() } catch { /* 已关闭 */ }
    peer.channel = null
    refreshPeerCount()
  }, [refreshPeerCount])

  const stopSession = useCallback(() => {
    for (const peer of [...peersRef.current]) closePeer(peer)
    pendingHostPeerRef.current = null
    docRef.current?.destroy()
    docRef.current = null
    sessionRef.current = ''
    readyRef.current = false
    setSessionActive(false)
    setConnectedPeers(0)
    setOfferCode('')
    setAnswerCode('')
    setAnswerInput('')
    setOfferInput('')
    setBusy(false)
    setView('home')
  }, [closePeer])

  const ensureDocument = useCallback((withCurrentValue: boolean): Doc => {
    if (docRef.current) return docRef.current
    const doc = createCollaborationDoc(withCurrentValue ? valueRef.current : undefined)
    docRef.current = doc
    sessionRef.current = newSessionId()
    readyRef.current = withCurrentValue
    setSessionActive(true)

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // 远端更新回写编辑器；本机 React 状态已经是新值，无需再次回写。
      if (origin !== LOCAL_COLLABORATION_ORIGIN && readyRef.current) {
        onChangeRef.current(readCollaborationValue(doc))
      }
      // 星型或多跳拓扑中继续转发给其他 peer，但不回声给来源连接。
      for (const peer of peersRef.current) {
        if (peer === origin || peer.channel?.readyState !== 'open') continue
        try {
          const id = `update-${Date.now().toString(36)}-${updateCounterRef.current++}`
          for (const message of encodeLanUpdate(update, id)) peer.channel.send(message)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '发送协作更新失败')
        }
      }
    })
    return doc
  }, [])

  const setupChannel = useCallback((peer: PeerEntry, channel: RTCDataChannel) => {
    peer.channel = channel
    channel.onopen = () => {
      refreshPeerCount()
      setNotice('点对点连接已建立，文章正文与信息会实时同步；请各自保存本机副本')
      setError('')
      const doc = docRef.current
      if (!doc) return
      try {
        // 全量状态交换让后加入与断线重连的设备收敛；之后只发送增量。
        const id = `full-${Date.now().toString(36)}-${updateCounterRef.current++}`
        for (const message of encodeLanUpdate(encodeCollaborationState(doc), id)) channel.send(message)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '发送初始文档失败')
      }
    }
    channel.onclose = () => closePeer(peer)
    channel.onerror = () => setError('点对点数据通道发生错误；可结束后重新交换连接码')
    channel.onmessage = (event) => {
      const doc = docRef.current
      if (!doc || typeof event.data !== 'string') return
      try {
        const update = peer.assembler.push(event.data)
        if (!update) return
        const firstSync = !readyRef.current
        applyRemoteCollaborationUpdate(doc, update, peer)
        if (firstSync) {
          // 空文档的全量同步不会产生 Yjs update 事件，也必须清空加入方的旧编辑区。
          readyRef.current = true
          onChangeRef.current(readCollaborationValue(doc))
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '合并远端文档更新失败')
      }
    }
  }, [closePeer, refreshPeerCount])

  const createPeer = useCallback((host: boolean): PeerEntry => {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('当前浏览器不支持 WebRTC，请使用近期版本的 Chrome、Edge 或 Firefox')
    }
    // 关键约束：不配置任何 STUN / TURN 服务器，只收集本机与局域网候选地址。
    const connection = new RTCPeerConnection({ iceServers: [] })
    const peer: PeerEntry = { connection, channel: null, assembler: new LanUpdateAssembler(), closed: false }
    peersRef.current.add(peer)
    if (host) setupChannel(peer, connection.createDataChannel('starlog-yjs', { ordered: true }))
    else {
      connection.ondatachannel = (event) => setupChannel(peer, event.channel)
    }
    connection.onconnectionstatechange = () => {
      refreshPeerCount()
      if (connection.connectionState === 'failed') {
        setError('连接失败。请确认两台设备在同一局域网、应答已回到邀请方，且未经过访客网络隔离')
      }
      if (connection.connectionState === 'closed') closePeer(peer)
    }
    connection.oniceconnectionstatechange = refreshPeerCount
    return peer
  }, [closePeer, refreshPeerCount, setupChannel])

  const createInvite = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    setAnswerCode('')
    setAnswerInput('')
    let peer: PeerEntry | null = null
    try {
      ensureDocument(true)
      if (pendingHostPeerRef.current) closePeer(pendingHostPeerRef.current)
      peer = createPeer(true)
      pendingHostPeerRef.current = peer
      await peer.connection.setLocalDescription(await peer.connection.createOffer())
      await waitForLanCandidates(peer.connection)
      if (peer.closed || !peer.connection.localDescription) return
      const signal: LanSignal = {
        v: 1,
        kind: 'offer',
        session: sessionRef.current,
        document: documentKeyRef.current,
        description: peer.connection.localDescription.toJSON(),
      }
      setOfferCode(encodeLanSignal(signal))
      setView('host')
      setNotice('第 1 步完成：把邀请码发给另一台设备，再等待对方返回应答码')
    } catch (caught) {
      if (peer) closePeer(peer)
      setError(caught instanceof Error ? caught.message : '创建邀请失败')
    } finally {
      setBusy(false)
    }
  }, [closePeer, createPeer, ensureDocument])

  const acceptOffer = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    let peer: PeerEntry | null = null
    let createdDocument = false
    try {
      if (docRef.current) throw new Error('当前已有协作文档。请先结束协作，再加入另一场会话')
      const signal = decodeLanSignal(offerInput, 'offer')
      if (signal.document !== documentKeyRef.current) {
        throw new Error(`邀请属于另一篇文章（${signal.document || '未命名'}），请在两台设备打开同一文章后重试`)
      }
      ensureDocument(false)
      createdDocument = true
      sessionRef.current = signal.session
      peer = createPeer(false)
      await peer.connection.setRemoteDescription(signal.description)
      await peer.connection.setLocalDescription(await peer.connection.createAnswer())
      await waitForLanCandidates(peer.connection)
      if (peer.closed || !peer.connection.localDescription) return
      const answer: LanSignal = {
        v: 1,
        kind: 'answer',
        session: signal.session,
        document: signal.document,
        description: peer.connection.localDescription.toJSON(),
      }
      setAnswerCode(encodeLanSignal(answer))
      setNotice('第 2 步完成：把应答码发回邀请方；对方确认后会自动连接')
    } catch (caught) {
      if (peer) closePeer(peer)
      if (createdDocument) {
        docRef.current?.destroy()
        docRef.current = null
        sessionRef.current = ''
        readyRef.current = false
        setSessionActive(false)
      }
      setError(caught instanceof Error ? caught.message : '接受邀请失败')
    } finally {
      setBusy(false)
    }
  }, [createPeer, ensureDocument, offerInput])

  const acceptAnswer = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const peer = pendingHostPeerRef.current
      if (!peer || peer.closed) throw new Error('没有等待应答的邀请，请重新创建邀请码')
      const signal = decodeLanSignal(answerInput, 'answer')
      if (signal.session !== sessionRef.current || signal.document !== documentKeyRef.current) {
        throw new Error('应答码不属于当前文章或当前邀请，请核对后重试')
      }
      await peer.connection.setRemoteDescription(signal.description)
      pendingHostPeerRef.current = null
      setAnswerInput('')
      setNotice('应答已确认，正在建立局域网直连…')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '确认应答失败')
    } finally {
      setBusy(false)
    }
  }, [answerInput])

  const copyCode = async (code: string, label: string) => {
    try {
      await copyText(code)
      setNotice(`${label}已复制`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '复制失败')
    }
  }

  // 当 React 中的正文或元信息变化时，以最小文本差异写入 CRDT。
  useEffect(() => {
    const doc = docRef.current
    if (!doc || !readyRef.current) return
    applyLocalCollaborationValue(doc, value)
  }, [sessionActive, value])

  // 离开文章时不把旧会话带进另一篇文档；关闭面板本身不会断开。
  const previousDocumentKey = useRef(documentKey)
  useEffect(() => {
    if (previousDocumentKey.current === documentKey) return
    previousDocumentKey.current = documentKey
    if (docRef.current) stopSession()
  }, [documentKey, stopSession])

  useEffect(() => () => {
    for (const peer of peersRef.current) {
      try { peer.channel?.close() } catch { /* 已关闭 */ }
      try { peer.connection.close() } catch { /* 已关闭 */ }
      peer.assembler.clear()
    }
    peersRef.current.clear()
    docRef.current?.destroy()
    docRef.current = null
  }, [])

  const dialog = open ? (
    <div className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="局域网共同编辑">
      <div className="card flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <Network size={19} className="text-brand-500" />局域网共同编辑
              <span className="rounded-full bg-ink-500/10 px-2 py-0.5 text-[10px] font-medium text-ink-500 dark:text-ink-300">仅离线版</span>
            </h2>
            <p className="mt-1 text-xs text-ink-400">当前文章：{documentLabel || '未命名文章'} · 无需互联网或外部服务器</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-8 w-8 shrink-0 !px-0" aria-label="关闭协作面板">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-xs leading-relaxed ${connectedPeers > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
            <Radio size={15} className="mt-0.5 shrink-0" />
            <span>{connectedPeers > 0 ? `已连接 ${connectedPeers} 台设备。双方修改会实时合并；每台设备仍需分别保存自己的本机文章库。` : '尚未连接设备。两台设备需接入同一局域网，并各自打开这份离线 HTML 中的同一文章。'}</span>
          </div>

          <div className="rounded-xl border border-ink-200/70 p-3.5 text-xs leading-relaxed text-ink-500 dark:border-white/10 dark:text-ink-400">
            正文使用 CRDT 合并，标题、slug、日期、标签、摘要、作者、封面与草稿/置顶状态同步。连接码包含本机局域网候选地址，请只发给可信设备；DataChannel 本身使用 DTLS 加密。
            <strong className="mt-1 block text-amber-600 dark:text-amber-300">加入会话会以邀请方的文档为准，开始协作前请先保存现有草稿。</strong>
          </div>

          {view === 'home' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void createInvite()} disabled={busy} className="card flex items-start gap-3 p-4 text-left transition hover:border-brand-300 disabled:opacity-50">
                {busy ? <Loader2 size={19} className="mt-0.5 animate-spin text-brand-500" /> : <Plus size={19} className="mt-0.5 text-brand-500" />}
                <span><strong className="block text-sm text-ink-800 dark:text-ink-100">{sessionActive ? '邀请另一台设备' : '创建协作并邀请设备'}</strong><span className="mt-1 block text-xs text-ink-400">以当前文档生成邀请码；可逐台邀请更多设备</span></span>
              </button>
              {!sessionActive && (
                <button type="button" onClick={() => { setView('join'); setError(''); setNotice('') }} disabled={busy} className="card flex items-start gap-3 p-4 text-left transition hover:border-brand-300 disabled:opacity-50">
                  <Users size={19} className="mt-0.5 text-brand-500" />
                  <span><strong className="block text-sm text-ink-800 dark:text-ink-100">使用邀请码加入</strong><span className="mt-1 block text-xs text-ink-400">粘贴另一台设备的邀请码并生成应答</span></span>
                </button>
              )}
            </div>
          )}

          {view === 'host' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">邀请设备（第 1 / 3 步）</h3>
                <button type="button" onClick={() => setView('home')} className="btn-ghost h-7 text-xs">返回</button>
              </div>
              <SignalOutput label="邀请码 · 发给加入方" code={offerCode} onCopy={() => void copyCode(offerCode, '邀请码')} />
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-300" htmlFor="lan-answer-input">粘贴对方返回的应答码（第 3 步）</label>
              <textarea id="lan-answer-input" value={answerInput} onChange={(event) => setAnswerInput(event.target.value)} rows={4} placeholder="STARLOG-LAN1.…" className="input resize-none font-mono !text-[10px]" />
              <button type="button" onClick={() => void acceptAnswer()} disabled={busy || !answerInput.trim()} className="btn-primary h-9">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}确认应答并连接
              </button>
            </div>
          )}

          {view === 'join' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">加入协作（第 2 / 3 步）</h3>
                <button type="button" onClick={() => setView('home')} className="btn-ghost h-7 text-xs">返回</button>
              </div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-300" htmlFor="lan-offer-input">粘贴邀请方发来的邀请码</label>
              <textarea id="lan-offer-input" value={offerInput} onChange={(event) => setOfferInput(event.target.value)} rows={4} placeholder="STARLOG-LAN1.…" className="input resize-none font-mono !text-[10px]" />
              <button type="button" onClick={() => void acceptOffer()} disabled={busy || !offerInput.trim()} className="btn-primary h-9">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}生成应答码
              </button>
              <SignalOutput label="应答码 · 发回邀请方" code={answerCode} onCopy={() => void copyCode(answerCode, '应答码')} />
            </div>
          )}

          {error && <p role="alert" className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-xs leading-relaxed text-rose-600 dark:text-rose-300">{error}</p>}
          {notice && <p className="rounded-xl bg-brand-500/10 px-3.5 py-3 text-xs leading-relaxed text-brand-700 dark:text-brand-300">{notice}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/70 px-5 py-3 dark:border-white/10">
          <span className="text-[11px] text-ink-400">关闭此面板不会断开；离开文章或结束协作才会断开。</span>
          <div className="flex gap-2">
            {sessionActive && <button type="button" onClick={() => { stopSession(); setNotice('协作已结束，当前内容仍保留在编辑器中') }} className="btn-danger h-8 text-xs"><StopCircle size={13} />结束协作</button>}
            <button type="button" onClick={() => setOpen(false)} className="btn-outline h-8 text-xs">返回编辑</button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-outline h-9" title="仅离线版：通过 WebRTC 与局域网设备共同编辑，无需外部服务器">
        <Users size={15} className={connectedPeers > 0 ? 'text-emerald-500' : undefined} />
        <span className="hidden md:inline">局域网协作{connectedPeers > 0 ? ` · ${connectedPeers}` : ''}</span>
        {connectedPeers > 0 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      </button>
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : null}
    </>
  )
}
