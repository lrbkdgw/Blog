import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Laptop,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Share2,
  Sparkles,
  UserCheck,
  Users,
  Wifi,
  X,
} from 'lucide-react'
import { useToast } from './Toast'
import {
  hasWebRtcSupport,
  type LanCollabPeer,
  type LanCollabState,
} from '../lib/lanCollab'

interface LanCollabDialogProps {
  open: boolean
  initialTab?: 'host' | 'join'
  state: LanCollabState
  onClose: () => void
  onChangeSelfName: (name: string) => void
  onStartHosting: () => Promise<void>
  onRefreshInvite: () => Promise<void>
  onAcceptAnswer: (answerCode: string) => Promise<void>
  onJoinWithInvite: (inviteCode: string) => Promise<string>
  onJoinLocalRoom: (roomCode: string) => void
  onDisconnect: () => void
  onJumpToPeer?: (peer: LanCollabPeer) => void
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 回退到选区复制
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function LanCollabDialog({
  open,
  initialTab = 'host',
  state,
  onClose,
  onChangeSelfName,
  onStartHosting,
  onRefreshInvite,
  onAcceptAnswer,
  onJoinWithInvite,
  onJoinLocalRoom,
  onDisconnect,
  onJumpToPeer,
}: LanCollabDialogProps) {
  const toast = useToast()
  const [tab, setTab] = useState<'host' | 'join'>(initialTab)
  const [nameDraft, setNameDraft] = useState(state.selfName)
  const [inviteInput, setInviteInput] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [roomInput, setRoomInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setNameDraft(state.selfName)
    }
  }, [open, initialTab, state.selfName])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const webRtcAvailable = hasWebRtcSupport()
  const activeSession = state.role !== 'idle'
  const onlineCount = Math.max(1, state.peers.length)

  const handleCopy = async (label: string, key: string, value: string) => {
    if (!value) return
    try {
      await copyText(value)
      setCopiedField(key)
      toast(`${label}已复制到剪贴板`, 'success')
      window.setTimeout(() => {
        setCopiedField((curr) => (curr === key ? null : curr))
      }, 1800)
    } catch {
      toast('复制失败，请手动全选复制', 'warning')
    }
  }

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== state.selfName) {
      onChangeSelfName(trimmed)
      toast(`协作昵称已更新为「${trimmed}」`, 'info')
    }
  }

  const handleStartHost = async () => {
    commitName()
    setBusy('host')
    try {
      await onStartHosting()
      toast('已开启局域网协作房间', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '开启协作失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleAcceptAnswer = async () => {
    if (!answerInput.trim()) {
      toast('请先粘贴协作者发回的响应码', 'warning')
      return
    }
    setBusy('accept')
    try {
      await onAcceptAnswer(answerInput)
      setAnswerInput('')
      toast('已确认响应码，正在建立局域网点对点连接…', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '响应码校验失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleJoinInvite = async () => {
    if (!inviteInput.trim()) {
      toast('请先粘贴房主分享的邀请码', 'warning')
      return
    }
    commitName()
    setBusy('join-webrtc')
    try {
      const answer = await onJoinWithInvite(inviteInput)
      await copyText(answer).catch(() => undefined)
      toast('响应码已生成并自动复制，请发给房主完成配对', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '解析邀请码失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleJoinRoomCode = () => {
    if (!roomInput.trim()) {
      toast('请输入 6 位房间号', 'warning')
      return
    }
    commitName()
    try {
      onJoinLocalRoom(roomInput)
      toast(`正在连接房间 ${roomInput.trim().toUpperCase()}…`, 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : '连接房间失败', 'error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="局域网合作文档"
    >
      <div
        className="absolute inset-0 animate-fade-in bg-ink-950/45 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="card relative z-10 flex max-h-[88vh] w-full max-w-2xl animate-scale-in flex-col overflow-hidden !bg-white/95 shadow-2xl dark:!bg-ink-900/95">
        {/* 标题栏 */}
        <div className="flex items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
              <Users size={17} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-lg font-bold text-ink-900 dark:text-white">
                  局域网合作文档
                </h2>
                <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  仅离线版
                </span>
                {activeSession && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      state.status === 'connected'
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : state.status === 'closed'
                          ? 'bg-rose-500/12 text-rose-600 dark:text-rose-300'
                          : 'bg-brand-500/12 text-brand-600 dark:text-brand-300'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        state.status === 'connected'
                          ? 'bg-emerald-500'
                          : state.status === 'closed'
                            ? 'bg-rose-500'
                            : 'animate-pulse bg-brand-500'
                      }`}
                    />
                    {state.status === 'connected'
                      ? `${onlineCount} 台设备协同中`
                      : state.status === 'closed'
                        ? '连接已断开'
                        : '等待协作者接入'}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                无需互联网与中心服务器，同一 Wi-Fi / 局域网设备直接点对点实时共编同一篇文章
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-ghost h-8 w-8 !px-0"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* 主体区 */}
        <div className="space-y-4 overflow-y-auto p-5">
          {/* 协作者昵称 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200/70 bg-ink-50/60 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: state.selfColor }}
            />
            <label className="text-xs font-medium text-ink-600 dark:text-ink-300">
              我的协作昵称
            </label>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitName()
                }
              }}
              maxLength={24}
              placeholder="输入显示给同伴的昵称…"
              className="min-w-[10rem] flex-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-900 outline-none focus:border-brand-400 dark:border-white/12 dark:bg-white/[0.05] dark:text-white"
            />
            {nameDraft.trim() && nameDraft.trim() !== state.selfName && (
              <button type="button" onClick={commitName} className="btn-outline h-7 !px-2.5 text-xs">
                保存昵称
              </button>
            )}
          </div>

          {state.error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {state.error}
            </div>
          )}

          {!activeSession ? (
            <>
              {/* 模式切换 */}
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-ink-100/80 p-1 dark:bg-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setTab('host')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                    tab === 'host'
                      ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
                      : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-white'
                  }`}
                >
                  <Share2 size={14} />
                  发起协作（我是房主）
                </button>
                <button
                  type="button"
                  onClick={() => setTab('join')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                    tab === 'join'
                      ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
                      : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-white'
                  }`}
                >
                  <UserCheck size={14} />
                  加入协作（接入他人文档）
                </button>
              </div>

              {tab === 'host' ? (
                <div className="space-y-3 rounded-2xl border border-ink-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
                      <Wifi size={16} />
                    </span>
                    <div className="space-y-1 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                      <p className="font-semibold text-ink-900 dark:text-white">
                        将当前编辑器内的文章共享给局域网伙伴共同编辑
                      </p>
                      <p>
                        开启后会同时生成<strong>局域网设备邀请码</strong>（供同一路由器 / 热点下的电脑、平板、手机点对点直连）与<strong>6 位房间号</strong>（同设备多窗口免粘贴秒连）。双方修改标题、标签、摘要和正文都会毫秒级双向同步。
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleStartHost}
                      disabled={busy === 'host'}
                      className="btn-primary h-9 text-xs"
                    >
                      {busy === 'host' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      {busy === 'host' ? '正在准备局域网通道…' : '开启局域网协作房间'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 跨设备邀请码接入 */}
                  <div className="space-y-2.5 rounded-2xl border border-ink-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-900 dark:text-white">
                        <Wifi size={14} className="text-brand-500" />
                        方式一：局域网跨设备点对点接入
                      </span>
                      {!webRtcAvailable && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          当前环境未开放 WebRTC
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-500 dark:text-ink-400">
                      粘贴房主发来的 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">SL1...</code> 邀请码，生成响应码发回给房主即可直接连通（无需外网）：
                    </p>
                    <textarea
                      value={inviteInput}
                      onChange={(e) => setInviteInput(e.target.value)}
                      rows={3}
                      placeholder="在此粘贴房主的局域网邀请码（SL1Z... 或 SL1P...）"
                      className="input font-mono text-xs"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleJoinInvite}
                        disabled={!webRtcAvailable || busy === 'join-webrtc'}
                        className="btn-primary h-9 text-xs"
                      >
                        {busy === 'join-webrtc' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <UserCheck size={14} />
                        )}
                        {busy === 'join-webrtc' ? '正在生成响应码…' : '解析邀请码并生成响应码'}
                      </button>
                    </div>
                  </div>

                  {/* 同设备多窗口房间号秒连 */}
                  <div className="space-y-2.5 rounded-2xl border border-ink-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-900 dark:text-white">
                      <Laptop size={14} className="text-emerald-500" />
                      方式二：同机浏览器多窗口房间号秒连
                    </span>
                    <div className="flex gap-2">
                      <input
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleJoinRoomCode()
                          }
                        }}
                        maxLength={12}
                        placeholder="输入 6 位房间号，例如 A7K9M2"
                        className="input flex-1 font-mono text-xs uppercase tracking-wider"
                      />
                      <button
                        type="button"
                        onClick={handleJoinRoomCode}
                        className="btn-outline h-10 shrink-0 text-xs"
                      >
                        房间号直连
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ---------------------- 已处于活跃协作会话中 ---------------------- */
            <div className="space-y-4">
              {/* 房间概要与成员列表 */}
              <div className="rounded-2xl border border-ink-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/60 pb-3 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-500">房间号</span>
                    <code className="rounded-lg bg-brand-500/10 px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-brand-700 dark:text-brand-300">
                      {state.roomCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy('房间号', 'room', state.roomCode)}
                      className="btn-ghost h-7 !px-2 text-xs"
                    >
                      {copiedField === 'room' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                      复制
                    </button>
                  </div>
                  <span className="font-mono text-[11px] text-ink-400">
                    同步版本 #{state.seq}
                  </span>
                </div>

                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-ink-500 dark:text-ink-400">
                    在线成员（{state.peers.length}）
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {state.peers.map((peer) => {
                      const isSelf = peer.peerId === state.selfPeerId
                      const canJump = !isSelf && Boolean(peer.cursor && onJumpToPeer)
                      return (
                        <div
                          key={peer.peerId}
                          onClick={() => {
                            if (canJump && onJumpToPeer) {
                              onJumpToPeer(peer)
                              onClose()
                            }
                          }}
                          className={`flex items-center justify-between gap-2 rounded-xl border border-ink-200/60 bg-white/80 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.03] ${
                            canJump ? 'cursor-pointer transition hover:border-brand-400' : ''
                          }`}
                          title={canJump ? '点击跳转到该协作者正在编辑的位置' : undefined}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: peer.color }}
                            />
                            <span className="truncate font-medium text-ink-900 dark:text-white">
                              {peer.name}
                              {isSelf ? '（我）' : ''}
                            </span>
                            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600 dark:bg-white/10 dark:text-ink-300">
                              {peer.role === 'host' ? '房主' : '协作者'}
                            </span>
                          </div>
                          {peer.cursor && (
                            <span className="shrink-0 font-mono text-[11px] text-ink-400">
                              行 {peer.cursor.line}:{peer.cursor.column}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* 房主：继续邀请更多局域网设备 */}
              {state.role === 'host' && webRtcAvailable && (
                <div className="space-y-3 rounded-2xl border border-brand-200/70 bg-brand-50/35 p-4 dark:border-brand-500/20 dark:bg-brand-500/[0.05]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-900 dark:text-white">
                      <Plus size={14} className="text-brand-500" />
                      接入局域网设备（支持多台设备依次加入）
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        setBusy('refresh')
                        try {
                          await onRefreshInvite()
                          toast('已生成新的局域网邀请码', 'info')
                        } catch (err) {
                          toast(err instanceof Error ? err.message : '刷新邀请码失败', 'error')
                        } finally {
                          setBusy(null)
                        }
                      }}
                      disabled={busy === 'refresh'}
                      className="btn-ghost h-7 !px-2 text-xs"
                    >
                      <RefreshCw size={12} className={busy === 'refresh' ? 'animate-spin' : ''} />
                      刷新邀请码
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-ink-600 dark:text-ink-300">
                      <span>第一步：复制下方邀请码发给同一局域网内的同伴</span>
                      <button
                        type="button"
                        onClick={() => handleCopy('邀请码', 'invite', state.inviteCode)}
                        disabled={!state.inviteCode}
                        className="btn-outline h-7 !px-2.5 text-xs"
                      >
                        {copiedField === 'invite' ? (
                          <Check size={12} className="text-emerald-500" />
                        ) : (
                          <Copy size={12} />
                        )}
                        复制邀请码
                      </button>
                    </div>
                    <input
                      readOnly
                      value={state.inviteCode || '正在生成局域网邀请码…'}
                      onFocus={(e) => e.currentTarget.select()}
                      className="input font-mono text-[11px]"
                    />
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="block text-xs text-ink-600 dark:text-ink-300">
                      第二步：将同伴回传的「响应码」粘贴到下方并确认接入
                    </span>
                    <div className="flex gap-2">
                      <input
                        value={answerInput}
                        onChange={(e) => setAnswerInput(e.target.value)}
                        placeholder="粘贴协作者生成的响应码（SL1...）"
                        className="input flex-1 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleAcceptAnswer}
                        disabled={busy === 'accept'}
                        className="btn-primary h-10 shrink-0 text-xs"
                      >
                        {busy === 'accept' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <UserCheck size={14} />
                        )}
                        确认接入
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 协作者：等待房主确认响应码时展示复制面板 */}
              {state.role === 'guest' && state.answerCode && state.status !== 'connected' && (
                <div className="space-y-2 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-500/25 dark:bg-amber-500/[0.07]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      请将下方响应码发送给房主粘贴确认
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('响应码', 'answer', state.answerCode)}
                      className="btn-primary h-7 !px-2.5 text-xs"
                    >
                      {copiedField === 'answer' ? <Check size={12} /> : <Copy size={12} />}
                      复制响应码
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={3}
                    value={state.answerCode}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input font-mono text-[11px]"
                  />
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                    房主点击「确认接入」后，连接会自动建立并将房主当前编辑的文档同步至本窗口。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部栏 */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-200/70 px-5 py-3.5 dark:border-white/10">
          {activeSession ? (
            <button
              type="button"
              onClick={() => {
                onDisconnect()
                toast('已退出局域网协作房间，当前文档内容仍保留在编辑器中', 'info')
              }}
              className="btn-danger h-8 !px-3 text-xs"
            >
              <LogOut size={13} />
              退出协作房间
            </button>
          ) : (
            <span className="text-[11px] text-ink-400">
              提示：协作过程中任意一方均可随时点击「保存到本机」留存副本
            </span>
          )}
          <button type="button" onClick={onClose} className="btn-outline h-8 !px-4 text-xs">
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
