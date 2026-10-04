import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Github, Loader2, LogIn, MessageSquare, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { siteConfig } from '../lib/config'
import { formatDate, relativeTime } from '../lib/posts'
import {
  deleteLocalComment,
  deleteRepoComment,
  fetchRepoComments,
  getLocalComments,
  publishRepoComment,
  saveLocalComment,
} from '../lib/comments'
import type { BlogComment } from '../lib/comments'

function Avatar({ comment }: { comment: BlogComment }) {
  if (comment.author.avatar) {
    return <img src={comment.author.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-indigo-600 text-sm font-bold text-white">
      {(comment.author.name[0] || '匿').toUpperCase()}
    </span>
  )
}

export function Comments({ slug }: { slug: string }) {
  const { isAuthed, canPublish, ghUser } = useAuth()
  const toast = useToast()

  const [repoComments, setRepoComments] = useState<BlogComment[] | null>(null)
  const [repoError, setRepoError] = useState('')
  const [localComments, setLocalComments] = useState<BlogComment[]>(() => getLocalComments(slug))
  const [text, setText] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(
    async (force = false) => {
      try {
        setRepoError('')
        const list = await fetchRepoComments(slug, force)
        setRepoComments(list)
      } catch (err) {
        setRepoComments((prev) => prev ?? [])
        setRepoError(err instanceof Error ? err.message : '评论加载失败')
      }
    },
    [slug],
  )

  useEffect(() => {
    setRepoComments(null)
    setLocalComments(getLocalComments(slug))
    void load()
  }, [slug, load])

  const comments = useMemo(
    () => [...(repoComments ?? []), ...localComments].sort((a, b) => a.createdAt - b.createdAt),
    [repoComments, localComments],
  )

  const submit = async () => {
    const value = text.trim()
    if (!value) {
      toast('先写点内容再发表', 'warning')
      return
    }
    setBusy(true)
    try {
      if (canPublish && ghUser) {
        await publishRepoComment(slug, value, ghUser)
        const list = await fetchRepoComments(slug, true)
        setRepoComments(list)
        toast('评论已发布到仓库，所有人可见', 'success')
      } else {
        const saved = saveLocalComment(slug, value, nickname.trim() || siteConfig.author.name)
        setLocalComments((prev) => [...prev, saved])
        toast('评论已保存在本浏览器（连接 GitHub 后可公开发表）', 'info')
      }
      setText('')
    } catch (err) {
      toast(err instanceof Error ? err.message : '发表失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (comment: BlogComment) => {
    setRemoving(comment.id)
    try {
      if (comment.source === 'local') {
        deleteLocalComment(slug, comment.id)
        setLocalComments((prev) => prev.filter((c) => c.id !== comment.id))
        toast('本地评论已删除', 'info')
      } else {
        if (!ghUser) throw new Error('需要先连接 GitHub')
        await deleteRepoComment(slug, comment.id, ghUser)
        setRepoComments((prev) => (prev ?? []).filter((c) => c.id !== comment.id))
        toast('评论已从仓库删除', 'success')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setRemoving(null)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await load(true)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className="no-print mt-14 border-t border-ink-200/60 pt-8 dark:border-white/[0.08]" id="comments">
      <div className="mb-5 flex items-center gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight text-ink-900 dark:text-white">
          <MessageSquare size={18} className="text-brand-500" />
          评论
          <span className="font-mono text-sm font-normal text-ink-400">{comments.length}</span>
        </h2>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="btn-ghost ml-auto h-8 w-8 !px-0"
          title="刷新评论"
          aria-label="刷新评论"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 评论列表 */}
      {repoComments === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
          <Loader2 size={15} className="animate-spin" />
          正在加载评论…
        </div>
      ) : comments.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-400">还没有评论，来抢沙发～</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar comment={c} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-sm font-medium text-ink-900 dark:text-white">{c.author.name}</span>
                  {c.source === 'local' ? (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                      仅本机可见
                    </span>
                  ) : (
                    c.author.login && (
                      <a
                        href={`https://github.com/${c.author.login}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300"
                      >
                        <Github size={11} />@{c.author.login}
                      </a>
                    )
                  )}
                  <time
                    className="text-xs text-ink-400"
                    dateTime={new Date(c.createdAt).toISOString()}
                    title={formatDate(new Date(c.createdAt).toISOString())}
                  >
                    {relativeTime(c.createdAt)}
                  </time>
                  {(c.source === 'local' || (!!ghUser && c.author.login === ghUser.login)) && (
                    <button
                      onClick={() => remove(c)}
                      disabled={removing === c.id}
                      className="ml-auto flex items-center gap-1 text-xs text-ink-300 transition hover:text-rose-500 dark:text-ink-600 dark:hover:text-rose-400"
                      title="删除评论"
                    >
                      {removing === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      删除
                    </button>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                  {c.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {repoError && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">仓库评论加载失败：{repoError}</p>}

      {/* 发表评论：登录后的用户可以评论 */}
      {isAuthed ? (
        <div className="card mt-6 p-4">
          {!ghUser && (
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={`署名（默认：${siteConfig.author.name}）`}
              maxLength={30}
              className="input mb-3 !py-2 text-sm"
            />
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={canPublish ? '友善发言，评论将公开保存到仓库…' : '写评论…（未连接 GitHub，评论只保存在本浏览器）'}
            className="input resize-y !leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={submit} disabled={busy || !text.trim()} className="btn-primary h-9">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
              发表评论
            </button>
            <span className="flex items-center gap-1.5 text-xs text-ink-400">
              {canPublish && ghUser ? (
                <>
                  <Github size={12} className="text-emerald-500" />
                  将以 @{ghUser.login} 的身份公开发表
                </>
              ) : (
                '当前为密码登录，评论仅保存在本浏览器'
              )}
            </span>
            <span className="ml-auto font-mono text-xs text-ink-300 dark:text-ink-600">{text.length}/2000</span>
          </div>
        </div>
      ) : (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-500">登录后即可发表评论。</p>
          <Link to="/login" state={{ from: `/posts/${slug}` }} className="btn-primary h-9">
            <LogIn size={14} />
            去登录
          </Link>
        </div>
      )}
    </section>
  )
}
