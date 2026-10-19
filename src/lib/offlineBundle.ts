/**
 * 离线导入包（starlog-offline-bundle）。
 *
 * 用途：把离线单文件版里写好的全部文章，一次性导入到线上站点
 * （blog-apa.pages.dev 或 lrbkdgw.github.io/Blog）的**本地文章列表**。
 * 导入后即可在站点里正常浏览，再用站点原有的「待更新队列 → 统一更新」提交到仓库，
 * 走一次提交、一次部署，文章就出现在线上文章列表里。
 *
 * 同一份格式既用于「下载导入包文件 / 复制到剪贴板」，也用于跨窗口 postMessage 传输，
 * 因此序列化结果是一个自描述的 JSON 文本，不依赖任何二进制压缩。
 */
import { offlineConfig, siteConfig } from './config'
import { getRepoTarget } from './github'
import {
  buildPost,
  getAllPosts,
  getPostBySlug,
  postFingerprint,
  saveLocalPostRaw,
  serializePost,
} from './posts'
import { readPersonalSettings, writePersonalSetting } from './settingsStore'
import { listStagedImages, enqueueImageUploadDataUrl } from './updateQueue'

export const BUNDLE_FORMAT = 'starlog-offline-bundle'
export const BUNDLE_VERSION = 1
export const BUNDLE_FILE_SUFFIX = offlineConfig.importFileSuffix

export interface BundlePost {
  slug: string
  title: string
  /** 完整 Markdown（含 frontmatter）；加密文章为加密信封 */
  markdown: string
  date: string
  draft: boolean
  savedAt: number
}

export interface BundleImage {
  /** 仓库内路径，如 public/uploads/1700000000-a.png */
  path: string
  /** 文章正文中使用的访问地址 */
  url: string
  title: string
  dataUrl: string
}

export interface OfflineBundle {
  format: typeof BUNDLE_FORMAT
  version: number
  createdAt: string
  generator: string
  site: { title: string; description: string; author: string }
  /** 导出时的目标仓库（仅用于展示与提示） */
  repo: { owner: string; repo: string; branch: string; postsDir: string }
  posts: BundlePost[]
  images: BundleImage[]
  /** 可选：一并带上外观与排版偏好 */
  settings?: { personal?: Record<string, unknown>; theme?: string }
}

export interface BundleCollectOptions {
  /** 是否包含草稿（draft: true） */
  includeDrafts?: boolean
  /** 是否包含尚未上传到仓库的图片 */
  includeImages?: boolean
  /** 是否包含外观偏好 */
  includeSettings?: boolean
  /** 只导出指定 slug（用于「同步选中的文章」） */
  onlySlugs?: string[]
}

/** 收集当前浏览器中的全部文章，生成导入包 */
export function collectBundle(options: BundleCollectOptions = {}): OfflineBundle {
  const {
    includeDrafts = true,
    includeImages = true,
    includeSettings = false,
    onlySlugs,
  } = options
  const wanted = onlySlugs?.length ? new Set(onlySlugs) : null
  const posts: BundlePost[] = []
  for (const post of getAllPosts()) {
    if (wanted && !wanted.has(post.slug)) continue
    if (!includeDrafts && post.draft) continue
    posts.push({
      slug: post.slug,
      title: post.title,
      // 加密文章导出的是密文信封（与原文件一致），本机不会外泄明文
      markdown: post.encryption ? encryptedEnvelopeMarkdown(post) : serializePost(post),
      date: post.date,
      draft: Boolean(post.draft),
      savedAt: post.savedAt ?? Date.now(),
    })
  }
  if (posts.length === 0) throw new Error('离线文章库是空的，没有可导出的文章')

  const images: BundleImage[] = includeImages ? listStagedImages() : []
  const bundle: OfflineBundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: new Date().toISOString(),
    generator: 'starlog',
    site: {
      title: siteConfig.title,
      description: siteConfig.description,
      author: siteConfig.author.name,
    },
    repo: getRepoTarget(),
    posts,
    images,
  }
  if (includeSettings) {
    bundle.settings = {
      // 只带走外观与排版偏好，不带仓库覆盖设置（owner / repo 由接收方自己决定）
      personal: sanitizeSettingsBlob(readPersonalSettings()),
      theme: typeof localStorage !== 'undefined' ? localStorage.getItem('starlog:theme') ?? undefined : undefined,
    }
    if (!bundle.settings.personal && !bundle.settings.theme) delete bundle.settings
  }
  return bundle
}

/**
 * 加密文章不能用 serializePost 重新序列化（那会用明文正文覆盖密文信封）。
 * 这里直接回填 frontmatter + 原样保留信封内容。
 */
function encryptedEnvelopeMarkdown(post: {
  title: string
  date: string
  tags: string[]
  content: string
  encryption?: string
}): string {
  if (!post.encryption) return serializePost(post as never)
  const lines = [
    '---',
    `title: ${JSON.stringify(post.title)}`,
    `date: ${JSON.stringify(post.date)}`,
    `tags: [${post.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    'encrypted: true',
    `encryption: ${JSON.stringify(post.encryption)}`,
    '---',
    '',
    post.content.replace(/^\n+/, ''),
    '',
  ]
  return lines.join('\n')
}

function sanitizeSettingsBlob(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const allowed = ['colorTheme', 'font', 'background', 'editor']
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry !== undefined) out[key] = entry
  }
  return Object.keys(out).length ? out : undefined
}

export function serializeBundle(bundle: OfflineBundle): string {
  return JSON.stringify(bundle, null, 2)
}

export function bundleByteSize(bundle: OfflineBundle): number {
  return new TextEncoder().encode(serializeBundle(bundle)).length
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export type BundleParseResult = { ok: true; bundle: OfflineBundle } | { ok: false; error: string }

/** 严格解析导入包：格式不符必须明确报错，不做「尽力猜测」的静默兼容 */
export function parseBundle(text: string): BundleParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `不是有效的 JSON 文本（${err instanceof Error ? err.message : '解析失败'}）` }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: '导入包内容不是对象' }
  const raw = data as Partial<OfflineBundle> & Record<string, unknown>
  if (raw.format !== BUNDLE_FORMAT) {
    return { ok: false, error: `导入包格式标识不正确（期望 ${BUNDLE_FORMAT}，实际 ${String(raw.format ?? '无')}）` }
  }
  if (typeof raw.version === 'number' && raw.version > BUNDLE_VERSION) {
    return { ok: false, error: `导入包版本过新（v${raw.version}），请先更新站点或离线文件` }
  }
  if (!Array.isArray(raw.posts) || raw.posts.length === 0) {
    return { ok: false, error: '导入包里没有任何文章' }
  }
  const posts: BundlePost[] = []
  for (const item of raw.posts) {
    if (!item || typeof item !== 'object') continue
    const post = item as Partial<BundlePost>
    if (typeof post.markdown !== 'string' || !post.markdown.trim()) continue
    const slug =
      typeof post.slug === 'string' && post.slug.trim()
        ? post.slug.trim()
        : buildPost(post.markdown, { source: 'local' }).slug
    if (!slug) continue
    posts.push({
      slug,
      title: (typeof post.title === 'string' && post.title.trim()) || buildPost(post.markdown, { source: 'local' }).title,
      markdown: post.markdown,
      date: typeof post.date === 'string' ? post.date : '',
      draft: Boolean(post.draft),
      savedAt: typeof post.savedAt === 'number' ? post.savedAt : Date.now(),
    })
  }
  if (posts.length === 0) return { ok: false, error: '导入包里的文章都缺少可用的 markdown 字段' }
  const images: BundleImage[] = Array.isArray(raw.images)
    ? (raw.images as unknown[]).filter(
        (item): item is BundleImage =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as BundleImage).dataUrl === 'string' &&
          typeof (item as BundleImage).path === 'string' &&
          (item as BundleImage).dataUrl.startsWith('data:'),
      )
    : []
  const bundle: OfflineBundle = {
    format: BUNDLE_FORMAT,
    version: typeof raw.version === 'number' ? raw.version : BUNDLE_VERSION,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    generator: typeof raw.generator === 'string' ? raw.generator : 'starlog',
    site: raw.site && typeof raw.site === 'object' ? (raw.site as OfflineBundle['site']) : { title: '', description: '', author: '' },
    repo: raw.repo && typeof raw.repo === 'object' ? (raw.repo as OfflineBundle['repo']) : getRepoTarget(),
    posts,
    images,
  }
  if (raw.settings && typeof raw.settings === 'object') bundle.settings = raw.settings as OfflineBundle['settings']
  return { ok: true, bundle }
}

/* ------------------------------- 导入计划与执行 ---------------------------- */

export type ImportAction = 'create' | 'overwrite' | 'skip'
export type ImportPolicy = 'overwrite' | 'skip' | 'duplicate'

export interface ImportPlanItem {
  slug: string
  title: string
  date: string
  draft: boolean
  action: ImportAction
  reason: string
  markdown: string
  /** policy 为 duplicate 时实际写入的新 slug */
  targetSlug: string
  chars: number
}

export interface ImportPlan {
  items: ImportPlanItem[]
  counts: Record<ImportAction, number>
  images: number
  hasSettings: boolean
  source: { createdAt: string; title: string; repo: string }
}

/** 逐篇判断新增 / 覆盖 / 跳过：与本机同 slug 的文章比对指纹，内容一致则跳过。 */
export function planImport(
  bundle: OfflineBundle,
  policy: ImportPolicy = 'overwrite',
  options: { selectedSlugs?: string[] } = {},
): ImportPlan {
  const selected = options.selectedSlugs?.length ? new Set(options.selectedSlugs) : null
  const suffix = `imported-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const items: ImportPlanItem[] = []
  const counts: Record<ImportAction, number> = { create: 0, overwrite: 0, skip: 0 }
  for (const post of bundle.posts) {
    if (selected && !selected.has(post.slug)) continue
    const incoming = buildPost(post.markdown, { slug: post.slug, source: 'local' })
    const existing = getPostBySlug(post.slug)
    let action: ImportAction = 'create'
    let reason = existing ? '' : '本站点还没有这篇文章'
    let targetSlug = post.slug
    if (existing) {
      const same =
        postFingerprint({ ...incoming, encryption: incoming.encryption }) ===
        postFingerprint({ ...existing, encryption: existing.encryption })
      if (same) {
        action = 'skip'
        reason = '内容与本机版本一致'
      } else if (policy === 'skip') {
        action = 'skip'
        reason = existing.source === 'repo' ? '已发布到仓库，按要求跳过' : '本机已有同名文章，按要求跳过'
      } else if (policy === 'duplicate') {
        action = 'create'
        targetSlug = `${post.slug}-${suffix}`
        reason = `本机已有同名文章，另存为 ${targetSlug}`
      } else {
        action = 'overwrite'
        reason = incoming.encryption
          ? '加密文章：覆盖为导入包中的密文信封'
          : existing.source === 'repo'
            ? '本机版本会先覆盖内置文章，统一更新后写入仓库'
            : '用导入包中的内容覆盖本机版本'
      }
    }
    counts[action] += 1
    items.push({
      slug: post.slug,
      title: incoming.title || post.title,
      date: incoming.date,
      draft: Boolean(incoming.draft),
      action,
      reason,
      markdown: post.markdown,
      targetSlug,
      chars: post.markdown.length,
    })
  }
  return {
    items,
    counts,
    images: bundle.images.length,
    hasSettings: Boolean(bundle.settings?.personal || bundle.settings?.theme),
    source: {
      createdAt: bundle.createdAt,
      title: bundle.site?.title || '',
      repo: bundle.repo ? `${bundle.repo.owner}/${bundle.repo.repo}` : '',
    },
  }
}

export interface ImportApplyOptions {
  items: ImportPlanItem[]
  /**
   * 导入包原文：图片与偏好不会出现在 ImportPlanItem 里，执行时需要完整包。
   * 必须显式传入——以前这里读的是模块内缓存的「最近一次 plan」，
   * 调用顺序一变就静默丢图片、丢偏好，排查成本极高。
   */
  bundle: OfflineBundle
  /** 是否把导入包中的图片写入待更新队列（统一更新时一并上传） */
  importImages?: boolean
  /** 是否应用导入包中的外观偏好 */
  importSettings?: boolean
}

export interface ImportApplyResult {
  created: number
  overwrote: number
  skipped: number
  images: number
  failed: { slug: string; message: string }[]
}

/**
 * 执行导入：写入本站点的**本地文章列表**（saveLocalPostRaw）。
 * 之后由站点原有的「待更新队列 → 统一更新」提交到 GitHub，一次提交一次部署。
 */
export async function applyImport(options: ImportApplyOptions): Promise<ImportApplyResult> {
  const { items, bundle, importImages = true, importSettings = false } = options
  if (!bundle) throw new Error('applyImport 缺少导入包内容：请先 planImport(bundle, …)，再把同一个 bundle 传给 applyImport')
  const result: ImportApplyResult = { created: 0, overwrote: 0, skipped: 0, images: 0, failed: [] }
  if (items.length === 0) return result

  for (const item of items) {
    if (item.action === 'skip') {
      result.skipped += 1
      continue
    }
    try {
      saveLocalPostRaw(item.targetSlug, item.markdown)
      if (item.action === 'overwrite') result.overwrote += 1
      else result.created += 1
    } catch (err) {
      result.failed.push({ slug: item.slug, message: err instanceof Error ? err.message : '写入本地文章库失败' })
    }
  }

  if (importImages) {
    for (const image of bundle.images) {
      try {
        enqueueImageUploadDataUrl(image.dataUrl, image.title, image.path)
        result.images += 1
      } catch (err) {
        result.failed.push({ slug: image.path, message: err instanceof Error ? err.message : '图片暂存失败' })
      }
    }
  }

  if (importSettings) {
    const personal = bundle.settings?.personal
    if (personal && Object.keys(personal).length > 0) {
      for (const [key, value] of Object.entries(personal)) writePersonalSetting(key, value)
    }
    const theme = bundle.settings?.theme
    if (theme && typeof localStorage !== 'undefined') localStorage.setItem('starlog:theme', theme)
  }

  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
  return result
}

export function downloadBundle(bundle: OfflineBundle, filename?: string) {
  const text = serializeBundle(bundle)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || `starlog-offline-${new Date().toISOString().slice(0, 10)}.${BUNDLE_FILE_SUFFIX}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
