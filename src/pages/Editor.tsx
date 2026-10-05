import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
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
  ListOrdered,
  Loader2,
  LogIn,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Pencil,
  Quote,
  Save,
  Sigma,
  SlidersHorizontal,
  Strikethrough,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import { PasswordPrompt } from '../components/PasswordPrompt'
import { useToast } from '../components/Toast'
import { useAuth } from '../lib/auth'
import { decryptPost, encryptPostMarkdown } from '../lib/crypto'
import {
  checkUserRepoPermissions,
  commitPost,
  getRepoTarget,
  submitPublicationPR,
  uploadImage,
} from '../lib/github'
import {
  countWords,
  deleteLocalPost,
  excerpt,
  getPostBySlug,
  readingTime,
  recordPublishTime,
  saveLocalPost,
  serializePost,
  slugify,
  today,
} from '../lib/posts'
import { siteConfig } from '../lib/config'
import { handleEditorKey, insertBlock, toggleLinePrefix, toggleWrap } from '../lib/editor'
import type { EditAction } from '../lib/editor'
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

  const existing = useMemo(
    () => (routeSlug ? getPostBySlug(routeSlug, sourceParam) : undefined),
    [routeSlug, sourceParam],
  )
  const prefetchedDraft = (location.state as { draft?: Post } | null)?.draft
  // A historic version that has no matching editable post arrives here as a new local draft.
  const initial = prefetchedDraft ?? existing
  const prefetchedProtected = (location.state as { protected?: boolean } | null)?.protected === true
  const encryptedSource = Boolean(existing?.encryption)
  // Historic protected versions arrive already decrypted, but must still never
  // be written back as a plaintext local draft.
  const protectedExisting = encryptedSource || prefetchedProtected
  const originalSlug = useRef(existing?.slug)

  const [title, setTitle] = useState(encryptedSource ? '' : (initial?.title ?? ''))
  const [slug, setSlug] = useState(encryptedSource ? '' : (initial?.slug ?? ''))
  const [date, setDate] = useState(encryptedSource ? today() : (initial?.date ?? today()))
  const [tagsText, setTagsText] = useState(encryptedSource ? '' : (initial?.tags.join(', ') ?? ''))
  const [summary, setSummary] = useState(encryptedSource ? '' : (initial?.summary ?? ''))
  const [author, setAuthor] = useState(encryptedSource ? '' : (initial?.author ?? ''))
  const [cover, setCover] = useState(encryptedSource ? '' : (initial?.cover ?? ''))
  const [draft, setDraft] = useState(encryptedSource ? false : (initial?.draft ?? false))
  const [pinned, setPinned] = useState(encryptedSource ? false : (initial?.pinned ?? false))
  const [content, setContent] = useState(encryptedSource ? '' : (initial?.content ?? STARTER))

  const [view, setView] = useState<ViewMode>('split')
  const [metaOpen, setMetaOpen] = useState(!existing)
  const [fullscreen, setFullscreen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(existing?.savedAt ?? null)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [canDirectPush, setCanDirectPush] = useState(false)
  const [isRepoAdmin, setIsRepoAdmin] = useState(false)
  const [unlocked, setUnlocked] = useState(!encryptedSource)
  const [encryptOnPublish, setEncryptOnPublish] = useState(protectedExisting)
  const [encryptionPassword, setEncryptionPassword] = useState('')
  const [encryptionConfirm, setEncryptionConfirm] = useState('')

  const target = getRepoTarget()

  useEffect(() => {
    if (!ghUser) {
      setCanDirectPush(false)
      setIsRepoAdmin(false)
      return
    }
    checkUserRepoPermissions(ghUser.login, target).then((res) => {
      setCanDirectPush(res.canPush || res.canAdmin)
      setIsRepoAdmin(res.canAdmin)
    })
  }, [ghUser, target])

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
  const words = useMemo(() => countWords(content), [content])

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
  }, [])

  useEffect(() => {
    const incoming = (location.state as { draft?: Post } | null)?.draft ?? existing
    if (existing?.encryption) {
      setUnlocked(false)
      setEncryptOnPublish(true)
      return
    }
    setUnlocked(true)
    setEncryptOnPublish(prefetchedProtected)
    if (incoming) hydratePost(incoming)
  }, [routeSlug, sourceParam, location.state, existing, prefetchedProtected, hydratePost])

  useEffect(() => {
    document.title = `${title || '未命名文章'} · 编辑器`
  }, [title])

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
      wordCount: words,
      readingTime: readingTime(content),
    }),
    [effectiveSlug, title, date, summary, author, content, tags, cover, draft, pinned, existing, words],
  )

  const unlockExisting = async (password: string) => {
    if (!existing?.encryption) return
    const decrypted = await decryptPost(existing, password)
    hydratePost(decrypted)
    originalSlug.current = decrypted.slug
    setUnlocked(true)
  }

  /* ------------------------------- 保存草稿 ------------------------------- */
  const save = useCallback(
    (silent = false) => {
      const post = buildDraftPost()
      // Never leave a decrypted protected article in localStorage. A published
      // encrypted version must always require its password when reopened.
      if (protectedExisting) {
        setSavedAt(Date.now())
        setDirty(false)
        if (!silent) toast('已保留在当前编辑器中；发布时会再次加密，不会写入明文草稿', 'info')
        return post
      }
      saveLocalPost(post, originalSlug.current)
      originalSlug.current = post.slug
      setSavedAt(Date.now())
      setDirty(false)
      if (!silent) {
        toast('已保存到本地草稿', 'success')
        if (routeSlug !== post.slug) navigate(`/admin/edit/${post.slug}`, { replace: true })
      }
      return post
    },
    [buildDraftPost, navigate, protectedExisting, routeSlug, toast],
  )

  // 自动保存
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save(true), 2500)
    return () => clearTimeout(t)
  }, [dirty, content, title, save])

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

  /* ------------------------------ 工具栏操作 ------------------------------ */
  const applyAction = (action: EditAction | null) => {
    if (!action) return
    setContent(action.value)
    markDirty()
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(action.selectionStart, action.selectionEnd)
    })
  }

  const withSelection = (fn: (v: string, s: number, e: number) => EditAction) => {
    const ta = textareaRef.current
    if (!ta) return
    applyAction(fn(ta.value, ta.selectionStart, ta.selectionEnd))
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
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save()
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
    if (!canPublish) {
      toast('未登录 GitHub 无法直接将图片上传至远程仓库，可直接使用 Markdown 插入外链图片或登录后上传', 'info')
      return
    }
    setUploading(true)
    try {
      const url = await uploadImage(file)
      withSelection((v, s, e) => insertBlock(v, s, e, `![${file.name}](${url})\n`))
      toast('图片已上传到仓库', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  /* ------------------------------ 发布或提交 PR ---------------------------- */
  const publishOrSubmitPR = async () => {
    if (!title.trim()) {
      toast('请先填写标题', 'warning')
      setMetaOpen(true)
      return
    }
    const post = save(true)
    if (!canPublish) {
      toast('未登录状态仅支持保存到本地草稿。登录 GitHub 账号后可直接发布或提交发表申请。', 'info', {
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
        setMetaOpen(true)
        return
      }
      if (encryptionPassword !== encryptionConfirm) {
        toast('两次输入的密码不一致', 'warning')
        setMetaOpen(true)
        return
      }
    }

    setPublishing(true)
    try {
      const markdown = encryptOnPublish
        ? await encryptPostMarkdown(post, encryptionPassword)
        : serializePost(post)

      if (canDirectPush) {
        // 管理员/直接拥有 push 权限：直推 main 分支
        const res = await commitPost(post.slug, markdown, `post(blog): ${post.title}`)
        recordPublishTime(post.slug, Date.now())
        // A plaintext local autosave must not shadow the encrypted repository
        // article on the public route after the next reload.
        if (encryptOnPublish) {
          deleteLocalPost(post.slug)
          setEncryptionPassword('')
          setEncryptionConfirm('')
        }
        toast(
          `已提交到 ${target.owner}/${target.repo} 的 ${res.path}\nGitHub Actions 正在部署中，约 1-2 分钟生效。`,
          'success',
          { label: '查看提交', href: res.commitUrl },
        )
      } else {
        // 普通已登录用户：提交 PR
        const pr = await submitPublicationPR(post.slug, markdown, post.title, target)
        toast(
          `已成功提交发表申请 PR #${pr.number}！等待仓库管理员审核。`,
          'success',
          { label: '查看 PR', href: pr.html_url },
        )
        navigate('/admin')
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

  /* ------------------------------ 滚动同步 -------------------------------- */
  const syncScroll = () => {
    const ta = textareaRef.current
    const pv = previewRef.current
    if (!ta || !pv || view !== 'split') return
    const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight)
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight)
  }

  const previewPost = buildDraftPost()

  if (protectedExisting && !unlocked) {
    return (
      <div className="container-page flex min-h-[65vh] items-center justify-center py-10">
        <PasswordPrompt
          title="解锁后编辑文章"
          description="该 GitHub 文章以密码加密。请输入密码后才会将内容载入编辑器。"
          onUnlock={unlockExisting}
        />
      </div>
    )
  }

  return (
    <div className={fullscreen ? 'fixed inset-0 z-[80] overflow-y-auto bg-white p-6 dark:bg-ink-950' : 'container-page pt-8'}>
      <div className="max-w-6xl mx-auto">
        {/* 顶部栏 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              markDirty()
            }}
            placeholder="输入文章标题…"
            className="flex-1 min-w-[15rem] font-serif text-2xl font-bold bg-transparent outline-none text-ink-900 placeholder:text-ink-400 dark:text-white"
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
              title="全屏"
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button onClick={download} className="btn-ghost h-9 w-9 !px-0" title="下载 .md">
              <Download size={16} />
            </button>
            <button onClick={() => save()} className="btn-outline h-9">
              <Save size={15} />
              <span className="hidden sm:inline">保存草稿</span>
            </button>

            {/* 发布/提交 PR 按钮 */}
            {canPublish ? (
              <button
                onClick={publishOrSubmitPR}
                disabled={publishing}
                className="btn-primary h-9"
                title={canDirectPush ? '直接提交到 main 分支' : '提交文章发表申请 (PR)'}
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
                      ? '发布到 GitHub'
                      : '申请发表 (PR)'}
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
                  placeholder={excerpt(content, 80)}
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
                      使用浏览器 Web Crypto 加密完整文章后再提交；密码不会写入 GitHub 或本机。之后查看和编辑都需要该密码。
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

        {/* -------------------------------- 编辑区 ------------------------------- */}
        <div className="card overflow-hidden">
          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-0.5 border-b border-ink-200/70 px-2 py-1.5 dark:border-white/10">
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
              title="上传图片到仓库"
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
                {words} 字 · 约 {previewPost.readingTime} 分钟
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
            className={`grid ${view === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'}`}
            style={{ height: fullscreen ? 'calc(100vh - 13rem)' : 'min(68vh, 44rem)' }}
          >
            {view !== 'preview' && (
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
            )}

            {view !== 'edit' && (
              <div
                ref={previewRef}
                className={`h-full overflow-y-auto bg-ink-50/40 p-5 dark:bg-white/[.02] ${
                  view === 'split'
                    ? 'hidden border-l border-ink-200/70 md:block dark:border-white/10'
                    : ''
                }`}
              >
                <h1 className="mb-6 font-serif text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
                  {title || '未命名文章'}
                </h1>
                <Markdown content={content} />
              </div>
            )}
          </div>
        </div>

        {/* 提示栏 */}
        <div className="mb-16 mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-400">
          <span className="flex items-center gap-1.5">
            <AlertCircle size={13} />
            草稿实时保存在本浏览器；
            {canDirectPush ? '点击「发布到 GitHub」直接推送至仓库' : '点击「申请发表」将创建审核 PR'}。
          </span>
          {canPublish ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Github size={13} />
              已连接 @{ghUser?.login} {canDirectPush ? '（仓库管理员）' : '（协作者）'}
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
          <span className="hidden sm:inline">快捷键：⌘S 保存 · ⌘B 粗体 · ⌘I 斜体 · ⌘K 链接</span>
        </div>
      </div>
    </div>
  )
}
