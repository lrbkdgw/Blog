import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ExternalLink,
  Eye,
  Github,
  HardDrive,
  Loader2,
  MessageSquare,
  Omega,
  PenLine,
  RefreshCw,
  Send,
  Trash2,
  User,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { Markdown } from './Markdown'
import { LatexPicker } from './LatexPicker'
import { latexSymbolInsert, type LatexSymbol } from '../lib/latexSymbols'
import { formatDate, relativeTime } from '../lib/posts'
import { siteConfig } from '../lib/config'
import { OFFLINE } from '../lib/runtime'
import {
  addBlogDiscussionComment,
  createBlogDiscussion,
  deleteBlogDiscussionComment,
  loadBlogDiscussionComments,
} from '../lib/github'
import type { BlogDiscussionComment, BlogDiscussionThread } from '../lib/github'

export interface CommentItem {
  id: string
  postSlug: string
  content: string
  createdAt: number
  source: 'github' | 'legacy-local'
  url?: string
  canDelete?: boolean
  author: {
    name: string
    login?: string
    avatar_url?: string
    isOwner?: boolean
    isLocal?: boolean
  }
}

interface DiscussionRepository {
  repositoryId: string
  categoryId: string
}

const COMMENTS_STORAGE_KEY = 'starlog:comments'

function readCommentsStore(): Record<string, Omit<CommentItem, 'source'>[]> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(COMMENTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeCommentsStore(store: Record<string, Omit<CommentItem, 'source'>[]>) {
  localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(store))
  window.dispatchEvent(new CustomEvent('starlog:comments-changed'))
}

/** 读取旧版保存在当前浏览器中的评论，以便升级后仍可查看或删除。 */
export function getCommentsForPost(postSlug: string): CommentItem[] {
  const store = readCommentsStore()
  return (store[postSlug] || [])
    .map((comment) => ({
      ...comment,
      postSlug,
      source: 'legacy-local' as const,
      author: { ...comment.author, isLocal: true },
    }))
    .sort((left, right) => left.createdAt - right.createdAt)
}

/** 离线版：把评论 / 备注写到本机存储（不上传 GitHub Discussions） */
export function appendLocalComment(postSlug: string, text: string, authorName: string) {
  const store = readCommentsStore()
  const list = Array.isArray(store[postSlug]) ? store[postSlug] : []
  list.push({
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    postSlug,
    content: text,
    createdAt: Date.now(),
    author: { name: authorName || '本机', isLocal: true },
  })
  store[postSlug] = list
  writeCommentsStore(store)
}

function toCommentItem(postSlug: string, comment: BlogDiscussionComment): CommentItem {
  const login = comment.author?.login
  return {
    id: comment.id,
    postSlug,
    content: comment.body,
    createdAt: Date.parse(comment.createdAt),
    source: 'github',
    url: comment.url,
    canDelete: comment.viewerCanDelete,
    author: {
      name: login || 'ghost',
      login: login || undefined,
      avatar_url: comment.author?.avatarUrl,
      isOwner: comment.authorAssociation === 'OWNER',
      isLocal: false,
    },
  }
}

export function Comments({ postSlug, postTitle }: { postSlug: string; postTitle?: string }) {
  const { isAuthed, ghUser, loading: authLoading } = useAuth()
  const toast = useToast()
  const requestId = useRef(0)

  const [legacyComments, setLegacyComments] = useState<CommentItem[]>(() => getCommentsForPost(postSlug))
  const [remoteComments, setRemoteComments] = useState<CommentItem[]>([])
  const [discussion, setDiscussion] = useState<BlogDiscussionThread | null>(null)
  const [repository, setRepository] = useState<DiscussionRepository | null>(null)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [preview, setPreview] = useState(false)
  // LaTeX 符号选择框（issue #60）：与编辑器一样 Shift + ↑ 打开，
  // 打开时记住评论输入框的选区，符号插回原光标处。
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [latexPickerOpen, setLatexPickerOpen] = useState(false)
  const latexSelectionRef = useRef<{ start: number; end: number } | null>(null)

  const loadLegacyComments = useCallback(() => {
    setLegacyComments(getCommentsForPost(postSlug))
  }, [postSlug])

  const loadRemoteComments = useCallback(async (quiet = false) => {
    if (!isAuthed || OFFLINE) return
    const currentRequest = ++requestId.current
    if (!quiet) setRemoteLoading(true)
    setRemoteError('')
    try {
      const result = await loadBlogDiscussionComments(postSlug)
      if (requestId.current !== currentRequest) return
      setRepository({ repositoryId: result.repositoryId, categoryId: result.categoryId })
      setDiscussion(result.discussion)
      setRemoteComments(result.comments.map((comment) => toCommentItem(postSlug, comment)))
    } catch (error) {
      if (requestId.current !== currentRequest) return
      setRemoteError(error instanceof Error ? error.message : '加载 GitHub Discussions 评论失败')
    } finally {
      if (requestId.current === currentRequest) setRemoteLoading(false)
    }
  }, [isAuthed, postSlug])

  useEffect(() => {
    loadLegacyComments()
    const handler = () => loadLegacyComments()
    window.addEventListener('starlog:comments-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('starlog:comments-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [loadLegacyComments])

  useEffect(() => {
    setContent('')
    setPreview(false)
    // 离线版：评论走本机存储，不读取 GitHub Discussions
    if (OFFLINE) {
      setRemoteComments([])
      setDiscussion(null)
      setRepository(null)
      setRemoteError('')
      setRemoteLoading(false)
      return
    }
    if (authLoading) return
    if (!isAuthed) {
      requestId.current += 1
      setRemoteComments([])
      setDiscussion(null)
      setRepository(null)
      setRemoteError('')
      setRemoteLoading(false)
      return
    }
    void loadRemoteComments()
  }, [authLoading, isAuthed, loadRemoteComments])

  const isOwner = useMemo(() => {
    if (!isAuthed || !ghUser) return false
    return ghUser.login.toLowerCase() === siteConfig.author.name.toLowerCase()
  }, [isAuthed, ghUser])

  const currentAuthor = useMemo(() => {
    if (OFFLINE) {
      return {
        name: siteConfig.author.name || '本机',
        login: undefined as string | undefined,
        avatar_url: '',
        isOwner: true,
      }
    }
    if (!isAuthed || !ghUser) return null
    return {
      name: ghUser.name || ghUser.login,
      login: ghUser.login,
      avatar_url: ghUser.avatar_url,
      isOwner,
    }
  }, [ghUser, isAuthed, isOwner])

  const comments = useMemo(
    () => [...remoteComments, ...legacyComments].sort((left, right) => left.createdAt - right.createdAt),
    [legacyComments, remoteComments],
  )

  const openLatexPicker = () => {
    const ta = composerRef.current
    latexSelectionRef.current = ta
      ? { start: ta.selectionStart, end: ta.selectionEnd }
      : { start: content.length, end: content.length }
    setPreview(false)
    setLatexPickerOpen(true)
  }

  const insertLatexSymbol = (symbol: LatexSymbol) => {
    const saved = latexSelectionRef.current
    const start = Math.min(saved?.start ?? content.length, content.length)
    const end = Math.min(saved?.end ?? start, content.length)
    const { text, selectionStart, selectionEnd } = latexSymbolInsert(symbol)
    setContent(content.slice(0, start) + text + content.slice(end))
    requestAnimationFrame(() => {
      const ta = composerRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(start + selectionStart, start + selectionEnd)
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) {
      toast('请输入评论内容', 'warning')
      return
    }
    if (OFFLINE) {
      try {
        appendLocalComment(postSlug, trimmed, currentAuthor?.name ?? siteConfig.author.name)
        setContent('')
        setPreview(false)
        toast('已保存到本机（离线版评论不会上传 GitHub Discussions）', 'success')
      } catch (err) {
        toast(err instanceof Error ? err.message : '保存评论失败：本机存储可能已满', 'error')
      }
      return
    }
    if (!currentAuthor) {
      toast('请先登录后再发表评论', 'warning')
      return
    }
    if (!repository) {
      toast(remoteError || '评论服务尚未加载完成，请稍后重试', 'warning')
      return
    }

    setSubmitting(true)
    try {
      let targetDiscussion = discussion
      if (!targetDiscussion) {
        targetDiscussion = await createBlogDiscussion(
          repository.repositoryId,
          repository.categoryId,
          postSlug,
          postTitle || postSlug,
        )
        setDiscussion(targetDiscussion)
      }
      await addBlogDiscussionComment(targetDiscussion.id, trimmed)
      setContent('')
      setPreview(false)
      await loadRemoteComments(true)
      toast('评论已发布到 GitHub Discussions', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '发表评论失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (comment: CommentItem) => {
    if (!confirm('确定要删除这条评论吗？')) return
    if (comment.source === 'legacy-local') {
      const store = readCommentsStore()
      store[postSlug] = (store[postSlug] || []).filter((item) => item.id !== comment.id)
      writeCommentsStore(store)
      loadLegacyComments()
      toast('本机旧评论已删除', 'info')
      return
    }

    setDeletingId(comment.id)
    try {
      await deleteBlogDiscussionComment(comment.id)
      await loadRemoteComments(true)
      toast('GitHub Discussions 评论已删除', 'info')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除评论失败', 'error')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <section className="no-print mt-16 border-t border-ink-200/60 pt-10 dark:border-white/[0.08]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight text-ink-900 dark:text-white">
          <MessageSquare size={20} className="text-brand-500" />
          评论 ({comments.length})
        </h2>
        <div className="flex items-center gap-1">
          {isAuthed && !OFFLINE && (
            <button
              type="button"
              onClick={() => void loadRemoteComments()}
              disabled={remoteLoading}
              title="刷新评论"
              className="btn-ghost h-8 w-8 !px-0"
            >
              <RefreshCw size={14} className={remoteLoading ? 'animate-spin' : ''} />
            </button>
          )}
          {discussion && (
            <a
              href={discussion.url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost h-8 px-2.5 text-xs"
              title="在 GitHub Discussions 中打开"
            >
              <Github size={13} />
              GitHub
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      <div className="card mb-8 p-5">
        {authLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-400">
            <Loader2 size={17} className="animate-spin" />
            正在恢复 GitHub 登录状态…
          </div>
        ) : (OFFLINE || isAuthed) && currentAuthor ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between border-b border-ink-200/60 pb-3 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                {currentAuthor.avatar_url ? (
                  <img src={currentAuthor.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
                    {currentAuthor.name[0]?.toUpperCase() || 'U'}
                  </div>
                )}
                <span className="text-sm font-medium text-ink-900 dark:text-white">
                  {currentAuthor.name}
                  {currentAuthor.login && (
                    <span className="ml-1 text-xs text-ink-400">(@{currentAuthor.login})</span>
                  )}
                </span>
                {currentAuthor.isOwner && (
                  <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
                    站长
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={openLatexPicker}
                  title="插入 LaTeX 符号 (Shift + ↑)"
                  className="btn-ghost h-7 !px-2 text-xs"
                >
                  <Omega size={13} />
                  <span className="hidden sm:inline">LaTeX 符号</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreview((value) => !value)}
                  className="btn-ghost h-7 !px-2 text-xs"
                >
                  {preview ? <PenLine size={13} /> : <Eye size={13} />}
                  {preview ? '编辑' : '预览 Markdown'}
                </button>
              </div>
            </div>

            {preview ? (
              <div className="min-h-[6rem] rounded-xl border border-ink-200/70 bg-ink-50/40 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                {content.trim() ? (
                  <Markdown content={content} applyDirectives={false} />
                ) : (
                  <p className="text-xs text-ink-400">输入内容后在此预览效果…</p>
                )}
              </div>
            ) : (
              <textarea
                ref={composerRef}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  // 与编辑器一致：Shift + ↑ 打开 LaTeX 符号选择框（输入法组合中不拦截）。
                  if (
                    event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    event.key === 'ArrowUp' &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    openLatexPicker()
                  }
                }}
                rows={3}
                maxLength={10000}
                placeholder="撰写你的评论（支持 Markdown、公式与代码，Shift + ↑ 插入 LaTeX 符号）…"
                className="input resize-y font-mono text-[13.5px]"
                required
              />
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-xs text-ink-400">
                {OFFLINE
                  ? '这条内容只保存在这台设备的浏览器里，离线可用；同步到线上时不会提交'
                  : '评论将公开保存到 GitHub Discussions'}
              </span>
              <button
                type="submit"
                disabled={
                  submitting || (!OFFLINE && (remoteLoading || !repository)) || !content.trim()
                }
                className="btn-primary h-9 px-4 text-xs"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {submitting ? '发送中…' : remoteLoading ? '加载中…' : '发表评论'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <User size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                {OFFLINE ? '连接 GitHub 后可参与公开讨论' : '登录后查看并参与公开讨论'}
              </p>
              <p className="mt-1 text-xs text-ink-400">评论由 GitHub Discussions 跨设备保存</p>
            </div>
            <Link to="/login" className="btn-primary mt-2 h-8 px-4 text-xs">
              <Github size={13} />
              使用 GitHub 登录
            </Link>
          </div>
        )}
      </div>

      {legacyComments.length > 0 && (
        <div className="mb-4 flex gap-2.5 rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          <HardDrive size={15} className="mt-0.5 shrink-0" />
          <p>
            {OFFLINE
              ? `本机保存了 ${legacyComments.length} 条备注，只在这台设备上可见；离线版不会把它们上传到 GitHub。`
              : `检测到 ${legacyComments.length} 条旧版本机评论。它们会继续在这台设备上显示，但因无法验证原作者，不会自动上传到 GitHub；你可以复制后重新发表，或将其删除。`}
          </p>
        </div>
      )}

      {isAuthed && remoteError && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-300/50 bg-rose-50/70 p-4 dark:border-rose-400/20 dark:bg-rose-500/10">
          <div className="flex gap-2.5 text-sm text-rose-700 dark:text-rose-200">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">共享评论加载失败</p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">{remoteError}</p>
            </div>
          </div>
          <button type="button" onClick={() => void loadRemoteComments()} className="btn-ghost h-8 shrink-0 px-2 text-xs">
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      )}

      <div className="space-y-4">
        {isAuthed && remoteLoading && remoteComments.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200/80 p-10 text-sm text-ink-400 dark:border-white/10">
            <Loader2 size={18} className="animate-spin" />
            正在从 GitHub Discussions 加载评论…
          </div>
        ) : comments.length === 0 && !remoteError ? (
          <div className="rounded-2xl border border-dashed border-ink-200/80 p-10 text-center dark:border-white/10">
            <MessageSquare size={24} className="mx-auto text-ink-300 dark:text-ink-600" />
            <p className="mt-2 text-sm text-ink-500">
              {OFFLINE
                ? '还没有本机备注。离线版的评论只写在这台设备上，方便给自己留观点与待办。'
                : isAuthed
                  ? '这篇文章还没有评论，快来发表第一条观点吧！'
                  : '登录后即可加载 GitHub Discussions 中的共享评论。'}
            </p>
          </div>
        ) : (
          comments.map((comment) => {
            const canDelete = OFFLINE
              ? true
              : comment.source === 'github'
              ? comment.canDelete
              : isAuthed && (isOwner || (
                !!ghUser && !!comment.author.login
                && comment.author.login.toLowerCase() === ghUser.login.toLowerCase()
              ))
            return (
              <div
                key={`${comment.source}-${comment.id}`}
                className="card group animate-fade-up p-4 transition-all hover:border-brand-200/80 dark:hover:border-white/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {comment.author.avatar_url ? (
                      <img
                        src={comment.author.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-ink-200/80 dark:ring-white/10"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-indigo-600 text-xs font-bold text-white shadow-sm">
                        {comment.author.name[0]?.toUpperCase() || 'U'}
                      </div>
                    )}
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink-900 dark:text-white">{comment.author.name}</span>
                        {comment.author.login && <span className="text-xs text-ink-400">@{comment.author.login}</span>}
                        {comment.author.isOwner && (
                          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
                            站长
                          </span>
                        )}
                        {comment.source === 'legacy-local' && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            仅本机旧评论
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-400">
                        {formatDate(new Date(comment.createdAt).toISOString().slice(0, 10))} · {relativeTime(comment.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {comment.url && (
                      <a
                        href={comment.url}
                        target="_blank"
                        rel="noreferrer"
                        title="在 GitHub 中查看"
                        className="btn-ghost h-7 w-7 !px-0 opacity-60 hover:opacity-100"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(comment)}
                        disabled={deletingId === comment.id}
                        title="删除评论"
                        className="btn-ghost h-7 w-7 !px-0 text-rose-500 opacity-60 hover:bg-rose-50 hover:opacity-100 dark:hover:bg-rose-500/10"
                      >
                        {deletingId === comment.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 text-[14.5px] leading-relaxed text-ink-700 dark:text-ink-200">
                  <Markdown content={comment.content} applyDirectives={false} />
                </div>
              </div>
            )
          })
        )}
      </div>
      <LatexPicker
        open={latexPickerOpen}
        onClose={() => {
          setLatexPickerOpen(false)
          requestAnimationFrame(() => composerRef.current?.focus())
        }}
        onInsert={insertLatexSymbol}
      />
    </section>
  )
}
