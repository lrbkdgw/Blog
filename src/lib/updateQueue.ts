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
 */
import {
  commitFileChanges,
  getRepoTarget,
  submitPublicationPR,
  type FileChange,
} from './github'
import { recordPublishTime } from './publishTimes'

export type QueueItemKind =
  | 'post-publish'
  | 'post-delete'
  | 'post-pr'
  | 'image-upload'
  | 'settings-sync'

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
  /** settings-sync：待写入的文本内容 */
  text?: string
  /** image-upload：本地 data URL 与最终仓库访问地址 */
  dataUrl?: string
  url?: string
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

function readStore(): QueueItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
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

/** 加入队列；同 slug 的文章意图、同路径的设置文件会替换旧条目（最新意图生效）。 */
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
): QueueItem {
  return enqueueUpdate({
    kind: 'post-pr',
    title: post.title || post.slug,
    target: post.slug,
    markdown,
  })
}

export function enqueueSettingsSync(path: string, title: string, text: string): QueueItem {
  return enqueueUpdate({ kind: 'settings-sync', title, target: path, text })
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
  }
}

function buildCommitMessage(fileItems: QueueItem[]): string {
  if (fileItems.length === 1) return singleCommitMessage(fileItems[0])
  const lines = fileItems.map((item) => `- ${describeItem(item)}`)
  return `chore(blog): 批量更新 ${fileItems.length} 项内容\n\n${lines.join('\n')}`
}

/**
 * 执行队列更新：
 *   - 文件类更改（文章、图片、设置）合并为一次 Git 提交（一次部署）；
 *   - 发表申请逐个创建 PR。
 * 失败的条目会保留在队列中，成功的条目自动移除。
 */
export async function flushUpdateQueue(selected?: QueueItem[]): Promise<FlushResult> {
  const wanted = selected ?? getUpdateQueue()
  const fileItems: QueueItem[] = []
  const prItems: QueueItem[] = []
  for (const item of wanted) {
    if (item.kind === 'post-pr') prItems.push(item)
    else fileItems.push(item)
  }

  const succeeded: QueueItem[] = []
  const failed: FlushFailure[] = []
  const prUrls: string[] = []
  let commitUrl: string | undefined

  if (fileItems.length > 0) {
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
    try {
      const res = await commitFileChanges(changes, buildCommitMessage(fileItems))
      commitUrl = res.commitUrl
      for (const item of fileItems) {
        if (item.kind === 'post-publish') recordPublishTime(item.target, Date.now())
        succeeded.push(item)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '提交到仓库失败'
      for (const item of fileItems) failed.push({ item, message })
    }
  }

  for (const item of prItems) {
    try {
      const pr = await submitPublicationPR(item.target, item.markdown ?? '', item.title)
      prUrls.push(pr.html_url)
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
