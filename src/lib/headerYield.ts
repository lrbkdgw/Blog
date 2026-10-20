/**
 * 全站内容给吸顶页头让路（issue #71 / #78）。
 *
 * 两条要求本身是冲突的：
 * - 页头必须**完全透明**（issue #53 / #63：顶部不许出现一条与页面脱节的实色横带，
 *   也不许用毛玻璃把背后的主题渐变与动态背景糊掉）；
 * - 但页面内容滚到导航那一栏下面时，字与导航文字叠在一起很难读。
 *
 * 在页头那一层做文章解决不了：页头底下同时压着「背景」和「正文」，任何底色 /
 * 蒙版 / backdrop-filter 都会连背景一起改掉。所以只能**只改内容块本身**——给滚进
 * 这一栏的内容块挂一条随滚动位置计算的 `mask-image`，让内容在进入页头之前渐变
 * 透明掉；背景在另外的图层，一像素都不动。
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

/** 淡出行程区间：块越薄过渡越短，避免一行标题被抹得太夸张。 */
const FADE_MIN_PX = 24
const FADE_MAX_PX = 64

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

/**
 * 挂上滚动 / 尺寸 / DOM 变更监听，返回清理函数。
 * 每次都重新查询容器，所以懒加载路由切换、标签切换、内容增减都会自动生效。
 */
export function installHeaderYield(): () => void {
  let frame = 0

  const apply = (header: HTMLElement) => {
    const bandBottom = header.getBoundingClientRect().bottom
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    // 先读几何、后写样式：读写交替会把一帧变成好几次重排。
    const inOverlay = blocks.map((el) => Boolean(el.closest('[role="dialog"], .fixed, [data-yield-ignore]')))
    const rects = blocks.map((el, i) => (inOverlay[i] ? null : el.getBoundingClientRect()))
    blocks.forEach((el, i) => {
      const rect = rects[i]
      if (!rect || rect.height <= 0) {
        clearYield(el)
        return
      }
      // 页头下沿相对这个块顶部的距离：> 块高说明整块都还在栏内，< 行程起点说明还没进栏。
      const top = bandBottom - rect.top
      const fade = Math.max(FADE_MIN_PX, Math.min(FADE_MAX_PX, rect.height * 0.6))
      if (top >= rect.height) {
        // 整块都压在页头那一栏里：完全淡掉（父块已经淡掉时子块跟着被父块的蒙版处理，
        // 这里重复写一次也无妨，梯度是同一个基准）。
        el.setAttribute(STATE_ATTR, 'on')
        el.style.setProperty(VAR_TOP, `${Math.round(rect.height + fade)}px`)
        el.style.setProperty(VAR_FADE, `${Math.round(fade)}px`)
        return
      }
      if (top - fade <= 0) {
        clearYield(el)
        return
      }
      el.setAttribute(STATE_ATTR, 'on')
      el.style.setProperty(VAR_TOP, `${Math.round(top)}px`)
      el.style.setProperty(VAR_FADE, `${Math.round(fade)}px`)
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
