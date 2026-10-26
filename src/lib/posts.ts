import { createHeadingSlugger } from './headingSlug'
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { stripArticleDirectives } from './articleDirectives'
import { STORAGE_KEYS } from './config'
import { hiddenSeedSlugs } from './offlineLibrary'
import { OFFLINE } from './runtime'
import type { Post, PostMeta } from './types'

/* -------------------------------------------------------------------------- */
/*                          仓库中的 Markdown 文章                              */
/* -------------------------------------------------------------------------- */

// Vite 专属 API：在 VS Code 插件等非 Vite 打包环境（esbuild cjs/iife）中为空，
// 用 typeof 守卫避免在那些环境里加载即抛错。
// 注意：不能用 `typeof import.meta.glob === 'function'` 做守卫——Vite 生产构建只会替换
// `import.meta.glob(...)` 调用本身，守卫在浏览器里恒为 false，会导致仓库文章全部丢失。
// 因此改为直接调用并用 try/catch 兜底（非 Vite 环境下调用会抛错，此时返回空对象）。
function readRepoPostSources(): Record<string, string> {
  try {
    return import.meta.glob('/content/posts/**/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  } catch {
    return {}
  }
}

const rawModules = readRepoPostSources()

/* -------------------------------------------------------------------------- */
/*                                 工具函数                                    */
/* -------------------------------------------------------------------------- */

export function slugify(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return s || `post-${Date.now().toString(36)}`
}

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 去掉 Markdown 标记，用于摘要与字数统计 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/::begin_ui-ccs[\s\S]*?::end_ui-ccs/gi, ' ')
    .replace(/::begin_ui-graph[\s\S]*?::end_ui-graph/gi, ' ')
    .replace(/::begin_ui-choose[\s\S]*?::end_ui-choose/gi, ' ')
    .replace(/::begin_ui-select[\s\S]*?::end_ui-select/gi, ' ')
    .replace(/::begin_ui-if[\s\S]*?::end_ui-if/gi, ' ')
    .replace(/::ui-write(?:\[[^\]]*\])+/g, ' ')
    .replace(/::IF\[[\s\S]*?\]/g, ' ')
    .replace(/::IF_END/g, ' ')
    .replace(/<IF:[^,>]+,([^>]*)>/g, '$1')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countWords(md: string): number {
  // 文首排版指令（::set-font[…] 等）不是正文，不计入字数与阅读时长。
  const text = stripMarkdown(stripArticleDirectives(md))
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length
  const words = (
    text.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9'’-]+/g) || []
  ).length
  return cjk + words
}

export function readingTime(md: string): number {
  return Math.max(1, Math.round(countWords(md) / 400))
}

export function excerpt(md: string, len = 120): string {
  // 自动摘要不要把文首的排版指令原文截进卡片里。
  const text = stripMarkdown(stripArticleDirectives(md))
  return text.length > len ? `${text.slice(0, len)}…` : text
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === 'string')
    return value
      .split(/[,，]/)
      .map((v) => v.trim())
      .filter(Boolean)
  return []
}

function normalizeDate(value: unknown): string {
  if (!value) return today()
  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`
  }
  const s = String(value).trim()
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return s
}

/** 由原始 Markdown 构造一篇文章对象 */
export function buildPost(
  raw: string,
  opts: { slug?: string; path?: string; source: Post['source']; savedAt?: number },
): Post {
  const { data, content } = parseFrontmatter(raw)
  const fileSlug = opts.path?.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const title = String(data.title ?? '').trim() || fileSlug || '未命名文章'
  return {
    slug: String(data.slug ?? '').trim() || opts.slug || slugify(fileSlug || title),
    title,
    date: normalizeDate(data.date),
    updated: data.updated ? normalizeDate(data.updated) : undefined,
    summary: String(data.summary ?? data.description ?? '').trim() || excerpt(content),
    tags: toStringArray(data.tags),
    cover: data.cover ? String(data.cover) : undefined,
    draft: data.draft === true || data.draft === 'true',
    pinned: data.pinned === true || data.pinned === 'true',
    author: data.author ? String(data.author) : undefined,
    encryption:
      (data.encrypted === true || data.encrypted === 'true') && typeof data.encryption === 'string'
        ? data.encryption
        : undefined,
    content,
    source: opts.source,
    path: opts.path,
    savedAt: opts.savedAt,
    wordCount: countWords(content),
    readingTime: readingTime(content),
  }
}

export function postFingerprint(post: Pick<Post, 'title' | 'date' | 'updated' | 'summary' | 'tags' | 'cover' | 'draft' | 'pinned' | 'author' | 'content' | 'encryption'>): string {
  // An encrypted wrapper can be compared safely without attempting to expose its plaintext.
  if (post.encryption) return `encrypted:${post.encryption}`
  return JSON.stringify({
    title: post.title,
    date: post.date,
    updated: post.updated || '',
    summary: post.summary,
    tags: post.tags,
    cover: post.cover || '',
    draft: post.draft,
    pinned: Boolean(post.pinned),
    author: post.author || '',
    content: post.content,
  })
}

export function serializePost(post: Post | (PostMeta & { content: string })): string {
  return stringifyFrontmatter(
    {
      title: post.title,
      date: post.date,
      updated: post.updated,
      summary: post.summary,
      tags: post.tags,
      cover: post.cover,
      draft: post.draft || undefined,
      pinned: post.pinned || undefined,
      author: post.author,
    },
    post.content,
  )
}

/* -------------------------------------------------------------------------- */
/*                               本地草稿存储                                  */
/* -------------------------------------------------------------------------- */

interface StoredDraft {
  slug: string
  raw: string
  savedAt: number
  /** 是否打算以加密方式发布（仅本地草稿使用，见 Post.encryptIntent）。 */
  encrypt?: boolean
}

function readStore(): StoredDraft[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.drafts) || '[]')
    if (!Array.isArray(parsed)) return []
    // 只保留结构完整的条目：slug 与 raw 必须是字符串
    return parsed.filter(
      (d): d is StoredDraft =>
        !!d && typeof d === 'object' && typeof d.slug === 'string' && typeof d.raw === 'string',
    )
  } catch {
    return []
  }
}

function writeStore(items: StoredDraft[]) {
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
}

export function getLocalPosts(): Post[] {
  const posts: Post[] = []
  for (const d of readStore()) {
    // 单条损坏的草稿（缺字段、格式错误）只跳过它，不能让整个文章列表失效
    try {
      posts.push({
        ...buildPost(d.raw, { slug: d.slug, source: 'local', savedAt: d.savedAt }),
        encryptIntent: d.encrypt === true,
      })
    } catch (err) {
      console.warn('[posts] 跳过无法解析的本地草稿：', d?.slug, err)
    }
  }
  return posts
}

export function saveLocalPost(
  post: Post | (PostMeta & { content: string }),
  prevSlug?: string,
): Post {
  const items = readStore().filter((d) => d.slug !== post.slug && d.slug !== prevSlug)
  const raw = serializePost(post)
  const savedAt = Date.now()
  items.unshift({ slug: post.slug, raw, savedAt, encrypt: post.encryptIntent === true })
  writeStore(items)
  return { ...buildPost(raw, { slug: post.slug, source: 'local', savedAt }), encryptIntent: post.encryptIntent === true }
}

export function deleteLocalPost(slug: string) {
  writeStore(readStore().filter((d) => d.slug !== slug))
}

/**
 * 直接以「原始 Markdown」写入本地文章库（离线版发布 / 离线导入用）。
 *
 * 与 saveLocalPost 的区别：调用方已经准备好了完整的 Markdown 文本
 * （例如加密信封、或从别的设备导入的原文），这里不再由 Post 对象重新序列化，
 * 避免往返过程中丢失 frontmatter 里的 encrypted / encryption 等字段。
 */
export function saveLocalPostRaw(slug: string, raw: string, prevSlug?: string): Post {
  const items = readStore().filter((d) => d.slug !== slug && d.slug !== prevSlug)
  const savedAt = Date.now()
  let encrypt = false
  try {
    const data = parseFrontmatter(raw).data
    encrypt = data.encrypted === true || data.encrypted === 'true'
  } catch {
    encrypt = false
  }
  items.unshift({ slug, raw, savedAt, encrypt })
  try {
    writeStore(items)
  } catch (err) {
    if (!OFFLINE) throw err
    // 离线版这里失败的往往是「整库体积」：文章内容、图片 data URL、以及内置文章的
    // 删除记录同处一个存储，写失败时三者都可能不同步，必须一并提示去核对。
    const message = err instanceof Error ? err.message : '未知错误'
    console.error('[posts] 离线文章库写入失败', err)
    throw new Error(
      `离线文章库写入失败（${message}）：《${slug}》可能没有保存成功。` +
        '同时请核对内置文章的隐藏记录（「内容管理」顶部的隐藏提示）——' +
        '它们与文章库同库写入，这次可能一起失败了。建议先导出离线档案备份，再清理空间后重试。',
    )
  }
  return buildPost(raw, { slug, source: 'local', savedAt })
}

/**
 * 文章已成功提交到仓库后，删除内容完全相同的本地草稿。
 * 草稿仍在覆盖公开版本（getAllPosts 中本地优先），不删除会导致仓库里的新版本永远看不到。
 * 若草稿在提交之后又被修改（内容不同），则保留，避免丢失用户的新改动。
 */
export function removeLocalPostIfSynced(slug: string, markdown: string): boolean {
  const items = readStore()
  const match = items.find((d) => d.slug === slug)
  if (!match || match.raw !== markdown) return false
  writeStore(items.filter((d) => d.slug !== slug))
  return true
}

export function localPostExists(slug: string): boolean {
  return readStore().some((d) => d.slug === slug)
}

/* -------------------------------------------------------------------------- */
/*                          GitHub 发布时间记录                                 */
/* -------------------------------------------------------------------------- */

export { recordPublishTime } from './publishTimes'
import { readPublishTimeStore } from './publishTimes'

export function getPublishTime(post: Post): number | null {
  const store = readPublishTimeStore()
  if (store[post.slug]) return store[post.slug]

  // 如果是仓库文章但未在当前设备单独记录过发布时间，则以文章日期作为发布时间基准
  if (post.source === 'repo') {
    const rawDate = post.updated || post.date
    const parsed = Date.parse(rawDate)
    return isNaN(parsed) ? null : parsed
  }

  return null
}

/* -------------------------------------------------------------------------- */
/*                                  聚合查询                                   */
/* -------------------------------------------------------------------------- */

export function getRepoPosts(): Post[] {
  const posts = Object.entries(rawModules).map(([path, raw]) =>
    buildPost(raw, { path: path.replace(/^\//, ''), source: 'repo' }),
  )
  if (!OFFLINE) return posts
  // 离线版：内置文章是写死在 HTML 里的，删不掉，只能记住「本机已隐藏」并把它过滤掉。
  // 想真的从仓库消失，请到线上站点删除——离线文件不联网，也不会替用户提交任何改动。
  const hidden = hiddenSeedSlugs()
  if (hidden.length === 0) return posts
  return posts.filter((post) => !hidden.includes(post.slug))
}

/** 指定 slug 对应的仓库加密文章（不存在则返回 undefined）。
 *  用于识别「加密文章的本地草稿」：这类草稿发布时必须重新加密。 */
export function getEncryptedRepoPost(slug: string): Post | undefined {
  return getRepoPosts().find((p) => p.slug === slug && p.encryption)
}

function sortPosts(posts: Post[]): Post[] {
  return posts.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
  })
}

/** 公开聚合：本地草稿与仓库文章同名时，以本地版本为准。
 * 例外：仓库中的加密文章不能被同名的明文本地草稿顶替，
 * 否则公开页面会绕过密码直接显示明文内容。
 * 本地版本自带加密信封时允许覆盖——离线版「重新加密发布」正是这条路径。 */
export function getAllPosts(): Post[] {
  const map = new Map<string, Post>()
  for (const p of getRepoPosts()) map.set(p.slug, p)
  for (const p of getLocalPosts()) {
    if (map.get(p.slug)?.encryption && !p.encryption) continue
    map.set(p.slug, p)
  }
  return sortPosts([...map.values()])
}

/** 文章管理后台列表：区分草稿和已发布的文章，同名草稿与已发布文章均完整列出 */
export function getAllAdminPosts(): Post[] {
  const repoPosts = getRepoPosts()
  const localPosts = getLocalPosts()
  return sortPosts([...repoPosts, ...localPosts])
}

export function getPublishedPosts(): Post[] {
  return getAllPosts().filter((p) => !p.draft)
}

export function getPostBySlug(slug: string, source?: Post['source']): Post | undefined {
  if (source === 'local') {
    return getLocalPosts().find((p) => p.slug === slug)
  }
  if (source === 'repo') {
    return getRepoPosts().find((p) => p.slug === slug)
  }
  return getAllPosts().find((p) => p.slug === slug)
}

export function getAllTags(posts: Post[]): { name: string; count: number }[] {
  const counter = new Map<string, number>()
  for (const p of posts) {
    if (p && Array.isArray(p.tags)) {
      for (const t of p.tags) {
        if (t) counter.set(t, (counter.get(t) ?? 0) + 1)
      }
    }
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** 加密文章在公开 frontmatter 中使用的占位日期（真实日期只存在于密文里）。 */
export const ENCRYPTED_PLACEHOLDER_DATE = '1970-01-01'

/** 文章的日期是否可以公开展示：加密文章的占位日期不是真实发布日期，不应显示。 */
export function hasPublicDate(post: Pick<Post, 'date' | 'encryption'>): boolean {
  return !(post.encryption && post.date === ENCRYPTED_PLACEHOLDER_DATE)
}

export function getArchive(posts: Post[]): { year: string; posts: Post[] }[] {
  const map = new Map<string, Post[]>()
  for (const p of posts) {
    const year = hasPublicDate(p) ? (p.date || '').slice(0, 4) || '其他' : '其他'
    if (!map.has(year)) map.set(year, [])
    map.get(year)!.push(p)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, list]) => ({ year, posts: list }))
}

export function searchPosts(posts: Post[], query: string): Post[] {
  const q = query.trim().toLowerCase()
  if (!q) return posts
  return posts.filter((p) =>
    [p.title, p.summary, p.tags.join(' '), p.content].join('\n').toLowerCase().includes(q),
  )
}

/** 从 Markdown 中抽取标题，生成目录 */
export interface TocItem {
  id: string
  text: string
  level: number
}

interface MarkdownFence {
  marker: '`' | '~'
  length: number
}

function parseFence(line: string): MarkdownFence | null {
  const match = line.match(/^\s*([`~]{3,})/)
  if (!match) return null
  return { marker: match[1][0] as '`' | '~', length: match[1].length }
}

/**
 * 提取标题在最终 HAST 中的纯文本。
 *
 * 不能复用摘要用的 stripMarkdown()：它会把行内代码、公式等内容整体删掉，
 * 而 rehype-slug 是根据标题的实际 textContent 生成 id 的。这里保留这些文字，
 * 只去掉 Markdown 包装符号，确保目录标题与正文锚点使用同一份输入。
 */
function headingPlainText(markdown: string): string {
  const literals: string[] = []
  const keepLiteral = (value: string): string => {
    const token = `\u0000${literals.length}\u0000`
    literals.push(value)
    return token
  }

  let text = markdown.trim()
  // 反斜杠转义、代码 span 与公式中的符号不是 Markdown 包装，先保护起来。
  text = text.replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, (_match, char: string) => keepLiteral(char))
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks: string, code: string) => keepLiteral(code))
  text = text.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g, (_match, block: string, inline: string) =>
    keepLiteral(block ?? inline ?? ''),
  )
  // 自动链接显示的是 URL 本身；图片没有文本节点，普通链接则保留标签文字。
  text = text.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  text = text.replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)]\[[^\]]*]/g, '$1')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/[*_~]{1,3}/g, '')
  text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower] ?? entity
  })
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => literals[Number(index)] ?? '').trim()
}

export function extractToc(md: string): TocItem[] {
  const lines = md.split('\n')
  const items: TocItem[] = []
  // 与正文 rehype 插件共享同一个生成器，包括重复标题和空 slug 回退规则。
  const slugHeading = createHeadingSlugger()
  const callouts: number[] = []
  let fence: MarkdownFence | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const parsedFence = parseFence(line)
    if (parsedFence) {
      if (!fence) {
        fence = parsedFence
      } else if (parsedFence.marker === fence.marker && parsedFence.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue

    // 展示框与直角坐标系内容由独立组件渲染，不参与正文标题锚点计数，也不进入目录。
    const showStart = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i)
    if (showStart) {
      let end = index + 1
      while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) end += 1
      if (end < lines.length) {
        index = end
        continue
      }
    }

    const ccsStart = line.match(/^\s*::begin_ui-ccs(?:\{[^}]*\})?\s*$/i)
    if (ccsStart) {
      let end = index + 1
      while (end < lines.length && !/^\s*::end_ui-ccs\s*$/i.test(lines[end])) end += 1
      if (end < lines.length) {
        index = end
        continue
      }
    }

    const uiBlockStart = line.match(/^\s*::begin_ui-(graph|choose|select|if)(?=$|\[|\s)/i)
    if (uiBlockStart) {
      const endRe = new RegExp(`^\\s*::end_ui-${uiBlockStart[1]}\\s*$`, 'i')
      let end = index + 1
      while (end < lines.length && !endRe.test(lines[end])) end += 1
      if (end < lines.length) {
        index = end
        continue
      }
    }

    const calloutClose = line.match(/^ *(:{3,})\s*$/)
    if (calloutClose && callouts.length > 0) {
      const colons = calloutClose[1].length
      const top = callouts[callouts.length - 1]
      if (colons >= top) {
        callouts.pop()
        continue
      }
    }

    const calloutOpen = line.match(
      /^ *(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{open\})?\s*$/i,
    )
    if (calloutOpen) {
      callouts.push(calloutOpen[1].length)
      continue
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!heading) continue

    const text = headingPlainText(heading[2])
    const level = heading[1].length
    const id = slugHeading(text)
    // 折叠框内的标题不显示在目录中；仍参与 slug 计数，以匹配正文渲染后的锚点后缀。
    if (callouts.length === 0 && level >= 2 && level <= 4) {
      items.push({ id, text, level })
    }
  }
  return items
}

export function formatDate(iso: string, style: 'full' | 'short' = 'full'): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return style === 'full' ? `${m[1]} 年 ${+m[2]} 月 ${+m[3]} 日` : `${m[2]}-${m[3]}`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.round(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}
