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
  { id: 'builtin-7', text: '吹灭读书灯，一身都是月。', source: 'builtin' },
  { id: 'builtin-8', text: '醉后不知天在水，满船清梦压星河。', source: 'builtin' },
  { id: 'builtin-9', text: '山中何事？松花酿酒，春水煎茶。', source: 'builtin' },
  { id: 'builtin-10', text: '行到水穷处，坐看云起时。', source: 'builtin' },
  { id: 'builtin-11', text: '落霞与孤鹜齐飞，秋水共长天一色。', source: 'builtin' },
  { id: 'builtin-12', text: '长风破浪会有时，直挂云帆济沧海。', source: 'builtin' },
  { id: 'builtin-13', text: '莫听穿林打叶声，何妨吟啸且徐行。', source: 'builtin' },
  { id: 'builtin-14', text: '晚来天欲雪，能饮一杯无？', source: 'builtin' },
  { id: 'builtin-15', text: '海上生明月，天涯共此时。', source: 'builtin' },
  { id: 'builtin-16', text: '明月松间照，清泉石上流。', source: 'builtin' },
  { id: 'builtin-17', text: '人间有味是清欢。', source: 'builtin' },
  { id: 'builtin-18', text: '青山一道同云雨，明月何曾是两乡。', source: 'builtin' },
  { id: 'builtin-19', text: '山高月小，水落石出。', source: 'builtin' },
  { id: 'builtin-20', text: '清风徐来，水波不兴。', source: 'builtin' },
  { id: 'builtin-21', text: '惟江上之清风，与山间之明月，耳得之而为声，目遇之而成色。', source: 'builtin' },
  { id: 'builtin-22', text: '纵一苇之所如，凌万顷之茫然。', source: 'builtin' },
  { id: 'builtin-23', text: '云销雨霁，彩彻区明。', source: 'builtin' },
  { id: 'builtin-24', text: '星垂平野阔，月涌大江流。', source: 'builtin' },
  { id: 'builtin-25', text: '微风摇庭树，细雪下帘隙。', source: 'builtin' },
  { id: 'builtin-26', text: '绿蚁新醅酒，红泥小火炉。', source: 'builtin' },
  { id: 'builtin-27', text: '春水碧于天，画船听雨眠。', source: 'builtin' },
  { id: 'builtin-28', text: '疏影横斜水清浅，暗香浮动月黄昏。', source: 'builtin' },
  { id: 'builtin-29', text: '接天莲叶无穷碧，映日荷花别样红。', source: 'builtin' },
  { id: 'builtin-30', text: '小舟从此逝，江海寄余生。', source: 'builtin' },
  { id: 'builtin-31', text: '一蓑烟雨任平生。', source: 'builtin' },
  { id: 'builtin-32', text: '回首向来萧瑟处，归去，也无风雨也无晴。', source: 'builtin' },
  { id: 'builtin-33', text: '纸上得来终觉浅，绝知此事要躬行。', source: 'builtin' },
  { id: 'builtin-34', text: '正是江南好风景，落花时节又逢君。', source: 'builtin' },
  { id: 'builtin-35', text: '随风潜入夜，润物细无声。', source: 'builtin' },
  { id: 'builtin-36', text: '此时相望不相闻，愿逐月华流照君。', source: 'builtin' },
]

function normalizeEchoKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * 无重复轮播选择器：
 * 1. 对 incoming hitokoto 做全局文本去重（过滤重复缓存响应）；
 * 2. 对 GitHub Discussions 留言按轮次洗牌，每轮每条最多出现一次，且在留言较少时按冷却间隔穿插，绝不每隔一两次点击就重复；
 * 3. 对内置兜底语料同样采用无放回洗牌袋，离线/弱网连续点击 36 次零重复；
 * 4. 维护最近展示窗口，杜绝 A -> B -> A 式的短期复现。
 */
export interface EchoDeckController {
  setDiscussionEchoes(items: EchoItem[]): void
  pushHitokoto(item: EchoItem): boolean
  hitokotoBufferedCount(): number
  next(currentText?: string): EchoItem
  markShown(item: EchoItem): void
}

export function createEchoDeck(fallbackPool: EchoItem[] = FALLBACK_ECHOES): EchoDeckController {
  let discussionPool: EchoItem[] = []
  let discussionDeck: EchoItem[] = []
  const hitokotoQueue: EchoItem[] = []
  const seenHitokotoKeys = new Set<string>()
  let builtinDeck: EchoItem[] = []
  const recentKeys: string[] = []
  let stepsSinceLastDiscussion = 999

  const rememberShown = (text: string) => {
    const key = normalizeEchoKey(text)
    if (!key) return
    const existingIdx = recentKeys.indexOf(key)
    if (existingIdx >= 0) recentKeys.splice(existingIdx, 1)
    recentKeys.push(key)
    const maxHistory = Math.max(12, fallbackPool.length - 2 + discussionPool.length)
    while (recentKeys.length > maxHistory) {
      recentKeys.shift()
    }
  }

  const refillBuiltinDeck = () => {
    builtinDeck = shuffleInPlace([...fallbackPool])
  }

  const pullUniqueFromQueue = (
    queue: EchoItem[],
    disallowed: Set<string>,
  ): EchoItem | null => {
    const idx = queue.findIndex((item) => !disallowed.has(normalizeEchoKey(item.text)))
    if (idx >= 0) {
      const [picked] = queue.splice(idx, 1)
      return picked
    }
    return null
  }

  return {
    setDiscussionEchoes(items: EchoItem[]) {
      // 同一讨论下若不同人发了完全相同的文字，合并去重避免同轮重复展示同一句话
      const seen = new Set<string>()
      discussionPool = []
      for (const item of items) {
        const key = normalizeEchoKey(item.text)
        if (!key || seen.has(key)) continue
        seen.add(key)
        discussionPool.push(item)
      }
      const recentSet = new Set(recentKeys)
      discussionDeck = shuffleInPlace(
        discussionPool.filter((item) => !recentSet.has(normalizeEchoKey(item.text))),
      )
    },

    pushHitokoto(item: EchoItem): boolean {
      const key = normalizeEchoKey(item.text)
      if (!key || seenHitokotoKeys.has(key)) return false
      seenHitokotoKeys.add(key)
      // 防止超长会话无限增长，保留最近 300 条一言去重指纹
      if (seenHitokotoKeys.size > 300) {
        const oldest = seenHitokotoKeys.values().next().value
        if (oldest !== undefined) seenHitokotoKeys.delete(oldest)
      }
      hitokotoQueue.push(item)
      return true
    },

    hitokotoBufferedCount(): number {
      return hitokotoQueue.length
    },

    markShown(item: EchoItem) {
      rememberShown(item.text)
      if (item.source === 'discussion') {
        stepsSinceLastDiscussion = 0
      } else {
        stepsSinceLastDiscussion += 1
      }
    },

    next(currentText?: string): EchoItem {
      if (currentText) rememberShown(currentText)
      const disallowed = new Set(recentKeys)

      // 仅当本轮仍有未展示过的 Discussions 留言且满足自然间隔时抽取，避免留言少时反复刷出同一条
      const minGap = discussionPool.length <= 2 ? 3 : discussionPool.length <= 5 ? 2 : 1
      if (discussionPool.length > 0 && discussionDeck.length === 0) {
        // 只有当该条留言已离开近期记忆窗口后才允许进入新一轮
        const eligible = discussionPool.filter((item) => !disallowed.has(normalizeEchoKey(item.text)))
        if (eligible.length > 0) {
          discussionDeck = shuffleInPlace(eligible)
        }
      }

      if (discussionDeck.length > 0 && stepsSinceLastDiscussion >= minGap) {
        const pickedDisc = pullUniqueFromQueue(discussionDeck, disallowed)
        if (pickedDisc) {
          stepsSinceLastDiscussion = 0
          rememberShown(pickedDisc.text)
          return pickedDisc
        }
      }

      // 优先展示全新未见过的一言（hitokoto）
      const pickedHitokoto = pullUniqueFromQueue(hitokotoQueue, disallowed)
      if (pickedHitokoto) {
        stepsSinceLastDiscussion += 1
        rememberShown(pickedHitokoto.text)
        return pickedHitokoto
      }

      // 若本轮仍有尚未展示过的 Discussions 留言，直接补位展示（绝不重复）
      if (discussionDeck.length > 0) {
        const fallbackDisc = pullUniqueFromQueue(discussionDeck, disallowed)
        if (fallbackDisc) {
          stepsSinceLastDiscussion = 0
          rememberShown(fallbackDisc.text)
          return fallbackDisc
        }
      }

      // 离线或一言接口限流/未返回时，从 36 条精选无放回洗牌袋抽取
      if (builtinDeck.length === 0) refillBuiltinDeck()
      let pickedBuiltin = pullUniqueFromQueue(builtinDeck, disallowed)
      if (!pickedBuiltin) {
        // 全部语料均已完整看过一遍：开启全新一轮，仅排除紧邻上一句
        recentKeys.length = 0
        if (currentText) recentKeys.push(normalizeEchoKey(currentText))
        refillBuiltinDeck()
        if (discussionPool.length > 0) {
          discussionDeck = shuffleInPlace([...discussionPool])
        }
        pickedBuiltin = pullUniqueFromQueue(
          builtinDeck,
          new Set(currentText ? [normalizeEchoKey(currentText)] : []),
        )
      }

      const finalPick = pickedBuiltin ?? fallbackPool[0]
      stepsSinceLastDiscussion += 1
      rememberShown(finalPick.text)
      return finalPick
    },
  }
}

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
      cache: 'no-store',
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

let hitokotoReqSeq = 0

/** 拉取一条一言（hitokoto），附带唯一防缓存参数与 cache: 'no-store' 杜绝并发请求命中同一缓存响应 */
export async function fetchHitokotoOne(signal?: AbortSignal): Promise<EchoItem | null> {
  if (OFFLINE || !HITOKOTO_API) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  const nonce = `${Date.now().toString(36)}-${(++hitokotoReqSeq).toString(36)}`

  try {
    const res = await fetch(`${HITOKOTO_API}/?encode=json&_=${nonce}`, {
      cache: 'no-store',
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
      id: `hitokoto-${data.uuid || data.id || nonce}`,
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
