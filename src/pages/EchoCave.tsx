import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getRepoTarget } from '../lib/github'
import { useToast } from '../components/Toast'
import {
  FALLBACK_ECHOES,
  fetchHitokotoOne,
  filterRecognizedEchoes,
  loadEchoCaveSnapshot,
  readPendingEchoDraft,
  submitEchoMessage,
  writePendingEchoDraft,
  type EchoItem,
  type RawEchoComment,
} from '../lib/echoCave'

export default function EchoCave() {
  const navigate = useNavigate()
  const toast = useToast()
  const { isAuthed, ghUser } = useAuth()

  const [current, setCurrent] = useState<EchoItem>(() => FALLBACK_ECHOES[0])
  const [turn, setTurn] = useState(0)
  const [draft, setDraft] = useState(() => readPendingEchoDraft())
  const [sending, setSending] = useState(false)

  const discussionNodeIdRef = useRef<string | null>(null)
  const rawCommentsRef = useRef<RawEchoComment[]>([])
  const contributorLoginsRef = useRef<Set<string>>(new Set())
  const discussionEchoesRef = useRef<EchoItem[]>([])
  const discussionDeckRef = useRef<EchoItem[]>([])
  const hitokotoQueueRef = useRef<EchoItem[]>([])
  const hitokotoInFlightRef = useRef(0)
  const userClickedRef = useRef(false)
  const autoSentPendingRef = useRef(false)
  const sendingLockRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const refillHitokotoQueue = useCallback((count = 4, signal?: AbortSignal) => {
    const needed = Math.max(0, count - hitokotoInFlightRef.current)
    if (needed === 0) return
    hitokotoInFlightRef.current += needed
    for (let i = 0; i < needed; i++) {
      fetchHitokotoOne(signal)
        .then((item) => {
          if (!item) return
          hitokotoQueueRef.current.push(item)
          // 首次挂载尚未点击且当前仍是占位语时，立即替换为真实获取的内容
          if (!userClickedRef.current) {
            setCurrent((prev) => {
              if (prev.source !== 'builtin') return prev
              const next = hitokotoQueueRef.current.shift() ?? item
              return next
            })
          }
        })
        .finally(() => {
          hitokotoInFlightRef.current = Math.max(0, hitokotoInFlightRef.current - 1)
        })
    }
  }, [])

  const pullNextDiscussionEcho = useCallback((excludeText?: string): EchoItem | null => {
    const pool = discussionEchoesRef.current
    if (pool.length === 0) return null
    if (discussionDeckRef.current.length === 0) {
      // 洗牌袋：确保每轮所有已识别的回声都能均匀出现
      const copy = [...pool]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      discussionDeckRef.current = copy
    }
    const idx = discussionDeckRef.current.findIndex((item) => item.text !== excludeText)
    if (idx >= 0) {
      const [picked] = discussionDeckRef.current.splice(idx, 1)
      return picked
    }
    return discussionDeckRef.current.shift() ?? null
  }, [])

  const pickNextEcho = useCallback(
    (excludeText?: string): EchoItem => {
      const hasDiscussions = discussionEchoesRef.current.length > 0
      const hasHitokoto = hitokotoQueueRef.current.length > 0

      if (hitokotoQueueRef.current.length < 4) {
        refillHitokotoQueue(4)
      }

      // 同时存在 Discussions 回声与一言时交替混合抽取
      if (hasDiscussions && hasHitokoto) {
        const preferDiscussion = Math.random() < 0.45
        if (preferDiscussion) {
          const disc = pullNextDiscussionEcho(excludeText)
          if (disc) return disc
        }
        const hIdx = hitokotoQueueRef.current.findIndex((h) => h.text !== excludeText)
        if (hIdx >= 0) {
          const [picked] = hitokotoQueueRef.current.splice(hIdx, 1)
          return picked
        }
      }

      if (hasDiscussions) {
        const disc = pullNextDiscussionEcho(excludeText)
        if (disc) return disc
      }

      if (hasHitokoto) {
        const hIdx = hitokotoQueueRef.current.findIndex((h) => h.text !== excludeText)
        const [picked] =
          hIdx >= 0
            ? hitokotoQueueRef.current.splice(hIdx, 1)
            : hitokotoQueueRef.current.splice(0, 1)
        if (picked) return picked
      }

      const candidates = FALLBACK_ECHOES.filter((item) => item.text !== excludeText)
      const list = candidates.length > 0 ? candidates : FALLBACK_ECHOES
      return list[Math.floor(Math.random() * list.length)]
    },
    [pullNextDiscussionEcho, refillHitokotoQueue],
  )

  const handleAdvance = useCallback(() => {
    userClickedRef.current = true
    setCurrent((prev) => pickNextEcho(prev.text))
    setTurn((n) => n + 1)
  }, [pickNextEcho])

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
        discussionEchoesRef.current = refreshed
        discussionDeckRef.current = []

        const mine = refreshed.find((item) => item.id === `discussion-${res.comment.id}`)
        if (mine && res.recognized) {
          userClickedRef.current = true
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
    refillHitokotoQueue(5, controller.signal)

    loadEchoCaveSnapshot()
      .then((snap) => {
        if (controller.signal.aborted) return
        discussionNodeIdRef.current = snap.discussionNodeId
        rawCommentsRef.current = snap.rawComments
        contributorLoginsRef.current = snap.contributorLogins
        discussionEchoesRef.current = snap.echoes
        discussionDeckRef.current = []

        if (!userClickedRef.current && snap.echoes.length > 0) {
          setCurrent((prev) => {
            if (prev.source !== 'builtin') return prev
            return snap.echoes[snap.echoes.length - 1]
          })
        }
      })
      .catch(() => {
        /* 网络不可达时静默退回一言与内置回声 */
      })

    return () => controller.abort()
  }, [refillHitokotoQueue])

  // 登录跳转返回后自动续发暂存的回声
  useEffect(() => {
    if (!isAuthed || autoSentPendingRef.current) return
    const pending = readPendingEchoDraft().trim()
    if (!pending) return
    autoSentPendingRef.current = true
    void sendMessage(pending)
  }, [isAuthed, sendMessage])

  // 键盘支持：空格切换下一句（未聚焦输入框时），Esc 返回上一页
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
      className="relative flex h-dvh w-full cursor-pointer select-none flex-col items-center justify-center overflow-hidden px-6 sm:px-12"
    >
      <div
        key={turn}
        className="pointer-events-none flex max-w-2xl animate-fade-up flex-col items-center text-center"
      >
        <p className="font-serif text-lg leading-loose tracking-wide text-ink-800 sm:text-2xl dark:text-ink-100">
          {current.text}
        </p>
        {current.from && (
          <p className="mt-4 text-xs tracking-wider text-ink-400/75 dark:text-ink-500">
            —— {current.from}
          </p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-7 mx-auto flex w-full max-w-md items-center gap-3 px-6"
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
          onClick={() => void sendMessage()}
          className="shrink-0 text-xs tracking-widest text-ink-400/80 transition-colors hover:text-ink-800 disabled:opacity-40 dark:text-ink-500 dark:hover:text-ink-200"
        >
          发送
        </button>
      </form>
    </div>
  )
}
