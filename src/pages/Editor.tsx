import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Archive, 
  AlertCircle,
  Axis3d,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Columns2,
  Download,
  Eye,
  GitPullRequest,
  Github,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Network,
  Omega,
  LogIn,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Pencil,
  Quote,
  HardDrive,
  Save,
  Sigma,
  SlidersHorizontal,
  Strikethrough,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import { LatexPicker } from '../components/LatexPicker'
import { PasswordPrompt } from '../components/PasswordPrompt'
import { useToast } from '../components/Toast'
import { useAuth } from '../lib/auth'
import { requestHeaderYieldRefresh } from '../lib/headerYield'
import { decryptPost, encryptPostMarkdown, restorePostUnlock } from '../lib/crypto'
import { checkUserRepoPermissions } from '../lib/github'
import {
  enqueueImageUpload,
  enqueuePostPr,
  enqueuePostDelete,
  enqueuePostPublish,
} from '../lib/updateQueue'
import {
  countWords,
  deleteLocalPost,
  excerpt,
  getEncryptedRepoPost,
  getPostBySlug,
  localPostExists,
  readingTime,
  recordPublishTime,
  saveLocalPost,
  saveLocalPostRaw,
  serializePost,
  slugify,
  today,
} from '../lib/posts'
import { hideSeedPost, pushLocalVersion } from '../lib/offlineLibrary'
import { exportBundleFile } from '../lib/offlineBundle'
import { OFFLINE } from '../lib/runtime'
import { flushStorage } from '../lib/offlineStorage'
import { siteConfig } from '../lib/config'
import { parseArticleDirectives } from '../lib/articleDirectives'
import { setAnimatedSceneOverride } from '../lib/animatedBackground'
import { warmFontFamilies } from '../lib/font'
import { focusWithoutScroll, restoreCaret } from '../lib/caret'
import { latexSymbolInsert, type LatexSymbol } from '../lib/latexSymbols'
import { handleEditorKey, insertBlock, toggleLinePrefix, toggleWrap } from '../lib/editor'
import type { EditAction } from '../lib/editor'
import { useEditorScrollSync } from '../lib/editorSettings'
import { useRepoTarget } from '../lib/useRepoTarget'
import type { Post } from '../lib/types'

type ViewMode = 'split' | 'edit' | 'preview'

const STARTER = `## 从这里开始

写下你的第一段文字。支持 **粗体**、*斜体*、\`行内代码\`，以及：

- 无序列表
- [ ] 任务列表

> 引用一段话。

行内公式 $E = mc^2$，独立公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,\\mathrm{d}x = \\sqrt{\\pi}
$$

\`\`\`ts
const hello = (name: string) => \`你好，\${name}！\`
\`\`\`

::cute-table{tuack}

| 编号 | 测试点 | 状态 | 备注 |
| :-: | :-: | :-: | :-: |
| 1 | 基础测试 | 通过 | 跨行合并 |
| 2 | ^ | 通过 | ^ |
| 3 | 跨列合并 | < | 正常 |

::::info[这是折叠信息框]{open}
折叠框内容支持各类 Markdown 与公式排版。
::::
`

/**
 * 一次「保存草稿」的结果。
 *
 * `written: false` 表示这次按规则**拒绝写入**（例如加密文章还没解锁载入，
 * 此时编辑区是空白，写进去会覆盖掉真正的内容）。调用方必须据此中止后续动作，
 * 不能继续提示「已保存」。
 */
interface SaveOutcome {
  post: Post
  /** 内容是否已经进入本地文章库存储（去重跳过也算 true，因为磁盘上已是同样内容） */
  written: boolean
  /** 因「与 50ms 内的上一次写入内容完全一致」而跳过重复写入 */
  deduped?: boolean
  /** 未写入的原因（用于提示与日志） */
  reason?: string
}

/** 相同内容在这一毫秒窗口内不重复写入本地存储 */
const WRITE_THROTTLE_MS = 50

export default function Editor() {
  const { slug: routeSlug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const { canPublish, ghUser } = useAuth()

  const sourceParam = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('source') as Post['source'] | undefined
  }, [location.search])

  const existing = useMemo(() => {
    if (!routeSlug) return undefined
    if (sourceParam === 'repo') {
      const repoPost = getPostBySlug(routeSlug, 'repo')
      // 仓库加密文章若有本地草稿，说明发布后又在本地改过（发布时会清除旧草稿），
      // 优先加载较新的草稿，避免旧版本把草稿里的正文、标签、摘要等覆盖掉。
      if (repoPost?.encryption) {
        const localDraft = getPostBySlug(routeSlug, 'local')
        if (localDraft) return localDraft
      }
      return repoPost
    }
    // source=local 或未指定来源时优先加载本地草稿：
    // 加密文章解锁修改后保存的草稿要能直接继续编辑，而不是再次要求密码。
    // 本地草稿已被删除时（如重新发布加密版本后）回退到聚合结果。
    return getPostBySlug(routeSlug, 'local') ?? getPostBySlug(routeSlug)
  }, [routeSlug, sourceParam])
  const prefetchedDraft = (location.state as { draft?: Post } | null)?.draft
  // A historic version that has no matching editable post arrives here as a new local draft.
  const initial = prefetchedDraft ?? existing
  const prefetchedProtected = (location.state as { protected?: boolean } | null)?.protected === true
  const encryptedSource = Boolean(existing?.encryption)
  // Historic protected versions arrive already decrypted.
  const protectedExisting = encryptedSource || prefetchedProtected
  // 该 slug 在仓库中是否为加密文章：即使当前加载的是明文本地草稿，
  // 也属于「加密文章的草稿」，发布时必须保持加密。
  const repoEncrypted = useMemo(
    () => (routeSlug ? Boolean(getEncryptedRepoPost(routeSlug)) : false),
    [routeSlug],
  )
  const protectedLineage = protectedExisting || repoEncrypted
  const originalSlug = useRef(existing?.slug)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState(encryptedSource ? '' : (initial?.slug ?? ''))
  const [date, setDate] = useState(encryptedSource ? today() : (initial?.date ?? today()))
  // 标签不参与加密：加密文章的标签同样公开保存在 frontmatter 中，解锁前即可编辑。
  const [tagsText, setTagsText] = useState(initial?.tags.join(', ') ?? '')
  const [summary, setSummary] = useState(encryptedSource ? '' : (initial?.summary ?? ''))
  const [author, setAuthor] = useState(encryptedSource ? '' : (initial?.author ?? ''))
  const [cover, setCover] = useState(encryptedSource ? '' : (initial?.cover ?? ''))
  const [draft, setDraft] = useState(encryptedSource ? false : (initial?.draft ?? false))
  const [pinned, setPinned] = useState(encryptedSource ? false : (initial?.pinned ?? false))
  const [content, setContent] = useState(encryptedSource ? '' : (initial?.content ?? STARTER))

  const [view, setView] = useState<ViewMode>('split')
  const [metaOpen, setMetaOpen] = useState(!existing)
  const [fullscreen, setFullscreen] = useState(false)
  const [scrollSync] = useEditorScrollSync()
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(existing?.savedAt ?? null)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [canDirectPush, setCanDirectPush] = useState(false)
  const [isRepoAdmin, setIsRepoAdmin] = useState(false)
  const [unlocked, setUnlocked] = useState(!encryptedSource)
  const [restoringUnlock, setRestoringUnlock] = useState(encryptedSource)
  const [encryptOnPublish, setEncryptOnPublish] = useState(
    protectedLineage || Boolean(initial?.encryptIntent),
  )
  const [encryptionPassword, setEncryptionPassword] = useState('')
  const [encryptionConfirm, setEncryptionConfirm] = useState('')

  const target = useRepoTarget()

  useEffect(() => {
    if (!ghUser) {
      setCanDirectPush(false)
      // 离线版在「未连接 GitHub」时也必须能发布加密文章到本机文章库（此时 isRepoAdmin 不参与判断）
      setIsRepoAdmin(OFFLINE)
      return
    }
    checkUserRepoPermissions(ghUser.login, target).then((res) => {
      setCanDirectPush(res.canPush || res.canAdmin)
      setIsRepoAdmin(res.canAdmin)
    })
  }, [ghUser, target])

  /** 写入去重：见 save() 中的节流说明 */
  const lastWriteSignature = useRef('')
  const lastWriteTime = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const tags = useMemo(
    () =>
      tagsText
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsText],
  )
  const effectiveSlug = slug.trim() || slugify(title) || 'untitled'
  // 长文时每次按键都完整重渲染 Markdown 会明显卡顿：
  // 1) 先对内容做 150ms 防抖，连续输入只触发一次预览重渲；
  // 2) 再用 useDeferredValue 让预览、字数统计等重活在低优先级渲染中更新，
  //    输入框本体始终保持即时响应。
  const [debouncedContent, setDebouncedContent] = useState(content)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 150)
    return () => clearTimeout(t)
  }, [content])
  const deferredContent = useDeferredValue(debouncedContent)
  const words = useMemo(() => countWords(deferredContent), [deferredContent])
  const readingMinutes = useMemo(() => Math.max(1, Math.round(words / 400)), [words])

  // 文首排版指令（issue #59）在编辑器里同样实时生效，做到所见即所得：
  // 字体由预览的 Markdown 组件直接套用，这里再处理背景强制与云端字体预热。
  const directives = useMemo(() => parseArticleDirectives(deferredContent), [deferredContent])
  const directivesFontsKey = `${directives.fonts.join('\n')}\n${directives.codeFonts.join('\n')}`
  useEffect(() => {
    setAnimatedSceneOverride(directives.background)
    return () => setAnimatedSceneOverride(null)
  }, [directives])
  useEffect(() => {
    warmFontFamilies([...directives.fonts, ...directives.codeFonts])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directivesFontsKey])

  // LaTeX 符号选择框（issue #60）：打开时记住当时的选区，符号就插回那里。
  const [latexPickerOpen, setLatexPickerOpen] = useState(false)
  const latexSelectionRef = useRef<{ start: number; end: number } | null>(null)

  // 加密文章是否已把解密后的内容载入编辑器（防止解锁完成前把空白表单存成草稿）。
  const hydratedRef = useRef(false)

  const hydratePost = useCallback((post: Post) => {
    setTitle(post.title)
    setSlug(post.slug)
    setDate(post.date)
    setTagsText(post.tags.join(', '))
    setSummary(post.summary)
    setAuthor(post.author || '')
    setCover(post.cover || '')
    setDraft(post.draft)
    setPinned(Boolean(post.pinned))
    setContent(post.content)
    setSavedAt(post.savedAt ?? null)
    setDirty(false)
    hydratedRef.current = true
  }, [])

  useEffect(() => {
    let active = true
    hydratedRef.current = false
    const incoming = (location.state as { draft?: Post } | null)?.draft ?? existing
    if (existing?.encryption) {
      setTitle(existing.title)
      // 标题与标签是公开信息，解锁前就能显示。
      setTagsText(existing.tags.join(', '))
      setUnlocked(false)
      setRestoringUnlock(true)
      setEncryptOnPublish(true)
      void restorePostUnlock(existing).then((restored) => {
        if (!active) return
        if (restored) {
          hydratePost(restored)
          originalSlug.current = restored.slug
          setUnlocked(true)
        }
        setRestoringUnlock(false)
      })
      return () => {
        active = false
      }
    }
    setUnlocked(true)
    setRestoringUnlock(false)
    // 加密文章的草稿（或勾选过加密发布的新草稿）重新打开时，恢复「发布为加密文章」。
    setEncryptOnPublish(
      prefetchedProtected || repoEncrypted || Boolean(incoming?.encryptIntent),
    )
    if (incoming) hydratePost(incoming)
    return () => {
      active = false
    }
  }, [routeSlug, sourceParam, location.state, existing, prefetchedProtected, repoEncrypted, hydratePost])

  useEffect(() => {
    document.title = `${title || '未命名文章'} · 编辑器`
  }, [title])

  // 从仓库入口（?source=repo）打开加密文章时，若存在较新的本地草稿则改为加载草稿。
  const loadedLocalInstead = sourceParam === 'repo' && existing?.source === 'local'
  useEffect(() => {
    if (loadedLocalInstead) {
      toast('检测到这篇加密文章在本机有未发布的修改，已载入较新的本地草稿', 'info')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedLocalInstead])

  const buildDraftPost = useCallback(
    (): Post => ({
      slug: effectiveSlug,
      title: title.trim() || '未命名文章',
      date,
      updated: existing ? today() : undefined,
      summary: summary.trim() || excerpt(content),
      author: author.trim() || undefined,
      tags,
      cover: cover.trim() || undefined,
      draft,
      pinned,
      content,
      source: 'local',
      // 记住「发布为加密文章」的勾选状态，重新打开草稿时恢复。
      encryptIntent: encryptOnPublish || undefined,
      wordCount: words,
      readingTime: readingTime(content),
    }),
    [effectiveSlug, title, date, summary, author, content, tags, cover, draft, pinned, existing, encryptOnPublish, words],
  )

  const unlockExisting = async (password: string) => {
    if (!existing?.encryption) return
    const decrypted = await decryptPost(existing, password)
    hydratePost(decrypted)
    originalSlug.current = decrypted.slug
    setRestoringUnlock(false)
    setUnlocked(true)
    toast('已解锁。修改会自动保存为明文本地草稿（仅本机可见）；发布时会重新加密', 'info')
  }

  /* ------------------------------- 保存草稿 ------------------------------- */
  /**
   * 同步写入本地草稿 / 离线文章库，并返回「到底有没有写」。
   *
   * 这里**不弹任何成功提示**：提示统一由 saveAndFlush 在「写入 + 落盘 + 回读校验」
   * 全部通过之后再发，避免出现「先弹已保存到本地草稿、随后发现其实没写进去」。
   * 加密文章未解锁时只返回 written: false，由调用方决定怎么告诉用户。
   */
  const save = useCallback(
    (silent = false): SaveOutcome => {
      const post = buildDraftPost()
      // 加密文章的修改同样保存为本地草稿（明文，仅保存在本浏览器）。
      // 公开页面仍显示仓库中的加密版本（getAllPosts 不会让明文草稿顶替加密文章），
      // 发布时也会重新加密。
      // 防御：加密文章在解锁数据载入编辑器之前，不允许把空白的标题/摘要/正文写成草稿。
      if (protectedExisting && !hydratedRef.current) {
        return { post, written: false, reason: '加密文章尚未解锁载入，未写入本地草稿' }
      }
      // 去重节流：与上一次写入的内容完全一致、且发生在 50ms 之内时跳过重复写盘。
      // 自动保存与「发布」几乎同时触发（发布内部也会先 save）时，这里省掉一次
      // 无意义的序列化 + 存储写入；因为内容一致，跳过并不会丢任何东西。
      const signature = serializePost(post)
      const now = Date.now()
      if (signature === lastWriteSignature.current && now - lastWriteTime.current < WRITE_THROTTLE_MS) {
        return { post, written: true, deduped: true, reason: '内容与刚刚的写入一致，已跳过重复写入' }
      }
      lastWriteSignature.current = signature
      lastWriteTime.current = now
      saveLocalPost(post, originalSlug.current)
      originalSlug.current = post.slug
      setSavedAt(Date.now())
      setDirty(false)
      if (!silent) {
        // 指向本地草稿，刷新后能直接继续编辑，而不是回到仓库里的旧版本。
        if (routeSlug !== post.slug || sourceParam === 'repo') {
          navigate(`/admin/edit/${post.slug}?source=local`, { replace: true })
        }
      }
      return { post, written: true }
    },
    [buildDraftPost, navigate, protectedExisting, routeSlug, sourceParam],
  )

  /**
   * 保存 + 落盘确认 + 回读校验。**唯一的保存入口**：
   * ⌘S、工具栏「保存草稿」、自动保存与发布都走它。
   *
   * 顺序固定为：写入 → （离线版）flushStorage 确认落盘 → 按 slug 回读校验 → 才发成功提示；
   * 任何一步失败都抛出并恢复「未保存」标记，绝不显示「已保存」。
   */
  const saveAndFlush = useCallback(
    async (silent = false): Promise<SaveOutcome> => {
      const outcome = save(silent)
      const fail = (message: string) => {
        setDirty(true)
        setSavedAt(null)
        if (!silent) toast(message, 'error')
        throw new Error(message)
      }
      // 离线版即使这次拒绝写入，也要把此前自动保存在途的内容刷盘，
      // 保证「未解锁」这一路与其他路径的 flush 语义一致。
      if (OFFLINE) {
        try {
          await flushStorage()
        } catch (err) {
          fail(`本地存储写入失败：${err instanceof Error ? err.message : '未知错误'}`)
        }
      }
      // 未写入（例如加密文章还没解锁载入）一律中止：线上 / 离线行为一致，
      // 调用方（发布、加入队列）绝不能在这种情况下继续写文章库或留快照。
      if (!outcome.written) {
        const message = outcome.reason || '本次没有写入本地草稿'
        if (!silent) toast(message, 'warning')
        throw new Error(message)
      }
      // 回读校验：确认写进去的确实是当前编辑中的这条（改名 / 覆盖出问题时能立刻发现）。
      // 线上版没有异步落盘环节，但同样要校验，避免「提示已保存而存储里没这条」。
      if (!localPostExists(outcome.post.slug)) {
        fail(`保存校验失败：本地文章库里找不到「${outcome.post.slug}」这条记录，内容可能未写入`)
      }
      if (!silent) {
        toast(
          protectedLineage
            ? OFFLINE
              ? '已保存到本机（明文草稿，仅保存在这台设备）；发布时会重新加密'
              : '已保存到本地草稿（明文，仅保存在本浏览器）；发布时会重新加密'
            : OFFLINE
              ? '已保存到本机存储，离线也能阅读'
              : '已保存到本地草稿',
          protectedLineage ? 'info' : 'success',
        )
      }
      return outcome
    },
    [save, toast, protectedLineage],
  )

  // 自动保存
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      // 静默保存：失败不额外弹 toast（StorageGuard 的常驻横幅与错误 toast 已负责报出），
      // 但一定要把「未保存」标记留回来。
      void saveAndFlush(true).catch(() => undefined)
    }, 2500)
    return () => clearTimeout(t)
  }, [dirty, content, title, saveAndFlush])

  // 离开提醒
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const markDirty = () => setDirty(true)

  const handlePreviewContentChange = useCallback(
    (updater: (prevMarkdown: string) => string) => {
      setContent((prev) => {
        const next = updater(prev)
        setDebouncedContent(next)
        return next
      })
      setDirty(true)
    },
    [],
  )

  /* ------------------------------ 工具栏操作 ------------------------------ */
  const applyAction = (action: EditAction | null) => {
    if (!action) return
    setContent(action.value)
    markDirty()
    requestAnimationFrame(() => {
      // 先放回插入点再抢焦点：直接 focus() 会因为「把光标滚进视野」把整页
      // 拽到文章末尾（issue #70），细节见 src/lib/caret.ts。
      restoreCaret(textareaRef.current, action.selectionStart, action.selectionEnd)
    })
  }

  const withSelection = (fn: (v: string, s: number, e: number) => EditAction) => {
    const ta = textareaRef.current
    if (!ta) return
    applyAction(fn(ta.value, ta.selectionStart, ta.selectionEnd))
  }

  const openLatexPicker = () => {
    const ta = textareaRef.current
    latexSelectionRef.current = ta
      ? { start: ta.selectionStart, end: ta.selectionEnd }
      : { start: content.length, end: content.length }
    setLatexPickerOpen(true)
  }

  const insertLatexSymbol = (symbol: LatexSymbol) => {
    const saved = latexSelectionRef.current
    const start = Math.min(saved?.start ?? content.length, content.length)
    const end = Math.min(saved?.end ?? start, content.length)
    const { text, selectionStart, selectionEnd } = latexSymbolInsert(symbol)
    applyAction({
      value: content.slice(0, start) + text + content.slice(end),
      selectionStart: start + selectionStart,
      selectionEnd: start + selectionEnd,
    })
  }

  const tools = [
    {
      icon: Bold,
      title: '粗体 (⌘B)',
      run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '**', '**', '粗体')),
    },
    {
      icon: Italic,
      title: '斜体 (⌘I)',
      run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '*', '*', '斜体')),
    },
    {
      icon: Strikethrough,
      title: '删除线',
      run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '~~', '~~', '删除')),
    },
    {
      icon: Heading2,
      title: '标题',
      run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '## ')),
    },
    {
      icon: Quote,
      title: '引用',
      run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '> ')),
    },
    {
      icon: List,
      title: '无序列表',
      run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '- ')),
    },
    {
      icon: ListOrdered,
      title: '有序列表',
      run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '1. ')),
    },
    {
      icon: Link2,
      title: '链接 (⌘K)',
      run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '[', '](https://)', '链接文字')),
    },
    {
      icon: Code2,
      title: '代码块',
      run: () => withSelection((v, s, e) => insertBlock(v, s, e, '```ts\n\n```\n')),
    },
    {
      icon: Sigma,
      title: '数学公式',
      run: () =>
        withSelection((v, s, e) => insertBlock(v, s, e, '$$\n\\int_a^b f(x)\\,\\mathrm{d}x\n$$\n')),
    },
    {
      icon: Omega,
      title: 'LaTeX 符号 (Shift + ↑)',
      run: openLatexPicker,
    },
    {
      icon: SlidersHorizontal,
      title: '交互展示框',
      run: () =>
        withSelection((v, s, e) =>
          insertBlock(
            v,
            s,
            e,
            '::show_begin{二次函数展示}{a:Z=1[-5,5,1]; b:Q=0[-10,10,0.5]{faster_set}}\n当 *&show(a)*&、*&show(b)*& 时，$a^2+b$ = *&hs(a^2+b)*&。\n向下保留两位：&*floor(a^2+b,2)&*；向上保留两位：&*ceil(a^2+b,2)&*。\n*&a:{-1,负一;0,零;1,正一}*&\n::show_end\n',
          ),
        ),
    },
    {
      icon: Axis3d,
      title: '直角坐标系',
      run: () =>
        withSelection((v, s, e) =>
          insertBlock(
            v,
            s,
            e,
            '::begin_ui-ccs\ncreate_point:(0,0);\ncreate_line:(-2,-1),(2,3),[color=red];\ncreate_line:(7*x^2+6*x+90*x^3);\n::end_ui-ccs\n',
          ),
        ),
    },
    {
      icon: Network,
      title: '图论画布 (ui-graph)',
      run: () =>
        withSelection((v, s, e) =>
          insertBlock(
            v,
            s,
            e,
            '::begin_ui-graph[dag]\n5\n1 2 10\n2 3 5\n1 3\n3 4 2\n::end_ui-graph\n',
          ),
        ),
    },
    {
      icon: ListChecks,
      title: '交互表单与条件映射 (ui-choose / ui-select / ui-if / ui-write)',
      run: () =>
        withSelection((v, s, e) =>
          insertBlock(
            v,
            s,
            e,
            '::begin_ui-choose[a_new_choose][今天吃什么][more 1 2]\n[A]\n香蕉好吃！\n[B]\n我爱吃苹果！\n::end_ui-choose\n\n我今天要吃 ::ui-write[Number][R 0 1 4] 根香蕉！\n\n::ui-write[Ti][R 0 0 3][new][name 已经吃的香蕉][faster]\n\n<IF:$<number> \\le <Ti>$,你真棒！><IF:$<number> \\leq 2 \\times <Ti>$,还不错！>\n',
          ),
        ),
    },
    {
      icon: Table2,
      title: '表格（支持合并与 Tuack）',
      run: () =>
        withSelection((v, s, e) =>
          insertBlock(
            v,
            s,
            e,
            '::cute-table{tuack}\n\n| 列 A | 列 B | 列 C |\n| :---: | :---: | :---: |\n| 单元格 1 | 单元格 2 | 单元格 3 |\n| 跨行合并 | ^ | 跨列合并 | < |\n',
          ),
        ),
    },
  ]

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift + ↑ 打开 LaTeX 符号选择框（issue #60）；输入法组合中不拦截。
    if (
      e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      e.key === 'ArrowUp' &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault()
      openLatexPicker()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      // 保存 + 落盘确认（失败提示在 saveAndFlush 内部）
      void saveAndFlush().catch(() => undefined)
      return
    }
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      withSelection((v, s, en) => toggleWrap(v, s, en, '**', '**', '粗体'))
      return
    }
    if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      withSelection((v, s, en) => toggleWrap(v, s, en, '*', '*', '斜体'))
      return
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      withSelection((v, s, en) => toggleWrap(v, s, en, '[', '](https://)', '链接文字'))
      return
    }
    const action = handleEditorKey(e)
    if (action) applyAction(action)
  }

  /* ------------------------------- 图片上传 ------------------------------- */
  const onPickImage = async (file: File) => {
    if (!canPublish && !OFFLINE) {
      toast('未登录 GitHub 无法更新远程仓库图片，可直接使用 Markdown 插入外链图片或登录后上传', 'info')
      return
    }
    setUploading(true)
    try {
      // 图片先暂存到本地待更新队列，统一更新时再上传到仓库；链接先按最终地址写入正文。
      const url = await enqueueImageUpload(file)
      withSelection((v, s, e) => insertBlock(v, s, e, `![${file.name}](${url})\n`))
      toast(
        OFFLINE
          ? '图片已保存在本机图片库（预览用本地数据），导出文章包时会一起带上'
          : '图片已加入待更新队列，统一更新到仓库前站内预览使用本地暂存数据',
        'success',
        { label: '查看队列', href: OFFLINE ? '/admin?tab=export' : '/admin?tab=queue' },
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : '暂存图片失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  /* ---------------- 离线版：写入本机文章库（发布 = 落盘确认后才算成功） ---------------- */
  /**
   * 把编辑区内容写进本机文章库，返回最终 slug；校验不通过或写入失败返回 null。
   *
   * 三条硬规则（都是被离线场景逼出来的）：
   *   - 加密文章没解锁时**不写**，也不让调用方以为写好了；
   *   - 写完必须 `await flushStorage()` 确认真的落盘（存储被拒 / 配额满要在这里冒出来）；
   *   - 只有确认之后才谈「已保存」。
   */
  const saveToLibrary = async (): Promise<string | null> => {
    // 加密文章必须先解锁：此时编辑区是空白，继续走下去会把空白内容写成文章库条目
    if (protectedExisting && !hydratedRef.current) {
      toast('请先输入密码解锁文章后再保存', 'warning')
      return null
    }
    if (!title.trim()) {
      toast('请先填写标题', 'warning')
      setFullscreen(false)
      setMetaOpen(true)
      return null
    }
    if (encryptOnPublish) {
      if (!encryptionPassword) {
        toast('请输入文章加密密码', 'warning')
        setMetaOpen(true)
        return null
      }
      if (encryptionPassword !== encryptionConfirm) {
        toast('两次输入的密码不一致', 'warning')
        setMetaOpen(true)
        return null
      }
    }
    setPublishing(true)
    try {
      // 先把编辑区内容落盘（含存储确认），失败即抛出，绝不显示「已保存」
      const { post, written, deduped } = await saveAndFlush(true)
      if (deduped) {
        console.info('[离线保存] 草稿内容与刚刚的自动保存一致，已跳过重复写入，直接继续')
      }
      if (!written) {
        // saveAndFlush 里已经抛错，这里是显式双保险：宁可不写，也不留下空白文章
        throw new Error('本次没有写入本地草稿，已中止保存')
      }
      const markdown = encryptOnPublish
        ? await encryptPostMarkdown(post, encryptionPassword)
        : serializePost(post)
      // 文章库条目直接写入完整 Markdown：加密发布时写入的是密文信封，本机不留明文
      saveLocalPostRaw(post.slug, markdown, routeSlug || undefined)
      // 改了 slug 且旧名字来自内置文章：本机隐藏旧条目（只影响这台设备上的这个文件）
      if (routeSlug && routeSlug !== post.slug && getPostBySlug(routeSlug, 'repo')) {
        hideSeedPost(routeSlug)
      }
      pushLocalVersion(post.slug, markdown, `保存 · ${new Date().toLocaleString('zh-CN')}`)
      recordPublishTime(post.slug)
      if (encryptOnPublish) {
        setEncryptionPassword('')
        setEncryptionConfirm('')
      }
      // 最终确认落盘（文章库条目 + 版本快照 + 发布时间），任何失败都在这里冒出来
      await flushStorage()
      setSavedAt(Date.now())
      setDirty(false)
      return post.slug
    } catch (err) {
      setDirty(true)
      toast(err instanceof Error ? err.message : '保存到文章库失败', 'error')
      return null
    } finally {
      setPublishing(false)
    }
  }

  const publishOffline = async () => {
    const slug = await saveToLibrary()
    if (!slug) return
    toast(
      `已保存到本机文章库${encryptOnPublish ? '（密文信封）' : ''}`,
      'success',
      { label: '带到线上站点', href: '/admin?tab=export' },
    )
  }

  /**
   * 「保存到在线网站的本地文章中」：先写进本机文章库，再生成这一篇的**文章包**文件。
   *
   * 离线文件不联网，不能替用户提交仓库；文章包就是唯一的交接物——
   * 在线上站点的「管理 → 导入离线文章包」里选它，内容就进入该站点的本地文章列表，
   * 之后由站点自己的待更新队列一次提交、一次部署。
   */
  const exportThisPost = async () => {
    const slug = await saveToLibrary()
    if (!slug) return
    try {
      const result = exportBundleFile([slug])
      toast(
        `已生成导入包 ${result.file}（${(result.bytes / 1024).toFixed(0)} KB）。` +
          '到线上站点的「管理 → 导入离线文章包」里选择它，即可写入该站点的本地文章列表',
        'success',
        { label: '查看导出说明', href: '/admin?tab=export' },
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : '文章已保存，但生成导入包失败', 'error')
    }
  }

  /* ---------------------------- 发布或提交 PR ---------------------------- */
  const publishOrSubmitPR = async () => {
    // 离线版：写本机文章库（不触碰 GitHub）。publishOffline 自己处理错误提示，
    // 这里返回它的 promise，保证按钮的「处理中…」与实际写入一致。
    if (OFFLINE) return publishOffline()
    // 全屏时看不到文章信息面板，先退出全屏再提示补充信息。
    const revealMeta = () => {
      setFullscreen(false)
      setMetaOpen(true)
    }
    if (!title.trim()) {
      toast('请先填写标题', 'warning')
      revealMeta()
      return
    }
    const { post, written, reason } = save(true)
    if (!written) {
      // 加密文章尚未解锁载入：此时编辑区是空白，直接中止才不会把空内容写进队列
      toast(reason || '本次没有写入本地草稿，稍后再试', 'warning')
      return
    }
    if (!canPublish) {
      toast('未登录状态仅支持保存到本地草稿。登录 GitHub 账号后可将更改加入待更新队列并统一更新。', 'info', {
        label: '前往登录',
        href: '/login',
      })
      return
    }

    if (encryptOnPublish) {
      if (!isRepoAdmin) {
        toast('只有目标仓库管理员可以发布带密码的文章', 'warning')
        return
      }
      if (!encryptionPassword) {
        toast('请输入文章加密密码', 'warning')
        revealMeta()
        return
      }
      if (encryptionPassword !== encryptionConfirm) {
        toast('两次输入的密码不一致', 'warning')
        revealMeta()
        return
      }
    }

    setPublishing(true)
    try {
      // 加密在加入队列前完成：密码只用于生成密文，不会保存在队列里。
      const markdown = encryptOnPublish
        ? await encryptPostMarkdown(post, encryptionPassword)
        : serializePost(post)

      if (canDirectPush) {
        // 管理员/直接拥有 push 权限：待更新队列里保存为直推 main 的更新
        enqueuePostPublish(post, markdown)
        // 修改了 slug（文件名）时，仓库里旧路径的文章会留下重复副本：一并加入删除。
        // 只处理仓库中确实存在的旧 slug，且不与新 slug 相同。
        if (routeSlug && routeSlug !== post.slug && getPostBySlug(routeSlug, 'repo')) {
          enqueuePostDelete(routeSlug, getPostBySlug(routeSlug, 'repo')?.title || routeSlug)
        }
        // A plaintext local autosave must not shadow the encrypted repository
        // article on the public route after the next reload.
        if (encryptOnPublish) {
          deleteLocalPost(post.slug)
          setEncryptionPassword('')
          setEncryptionConfirm('')
        }
        toast(
          encryptOnPublish
            ? '加密文章已加入待更新队列，统一更新后发布到 GitHub'
            : '已加入待更新队列，统一更新后才会提交到 GitHub',
          'success',
          { label: '查看队列', href: '/admin?tab=queue' },
        )
      } else {
        // 普通已登录用户：待更新队列里保存为发表申请 PR，统一更新时创建
        // 修改了 slug 时，PR 中一并删除旧路径的文件（旧文件不存在时会自动跳过）
        enqueuePostPr(post, markdown, routeSlug || undefined)
        toast('发表申请已加入待更新队列，统一更新时创建审核 PR', 'success', {
          label: '查看队列',
          href: '/admin?tab=queue',
        })
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setPublishing(false)
    }
  }

  /* --------------------------------- 导出 --------------------------------- */
  const download = () => {
    const blob = new Blob([serializePost(buildDraftPost())], {
      type: 'text/markdown;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${effectiveSlug}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const removeDraft = () => {
    if (!confirm('确定要删除这份本地草稿吗？（不会影响已提交到 GitHub 的文件）')) return
    deleteLocalPost(effectiveSlug)
    toast('本地草稿已删除', 'info')
    navigate('/admin')
  }

  /* ------------------------------ 滚动同步 --------------------------------
   * 双栏视图下，用「源文本行 ↔ 渲染块」锚点做对齐：预览区的顶层块级元素带有
   * data-source-line（原始 Markdown 行号），编辑区一侧用一个同宽同字体的隐藏
   * 镜像层测出每行在 textarea 里的像素位置，滚动时在相邻锚点间线性插值。
   * 这样左侧第 N 行滚到视口顶部时，右侧对应的渲染块也正好位于顶部，
   * 而不是简单按总高度比例换算（公式、表格、折叠框会让比例逐渐漂移）。
   * 在「设置」里关闭自动同步滚动后，两侧各自独立滚动。
   * ------------------------------------------------------------------------ */
  const mirrorRef = useRef<HTMLDivElement>(null)
  const anchorsDirtyRef = useRef(true)

  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  /** 用与 textarea 完全一致的样式重建隐藏镜像层，用于测量每行的纵向像素位置。 */
  const rebuildLineMirror = (ta: HTMLTextAreaElement) => {
    const mirror = mirrorRef.current
    if (!mirror) return
    mirror.style.width = `${ta.clientWidth}px`
    // 每个源码行一个块级 div：块内换行行为与 textarea 的逐行换行一致，
    // 空行用零宽字符撑起行高，保证 offsetTop 对每一行都可靠。
    mirror.innerHTML = ta.value
      .split('\n')
      .map(
        (line, index) =>
          `<div data-l="${index + 1}">${line ? escapeHtml(line) : '&#8203;'}</div>`,
      )
      .join('')
  }

  /** 内容、视图或尺寸变化后，下次滚动时重建锚点。 */
  useEffect(() => {
    anchorsDirtyRef.current = true
  }, [content, view, scrollSync, fullscreen])

  // 空闲时（停止输入约 200ms）提前重建镜像层，让下一次滚动无需现算。
  useEffect(() => {
    if (view !== 'split' || !scrollSync) return
    const timer = window.setTimeout(() => {
      const ta = textareaRef.current
      const mirror = mirrorRef.current
      const pv = previewRef.current
      // 窄屏（md 以下）双栏里的预览是隐藏的，无需测量。
      if (!ta || !mirror || !pv || pv.clientHeight === 0) return
      rebuildLineMirror(ta)
      anchorsDirtyRef.current = false
    }, 200)
    return () => window.clearTimeout(timer)
  }, [content, view, scrollSync, fullscreen])

  // 视图或开关变化后重新挂载镜像层 / 尺寸变化（窗口缩放、全屏切换）都会使行位置失效。
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      anchorsDirtyRef.current = true
    })
    observer.observe(ta)
    return () => observer.disconnect()
  }, [view, scrollSync])

  // 云端字体加载完成后行高会变化，同样需要重测。
  useEffect(() => {
    let active = true
    document.fonts?.ready.then(() => {
      if (active) anchorsDirtyRef.current = true
    })
    return () => {
      active = false
    }
  }, [])

  const syncScroll = () => {
    const ta = textareaRef.current
    const pv = previewRef.current
    if (!ta || !pv || view !== 'split' || !scrollSync) return

    const maxTa = ta.scrollHeight - ta.clientHeight
    const maxPv = pv.scrollHeight - pv.clientHeight
    if (maxTa <= 0 || maxPv <= 0) return

    if (anchorsDirtyRef.current) {
      rebuildLineMirror(ta)
      anchorsDirtyRef.current = false
    }

    // 读取所有写值前的测量，避免布局抖动。
    const pvTop = pv.getBoundingClientRect().top
    const pvScrollTop = pv.scrollTop
    const mirror = mirrorRef.current
    const anchors: { ta: number; pv: number }[] = []

    if (mirror) {
      const marked = pv.querySelectorAll<HTMLElement>('[data-source-line]')
      for (const el of marked) {
        // 只取最外层块：嵌套在折叠框、表格里的标注不参与对齐。
        if (el.parentElement?.closest('[data-source-line]')) continue
        const line = Number(el.dataset.sourceLine)
        if (!Number.isInteger(line) || line < 1) continue
        const lineEl = mirror.querySelector<HTMLElement>(`div[data-l="${line}"]`)
        if (!lineEl) continue
        const taY = lineEl.offsetTop
        const pvY = el.getBoundingClientRect().top - pvTop + pvScrollTop
        const prev = anchors[anchors.length - 1]
        if (prev && (taY <= prev.ta || pvY <= prev.pv)) continue
        anchors.push({ ta: taY, pv: pvY })
      }
    }

    const scroll = ta.scrollTop
    // 只保留编辑区实际能滚到的锚点；更靠下的锚点只可能出现在视口下部，
    // 让尾部平滑过渡到「两侧同时见底」。
    const usable = anchors.filter((a) => a.ta < maxTa - 0.5)
    let target: number
    if (usable.length === 0) {
      // 没有可用锚点时退回按总高度比例同步。
      target = (scroll / maxTa) * maxPv
    } else if (scroll <= usable[0].ta) {
      // 顶部到第一个锚点之间。
      target =
        usable[0].ta > 0 ? (scroll / usable[0].ta) * usable[0].pv : usable[0].pv
    } else if (scroll >= usable[usable.length - 1].ta) {
      // 最后一个可达锚点到末尾：过渡到预览区底部。
      const last = usable[usable.length - 1]
      const span = maxTa - last.ta
      target =
        span < 1
          ? scroll >= maxTa - 0.5
            ? maxPv
            : last.pv
          : last.pv + ((scroll - last.ta) / span) * (maxPv - last.pv)
    } else {
      // 在相邻两个锚点之间线性插值。
      let lo = 0
      let hi = usable.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (usable[mid].ta <= scroll) lo = mid
        else hi = mid
      }
      const a = usable[lo]
      const b = usable[hi]
      target = a.pv + ((scroll - a.ta) / (b.ta - a.ta)) * (b.pv - a.pv)
    }

    pv.scrollTop = Math.max(0, Math.min(maxPv, target))
  }

  // 全屏时按 Esc 退出（输入法组合键中的 Esc 用于取消候选，不退出全屏；
  // 符号选择框开着时 Esc 只关闭选择框）。
  useEffect(() => {
    if (!fullscreen || latexPickerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, latexPickerOpen])

  useEffect(() => {
    requestHeaderYieldRefresh()
  }, [fullscreen])

  if (protectedExisting && !unlocked) {
    return (
      <div className="container-page flex min-h-[65vh] items-center justify-center py-10" data-yield-list>
        {restoringUnlock ? (
          <div className="card flex w-full max-w-md flex-col items-center p-7 text-center">
            <Loader2 size={24} className="animate-spin text-brand-500" />
            <h1 className="mt-4 font-serif text-xl font-bold text-ink-900 dark:text-white">{existing?.title}</h1>
            <p className="mt-2 text-sm text-ink-500">正在读取此设备保存的解锁状态…</p>
          </div>
        ) : (
          <PasswordPrompt
            title={`解锁后编辑「${existing?.title || '加密文章'}」`}
            description="文章标题与标签公开可见，正文及其他信息已加密。请输入密码后才会将内容载入编辑器。"
            onUnlock={unlockExisting}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-[80] flex h-screen flex-col overflow-hidden bg-white dark:bg-ink-950'
          : 'container-page pt-12'
      }
    >
      <div
        className={fullscreen ? 'flex min-h-0 flex-1 flex-col' : 'mx-auto max-w-6xl'}
        data-yield-list={fullscreen ? undefined : true}
      >
        {/* 顶部栏 */}
        <div
          className={
            fullscreen
              ? 'flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-200/70 px-4 py-2 dark:border-white/10'
              : 'mb-4 flex flex-wrap items-center justify-between gap-3'
          }
        >
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              markDirty()
            }}
            placeholder="输入文章标题…"
            className="flex-1 min-w-[15rem] bg-transparent font-serif text-2xl font-bold outline-none text-ink-900 placeholder:text-ink-400 dark:text-white"
          />

          <div className="flex items-center gap-2">
            {/* 视图模式切换 */}
            <div className="flex rounded-lg bg-ink-100 p-0.5 dark:bg-white/10">
              {(
                [
                  { id: 'edit', icon: Pencil, label: '仅编辑' },
                  { id: 'split', icon: Columns2, label: '双栏' },
                  { id: 'preview', icon: Eye, label: '仅预览' },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`rounded-md p-1.5 text-xs transition ${
                    view === v.id
                      ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
                      : 'text-ink-500 hover:text-ink-900 dark:text-ink-400'
                  }`}
                  title={v.label}
                >
                  <v.icon size={15} />
                </button>
              ))}
            </div>

            <button
              onClick={() => setFullscreen((v) => !v)}
              className="btn-ghost h-9 w-9 !px-0"
              title={fullscreen ? '退出全屏 (Esc)' : '全屏编辑 (Esc 退出)'}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button onClick={download} className="btn-ghost h-9 w-9 !px-0" title="下载 .md">
              <Download size={16} />
            </button>
            <button onClick={() => void saveAndFlush().catch(() => undefined)} className="btn-outline h-9">
              <Save size={15} />
              <span className="hidden sm:inline">保存草稿</span>
            </button>

            {/* 离线版：写入本机文章库；线上：更改先加入待更新队列，由内容管理统一更新 */}
            {OFFLINE ? (
              <>
                <button
                  onClick={publishOrSubmitPR}
                  disabled={publishing}
                  className="btn-outline h-9"
                  title="写入这个 HTML 所在浏览器的本机文章库；不联网，也不会改动仓库"
                >
                  {publishing ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  <span className="hidden sm:inline">{publishing ? '保存中…' : '保存到本机'}</span>
                </button>
                <button
                  onClick={() => void exportThisPost()}
                  disabled={publishing}
                  className="btn-primary h-9"
                  title="保存到本机文章库，并生成这一篇的文章包文件；在线上站点导入后就会出现在该站点的本地文章列表里"
                >
                  {publishing ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
                  <span className="hidden sm:inline">保存到在线网站的本地文章</span>
                </button>
              </>
            ) : canPublish ? (
              <button
                onClick={publishOrSubmitPR}
                disabled={publishing}
                className="btn-primary h-9"
                title={
                  canDirectPush
                    ? '加入待更新队列，统一更新时提交到 main 分支'
                    : '加入待更新队列，统一更新时创建发表申请 (PR)'
                }
              >
                {publishing ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : canDirectPush ? (
                  <Github size={15} />
                ) : (
                  <GitPullRequest size={15} />
                )}
                <span className="hidden sm:inline">
                  {publishing
                    ? '处理中…'
                    : canDirectPush
                      ? '加入更新队列'
                      : '加入更新队列 (PR)'}
                </span>
              </button>
            ) : (
              <button
                onClick={publishOrSubmitPR}
                className="btn-outline h-9 text-ink-600 dark:text-ink-300"
                title="未登录仅支持保存本地草稿，登录后可发布或提交申请"
              >
                <LogIn size={15} />
                <span className="hidden sm:inline">登录后发布</span>
              </button>
            )}
          </div>
        </div>

        {/* ------------------------------ 元信息面板 ----------------------------- */}
        {/* 全屏时隐藏元信息面板，把整块屏幕留给编辑区。 */}
        {!fullscreen && (
        <div className="card mb-4 overflow-hidden">
          <button
            onClick={() => setMetaOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink-700 transition hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/[.03]"
          >
            <span className="flex items-center gap-2">
              文章信息
              <span className="font-mono text-xs font-normal text-ink-400">
                /posts/{effectiveSlug}
              </span>
              {draft && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  草稿
                </span>
              )}
              {!canPublish && (
                <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 dark:bg-white/10 dark:text-ink-300">
                  本地草稿模式
                </span>
              )}
            </span>
            <ChevronDown
              size={16}
              className={`text-ink-400 transition-transform ${metaOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {metaOpen && (
            <div className="grid gap-4 border-t border-ink-200/70 p-4 sm:grid-cols-2 dark:border-white/10">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">
                  URL 别名 (slug)
                </label>
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value)
                    markDirty()
                  }}
                  placeholder={slugify(title) || 'my-first-post'}
                  className="input font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">发布日期</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value)
                    markDirty()
                  }}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">
                  标签（逗号分隔）
                </label>
                <input
                  value={tagsText}
                  onChange={(e) => {
                    setTagsText(e.target.value)
                    markDirty()
                  }}
                  placeholder="数学, 前端, 随笔"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">
                  封面图 URL（可选）
                </label>
                <input
                  value={cover}
                  onChange={(e) => {
                    setCover(e.target.value)
                    markDirty()
                  }}
                  placeholder="https://…"
                  className="input text-xs"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">作者（可选）</label>
                <input
                  value={author}
                  onChange={(e) => {
                    setAuthor(e.target.value)
                    markDirty()
                  }}
                  placeholder={siteConfig.author.name}
                  className="input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-ink-500">
                  摘要（留空自动截取正文）
                </label>
                <textarea
                  value={summary}
                  onChange={(e) => {
                    setSummary(e.target.value)
                    markDirty()
                  }}
                  rows={2}
                  placeholder={excerpt(deferredContent, 80)}
                  className="input resize-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-5 sm:col-span-2">
                {[
                  { label: '保存为草稿（不公开）', value: draft, set: setDraft },
                  { label: '置顶到首页', value: pinned, set: setPinned },
                ].map((c) => (
                  <label
                    key={c.label}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink-600 dark:text-ink-300"
                  >
                    <input
                      type="checkbox"
                      checked={c.value}
                      onChange={(e) => {
                        c.set(e.target.checked)
                        markDirty()
                      }}
                      className="h-4 w-4 rounded accent-brand-500"
                    />
                    {c.label}
                  </label>
                ))}
                {isRepoAdmin && (
                  <div className="w-full rounded-xl border border-brand-200/70 bg-brand-50/40 p-3 dark:border-brand-500/20 dark:bg-brand-500/[0.06]">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
                      <input
                        type="checkbox"
                        checked={encryptOnPublish}
                        onChange={(event) => {
                          setEncryptOnPublish(event.target.checked)
                          markDirty()
                        }}
                        className="h-4 w-4 rounded accent-brand-500"
                      />
                      <LockKeyhole size={14} className="text-brand-600 dark:text-brand-300" />
                      发布为带密码的加密文章
                    </label>
                    {encryptOnPublish && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input
                          type="password"
                          value={encryptionPassword}
                          onChange={(event) => setEncryptionPassword(event.target.value)}
                          autoComplete="new-password"
                          placeholder="设置文章密码"
                          className="input !py-2 text-xs"
                        />
                        <input
                          type="password"
                          value={encryptionConfirm}
                          onChange={(event) => setEncryptionConfirm(event.target.value)}
                          autoComplete="new-password"
                          placeholder="再次输入密码"
                          className="input !py-2 text-xs"
                        />
                      </div>
                    )}
                    <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                      标题会公开显示；正文与其他文章信息使用浏览器 Web Crypto 加密后再提交。密码不会写入 GitHub 或本机，成功解锁后本设备会记住不可导出的解锁密钥。解锁编辑期间的修改会以明文保存在本浏览器的本地草稿中；重新发布加密版本后会自动清除该草稿，公开页面始终需要密码。
                    </p>
                  </div>
                )}
                {existing?.source === 'local' && (
                  <button onClick={removeDraft} className="btn-danger ml-auto h-8 text-xs">
                    <Trash2 size={13} />
                    删除草稿
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* -------------------------------- 编辑区 ------------------------------- */}
        {/* 全屏：编辑区铺满整个屏幕（顶部只保留一条紧凑工具栏），不再有页边距与最大宽度限制。 */}
        <div
          className={
            fullscreen
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : 'card overflow-hidden'
          }
        >
          {/* 工具栏 */}
          <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-ink-200/70 px-2 py-1.5 dark:border-white/10">
            {tools.map((t) => (
              <button
                key={t.title}
                onClick={t.run}
                title={t.title}
                type="button"
                className="rounded-md p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-brand-600 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-brand-300"
              >
                <t.icon size={15} />
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-ink-200 dark:bg-white/10" />
            <button
              onClick={() => fileRef.current?.click()}
              title="上传图片（加入待更新队列）"
              type="button"
              className="rounded-md p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-brand-600 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-brand-300"
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPickImage(f)
                e.target.value = ''
              }}
            />

            <div className="ml-auto flex items-center gap-3 pr-2 text-xs text-ink-400">
              <span className="hidden sm:inline">
                {words} 字 · 约 {readingMinutes} 分钟
              </span>
              <span className="flex items-center gap-1">
                {dirty ? (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                    未保存
                  </>
                ) : savedAt ? (
                  <>
                    <Check size={12} className="text-emerald-500" />
                    已保存
                  </>
                ) : null}
              </span>
            </div>
          </div>

          {/* 编辑 / 预览 */}
          <div
            className={`grid ${view === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'} ${
              fullscreen ? 'min-h-0 flex-1' : ''
            }`}
            style={fullscreen ? undefined : { height: 'min(68vh, 44rem)' }}
          >
            {view !== 'preview' && (
              <div className="relative min-h-0">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value)
                    markDirty()
                  }}
                  onKeyDown={onKeyDown}
                  onScroll={syncScroll}
                  spellCheck={false}
                  placeholder="在这里用 Markdown 写作…"
                  className="editor-textarea h-full w-full resize-none bg-transparent p-5 font-mono text-[14px] text-ink-800 outline-none placeholder:text-ink-400 dark:text-ink-100"
                />
                {/* 滚动同步用的隐藏镜像层：与 textarea 同字体同宽度，用于测量每行的像素位置。 */}
                {view === 'split' && scrollSync && (
                  <div
                    ref={mirrorRef}
                    aria-hidden="true"
                    className="editor-textarea invisible absolute left-0 top-0 w-0 whitespace-pre-wrap break-words p-5 font-mono text-[14px] pointer-events-none"
                  />
                )}
              </div>
            )}

            {view !== 'edit' && (
              <div
                ref={previewRef}
                data-yield-ignore
                className={`h-full overflow-y-auto bg-ink-50/40 p-5 dark:bg-white/[.02] ${
                  view === 'split'
                    ? 'hidden border-l border-ink-200/70 md:block dark:border-white/10'
                    : ''
                }`}
              >
                {/* 双栏视图不渲染文章标题，保证左右两侧的第一个内容块从同一高度开始，滚动时才能对齐。 */}
                {view !== 'split' && (
                  <h1 className="mb-6 font-serif text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
                    {title || '未命名文章'}
                  </h1>
                )}
                <Markdown
                  content={deferredContent}
                  sourceLineMarkers={view === 'split'}
                  onContentChange={handlePreviewContentChange}
                />
              </div>
            )}
          </div>
        </div>

        {/* 提示栏（全屏时隐藏） */}
        {!fullscreen && (
        <div className="mb-16 mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-400">
          {OFFLINE ? (
            <span className="flex items-center gap-1.5">
              <AlertCircle size={13} />
              离线版：草稿与文章都存在这个浏览器的本机文章库里，全程不联网。要带到线上，用
              <Link to="/admin?tab=export" className="text-brand-600 hover:underline dark:text-brand-300">
                导出文章包
              </Link>
              ，再到线上站点导入。
            </span>
          ) : (
          <span className="flex items-center gap-1.5">
            <AlertCircle size={13} />
            草稿实时保存在本浏览器；发布与图片上传等仓库操作会先加入
            <Link to="/admin?tab=queue" className="text-brand-600 hover:underline dark:text-brand-300">
              待更新队列
            </Link>
            ，统一更新后才会提交到 GitHub。
          </span>
          )}
          {/* 离线版没有账号体系：这里只显示「本机会自动保存」，不出现任何连接 GitHub 的入口 */}
          {OFFLINE ? (
            <span className="flex items-center gap-1.5">
              <HardDrive size={13} />
              未登录也可写作：内容保存在本机
            </span>
          ) : canPublish ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Github size={13} />
              已连接 @{ghUser?.login}{' '}
              {canDirectPush ? '（仓库管理员）' : '（协作者）'}
            </span>
          ) : (
            <Link
              to="/settings"
              className="flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-300"
            >
              <Upload size={13} />
              连接 GitHub 以启用发布
            </Link>
          )}
          <span className="hidden sm:inline">快捷键：⌘S 保存 · ⌘B 粗体 · ⌘I 斜体 · ⌘K 链接 · Shift + ↑ LaTeX 符号</span>
        </div>
        )}
      </div>
      <LatexPicker
        open={latexPickerOpen}
        onClose={() => {
          setLatexPickerOpen(false)
          // 关闭后把焦点还给编辑区，继续原来的写作位置——但不允许 focus() 顺手滚页。
          requestAnimationFrame(() => focusWithoutScroll(textareaRef.current))
        }}
        onInsert={insertLatexSymbol}
      />
    </div>
  )
}
