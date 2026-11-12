import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Copy, Link2, Plug, Radar, Rocket, UserPlus, UsersRound } from 'lucide-react'
import { useToast } from './Toast'
import { OFFLINE } from '../lib/runtime'
import {
  createLanCollab,
  isLanCollabSupported,
  isValidRoomCode,
  normalizeServerUrl,
  type CollabStatus,
  type LanCollab,
} from '../lib/collab'
import {
  discoverLanRelay,
  relayUrlFromLocation,
  type DiscoveryProgress,
} from '../lib/lanDiscovery'
import {
  createWebrtcGuest,
  createWebrtcHost,
  type WebrtcHost,
  type WebrtcTransport,
} from '../lib/lanWebrtc'
import { getLocalPostRaw, listLocalPostRaws, saveLocalPostRaw } from '../lib/posts'
import { pushLocalVersion } from '../lib/offlineLibrary'

const SETTINGS_KEY = 'starlog:lan-collab-settings'

interface LanCollabSettings {
  /** 房间号：可留空，点「开始协作」会自动生成 */
  room: string
  name: string
  /** 高级：可选的中继地址；留空 = 默认零命令 WebRTC 直连 */
  manualUrl: string
  /** 上次成功连上的中继（房间号直连模式的快路径） */
  lastUrl: string
}

/** 邀请链接可带 ?room= / ?offer=（发起方复制给伙伴） */
function queryFromUrl(): { room: string; offer: string } {
  try {
    const search = new URLSearchParams(window.location.search)
    const hashQuery = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    return {
      room: (search.get('room') || hashQuery.get('room') || '').slice(0, 32),
      offer: (search.get('offer') || hashQuery.get('offer') || '').slice(0, 20000),
    }
  } catch {
    return { room: '', offer: '' }
  }
}

function loadSettings(): LanCollabSettings {
  const fromUrl = queryFromUrl()
  const fallback: LanCollabSettings = {
    room: fromUrl.room,
    name: `设备-${Math.random().toString(36).slice(2, 6)}`,
    manualUrl: '',
    lastUrl: '',
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<LanCollabSettings> & { url?: string }
    return {
      room: fallback.room || (typeof parsed.room === 'string' ? parsed.room : ''),
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : fallback.name,
      manualUrl: typeof parsed.manualUrl === 'string' ? parsed.manualUrl : '',
      lastUrl:
        typeof parsed.lastUrl === 'string'
          ? parsed.lastUrl
          : typeof parsed.url === 'string'
            ? parsed.url
            : '',
    }
  } catch {
    return fallback
  }
}

function randomRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

/** ws://IP:8787 → http://IP:8787/?room=xxx（中继模式的邀请链接） */
function relayInviteLink(wsUrl: string, room: string): string | null {
  try {
    const url = new URL(wsUrl)
    return `http://${url.host}/?room=${encodeURIComponent(room)}`
  } catch {
    return null
  }
}

const STATUS_LABEL: Record<CollabStatus, string> = {
  idle: '未连接',
  discovering: '寻找中继…',
  connecting: '连接中…',
  connected: '已连接',
  closed: '连接已断开',
  error: '连接失败',
}

type Transport = (LanCollab | WebrtcTransport) & { dispose(): void }

/**
 * 离线版「局域网协作」卡片（issue #112，预览能力）。
 *
 * **默认通道不需要提前运行任何命令**：点「开始协作」用 WebRTC DataChannel
 * 点对点直连，发起方生成「邀请码」、伙伴生成「回应码」，两台设备互相粘贴一次即可。
 * 若用户已在局域网里跑了 `npm run lan`（高级设置里填地址），仍可只填房间号直连中继。
 * 只有点按钮后才开始收集 ICE 候选 / 探测局域网，平时离线版一个包都不发。
 */
export function LanCollabCard() {
  const toast = useToast()
  const [settings, setSettings] = useState<LanCollabSettings>(() => loadSettings())
  const [status, setStatus] = useState<CollabStatus>('idle')
  const [peers, setPeers] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [lastSync, setLastSync] = useState<string>('')
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null)
  const [foundUrl, setFoundUrl] = useState('')
  /** 零命令握手的两个阶段：发起方等回应码 / 加入方等对方完成 */
  const [handshake, setHandshake] = useState<'idle' | 'offer' | 'answer' | 'connected'>('idle')
  const [inviteCode, setInviteCode] = useState('')
  const [answerCode, setAnswerCode] = useState('')
  const [inputCode, setInputCode] = useState(() => queryFromUrl().offer)
  const [answerInput, setAnswerInput] = useState('')
  const transportRef = useRef<Transport | null>(null)
  const hostRef = useRef<WebrtcHost | null>(null)
  const discoveryRef = useRef<AbortController | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const lastSentRef = useRef(new Map<string, string>())
  const welcomePostsRef = useRef<string[]>([])
  const welcomeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // 存储不可用时只影响下次打开的默认值，不影响本次协作
    }
  }, [settings])

  // 页头「本机管理 → 开始协作」跳过来时（?collab=1）自动定位到卡片
  useEffect(() => {
    try {
      const search = new URLSearchParams(window.location.search)
      const hashQuery = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      if (search.get('collab') !== '1' && hashQuery.get('collab') !== '1') return
    } catch {
      return
    }
    const timer = window.setTimeout(() => {
      sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [])

  const pushAllLocal = useCallback((transport: Pick<Transport, 'sendPost'>) => {
    for (const { slug, raw } of listLocalPostRaws()) {
      if (lastSentRef.current.get(slug) === raw) continue
      if (transport.sendPost(slug, raw, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)) {
        lastSentRef.current.set(slug, raw)
      }
    }
  }, [])

  const applyRemotePost = useCallback(
    (slug: string, raw: string, from?: string) => {
      const localRaw = getLocalPostRaw(slug)
      if (localRaw === raw) return // 与本机一致（回声 / 重复推送），不重复写入
      try {
        // 覆盖前先把本机版本存成快照，万一两边同时改了也能找回
        if (localRaw !== null) pushLocalVersion(slug, localRaw, '局域网协作接收前自动快照')
        // 先登记再写入：saveLocalPostRaw 会同步派发 starlog:posts-changed，
        // 登记后推送监听器就不会把刚收到的内容又广播回去（避免回声）
        lastSentRef.current.set(slug, raw)
        saveLocalPostRaw(slug, raw)
        setLastSync(new Date().toLocaleTimeString('zh-CN'))
        if (from) {
          toast(`已接收 ${from} 的《${slug}》`, 'success')
        } else {
          welcomePostsRef.current.push(slug)
          if (welcomeTimerRef.current === null) {
            welcomeTimerRef.current = window.setTimeout(() => {
              welcomeTimerRef.current = null
              const list = welcomePostsRef.current
              welcomePostsRef.current = []
              if (list.length > 0) toast(`已从协作房间接收 ${list.length} 篇文章`, 'success')
            }, 60)
          }
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : '接收协作文章失败', 'error')
      }
    },
    [toast],
  )

  // 本机文章变化时推送给对端（只推变化过的；删除不广播，避免误删扩散）
  useEffect(() => {
    const onPostsChanged = () => {
      const transport = transportRef.current
      if (!transport || transport.status !== 'connected') return
      pushAllLocal(transport)
    }
    window.addEventListener('starlog:posts-changed', onPostsChanged)
    return () => window.removeEventListener('starlog:posts-changed', onPostsChanged)
  }, [pushAllLocal])

  useEffect(
    () => () => {
      discoveryRef.current?.abort()
      transportRef.current?.dispose()
      transportRef.current = null
      if (welcomeTimerRef.current !== null) {
        window.clearTimeout(welcomeTimerRef.current)
        welcomeTimerRef.current = null
      }
    },
    [],
  )

  if (!OFFLINE) return null

  const webrtcSupported = typeof RTCPeerConnection !== 'undefined'
  const relaySupported = isLanCollabSupported()
  const busy = status === 'discovering' || status === 'connecting'
  const connected = status === 'connected'
  const locked = connected || busy
  const relayInvite = relayInviteLink(
    foundUrl || settings.lastUrl || settings.manualUrl || relayUrlFromLocation() || '',
    settings.room.trim(),
  )

  const resetConnection = () => {
    discoveryRef.current?.abort()
    discoveryRef.current = null
    transportRef.current?.dispose()
    transportRef.current = null
    hostRef.current = null
    if (welcomeTimerRef.current !== null) {
      window.clearTimeout(welcomeTimerRef.current)
      welcomeTimerRef.current = null
    }
    welcomePostsRef.current = []
    lastSentRef.current = new Map()
    setPeers(0)
    setProgress(null)
    setFoundUrl('')
    setInviteCode('')
    setAnswerCode('')
    setAnswerInput('')
    setHandshake('idle')
  }

  /** 所有通道共用的状态回调 */
  const makeCallbacks = (room: string) => ({
    onStatus: (next: CollabStatus) => {
      setStatus(next)
      if (next === 'connected') {
        setHandshake('connected')
        if (transportRef.current) pushAllLocal(transportRef.current)
        toast('协作已连接，本机文章已推送', 'success')
      } else if (next === 'error') {
        setErrorMsg('连接中断：请检查两台设备是否在同一局域网，或重新发起一次协作')
      }
    },
    onRemotePost: (slug: string, raw: string, from?: string) => applyRemotePost(slug, raw, from || room),
    onPresence: (count: number) => setPeers(count),
    onServerError: (message: string) => {
      setErrorMsg(message)
      toast(message, 'error')
    },
  })

  /** ① 发起方：零命令，WebRTC 点对点，生成邀请码 */
  const startCollaboration = async () => {
    if (!webrtcSupported) {
      setStatus('error')
      setErrorMsg('当前浏览器不支持 WebRTC，无法使用免命令协作；可在「高级设置」里改用中继')
      return
    }
    let room = settings.room.trim()
    if (!room) {
      room = randomRoomCode()
      setSettings((s) => ({ ...s, room }))
    }
    if (!isValidRoomCode(room)) {
      setStatus('error')
      setErrorMsg('房间号无效（1–32 位字母、数字、-、_）')
      return
    }
    setErrorMsg('')
    resetConnection()
    try {
      const host = await createWebrtcHost({
        room,
        name: settings.name.trim() || '匿名设备',
        ...makeCallbacks(room),
      })
      transportRef.current = host.collab
      hostRef.current = host
      setInviteCode(host.offerCode)
      setHandshake('offer')
      setStatus('connecting')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : '生成协作邀请失败')
    }
  }

  /** 发起方粘贴伙伴的回应码，完成握手 */
  const finishHandshake = async () => {
    const host = hostRef.current
    if (!host || !answerInput.trim()) {
      setErrorMsg('请先粘贴伙伴发来的「回应码」')
      return
    }
    try {
      await host.applyAnswer(answerInput)
      setErrorMsg('')
      toast('回应码已应用，正在建立点对点连接…', 'info')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '回应码无效')
    }
  }

  /** ② 加入方：粘贴邀请码 → 生成回应码（同样零命令） */
  const joinWithCode = async () => {
    if (!webrtcSupported) {
      setStatus('error')
      setErrorMsg('当前浏览器不支持 WebRTC，无法使用免命令协作')
      return
    }
    setErrorMsg('')
    resetConnection()
    try {
      const guest = await createWebrtcGuest(inputCode, {
        room: settings.room.trim() || '1234',
        name: settings.name.trim() || '匿名设备',
        ...makeCallbacks(settings.room.trim() || '1234'),
      })
      transportRef.current = guest.collab
      setAnswerCode(guest.answerCode)
      setHandshake('answer')
      setStatus('connecting')
      if (!settings.room.trim()) setSettings((s) => ({ ...s, room: guest.room }))
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : '邀请码无效')
    }
  }

  /** ③ 可选：已运行 npm run lan 中继时，只填房间号直连（原有能力保留） */
  const joinViaRelay = async () => {
    const room = settings.room.trim()
    if (!isValidRoomCode(room)) {
      setStatus('error')
      setErrorMsg('请先填写房间号，或粘贴发起方的邀请码点「加入协作」')
      return
    }
    if (!relaySupported) {
      setStatus('error')
      setErrorMsg('当前浏览器不支持 WebSocket；请使用免命令的 WebRTC 直连')
      return
    }
    setErrorMsg('')
    resetConnection()

    const manual = settings.manualUrl.trim()
    let target: string | null = null
    if (manual) {
      target = normalizeServerUrl(manual)
      if (!target) {
        setStatus('error')
        setErrorMsg('手动填写的中继地址无效（应为 ws://192.168.1.5:8787 这样的地址）')
        return
      }
    } else {
      const controller = new AbortController()
      discoveryRef.current = controller
      setStatus('discovering')
      setProgress({ tried: 0, total: 0 })
      try {
        target = await discoverLanRelay({
          room,
          lastUrl: settings.lastUrl || undefined,
          signal: controller.signal,
          onProgress: setProgress,
        })
      } catch {
        target = null
      } finally {
        discoveryRef.current = null
      }
      if (controller.signal.aborted) return
      if (!target) {
        setStatus('error')
        setProgress(null)
        setErrorMsg(
          '局域网里没有正在运行的中继。其实不需要运行任何命令：让发起方点「开始协作」，' +
            '把生成的邀请码发给你，粘贴到上面的连接码输入框再点「加入协作」即可。' +
            '（若确实想用中继，先在任一台设备运行 npm run lan，或在这里手动填地址。）',
        )
        return
      }
      setSettings((s) => ({ ...s, lastUrl: target as string }))
      setFoundUrl(target)
    }

    const collab = createLanCollab({
      room,
      name: settings.name.trim() || '匿名设备',
      ...makeCallbacks(room),
    })
    transportRef.current = collab
    collab.connect(target)
  }

  /** 「加入协作」：有连接码走零命令直连；没码且填了中继地址（或显式回退）走房间号直连 */
  const joinCollaboration = () => {
    if (inputCode.trim()) {
      void joinWithCode()
      return
    }
    if (settings.manualUrl.trim()) {
      void joinViaRelay()
      return
    }
    // 没填码也没填地址：先快速找一次已有的中继；找不到就明确引导零命令流程
    void joinViaRelay()
  }

  const disconnect = () => {
    resetConnection()
    setStatus('idle')
  }

  const copy = async (text: string, label: string) => {
    if (!text) {
      toast(`还没有${label}，先点「开始协作」或「加入协作」`, 'info')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast(`${label}已复制`, 'success')
    } catch {
      toast(`${label}：${text}`, 'info')
    }
  }

  const copyCurrent = () => {
    if (inviteCode) return copy(inviteCode, '邀请码')
    if (answerCode) return copy(answerCode, '回应码')
    if (relayInvite) return copy(relayInvite, '邀请链接')
    return copy('', '连接码')
  }

  return (
    <section ref={sectionRef} id="lan-collab" className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <UsersRound size={17} />
        </span>
        <div>
          <h2 className="font-medium text-ink-900 dark:text-white">局域网协作（预览）</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            <strong className="font-medium text-ink-600 dark:text-ink-200">不用提前运行任何命令</strong>
            ：发起方点「开始协作」生成邀请码，伙伴粘贴后回一个回应码，两台设备就点对点直连并同步文章。
            只有点按钮后才连局域网，平时不联网；删除不广播，覆盖前自动存快照。
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">房间号（可留空，发起时自动生成）</span>
            <div className="flex gap-2">
              <input
                value={settings.room}
                onChange={(e) => setSettings((s) => ({ ...s, room: e.target.value }))}
                disabled={locked}
                placeholder="例如 1234"
                className="input w-full font-mono text-base"
              />
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, room: randomRoomCode() }))}
                disabled={locked}
                className="btn-outline h-10 shrink-0 text-xs"
              >
                随机
              </button>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">连接码（伙伴发来的邀请码 / 回应码）</span>
            <input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              disabled={locked}
              placeholder="粘贴伙伴发来的连接码…"
              className="input w-full font-mono text-xs"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {locked ? (
            <button type="button" onClick={disconnect} className="btn-outline h-9">
              <Plug size={15} />
              {connected ? '结束协作' : '取消'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void startCollaboration()}
                disabled={!webrtcSupported}
                className="btn-primary h-9"
                title="无需任何命令：生成邀请码，用 WebRTC 与伙伴点对点直连"
              >
                <Rocket size={15} />
                开始协作
              </button>
              <button
                type="button"
                onClick={joinCollaboration}
                disabled={!webrtcSupported && !relaySupported}
                className="btn-outline h-9"
                title="粘贴伙伴的邀请码后加入；若已运行中继也可只填房间号"
              >
                <UserPlus size={15} />
                加入协作
              </button>
            </>
          )}
          <button type="button" onClick={() => void copyCurrent()} className="btn-ghost h-9">
            <Copy size={15} />
            复制连接码
          </button>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              connected
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : status === 'error' || status === 'closed'
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                  : 'bg-ink-500/10 text-ink-500 dark:text-ink-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? 'bg-emerald-500' : status === 'error' || status === 'closed' ? 'bg-rose-500' : 'bg-ink-400'
              }`}
            />
            {handshake === 'offer' && !connected ? '等待伙伴回应码' : STATUS_LABEL[status]}
            {connected && peers > 0 ? ` · ${peers} 台设备在线` : ''}
          </span>
          {lastSync && <span className="text-xs text-ink-400">上次接收 {lastSync}</span>}
        </div>

        {/* 发起方：把邀请码给伙伴，再粘贴伙伴的回应码 */}
        {handshake === 'offer' && !connected && (
          <div className="rounded-xl border border-brand-500/25 bg-brand-500/[0.05] px-3 py-3 text-xs leading-relaxed">
            <p className="font-medium text-ink-800 dark:text-ink-100">
              ① 把「邀请码」发给伙伴（聊天 / 邮件 / 二维码都行，无需运行任何命令）
            </p>
            <textarea
              readOnly
              value={inviteCode}
              onFocus={(e) => e.currentTarget.select()}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-ink-200/80 bg-white/70 p-2 font-mono text-[11px] dark:border-white/10 dark:bg-white/5"
            />
            <button type="button" onClick={() => void copy(inviteCode, '邀请码')} className="btn-outline mt-2 h-8 text-xs">
              <Copy size={13} />
              复制邀请码
            </button>
            <p className="mt-3 font-medium text-ink-800 dark:text-ink-100">② 伙伴点「加入协作」后会给你一串「回应码」，粘贴到这里完成连接</p>
            <input
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
              placeholder="粘贴伙伴的回应码…"
              className="input mt-2 w-full font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void finishHandshake()}
              disabled={!answerInput.trim()}
              className="btn-primary mt-2 h-8 text-xs"
            >
              <Link2 size={13} />
              完成连接
            </button>
          </div>
        )}

        {/* 加入方：把回应码发回给发起方 */}
        {handshake === 'answer' && !connected && (
          <div className="rounded-xl border border-brand-500/25 bg-brand-500/[0.05] px-3 py-3 text-xs leading-relaxed">
            <p className="font-medium text-ink-800 dark:text-ink-100">
              把下面这串「回应码」发回给发起方，对方粘贴后点「完成连接」，两端即自动连上
            </p>
            <textarea
              readOnly
              value={answerCode}
              onFocus={(e) => e.currentTarget.select()}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-ink-200/80 bg-white/70 p-2 font-mono text-[11px] dark:border-white/10 dark:bg-white/5"
            />
            <button type="button" onClick={() => void copy(answerCode, '回应码')} className="btn-outline mt-2 h-8 text-xs">
              <Copy size={13} />
              复制回应码
            </button>
          </div>
        )}

        {connected && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5 text-xs leading-relaxed text-emerald-800 dark:text-emerald-200">
            <p className="flex flex-wrap items-center gap-1.5 font-medium">
              <Rocket size={13} className="shrink-0" />
              协作已开始 · 房间号
              <code className="rounded bg-white/60 px-1 font-mono dark:bg-white/10">{settings.room.trim()}</code>
              {peers > 0 ? `· ${peers} 台设备在线` : ''}
            </p>
            {relayInvite && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-white/70 px-2 py-1 font-mono text-[11px] dark:bg-white/10">
                  {relayInvite}
                </code>
                <button type="button" onClick={() => void copy(relayInvite, '邀请链接')} className="btn-outline h-8 shrink-0 text-xs">
                  <Copy size={13} />
                  复制邀请链接
                </button>
              </div>
            )}
            <p className="mt-1.5 text-emerald-700/80 dark:text-emerald-300/80">
              现在任意一台设备保存文章，对方都会同步；不想用了点「结束协作」。
            </p>
          </div>
        )}

        {status === 'discovering' && (
          <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-300">
            <Radar size={13} className="shrink-0 animate-pulse text-brand-500" />
            正在局域网里寻找中继…
            {progress && progress.total > 0 ? `已探测 ${progress.tried}/${progress.total} 个地址` : '正在收集本机网络信息'}
            （找不到也没关系，零命令的邀请码直连不需要中继）
          </p>
        )}
        {foundUrl && status !== 'idle' && (
          <p className="truncate font-mono text-[11px] text-ink-400">中继：{foundUrl}</p>
        )}

        {errorMsg && (
          <p className="flex items-start gap-1.5 rounded-xl bg-rose-500/[0.07] px-3 py-2 text-xs leading-relaxed text-rose-600 dark:text-rose-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {errorMsg}
          </p>
        )}

        <details className="group rounded-xl border border-ink-200/70 bg-ink-50/50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
          <summary className="cursor-pointer list-none text-xs font-medium text-ink-500 dark:text-ink-300">
            高级设置（一般不用填）
            <span className="ml-1 text-[11px] font-normal text-ink-400">
              {settings.manualUrl ? '· 已指定中继，房间号直连' : '· 默认零命令点对点直连'}
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">可选：中继地址（只有主动运行 npm run lan 才需要）</span>
              <input
                value={settings.manualUrl}
                onChange={(e) => setSettings((s) => ({ ...s, manualUrl: e.target.value }))}
                disabled={locked}
                placeholder="ws://192.168.1.5:8787"
                className="input w-full font-mono text-sm"
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
                留空时「开始协作 / 加入协作」走 WebRTC 点对点，<strong className="font-medium">不需要运行任何命令</strong>。
                若局域网里已有一台设备运行了 <code className="rounded bg-ink-100 px-1 font-mono dark:bg-white/10">npm run lan</code>，
                在这里填地址后「加入协作」可只填房间号直连中继。
                {settings.lastUrl ? ` 上次连过的中继：${settings.lastUrl}` : ''}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">本机名字（显示给协作伙伴）</span>
              <input
                value={settings.name}
                onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                disabled={locked}
                placeholder="例如 我的电脑"
                className="input w-full text-sm"
              />
            </label>
          </div>
        </details>

        <div className="rounded-xl bg-ink-50 p-4 text-xs leading-relaxed text-ink-500 dark:bg-white/[0.03] dark:text-ink-300">
          <p className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200">
            <Link2 size={13} />
            怎么用（无需任何命令）
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>两台设备打开同一个离线 HTML，连到同一个 Wi-Fi / 局域网。</li>
            <li>
              发起方点<strong className="font-medium text-ink-700 dark:text-ink-200">「开始协作」</strong>：房间号留空会自动生成，
              复制出现的「邀请码」发给伙伴。
            </li>
            <li>
              伙伴把邀请码粘到「连接码」输入框，点<strong className="font-medium text-ink-700 dark:text-ink-200">「加入协作」</strong>，
              把生成的「回应码」发回给发起方。
            </li>
            <li>发起方粘贴回应码点「完成连接」：两端自动点对点连上，之后保存文章即互相同步（覆盖前自动存快照）。</li>
          </ol>
          <p className="mt-2 text-ink-400">
            浏览器不能接收别的设备主动发起的连接，所以免服务端直连需要互相交换一次握手码；
            不想交换码的话，也可以在任一台设备运行 <code className="rounded bg-ink-100 px-1 font-mono dark:bg-white/10">npm run lan</code> 中继，
            之后只填房间号即可（高级设置里填地址）。连接码只在本次握手使用，不是密码；请通过可信渠道交换，
            只在可信局域网使用，不要把协作端点暴露到公网。
          </p>
        </div>
      </div>
    </section>
  )
}
