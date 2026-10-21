/**
 * 百宝箱 · 回声洞的纯逻辑层（issue #93）。
 *
 * 这里刻意不依赖 React，方便被单测直接 import；GitHub 读写留在 `github.ts`，
 * 本文件只负责：
 *
 *   1. **回声条目的统一形状**：把 GitHub Discussions 的评论、hitokoto 的句子和
 *      内置备用句都规整成同一种 `EchoEntry`，页面只管「点击看下一条」；
 *   2. **条数限制**：每位作者每小时最多 3 条、每天最多 10 条，超出部分既不显示
 *      （「只识别前 N 条」）也不能再发送；仓库贡献者不受限制；
 *   3. **牌堆**：把三个来源轮流穿插，保证连着点几次不会一直是同一种来源；
 *   4. **hitokoto 拉取**：离线版构建期把端点置空，产物里不会出现任何在线地址。
 */
import { echoCaveConfig } from './config'
import type { BlogDiscussionComment } from './github'
import { OFFLINE } from './runtime'

/** 回声来源 */
export type EchoKind = 'discussion' | 'hitokoto' | 'builtin'

export interface EchoEntry {
  /** 来源内唯一 id（讨论评论 id / hitokoto uuid / 内置句序号） */
  id: string
  kind: EchoKind
  /** 展示文本（已规整空白，不超过 echoCaveConfig.maxLength） */
  text: string
  /** 出处：`@login`、`《书名》` 或「回声洞」 */
  source: string
  /** 讨论回声的作者登录名；其它来源为空 */
  authorLogin?: string
  /** 作者是否为仓库贡献者（贡献者不受条数限制） */
  authorIsContributor?: boolean
  /** 讨论回声的发送时间（毫秒）；其它来源为空 */
  createdAt?: number
  /** 讨论回声的原帖地址 */
  url?: string
}

export interface EchoRateLimits {
  perHour: number
  perDay: number
}

export const ECHO_LIMITS: EchoRateLimits = {
  perHour: echoCaveConfig.perHour,
  perDay: echoCaveConfig.perDay,
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/* --------------------------------- 文本 ---------------------------------- */

/**
 * 规整一条回声：去掉首尾空白、把连续空白（含换行）压成单个空格、按上限截断。
 * 回声洞是「一行话」的地方，所以不允许换行——避免有人在讨论里贴长文或代码块。
 */
export function normalizeEchoText(input: string, maxLength: number = echoCaveConfig.maxLength): string {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  // 不把 emoji 的代理对切成两半
  const sliced = text.slice(0, maxLength)
  const last = sliced.charCodeAt(sliced.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced
}

/** 去重用的指纹：只按文本（分词符与空白差异不算新句子） */
export function echoFingerprint(entry: EchoEntry): string {
  return entry.text.replace(/\s+/g, '').toLowerCase()
}

/* -------------------------------- 条数限制 -------------------------------- */

/** OWNER / MEMBER / COLLABORATOR / CONTRIBUTOR 都算仓库贡献者 */
export function isContributorAssociation(association: string | null | undefined): boolean {
  if (!association) return false
  return ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].includes(association.toUpperCase())
}

/** 仓库权限高于「只读」（READ）的用户同样不受条数限制 */
export function isContributorPermission(permission: string | null | undefined): boolean {
  if (!permission) return false
  return ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE'].includes(permission.toUpperCase())
}

/** 把 GitHub Discussions 的评论转成回声条目（空内容的评论直接丢弃） */
export function discussionCommentsToEchoes(
  comments: readonly BlogDiscussionComment[],
  maxLength: number = echoCaveConfig.maxLength,
): EchoEntry[] {
  const entries: EchoEntry[] = []
  for (const comment of comments) {
    const text = normalizeEchoText(comment.body ?? '', maxLength)
    if (!text) continue
    const login = comment.author?.login ?? ''
    const createdAt = Date.parse(comment.createdAt)
    entries.push({
      id: comment.id,
      kind: 'discussion',
      text,
      source: login ? `@${login}` : '匿名',
      authorLogin: login || undefined,
      authorIsContributor: isContributorAssociation(comment.authorAssociation),
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      url: comment.url,
    })
  }
  return entries
}

/**
 * 「只识别前 N 条」：按作者分组、时间升序滚动计数。
 *
 * 同一作者在任意 1 小时内最多保留 `perHour` 条、任意 24 小时内最多保留 `perDay` 条，
 * 超出的条目从展示池里剔除（但仍然保留在 GitHub Discussions 里，不会被删除）。
 * 非讨论来源与贡献者的条目原样通过，输出保持输入顺序。
 */
export function applyEchoRateLimits(
  entries: readonly EchoEntry[],
  limits: EchoRateLimits = ECHO_LIMITS,
): EchoEntry[] {
  const groups = new Map<string, EchoEntry[]>()
  for (const entry of entries) {
    if (entry.kind !== 'discussion' || !entry.authorLogin) continue
    const key = entry.authorLogin.toLowerCase()
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }

  const kept = new Set<EchoEntry>()
  for (const group of groups.values()) {
    const timeline: number[] = []
    for (const entry of [...group].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
      const ts = entry.createdAt ?? 0
      if (entry.authorIsContributor) {
        timeline.push(ts)
        kept.add(entry)
        continue
      }
      const inHour = timeline.filter((t) => t <= ts && ts - t < HOUR_MS).length
      const inDay = timeline.filter((t) => t <= ts && ts - t < DAY_MS).length
      if (inHour < limits.perHour && inDay < limits.perDay) {
        timeline.push(ts)
        kept.add(entry)
      }
    }
  }

  return entries.filter((entry) => entry.kind !== 'discussion' || kept.has(entry))
}

export interface EchoQuota {
  hourUsed: number
  dayUsed: number
  hourLeft: number
  dayLeft: number
  /** 现在还能不能发送 */
  allowed: boolean
  /** 当前用户是否因为是仓库贡献者而不受限 */
  contributor: boolean
  /** 不允许时给用户看的原因（允许时为空串） */
  message: string
}

/**
 * 当前用户在本小时 / 本 24 小时内已经「被识别」的条数与剩余额度。
 * `entries` 应传**未经过滤**的讨论回声，否则超发的条数会被低估。
 */
export function echoQuota(
  entries: readonly EchoEntry[],
  login: string | null | undefined,
  options: { limits?: EchoRateLimits; now?: number; contributor?: boolean } = {},
): EchoQuota {
  const limits = options.limits ?? ECHO_LIMITS
  const now = options.now ?? Date.now()
  const contributor = Boolean(options.contributor)
  const mine = login
    ? entries.filter(
        (entry) =>
          entry.kind === 'discussion' &&
          entry.authorLogin?.toLowerCase() === login.toLowerCase() &&
          typeof entry.createdAt === 'number',
      )
    : []
  const hourUsed = mine.filter((entry) => now - (entry.createdAt as number) < HOUR_MS).length
  const dayUsed = mine.filter((entry) => now - (entry.createdAt as number) < DAY_MS).length
  const hourLeft = Math.max(0, limits.perHour - hourUsed)
  const dayLeft = Math.max(0, limits.perDay - dayUsed)
  const allowed = contributor || (hourLeft > 0 && dayLeft > 0)
  return {
    hourUsed,
    dayUsed,
    hourLeft,
    dayLeft,
    allowed,
    contributor,
    message:
      allowed || contributor
        ? ''
        : `回声条数已达上限：每人每小时最多 ${limits.perHour} 条、每天最多 ${limits.perDay} 条。这次没有发送，过一会儿再来吧。`,
  }
}

/* ---------------------------------- 牌堆 ---------------------------------- */

/** Fisher–Yates，`random` 可注入以便测试 */
export function shuffleEchoes(entries: readonly EchoEntry[], random: () => number = Math.random): EchoEntry[] {
  const out = [...entries]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface EchoSources {
  discussion?: readonly EchoEntry[]
  hitokoto?: readonly EchoEntry[]
  builtin?: readonly EchoEntry[]
}

/**
 * 把三个来源轮流穿插成「点击序列」。
 *
 * 每轮依次从讨论回声、hitokoto、内置句里各取一条，直到取完；各来源内部先洗牌。
 * 相同文本只保留最先出现的一条（用户在讨论里复读 hitokoto 也不会看到两遍）。
 */
export function buildEchoDeck(sources: EchoSources, random: () => number = Math.random): EchoEntry[] {
  const seen = new Set<string>()
  const lists: EchoEntry[][] = []
  for (const source of [sources.discussion, sources.hitokoto, sources.builtin]) {
    const unique: EchoEntry[] = []
    for (const entry of shuffleEchoes(source ?? [], random)) {
      if (!entry.text) continue
      const key = echoFingerprint(entry)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(entry)
    }
    if (unique.length > 0) lists.push(unique)
  }

  const out: EchoEntry[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      if (list[i]) out.push(list[i])
    }
  }
  return out
}

/** 从内置句里挑 `count` 条还没出现过的（牌堆用完后补货） */
export function takeBuiltinEchoes(
  seen: ReadonlySet<string>,
  count = 8,
  random: () => number = Math.random,
): EchoEntry[] {
  return shuffleEchoes(BUILTIN_ECHOES, random)
    .filter((entry) => !seen.has(echoFingerprint(entry)))
    .slice(0, Math.max(0, count))
}

/* ------------------------------- hitokoto 一言 ------------------------------ */

/**
 * hitokoto 端点：离线版在**构建期**置空，产物里不会出现任何在线地址
 * （`scripts/verify-offline.mjs` 会硬检查这一点）。
 */
const HITOKOTO_ENDPOINT = OFFLINE ? '' : 'https://v1.hitokoto.cn/'
const HITOKOTO_TIMEOUT_MS = 6000

interface HitokotoPayload {
  hitokoto?: unknown
  from?: unknown
  from_who?: unknown
  uuid?: unknown
}

function hitokotoSource(payload: HitokotoPayload): string {
  const from = typeof payload.from === 'string' ? payload.from.trim() : ''
  const who = typeof payload.from_who === 'string' ? payload.from_who.trim() : ''
  if (who && from) return `${who} · 《${from}》`
  if (who) return who
  if (from) return `《${from}》`
  return '一言'
}

async function fetchOneHitokoto(index: number): Promise<EchoEntry | null> {
  if (!HITOKOTO_ENDPOINT) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HITOKOTO_TIMEOUT_MS)
  try {
    const res = await fetch(`${HITOKOTO_ENDPOINT}?encode=json&charset=utf-8`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const payload = (await res.json()) as HitokotoPayload
    const text = normalizeEchoText(typeof payload.hitokoto === 'string' ? payload.hitokoto : '')
    if (!text) return null
    const uuid = typeof payload.uuid === 'string' ? payload.uuid : `fallback-${index}`
    return {
      id: `hitokoto:${uuid}`,
      kind: 'hitokoto',
      text,
      source: hitokotoSource(payload),
    }
  } catch {
    // 断网、超时、接口改版都只当作「这次没取到」，页面会继续用内置句
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取一批一言。任一请求失败都被忽略（`allSettled`），因此这个函数**不会抛错**：
 * 回声洞在任何网络状态下都能用内置句继续工作。
 */
export async function fetchHitokotoBatch(count = 4): Promise<EchoEntry[]> {
  if (OFFLINE || !HITOKOTO_ENDPOINT) return []
  const tasks = Array.from({ length: Math.max(0, Math.min(10, count)) }, (_, index) =>
    fetchOneHitokoto(index),
  )
  const results = await Promise.allSettled(tasks)
  const seen = new Set<string>()
  const entries: EchoEntry[] = []
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue
    const key = echoFingerprint(result.value)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(result.value)
  }
  return entries
}

/* -------------------------------- 内置备用句 ------------------------------- */

/**
 * 内置句子：完全不联网的兜底内容（离线版只有这一来源）。
 * 均为本仓原创短句，不引用任何受版权保护的歌词 / 诗句 / 网络段子。
 */
export const BUILTIN_ECHOES: readonly EchoEntry[] = [
  '回声洞很深，深到能装下那些没来得及说出口的话。',
  '风经过洞口的时候，会把声音还给你。',
  '如果你正走夜路，记得抬头看看星。',
  '有些答案不必急着找，它们会在某个转角等你。',
  '把今天写下来，明天就有可以回望的东西。',
  '慢一点也没关系，山不会因为你走得慢就长高。',
  '雨停之后，叶子上的水珠会替天空多看一会儿。',
  '你搁下的事情，世界会先替你保管一阵。',
  '偶尔失眠，是身体在替脑子数还没数完的星星。',
  '无论走哪条路，记得给自己留一盏灯。',
  '今天的云很轻，像谁把心事摊开晾了晾。',
  '不必把每件事都做完，留一点给明天的自己。',
  '被认真听完的一句话，会在心里回响很久。',
  '冬天的树看起来空空的，其实在攒春天的力气。',
  '如果此刻很难，就先允许此刻很难。',
  '远处的灯一盏一盏亮起来，像有人在点名。',
  '你走过的弯路，最后都会变成地图上的等高线。',
  '偶尔停下来，是为了确认方向，而不是放弃。',
  '清晨的第一口空气，通常比昨天的烦恼更清醒。',
  '把喜欢的事做久一点，它就会长成你的样子。',
  '世界很吵，但你可以选择听哪一阵风。',
  '有些事情没有结句，也不必硬写一个句号。',
  '在很长的夜里，愿你想起来的人也在想你。',
  '每一次认真的告别，都在悄悄练习重逢。',
  '今天的月亮很圆，适合把想说的话说一半。',
  '若无人应答，就把回声当成另一个人在认真听。',
  '你留下的每一句，都会有人在对的时间读到。',
  '洞口的光很细，但足够照亮下一行字。',
  '不必成为更好的自己，先成为更像自己的自己。',
  '所有走散的声音，最后都会在某个洞里重逢。',
].map((text, index) => ({
  id: `builtin:${String(index + 1).padStart(2, '0')}`,
  kind: 'builtin' as const,
  text,
  source: '回声洞',
}))
