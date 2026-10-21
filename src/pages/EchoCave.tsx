import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Github,
  HardDrive,
  Loader2,
  LogIn,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  Waves,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { OFFLINE, hasNetwork } from '../lib/runtime'
import { relativeTime } from '../lib/posts'
import {
  addEchoCaveEntry,
  checkIsRepoContributor,
  createEchoCaveDiscussion,
  getRepoTarget,
  loadEchoCaveEntries,
} from '../lib/github'
import type { BlogDiscussionComment, BlogDiscussionThread } from '../lib/github'
import {
  appendLocalEcho,
  builtinEchoEntries,
  drawFromEchoBag,
  ECHO_MAX_LENGTH,
  fetchHitokoto,
  filterRecognizedEchoes,
  getEchoSendQuota,
  isRateLimitExemptAssociation,
  normalizeEchoText,
  readLocalEchoes,
  shouldFetchHitokoto,
  toEchoPlainText,
} from '../lib/echoCave'
import type { EchoEntry } from '../lib/echoCave'

/**
 * 百宝箱 · 回声洞（issue #93）。
 *
 * 玩法：点一下洞壁（或按钮），就传回下一声回响。声音来自两个地方——访客存在
 * GitHub Discussions 固定帖里的留言（需 GitHub 登录才能经 GraphQL 读取，与
 * 评论区一致），以及 hitokoto 一言（无需登录）。页面下方的横线上写一句话发送，
 * 就会成为 Discussions 里的一条新评论。
 *
 * 频率限制：非仓库贡献者每小时只识别前 3 条、每天只识别前 10 条。展示前统一
 * 用 `filterRecognizedEchoes` 过滤，所以绕过本站刷屏也不会被听到；发送时再按
 * 同一口径提前检查额度。仓库贡献者（所有者 / 协作者 / 有提交记录者）不受限。
 *
 * 离线版不联网：不读 Discussions、不调一言，只回响本机保存的句子与内置句。
 */

interface DiscussionRepository {
  repositoryId: string
  categoryId: string
}

type RemoteStatus = 'loading' | 'ready' | 'error' | 'anonymous' | 'offline'

function toEchoEntry(comment: BlogDiscussionComment): EchoEntry | null {
  const text = toEchoPlainText(comment.body)
  if (!text) return null
  return {
    id: comment.id,
    text,
    source: 'discussion',
    createdAt: Date.parse(comment.createdAt) || 0,
    authorLogin: comment.author?.login || 'ghost',
    authorAvatarUrl: comment.author?.avatarUrl,
    authorAssociation: comment.authorAssociation,
    url: comment.url,
    hidden: !!comment.isMinimized,
  }
}

const SOURCE_LABEL: Record<EchoEntry['source'], string> = {
  discussion: '访客回声',
  hitokoto: 'hitokoto 一言',
  local: '本机回声',
  builtin: '洞中旧声',
}

export default function EchoCave() {
  const { isAuthed, ghUser, loading: authLoading } = useAuth()
  const toast = useToast()

  /** 讨论帖里读到的全部原始回声（未做频率过滤）；离线版里装的是本机回声 */
  const [rawEntries, setRawEntries] = useState<EchoEntry[]>([])
  const [discussion, setDiscussion] = useState<BlogDiscussionThread | null>(null)
  const [repository, setRepository] = useState<DiscussionRepository | null>(null)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>(OFFLINE ? 'offline' : 'loading')
  const [remoteError, setRemoteError] = useState('')
  const [isContributor, setIsContributor] = useState(false)

  const [current, setCurrent] = useState<EchoEntry | null>(null)
  const [shownCount, setShownCount] = useState(0)
  const [listening, setListening] = useState(false)
  const [hitokotoFailed, setHitokotoFailed] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const loadSeq = useRef(0)
  const shownCountRef = useRef(0)
  const currentIdRef = useRef<string | null>(null)
  const bagRef = useRef<EchoEntry[]>([])
  const builtinBagRef = useRef<EchoEntry[]>([])
  const listeningRef = useRef(false)
  const hitokotoBufferRef = useRef<Promise<EchoEntry> | null>(null)

  const repoOwner = useMemo(() => getRepoTarget().owner, [])
  const builtinPool = useMemo(() => builtinEchoEntries(), [])

  /** 当前用户是否免于频率限制：贡献者检查，或其已有回声自带贡献者身份标记 */
  const exemptCurrentUser = useMemo(() => {
    if (!ghUser) return false
    if (isContributor) return true
    if (ghUser.login.toLowerCase() === repoOwner.toLowerCase()) return true
    return rawEntries.some(
      (entry) =>
        entry.authorLogin?.toLowerCase() === ghUser.login.toLowerCase() &&
        isRateLimitExemptAssociation(entry.authorAssociation),
    )
  }, [ghUser, isContributor, rawEntries, repoOwner])

  /** 能被听到的访客回声池：线上按频率规则识别；离线版本机回声不做限制 */
  const pool = useMemo(() => {
    if (OFFLINE) return rawEntries
    return filterRecognizedEchoes(rawEntries, {
      ownerLogin: repoOwner,
      // 本人刚发出的乐观回声还没带上 GitHub 的身份标记，用贡献者名单补上豁免
      exemptLogins: exemptCurrentUser && ghUser ? [ghUser.login] : [],
    })
  }, [rawEntries, repoOwner, exemptCurrentUser, ghUser])
  const poolRef = useRef<EchoEntry[]>(pool)
  useEffect(() => {
    poolRef.current = pool
    // 池子变了（首次加载完成 / 自己留了新声）就重新洗一袋
    bagRef.current = []
  }, [pool])

  const quota = useMemo(
    () =>
      ghUser && !OFFLINE
        ? getEchoSendQuota(rawEntries, ghUser.login, exemptCurrentUser)
        : null,
    [rawEntries, ghUser, exemptCurrentUser],
  )

  /* ------------------------------ 数据加载 ------------------------------ */

  const loadRemote = useCallback(async () => {
    if (OFFLINE) return
    const seq = ++loadSeq.current
    setRemoteStatus('loading')
    setRemoteError('')
    try {
      const result = await loadEchoCaveEntries()
      if (loadSeq.current !== seq) return
      setRepository({ repositoryId: result.repositoryId, categoryId: result.categoryId })
      setDiscussion(result.discussion)
      setRawEntries(
        result.comments
          .map(toEchoEntry)
          .filter((entry): entry is EchoEntry => entry !== null),
      )
      setRemoteStatus('ready')
    } catch (error) {
      if (loadSeq.current !== seq) return
      setRemoteStatus('error')
      setRemoteError(error instanceof Error ? error.message : '加载 GitHub Discussions 回声失败')
    }
  }, [])

  useEffect(() => {
    if (OFFLINE) {
      setRawEntries(readLocalEchoes())
      setRemoteStatus('offline')
      return
    }
    if (authLoading) return
    if (!isAuthed) {
      loadSeq.current += 1
      setRawEntries([])
      setDiscussion(null)
      setRepository(null)
      setRemoteStatus('anonymous')
      return
    }
    void loadRemote()
  }, [authLoading, isAuthed, loadRemote])

  useEffect(() => {
    if (OFFLINE || !isAuthed || !ghUser) {
      setIsContributor(false)
      return
    }
    let alive = true
    void checkIsRepoContributor(ghUser.login).then((value) => {
      if (alive) setIsContributor(value)
    })
    return () => {
      alive = false
    }
  }, [isAuthed, ghUser])

  /* --------------------------- hitokoto 预取 ---------------------------- */

  const startHitokotoBuffer = useCallback(() => {
    if (OFFLINE || !hasNetwork() || hitokotoBufferRef.current) return
    const promise = fetchHitokoto()
    // 预取阶段先吞掉拒绝，避免还没被 await 就报未处理异常；真正取时仍会抛错走兜底
    promise.catch(() => undefined)
    hitokotoBufferRef.current = promise
  }, [])

  useEffect(() => {
    startHitokotoBuffer()
  }, [startHitokotoBuffer])

  const takeHitokoto = useCallback(async (): Promise<EchoEntry> => {
    startHitokotoBuffer()
    const pending = hitokotoBufferRef.current
    if (!pending) throw new Error('一言暂时不可用')
    hitokotoBufferRef.current = null
    try {
      const entry = await pending
      startHitokotoBuffer()
      return entry
    } catch (error) {
      // 失败后不立刻重试预取，等下一次点击再说，避免断网时空转请求
      throw error
    }
  }, [startHitokotoBuffer])

  /* ------------------------------ 听下一声 ------------------------------ */

  const present = useCallback((entry: EchoEntry) => {
    currentIdRef.current = entry.id
    shownCountRef.current += 1
    setShownCount(shownCountRef.current)
    setCurrent(entry)
  }, [])

  const drawFromPool = useCallback((): EchoEntry | null => {
    const drawn = drawFromEchoBag(poolRef.current, bagRef.current, currentIdRef.current)
    bagRef.current = drawn.bag
    return drawn.entry
  }, [])

  const drawBuiltin = useCallback((): EchoEntry => {
    const drawn = drawFromEchoBag(builtinPool, builtinBagRef.current, currentIdRef.current)
    builtinBagRef.current = drawn.bag
    return drawn.entry ?? builtinPool[0]
  }, [builtinPool])

  const listenNext = useCallback(async () => {
    if (listeningRef.current) return
    const nextIndex = shownCountRef.current
    const poolSize = poolRef.current.length
    const wantHitokoto = !OFFLINE && shouldFetchHitokoto(nextIndex, poolSize)

    if (wantHitokoto) {
      listeningRef.current = true
      setListening(true)
      try {
        present(await takeHitokoto())
        setHitokotoFailed(false)
        return
      } catch {
        setHitokotoFailed(true)
        // 一言取不到时改听洞里已有的声音，绝不让点击落空
        present(drawFromPool() ?? drawBuiltin())
        return
      } finally {
        listeningRef.current = false
        setListening(false)
      }
    }
    present(drawFromPool() ?? drawBuiltin())
  }, [drawBuiltin, drawFromPool, present, takeHitokoto])

  /* ------------------------------ 留下一声 ------------------------------ */

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault()
    const text = normalizeEchoText(draft)
    if (!text) {
      toast('先在横线上写一句话再发送', 'warning')
      return
    }
    if (text.length > ECHO_MAX_LENGTH) {
      toast(`一声回响最多 ${ECHO_MAX_LENGTH} 字，请再精简一点`, 'warning')
      return
    }

    if (OFFLINE) {
      try {
        const entries = appendLocalEcho(text)
        setRawEntries(entries)
        setDraft('')
        const mine = entries[entries.length - 1]
        if (mine) present(mine)
        toast('已留在本机洞中（离线版回声不会上传 GitHub）', 'success')
      } catch (error) {
        toast(error instanceof Error ? error.message : '保存失败：本机存储可能已满', 'error')
      }
      return
    }

    if (!isAuthed || !ghUser) {
      toast('请先使用 GitHub 登录后再留声', 'warning')
      return
    }
    if (quota && !quota.canSend) {
      toast(
        quota.blockedBy === 'hour'
          ? `这一小时已经留了 ${quota.hourLimit} 声，再发的不会被回声洞识别，请下个整点后再来`
          : `今天已经留了 ${quota.dayLimit} 声，再发的不会被回声洞识别，请明天再来`,
        'warning',
      )
      return
    }
    if (!repository) {
      toast(remoteError || '回声洞还在连接 GitHub Discussions，请稍后再试', 'warning')
      return
    }

    setSending(true)
    try {
      let targetDiscussion = discussion
      if (!targetDiscussion) {
        targetDiscussion = await createEchoCaveDiscussion(
          repository.repositoryId,
          repository.categoryId,
        )
        setDiscussion(targetDiscussion)
      }
      const comment = await addEchoCaveEntry(targetDiscussion.id, text)
      const mine: EchoEntry = {
        id: comment.id,
        text,
        source: 'discussion',
        createdAt: Date.now(),
        authorLogin: ghUser.login,
        authorAvatarUrl: ghUser.avatar_url,
        url: comment.url,
      }
      // 直接把新回声合并进本地列表（id / 地址都是突变接口返回的真实值），不必整表重拉
      setRawEntries((prev) => (prev.some((entry) => entry.id === mine.id) ? prev : [...prev, mine]))
      setDraft('')
      present(mine)
      toast('你的回声已保存到 GitHub Discussions，会被后来的人听到', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '发送回声失败', 'error')
    } finally {
      setSending(false)
    }
  }

  /* -------------------------------- 渲染 -------------------------------- */

  const poolNote = (() => {
    switch (remoteStatus) {
      case 'ready':
        return pool.length > 0
          ? `洞里共收到 ${rawEntries.filter((e) => !e.hidden).length} 声，按频率规则识别出 ${pool.length} 声在回响`
          : '洞里还没有访客留下的回声，你可以成为第一声；现在听到的是 hitokoto 一言'
      case 'anonymous':
        return '未登录时先听 hitokoto 一言；用 GitHub 登录后还能听到访客们留在 Discussions 里的回声'
      case 'error':
        return '访客回声暂时搬不过来，先听 hitokoto 一言'
      case 'offline':
        return rawEntries.length > 0
          ? `本机洞中保存了 ${rawEntries.length} 声（仅此设备可见）`
          : '本机还没留下任何回声，现在听到的是洞中旧声'
      default:
        return '正在去 GitHub Discussions 把回声搬回来…'
    }
  })()

  const sendDisabled =
    sending ||
    !normalizeEchoText(draft) ||
    (!OFFLINE && (!isAuthed || !repository)) ||
    (quota !== null && !quota.canSend)

  return (
    <div className="container-page max-w-4xl pt-16" data-yield-list>
      <Link
        to="/toolbox"
        className="group mb-6 inline-flex animate-fade-up items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300"
      >
        <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        回到百宝箱
      </Link>

      <header className="animate-fade-up" style={{ animationDelay: '40ms' }}>
        <h1 className="flex items-center gap-2.5 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          <Waves size={30} className="text-brand-500" />
          回声洞
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          轻敲石壁，就会传回一句随机的话——可能是某位访客留在这里的，也可能来自 hitokoto
          一言。在最下面的横线上留一句，它就会住进这个洞里。
        </p>
      </header>

      {/* 洞口：点任意处听下一声 */}
      <section
        className="card relative mt-8 animate-fade-up overflow-hidden px-6 py-10 sm:px-10"
        style={{ animationDelay: '80ms' }}
        data-yield-list
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={current ? '再听一声回响' : '听第一声回响'}
          onClick={() => void listenNext()}
          onKeyDown={(event) => {
            // 焦点在内部的 GitHub 链接上时不要抢它的回车，只响应洞壁本身的按键
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              void listenNext()
            }
          }}
          className="relative flex min-h-[13rem] cursor-pointer select-none flex-col items-center justify-center rounded-2xl text-center outline-none transition focus-visible:ring-4 focus-visible:ring-brand-500/25"
        >
          {/* 声波涟漪（纯装饰，样式见 styles/index.css 的 .echo-ring） */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="echo-ring" />
            <span className="echo-ring echo-ring-delay-1" />
            <span className="echo-ring echo-ring-delay-2" />
          </div>

          <div aria-live="polite" className="relative max-w-2xl px-2">
            {current ? (
              <div key={`${current.id}-${shownCount}`} className="animate-fade-up">
                <blockquote className="font-serif text-2xl font-bold leading-relaxed tracking-tight text-ink-900 sm:text-[2rem] dark:text-white">
                  「{current.text}」
                </blockquote>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-ink-400">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-600 dark:text-brand-300">
                    {current.source === 'hitokoto' ? <Sparkles size={11} /> : <Volume2 size={11} />}
                    {SOURCE_LABEL[current.source]}
                  </span>
                  {current.source === 'discussion' && (
                    <span className="inline-flex items-center gap-1.5">
                      {current.authorAvatarUrl && (
                        <img src={current.authorAvatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                      )}
                      @{current.authorLogin}
                      {isRateLimitExemptAssociation(current.authorAssociation) && (
                        <span className="rounded-full bg-ink-500/10 px-1.5 py-px text-[10px]">贡献者</span>
                      )}
                      {current.createdAt > 0 && <span>· {relativeTime(current.createdAt)}</span>}
                      {current.url && (
                        <a
                          href={current.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline dark:text-brand-300"
                        >
                          在 GitHub 查看
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </span>
                  )}
                  {current.source === 'hitokoto' && current.attribution && (
                    <span>—— {current.attribution}</span>
                  )}
                  {current.source === 'local' && current.createdAt > 0 && (
                    <span>{relativeTime(current.createdAt)}留在这台设备上</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="animate-fade-in">
                <Waves size={34} className="mx-auto text-brand-400" />
                <p className="mt-4 font-serif text-xl font-bold text-ink-900 dark:text-white">
                  山洞静悄悄的
                </p>
                <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
                  点一下洞壁，听第一声回响
                </p>
              </div>
            )}
          </div>

          {listening && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 text-xs text-ink-400">
              <Loader2 size={13} className="animate-spin" />
              远处传来声音…
            </span>
          )}
        </div>

        <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => void listenNext()} disabled={listening} className="btn-primary h-10 px-5">
            {listening ? <Loader2 size={15} className="animate-spin" /> : <Volume2 size={15} />}
            {current ? '再听一声' : '听一声回响'}
          </button>
          <span className="text-xs text-ink-400">
            点击洞壁任意处也可以继续{shownCount > 0 ? ` · 已听 ${shownCount} 声` : ''}
          </span>
          {!OFFLINE && isAuthed && (
            <button
              type="button"
              onClick={() => void loadRemote()}
              disabled={remoteStatus === 'loading'}
              title="重新加载 GitHub Discussions 里的回声"
              className="btn-ghost h-8 px-2.5 text-xs"
            >
              <RefreshCw size={13} className={remoteStatus === 'loading' ? 'animate-spin' : ''} />
              刷新回声
            </button>
          )}
          {discussion && (
            <a
              href={discussion.url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost h-8 px-2.5 text-xs"
              title="在 GitHub Discussions 中打开回声洞帖子"
            >
              <Github size={13} />
              Discussions
              <ExternalLink size={11} />
            </a>
          )}
        </div>

        <p className="relative mt-4 text-center text-xs text-ink-400">{poolNote}</p>
        {hitokotoFailed && !OFFLINE && (
          <p className="relative mt-1 text-center text-xs text-amber-600 dark:text-amber-300">
            hitokoto 一言暂时取不到，已自动改听洞里已有的声音
          </p>
        )}
      </section>

      {remoteStatus === 'error' && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-rose-300/50 bg-rose-50/70 p-4 dark:border-rose-400/20 dark:bg-rose-500/10" data-yield-list>
          <div className="text-sm text-rose-700 dark:text-rose-200">
            <p className="font-semibold">访客回声加载失败</p>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{remoteError}</p>
          </div>
          <button type="button" onClick={() => void loadRemote()} className="btn-ghost h-8 shrink-0 px-2 text-xs">
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      )}

      {/* 页面下方横线上的留言 */}
      <section className="card mt-6 animate-fade-up p-6" style={{ animationDelay: '120ms' }} data-yield-list>
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold tracking-tight text-ink-900 dark:text-white">
          <Send size={17} className="text-brand-500" />
          留下一声回响
        </h2>

        {!OFFLINE && !authLoading && !isAuthed ? (
          <div className="mt-4 flex flex-col items-center gap-3 py-2 text-center">
            <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
              回声会公开保存到 GitHub Discussions，需要先用 GitHub 账号登录。
              <br className="hidden sm:block" />
              未登录也可以一直听 hitokoto 一言。
            </p>
            <Link to="/login" className="btn-primary h-9 px-4 text-sm">
              <LogIn size={14} />
              使用 GitHub 登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSend} className="mt-4">
            <div className="flex items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">写一句想留在洞里的话</span>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={ECHO_MAX_LENGTH}
                  placeholder="把想留给后来人的话写在这条线上…"
                  disabled={!OFFLINE && authLoading}
                  className="echo-line-input"
                />
              </label>
              <button type="submit" disabled={sendDisabled} className="btn-primary h-10 shrink-0 px-4">
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-400">
              <span>
                {OFFLINE ? (
                  <span className="inline-flex items-center gap-1">
                    <HardDrive size={12} />
                    离线版：回声只保存在这台设备，不会上传
                  </span>
                ) : quota ? (
                  quota.exempt ? (
                    '你是仓库贡献者，留声不受条数限制'
                  ) : (
                    <>
                      本小时已留 {quota.hourCount}/{quota.hourLimit} 声 · 今天已留 {quota.dayCount}/
                      {quota.dayLimit} 声（超出部分不会被识别）
                      {!quota.canSend && (
                        <span className="ml-1 font-medium text-amber-600 dark:text-amber-300">
                          {quota.blockedBy === 'hour' ? '——下个整点后再来' : '——明天再来'}
                        </span>
                      )}
                    </>
                  )
                ) : (
                  '回声将公开保存到 GitHub Discussions'
                )}
              </span>
              <span className="font-mono">
                {normalizeEchoText(draft).length}/{ECHO_MAX_LENGTH}
              </span>
            </div>
          </form>
        )}
      </section>

      {/* 规则说明 */}
      <div className="mt-6 grid animate-fade-up gap-4 sm:grid-cols-3" style={{ animationDelay: '160ms' }} data-yield-list>
        {[
          {
            icon: Sparkles,
            title: '声音从哪来',
            text: OFFLINE
              ? '离线版只回响本机保存的句子与内置的「洞中旧声」，不发起任何网络请求。'
              : '一部分是访客们保存在 GitHub Discussions 里的回声，另一部分是 hitokoto 一言；点下去不断切换，尽量不重复。',
          },
          {
            icon: Clock,
            title: '每小时 3 声，每天 10 声',
            text: '每位非仓库贡献者每个自然时只识别最先发出的 3 条、每个自然日只识别最先发出的 10 条，多的不会被听到；仓库贡献者不受限制。',
          },
          {
            icon: ShieldCheck,
            title: '不当内容会被收走',
            text: '维护者可以在 GitHub Discussions 里最小化隐藏或删除不当回声，被隐藏的内容不会出现在洞里。',
          },
        ].map((item) => (
          <div key={item.title} className="card p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900 dark:text-white">
              <item.icon size={15} className="text-brand-500" />
              {item.title}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
