/**
 * 离线版「同步到线上」。
 *
 * 不引入新的通道：完全复用站点的 GitHub OAuth（Device Flow）授权与
 * **待更新队列 + 批量提交**（src/lib/updateQueue.ts）：
 *
 *   1. 收集本机离线文章库中与内置（构建时打包进 HTML）版本不同的文章 → `enqueuePostPublish`；
 *      在离线版中被删除的内置文章 → `enqueuePostDelete`；
 *      本机暂存的图片（队列里的 image-upload 条目）随文章一起提交；
 *   2. 调用 `flushUpdateQueue()`：Git Data API 合并为一次提交推到 main；
 *   3. 仓库的 GitHub Actions / Cloudflare Pages 自动重新部署 → 线上文章列表出现这些文章。
 *
 * 因此离线版只要求「联网 + 已连接 GitHub」；未联网或未授权都会明确报错，不会静默跳过。
 */
import {
  buildPost,
  getLocalPosts,
  getRepoPosts,
  postFingerprint,
  serializePost,
} from './posts'
import { clearSeedDeletion, deletedSeedSlugs, hiddenSeedSlugs } from './offlineLibrary'
import { hasNetwork } from './runtime'
import {
  clearUpdateQueue,
  enqueuePostDelete,
  enqueuePostPublish,
  flushUpdateQueue,
  getUpdateQueue,
  type FlushResult,
  type QueueItem,
} from './updateQueue'

const SYNC_STATE_KEY = 'starlog:offline-sync-state'

export interface SyncStateEntry {
  /** 上次成功提交的内容指纹 */
  fingerprint: string
  syncedAt: number
}

export type SyncState = Record<string, SyncStateEntry>

function readSyncState(): SyncState {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SyncState) : {}
  } catch {
    return {}
  }
}

function writeSyncState(state: SyncState) {
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state))
  } catch (err) {
    // 同步状态只影响「下次是否重复提交」，写失败不能算同步失败，但必须留痕
    console.error('[离线同步] 写入同步状态失败（下次同步会重复入队这些文章）', err)
  }
}

export interface SyncPlanItem {
  slug: string
  title: string
  kind: 'publish' | 'delete'
  markdown?: string
  reason: string
}

export interface SyncPlan {
  items: SyncPlanItem[]
  /** 与离线文件内置版本内容一致的篇数（无需提交） */
  upToDate: number
  /** 与上次成功同步的内容一致，已跳过的篇数 */
  skipped: number
  /** 队列里已暂存、会一并提交的图片数 */
  stagedImages: number
}

/**
 * 生成同步计划：本机文章库 vs 离线文件内置版本 vs 上次成功同步的记录。
 * 内容一致就跳过，避免每次都产生一次空提交。
 */
export function planOfflineSync(): SyncPlan {
  const state = readSyncState()
  const seedBySlug = new Map(getRepoPosts().map((post) => [post.slug, post]))
  const items: SyncPlanItem[] = []
  let upToDate = 0
  let skipped = 0

  for (const post of getLocalPosts()) {
    const fingerprint = postFingerprint(post)
    if (state[post.slug]?.fingerprint === fingerprint) {
      skipped += 1
      continue
    }
    const seed = seedBySlug.get(post.slug)
    if (seed && postFingerprint(seed) === fingerprint) {
      upToDate += 1
      continue
    }
    items.push({
      slug: post.slug,
      title: post.title,
      kind: 'publish',
      // 加密文章的本地条目本身就是密文信封，序列化后仍是信封，不会外泄明文
      markdown: serializePost(post),
      reason: seed ? '与离线文件内置版本不同' : '离线版新写的文章',
    })
  }

  const alreadyDeleted = deletedSeedSlugs()
  for (const slug of hiddenSeedSlugs()) {
    const seed = seedBySlug.get(slug)
    if (!seed) continue
    // 已经提交过删除的内置文章不再重复入队（提交成功时墓碑已转成删除记录）
    if (alreadyDeleted.has(slug)) continue
    items.push({ slug, title: seed.title, kind: 'delete', reason: '在离线版中被删除' })
  }

  const stagedImages = getUpdateQueue().filter((item) => item.kind === 'image-upload').length
  return { items, upToDate, skipped, stagedImages }
}

/** 把同步计划写入待更新队列（与线上站点共用同一套队列与 UI） */
export function stageOfflineSync(plan: SyncPlan): QueueItem[] {
  const staged: QueueItem[] = []
  for (const item of plan.items) {
    if (item.kind === 'publish' && item.markdown) {
      staged.push(enqueuePostPublish({ slug: item.slug, title: item.title }, item.markdown))
    } else if (item.kind === 'delete') {
      staged.push(enqueuePostDelete(item.slug, item.title))
    }
  }
  return staged
}

export interface OfflineSyncResult extends FlushResult {
  /** 本次入队的条目数 */
  staged: number
  syncedAt: number
}

/**
 * 一键同步：入队 → 批量提交 → 记录同步状态。
 * 失败一律抛出带可操作说明的错误（未联网 / 未授权 / 权限不足 / 存储异常）。
 */
export async function runOfflineSync(options: { only?: string[] } = {}): Promise<OfflineSyncResult> {
  if (!hasNetwork()) {
    throw new Error('当前处于离线状态：同步到线上需要联网（调用 GitHub API 并上传图片）。连网后重试即可。')
  }
  const plan = planOfflineSync()
  const wanted = options.only?.length ? new Set(options.only) : null
  const items = wanted ? plan.items.filter((item) => wanted.has(item.slug)) : plan.items
  if (items.length === 0) {
    return { staged: 0, syncedAt: Date.now(), succeeded: [], failed: [], prUrls: [] }
  }
  const stagedItems = stageOfflineSync({ ...plan, items })
  const result = await flushUpdateQueue(stagedItems)
  const syncedAt = Date.now()
  if (result.succeeded.length > 0) {
    const state = readSyncState()
    for (const item of result.succeeded) {
      if (item.kind === 'post-publish' && item.markdown) {
        const post = buildPost(item.markdown, { slug: item.target, source: 'local' })
        state[item.target] = { fingerprint: postFingerprint(post), syncedAt }
        // 同一 slug 重新发布成功后，先前的删除记录失效，避免旧记录把新文章当成「已删除」
        clearSeedDeletion(item.target)
      }
      // post-delete 成功时 updateQueue.flushUpdateQueue 已把墓碑转成删除记录
    }
    writeSyncState(state)
  }
  if (result.failed.length > 0) {
    const message = result.failed[0]?.message || '未知错误'
    throw new Error(`${result.succeeded.length} 项已提交，${result.failed.length} 项失败：${message}。失败条目仍留在待更新队列中，可修正后重试。`)
  }
  return { ...result, staged: stagedItems.length, syncedAt }
}

/** 同步状态摘要（设置页 / 管理页展示用） */
export function describeSyncState(): { total: number; latest: number | null } {
  const entries = Object.values(readSyncState())
  if (entries.length === 0) return { total: 0, latest: null }
  return { total: entries.length, latest: Math.max(...entries.map((entry) => entry.syncedAt)) }
}

/** 清除本机同步状态：下次同步会把所有文章重新入队（内容确实有出入时用得上） */
export function resetSyncState() {
  try {
    localStorage.removeItem(SYNC_STATE_KEY)
  } catch (err) {
    console.error('[离线同步] 清除同步状态失败', err)
  }
}

/** 放弃本机暂存的更改（含图片）：只清队列，不动本机文章库 */
export function discardOfflineSyncQueue() {
  clearUpdateQueue()
}
