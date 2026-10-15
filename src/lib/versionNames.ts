/**
 * 历史版本显示名称 —— Git 提交信息不可修改，
 * 这里为每个提交 sha 保存一个浏览器本地的自定义版本名，
 * 在历史版本列表与版本对比中优先显示。
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

/** 返回该版本的自定义名称；未设置时返回 null（调用方回退到提交信息）。 */
export function getVersionName(sha: string): string | null {
  const name = readStore()[sha]
  return name && name.trim() ? name.trim() : null
}

/** 设置版本显示名称；传 null 或空字符串表示恢复默认（提交信息）。 */
export function setVersionName(sha: string, name: string | null) {
  const store = readStore()
  const trimmed = name?.trim()
  if (trimmed) store[sha] = trimmed
  else delete store[sha]
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    throw new Error('本地存储空间不足，无法保存版本名称')
  }
  window.dispatchEvent(new CustomEvent(VERSION_NAMES_CHANGED_EVENT))
}
