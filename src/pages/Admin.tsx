import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CloudUpload,
  Eye,
  FileText,
  Github,
  HardDrive,
  Loader2,
  PenLine,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { usePosts } from '../lib/usePosts'
import { useToast } from '../components/Toast'
import { deleteLocalPost, formatDate, relativeTime, searchPosts, serializePost } from '../lib/posts'
import { commitPost, deleteRemotePost, getRepoTarget } from '../lib/github'
import type { Post } from '../lib/types'

type Filter = 'all' | 'local' | 'repo' | 'draft'

export default function Admin() {
  const [posts, refresh] = usePosts(true)
  const { canPublish, ghUser } = useAuth()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const target = getRepoTarget()

  const filtered = useMemo(() => {
    let list = searchPosts(posts, query)
    if (filter === 'local') list = list.filter((p) => p.source === 'local')
    if (filter === 'repo') list = list.filter((p) => p.source === 'repo')
    if (filter === 'draft') list = list.filter((p) => p.draft)
    return list
  }, [posts, query, filter])

  const counts = useMemo(
    () => ({
      all: posts.length,
      local: posts.filter((p) => p.source === 'local').length,
      repo: posts.filter((p) => p.source === 'repo').length,
      draft: posts.filter((p) => p.draft).length,
    }),
    [posts],
  )

  const publishOne = async (post: Post) => {
    if (!canPublish) {
      toast('请先在「设置」中连接 GitHub', 'warning')
      return
    }
    setBusy(post.slug)
    try {
      const res = await commitPost(post.slug, serializePost(post), `post(blog): ${post.title}`)
      toast(`已提交 ${res.path}，Actions 部署中…`, 'success', { label: '查看提交', href: res.commitUrl })
    } catch (err) {
      toast(err instanceof Error ? err.message : '提交失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const removePost = async (post: Post) => {
    if (post.source === 'local') {
      if (!confirm(`删除本地草稿「${post.title}」？`)) return
      deleteLocalPost(post.slug)
      refresh()
      toast('本地草稿已删除', 'info')
      return
    }
    if (!canPublish) {
      toast('删除仓库文章需要先连接 GitHub', 'warning')
      return
    }
    if (!confirm(`将从 GitHub 仓库中删除「${post.title}」，确定吗？`)) return
    setBusy(post.slug)
    try {
      await deleteRemotePost(post.slug)
      toast('已从仓库删除，重新部署后生效', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="container-page max-w-5xl pt-12">
      {/* 头部 */}
      <header className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">内容管理</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
            <span>共 {posts.length} 篇</span>
            <span className="text-ink-300 dark:text-ink-700">|</span>
            {canPublish ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Github size={14} />
                已连接 @{ghUser?.login} → {target.owner}/{target.repo}
              </span>
            ) : (
              <Link to="/admin/settings" className="flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-300">
                <Github size={14} />
                未连接 GitHub，点此设置
              </Link>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/settings" className="btn-outline h-9">
            <Settings size={15} />
            设置
          </Link>
          <Link to="/admin/new" className="btn-primary h-9">
            <Plus size={15} />
            写新文章
          </Link>
        </div>
      </header>

      {/* 筛选 */}
      <div className="mt-8 flex animate-fade-up flex-wrap items-center gap-3" style={{ animationDelay: '60ms' }}>
        <div className="relative min-w-[12rem] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章…"
            className="input !py-2 !pl-10"
          />
        </div>
        <div className="flex gap-0.5 rounded-xl bg-ink-100/80 p-1 dark:bg-white/5">
          {(
            [
              { id: 'all', label: '全部' },
              { id: 'repo', label: '仓库' },
              { id: 'local', label: '本地' },
              { id: 'draft', label: '草稿' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === f.id
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-white/10 dark:text-white'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-ink-400">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="card mt-5 animate-fade-up divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]" style={{ animationDelay: '120ms' }}>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <FileText size={26} className="text-ink-300" />
            <p className="text-sm text-ink-500">没有符合条件的文章</p>
            <Link to="/admin/new" className="btn-primary mt-1">
              <Plus size={15} />
              写一篇
            </Link>
          </div>
        )}

        {filtered.map((post) => (
          <div key={post.slug} className="group flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-ink-50/70 dark:hover:bg-white/[.03]">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                post.source === 'local'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
              }`}
              title={post.source === 'local' ? '浏览器本地草稿' : '仓库文件'}
            >
              {post.source === 'local' ? <HardDrive size={16} /> : <Github size={16} />}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  to={`/admin/edit/${post.slug}`}
                  className="truncate text-sm font-medium text-ink-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                >
                  {post.title}
                </Link>
                {post.draft && (
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                    草稿
                  </span>
                )}
                {post.pinned && (
                  <span className="shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-600 dark:text-brand-300">
                    置顶
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-ink-400">
                {formatDate(post.date, 'short')} · /{post.slug} · {post.wordCount} 字
                {post.savedAt ? ` · 本地保存于 ${relativeTime(post.savedAt)}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Link to={`/posts/${post.slug}`} className="btn-ghost h-8 w-8 !px-0" title="查看">
                <Eye size={15} />
              </Link>
              <Link to={`/admin/edit/${post.slug}`} className="btn-ghost h-8 w-8 !px-0" title="编辑">
                <PenLine size={15} />
              </Link>
              {post.source === 'local' && (
                <button
                  onClick={() => publishOne(post)}
                  disabled={busy === post.slug}
                  className="btn-ghost h-8 w-8 !px-0 text-brand-600 dark:text-brand-300"
                  title="发布到 GitHub"
                >
                  {busy === post.slug ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
                </button>
              )}
              <button
                onClick={() => removePost(post)}
                disabled={busy === post.slug}
                className="btn-ghost h-8 w-8 !px-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                title={post.source === 'local' ? '删除本地草稿' : '从仓库删除'}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mb-16 mt-4 text-xs leading-relaxed text-ink-400">
        「仓库」文章来自 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">{target.postsDir}/</code>{' '}
        目录，会在构建时打包进站点；「本地」文章只存在于当前浏览器，点击{' '}
        <CloudUpload size={12} className="inline" /> 即可提交到 GitHub 并触发自动部署。
      </p>
    </div>
  )
}
