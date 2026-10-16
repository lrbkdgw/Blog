/**
 * 待更新队列 —— 所有需要更新 GitHub 仓库的操作都先保存在浏览器本地，
 * 由用户在内容管理界面的「待更新队列」中勾选后统一提交（一次批量提交），
 * 或全部更新；也可以随时移除某项更改。
 *
 * 覆盖的操作：
 *   - 更新/发布文章（post-publish）
 *   - 删除仓库文章（post-delete）
 *   - 发表申请 PR（post-pr，由无 push 权限的用户提交）
 *   - 上传图片（image-upload，图片本体以 data URL 暂存本地）
 *   - 账号偏好同步（settings-sync，如字体、背景偏好文件）
 *   - 历史版本名称（version-name，写入文章旁的 {slug}.versions.json）
 */
import {
  commitFileChanges,
  fetchRemoteFile,
  getRepoTarget,
  submitPublicationPR,
  type FileChange,
} from './github'
import { normalizeVersionNames } from './versionNames'
import { recordPublishTime } from './publishTimes'
import { removeLocalPostIfSynced } from './posts'

export type QueueItemKind =
  | 'post-publish'
  | 'post-delete'
  | 'post-pr'
  | 'image-upload'
  | 'settings-sync'
  | 'version-name'

export interface QueueItem {
  id: string
  kind: QueueItemKind
  /** 展示标题（文章标题 / 图片文件名 / 偏好说明） */
  title: string
  /** 文章 slug、图片仓库路径或设置文件路径 */
  target: string
  createdAt: number
  /** post-publish / post-pr：待写入的完整 Markdown */
  markdown?: string
  /** post-pr：修改 slug 时旧文件的 slug，PR 中一并删除它 */
  renamedFrom?: string
  /** settings-sync：待写入的文本内容 */
  text?: string
  /** image-upload：本地 data URL 与最终仓库访问地址 */
  dataUrl?: string
  url?: string
  /** version-name：sha → 新名称（null 表示恢复默认），同文章的多次改名合并保留最新意图 */
  renames?: Record<string, string | null>
}

export interface FlushFailure {
  item: QueueItem
  message: string
}

export interface FlushResult {
  /** 成功应用的条目 */
  succeeded: QueueItem[]
  /** 失败的条目（保留在队列中） */
  failed: FlushFailure[]
  /** 批量提交的 commit 链接（若有文件类更改） */
  commitUrl?: string
  /** 成功创建的发表申请 PR 链接 */
  prUrls: string[]
}

const QUEUE_KEY = 'starlog:update-queue'
export const QUEUE_CHANGED_EVENT = 'starlog:queue-changed'

/** 与文章相关的三种意图共享同一 slug 命名空间：同一篇文章只保留最新意图。 */
const POST_KINDS: QueueItemKind[] = ['post-publish', 'post-delete', 'post-pr']

/** localStorage 存不下超大图片（base64 还会膨胀约 1/3），提前拦截。 */
const MAX_IMAGE_DATAURL_CHARS = 3_200_000

const QUEUE_KINDS: QueueItemKind[] = ['post-publish', 'post-delete', 'post-pr', 'image-upload', 'settings-sync', 'version-name']

function readStore(): QueueItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    // 丢弃结构损坏的条目，避免它们在批量更新时抛错
    return parsed.filter(
      (item): item is QueueItem =>
        !!item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.target === 'string' &&
        QUEUE_KINDS.includes(item.kind),
    )
  } catch {
    return []
  }
}

function writeStore(items: QueueItem[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
  } catch {
    throw new Error(
      '本地存储空间不足，无法加入待更新队列。请先更新/移除队列中的部分更改，或改用外链图片',
    )
  }
  imageCache = null
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT))
}

export function getUpdateQueue(): QueueItem[] {
  return readStore()
}

export function getQueueCount(): number {
  return readStore().length
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 加入队列；同 slug 的文章意图、同路径的设置文件、同文章的版本名称会替换旧条目（最新意图生效）。 */
export function enqueueUpdate(
  item: Omit<QueueItem, 'id' | 'createdAt'>,
): QueueItem {
  const next: QueueItem = { ...item, id: makeId(), createdAt: Date.now() }
  let items = readStore()
  if (POST_KINDS.includes(next.kind)) {
    items = items.filter(
      (entry) => !(POST_KINDS.includes(entry.kind) && entry.target === next.target),
    )
  } else if (next.kind === 'settings-sync') {
    items = items.filter((entry) => !(entry.kind === 'settings-sync' && entry.target === next.target))
  } else if (next.kind === 'version-name') {
    // 同一篇文章的多次改名合并进同一条目：逐 sha 以最新名称（含恢复默认）为准
    const existing = items.find((entry) => entry.kind === 'version-name' && entry.target === next.target)
    if (existing) {
      next.renames = { ...existing.renames, ...next.renames }
      items = items.filter((entry) => entry.id !== existing.id)
    }
  }
  items.unshift(next)
  writeStore(items)
  return next
}

export function enqueuePostPublish(
  post: { slug: string; title: string },
  markdown: string,
): QueueItem {
  return enqueueUpdate({
    kind: 'post-publish',
    title: post.title || post.slug,
    target: post.slug,
    markdown,
  })
}

export function enqueuePostDelete(slug: string, title: string): QueueItem {
  return enqueueUpdate({ kind: 'post-delete', title: title || slug, target: slug })
}

export function enqueuePostPr(
  post: { slug: string; title: string },
  markdown: string,
  renamedFrom?: string,
): QueueItem {
  return enqueueUpdate({
    kind: 'post-pr',
    title: post.title || post.slug,
    target: post.slug,
    markdown,
    renamedFrom: renamedFrom && renamedFrom !== post.slug ? renamedFrom : undefined,
  })
}

export function enqueueSettingsSync(path: string, title: string, text: string): QueueItem {
  return enqueueUpdate({ kind: 'settings-sync', title, target: path, text })
}

/**
 * 修改某篇文章的历史版本显示名称；name 为 null 表示恢复默认（提交信息）。
 * 保存在文章旁的 `{slug}.versions.json`，统一更新时提交到 GitHub 对应文章下。
 */
export function enqueueVersionRename(
  post: { slug: string; title: string },
  sha: string,
  name: string | null,
): QueueItem {
  const key = sha.trim()
  if (!key) throw new Error('缺少版本标识，无法修改版本名称')
  const trimmed = name?.trim()
  return enqueueUpdate({
    kind: 'version-name',
    title: post.title || post.slug,
    target: post.slug,
    renames: { [key]: trimmed || null },
  })
}

export async function enqueueImageUpload(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('无法读取所选图片文件'))
    reader.readAsDataURL(file)
  })
  if (!dataUrl.startsWith('data:')) throw new Error('无法读取所选图片文件')
  if (dataUrl.length > MAX_IMAGE_DATAURL_CHARS) {
    throw new Error(
      '图片过大，无法暂存到本地待更新队列（约 2.4MB 以上）。请压缩图片或改用外链图片',
    )
  }
  const target = getRepoTarget()
  const safeName = file.name.replace(/[^\w.-]+/g, '-')
  const path = `public/uploads/${Date.now()}-${safeName}`
  const url = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${path}`
  enqueueUpdate({
    kind: 'image-upload',
    title: safeName,
    target: path,
    dataUrl,
    url,
  })
  return url
}

export function removeQueueItem(id: string) {
  writeStore(readStore().filter((item) => item.id !== id))
}

export function clearUpdateQueue() {
  writeStore([])
}

/* --------------------------- 暂存图片的本地预览 --------------------------- */

/** url → data URL 映射：队列里的图片在更新到仓库前，站内预览先用本地数据渲染。 */
let imageCache: Map<string, string> | null = null
let storageListenerAttached = false

function getImageCache(): Map<string, string> {
  if (!storageListenerAttached && typeof window !== 'undefined') {
    storageListenerAttached = true
    // 其他标签页修改队列后，本页的暂存图片预览也要失效重建
    window.addEventListener('storage', () => {
      imageCache = null
    })
  }
  if (!imageCache) {
    imageCache = new Map()
    for (const item of readStore()) {
      if (item.kind === 'image-upload' && item.url && item.dataUrl) {
        imageCache.set(item.url, item.dataUrl)
      }
    }
  }
  return imageCache
}

/** 队列中的图片尚未上传时，返回本地 data URL 供预览；否则原样返回。 */
export function resolvePendingImageSrc(src: string): string {
  if (!src) return src
  return getImageCache().get(src) ?? src
}

/* -------------------------------- 批量更新 ------------------------------- */

function postFilePath(slug: string): string {
  return `${getRepoTarget().postsDir}/${slug}.md`
}

/** 版本名称保存在对应文章旁的同名 JSON 文件里（与文章一一对应，随文章删除一并清理）。 */
function versionNamesFilePath(slug: string): string {
  return `${getRepoTarget().postsDir}/${slug}.versions.json`
}

/** 应用改名意图：sha → 新名称（null 表示恢复默认，即删除该条）。 */
function applyRenameOps(
  base: Record<string, string>,
  ops: Record<string, string | null>,
): Record<string, string> {
  const next = { ...base }
  for (const [sha, name] of Object.entries(ops)) {
    const key = sha.trim()
    if (!key) continue
    const value = name?.trim()
    if (value) next[key] = value
    else delete next[key]
  }
  return next
}

function sameVersionNames(a: Record<string, string>, b: Record<string, string>): boolean {
  const entries = (map: Record<string, string>) =>
    Object.entries(map).sort(([x], [y]) => x.localeCompare(y))
  return JSON.stringify(entries(a)) === JSON.stringify(entries(b))
}

/** 读取仓库中该文章已保存的版本名称映射（文件不存在或无法解析时视为空）。 */
async function fetchVersionNames(slug: string): Promise<{ names: Record<string, string>; exists: boolean }> {
  const path = versionNamesFilePath(slug)
  try {
    const { text } = await fetchRemoteFile(path)
    try {
      return { names: normalizeVersionNames(JSON.parse(text)), exists: true }
    } catch (err) {
      console.warn('[updateQueue] 版本名称文件无法解析，将以空映射重建：', path, err)
      return { names: {}, exists: true }
    }
  } catch (err) {
    if (err instanceof Error && ((err as { status?: number }).status === 404 || /找不到资源/.test(err.message))) {
      return { names: {}, exists: false }
    }
    throw err
  }
}

/**
 * 生成版本名称文件的写入/删除更改。
 * 合并规则：以仓库现有映射为底，应用本次改名意图（可跨设备叠加，不覆盖他人的名称）。
 * 映射无实际变化时返回 null（无需产生一次提交）。
 */
async function buildVersionNamesChange(
  slug: string,
  ops: Record<string, string | null>,
): Promise<FileChange | null> {
  const path = versionNamesFilePath(slug)
  const { names: current, exists } = await fetchVersionNames(slug)
  const next = applyRenameOps(current, ops)
  if (sameVersionNames(current, next)) return null
  if (Object.keys(next).length === 0) return exists ? { path, delete: true } : null
  return { path, text: `${JSON.stringify(next, null, 2)}\n` }
}

/** 文章删除后版本名称文件不再有意义：存在时一并删除（清理失败不影响文章删除）。 */
async function buildVersionNamesCleanup(slug: string): Promise<FileChange | null> {
  const path = versionNamesFilePath(slug)
  try {
    const { exists } = await fetchVersionNames(slug)
    return exists ? { path, delete: true } : null
  } catch (err) {
    console.warn('[updateQueue] 清理版本名称文件失败（不影响文章删除）：', err)
    return null
  }
}

function describeItem(item: QueueItem): string {
  switch (item.kind) {
    case 'post-publish':
      return `更新文章《${item.title}》`
    case 'post-delete':
      return `删除文章《${item.title}》`
    case 'post-pr':
      return `发表申请《${item.title}》`
    case 'image-upload':
      return `上传图片 ${item.title}`
    case 'settings-sync':
      return item.title
    case 'version-name':
      return `更新《${item.title}》的版本名称`
  }
}

function singleCommitMessage(item: QueueItem): string {
  switch (item.kind) {
    case 'post-publish':
      return `post(blog): ${item.title}`
    case 'post-delete':
      return `chore(blog): 删除文章 ${item.title}`
    case 'image-upload':
      return `chore(blog): 上传图片 ${item.title}`
    case 'post-pr':
      return `post(blog): ${item.title}`
    case 'settings-sync':
      return `chore(settings): ${item.title}`
    case 'version-name':
      return `chore(blog): 更新文章《${item.title}》的版本名称`
  }
}

function buildCommitMessage(fileItems: QueueItem[]): string {
  if (fileItems.length === 1) return singleCommitMessage(fileItems[0])
  const lines = fileItems.map((item) => `- ${describeItem(item)}`)
  return `chore(blog): 批量更新 ${fileItems.length} 项内容\n\n${lines.join('\n')}`
}

/** 远端操作已成功后的本地收尾工作：失败只记录，不影响更新结果。 */
function bestEffort(fn: () => unknown) {
  try {
    fn()
  } catch (err) {
    console.warn('[updateQueue] 本地收尾操作失败（不影响已提交的更新）：', err)
  }
}

/**
 * 执行队列更新：
 *   - 文件类更改（文章、图片、设置、版本名称）合并为一次 Git 提交（一次部署）；
 *   - 发表申请逐个创建 PR。
 * 失败的条目会保留在队列中，成功的条目自动移除。
 */
export async function flushUpdateQueue(selected?: QueueItem[]): Promise<FlushResult> {
  const queue = getUpdateQueue()
  const wanted = [...(selected ?? queue)]
  // 文章引用的图片必须与文章一起提交，否则已发布的文章会指向尚不存在的图片。
  // 把"已选文章中引用到、但未被选中"的待上传图片自动加入本次更新。
  const included = new Set(wanted.map((item) => item.id))
  for (const article of wanted.slice()) {
    if (!article.markdown) continue
    for (const image of queue) {
      if (
        image.kind === 'image-upload' &&
        image.url &&
        !included.has(image.id) &&
        article.markdown.includes(image.url)
      ) {
        included.add(image.id)
        wanted.push(image)
      }
    }
  }
  const fileItems: QueueItem[] = []
  const prItems: QueueItem[] = []
  // 版本名称存放在文章旁的独立文件里，按文章分组合并成一次写入（同名文件一次提交只写一份）
  const versionGroups = new Map<string, QueueItem[]>()
  for (const item of wanted) {
    if (item.kind === 'post-pr') {
      prItems.push(item)
    } else if (item.kind === 'version-name') {
      const group = versionGroups.get(item.target) ?? []
      group.push(item)
      versionGroups.set(item.target, group)
    } else {
      fileItems.push(item)
    }
  }
  // 文章将被删除时版本名称无需保存，避免同一路径在同一提交里既删除又写入
  const deletingSlugs = new Set(
    fileItems.filter((item) => item.kind === 'post-delete').map((item) => item.target),
  )

  const succeeded: QueueItem[] = []
  const failed: FlushFailure[] = []
  const prUrls: string[] = []
  let commitUrl: string | undefined

  // 先准备版本名称文件的更改；映射无变化的条目直接视为成功（不产生空提交）
  const versionChanges: FileChange[] = []
  const versionChangeItems: QueueItem[] = []
  for (const [slug, group] of versionGroups) {
    if (deletingSlugs.has(slug)) {
      succeeded.push(...group)
      continue
    }
    const ops: Record<string, string | null> = {}
    // 队列条目最新在前：倒序合并，保证同 sha 的最新改名意图生效
    for (const item of [...group].reverse()) Object.assign(ops, item.renames ?? {})
    try {
      const change = await buildVersionNamesChange(slug, ops)
      if (change) {
        versionChanges.push(change)
        versionChangeItems.push(...group)
      } else {
        succeeded.push(...group)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存版本名称失败'
      for (const item of group) failed.push({ item, message })
    }
  }

  const commitItems = [...fileItems, ...versionChangeItems]
  if (commitItems.length > 0 && (fileItems.length > 0 || versionChanges.length > 0)) {
    const changes: FileChange[] = fileItems.map((item) => {
      if (item.kind === 'post-delete') return { path: postFilePath(item.target), delete: true }
      if (item.kind === 'post-publish') return { path: postFilePath(item.target), text: item.markdown ?? '' }
      if (item.kind === 'settings-sync') return { path: item.target, text: item.text ?? '' }
      // image-upload
      return {
        path: item.target,
        base64: (item.dataUrl || '').split(',')[1] || '',
      }
    })
    // 删除文章时一并清理文章旁的版本名称文件（存在才删除）
    for (const item of fileItems) {
      if (item.kind !== 'post-delete') continue
      try {
        const cleanup = await buildVersionNamesCleanup(item.target)
        if (cleanup) changes.push(cleanup)
      } catch (err) {
        console.warn('[updateQueue] 清理版本名称文件失败（不影响文章删除）：', err)
      }
    }
    changes.push(...versionChanges)
    try {
      const res = await commitFileChanges(changes, buildCommitMessage(commitItems))
      commitUrl = res.commitUrl
      for (const item of commitItems) {
        if (item.kind === 'post-publish') {
          // 提交已经成功：本地记录失败（如存储空间不足）不能让这次提交被误报为失败
          bestEffort(() => recordPublishTime(item.target, Date.now()))
          if (item.markdown) bestEffort(() => removeLocalPostIfSynced(item.target, item.markdown!))
        }
        succeeded.push(item)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '提交到仓库失败'
      for (const item of commitItems) failed.push({ item, message })
    }
  }

  for (const item of prItems) {
    try {
      const pr = await submitPublicationPR(item.target, item.markdown ?? '', item.title, undefined, {
        deleteSlug: item.renamedFrom,
      })
      prUrls.push(pr.html_url)
      if (item.markdown) bestEffort(() => removeLocalPostIfSynced(item.target, item.markdown!))
      succeeded.push(item)
    } catch (err) {
      failed.push({ item, message: err instanceof Error ? err.message : '创建发表申请失败' })
    }
  }

  // 移除已成功的条目，保留失败条目供重试。
  if (succeeded.length > 0) {
    const done = new Set(succeeded.map((item) => item.id))
    writeStore(readStore().filter((item) => !done.has(item.id)))
  } else if (failed.length > 0) {
    // 触发事件让界面刷新失败状态
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT))
  }

  return { succeeded, failed, commitUrl, prUrls }
}
