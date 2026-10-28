import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Laptop,
  RefreshCw,
  Terminal,
  Unplug,
  UserCheck,
  Users,
  Wifi,
  X,
} from 'lucide-react'
import {
  DEFAULT_LAN_HUB_PORT,
  buildStandaloneHubMjsSource,
  hasWebRtcSupport,
  loadSavedHostIp,
  type DiscoveredLanRoom,
  type LanCollabPeer,
  type LanCollabState,
} from '../lib/lanCollab'
import { useToast } from './Toast'

async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // file:// 或非安全上下文回退到选区复制
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export interface LanCollabDialogProps {
  open: boolean
  initialTab?: 'host' | 'join'
  initialIp?: string
  initialRoom?: string
  state: LanCollabState
  onClose: () => void
  onChangeSelfName: (name: string) => void
  onStartHosting: (customRoomCode?: string) => Promise<void>
  onProbeLocalHub: () => Promise<boolean>
  onRefreshRooms: (ipInput?: string) => Promise<DiscoveredLanRoom[]>
  onJoinByIpOrRoom: (ipInput: string, roomCodeInput: string) => Promise<void>
  onRefreshInvite: () => Promise<void>
  onAcceptAnswer: (answerCode: string) => Promise<void>
  onJoinWithInvite: (inviteCode: string) => Promise<string>
  onDisconnect: () => void
  onJumpToPeer?: (peer: LanCollabPeer) => void
}

export function LanCollabDialog({
  open,
  initialTab = 'host',
  initialIp = '',
  initialRoom = '',
  state,
  onClose,
  onChangeSelfName,
  onStartHosting,
  onProbeLocalHub,
  onRefreshRooms,
  onJoinByIpOrRoom,
  onRefreshInvite,
  onAcceptAnswer,
  onJoinWithInvite,
  onDisconnect,
  onJumpToPeer,
}: LanCollabDialogProps) {
  const toast = useToast()
  const [tab, setTab] = useState<'host' | 'join'>(initialTab)
  const [nameDraft, setNameDraft] = useState(state.selfName)

  const [customHostRoom, setCustomHostRoom] = useState('')
  const [joinIpInput, setJoinIpInput] = useState(() => initialIp || loadSavedHostIp())
  const [joinRoomInput, setJoinRoomInput] = useState(() => initialRoom)

  const [answerInput, setAnswerInput] = useState('')
  const [inviteInput, setInviteInput] = useState('')

  const [busy, setBusy] = useState(false)
  const [webrtcBusy, setWebrtcBusy] = useState(false)
  const [probingHub, setProbingHub] = useState(false)
  const [localError, setLocalError] = useState('')
  const [copiedKey, setCopiedKey] = useState<string>('')

  useEffect(() => {
    setNameDraft(state.selfName)
  }, [state.selfName])

  useEffect(() => {
    if (!open) return
    setLocalError('')
    if (initialIp) setJoinIpInput(initialIp)
    if (initialRoom) setJoinRoomInput(initialRoom)
    if (state.role === 'idle') {
      setTab(initialTab)
      void onRefreshRooms(initialIp || loadSavedHostIp())
    } else if (state.role === 'host') {
      setTab('host')
    } else {
      setTab('join')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab, initialIp, initialRoom, state.role])

  // 房主打开弹窗且尚未检测到本机局域网直连服务时，每 2 秒静默探测一次，启动即秒亮绿灯
  useEffect(() => {
    if (!open || state.role !== 'host' || state.hubConnected) return
    const timer = window.setInterval(() => {
      void onProbeLocalHub()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [open, state.role, state.hubConnected, onProbeLocalHub])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const activeSession = state.role !== 'idle'
  const remotePeers = state.peers.filter((p) => p.peerId !== state.selfPeerId)
  const webrtcAvailable = hasWebRtcSupport()

  const markCopied = (key: string) => {
    setCopiedKey(key)
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? '' : prev))
    }, 1800)
  }

  const handleCopy = async (key: string, text: string, label: string) => {
    if (!text) return
    const ok = await copyText(text)
    if (ok) {
      markCopied(key)
      toast(`已复制${label}`, 'success')
    } else {
      toast('复制失败，请手动选中复制', 'error')
    }
  }

  const commitNameIfNeeded = () => {
    if (nameDraft.trim()) onChangeSelfName(nameDraft.trim())
  }

  const handleStartHost = async () => {
    setLocalError('')
    setBusy(true)
    try {
      commitNameIfNeeded()
      await onStartHosting(customHostRoom)
      toast('协作房间已开启', 'success')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '开启房间失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDirectJoin = async (overrideIp?: string, overrideRoom?: string) => {
    const ip = (overrideIp !== undefined ? overrideIp : joinIpInput).trim()
    const room = (overrideRoom !== undefined ? overrideRoom : joinRoomInput).trim().toUpperCase()
    setLocalError('')
    setBusy(true)
    try {
      commitNameIfNeeded()
      await onJoinByIpOrRoom(ip, room)
      toast('已发起协作连接', 'success')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '连接失败，请检查 IP 或房间号')
    } finally {
      setBusy(false)
    }
  }

  const handleManualProbeHub = async () => {
    setProbingHub(true)
    try {
      const ok = await onProbeLocalHub()
      if (ok) {
        toast('已连接局域网直连服务！同伴现在可直接输入你的 IP 加入', 'success')
      } else {
        toast('尚未检测到本机局域网直连服务，请先在终端运行启动命令', 'info')
      }
    } finally {
      setProbingHub(false)
    }
  }

  const handleDownloadHubScript = () => {
    try {
      const source = buildStandaloneHubMjsSource(DEFAULT_LAN_HUB_PORT)
      const blob = new Blob([source], { type: 'text/javascript;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'starlog-lan-hub.mjs'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('已下载 starlog-lan-hub.mjs，终端运行 node starlog-lan-hub.mjs 即可', 'success')
    } catch {
      toast('下载脚本失败', 'error')
    }
  }

  const handleGenerateWebrtcInvite = async () => {
    setLocalError('')
    setWebrtcBusy(true)
    try {
      await onRefreshInvite()
      toast('已生成配对码', 'success')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '生成配对码失败')
    } finally {
      setWebrtcBusy(false)
    }
  }

  const handleAcceptAnswer = async () => {
    if (!answerInput.trim()) {
      setLocalError('请先粘贴协作者回传的响应码')
      return
    }
    setLocalError('')
    setWebrtcBusy(true)
    try {
      await onAcceptAnswer(answerInput)
      setAnswerInput('')
      toast('协作者已接入房间', 'success')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '响应码校验失败')
    } finally {
      setWebrtcBusy(false)
    }
  }

  const handleJoinByWebrtcInvite = async () => {
    if (!inviteInput.trim()) {
      setLocalError('请先粘贴房主发来的配对码')
      return
    }
    setLocalError('')
    setWebrtcBusy(true)
    try {
      commitNameIfNeeded()
      const answer = await onJoinWithInvite(inviteInput)
      if (answer) {
        const copied = await copyText(answer)
        toast(
          copied ? '响应码已生成并自动复制，请发回给房主' : '响应码已生成，请复制发回给房主',
          'success',
        )
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '配对码解析失败')
    } finally {
      setWebrtcBusy(false)
    }
  }

  const formatHostAddressForDisplay = (ip: string) =>
    state.hubPort === DEFAULT_LAN_HUB_PORT ? ip : `${ip}:${state.hubPort}`

  const buildDirectJoinUrl = (ip: string) => {
    const hostPart = `${ip}:${state.hubPort}`
    return `http://${hostPart}/#/admin/new?collab=join&ip=${encodeURIComponent(hostPart)}&room=${encodeURIComponent(state.roomCode)}`
  }

  const statusBadge = (() => {
    if (state.status === 'connected') {
      return {
        text: `协作已连接 · 在线 ${state.peers.length} 人`,
        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      }
    }
    if (state.status === 'waiting') {
      return {
        text: `房间 ${state.roomCode} 已就绪 · 等待加入`,
        cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
      }
    }
    if (state.status === 'connecting' || state.status === 'preparing') {
      return {
        text: '正在连接…',
        cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
      }
    }
    if (state.status === 'closed') {
      return {
        text: '连接已断开',
        cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
      }
    }
    return {
      text: '未开启',
      cls: 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300/60 dark:border-slate-700',
    }
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lan-collab-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* 顶部标题栏 */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300">
              <Wifi className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="lan-collab-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  局域网合作文档
                </h2>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25">
                  离线版专属
                </span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusBadge.cls}`}
                >
                  {statusBadge.text}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                输入房间号或房主局域网 IP 即可多人实时协同编辑，全程不连接任何外网。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-2 py-1.5 rounded-lg"
            title="关闭窗口（不会中断正在进行的协作）"
            aria-label="关闭局域网协作窗口"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 协作者昵称栏 */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: state.selfColor }}
              />
              我的协作昵称
            </div>
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={nameDraft}
                maxLength={24}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  if (nameDraft.trim() && nameDraft.trim() !== state.selfName) {
                    onChangeSelfName(nameDraft.trim())
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameDraft.trim()) {
                    e.currentTarget.blur()
                  }
                }}
                placeholder="输入展示给同伴的名字"
                className="input py-1.5 text-sm flex-1"
              />
              {activeSession && (
                <button
                  type="button"
                  onClick={() => {
                    onDisconnect()
                    setAnswerInput('')
                    setInviteInput('')
                    toast('已退出局域网协作会话', 'info')
                  }}
                  className="btn-ghost text-rose-600 dark:text-rose-400 text-xs px-2.5 py-1.5 shrink-0"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  断开协作
                </button>
              )}
            </div>
          </div>

          {/* 错误提示 */}
          {(localError || state.error) && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
              {localError || state.error}
            </div>
          )}

          {/* 未开始协作时：创建房间 / 加入协作 切换 */}
          {!activeSession && (
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  setTab('host')
                  setLocalError('')
                }}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                  tab === 'host'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                我是房主（创建房间）
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('join')
                  setLocalError('')
                  void onRefreshRooms(joinIpInput)
                }}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                  tab === 'join'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                输入 IP / 房间号加入
              </button>
            </div>
          )}

          {/* 在线协作者列表 */}
          {activeSession && (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-brand-500" />
                  房间 <code className="font-mono font-bold text-brand-600 dark:text-brand-300">{state.roomCode}</code> 成员（{state.peers.length}）
                </span>
                <span className="text-slate-400 dark:text-slate-500 font-mono">
                  {state.connectedHostAddress ? `${state.connectedHostAddress} · ` : ''}版本 #{state.seq}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {state.peers.map((peer) => {
                  const isMe = peer.peerId === state.selfPeerId
                  const canJump = !isMe && Boolean(peer.cursor && onJumpToPeer)
                  return (
                    <button
                      key={peer.peerId}
                      type="button"
                      disabled={!canJump}
                      onClick={() => {
                        if (canJump && onJumpToPeer) {
                          onJumpToPeer(peer)
                          onClose()
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition ${
                        canJump
                          ? 'hover:border-brand-400 cursor-pointer bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                          : 'cursor-default bg-slate-50 dark:bg-slate-800/60 border-slate-200/70 dark:border-slate-800'
                      }`}
                      title={
                        canJump && peer.cursor
                          ? `点击跳转到 ${peer.name} 当前编辑位置（第 ${peer.cursor.line} 行）`
                          : undefined
                      }
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: peer.color }}
                      />
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {peer.name}
                        {isMe ? '（我）' : ''}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300">
                        {peer.role === 'host' ? '房主' : '协作者'}
                      </span>
                      {peer.cursor && !isMe && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          行 {peer.cursor.line}:{peer.cursor.column}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {remotePeers.length === 0 && state.role === 'host' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  房间已开启！同伴输入下方房间号或本机局域网 IP 后即可实时看到彼此输入。你现在就可以直接关闭弹窗开始写文章。
                </p>
              )}
            </div>
          )}

          {/* ============================== 房主视图 ============================== */}
          {(activeSession ? state.role === 'host' : tab === 'host') && (
            <div className="space-y-3.5">
              {state.role !== 'host' ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 space-y-4">
                  <div className="text-center space-y-1.5">
                    <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300">
                      <Laptop className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      将当前文章开启为局域网协作房间
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                      毫秒级秒开，不阻塞编辑器。开启后同伴只需输入<strong>房间号</strong>或你的<strong>局域网 IP</strong> 即可直接加入共同编辑。
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-md mx-auto">
                    <input
                      type="text"
                      value={customHostRoom}
                      maxLength={12}
                      onChange={(e) => setCustomHostRoom(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleStartHost()
                      }}
                      placeholder="可选自定义房间号（留空自动生成 4 位数字）"
                      className="input text-xs font-mono flex-1"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleStartHost}
                      className="btn-primary px-5 py-2 text-sm shrink-0 justify-center"
                    >
                      <Wifi className="w-4 h-4" />
                      开启协作房间
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 核心卡片：房间号 + 局域网 IP */}
                  <div className="rounded-xl border border-brand-200/80 dark:border-brand-900/60 bg-brand-50/40 dark:bg-brand-950/20 p-4 space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          当前房间号（同电脑窗口或同页面直连只需输入此号码）
                        </div>
                        <div className="mt-1 flex items-center gap-2.5">
                          <span className="font-mono text-2xl font-bold tracking-widest text-brand-600 dark:text-brand-300">
                            {state.roomCode}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy('room', state.roomCode, '房间号')}
                            className="btn-ghost text-xs px-2.5 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            {copiedKey === 'room' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            复制房间号
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-200/80 dark:border-slate-800 pt-3">
                      {state.hubConnected ? (
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                              跨设备局域网 IP 直连已就绪
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              同伴在「加入协作」直接输入下方 IP 即可进入（单房间连房间号都可不填）
                            </span>
                          </div>

                          {state.lanIps.length > 0 ? (
                            <div className="space-y-2">
                              {state.lanIps.map((ip) => {
                                const displayAddr = formatHostAddressForDisplay(ip)
                                const directUrl = buildDirectJoinUrl(ip)
                                return (
                                  <div
                                    key={ip}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-white dark:bg-slate-900 px-3 py-2"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-xs text-slate-500 dark:text-slate-400">
                                        房主 IP：
                                      </span>
                                      <code className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                                        {displayAddr}
                                      </code>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(`ip-${ip}`, displayAddr, '房主 IP')}
                                        className="btn-primary text-xs px-2.5 py-1"
                                      >
                                        {copiedKey === `ip-${ip}` ? (
                                          <Check className="w-3.5 h-3.5" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5" />
                                        )}
                                        复制 IP
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleCopy(`url-${ip}`, directUrl, '浏览器一键直达链接')
                                        }
                                        className="btn-ghost text-xs px-2.5 py-1 border border-slate-200 dark:border-slate-700"
                                        title="其他手机/电脑无需先存离线 HTML，直接在浏览器打开此链接即可自动加入房间"
                                      >
                                        {copiedKey === `url-${ip}` ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5" />
                                        )}
                                        复制一键直达链接
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              本机直连服务已运行于端口 <code className="font-mono">{state.hubPort}</code>，请将本机局域网 IP（如 <code className="font-mono">192.168.x.x</code>）发给同伴输入即可。
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="text-xs text-slate-700 dark:text-slate-200 font-medium">
                            需要让同一 Wi-Fi / 局域网下的其他电脑、手机输入 IP 直连？
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            由于单文件离线网页（<code className="font-mono">file://</code>）本身不能直接在电脑网卡监听端口，在房主电脑终端运行下面一行零依赖本地命令后，此处会<strong>自动变绿并显示你的局域网 IP</strong>（同时其他设备还能直接浏览器访问你的 IP 打开离线博客）：
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy('cmd', 'npm run lan', '局域网直连启动命令')
                              }
                              className="btn-primary text-xs px-3 py-1.5"
                            >
                              {copiedKey === 'cmd' ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Terminal className="w-3.5 h-3.5" />
                              )}
                              复制命令：npm run lan
                            </button>
                            <button
                              type="button"
                              onClick={handleDownloadHubScript}
                              className="btn-ghost text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              title="若只下载了单个 offline/index.html 文件而没有仓库目录，下载此零依赖脚本运行 node starlog-lan-hub.mjs 即可"
                            >
                              <Download className="w-3.5 h-3.5" />
                              下载独立脚本（无仓库时用）
                            </button>
                            <button
                              type="button"
                              disabled={probingHub}
                              onClick={handleManualProbeHub}
                              className="btn-ghost text-xs px-2.5 py-1.5"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${probingHub ? 'animate-spin' : ''}`}
                              />
                              重新检测
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 折叠备用方案：纯无服务配对码（按需点击才生成，绝不默认阻塞） */}
                  {webrtcAvailable && (
                    <details className="rounded-xl border border-slate-200/80 dark:border-slate-800 px-3.5 py-2.5 text-xs">
                      <summary className="cursor-pointer select-none font-medium text-slate-600 dark:text-slate-400">
                        备用方式：不启动本地服务，使用离线配对码手动连接
                      </summary>
                      <div className="mt-3 space-y-3 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-slate-500 dark:text-slate-400">
                            1. 点击生成一次性配对码发给同伴：
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={webrtcBusy}
                              onClick={handleGenerateWebrtcInvite}
                              className="btn-ghost text-xs px-2.5 py-1 border border-slate-200 dark:border-slate-700"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${webrtcBusy ? 'animate-spin' : ''}`}
                              />
                              {state.inviteCode ? '重新生成配对码' : '生成配对码'}
                            </button>
                            {state.inviteCode && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy('invite', state.inviteCode, '配对邀请码')
                                }
                                className="btn-primary text-xs px-2.5 py-1"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                复制配对码
                              </button>
                            )}
                          </div>
                        </div>
                        {state.inviteCode && (
                          <textarea
                            readOnly
                            rows={2}
                            value={state.inviteCode}
                            onFocus={(e) => e.currentTarget.select()}
                            className="input font-mono text-[11px] leading-relaxed resize-none"
                          />
                        )}
                        <div className="space-y-1.5">
                          <span className="text-slate-500 dark:text-slate-400 block">
                            2. 粘贴同伴回传的响应码完成直连：
                          </span>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={answerInput}
                              onChange={(e) => setAnswerInput(e.target.value)}
                              placeholder="粘贴 SL1Z. 或 SL1P. 开头的响应码…"
                              className="input font-mono text-xs flex-1"
                            />
                            <button
                              type="button"
                              disabled={webrtcBusy || !answerInput.trim()}
                              onClick={handleAcceptAnswer}
                              className="btn-primary text-xs px-3 py-1.5 shrink-0"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              确认接入
                            </button>
                          </div>
                        </div>
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          {/* ============================== 协作者加入视图 ============================== */}
          {(activeSession ? state.role === 'guest' : tab === 'join') && (
            <div className="space-y-3.5">
              {state.role === 'guest' && state.status === 'connected' ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                  <div className="font-semibold">
                    已连入房间 {state.roomCode}
                    {state.connectedHostAddress ? `（${state.connectedHostAddress}）` : ''}，正在实时协同编辑！
                  </div>
                  <p className="opacity-90">
                    现在可以直接关闭此弹窗，在编辑器里正常输入正文、修改标题或标签，所有更改都会实时双向同步。
                  </p>
                </div>
              ) : (
                <>
                  {/* 自动发现的活跃房间列表（一键加入） */}
                  {state.discoveredRooms.length > 0 && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-2">
                      <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                        发现可直接加入的房间（点击即连）
                      </div>
                      <div className="space-y-1.5">
                        {state.discoveredRooms.map((r) => (
                          <div
                            key={`${r.source}-${r.roomCode}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-brand-600 dark:text-brand-300">
                                  房间 {r.roomCode}
                                </span>
                                <span className="text-slate-700 dark:text-slate-200 truncate font-medium">
                                  《{r.docTitle}》
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                房主：{r.hostName} · 在线 {r.peerCount} 人 ·{' '}
                                {r.source === 'local' ? '本机窗口直连' : r.hostAddress || '局域网直连'}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleDirectJoin(
                                  r.source === 'lan' ? r.hostAddress || joinIpInput : '',
                                  r.roomCode,
                                )
                              }
                              className="btn-primary text-xs px-3 py-1.5 shrink-0"
                            >
                              一键加入
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 主加入表单：输入 IP 或房间号即可 */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-3.5">
                    <div>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        输入房主 IP 或房间号直接连接
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        • <strong>跨设备（不同电脑/手机）</strong>：填房主显示的局域网 IP（如{' '}
                        <code className="font-mono">192.168.1.23</code>）；若对方只开了一个房间，房间号可留空。
                        <br />• <strong>同电脑窗口 / 已通过房主链接打开本页</strong>：IP 留空，直接填 4 位房间号即可。
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                      <div className="sm:col-span-3 space-y-1">
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          房主局域网 IP（同机可留空）
                        </label>
                        <input
                          type="text"
                          value={joinIpInput}
                          onChange={(e) => setJoinIpInput(e.target.value)}
                          onBlur={() => {
                            if (joinIpInput.trim()) void onRefreshRooms(joinIpInput)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleDirectJoin()
                          }}
                          placeholder="例如 192.168.1.23"
                          className="input font-mono text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2 space-y-1">
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          房间号（单房间可留空）
                        </label>
                        <input
                          type="text"
                          value={joinRoomInput}
                          maxLength={12}
                          onChange={(e) => setJoinRoomInput(e.target.value.toUpperCase())}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleDirectJoin()
                          }}
                          placeholder="例如 4829"
                          className="input font-mono text-xs uppercase tracking-wider"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void onRefreshRooms(joinIpInput)}
                        className="btn-ghost text-xs px-2.5 py-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        查找可用房间
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDirectJoin()}
                        className="btn-primary text-xs px-5 py-2"
                      >
                        <Wifi className="w-3.5 h-3.5" />
                        {busy ? '正在连接…' : '立即连接协作'}
                      </button>
                    </div>
                  </div>

                  {/* 折叠备用方案：纯无服务配对码加入 */}
                  {webrtcAvailable && (
                    <details className="rounded-xl border border-slate-200/80 dark:border-slate-800 px-3.5 py-2.5 text-xs">
                      <summary className="cursor-pointer select-none font-medium text-slate-600 dark:text-slate-400">
                        备用方式：粘贴房主配对码加入（无需局域网服务）
                      </summary>
                      <div className="mt-3 space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={inviteInput}
                            onChange={(e) => setInviteInput(e.target.value)}
                            placeholder="粘贴 SL1Z. 或 SL1P. 开头的房主配对码…"
                            className="input font-mono text-xs flex-1"
                          />
                          <button
                            type="button"
                            disabled={webrtcBusy || !inviteInput.trim()}
                            onClick={handleJoinByWebrtcInvite}
                            className="btn-primary text-xs px-3 py-1.5 shrink-0"
                          >
                            生成响应码
                          </button>
                        </div>
                        {state.answerCode && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 dark:text-slate-400">
                                将以下响应码发回给房主确认即可连通：
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy('answer', state.answerCode, '响应码')
                                }
                                className="btn-ghost text-xs px-2 py-0.5"
                              >
                                <Copy className="w-3 h-3" />
                                复制响应码
                              </button>
                            </div>
                            <textarea
                              readOnly
                              rows={2}
                              value={state.answerCode}
                              onFocus={(e) => e.currentTarget.select()}
                              className="input font-mono text-[11px] leading-relaxed resize-none"
                            />
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LanCollabDialog
