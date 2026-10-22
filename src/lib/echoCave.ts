import { echoCaveConfig } from './config'
import { getRepoTarget, getToken, githubGraphql } from './github'
import { OFFLINE } from './runtime'

// 离线构建时编译期置空所有在线端点，确保单文件离线版不含任何外部请求地址
const API = OFFLINE ? '' : 'https://api.github.com'
const HITOKOTO_API = OFFLINE ? '' : 'https://v1.hitokoto.cn'

// 避免在源码字面量中直接出现连续的 HTML 注释起始序列，防止内联脚本检查误判
export const ECHO_CAVE_MARKER = `<${'!--'} starlog-echo-cave -->`
export const SENDER_MARKER_PREFIX = `<${'!--'} echo-sender:`
const SENDER_MARKER_RE = new RegExp(`<${'!--'}\\s*echo-sender:([a-z0-9:_-]+)\\s*-->`, 'gi')
const HTML_COMMENT_RE = new RegExp(`<${'!--'}[\\s\\S]*?-->`, 'g')

export const ECHO_CAVE_TITLE = echoCaveConfig.title
export const ECHO_MAX_PER_HOUR = 3
export const ECHO_MAX_PER_DAY = 10
export const ECHO_HOUR_MS = 60 * 60 * 1000
export const ECHO_DAY_MS = 24 * 60 * 60 * 1000

const OFFLINE_ECHOES_KEY = 'starlog:offline-echoes'
const PENDING_DRAFT_KEY = 'starlog:echo-pending-draft'

const CONTRIBUTOR_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
])

export interface RawEchoComment {
  id: string
  body: string
  createdAt: string
  authorLogin?: string | null
  authorAssociation?: string | null
}

export interface EchoItem {
  id: string
  text: string
  from?: string
  source: 'discussion' | 'hitokoto' | 'builtin'
  createdAt?: string
  senderKey?: string
}

export interface FilterEchoOptions {
  /** 仓库贡献者登录名集合（大小写不敏感） */
  contributorLogins?: Iterable<string>
  /** 仓库拥有者登录名 */
  repoOwner?: string
}

export interface EchoCaveSnapshot {
  discussionNumber: number | null
  discussionNodeId: string | null
  rawComments: RawEchoComment[]
  echoes: EchoItem[]
  contributorLogins: Set<string>
}

export const FALLBACK_ECHOES: EchoItem[] = [
  { id: 'builtin-1', text: '山谷不语，风替它记住了每一句回音。', source: 'builtin' },
  { id: 'builtin-2', text: '把此刻写进风里，总有人会在未来的某一天听见。', source: 'builtin' },
  { id: 'builtin-3', text: '星光走了几万年才落进眼底，每一句相遇都不算晚。', source: 'builtin' },
  { id: 'builtin-4', text: '愿你在漫长的旅途里，始终保有一方安静的回声。', source: 'builtin' },
  { id: 'builtin-5', text: '万物皆有裂痕，那是光照进来的地方。', source: 'builtin' },
  { id: 'builtin-6', text: '夜色温柔，不妨停下来听一听远处的回响。', source: 'builtin' },
]

/** 提取匿名中继发送者标记并清洗评论正文 */
export function parseEchoCommentBody(rawBody: string): {
  cleanText: string
  relaySenderKey: string | null
} {
  let relaySenderKey: string | null = null
  const match = SENDER_MARKER_RE.exec(rawBody)
  SENDER_MARKER_RE.lastIndex = 0
  if (match && match[1]) {
    relaySenderKey = match[1].trim().toLowerCase()
  }
  const cleanText = rawBody
    .replace(HTML_COMMENT_RE, '')
    .replace(/\r\n/g, '\n')
    .trim()
  return { cleanText, relaySenderKey }
}

/** 判断某条回声是否来自仓库贡献者（仓库贡献者不受频率限制） */
export function isEchoFromContributor(
  comment: Pick<RawEchoComment, 'body' | 'authorLogin' | 'authorAssociation'>,
  options: FilterEchoOptions = {},
): boolean {
  const { relaySenderKey } = parseEchoCommentBody(comment.body)
  // 通过匿名服务端中继写入的访客留言按匿名发送者计频，不视为仓库贡献者
  if (relaySenderKey && relaySenderKey.startsWith('anon:')) {
    return false
  }

  const assoc = (comment.authorAssociation || '').trim().toUpperCase()
  if (CONTRIBUTOR_ASSOCIATIONS.has(assoc)) return true

  const login = (comment.authorLogin || '').trim().toLowerCase()
  if (!login) return false

  const owner = (options.repoOwner ?? getRepoTarget().owner).trim().toLowerCase()
  if (owner && login === owner) return true

  if (options.contributorLogins) {
    for (const item of options.contributorLogins) {
      if (item.trim().toLowerCase() === login) return true
    }
  }
  return false
}

/** 获取评论对应的限流归属键 */
export function resolveSenderKey(
  comment: Pick<RawEchoComment, 'body' | 'authorLogin'>,
): string {
  const { relaySenderKey } = parseEchoCommentBody(comment.body)
  if (relaySenderKey) return relaySenderKey
  const login = (comment.authorLogin || '').trim().toLowerCase()
  return login ? `user:${login}` : 'user:anonymous'
}

/**
 * 按 Issue #93 规则过滤并返回可识别的回声列表：
 * - 每小时最多 3 条，每天最多 10 条
 * - 若超过限制，则只识别每小时发送的前 3 条或每天发送的前 10 条
 * - 仓库贡献者不受限制
 */
export function filterRecognizedEchoes(
  comments: RawEchoComment[],
  options: FilterEchoOptions = {},
): EchoItem[] {
  const indexed = comments.map((comment, index) => {
    const parsed = Date.parse(comment.createdAt)
    return {
      comment,
      index,
      timestamp: Number.isFinite(parsed) ? parsed : 0,
    }
  })

  // 严格按发送时间升序排列，保证「只识别前 3 条 / 前 10 条」
  indexed.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)

  const acceptedBySender = new Map<string, number[]>()
  const recognized: EchoItem[] = []

  for (const { comment, timestamp } of indexed) {
    const { cleanText } = parseEchoCommentBody(comment.body)
    if (!cleanText) continue

    const senderKey = resolveSenderKey(comment)
    const contributor = isEchoFromContributor(comment, options)

    if (!contributor) {
      const history = acceptedBySender.get(senderKey) ?? []
      let inPastHour = 0
      let inPastDay = 0
      for (const prev of history) {
        const delta = timestamp - prev
        if (delta >= 0 && delta < ECHO_HOUR_MS) inPastHour++
        if (delta >= 0 && delta < ECHO_DAY_MS) inPastDay++
      }
      if (inPastHour >= ECHO_MAX_PER_HOUR || inPastDay >= ECHO_MAX_PER_DAY) {
        continue
      }
      history.push(timestamp)
      acceptedBySender.set(senderKey, history)
    }

    recognized.push({
      id: `discussion-${comment.id}`,
      text: cleanText,
      source: 'discussion',
      createdAt: comment.createdAt,
      senderKey,
    })
  }

  return recognized
}

/** 判断某个话题是否为回声洞专属 Discussion */
export function isEchoCaveDiscussion(item: {
  title?: string | null
  body?: string | null
}): boolean {
  const body = item.body ?? ''
  if (ECHO_CAVE_MARKER && body.includes(ECHO_CAVE_MARKER)) return true
  const title = (item.title ?? '').trim()
  return title === ECHO_CAVE_TITLE || title.startsWith(`[${ECHO_CAVE_TITLE}]`)
}

/** 读取暂存待发送的回声草稿（登录跳转后自动续发） */
export function readPendingEchoDraft(): string {
  try {
    return sessionStorage.getItem(PENDING_DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writePendingEchoDraft(text: string): void {
  try {
    if (text) sessionStorage.setItem(PENDING_DRAFT_KEY, text)
    else sessionStorage.removeItem(PENDING_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

function readOfflineComments(): RawEchoComment[] {
  try {
    const raw = localStorage.getItem(OFFLINE_ECHOES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RawEchoComment[]) : []
  } catch {
    return []
  }
}

function appendOfflineComment(comment: RawEchoComment): void {
  try {
    const list = readOfflineComments()
    list.push(comment)
    localStorage.setItem(OFFLINE_ECHOES_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

interface RestDiscussionSummary {
  number: number
  node_id?: string
  title?: string
  body?: string | null
}

interface RestDiscussionComment {
  id: number | string
  node_id?: string
  body?: string
  created_at?: string
  author_association?: string
  user?: { login?: string | null } | null
}

async function fetchPublicGithubJson<T>(path: string): Promise<T | null> {
  if (OFFLINE || !API) return null
  const token = getToken()
  const doFetch = (withToken: boolean) =>
    fetch(`${API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(withToken && token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

  let res = await doFetch(Boolean(token))
  // 若本地残留过期 Token 导致 401/403，回退到匿名公开读取，确保所有访客都能听到回声
  if ((res.status === 401 || res.status === 403) && token) {
    res = await doFetch(false)
  }
  if (!res.ok) return null
  return (await res.json()) as T
}

/** 从 GitHub Discussions（或离线本地存储）加载回声洞内容 */
export async function loadEchoCaveSnapshot(): Promise<EchoCaveSnapshot> {
  if (OFFLINE) {
    const rawComments = readOfflineComments()
    return {
      discussionNumber: null,
      discussionNodeId: null,
      rawComments,
      echoes: filterRecognizedEchoes(rawComments),
      contributorLogins: new Set(),
    }
  }

  const targetRepo = getRepoTarget()
  const base = `/repos/${targetRepo.owner}/${targetRepo.repo}`
  const [discussions, contributors] = await Promise.all([
    fetchPublicGithubJson<RestDiscussionSummary[]>(`${base}/discussions?per_page=100`).catch(
      () => null,
    ),
    fetchPublicGithubJson<Array<{ login?: string }>>(`${base}/contributors?per_page=100`).catch(
      () => null,
    ),
  ])

  const contributorLogins = new Set<string>()
  for (const c of contributors ?? []) {
    if (c?.login) contributorLogins.add(c.login.trim().toLowerCase())
  }

  const target = (discussions ?? []).find((d) => isEchoCaveDiscussion(d))
  if (!target) {
    return {
      discussionNumber: null,
      discussionNodeId: null,
      rawComments: [],
      echoes: [],
      contributorLogins,
    }
  }

  const rawComments: RawEchoComment[] = []
  for (let page = 1; page <= 10; page++) {
    const batch = await fetchPublicGithubJson<RestDiscussionComment[]>(
      `${base}/discussions/${target.number}/comments?per_page=100&page=${page}`,
    ).catch(() => null)
    if (!batch || batch.length === 0) break
    for (const item of batch) {
      rawComments.push({
        id: String(item.node_id || item.id),
        body: item.body ?? '',
        createdAt: item.created_at ?? new Date(0).toISOString(),
        authorLogin: item.user?.login ?? null,
        authorAssociation: item.author_association ?? null,
      })
    }
    if (batch.length < 100) break
  }

  return {
    discussionNumber: target.number,
    discussionNodeId: target.node_id ?? null,
    rawComments,
    echoes: filterRecognizedEchoes(rawComments, {
      contributorLogins,
      repoOwner: targetRepo.owner,
    }),
    contributorLogins,
  }
}

interface EnsureDiscussionQuery {
  repository: {
    id: string
    discussionCategories: {
      nodes: Array<{ id: string; slug: string; name: string }>
    }
    discussions: {
      nodes: Array<{ id: string; number: number; title: string; body: string }>
    }
  }
}

async function ensureEchoDiscussionNodeId(knownNodeId?: string | null): Promise<string> {
  if (knownNodeId) return knownNodeId

  const targetRepo = getRepoTarget()
  const data = await githubGraphql<EnsureDiscussionQuery>(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        discussionCategories(first: 20) { nodes { id slug name } }
        discussions(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes { id number title body }
        }
      }
    }`,
    { owner: targetRepo.owner, name: targetRepo.repo },
  )

  const existing = data.repository.discussions.nodes.find((d) => isEchoCaveDiscussion(d))
  if (existing) return existing.id

  const categories = data.repository.discussionCategories.nodes
  const preferredName = echoCaveConfig.category.trim().toLowerCase()
  const preferred =
    categories.find(
      (c) => c.name.trim().toLowerCase() === preferredName || c.slug.toLowerCase() === preferredName,
    ) ?? categories[0]

  if (!preferred) {
    throw new Error('仓库尚未启用 GitHub Discussions')
  }

  const created = await githubGraphql<{
    createDiscussion: { discussion: { id: string } }
  }>(
    `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {
        repositoryId: $repositoryId,
        categoryId: $categoryId,
        title: $title,
        body: $body
      }) {
        discussion { id }
      }
    }`,
    {
      repositoryId: data.repository.id,
      categoryId: preferred.id,
      title: ECHO_CAVE_TITLE,
      body: `这里是百宝箱「回声洞」的留言存档。\n\n${ECHO_CAVE_MARKER}`,
    },
  )

  return created.createDiscussion.discussion.id
}

export type SubmitEchoResult =
  | { status: 'saved'; comment: RawEchoComment; recognized: boolean }
  | { status: 'needs_auth' }

/** 发送一条回声并保存到 GitHub Discussions */
export async function submitEchoMessage(
  rawText: string,
  options: {
    knownDiscussionNodeId?: string | null
    currentUserLogin?: string | null
  } = {},
): Promise<SubmitEchoResult> {
  const clean = rawText
    .replace(HTML_COMMENT_RE, '')
    .replace(/\r?\n+/g, ' ')
    .trim()
  if (!clean) {
    throw new Error('请输入要发送的内容')
  }

  if (OFFLINE) {
    const comment: RawEchoComment = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      body: clean,
      createdAt: new Date().toISOString(),
      authorLogin: 'local',
      authorAssociation: 'NONE',
    }
    appendOfflineComment(comment)
    const all = readOfflineComments()
    const recognized = filterRecognizedEchoes(all).some((e) => e.id === `discussion-${comment.id}`)
    return { status: 'saved', comment, recognized }
  }

  const token = getToken()
  if (token) {
    const discussionId = await ensureEchoDiscussionNodeId(options.knownDiscussionNodeId)
    const result = await githubGraphql<{
      addDiscussionComment: {
        comment: {
          id: string
          body: string
          createdAt: string
          authorAssociation: string
          author: { login: string } | null
        }
      }
    }>(
      `mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment {
            id
            body
            createdAt
            authorAssociation
            author { login }
          }
        }
      }`,
      { discussionId, body: clean },
    )

    const saved = result.addDiscussionComment.comment
    const comment: RawEchoComment = {
      id: saved.id,
      body: saved.body,
      createdAt: saved.createdAt,
      authorLogin: saved.author?.login ?? options.currentUserLogin ?? null,
      authorAssociation: saved.authorAssociation,
    }
    return { status: 'saved', comment, recognized: true }
  }

  // 未登录时优先尝试同源 Cloudflare Pages Function 中继（若站点配置了服务端令牌可直接匿名写入）
  try {
    const relayRes = await fetch('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
    })
    if (relayRes.ok) {
      const payload = (await relayRes.json()) as {
        comment: RawEchoComment
        recognized?: boolean
      }
      return {
        status: 'saved',
        comment: payload.comment,
        recognized: payload.recognized !== false,
      }
    }
    if (relayRes.status === 429) {
      const payload = (await relayRes.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error || '发送过于频繁，每小时最多 3 条、每天最多 10 条')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('最多')) {
      throw err
    }
  }

  // 静态托管或未配置服务端中继令牌时，暂存内容并引导完成 GitHub 授权后自动续发
  writePendingEchoDraft(clean)
  return { status: 'needs_auth' }
}

interface HitokotoResponse {
  id?: number | string
  uuid?: string
  hitokoto?: string
  from?: string | null
  from_who?: string | null
}

/** 拉取一条一言（hitokoto） */
export async function fetchHitokotoOne(signal?: AbortSignal): Promise<EchoItem | null> {
  if (OFFLINE || !HITOKOTO_API) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await fetch(`${HITOKOTO_API}/?encode=json`, {
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as HitokotoResponse
    const text = (data.hitokoto ?? '').trim()
    if (!text) return null
    const originParts = [data.from_who?.trim(), data.from ? `「${data.from.trim()}」` : ''].filter(
      Boolean,
    )
    return {
      id: `hitokoto-${data.uuid || data.id || Math.random().toString(36).slice(2)}`,
      text,
      from: originParts.length > 0 ? originParts.join(' ') : undefined,
      source: 'hitokoto',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
