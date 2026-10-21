/**
 * 百宝箱 · 回声洞的纯逻辑层（issue #93）。
 *
 * 回声洞里能听到的声音来自两处：
 *
 *   1. **访客留下的回声**：保存在 GitHub Discussions 的一个固定讨论帖里
 *      （一条回声 = 一条评论，读写见 `github.ts` 的 `loadEchoCaveEntries` 等）。
 *   2. **hitokoto 一言**：公开接口返回的随机一句话。
 *
 * 本文件只放与网络无关（或可单独测试）的规则，方便 `scripts/test-features.mjs`
 * 直接导入校验：
 *
 *   - **频率限制的「识别」口径**：每位作者每小时只识别最先发出的 3 条、每天只
 *     识别最先发出的 10 条（自然时 / 自然日，按读者本地时间分桶）；仓库贡献者
 *     （GitHub 评论的 authorAssociation 为 OWNER / MEMBER / COLLABORATOR /
 *     CONTRIBUTOR，或在贡献者名单里）不受限制。限制在**展示（识别）侧**执行，
 *     因此即使用户绕过本站直接到 GitHub 上刷屏，超出的回声也不会被听到；
 *     发送侧再用同一口径提前拦截，避免发出注定不被识别的内容。
 *   - 文本清洗：讨论评论正文是任意 Markdown，回声洞按**纯文本**展示一条短句，
 *     需要剥掉标记、折叠空白，并按上限截断。
 *   - 洗牌袋（shuffle bag）与 hitokoto 穿插节奏：保证连续点击时尽量不重复，
 *     且不会每次点击都去请求 hitokoto 接口。
 *   - 离线版的本机回声存储（离线版不联网，既读不到 Discussions 也调不了一言，
 *     改为只在本机回响，与评论区的「本机笔记」做法一致）。
 */
import { echoCaveConfig, STORAGE_KEYS } from './config'
import { hasNetwork, OFFLINE, OFFLINE_NO_NETWORK_HINT } from './runtime'

/** 回声的来源 */
export type EchoSource = 'discussion' | 'hitokoto' | 'local' | 'builtin'

export interface EchoEntry {
  id: string
  /** 清洗后的纯文本（一句话） */
  text: string
  source: EchoSource
  /** 发出时间（毫秒时间戳）；一言 / 内置句为 0 */
  createdAt: number
  authorLogin?: string
  authorAvatarUrl?: string
  /** GitHub 的 authorAssociation（仅 discussion 来源有） */
  authorAssociation?: string
  /** 在 GitHub 上打开这条评论的地址（仅 discussion 来源有） */
  url?: string
  /** 出处说明，如一言的「《作品》 · 作者」 */
  attribution?: string
  /** 被维护者在 GitHub 上最小化（隐藏）的内容：永远不会被识别展示 */
  hidden?: boolean
}

export const ECHO_HOURLY_LIMIT = echoCaveConfig.hourlyLimit
export const ECHO_DAILY_LIMIT = echoCaveConfig.dailyLimit
export const ECHO_MAX_LENGTH = echoCaveConfig.maxLength

/**
 * 不受频率限制的 GitHub 评论身份。
 *
 * GitHub GraphQL 的 authorAssociation 口径：
 * CONTRIBUTOR = 曾经向本仓库提交过代码的人，COLLABORATOR = 被邀请的协作者，
 * MEMBER = 仓库所属组织成员，OWNER = 仓库所有者。这四类都是「仓库贡献者」。
 * FIRST_TIME_CONTRIBUTOR 的含义恰恰是「还没向本仓库提交过」，不算贡献者。
 */
const EXEMPT_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'])

export function isRateLimitExemptAssociation(association: string | undefined | null): boolean {
  return !!association && EXEMPT_ASSOCIATIONS.has(association.toUpperCase())
}

/* ------------------------------- 文本清洗 -------------------------------- */

/** 站内发送前的规范化：折叠所有空白（包括换行）成一个空格，并去掉首尾空白。 */
export function normalizeEchoText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * 把任意讨论评论正文（Markdown）变成回声洞能展示的一句纯文本。
 *
 * 直接到 GitHub 发评论的人可以写任意 Markdown / HTML，这里剥掉图片、链接、
 * 代码围栏与 HTML 标签等标记，只留下读得出声的文字；再按 `ECHO_MAX_LENGTH`
 * 截断，避免整篇长文被塞进回声洞。空文本返回空串，调用方应直接丢弃。
 */
export function toEchoPlainText(body: string): string {
  let text = body ?? ''
  text = text.replace(/<!--[\s\S]*?-->/g, ' ') // HTML 注释（含内部标记）
  text = text.replace(/```[\s\S]*?```/g, ' ') // 代码围栏整块丢弃
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只保留文字
  text = text.replace(/<[^>]+>/g, ' ') // HTML 标签
  text = text.replace(/`([^`]*)`/g, '$1') // 行内代码保留文字
  text = text
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/, ''))
    .join(' ')
  text = text.replace(/(\*\*|__|~~|\*|_)/g, '')
  text = normalizeEchoText(text)
  if (text.length > ECHO_MAX_LENGTH) {
    text = `${text.slice(0, ECHO_MAX_LENGTH).trimEnd()}…`
  }
  return text
}

/* ------------------------------- 频率限制 -------------------------------- */

/** 自然时分桶键（读者本地时间），如 2026-10-21 13 点 → "2026-9-21-13" */
export function echoHourBucketKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
}

/** 自然日分桶键（读者本地时间） */
export function echoDayBucketKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export interface RecognizeOptions {
  /** 仓库所有者的 login（不区分大小写），永远不受限制 */
  ownerLogin?: string
  /** 额外的不受限制名单（如仓库贡献者名单，login 不区分大小写） */
  exemptLogins?: Iterable<string>
  hourlyLimit?: number
  dailyLimit?: number
}

function isExemptAuthor(entry: EchoEntry, exempt: Set<string>): boolean {
  if (isRateLimitExemptAssociation(entry.authorAssociation)) return true
  const login = entry.authorLogin?.toLowerCase()
  return !!login && exempt.has(login)
}

/**
 * 按频率限制挑出「被识别」的回声。
 *
 * 规则（issue #93）：每位非贡献者作者，每个自然时只识别**最先发出的** 3 条，
 * 每个自然日只识别**最先发出的** 10 条；两个上限同时生效。实现上把回声按
 * 时间从早到晚走一遍，某条只有在它所在时桶与日桶都没装满时才被留下，
 * 得到的就是「满足两个上限的最早一批回声」。仓库贡献者不受限制。
 *
 * 返回结果保持时间升序；展示顺序的随机化由洗牌袋负责。
 */
export function filterRecognizedEchoes(
  entries: readonly EchoEntry[],
  options: RecognizeOptions = {},
): EchoEntry[] {
  const hourlyLimit = options.hourlyLimit ?? ECHO_HOURLY_LIMIT
  const dailyLimit = options.dailyLimit ?? ECHO_DAILY_LIMIT
  const exempt = new Set<string>()
  if (options.ownerLogin) exempt.add(options.ownerLogin.toLowerCase())
  for (const login of options.exemptLogins ?? []) exempt.add(login.toLowerCase())

  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt)
  const hourCounts = new Map<string, number>()
  const dayCounts = new Map<string, number>()
  const recognized: EchoEntry[] = []

  for (const entry of sorted) {
    // 被维护者隐藏的内容直接跳过，且不占用该作者的识别名额
    if (entry.hidden) continue
    if (isExemptAuthor(entry, exempt)) {
      recognized.push(entry)
      continue
    }
    const author = (entry.authorLogin || 'ghost').toLowerCase()
    const hourKey = `${author}|${echoHourBucketKey(entry.createdAt)}`
    const dayKey = `${author}|${echoDayBucketKey(entry.createdAt)}`
    const hourCount = hourCounts.get(hourKey) ?? 0
    const dayCount = dayCounts.get(dayKey) ?? 0
    if (hourCount >= hourlyLimit || dayCount >= dailyLimit) continue
    hourCounts.set(hourKey, hourCount + 1)
    dayCounts.set(dayKey, dayCount + 1)
    recognized.push(entry)
  }
  return recognized
}

export interface EchoSendQuota {
  /** 当前用户是否不受限制（仓库贡献者） */
  exempt: boolean
  /** 当前自然时内已发出的条数 */
  hourCount: number
  /** 今天已发出的条数 */
  dayCount: number
  hourLimit: number
  dayLimit: number
  canSend: boolean
  /** 不能发送的原因：小时上限 / 每日上限 */
  blockedBy: 'hour' | 'day' | null
}

/**
 * 发送侧的额度检查：用与识别侧完全相同的分桶口径，数一遍当前用户在
 * 本时 / 本日已经发出的**原始**条数。若已达上限，再发也不会被识别，
 * 因此直接在站内拦下并说明原因。
 */
export function getEchoSendQuota(
  entries: readonly EchoEntry[],
  login: string,
  exempt: boolean,
  now = Date.now(),
): EchoSendQuota {
  const me = login.toLowerCase()
  const hourKey = echoHourBucketKey(now)
  const dayKey = echoDayBucketKey(now)
  let hourCount = 0
  let dayCount = 0
  for (const entry of entries) {
    if ((entry.authorLogin || '').toLowerCase() !== me) continue
    if (echoDayBucketKey(entry.createdAt) === dayKey) {
      dayCount += 1
      if (echoHourBucketKey(entry.createdAt) === hourKey) hourCount += 1
    }
  }
  const blockedBy = exempt
    ? null
    : hourCount >= ECHO_HOURLY_LIMIT
      ? 'hour'
      : dayCount >= ECHO_DAILY_LIMIT
        ? 'day'
        : null
  return {
    exempt,
    hourCount,
    dayCount,
    hourLimit: ECHO_HOURLY_LIMIT,
    dayLimit: ECHO_DAILY_LIMIT,
    canSend: blockedBy === null,
    blockedBy,
  }
}

/* --------------------------- 展示节奏（洗牌袋） --------------------------- */

/** Fisher–Yates 洗牌（返回新数组）；`rng` 可注入便于测试。 */
export function shuffleEchoes<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * 从洗牌袋里取下一条：袋子空了就按池子重新洗一袋，并避免新袋子的第一条
 * 与刚刚听到的重复（池子里多于一条时）。纯函数，便于单测连续点击的序列。
 */
export function drawFromEchoBag(
  pool: readonly EchoEntry[],
  bag: readonly EchoEntry[],
  lastId: string | null,
  rng: () => number = Math.random,
): { entry: EchoEntry | null; bag: EchoEntry[] } {
  let rest = [...bag]
  if (rest.length === 0) {
    rest = shuffleEchoes(pool, rng)
    if (rest.length > 1 && lastId && rest[0].id === lastId) {
      ;[rest[0], rest[1]] = [rest[1], rest[0]]
    }
  }
  const entry = rest.shift() ?? null
  return { entry, bag: rest }
}

/**
 * 下一声该不该去 hitokoto 取一言。
 *
 * - 回声池为空（未登录 / 还没人留声 / Discussions 读取失败）：全部听一言；
 * - 池子里只有 1 条：与一言交替，避免同一句连听两次；
 * - 其余情况：每 3 声穿插 1 声一言（第 3、6、9…声）。
 *
 * `nextIndex` 是即将听到的这一声的序号（从 0 数）。这样连续点击也不会
 * 每次都打 hitokoto 接口，配合页面侧的预取缓冲足够顺滑。
 */
export function shouldFetchHitokoto(nextIndex: number, poolSize: number): boolean {
  if (poolSize <= 0) return true
  if (poolSize === 1) return nextIndex % 2 === 1
  return nextIndex % 3 === 2
}

/* ------------------------------ hitokoto ------------------------------ */

/**
 * hitokoto 一言接口。
 *
 * 与 `github.ts` 的 GitHub 端点同理：离线构建里端点常量直接取空串，压缩后
 * 产物中根本不会出现这个地址（`scripts/verify-offline.mjs` 会硬检查），
 * 再加一道 `OFFLINE / hasNetwork()` 运行时拦截，双保险保证离线版绝不联网。
 */
const HITOKOTO_API = OFFLINE ? '' : 'https://v1.hitokoto.cn'

interface HitokotoPayload {
  id?: number
  hitokoto?: string
  from?: string
  from_who?: string | null
}

/** 把一言接口的返回整理成出处文案：`《作品》 · 作者`（缺哪段略哪段）。 */
export function formatHitokotoAttribution(payload: {
  from?: string
  from_who?: string | null
}): string | undefined {
  const from = typeof payload.from === 'string' ? payload.from.trim() : ''
  const who = typeof payload.from_who === 'string' ? payload.from_who.trim() : ''
  const parts = [from ? `《${from}》` : '', who].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** 解析并校验一言接口的 JSON；形状不对时返回 null（便于单测与页面兜底）。 */
export function parseHitokoto(payload: unknown): EchoEntry | null {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as HitokotoPayload
  const text = typeof data.hitokoto === 'string' ? normalizeEchoText(data.hitokoto) : ''
  if (!text) return null
  return {
    id: `hitokoto-${typeof data.id === 'number' ? data.id : text}`,
    text,
    source: 'hitokoto',
    createdAt: 0,
    attribution: formatHitokotoAttribution(data),
  }
}

export async function fetchHitokoto(signal?: AbortSignal): Promise<EchoEntry> {
  if (OFFLINE || !hasNetwork() || !HITOKOTO_API) {
    throw new Error(`${OFFLINE_NO_NETWORK_HINT}（一言需要联网获取）`)
  }
  const response = await fetch(`${HITOKOTO_API}/?encode=json`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`一言接口暂时不可用（HTTP ${response.status}）`)
  const entry = parseHitokoto(await response.json().catch(() => null))
  if (!entry) throw new Error('一言接口返回了无法识别的内容')
  return entry
}

/* --------------------------- 内置句与本机回声 --------------------------- */

/**
 * 内置的「洞中旧声」：没登录又断网、Discussions 还一条回声都没有、
 * 或离线版里还没在本机留声时，用它们兜底，保证点下去永远有回音。
 */
export const BUILTIN_ECHO_TEXTS: readonly string[] = [
  '把话留给山洞，山洞会替你收好，再轻轻还回来。',
  '声音碰到石壁会回来，想念碰到时间也是。',
  '你听，是很久以前有人在这里笑过。',
  '洞里没有回音的时候，是洞在认真听你说话。',
  '大声一点，整座山都会帮你记住这一句。',
  '有些话说给洞口听，比说给人听更安心。',
  '回声是世界上最耐心的听众，从不打断，也从不走神。',
  '每一声回响，都是过去和现在握了一次手。',
  '站在这里喊一声，烦恼就被石壁弹得很远很远。',
  '洞口的风会把好句子吹到更远的地方去。',
]

export function builtinEchoEntries(): EchoEntry[] {
  return BUILTIN_ECHO_TEXTS.map((text, index) => ({
    id: `builtin-${index}`,
    text,
    source: 'builtin' as const,
    createdAt: 0,
  }))
}

interface LocalEchoRecord {
  id: string
  text: string
  createdAt: number
}

/** 离线版的本机回声（只在这台设备上，不上传）。 */
export function readLocalEchoes(): EchoEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.echoCaveLocal)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is LocalEchoRecord =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as LocalEchoRecord).text === 'string' &&
          typeof (item as LocalEchoRecord).createdAt === 'number',
      )
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : `local-${item.createdAt}`,
        text: item.text,
        source: 'local' as const,
        createdAt: item.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

/** 追加一条本机回声并立即落盘；返回更新后的全部本机回声。 */
export function appendLocalEcho(text: string): EchoEntry[] {
  const entries = readLocalEchoes()
  entries.push({
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    source: 'local',
    createdAt: Date.now(),
  })
  const records: LocalEchoRecord[] = entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    createdAt: entry.createdAt,
  }))
  localStorage.setItem(STORAGE_KEYS.echoCaveLocal, JSON.stringify(records))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('starlog:echoes-changed'))
  }
  return entries
}
