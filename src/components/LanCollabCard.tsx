import { useEffect, useMemo, useState } from 'react'
import { Network, Plus, WifiOff } from 'lucide-react'
import { useToast } from './Toast'
import { siteConfig } from '../lib/config'
import { getLocalPosts, saveLocalPostRaw, serializePost } from '../lib/posts'
import {
  createLanSync,
  defaultServerUrl,
  isLanCollabSupported,
  type CollabStatus,
} from '../lib/collab'

/**
 * 离线版「局域网协作」面板（issue #112，预览能力）。
 *
 * 一台局域网内的设备跑 `node scripts/lan-collab-server.mjs` 起中继，
 * 其他设备在这里填上那台机器的地址与同一个文档 ID，就可以互相推送文章：
 * 一台设备保存到本机文章库的文章会推送给中继，再转发给同一文档里的其他设备。
 *
 * 目前的策略是**单向合并**：收到的文章在本机文章库里没有同名条目时才导入，
 * 避免把本机正在改的内容覆盖掉。逐字协作与冲突合并还没有做（见 README 的说明）。
 */
export function LanCollabCard() {
  const toast = useToast()
  const [serverUrl, setServerUrl] = useState(defaultServerUrl)
  const [docId, setDocId] = useState('starlog-lan')
  const [status, setStatus] = useState<CollabStatus>('idle')
  const [busy, setBusy] = useState(false)

  const sync = useMemo(
    () =>
      createLanSync({
        docId,
        name: siteConfig.author.name,
        onStatus: setStatus,
        onRemotePost: (incomingDocId, post) => {
          const record = post as { slug?: unknown; raw?: unknown } | null
          if (!record || typeof record.slug !== 'string' || typeof record.raw !== 'string') return
          if (getLocalPosts().some((item) => item.slug === record.slug)) return
          try {
            const imported = saveLocalPostRaw(record.slug, record.raw)
            toast(`已从协作文档「${incomingDocId}」收到《${imported.title}》`, 'success', {
              label: '查看文章',
              href: `/posts/${record.slug}`,
            })
          } catch (err) {
            toast(err instanceof Error ? err.message : '协作文章导入失败', 'error')
          }
        },
        onServerError: (message) => toast(message, 'error'),
      }),
    [docId, toast],
  )

  // 卸载时断开，避免离线文件切页之后还留着一个 socket
  useEffect(() => () => sync.dispose(), [sync])

  const connected = status === 'connected'
  const statusLabel = {
    idle: '未连接',
    connecting: '正在连接…',
    connected: '已连接',
    closed: '连接已断开',
    error: '连接失败',
  }[status]

  const connect = () => {
    setBusy(true)
    sync.connect(serverUrl)
    // 连接是异步的，结果由 onStatus 反映到界面上
    window.setTimeout(() => setBusy(false), 800)
  }

  const disconnect = () => {
    sync.disconnect()
    setStatus('idle')
  }

  const pushLocalPosts = () => {
    const posts = getLocalPosts()
    if (posts.length === 0) {
      toast('本机文章库还没有文章可同步', 'info')
      return
    }
    let sent = 0
    for (const post of posts) {
      // 推送的是完整 Markdown 原文（含 frontmatter），接收端直接写进本机文章库
      if (sync.sendPost({ slug: post.slug, raw: serializePost(post) })) sent += 1
    }
    if (sent === 0) {
      toast('还没有连接中继：先点「连接」', 'warning')
      return
    }
    toast(`已把本机 ${sent} 篇文章推送给协作文档「${docId}」`, 'success')
  }

  if (!isLanCollabSupported()) {
    return (
      <section className="card animate-fade-up p-6">
        <h2 className="flex items-center gap-2 font-medium">
          <Network size={17} className="text-brand-500" />
          局域网协作
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          当前浏览器不支持 WebSocket，无法使用局域网协作；请换用较新的浏览器打开这个离线文件。
        </p>
      </section>
    )
  }

  return (
    <section className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Network size={17} />
        </span>
        <div>
          <h2 className="font-medium text-ink-900 dark:text-white">局域网协作（预览能力）</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            同一局域网内的几台设备共用一台中继，共同编辑同一份文档。
            在一台设备上运行 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">node scripts/lan-collab-server.mjs</code>
            （零依赖，不需要 npm install），再把它的局域网地址填进来。
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">中继地址</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="ws://192.168.1.5:8787"
            className="input font-mono text-xs"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">文档 ID</span>
          <input
            value={docId}
            onChange={(event) => setDocId(event.target.value)}
            placeholder="starlog-lan"
            className="input font-mono text-xs"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            <button type="button" onClick={pushLocalPosts} className="btn-primary h-9">
              <Plus size={15} />
              同步本机文章到协作文档
            </button>
            <button type="button" onClick={disconnect} className="btn-outline h-9">
              断开连接
            </button>
          </>
        ) : (
          <button type="button" onClick={connect} disabled={busy} className="btn-primary h-9">
            {busy ? '正在连接…' : '连接中继'}
          </button>
        )}
        <span
          className={`ml-auto inline-flex items-center gap-1.5 text-xs ${
            connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-400'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-500' : status === 'error' ? 'bg-rose-500' : 'bg-ink-400'
            }`}
          />
          {statusLabel}
        </span>
      </div>

      {status === 'error' && (
        <p className="mt-3 text-xs leading-relaxed text-rose-600 dark:text-rose-300">
          连不上中继：确认那台设备正在运行 <code>scripts/lan-collab-server.mjs</code>，
          地址与端口是否一致（默认 <code>8787</code>），以及两台设备是否在同一个局域网里。
        </p>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
        <WifiOff size={13} className="mt-0.5 shrink-0" />
        这个功能由你在界面上显式点击触发，离线版平时仍然不发任何网络请求；
        中继地址也只写在本地，不会写进文章或上传到任何地方。
        当前为预览实现：收到的文章在本机没有同名条目时才导入，逐字协作与冲突合并尚未实现。
      </p>
    </section>
  )
}
