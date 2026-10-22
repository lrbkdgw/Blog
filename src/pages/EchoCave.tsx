import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { getRepoTarget } from '../lib/github'
import { useToast } from '../components/Toast'
import {
  ASH_EXIT_STAGE_MS,
  attachEchoAshCanvas,
  type EchoAshController,
} from '../lib/echoAsh'
import {
  createEchoDeck,
  fetchHitokotoOne,
  filterRecognizedEchoes,
  loadEchoCaveSnapshot,
  readPendingEchoDraft,
  submitEchoMessage,
  writePendingEchoDraft,
  type EchoItem,
  type RawEchoComment,
} from '../lib/echoCave'

const TARGET_HITOKOTO_BUFFER = 8
const HITOKOTO_PACE_MS = 380
const INITIAL_SETTLE_MS = 140

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>
}

function splitGraphemes(text: string): string[] {
  const IntlWithSegmenter = (typeof Intl !== 'undefined' ? Intl : undefined) as
    | { Segmenter?: new (locales?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter }
    | undefined
  if (typeof IntlWithSegmenter?.Segmenter === 'function') {
    const seg = new IntlWithSegmenter.Segmenter('zh-CN', { granularity: 'grapheme' })
    return Array.from(seg.segment(text), (part) => part.segment)
  }
  return Array.from(text)
}

function computeStepMs(charCount: number): number {
  if (charCount <= 1) return 26
  return Math.max(22, Math.min(46, Math.round(920 / charCount)))
}

interface EchoDisplayState {
  item: EchoItem | null
  seq: number
  shown: number
  exiting: boolean
}

interface EchoSentenceProps {
  item: EchoItem
  shown: number
}

const EchoSentence = memo(function EchoSentence({ item, shown }: EchoSentenceProps) {
  const graphemes = useMemo(() => splitGraphemes(item.text), [item.text])
  const stepMs = useMemo(() => computeStepMs(graphemes.length), [graphemes.length])
  const allRevealed = graphemes.length > 0 && shown >= graphemes.length

  return (
    <div
      data-echo-sentence
      className="pointer-events-none flex max-w-2xl flex-col items-center text-center"
    >
      <p className="font-serif text-lg leading-loose tracking-wide text-ink-800 sm:text-2xl dark:text-ink-100">
        {graphemes.map((ch, idx) => (
          <span
            key={idx}
            data-char-shown={idx < shown ? 'true' : 'false'}
            style={{ animationDelay: `${idx * stepMs}ms` }}
            className="echo-char inline"
          >
            {ch}
          </span>
        ))}
      </p>
      {item.from && (
        <p
          data-from-shown={allRevealed ? 'true' : 'false'}
          style={{ animationDelay: `${graphemes.length * stepMs + 80}ms` }}
          className="echo-from mt-4 text-xs tracking-wider text-ink-400/75 dark:text-ink-500"
        >
          —— {item.from}
        </p>
      )}
    </div>
  )
})

export default function EchoCave() {
  const navigate = useNavigate()
  const toast = useToast()
  const { isAuthed, ghUser } = useAuth()

  const deckRef = useRef<ReturnType<typeof createEchoDeck> | null>(null)
  if (!deckRef.current) {
    deckRef.current = createEchoDeck()
  }

  // 单一原子状态保存 { item, seq, shown, exiting }：
  // 切换时先将旧句采样化灰退场（item = null, exiting = true），待骨灰消散下场后再挂载新句逐字浮现（shown = 0）
  const [display, setDisplay] = useState<EchoDisplayState>({
    item: null,
    seq: 0,
    shown: 0,
    exiting: false,
  })
  const [draft, setDraft] = useState(() => readPendingEchoDraft())
  const [sending, setSending] = useState(false)

  const displayRef = useRef(display)
  displayRef.current = display

  const sentenceWrapRef = useRef<HTMLDivElement>(null)
  const ashCanvasRef = useRef<HTMLCanvasElement>(null)
  const ashCtrlRef = useRef<EchoAshController | null>(null)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNextRef = useRef<EchoItem | null>(null)

  const discussionNodeIdRef = useRef<string | null>(null)
  const rawCommentsRef = useRef<RawEchoComment[]>([])
  const contributorLoginsRef = useRef<Set<string>>(new Set())
  const autoSentPendingRef = useRef(false)
  const sendingLockRef = useRef(false)
  const pumpingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 挂载全屏骨灰消散粒子画布控制器
  useEffect(() => {
    const canvas = ashCanvasRef.current
    if (!canvas) return
    const ctrl = attachEchoAshCanvas(canvas)
    ashCtrlRef.current = ctrl
    return () => {
      ctrl.destroy()
      ashCtrlRef.current = null
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [])

  // 同步推进 data-char-shown（严格单调 0 -> 1 -> 2 -> ... -> total，仅随 seq 重置，绝不倒退）
  useEffect(() => {
    const targetSeq = display.seq
    const item = displayRef.current.item
    if (!item) return
    const total = splitGraphemes(item.text).length
    if (total === 0) return

    const stepMs = computeStepMs(total)
    let count = 0
    let intervalId: ReturnType<typeof setInterval> | null = null

    const rafId = requestAnimationFrame(() => {
      count = 1
      setDisplay((prev) =>
        prev.seq === targetSeq && prev.item !== null && prev.shown < 1
          ? { ...prev, shown: 1 }
          : prev,
      )
      if (total <= 1) return
      intervalId = setInterval(() => {
        count += 1
        const nextShown = Math.min(total, count)
        setDisplay((prev) =>
          prev.seq === targetSeq && prev.item !== null && prev.shown < nextShown
            ? { ...prev, shown: nextShown }
            : prev,
        )
        if (nextShown >= total && intervalId !== null) {
          clearInterval(intervalId)
          intervalId = null
        }
      }, stepMs)
    })

    return () => {
      cancelAnimationFrame(rafId)
      if (intervalId !== null) {
        clearInterval(intervalId)
      }
    }
  }, [display.seq])

  // 节流串行补充一言缓冲队列，仅静默入队供后续点击读取，绝不中途覆盖屏幕上正在显示的句子
  const pumpHitokotoBuffer = useCallback(
    (signal?: AbortSignal, onFirstItem?: () => void) => {
      if (pumpingRef.current) return
      const deck = deckRef.current!
      if (deck.hitokotoBufferedCount() >= TARGET_HITOKOTO_BUFFER) return

      pumpingRef.current = true
      let notifiedFirst = false
      const run = async () => {
        let consecutiveFailures = 0
        try {
          while (!signal?.aborted && deck.hitokotoBufferedCount() < TARGET_HITOKOTO_BUFFER) {
            const item = await fetchHitokotoOne(signal)
            if (signal?.aborted) break
            if (item) {
              consecutiveFailures = 0
              const added = deck.pushHitokoto(item)
              if (added && !notifiedFirst) {
                notifiedFirst = true
                onFirstItem?.()
              }
            } else {
              consecutiveFailures += 1
              if (consecutiveFailures >= 3) break
            }
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, HITOKOTO_PACE_MS)
              signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(t)
                  resolve()
                },
                { once: true },
              )
            })
          }
        } finally {
          pumpingRef.current = false
        }
      }
      void run()
    },
    [],
  )

  // 核心切换状态机：先将当前句化为骨灰随风消散下场，待舞台净空后再浮现下一句；消散途中再次点击则加速残灰并立即呈上下一句
  const transitionToNext = useCallback(
    (explicitNext?: EchoItem) => {
      const deck = deckRef.current!
      const cur = displayRef.current

      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }

      if (cur.exiting && !explicitNext) {
        ashCtrlRef.current?.accelerate()
        const readyNext = pendingNextRef.current ?? deck.next()
        pendingNextRef.current = null
        setDisplay((prev) => ({
          item: readyNext,
          seq: prev.seq + 1,
          shown: 0,
          exiting: false,
        }))
        return
      }

      const nextItem = explicitNext ?? deck.next(cur.item?.text)
      const reducedMotion =
        typeof window !== 'undefined' &&
        Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

      const sentenceNode = sentenceWrapRef.current?.querySelector<HTMLElement>('[data-echo-sentence]') ?? null
      const particleCount =
        !reducedMotion && cur.item && sentenceNode
          ? (ashCtrlRef.current?.disintegrateFromElement(sentenceNode) ?? 0)
          : 0

      if (particleCount > 0) {
        pendingNextRef.current = nextItem
        setDisplay((prev) => ({
          item: null,
          seq: prev.seq + 1,
          shown: 0,
          exiting: true,
        }))
        exitTimerRef.current = setTimeout(() => {
          exitTimerRef.current = null
          const target = pendingNextRef.current ?? nextItem
          pendingNextRef.current = null
          setDisplay((prev) => ({
            item: target,
            seq: prev.seq + 1,
            shown: 0,
            exiting: false,
          }))
        }, ASH_EXIT_STAGE_MS)
      } else {
        pendingNextRef.current = null
        setDisplay((prev) => ({
          item: nextItem,
          seq: prev.seq + 1,
          shown: 0,
          exiting: false,
        }))
      }
    },
    [],
  )

  const handleAdvance = useCallback(() => {
    const deck = deckRef.current!
    transitionToNext()
    if (deck.hitokotoBufferedCount() < TARGET_HITOKOTO_BUFFER) {
      pumpHitokotoBuffer()
    }
  }, [pumpHitokotoBuffer, transitionToNext])

  const sendMessage = useCallback(
    async (textToSend?: string) => {
      const candidate = (textToSend ?? inputRef.current?.value ?? draft).trim()
      if (!candidate || sendingLockRef.current) return
      sendingLockRef.current = true
      setSending(true)
      try {
        const res = await submitEchoMessage(candidate, {
          knownDiscussionNodeId: discussionNodeIdRef.current,
          currentUserLogin: ghUser?.login ?? null,
        })

        if (res.status === 'needs_auth') {
          toast('请先完成 GitHub 登录，登录后将自动保存到 Discussions', 'info')
          navigate('/login', { state: { from: '/toolbox/echo' } })
          return
        }

        writePendingEchoDraft('')
        setDraft('')
        if (inputRef.current) inputRef.current.value = ''

        rawCommentsRef.current = [...rawCommentsRef.current, res.comment]
        const refreshed = filterRecognizedEchoes(rawCommentsRef.current, {
          contributorLogins: contributorLoginsRef.current,
          repoOwner: getRepoTarget().owner,
        })
        const deck = deckRef.current!
        deck.setDiscussionEchoes(refreshed)

        const mine = refreshed.find((item) => item.id === `discussion-${res.comment.id}`)
        if (mine && res.recognized) {
          deck.markShown(mine)
          transitionToNext(mine)
        } else {
          toast('已写入 Discussions（每小时仅识别前 3 条、每天前 10 条）', 'info')
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : '发送失败，请稍后重试', 'error')
      } finally {
        sendingLockRef.current = false
        setSending(false)
      }
    },
    [draft, ghUser?.login, navigate, toast, transitionToNext],
  )

  // 首次进入页面：最多等待 140ms 让 Discussions / 一言首个响应到位后直接呈现首句；一旦首句呈现，后续异步响应只入队、绝不中途顶替当前句子
  useEffect(() => {
    const controller = new AbortController()
    const deck = deckRef.current!
    let settled = false

    const settleFirstEcho = (preferDiscussionLatest?: EchoItem) => {
      if (settled || controller.signal.aborted) return
      settled = true
      setDisplay((prev) => {
        if (prev.item !== null || prev.exiting) return prev
        if (preferDiscussionLatest) {
          deck.markShown(preferDiscussionLatest)
          return { item: preferDiscussionLatest, seq: prev.seq + 1, shown: 0, exiting: false }
        }
        return { item: deck.next(), seq: prev.seq + 1, shown: 0, exiting: false }
      })
    }

    const fallbackTimer = setTimeout(() => {
      settleFirstEcho()
    }, INITIAL_SETTLE_MS)

    pumpHitokotoBuffer(controller.signal, () => {
      clearTimeout(fallbackTimer)
      settleFirstEcho()
    })

    loadEchoCaveSnapshot()
      .then((snap) => {
        if (controller.signal.aborted) return
        discussionNodeIdRef.current = snap.discussionNodeId
        rawCommentsRef.current = snap.rawComments
        contributorLoginsRef.current = snap.contributorLogins
        deck.setDiscussionEchoes(snap.echoes)

        clearTimeout(fallbackTimer)
        const latest = snap.echoes.length > 0 ? snap.echoes[snap.echoes.length - 1] : undefined
        settleFirstEcho(latest)
      })
      .catch(() => {
        /* 网络不可达时由 fallbackTimer 或已缓冲的一言自然呈现首句 */
      })

    return () => {
      clearTimeout(fallbackTimer)
      controller.abort()
    }
  }, [pumpHitokotoBuffer])

  // 登录跳转返回后自动续发暂存的回声
  useEffect(() => {
    if (!isAuthed || autoSentPendingRef.current) return
    const pending = readPendingEchoDraft().trim()
    if (!pending) return
    autoSentPendingRef.current = true
    void sendMessage(pending)
  }, [isAuthed, sendMessage])

  // 键盘支持：未聚焦输入框时空格/回车切换下一句，Esc 返回上一页
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) {
        if (e.key === 'Escape') {
          inputRef.current?.blur()
        }
        return
      }
      if (e.key === 'Escape') {
        navigate('/toolbox')
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        handleAdvance()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleAdvance, navigate])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void sendMessage(draft)
  }

  return (
    <div
      data-echo-cave-fullscreen
      onClick={handleAdvance}
      className="relative flex h-dvh w-full cursor-pointer select-none flex-col items-center justify-center overflow-hidden bg-transparent px-6 sm:px-12"
    >
      <canvas
        ref={ashCanvasRef}
        data-echo-ash-canvas
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-20 h-full w-full"
      />

      <div ref={sentenceWrapRef} className="pointer-events-none flex items-center justify-center">
        {display.item && <EchoSentence key={display.seq} item={display.item} shown={display.shown} />}
      </div>

      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-7 z-30 mx-auto flex w-full max-w-md items-center gap-2.5 px-6"
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={200}
          aria-label="在回声洞输入内容"
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 border-0 border-b border-ink-400/25 bg-transparent py-1 text-sm text-ink-800 outline-none transition-colors focus:border-ink-600/55 dark:border-white/15 dark:text-ink-100 dark:focus:border-white/40"
        />
        <button
          type="submit"
          disabled={sending}
          aria-label="发送"
          onClick={() => void sendMessage()}
          className="shrink-0 p-1 text-ink-400/80 transition-all duration-200 hover:translate-x-0.5 hover:text-ink-800 disabled:opacity-40 dark:text-ink-500 dark:hover:text-ink-200"
        >
          <ArrowRight size={16} strokeWidth={1.6} />
        </button>
      </form>
    </div>
  )
}
