/**
 * 全站内容给吸顶页头让路（issue #71 / #78）。
 *
 * 两条要求本身是冲突的：
 * - 页头必须**完全透明**（issue #53 / #63：顶部不许出现一条与页面脱节的实色横带，
 *   也不许用毛玻璃把背后的主题渐变与动态背景糊掉）；
 * - 但页面内容滚到导航那一栏下面时，字与导航文字叠在一起很难读。
 *
 * 在页头那一层做文章解决不了：页头底下同时压着「背景」和「正文」，任何底色 /
 * 蒙版 / backdrop-filter 都会连背景一起改掉。所以只能**只改内容块本身**——在视口空间中
 * 设定统一的「完全消失线 yVanish（位于页头下沿再向下留出净空）」与「完全显现线 yOpaque」，
 * 让所有进入该过渡带的叶级内容块沿平滑 S 曲线同步消融；背景在独立图层，一像素都不动。
 *
 * 规则：
 * 1. `.prose > *` 自动覆盖所有 Markdown 渲染块；
 * 2. 各页面在容器上标记 `data-yield-list`，其直接子块自动参与让路；若子元素本身又是一个
 *    `data-yield-list` 或 `.prose` 容器，则下钻到更细的子块，避免整屏大容器重复叠蒙版；
 * 3. 全屏弹层 / 对话框（`.fixed`、`[role="dialog"]`）位于吸顶页头之上（z-index 更高），
 *    不参与页头让路，并在进入全屏时自动清掉残留状态；
 * 4. 通过 `MutationObserver` 自动感知懒加载路由挂载、标签切换与列表增删，无需手工逐处补刷新。
 */

/** 页面容器在这里标记自己的让路列表；`.prose > *` 由 Markdown 自动覆盖。 */
export const LIST_SCOPE_ATTR = 'data-yield-list'

const STATE_ATTR = 'data-yield'
const VAR_TOP = '--yield-top'
const VAR_FADE = '--yield-fade'

/**
 * 需要参与让路的叶子「内容块」选择器。
 * 排除自身已是 `.prose` 或 `[data-yield-list]` 的外层包装器，避免父子双层叠蒙版和大图层光栅化。
 */
const BLOCK_SELECTOR = `.prose > *, [${LIST_SCOPE_ATTR}] > *:not(.prose):not([${LIST_SCOPE_ATTR}])`

/** 完全消失线位于 `.site-header` 底边以下的安全净空像素数，确保内容未触及顶栏前已彻底隐去。 */
export const VANISH_OFFSET_PX = 14

/** 从完全消失线 `yVanish` 向下到 100% 清晰线 `yOpaque` 的柔化过渡带高度。 */
export const FADE_SPAN_PX = 50

/** 内容变了（换文章、切路由、Markdown 渲染完）就重算一次；此时不一定伴随滚动事件。 */
export const YIELD_REFRESH_EVENT = 'starlog:content-changed'

/** 供页面在内容就绪后主动请求重算。 */
export function requestHeaderYieldRefresh(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new window.Event(YIELD_REFRESH_EVENT))
}

function clearYield(el: HTMLElement): void {
  el.removeAttribute(STATE_ATTR)
  el.style.removeProperty(VAR_TOP)
  el.style.removeProperty(VAR_FADE)
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * 挂上滚动 / 尺寸 / DOM 变更监听，返回清理函数。
 * 每次都重新查询容器，所以懒加载路由切换、标签切换、内容增减都会自动生效。
 */
export function installHeaderYield(): () => void {
  let frame = 0

  const apply = (header: HTMLElement) => {
    const bandBottom = header.getBoundingClientRect().bottom
    const yVanish = bandBottom + VANISH_OFFSET_PX
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    // 先读几何、后写样式：读写交替会把一帧变成好几次重排。
    const inOverlay = blocks.map((el) => Boolean(el.closest('[role="dialog"], .fixed, [data-yield-ignore]')))
    const rects = blocks.map((el, i) => (inOverlay[i] ? null : el.getBoundingClientRect()))

    let minTop = Infinity
    for (const r of rects) {
      if (r && r.height > 0 && r.top < minTop) minTop = r.top
    }

    // 页面刚打开停在最顶部且首块完全处于消失线下方时，不预挂蒙版；一旦开始滚动则平滑展开完整过渡带
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const activeScale = minTop < yVanish ? 1 : smoothStep(0, 28, scrollY)
    if (activeScale <= 0) {
      blocks.forEach(clearYield)
      return
    }

    const span = Math.max(1, FADE_SPAN_PX * activeScale)
    const yOpaque = yVanish + span

    blocks.forEach((el, i) => {
      const rect = rects[i]
      if (!rect || rect.height <= 0) {
        clearYield(el)
        return
      }
      // 1) 整块完全位于清晰线下方：移除蒙版，零合成开销
      if (rect.top >= yOpaque) {
        clearYield(el)
        return
      }
      // 2) 整块已滚过完全消失线：直接隐藏并关闭指针命中，杜绝阴影/边框残影与误点
      if (rect.bottom <= yVanish) {
        el.setAttribute(STATE_ATTR, 'hidden')
        el.style.removeProperty(VAR_TOP)
        el.style.removeProperty(VAR_FADE)
        return
      }
      // 3) 跨越 [yVanish, yOpaque] 过渡带：用统一的视口坐标写入完全显现位置与过渡跨度
      el.setAttribute(STATE_ATTR, 'on')
      el.style.setProperty(VAR_TOP, `${Math.round(yOpaque - rect.top)}px`)
      el.style.setProperty(VAR_FADE, `${Math.round(span)}px`)
    })
  }

  const measure = () => {
    frame = 0
    const header = document.querySelector<HTMLElement>('.site-header')
    if (!header) return
    apply(header)
  }

  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(measure)
  }

  measure()
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  window.addEventListener(YIELD_REFRESH_EVENT, schedule)

  // 监听子节点增删：懒加载页面挂载、管理页切标签、筛选结果变化时自动在下一帧重算。
  // apply() 只改属性与行内 CSS 变量、不增删节点，因此不会触发自循环。
  let domObserver: MutationObserver | null = null
  if (typeof MutationObserver !== 'undefined' && document.body) {
    domObserver = new MutationObserver(schedule)
    domObserver.observe(document.body, { childList: true, subtree: true })
  }

  let headerResizeObserver: ResizeObserver | null = null
  const headerEl = document.querySelector<HTMLElement>('.site-header')
  if (typeof ResizeObserver !== 'undefined' && headerEl) {
    headerResizeObserver = new ResizeObserver(schedule)
    headerResizeObserver.observe(headerEl)
  }

  return () => {
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener(YIELD_REFRESH_EVENT, schedule)
    domObserver?.disconnect()
    headerResizeObserver?.disconnect()
    document.querySelectorAll<HTMLElement>(`[${STATE_ATTR}]`).forEach(clearYield)
  }
}
