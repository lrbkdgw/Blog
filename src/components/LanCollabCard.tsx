import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Link2, Plug, PlugZap, UsersRound } from 'lucide-react'
import { useToast } from './Toast'
import { OFFLINE } from '../lib/runtime'
import {
  createLanCollab,
  defaultServerUrl,
  isLanCollabSupported,
  isValidRoomCode,
  normalizeServerUrl,
  type CollabStatus,
  type LanCollab,
} from '../lib/collab'
import { getLocalPostRaw, listLocalPostRaws, saveLocalPostRaw } from '../lib/posts'
import { pushLocalVersion } from '../lib/offlineLibrary'

const SETTINGS_KEY = 'starlog:lan-collab-settings'

interface LanCollabSettings {
  url: string
  room: string
  name: string
}

function loadSettings(): LanCollabSettings {
  const fallback: LanCollabSettings = {
    url: defaultServerUrl(),
    room: '',
    name: `设备-${Math.random().toString(36).slice(2, 6)}`,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<LanCollabSettings>
    return {
      url: typeof parsed.url === 'string' && parsed.url ? parsed.url : fallback.url,
      room: typeof parsed.room === 'string' ? parsed.room : '',
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : fallback.name,
    }
  } catch {
    return fallback
  }
}

function randomRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

const STATUS_LABEL: Record<CollabStatus, string> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  closed: '连接已断开',
  error: '连接失败',
}

/**
 * 离线版「局域网协作」卡片（issue #112，预览能力）。
 *
 * 同一局域网里的设备共用一台中继（`npm run lan`），互相同步本机文章库：
 * 本机保存的文章会推送给房间里的其他设备，其他设备的文章也会写入本机。
 * 只有用户点「连接」后才联网（连到局域网中继），平时仍然一个包都不发。
 * 只在离线版渲染，线上站点看不到这个卡片。
 */
export function LanCollabCard() {
  const toast = useToast()
  const [settings, setSettings] = useState<LanCollabSettings>(() => loadSettings())
  const [status, setStatus] = useState<CollabStatus>('idle')
  const [peers, setPeers] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [lastSync, setLastSync] = useState<string>('')
  const collabRef = useRef<(LanCollab & { dispose(): void }) | null>(null)
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
  const urlValid = normalizeServerUrl(settings.url) !== null
  const roomValid = isValidRoomCode(settings.room.trim())
  const connected = status === 'connected' || status === 'connecting'

  const connect = () => {
    if (!supported) {
      setErrorMsg('当前浏览器不支持 WebSocket，无法使用局域网协作')
      return
    }
    if (!urlValid) {
      setErrorMsg('服务器地址无效（应为 ws://局域网IP:8787 这样的地址）')
      return
    }
    if (!roomValid) {
      setErrorMsg('房间号无效（1–32 位字母、数字、-、_，与协作伙伴约定同一个）')
      return
    }
    setErrorMsg('')
    collabRef.current?.dispose()
    if (welcomeTimerRef.current !== null) {
      window.clearTimeout(welcomeTimerRef.current)
      welcomeTimerRef.current = null
    }
    welcomePostsRef.current = []
    lastSentRef.current = new Map()
    setPeers(0)
    const collab = createLanCollab({
      room: settings.room.trim(),
      name: settings.name.trim() || '匿名设备',
      onStatus: (next) => {
        setStatus(next)
        if (next === 'connected') {
          // 连接成功后把本机文章全量推一遍，房间里其他设备随即收到
          pushAllLocal(collab)
          toast('已连接协作房间，本机文章已推送', 'success')
        } else if (next === 'error') {
          setErrorMsg('连不上中继：请确认中继已启动（npm run lan）、地址与房间号无误，且设备在同一局域网')
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
    collab.connect(settings.url)
  }

  const disconnect = () => {
    collabRef.current?.dispose()
    collabRef.current = null
    setStatus('idle')
    setPeers(0)
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
            同一局域网里的设备可以共同编辑：共用一台中继，互相同步本机文章库。
            只有点「连接」后才连到局域网中继，平时仍然不联网；删除不会广播，避免误删扩散。
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">中继地址</span>
            <input
              value={settings.url}
              onChange={(e) => setSettings((s) => ({ ...s, url: e.target.value }))}
              disabled={connected}
              placeholder="ws://192.168.1.5:8787"
              className="input w-full font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-500">房间号（与伙伴约定同一个）</span>
            <div className="flex gap-2">
              <input
                value={settings.room}
                onChange={(e) => setSettings((s) => ({ ...s, room: e.target.value }))}
                disabled={connected}
                placeholder="例如 1234"
                className="input w-full font-mono text-sm"
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
        </div>
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

        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <button type="button" onClick={disconnect} className="btn-outline h-9">
              <Plug size={15} />
              断开连接
            </button>
          ) : (
            <button type="button" onClick={connect} disabled={!supported} className="btn-primary h-9">
              <PlugZap size={15} />
              连接协作房间
            </button>
          )}
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

        {errorMsg && (
          <p className="flex items-start gap-1.5 rounded-xl bg-rose-500/[0.07] px-3 py-2 text-xs leading-relaxed text-rose-600 dark:text-rose-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {errorMsg}
          </p>
        )}

        <div className="rounded-xl bg-ink-50 p-4 text-xs leading-relaxed text-ink-500 dark:bg-white/[0.03] dark:text-ink-300">
          <p className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200">
            <Link2 size={13} />
            怎么用（3 步）
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>在局域网里任意一台电脑上运行中继：<code className="rounded bg-ink-100 px-1 font-mono dark:bg-white/10">npm run lan</code>（需要 Node.js，仓库根目录执行）。</li>
            <li>把中继电脑的局域网 IP（如 <code className="rounded bg-ink-100 px-1 font-mono dark:bg-white/10">192.168.1.5</code>）填进上方地址，与伙伴约定同一个房间号。</li>
            <li>各设备点「连接」：本机文章会推给房间，房间里的文章会写入本机（覆盖前自动存快照）。</li>
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
