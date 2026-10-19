/**
 * 离线文章库的补充能力：内置文章删除墓碑、本机历史版本。
 *
 * 离线版没有仓库，「发布」写入本机文章库（见 posts.ts 的本地草稿存储），
 * 但有两件事需要额外记录：
 *
 *   - 删除：HTML 里内置（构建时打包进来）的文章无法从文件中删除，
 *     因此删除只记录一条「墓碑」，本机不再显示它，随时可以恢复；
 *   - 历史版本：线上版读取 Git 提交历史，离线版改为每次保存时留存本机快照，
 *     配合已有的版本命名 / 版本对比 / 继续编辑能力（见 lib/postHistory.ts）。
 */
import { offlineConfig, STORAGE_KEYS } from './config'
import type { PostHistoryVersion } from './github'

export interface LocalVersion {
  id: string
  slug: string
  message: string
  savedAt: number
  raw: string
}

/** 全部历史版本快照的体积上限（约 4MB），超出后从最旧的开始丢弃 */
const MAX_TOTAL_CHARS = 4_000_000

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误'
    throw new Error(`本地存储写入失败（${message}）：请先在「设置 → 离线版」中导出档案备份，或删除部分历史版本`)
  }
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
}

/* ---------------------------------- 墓碑 ---------------------------------- */

export function hiddenSeedSlugs(): string[] {
  const list = readJson<unknown>(STORAGE_KEYS.offlineHidden, [])
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

function writeHidden(slugs: string[]) {
  writeJson(STORAGE_KEYS.offlineHidden, [...new Set(slugs)])
}

export function hideSeedPost(slug: string) {
  writeHidden([...hiddenSeedSlugs(), slug])
}

export function restoreSeedPost(slug: string) {
  writeHidden(hiddenSeedSlugs().filter((item) => item !== slug))
}

export function restoreAllSeedPosts() {
  writeHidden([])
}

export function isSeedPostHidden(slug: string): boolean {
  return hiddenSeedSlugs().includes(slug)
}

/**
 * 已经提交到仓库的「删除内置文章」记录。
 *
 * 删除一旦提交成功，就把墓碑转成这里的记录：墓碑列表因此不会无限累积，
 * 日后同一 slug 重新发布也不会被旧墓碑误隐藏（见 offlineSync.clearSeedDeletion）。
 */
function readDeleted(): string[] {
  const list = readJson<unknown>(STORAGE_KEYS.offlineDeleted, [])
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

export function deletedSeedSlugs(): Set<string> {
  return new Set(readDeleted())
}

export function recordSeedDeletion(slug: string) {
  writeJson(STORAGE_KEYS.offlineDeleted, [...new Set([...readDeleted(), slug])])
}

export function clearSeedDeletion(slug: string) {
  const next = readDeleted().filter((item) => item !== slug)
  if (next.length === 0) {
    try {
      localStorage.removeItem(STORAGE_KEYS.offlineDeleted)
    } catch (err) {
      console.error('[离线文章库] 清除删除记录失败', err)
    }
    window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
    return
  }
  writeJson(STORAGE_KEYS.offlineDeleted, next)
}

/** 清空本机对内置文章的全部删除状态（墓碑 + 已提交记录） */
export function resetSeedDeletions() {
  restoreAllSeedPosts()
  try {
    localStorage.removeItem(STORAGE_KEYS.offlineDeleted)
  } catch (err) {
    console.error('[离线文章库] 清除删除记录失败', err)
  }
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
}

/* -------------------------------- 本机历史版本 ------------------------------ */

function readAllVersions(): Record<string, LocalVersion[]> {
  const store = readJson<Record<string, LocalVersion[]>>(STORAGE_KEYS.offlineVersions, {})
  const cleaned: Record<string, LocalVersion[]> = {}
  for (const [slug, list] of Object.entries(store)) {
    if (!Array.isArray(list)) continue
    cleaned[slug] = list.filter(
      (item): item is LocalVersion =>
        !!item && typeof item === 'object' && typeof item.raw === 'string' && typeof item.id === 'string',
    )
  }
  return cleaned
}

export function listLocalVersions(slug: string): LocalVersion[] {
  // 最新的在前（与 Git 历史接口一致）
  return [...(readAllVersions()[slug] ?? [])].sort((a, b) => b.savedAt - a.savedAt)
}

export function readLocalVersion(slug: string, id: string): string | null {
  return listLocalVersions(slug).find((item) => item.id === id)?.raw ?? null
}

function makeVersionId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 追加一条本机快照。与最新版本内容相同时不重复记录，
 * 并按「单篇文章条数上限 + 总体积上限」裁剪，避免撑爆 localStorage 回退层。
 */
export function pushLocalVersion(slug: string, raw: string, message?: string): LocalVersion | null {
  const store = readAllVersions()
  const current = [...(store[slug] ?? [])].sort((a, b) => b.savedAt - a.savedAt)
  if (current[0]?.raw === raw) return null
  const entry: LocalVersion = {
    id: makeVersionId(),
    slug,
    message: message?.trim() || `本机保存 · ${new Date().toLocaleString('zh-CN')}`,
    savedAt: Date.now(),
    raw,
  }
  let next = [entry, ...current].slice(0, Math.max(1, offlineConfig.maxLocalVersions))
  let total = next.reduce((sum, item) => sum + item.raw.length, 0)
  while (next.length > 1 && total > MAX_TOTAL_CHARS) {
    const dropped = next.pop()
    total -= dropped?.raw.length ?? 0
  }
  store[slug] = next
  writeJson(STORAGE_KEYS.offlineVersions, store)
  return entry
}

export function clearLocalVersions(slug: string) {
  const store = readAllVersions()
  delete store[slug]
  writeJson(STORAGE_KEYS.offlineVersions, store)
}

export function localVersionCounts(): { slug: string; count: number }[] {
  return Object.entries(readAllVersions())
    .map(([slug, list]) => ({ slug, count: list.length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** 删除某条本机快照（离线版中「删除版本名称」等清理操作用） */
export function removeLocalVersion(slug: string, id: string) {
  const store = readAllVersions()
  store[slug] = (store[slug] ?? []).filter((item) => item.id !== id)
  if (store[slug].length === 0) delete store[slug]
  writeJson(STORAGE_KEYS.offlineVersions, store)
}

/**
 * 把本机快照映射成线上版使用的 Git 历史结构，
 * 这样历史浏览、版本对比、版本名称等 UI 在离线版里可以直接复用。
 */
export function toPostHistoryVersions(list: LocalVersion[]): PostHistoryVersion[] {
  return list.map((item) => ({
    sha: item.id,
    message: item.message,
    committedAt: new Date(item.savedAt).toISOString(),
    author: { name: '本机（离线版）' },
  }))
}

export function isLocalVersionSha(sha: string): boolean {
  return sha.startsWith('local-')
}
