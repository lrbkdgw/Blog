import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { getRepoTarget } from '../lib/github'
import { useToast } from '../components/Toast'
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

export default function EchoCave() {
  const navigate = useNavigate()
  const toast = useToast()
  const { isAuthed, ghUser } = useAuth()

  const deckRef = useRef<ReturnType<typeof createEchoDeck> | null>(null)
  if (!deckRef.current) {
    deckRef.current = createEchoDeck()
  }

  const [current, setCurrent] = useState<EchoItem>(() => deckRef.current!.next())
  const [turn, setTurn] = useState(0)
  const [visibleChars, setVisibleChars] = useState(0)
  const [draft, setDraft] = useState(() => readPendingEchoDraft())
  const [sending, setSending] = useState(false)

  const discussionNodeIdRef = useRef<string | null>(null)
  const rawCommentsRef = useRef<RawEchoComment[]>([])
  const contributorLoginsRef = useRef<Set<string>>(new Set())
  const userClickedRef = useRef(false)
  const autoSentPendingRef = useRef(false)
  const sendingLockRef = useRef(false)
  const pumpingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const graphemes = useMemo(() => splitGraphemes(current.text), [current.text])
  const allRevealed = visibleChars >= graphemes.length

  // 逐字出现动画：每次切换新句子时从第 1 字依次浮现，整句排好后柔和浮现出处
  useEffect(() => {
    const total = graphemes.length
    if (total === 0) {
      setVisibleChars(0)
      return
    }
    setVisibleChars(1)
    if (total === 1) return

    const stepMs = Math.max(22, Math.min(46, Math.round(920 / total)))
    let shown = 1
    const timer = setInterval(() => {
      shown += 1
      setVisibleChars(shown)
      if (shown >= total) {
        clearInterval(timer)
      }
    }, stepMs)

    return () => clearInterval(timer)
  }, [graphemes, turn])

  // 节流串行补充一言队列，避免瞬间并发请求触发 v1.hitokoto.cn QPS 限流或命中缓存重复
  const pumpHitokotoBuffer = useCallback((signal?: AbortSignal) => {
    if (pumpingRef.current) return
    const deck = deckRef.current!
    if (deck.hitokotoBufferedCount() >= TARGET_HITOKOTO_BUFFER) return

    pumpingRef.current = true
    const run = async () => {
      let consecutiveFailures = 0
      try {
        while (!signal?.aborted && deck.hitokotoBufferedCount() < TARGET_HITOKOTO_BUFFER) {
          const item = await fetchHitokotoOne(signal)
          if (signal?.aborted) break
          if (item) {
            consecutiveFailures = 0
            const added = deck.pushHitokoto(item)
            if (added && !userClickedRef.current) {
              setCurrent((prev) => {
                if (prev.source !== 'builtin') return prev
                const fresh = deck.next(prev.text)
                return fresh
              })
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
  }, [])

  const handleAdvance = useCallback(() => {
    userClickedRef.current = true
    const deck = deckRef.current!
    setCurrent((prev) => deck.next(prev.text))
    setTurn((n) => n + 1)
    if (deck.hitokotoBufferedCount() < TARGET_HITOKOTO_BUFFER) {
      pumpHitokotoBuffer()
    }
  }, [pumpHitokotoBuffer])

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
          userClickedRef.current = true
          deck.markShown(mine)
          setCurrent(mine)
          setTurn((n) => n + 1)
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
    [draft, ghUser?.login, navigate, toast],
  )

  useEffect(() => {
    const controller = new AbortController()
    pumpHitokotoBuffer(controller.signal)

    loadEchoCaveSnapshot()
      .then((snap) => {
        if (controller.signal.aborted) return
        discussionNodeIdRef.current = snap.discussionNodeId
        rawCommentsRef.current = snap.rawComments
        contributorLoginsRef.current = snap.contributorLogins
        const deck = deckRef.current!
        deck.setDiscussionEchoes(snap.echoes)

        if (!userClickedRef.current && snap.echoes.length > 0) {
          setCurrent((prev) => {
            if (prev.source !== 'builtin') return prev
            const latest = snap.echoes[snap.echoes.length - 1]
            deck.markShown(latest)
            return latest
          })
        }
      })
      .catch(() => {
        /* 网络不可达时静默使用一言与内置无重复洗牌语料 */
      })

    return () => controller.abort()
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
      <div
        key={turn}
        className="pointer-events-none flex max-w-2xl flex-col items-center text-center"
      >
        <p className="font-serif text-lg leading-loose tracking-wide text-ink-800 sm:text-2xl dark:text-ink-100">
          {graphemes.map((ch, idx) => (
            <span
              key={idx}
              data-char-shown={idx < visibleChars ? 'true' : 'false'}
              className={`inline transition-opacity duration-200 ease-out ${
                idx < visibleChars ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {ch}
            </span>
          ))}
        </p>
        {current.from && (
          <p
            className={`mt-4 text-xs tracking-wider text-ink-400/75 transition-opacity duration-300 dark:text-ink-500 ${
              allRevealed ? 'opacity-100' : 'opacity-0'
            }`}
          >
            —— {current.from}
          </p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-7 mx-auto flex w-full max-w-md items-center gap-2.5 px-6"
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
