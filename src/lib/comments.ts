/**
 * 评论功能（issue #10）：登录后的用户可以评论。
 *
 * 存储模型与文章一致，分两层：
 * - 仓库层：连接 GitHub 的用户发表评论时，以 JSON 文件提交到
 *   `content/comments/<slug>.json`，所有访客都能实时读到；
 * - 本地层：仅密码登录（未连接 GitHub）时，评论保存在当前浏览器
 *   localStorage，只对本浏览器可见。
 */
import { getRepoTarget, readRemoteJson, writeRemoteJson } from './github'
import type { GhUser } from './github'

export interface CommentAuthor {
  /** GitHub 登录名（本地评论没有） */
  login?: string
  name: string
  avatar?: string
}

export interface BlogComment {
  id: string
  author: CommentAuthor
  text: string
  createdAt: number
  /** local = 只保存在当前浏览器；repo = 已提交到仓库 */
  source: 'repo' | 'local'
}

interface CommentsFile {
  version: 1
  comments: Omit<BlogComment, 'source'>[]
}

const MAX_TEXT = 2000
const MAX_NAME = 60
const MAX_COMMENTS = 500

function commentsPath(slug: string): string {
  return `content/comments/${slug}.json`
}

export function commentStorageKey(): string {
  return 'starlog:comments'
}

/* ------------------------------- 文本清洗 -------------------------------- */

function cleanText(text: string): string {
  // 去掉除换行/制表符之外的控制字符
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (!cleaned) throw new Error('评论内容不能为空')
  if (cleaned.length > MAX_TEXT) throw new Error(`评论太长啦，最多 ${MAX_TEXT} 字`)
  return cleaned
}

function cleanAuthor(author: CommentAuthor): CommentAuthor {
  return {
    login: author.login?.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 39) || undefined,
    name: String(author.name || '匿名').slice(0, MAX_NAME),
    avatar: author.avatar && /^https:\/\//.test(author.avatar) ? author.avatar : undefined,
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 校验从仓库读到的评论数据，丢弃坏数据（防注入/防损坏） */
function sanitizeComments(raw: unknown[]): Omit<BlogComment, 'source'>[] {
  const out: Omit<BlogComment, 'source'>[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > MAX_TEXT) continue
    const author = (c.author ?? {}) as Record<string, unknown>
    out.push({
      id: typeof c.id === 'string' && c.id.length <= 64 ? c.id : newId(),
      text: c.text,
      createdAt: typeof c.createdAt === 'number' && c.createdAt > 0 ? c.createdAt : Date.now(),
      author: cleanAuthor({
        login: typeof author.login === 'string' ? author.login : undefined,
        name: typeof author.name === 'string' ? author.name : '匿名',
        avatar: typeof author.avatar === 'string' ? author.avatar : undefined,
      }),
    })
  }
  return out.slice(0, MAX_COMMENTS)
}

/* ------------------------------- 仓库评论 -------------------------------- */

const CACHE_TTL = 60 * 1000
const cache = new Map<string, { at: number; comments: BlogComment[] }>()

/** 拉取仓库中某篇文章的评论（所有访客可读，60 秒内存缓存） */
export async function fetchRepoComments(slug: string, force = false): Promise<BlogComment[]> {
  const hit = cache.get(slug)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return hit.comments

  const file = await readRemoteJson<CommentsFile>(commentsPath(slug), getRepoTarget())
  const list = sanitizeComments(Array.isArray(file?.data?.comments) ? file.data.comments : [])
  const comments = list.map((c) => ({ ...c, source: 'repo' as const }))
  cache.set(slug, { at: Date.now(), comments })
  return comments
}

/** 评论提交到仓库；需要 canPublish（已连接 GitHub）。返回提交链接。 */
export async function publishRepoComment(slug: string, text: string, user: GhUser): Promise<string> {
  const cleaned = cleanText(text)
  const current = await readRemoteJson<CommentsFile>(commentsPath(slug), getRepoTarget())
  const list = sanitizeComments(Array.isArray(current?.data?.comments) ? current.data.comments : [])
  list.push({
    id: newId(),
    text: cleaned,
    createdAt: Date.now(),
    author: cleanAuthor({
      login: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
    }),
  })
  const url = await writeRemoteJson(
    commentsPath(slug),
    { version: 1, comments: list } satisfies CommentsFile,
    `chore(comments): @${user.login} 评论 ${slug}`,
  )
  await fetchRepoComments(slug, true)
  return url
}

/** 删除仓库评论（仅评论作者本人，按 GitHub login 判断） */
export async function deleteRepoComment(slug: string, id: string, user: GhUser): Promise<void> {
  const current = await readRemoteJson<CommentsFile>(commentsPath(slug), getRepoTarget())
  const list = sanitizeComments(Array.isArray(current?.data?.comments) ? current.data.comments : [])
  const target = list.find((c) => c.id === id)
  if (!target) throw new Error('评论不存在或已被删除')
  if (target.author.login !== user.login) throw new Error('只能删除自己的评论')
  const next = list.filter((c) => c.id !== id)
  await writeRemoteJson(
    commentsPath(slug),
    { version: 1, comments: next } satisfies CommentsFile,
    `chore(comments): @${user.login} 删除一条评论（${slug}）`,
  )
  await fetchRepoComments(slug, true)
}

/* ------------------------------- 本地评论 -------------------------------- */

function readLocalStore(): Record<string, Omit<BlogComment, 'source'>[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(commentStorageKey()) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalStore(store: Record<string, Omit<BlogComment, 'source'>[]>) {
  localStorage.setItem(commentStorageKey(), JSON.stringify(store))
}

export function getLocalComments(slug: string): BlogComment[] {
  return sanitizeComments(readLocalStore()[slug] ?? []).map((c) => ({ ...c, source: 'local' as const }))
}

/** 仅密码登录（未连接 GitHub）时的本地评论：只保存在当前浏览器 */
export function saveLocalComment(slug: string, text: string, name: string): BlogComment {
  const cleaned = cleanText(text)
  const store = readLocalStore()
  const comment: Omit<BlogComment, 'source'> = {
    id: newId(),
    text: cleaned,
    createdAt: Date.now(),
    author: cleanAuthor({ name: name.trim() || '本地用户' }),
  }
  store[slug] = [...(store[slug] ?? []), comment].slice(-MAX_COMMENTS)
  writeLocalStore(store)
  return { ...comment, source: 'local' }
}

export function deleteLocalComment(slug: string, id: string) {
  const store = readLocalStore()
  store[slug] = (store[slug] ?? []).filter((c) => c.id !== id)
  writeLocalStore(store)
}
