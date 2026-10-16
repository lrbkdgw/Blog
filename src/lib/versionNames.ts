/**
 * 历史版本显示名称 —— Git 提交信息不可修改，这里为每个提交 sha 保存一个自定义版本名，
 * 在历史版本列表与版本对比中优先于提交信息显示。
 *
 * 名称分两层：
 *   - 本地层（浏览器 localStorage）：重命名后立即生效，含尚未更新到仓库的名称；
 *   - 仓库层（文章旁的 `content/posts/{slug}.versions.json`）：修改名称会先加入
 *     「待更新队列」，统一更新时提交到 GitHub 对应文章旁，构建后所有访客可见。
 *
 * 显示优先级：本地名称 → 仓库名称 → 提交信息。
 */
const KEY = 'starlog:version-names'
export const VERSION_NAMES_CHANGED_EVENT = 'starlog:version-names-changed'

function readStore(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 返回该版本的本地自定义名称；未设置时返回 null。 */
export function getVersionName(sha: string): string | null {
  const name = readStore()[sha]
  return name && name.trim() ? name.trim() : null
}

/** 设置本地版本显示名称；传 null 或空字符串表示恢复默认（提交信息）。
 *  恢复默认会保留一个空值标记：在仓库里的旧名称被清除前，本地先把它压下去。 */
export function setVersionName(sha: string, name: string | null) {
  const store = readStore()
  const trimmed = name?.trim()
  if (trimmed) store[sha] = trimmed
  else store[sha] = ''
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    throw new Error('本地存储空间不足，无法保存版本名称')
  }
  window.dispatchEvent(new CustomEvent(VERSION_NAMES_CHANGED_EVENT))
}

/* ------------------------------ 仓库中的版本名称 ------------------------------ */

// Vite 专属 API：与 posts.ts 一样用 try/catch 兜底，避免非 Vite 打包环境（如 VS Code 插件）
// 加载本模块时抛错；不能用 typeof 守卫（生产构建只替换 import.meta.glob 调用本身）。
function readRepoVersionNameSources(): Record<string, string> {
  try {
    return import.meta.glob('/content/posts/**/*.versions.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  } catch {
    return {}
  }
}

/** 把「sha → 版本名」映射规范化：键与值去空白，丢弃空键/空值与结构损坏的数据。 */
export function normalizeVersionNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const names: Record<string, string> = {}
  for (const [sha, name] of Object.entries(value)) {
    const key = sha.trim()
    const val = typeof name === 'string' ? name.trim() : ''
    if (key && val) names[key] = val
  }
  return names
}

/** slug → 该文章在仓库中保存的版本名称（构建时打包；单个文件损坏时跳过它）。 */
function readRepoVersionNames(): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const [path, raw] of Object.entries(readRepoVersionNameSources())) {
    const slug = path.split('/').pop()?.replace(/\.versions\.json$/i, '') ?? ''
    if (!slug) continue
    try {
      result[slug] = normalizeVersionNames(JSON.parse(String(raw)))
    } catch (err) {
      console.warn('[versionNames] 跳过无法解析的版本名称文件：', path, err)
    }
  }
  return result
}

const repoNames = readRepoVersionNames()

/** 仓库中保存的该文章版本名称映射（无则返回空对象）。 */
export function getRepoVersionNames(slug: string): Record<string, string> {
  return repoNames[slug] ?? {}
}

/**
 * 返回该版本的显示名称：本地名称（含待更新的修改）优先，其次仓库中保存的名称；
 * 本地显式「恢复默认」（空值标记）会直接回退到提交信息，均未设置时返回 null。
 */
export function resolveVersionName(sha: string, slug?: string): string | null {
  const store = readStore()
  if (sha in store) {
    const local = store[sha]
    return local && local.trim() ? local.trim() : null
  }
  if (slug) {
    const repo = getRepoVersionNames(slug)[sha]
    if (repo) return repo
  }
  return null
}
