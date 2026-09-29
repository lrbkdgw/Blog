import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Columns2,
  Download,
  Eye,
  Github,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Quote,
  Save,
  Sigma,
  Strikethrough,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import { useToast } from '../components/Toast'
import { useAuth } from '../lib/auth'
import { commitPost, getRepoTarget, uploadImage } from '../lib/github'
import {
  countWords,
  deleteLocalPost,
  excerpt,
  getPostBySlug,
  readingTime,
  saveLocalPost,
  serializePost,
  slugify,
  today,
} from '../lib/posts'
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
`

export default function Editor() {
  const { slug: routeSlug } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canPublish, ghUser } = useAuth()

  const existing = useMemo(() => (routeSlug ? getPostBySlug(routeSlug) : undefined), [routeSlug])
  const originalSlug = useRef(existing?.slug)

  const [title, setTitle] = useState(existing?.title ?? '')
  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [date, setDate] = useState(existing?.date ?? today())
  const [tagsText, setTagsText] = useState(existing?.tags.join(', ') ?? '')
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [cover, setCover] = useState(existing?.cover ?? '')
  const [draft, setDraft] = useState(existing?.draft ?? false)
  const [pinned, setPinned] = useState(existing?.pinned ?? false)
  const [content, setContent] = useState(existing?.content ?? STARTER)

  const [view, setView] = useState<ViewMode>('split')
  const [metaOpen, setMetaOpen] = useState(!existing)
  const [fullscreen, setFullscreen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(existing?.savedAt ?? null)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const tags = useMemo(
    () => tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    [tagsText],
  )
  const effectiveSlug = slug.trim() || slugify(title) || 'untitled'
  const words = useMemo(() => countWords(content), [content])

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
      tags,
      cover: cover.trim() || undefined,
      draft,
      pinned,
      content,
      source: 'local',
      wordCount: words,
      readingTime: readingTime(content),
    }),
    [effectiveSlug, title, date, summary, content, tags, cover, draft, pinned, existing, words],
  )

  /* ------------------------------- 保存草稿 ------------------------------- */
  const save = useCallback(
    (silent = false) => {
      const post = buildDraftPost()
      saveLocalPost(post, originalSlug.current)
      originalSlug.current = post.slug
      setSavedAt(Date.now())
      setDirty(false)
      if (!silent) {
        toast('已保存到本地草稿', 'success')
        // 仅在显式保存时同步 URL（自动保存时跳转会打断输入）
        if (routeSlug !== post.slug) navigate(`/admin/edit/${post.slug}`, { replace: true })
      }
      return post
    },
    [buildDraftPost, navigate, routeSlug, toast],
  )

  // 自动保存（停止输入 2.5 秒后）
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
    { icon: Bold, title: '粗体 (⌘B)', run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '**', '**', '粗体')) },
    { icon: Italic, title: '斜体 (⌘I)', run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '*', '*', '斜体')) },
    { icon: Strikethrough, title: '删除线', run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '~~', '~~', '删除')) },
    { icon: Heading2, title: '标题', run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '## ')) },
    { icon: Quote, title: '引用', run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '> ')) },
    { icon: List, title: '无序列表', run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '- ')) },
    { icon: ListOrdered, title: '有序列表', run: () => withSelection((v, s, e) => toggleLinePrefix(v, s, e, '1. ')) },
    { icon: Link2, title: '链接 (⌘K)', run: () => withSelection((v, s, e) => toggleWrap(v, s, e, '[', '](https://)', '链接文字')) },
    { icon: Code2, title: '代码块', run: () => withSelection((v, s, e) => insertBlock(v, s, e, '```ts\n\n```\n')) },
    { icon: Sigma, title: '数学公式', run: () => withSelection((v, s, e) => insertBlock(v, s, e, '$$\n\\int_a^b f(x)\\,\\mathrm{d}x\n$$\n')) },
    {
      icon: Table2,
      title: '表格',
      run: () =>
        withSelection((v, s, e) =>
          insertBlock(v, s, e, '| 列 A | 列 B |\n| --- | --- |\n| 内容 | 内容 |\n'),
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
      toast('上传图片需要先连接 GitHub（设置 → GitHub 连接）', 'warning')
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

  /* ------------------------------ 发布到 GitHub ---------------------------- */
  const publish = async () => {
    if (!title.trim()) {
      toast('请先填写标题', 'warning')
      setMetaOpen(true)
      return
    }
    const post = save(true)
    if (!canPublish) {
      toast('尚未连接 GitHub，请到「设置」里填写 Token', 'warning')
      return
    }
    setPublishing(true)
    try {
      const markdown = serializePost(post)
      const res = await commitPost(post.slug, markdown, `post(blog): ${post.title}`)
      const target = getRepoTarget()
      toast(
        `已提交到 ${target.owner}/${target.repo} 的 ${res.path}\nGitHub Actions 正在重新部署站点，约 1-2 分钟后生效。`,
        'success',
        { label: '查看提交', href: res.commitUrl },
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : '发布失败', 'error')
    } finally {
      setPublishing(false)
    }
  }

  /* --------------------------------- 导出 --------------------------------- */
  const download = () => {
    const blob = new Blob([serializePost(buildDraftPost())], { type: 'text/markdown;charset=utf-8' })
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

  return (
    <div className={fullscreen ? 'fixed inset-0 z-[80] overflow-auto bg-[#fbfbfd] dark:bg-ink-950' : ''}>
      <div className={`${fullscreen ? 'px-4 py-4' : 'container-page pt-8'}`}>
        {/* ------------------------------ 顶部操作条 ----------------------------- */}
        <div className="card sticky top-[4.25rem] z-30 mb-4 flex flex-wrap items-center gap-2 p-2.5 !bg-white/90 dark:!bg-ink-900/85">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              markDirty()
            }}
            placeholder="文章标题…"
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-serif text-lg font-semibold tracking-tight text-ink-900 outline-none placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-ink-400 dark:text-white"
          />

          <div className="flex items-center gap-1.5">
            <div className="hidden items-center gap-0.5 rounded-lg bg-ink-100/80 p-0.5 sm:flex dark:bg-white/5">
              {(
                [
                  { id: 'edit', icon: Pencil, label: '编辑' },
                  { id: 'split', icon: Columns2, label: '分栏' },
                  { id: 'preview', icon: Eye, label: '预览' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setView(m.id)}
                  title={m.label}
                  className={`rounded-md p-1.5 transition ${
                    view === m.id
                      ? 'bg-white text-brand-600 shadow-sm dark:bg-white/10 dark:text-brand-300'
                      : 'text-ink-400 hover:text-ink-700 dark:hover:text-ink-200'
                  }`}
                >
                  <m.icon size={15} />
                </button>
              ))}
            </div>

            <button onClick={() => setFullscreen((v) => !v)} className="btn-ghost h-9 w-9 !px-0" title="全屏">
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button onClick={download} className="btn-ghost h-9 w-9 !px-0" title="下载 .md">
              <Download size={16} />
            </button>
            <button onClick={() => save()} className="btn-outline h-9">
              <Save size={15} />
              <span className="hidden sm:inline">保存草稿</span>
            </button>
            <button onClick={publish} disabled={publishing} className="btn-primary h-9">
              {publishing ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />}
              <span className="hidden sm:inline">{publishing ? '发布中…' : '发布到 GitHub'}</span>
            </button>
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
              <span className="font-mono text-xs font-normal text-ink-400">/posts/{effectiveSlug}</span>
              {draft && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  草稿
                </span>
              )}
            </span>
            <ChevronDown size={16} className={`text-ink-400 transition-transform ${metaOpen ? 'rotate-180' : ''}`} />
          </button>

          {metaOpen && (
            <div className="grid gap-4 border-t border-ink-200/70 p-4 sm:grid-cols-2 dark:border-white/10">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">URL 别名 (slug)</label>
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
                <label className="mb-1.5 block text-xs font-medium text-ink-500">标签（逗号分隔）</label>
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
                <label className="mb-1.5 block text-xs font-medium text-ink-500">封面图 URL（可选）</label>
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
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-ink-500">摘要（留空自动截取正文）</label>
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
                  <label key={c.label} className="flex cursor-pointer items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
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
              <span className="hidden sm:inline">{words} 字 · 约 {previewPost.readingTime} 分钟</span>
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
                  view === 'split' ? 'hidden border-l border-ink-200/70 md:block dark:border-white/10' : ''
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

        {/* 提示 */}
        <div className="mb-16 mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-400">
          <span className="flex items-center gap-1.5">
            <AlertCircle size={13} />
            草稿自动保存在本浏览器；点「发布到 GitHub」才会写入仓库。
          </span>
          {canPublish ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Github size={13} />
              已连接 @{ghUser?.login}
            </span>
          ) : (
            <Link to="/admin/settings" className="flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-300">
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
