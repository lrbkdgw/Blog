import { useCallback, useEffect, useState } from 'react'
import { Github, Loader2, MessageCircle, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { addPostComment, fetchPostComments } from '../lib/github'
import type { GithubComment } from '../lib/github'
import { useToast } from './Toast'

export function Comments({ slug, title }: { slug: string; title: string }) {
  const { isAuthed, canPublish } = useAuth()
  const toast = useToast()
  const [comments, setComments] = useState<GithubComment[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setComments(await fetchPostComments(slug))
    } catch (error) {
      toast(error instanceof Error ? error.message : '评论加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [slug, toast])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const comment = await addPostComment(slug, title, body)
      setComments((current) => [...current, comment])
      setText('')
      toast('评论已发布', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '评论发布失败', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="no-print mt-12 border-t border-ink-200/70 pt-8 dark:border-white/10" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="flex items-center gap-2 font-serif text-xl font-semibold text-ink-900 dark:text-white">
        <MessageCircle size={19} />
        评论 <span className="font-sans text-sm font-normal text-ink-400">{comments.length}</span>
      </h2>

      {loading ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-ink-400"><Loader2 size={15} className="animate-spin" />正在加载评论…</p>
      ) : comments.length === 0 ? (
        <p className="mt-5 text-sm text-ink-400">还没有评论，来留下第一条吧。</p>
      ) : (
        <div className="mt-5 space-y-4">
          {comments.map((comment) => (
            <article key={comment.id} className="rounded-xl border border-ink-200/70 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[.025]">
              <header className="flex items-center gap-2">
                <img src={comment.user.avatar_url} alt="" className="h-7 w-7 rounded-full" loading="lazy" />
                <a href={comment.user.html_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink-800 hover:text-brand-600 dark:text-ink-100">
                  @{comment.user.login}
                </a>
                <time className="ml-auto text-xs text-ink-400" dateTime={comment.created_at}>
                  {new Date(comment.created_at).toLocaleString('zh-CN')}
                </time>
              </header>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-700 dark:text-ink-200">{comment.body}</p>
            </article>
          ))}
        </div>
      )}

      {canPublish ? (
        <form onSubmit={submit} className="mt-6">
          <label htmlFor="new-comment" className="mb-2 block text-sm font-medium text-ink-700 dark:text-ink-200">发表评论</label>
          <textarea id="new-comment" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={4} className="input resize-y" placeholder="友善交流，写下你的想法…" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-400">评论将保存到本站 GitHub 仓库的 Issue 中。</span>
            <button type="submit" disabled={!text.trim() || sending} className="btn-primary h-9">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              发布
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-6 rounded-xl border border-ink-200/70 bg-ink-50/60 p-4 text-sm text-ink-500 dark:border-white/10 dark:bg-white/[.025]">
          {isAuthed ? '请先在设置中连接 GitHub，之后即可评论。' : '登录 GitHub 后即可发表评论。'}
          <Link to={isAuthed ? '/settings' : '/login'} className="ml-2 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-300">
            <Github size={13} />{isAuthed ? '前往设置' : '登录'}
          </Link>
        </div>
      )}
    </section>
  )
}
