import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Copy, Link2, Plug, PlugZap, Radar, UsersRound } from 'lucide-react'
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
import { getLocalPostRaw, listLocalPostRaws, saveLocalPostRaw } from '../lib/posts'
import { pushLocalVersion } from '../lib/offlineLibrary'

const SETTINGS_KEY = 'starlog:lan-collab-settings'

interface LanCollabSettings {
  /** 房间号：主输入项，与协作伙伴约定同一个即可 */
  room: string
  /** 本机名字（可选，显示给协作伙伴） */
  name: string
  /** 高级：手动指定中继地址；留空 = 自动发现（默认） */
  manualUrl: string
  /** 上次成功连上的中继，作为下次自动发现的快路径 */
  lastUrl: string
}

/** 支持从中继打印的邀请链接 http://IP:8787/?room=1234 直接带出房间号 */
function roomFromUrl(): string {
  try {
    const fromSearch = new URLSearchParams(window.location.search).get('room')
    if (fromSearch) return fromSearch.slice(0, 32)
    const hashQuery = window.location.hash.split('?')[1]
    if (hashQuery) return (new URLSearchParams(hashQuery).get('room') ?? '').slice(0, 32)
  } catch {
    // 某些 file:// 环境读取受限，忽略即可
  }
  return ''
}

function loadSettings(): LanCollabSettings {
  const fallback: LanCollabSettings = {
    room: roomFromUrl(),
    name: `设备-${Math.random().toString(36).slice(2, 6)}`,
    manualUrl: '',
    lastUrl: '',
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<LanCollabSettings> & { url?: string }
    return {
      // 邀请链接里的房间号优先于本机记忆，方便「打开链接 → 直接连接」
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

/** ws://IP:8787 → http://IP:8787/?room=xxx（邀请链接） */
function inviteLink(wsUrl: string, room: string): string | null {
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

/**
 * 离线版「局域网协作」卡片（issue #112，预览能力）。
 *
 * 交互目标：**只填房间号就能连上**。点「连接」后自动在局域网里寻找用户自己
 * 启动的中继（`npm run lan`）；若离线 HTML 是由中继本身提供的，则零探测直连。
 * 找不到时可在「高级」里手动填地址，或打开中继打印的邀请链接（连房间号也带好）。
 * 只有点「连接」后才联网，平时仍然一个包都不发。仅离线版渲染。
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
  const collabRef = useRef<(LanCollab & { dispose(): void }) | null>(null)
  const discoveryRef = useRef<AbortController | null>(null)
  const lastSentRef = useRef(new Map<string, string>())
  // welcome 会一次性回放房间里所有文章，合并成一条提示而不是刷屏
  const welcomePostsRef = useRef<string[]>([])
  const welcomeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // 存储不可用时只影响下次打开的默认值，不影响本次协作
    }
  }, [settings])

  const pushAllLocal = useCallback((collab: LanCollab) => {
    for (const { slug, raw } of listLocalPostRaws()) {
      if (lastSentRef.current.get(slug) === raw) continue
      if (collab.sendPost(slug, raw, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)) {
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
        // 登记后推送监听器就不会把刚收到的内容又广播回房间（避免回声）
        lastSentRef.current.set(slug, raw)
        saveLocalPostRaw(slug, raw)
        setLastSync(new Date().toLocaleTimeString('zh-CN'))
        if (from) {
          toast(`已接收 ${from} 的《${slug}》`, 'success')
        } else {
          // 来自 welcome 的房间已有文章：合并成一条提示
          welcomePostsRef.current.push(slug)
          if (welcomeTimerRef.current === null) {
            welcomeTimerRef.current = window.setTimeout(() => {
              welcomeTimerRef.current = null
              const list = welcomePostsRef.current
              welcomePostsRef.current = []
              if (list.length > 0) {
                toast(`已从协作房间接收 ${list.length} 篇文章`, 'success')
              }
            }, 60)
          }
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : '接收协作文章失败', 'error')
      }
    },
    [toast],
  )

  // 本机文章变化时推送给房间（只推变化过的；删除不广播，避免误删扩散）
  useEffect(() => {
    const onPostsChanged = () => {
      const collab = collabRef.current
      if (!collab || collab.status !== 'connected') return
      pushAllLocal(collab)
    }
    window.addEventListener('starlog:posts-changed', onPostsChanged)
    return () => window.removeEventListener('starlog:posts-changed', onPostsChanged)
  }, [pushAllLocal])

  useEffect(
    () => () => {
      discoveryRef.current?.abort()
      collabRef.current?.dispose()
      collabRef.current = null
      if (welcomeTimerRef.current !== null) {
        window.clearTimeout(welcomeTimerRef.current)
        welcomeTimerRef.current = null
      }
    },
    [],
  )

  if (!OFFLINE) return null

  const supported = isLanCollabSupported()
  const roomValid = isValidRoomCode(settings.room.trim())
  const busy = status === 'discovering' || status === 'connecting'
  const connected = status === 'connected' || busy

  const resetConnection = () => {
    collabRef.current?.dispose()
    collabRef.current = null
    if (welcomeTimerRef.current !== null) {
      window.clearTimeout(welcomeTimerRef.current)
      welcomeTimerRef.current = null
    }
    welcomePostsRef.current = []
    lastSentRef.current = new Map()
    setPeers(0)
    setProgress(null)
    setFoundUrl('')
  }

  const startConnection = (target: string, room: string) => {
    setFoundUrl(target)
    const collab = createLanCollab({
      room,
      name: settings.name.trim() || '匿名设备',
      onStatus: (next) => {
        setStatus(next)
        if (next === 'connected') {
          pushAllLocal(collab)
          toast('已连接协作房间，本机文章已推送', 'success')
        } else if (next === 'error') {
          setErrorMsg('连不上中继：请确认中继已启动（npm run lan），或在「高级设置」里手动填写中继地址')
        }
      },
      onRemotePost: (slug, raw, from) => applyRemotePost(slug, raw, from),
      onPresence: (count) => setPeers(count),
      onServerError: (message) => {
        setErrorMsg(message)
        toast(message, 'error')
      },
    })
    collabRef.current = collab
    collab.connect(target)
  }

  const connect = async () => {
    if (!supported) {
      setStatus('error')
      setErrorMsg('当前浏览器不支持 WebSocket，无法使用局域网协作')
      return
    }
    const room = settings.room.trim()
    if (!roomValid) {
      setStatus('error')
      setErrorMsg('房间号无效（1–32 位字母、数字、-、_，与协作伙伴约定同一个）')
      return
    }
    setErrorMsg('')
    resetConnection()

    // 高级里填了地址就直接用；否则自动发现 —— 主流程只需要房间号
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
          '没在局域网里找到协作中继：请确认有一台设备运行了 npm run lan。' +
            '更省事的做法是直接打开中继启动时打印的 http://…:8787/ 邀请链接（页面会自动认出中继），' +
            '或在「高级设置」里手动填写地址。',
        )
        return
      }
      // 记住这次找到的中继，下次连接几乎瞬时完成
      setSettings((s) => ({ ...s, lastUrl: target as string }))
    }
    startConnection(target, room)
  }

  const disconnect = () => {
    discoveryRef.current?.abort()
    discoveryRef.current = null
    resetConnection()
    setStatus('idle')
  }

  const copyInvite = async () => {
    const known =
      foundUrl ||
      settings.lastUrl ||
      settings.manualUrl ||
      relayUrlFromLocation() ||
      ''
    const link = inviteLink(known, settings.room.trim())
    if (!link) {
      toast('还没有可用的中继地址', 'info')
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      toast('邀请链接已复制，发给协作伙伴打开即可（房间号已带好）', 'success')
    } catch {
      toast(`邀请链接：${link}`, 'info')
    }
  }

  return (
    <section className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <UsersRound size={17} />
        </span>
        <div>
          <h2 className="font-medium text-ink-900 dark:text-white">局域网协作（预览）</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            <strong className="font-medium text-ink-600 dark:text-ink-200">只需填房间号</strong>
            ：点「连接」会自动在局域网里找到中继并同步本机文章库。
            只有连接时才联网，平时不联网；删除不广播，覆盖前自动存快照。
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">房间号（与伙伴约定同一个）</span>
          <div className="flex gap-2">
            <input
              value={settings.room}
              onChange={(e) => setSettings((s) => ({ ...s, room: e.target.value }))}
              disabled={connected}
              placeholder="例如 1234"
              className="input w-full font-mono text-base"
            />
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, room: randomRoomCode() }))}
              disabled={connected}
              className="btn-outline h-10 shrink-0 text-xs"
            >
              随机
            </button>
          </div>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {status === 'discovering' ? (
            <button type="button" onClick={disconnect} className="btn-outline h-9">
              <Plug size={15} />
              取消查找
            </button>
          ) : status === 'connected' ? (
            <button type="button" onClick={disconnect} className="btn-outline h-9">
              <Plug size={15} />
              断开连接
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!supported || status === 'connecting'}
              className="btn-primary h-9"
            >
              <PlugZap size={15} />
              连接协作房间
            </button>
          )}
          <button type="button" onClick={() => void copyInvite()} className="btn-ghost h-9">
            <Copy size={15} />
            复制邀请链接
          </button>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              status === 'connected'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : status === 'error' || status === 'closed'
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                  : 'bg-ink-500/10 text-ink-500 dark:text-ink-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === 'connected' ? 'bg-emerald-500' : status === 'error' || status === 'closed' ? 'bg-rose-500' : 'bg-ink-400'
              }`}
            />
            {STATUS_LABEL[status]}
            {status === 'connected' && peers > 0 ? ` · ${peers} 台设备在线` : ''}
          </span>
          {lastSync && <span className="text-xs text-ink-400">上次接收 {lastSync}</span>}
        </div>

        {status === 'discovering' && (
          <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-300">
            <Radar size={13} className="shrink-0 animate-pulse text-brand-500" />
            正在局域网里寻找中继…
            {progress && progress.total > 0 ? `已探测 ${progress.tried}/${progress.total} 个地址` : '正在收集本机网络信息'}
            {settings.lastUrl ? '（会优先试上次连过的中继）' : ''}
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
              {settings.manualUrl ? '· 已手动指定地址' : '· 自动发现中继'}
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">手动指定中继地址（留空 = 自动发现）</span>
              <input
                value={settings.manualUrl}
                onChange={(e) => setSettings((s) => ({ ...s, manualUrl: e.target.value }))}
                disabled={connected}
                placeholder="ws://192.168.1.5:8787"
                className="input w-full font-mono text-sm"
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-ink-400">
                自动发现依赖浏览器能直连局域网；跨网段、VPN 或有防火墙时在这里填地址。
                {settings.lastUrl ? `上次成功连接：${settings.lastUrl}` : ''}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">本机名字（显示给协作伙伴）</span>
              <input
                value={settings.name}
                onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                disabled={connected}
                placeholder="例如 我的电脑"
                className="input w-full text-sm"
              />
            </label>
          </div>
        </details>

        <div className="rounded-xl bg-ink-50 p-4 text-xs leading-relaxed text-ink-500 dark:bg-white/[0.03] dark:text-ink-300">
          <p className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200">
            <Link2 size={13} />
            怎么用
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>局域网里任意一台电脑运行中继：<code className="rounded bg-ink-100 px-1 font-mono dark:bg-white/10">npm run lan</code>（仓库根目录，需要 Node.js）。</li>
            <li>
              其他设备<strong className="font-medium text-ink-700 dark:text-ink-200">打开中继启动时打印的 <code className="rounded bg-ink-100 px-1 font-mono dark:bg-white/10">http://…:8787/?room=房间号</code> 链接</strong>：页面会自动认出中继、房间号也已带好；
              也可以直接双击自己的离线 HTML —— 填房间号后会自动在局域网里寻找中继。
            </li>
            <li>各设备点「连接」：本机文章推给房间，房间里的文章写入本机（覆盖前自动存快照）。</li>
          </ol>
          <p className="mt-2 text-ink-400">
            只在可信局域网（家庭 / 办公室 / 课堂）里使用：房间号不是密码，不要把中继端口暴露到公网。
            同时编辑同一篇时以最后保存为准，被覆盖的本机版本会保留在「本机版本」里。
          </p>
        </div>
      </div>
    </section>
  )
}
