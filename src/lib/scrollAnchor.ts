import { OFFLINE } from './runtime'

/** 标题锚点距离视口顶部的净空，与 .prose 标题的 scroll-margin-top（6.25rem）观感对齐 */
export const HEADING_SCROLL_OFFSET = 100

/**
 * 平滑滚动到指定 id 的标题。
 *
 * 线上版使用 BrowserRouter，可以安全地把锚点写进 URL hash（支持复制链接定位、
 * 浏览器前进后退）；离线版使用 HashRouter，**整个路由就在 hash 里**
 * （形如 `#/posts/slug`），再写入 `#标题id` 会覆盖路由并触发 hashchange，
 * 导致当前文章页被卸载、跳到不存在的路由，因此离线版只滚动、不改 URL。
 */
export function scrollToHeading(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - HEADING_SCROLL_OFFSET
  window.scrollTo({ top, behavior: 'smooth' })
  if (!OFFLINE) {
    history.replaceState(null, '', `#${id}`)
  }
}
