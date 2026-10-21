import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Github,
  Loader2,
  Lock,
  LogIn,
  Quote,
  RefreshCw,
  Send,
  Sparkles,
  Waves,
} from 'lucide-react'
import { echoCaveConfig } from '../lib/config'
import { OFFLINE } from '../lib/runtime'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { loadEchoCave, postEchoCaveEcho } from '../lib/github'
import type { EchoCaveSnapshot } from '../lib/github'
import {
  BUILTIN_ECHOES,
  ECHO_LIMITS,
  applyEchoRateLimits,
  buildEchoDeck,
  discussionCommentsToEchoes,
  echoFingerprint,
  echoQuota,
  fetchHitokotoBatch,
  isContributorPermission,
  normalizeEchoText,
  shuffleEchoes,
  takeBuiltinEchoes,
} from '../lib/echoCave'
import type { EchoEntry } from '../lib/echoCave'

/** 首次进入时放几张内置牌；用完后每次再补 8 张，30 张都放过了就重排 */
const INITIAL_BUILTIN = 12
const REFILL_BUILTIN = 8
/** 每补一次牌顺带再取几条一言（最多 6 轮，避免无节制地请求接口） */
const MAX_HITOKOTO_ROUNDS = 6

const KIND_LABEL: Record<EchoEntry['kind'], string> = {
  discussion: '留言',
  hitokoto: '一言',
  builtin: '内置',
}

/**
 * 百宝箱 · 回声洞（issue #93）。
 *
 * 内容来自两处：
 *   - **GitHub Discussions**：任何人登录 GitHub 后都能在下方横线上留言，回声作为
 *     同一条讨论的评论保存，可跨设备看到；每人每小时最多 3 条、每天 10 条，
 *     仓库贡献者不受限。
 *   - **hitokoto**：在线版取一言接口；离线版不联网，只用内置句子。
 *
 * 交互：进入页面后轻点卡片（或按「换一句」/→），一句一句往下听；牌堆用完会
 * 自动补内置句并再取几条一言。
 */
export default function EchoCave() {
  const { isAuthed, ghUser, loading: authLoading } = useAuth()
  const toast = useToast()

  const [snapshot, setSnapshot] = useState<EchoCaveSnapshot | null>(null)
  const [echoLoading, setEchoLoading] = useState(false)
  const [echoError, setEchoError] = useState('')
  const [hitokotoEntries, setHitokotoEntries] = useState<EchoEntry[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const [deck, setDeck] = useState<EchoEntry[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  /** 已经进过牌堆的句子（按文本去重） */
  const seenRef = useRef<Set<string>>(new Set())
  const hitokotoRounds = useRef(0)
  const initializedRef = useRef(false)

  /* ------------------------------- 加载来源 ------------------------------- */

  const loadEchoes = useCallback(
    async (quiet = false) => {
      if (OFFLINE || !isAuthed) return
      if (!quiet) setEchoLoading(true)
      setEchoError('')
      try {
        setSnapshot(await loadEchoCave())
      } catch (error) {
        setEchoError(error instanceof Error ? error.message : '读取回声墙失败')
      } finally {
        if (!quiet) setEchoLoading(false)
      }
    },
    [isAuthed],
  )

  useEffect(() => {
    void loadEchoes()
  }, [loadEchoes])

  useEffect(() => {
    let alive = true
    void fetchHitokotoBatch(4).then((entries) => {
      if (alive && entries.length > 0) setHitokotoEntries(entries)
    })
    return () => {
      alive = false
    }
  }, [])

  const allDiscussionEchoes = useMemo(
    () => (snapshot ? discussionCommentsToEchoes(snapshot.comments) : []),
    [snapshot],
  )
  // 「只识别前 N 条」：超出限额的留言仍留在 GitHub 上，但不进回声池
  const displayedDiscussionEchoes = useMemo(
    () => applyEchoRateLimits(allDiscussionEchoes),
    [allDiscussionEchoes],
  )

  /* -------------------------------- 牌堆 -------------------------------- */

  /** 把新条目追加到牌堆并登记去重指纹；重复句子直接跳过 */
  function appendEntries(entries: readonly EchoEntry[]) {
    const fresh: EchoEntry[] = []
    for (const entry of entries) {
      if (!entry.text) continue
      const key = echoFingerprint(entry)
      if (seenRef.current.has(key)) continue
      seenRef.current.add(key)
      fresh.push(entry)
    }
    if (fresh.length > 0) setDeck((prev) => [...prev, ...fresh])
  }

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    const initial = buildEchoDeck({ builtin: takeBuiltinEchoes(new Set(), INITIAL_BUILTIN) })
    initial.forEach((entry) => seenRef.current.add(echoFingerprint(entry)))
    setDeck(initial)
  }, [])

  useEffect(() => {
    appendEntries(hitokotoEntries)
    // appendEntries 只依赖 ref 与 setState，引用在每个渲染里都会重建，
    // 这里刻意只跟着来源列表走（否则会无限追加）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitokotoEntries])

  useEffect(() => {
    appendEntries(displayedDiscussionEchoes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedDiscussionEchoes])

  /** 补一批一言；失败静默（fetchHitokotoBatch 内部不会抛错） */
  function loadMoreHitokoto() {
    if (hitokotoRounds.current >= MAX_HITOKOTO_ROUNDS) return
    hitokotoRounds.current += 1
    void fetchHitokotoBatch(3).then((entries) => {
      if (entries.length > 0) setHitokotoEntries((prev) => [...prev, ...entries])
    })
  }

  /** 点击卡片 / 按「换一句」：没揭开时先揭开，之后一句一句往下走 */
  function showNext() {
    if (!revealed) {
      setRevealed(true)
      return
    }
    if (index + 1 < deck.length) {
      setIndex(index + 1)
      return
    }
    const more = takeBuiltinEchoes(seenRef.current, REFILL_BUILTIN)
    if (more.length > 0) {
      appendEntries(more)
      // 新条目接在当前牌堆末尾，第一次点击直接落在它的第一张上
      setIndex(deck.length)
    } else {
      // 内置句也发完了：把现有牌堆重排，继续循环
      setDeck(shuffleEchoes(deck))
      setIndex(0)
    }
    loadMoreHitokoto()
  }

  const current = revealed ? deck[index] ?? null : null

  /* -------------------------------- 发送 -------------------------------- */

  const contributor = useMemo(() => {
    if (isContributorPermission(snapshot?.viewerPermission)) return true
    const login = ghUser?.login?.toLowerCase()
    if (!login) return false
    return allDiscussionEchoes.some(
      (entry) => entry.authorLogin?.toLowerCase() === login && entry.authorIsContributor,
    )
  }, [snapshot, ghUser, allDiscussionEchoes])

  const quota = useMemo(
    () => echoQuota(allDiscussionEchoes, ghUser?.login, { contributor }),
    [allDiscussionEchoes, ghUser, contributor],
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = normalizeEchoText(input)
    if (!text) {
      toast('写点什么再投进洞里吧', 'warning')
      return
    }
    if (OFFLINE) {
      toast('离线版不会发起任何网络请求：回声洞在这里只能听，不能留', 'warning')
      return
    }
    if (!isAuthed) {
      toast('回声会保存到 GitHub Discussions，请先登录 GitHub', 'info', { label: '去登录', href: '/login' })
      return
    }
    if (!quota.allowed) {
      toast(quota.message, 'warning')
      return
    }
    setSending(true)
    try {
      await postEchoCaveEcho(text, snapshot)
      // 立刻把自己刚发的这句放到牌堆最前面并展示出来，不等下一次刷新
      const mine: EchoEntry = {
        id: `local:${Date.now()}`,
        kind: 'discussion',
        text,
        source: ghUser?.login ? `@${ghUser.login}` : '我',
        authorLogin: ghUser?.login,
        authorIsContributor: contributor,
        createdAt: Date.now(),
      }
      const key = echoFingerprint(mine)
      seenRef.current.add(key)
      setDeck((prev) => [mine, ...prev.filter((entry) => echoFingerprint(entry) !== key)])
      setIndex(0)
      setRevealed(true)
      setInput('')
      toast('回声已经传进洞里了', 'success')
      void loadEchoes(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : '回声没有送出去，请稍后再试', 'error')
    } finally {
      setSending(false)
    }
  }

  async function refreshAll() {
    setRefreshing(true)
    try {
      const hits = await fetchHitokotoBatch(3)
      if (hits.length > 0) setHitokotoEntries((prev) => [...prev, ...hits])
      await loadEchoes(true)
    } finally {
      setRefreshing(false)
    }
  }

  // 可听的总条数：GitHub 留言（已限流过滤）+ 已取到的 hitokoto + 内置句
  const totalEchoes = displayedDiscussionEchoes.length + hitokotoEntries.length + BUILTIN_ECHOES.length

  /* -------------------------------- 渲染 -------------------------------- */

  return (
    <div className="container-page max-w-3xl pt-16" data-yield-list>
      <Link
        to="/treasure"
        className="group inline-flex items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300"
      >
        <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        百宝箱
      </Link>

      <header className="mt-4 animate-fade-up">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-600 dark:text-sky-300">
          <Sparkles size={13} />
          回声洞 · Echo Cave
        </div>
        <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          回声洞
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          轻点下面的卡片，一句一句往下听。洞里的回声来自 hitokoto，也来自在横线上留下过声音的人。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="chip">
            <Waves size={12} />
            可听 {totalEchoes} 句
          </span>
          <span className="chip">
            <Github size={12} />
            GitHub 回声 {displayedDiscussionEchoes.length} 条
          </span>
          <span className="chip">{OFFLINE ? '离线版 · 仅内置句' : 'hitokoto 一言'}</span>
          {snapshot?.discussion && !OFFLINE && (
            <a href={snapshot.discussion.url} target="_blank" rel="noreferrer" className="chip">
              在 GitHub 上查看回声墙
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </header>

      <section className="mt-8" data-yield-list>
        <button
          type="button"
          onClick={showNext}
          aria-label={revealed ? '显示下一句回声' : '显示第一句回声'}
          className="card group relative block w-full overflow-hidden px-6 py-10 text-left transition hover:-translate-y-0.5 hover:border-sky-300 sm:px-10 sm:py-12 dark:hover:border-sky-400/30"
        >
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-400/[0.07] via-transparent to-indigo-400/[0.07] dark:from-sky-400/[0.05] dark:to-indigo-400/[0.06]"
            aria-hidden
          />
          <Quote
            size={120}
            className="pointer-events-none absolute -right-4 -top-4 text-sky-500/[0.06] dark:text-sky-300/[0.05]"
            aria-hidden
          />

          <div className="relative flex min-h-[8.5rem] flex-col justify-center">
            {current ? (
              <p
                key={`${current.id}-${index}`}
                aria-live="polite"
                className="animate-fade-in font-serif text-xl leading-relaxed text-ink-800 sm:text-2xl dark:text-ink-100"
              >
                {current.text}
              </p>
            ) : (
              <div className="text-center">
                <Waves size={30} className="mx-auto text-sky-500/70 dark:text-sky-300/70" />
                <p className="mt-4 font-serif text-lg font-medium text-ink-700 dark:text-ink-200">
                  轻点这里，听听洞里的回声
                </p>
                <p className="mt-1.5 text-sm text-ink-400">来自 hitokoto，也来自每一个路过的人</p>
              </div>
            )}
          </div>

          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-ink-200/60 pt-4 text-xs text-ink-400 dark:border-white/10">
            <span className="inline-flex items-center gap-1.5">
              {current ? (
                <>
                  <span className="rounded-full bg-ink-500/[0.07] px-2 py-0.5 font-medium text-ink-500 dark:bg-white/[0.07] dark:text-ink-300">
                    {KIND_LABEL[current.kind]}
                  </span>
                  <span>— {current.source}</span>
                </>
              ) : (
                <span>回声洞 · Echo Cave</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {revealed ? `第 ${index + 1} 句 · 池中 ${deck.length} 句` : '点击开始'}
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </button>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
          <span>点击卡片、按「换一句」，都可以继续往下听。</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={showNext} className="btn-ghost h-8 gap-1 px-2 text-xs">
              <ArrowRight size={13} />
              换一句
            </button>
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={refreshing}
              className="btn-ghost h-8 gap-1 px-2 text-xs"
            >
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              补充回声
            </button>
          </div>
        </div>

        {echoError && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
            {echoError}
            <button type="button" onClick={() => void loadEchoes()} className="font-medium underline">
              重试
            </button>
          </p>
        )}
      </section>

      <section className="card mt-10 p-5 sm:p-6" data-yield-list>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
            <Send size={16} className="text-sky-500" />
            留下你的回声
          </h2>
          {isAuthed && !OFFLINE && (
            <span className="text-[11px] text-ink-400">
              {quota.contributor
                ? '仓库贡献者不受条数限制'
                : `本小时 ${quota.hourUsed}/${ECHO_LIMITS.perHour} 条 · 今天 ${quota.dayUsed}/${ECHO_LIMITS.perDay} 条`}
            </span>
          )}
        </div>

        <form onSubmit={submit} className="mt-4">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={echoCaveConfig.maxLength}
              disabled={OFFLINE || sending}
              placeholder={
                OFFLINE
                  ? '离线版不会联网，回声洞在这里只能听'
                  : isAuthed
                    ? '写一句想留给洞里的话…'
                    : '登录 GitHub 后，就可以在这里留下回声…'
              }
              aria-label="写下你的回声"
              className="min-w-0 flex-1 border-b-2 border-ink-300/80 bg-transparent px-1 pb-2 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:text-white dark:placeholder:text-ink-500"
            />
            <button
              type="submit"
              disabled={sending || OFFLINE || !input.trim()}
              className="btn-primary h-10 shrink-0 px-4 text-xs"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              发送
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
            <span>
              每人每小时最多 {echoCaveConfig.perHour} 条、每天最多 {echoCaveConfig.perDay} 条，
              超出部分不会被识别；仓库贡献者不受限制。
            </span>
            <span className="font-mono">
              {input.length}/{echoCaveConfig.maxLength}
            </span>
          </div>
        </form>

        {OFFLINE && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-ink-500/[0.05] px-3 py-2.5 text-xs leading-relaxed text-ink-500 dark:bg-white/[0.04] dark:text-ink-400">
            <Lock size={14} className="mt-0.5 shrink-0" />
            离线单文件版按设计完全不联网：这里只会显示内置句子，无法读取或发送 GitHub 上的回声。
            想留言的话，请到线上站点打开这一页。
          </p>
        )}

        {!OFFLINE && !authLoading && !isAuthed && (
          <p className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-brand-500/[0.07] px-3 py-2.5 text-xs text-ink-600 dark:bg-brand-400/10 dark:text-ink-300">
            <Github size={14} className="shrink-0" />
            GitHub Discussions 的读取与发送都需要授权。
            <Link to="/login" className="btn-outline h-7 gap-1 px-2 text-[11px]">
              <LogIn size={12} />
              登录 GitHub
            </Link>
          </p>
        )}

        {!OFFLINE && isAuthed && echoLoading && (
          <p className="mt-4 flex items-center gap-2 text-xs text-ink-400">
            <Loader2 size={13} className="animate-spin" />
            正在读取回声墙…
          </p>
        )}
      </section>
    </div>
  )
}
