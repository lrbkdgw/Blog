/**
 * 首页「向下滑动自动加载更多」的观察器。
 *
 * 单独抽成纯函数是为了能测：它不依赖 React，也不假设浏览器一定支持
 * IntersectionObserver（老浏览器 / 测试环境返回 no-op，页面仍保留「加载更多」按钮）。
 *
 * 触发语义：
 *   - 只认「哨兵元素进入视口（含 rootMargin 预留的提前量）」；
 *   - 每次观察只回调一次：回调后由调用方重新渲染并重新 observe（这样依靠新的
 *     DOM 高度自然停下来，不会因为一次滑动连续翻好几页）；
 *   - 卸载 / 重新观察时 disconnect，不会在已卸载的组件上 setState。
 */

export interface ReachEndOptions {
  root?: Element | null
  /** 提前量：默认在距视口底部 320px 时就开始加载，滑动到底时内容已经就位。 */
  rootMargin?: string
  threshold?: number
  /** 供测试注入；默认用全局 IntersectionObserver。 */
  observerFactory?: typeof IntersectionObserver
}

/** 监听 target 第一次进入视口底部区域，返回取消函数。 */
export function observeReachEnd(
  target: Element | null,
  onReachEnd: () => void,
  options: ReachEndOptions = {},
): () => void {
  const { root = null, rootMargin = '0px 0px 320px 0px', threshold = 0, observerFactory } = options
  const Observer = observerFactory ?? (typeof IntersectionObserver === 'undefined' ? null : IntersectionObserver)
  if (!target || !Observer) return () => undefined

  let fired = false
  const observer = new Observer(
    (entries) => {
      if (fired) return
      if (!entries.some((entry) => entry.isIntersecting)) return
      fired = true
      onReachEnd()
    },
    { root, rootMargin, threshold },
  )
  observer.observe(target)
  return () => observer.disconnect()
}
