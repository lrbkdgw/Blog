/**
 * GitHub 发布时间记录 —— 独立成模块，避免「待更新队列」等工具模块
 * 为了一个函数引入 posts.ts（其中含 Vite 专属的 import.meta.glob，
 * 在 VS Code 插件等非 Vite 打包环境里会崩溃）。
 */

const PUBLISHED_TIMES_KEY = 'starlog:published-times'

function readPublishTimes(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(PUBLISHED_TIMES_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function recordPublishTime(slug: string, timestamp = Date.now()) {
  const store = readPublishTimes()
  store[slug] = timestamp
  localStorage.setItem(PUBLISHED_TIMES_KEY, JSON.stringify(store))
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
}

export function readPublishTimeStore(): Record<string, number> {
  return readPublishTimes()
}
