import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { STORAGE_KEYS } from './config'
import type { Post, PostMeta } from './types'

/* -------------------------------------------------------------------------- */
/*                          仓库中的 Markdown 文章                              */
/* -------------------------------------------------------------------------- */

const rawModules = import.meta.glob('/content/posts/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

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
  const text = stripMarkdown(md)
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
  const text = stripMarkdown(md)
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
    content,
    source: opts.source,
    path: opts.path,
    savedAt: opts.savedAt,
    wordCount: countWords(content),
    readingTime: readingTime(content),
  }
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
}

function readStore(): StoredDraft[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.drafts) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStore(items: StoredDraft[]) {
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
}

export function getLocalPosts(): Post[] {
  return readStore().map((d) =>
    buildPost(d.raw, { slug: d.slug, source: 'local', savedAt: d.savedAt }),
  )
}

export function saveLocalPost(
  post: Post | (PostMeta & { content: string }),
  prevSlug?: string,
): Post {
  const items = readStore().filter((d) => d.slug !== post.slug && d.slug !== prevSlug)
  const raw = serializePost(post)
  const savedAt = Date.now()
  items.unshift({ slug: post.slug, raw, savedAt })
  writeStore(items)
  return buildPost(raw, { slug: post.slug, source: 'local', savedAt })
}

export function deleteLocalPost(slug: string) {
  writeStore(readStore().filter((d) => d.slug !== slug))
}

export function localPostExists(slug: string): boolean {
  return readStore().some((d) => d.slug === slug)
}

/* -------------------------------------------------------------------------- */
/*                          GitHub 发布时间记录                                 */
/* -------------------------------------------------------------------------- */

const PUBLISHED_TIMES_KEY = 'starlog:published-times'

function readPublishTimes(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(PUBLISHED_TIMES_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function recordPublishTime(slug: string, timestamp = Date.now()) {
  const store = readPublishTimes()
  store[slug] = timestamp
  localStorage.setItem(PUBLISHED_TIMES_KEY, JSON.stringify(store))
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
}

export function getPublishTime(post: Post): number | null {
  const store = readPublishTimes()
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
  return Object.entries(rawModules).map(([path, raw]) =>
    buildPost(raw, { path: path.replace(/^\//, ''), source: 'repo' }),
  )
}

function sortPosts(posts: Post[]): Post[] {
  return posts.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
  })
}

/** 公开聚合：本地草稿与仓库文章同名时，以本地版本为准 */
export function getAllPosts(): Post[] {
  const map = new Map<string, Post>()
  for (const p of getRepoPosts()) map.set(p.slug, p)
  for (const p of getLocalPosts()) map.set(p.slug, p)
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

export function getArchive(posts: Post[]): { year: string; posts: Post[] }[] {
  const map = new Map<string, Post[]>()
  for (const p of posts) {
    const year = (p.date || '').slice(0, 4) || '其他'
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

export function extractToc(md: string): TocItem[] {
  const withoutCode = md.replace(/```[\s\S]*?```/g, '')
  const items: TocItem[] = []
  const used = new Map<string, number>()
  for (const line of withoutCode.split('\n')) {
    const m = line.match(/^(#{2,4})\s+(.+?)\s*#*\s*$/)
    if (!m) continue
    const text = stripMarkdown(m[2])
    // 与 rehype-slug（github-slugger）保持一致的 id 生成规则
    let id = text
      .toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]+/gu, '')
    const seen = used.get(id)
    if (seen !== undefined) {
      used.set(id, seen + 1)
      id = `${id}-${seen + 1}`
    } else {
      used.set(id, 0)
    }
    items.push({ id, text, level: m[1].length })
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
