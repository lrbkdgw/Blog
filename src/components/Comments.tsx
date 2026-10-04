import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Eye,
  Github,
  MessageSquare,
  PenLine,
  Send,
  Trash2,
  User,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { Markdown } from './Markdown'
import { formatDate, relativeTime } from '../lib/posts'
import { siteConfig } from '../lib/config'

export interface CommentItem {
  id: string
  postSlug: string
  content: string
  createdAt: number
  author: {
    name: string
    login?: string
    avatar_url?: string
    isOwner?: boolean
    isLocal?: boolean
  }
}

const COMMENTS_STORAGE_KEY = 'starlog:comments'

function readCommentsStore(): Record<string, CommentItem[]> {
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

function writeCommentsStore(store: Record<string, CommentItem[]>) {
  localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(store))
  window.dispatchEvent(new CustomEvent('starlog:comments-changed'))
}

export function getCommentsForPost(postSlug: string): CommentItem[] {
  const store = readCommentsStore()
  return (store[postSlug] || []).sort((a, b) => a.createdAt - b.createdAt)
}

export function Comments({ postSlug, postTitle: _postTitle }: { postSlug: string; postTitle?: string }) {
  const { isAuthed, ghUser } = useAuth()
  const toast = useToast()

  const [comments, setComments] = useState<CommentItem[]>(() => getCommentsForPost(postSlug))
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState(false)

  const loadComments = useCallback(() => {
    setComments(getCommentsForPost(postSlug))
  }, [postSlug])

  useEffect(() => {
    loadComments()
    const handler = () => loadComments()
    window.addEventListener('starlog:comments-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('starlog:comments-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [loadComments])

  const isOwner = useMemo(() => {
    if (!isAuthed || !ghUser) return false
    return ghUser.login.toLowerCase() === siteConfig.author.name.toLowerCase()
  }, [isAuthed, ghUser])

  const currentAuthor = useMemo(() => {
    if (!isAuthed || !ghUser) return null
    return {
      name: ghUser.name || ghUser.login,
      login: ghUser.login,
      avatar_url: ghUser.avatar_url,
      isOwner: ghUser.login.toLowerCase() === siteConfig.author.name.toLowerCase(),
      isLocal: false,
    }
  }, [isAuthed, ghUser])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) {
      toast('请输入评论内容', 'warning')
      return
    }
    if (!currentAuthor) {
      toast('请先登录后再发表评论', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const newComment: CommentItem = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        postSlug,
        content: trimmed,
        createdAt: Date.now(),
        author: currentAuthor,
      }

      const store = readCommentsStore()
      const list = store[postSlug] || []
      list.push(newComment)
      store[postSlug] = list
      writeCommentsStore(store)

      setContent('')
      setPreview(false)
      loadComments()
      toast('评论发表成功！', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '发表评论失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = (commentId: string) => {
    if (!confirm('确定要删除这条评论吗？')) return
    const store = readCommentsStore()
    const list = store[postSlug] || []
    store[postSlug] = list.filter((c) => c.id !== commentId)
    writeCommentsStore(store)
    loadComments()
    toast('评论已删除', 'info')
  }

  return (
    <section className="no-print mt-16 border-t border-ink-200/60 pt-10 dark:border-white/[0.08]">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight text-ink-900 dark:text-white">
          <MessageSquare size={20} className="text-brand-500" />
          评论 ({comments.length})
        </h2>
      </div>

      {/* 发表评论输入区 */}
      <div className="card mb-8 p-5">
        {isAuthed && currentAuthor ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between border-b border-ink-200/60 pb-3 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                {currentAuthor.avatar_url ? (
                  <img
                    src={currentAuthor.avatar_url}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
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

              <button
                type="button"
                onClick={() => setPreview((v) => !v)}
                className="btn-ghost h-7 !px-2 text-xs"
              >
                {preview ? <PenLine size={13} /> : <Eye size={13} />}
                {preview ? '编辑' : '预览 Markdown'}
              </button>
            </div>

            {preview ? (
              <div className="min-h-[6rem] rounded-xl border border-ink-200/70 bg-ink-50/40 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                {content.trim() ? (
                  <Markdown content={content} />
                ) : (
                  <p className="text-xs text-ink-400">输入内容后在此预览效果…</p>
                )}
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                placeholder="撰写你的评论（支持 Markdown、公式与代码）…"
                className="input resize-y font-mono text-[13.5px]"
                required
              />
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-ink-400">支持 Markdown 与数学公式排版</span>
              <button
                type="submit"
                disabled={submitting || !content.trim()}
                className="btn-primary h-9 px-4 text-xs"
              >
                <Send size={13} />
                {submitting ? '发送中…' : '发表评论'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <User size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">登录后参与评论与讨论</p>
              <p className="mt-1 text-xs text-ink-400">使用 GitHub 账号一键快捷登录</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to="/login" className="btn-primary h-8 px-4 text-xs">
                <Github size={13} />
                使用 GitHub 登录
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* 评论列表 */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200/80 p-10 text-center dark:border-white/10">
            <MessageSquare size={24} className="mx-auto text-ink-300 dark:text-ink-600" />
            <p className="mt-2 text-sm text-ink-500">这篇文章还没有评论，快来发表第一条观点吧！</p>
          </div>
        ) : (
          comments.map((c) => {
            const canDelete =
              isAuthed &&
              (isOwner ||
                (ghUser && c.author.login && c.author.login.toLowerCase() === ghUser.login.toLowerCase()))

            return (
              <div
                key={c.id}
                className="card group animate-fade-up p-4 transition-all hover:border-brand-200/80 dark:hover:border-white/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {c.author.avatar_url ? (
                      <img
                        src={c.author.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-ink-200/80 dark:ring-white/10"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-indigo-600 text-xs font-bold text-white shadow-sm">
                        {c.author.name[0]?.toUpperCase() || 'U'}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink-900 dark:text-white">
                          {c.author.name}
                        </span>
                        {c.author.login && (
                          <span className="text-xs text-ink-400">@{c.author.login}</span>
                        )}
                        {c.author.isOwner && (
                          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
                            站长
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-400">
                        {formatDate(new Date(c.createdAt).toISOString().slice(0, 10))} ·{' '}
                        {relativeTime(c.createdAt)}
                      </p>
                    </div>
                  </div>

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      title="删除评论"
                      className="btn-ghost h-7 w-7 !px-0 opacity-0 group-hover:opacity-100 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                <div className="mt-3 text-[14.5px] leading-relaxed text-ink-700 dark:text-ink-200">
                  <Markdown content={c.content} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
