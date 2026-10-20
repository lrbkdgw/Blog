/**
 * 正文给吸顶页头让路（issue #71；issue #78 扩展到全部页面）。
 *
 * 两条要求本身是冲突的：
 * - 页头必须**完全透明**（issue #53 / #63：顶部不许出现一条与页面脱节的实色横带，
 *   也不许用毛玻璃把背后的主题渐变与动态背景糊掉）；
 * - 但正文滚到导航那一栏下面时，字与导航文字叠在一起很难读。
 *
 * 在页头那一层做文章解决不了：页头底下同时压着「背景」和「正文」，任何底色 /
 * 蒙版 / backdrop-filter 都会连背景一起改掉。所以只能**只改正文本身**——给滚进
 * 这一栏的内容块挂一条随滚动位置计算的 `mask-image`，让文字在进入页头之前渐变
 * 透明掉；背景在另外的图层，一像素都不动。
 *
 * 覆盖范围：
 * - Markdown 正文（`.prose > *`，文章 / 帮助 / 评论自动覆盖）；
 * - 各页面以 `data-yield-list` 标出的页级与列表级容器（其直接子块参与让路）；
 * - 个别无法靠父容器表达的块可用 `data-yield-block` 单独标出。
 *
 * `data-yield-ignore` 子树永不参与：全屏编辑器、正在输入的编辑工作区、弹窗等
 * 覆盖页头的界面不该被页头几何影响。嵌套命中时只让最外层块挂蒙版——同一个
 * 渐变基准叠两层没有视觉收益，只白白多写样式；外层足够覆盖内部内容。
 */

/** 页级 / 列表级容器标记：其直接子元素是参与让路的内容块。 */
export const LIST_SCOPE_ATTR = 'data-yield-list'
/** 单块标记：元素自身参与让路。 */
export const BLOCK_SCOPE_ATTR = 'data-yield-block'
/** 排除标记：该元素及其后代永不参与让路。 */
export const IGNORE_SCOPE_ATTR = 'data-yield-ignore'

const STATE_ATTR = 'data-yield'
const VAR_TOP = '--yield-top'
const VAR_FADE = '--yield-fade'

/** 需要参与让路的「内容块」选择器。 */
const BLOCK_SELECTOR = `.prose > *, [${LIST_SCOPE_ATTR}] > *, [${BLOCK_SCOPE_ATTR}]`

/** 淡出行程区间：块越薄过渡越短，避免一行标题被抹得太夸张。 */
const FADE_MIN_PX = 24
const FADE_MAX_PX = 64

/** 内容变了（换文章、切路由、Markdown 渲染完）就重算一次；此时不一定伴随滚动事件。 */
export const YIELD_REFRESH_EVENT = 'starlog:content-changed'

/** 供页面在内容就绪后主动请求重算。 */
export function requestHeaderYieldRefresh(): void {
  window.dispatchEvent(new Event(YIELD_REFRESH_EVENT))
}

function clearYield(el: HTMLElement): void {
  if (el.hasAttribute(STATE_ATTR)) el.removeAttribute(STATE_ATTR)
  if (el.style.getPropertyValue(VAR_TOP)) el.style.removeProperty(VAR_TOP)
  if (el.style.getPropertyValue(VAR_FADE)) el.style.removeProperty(VAR_FADE)
}

function setYield(el: HTMLElement, topPx: number, fadePx: number): void {
  const top = `${Math.round(topPx)}px`
  const fade = `${Math.round(fadePx)}px`
  if (el.getAttribute(STATE_ATTR) !== 'on') el.setAttribute(STATE_ATTR, 'on')
  if (el.style.getPropertyValue(VAR_TOP) !== top) el.style.setProperty(VAR_TOP, top)
  if (el.style.getPropertyValue(VAR_FADE) !== fade) el.style.setProperty(VAR_FADE, fade)
}

/**
 * 选出本次需要测量的最外层内容块。
 *
 * `data-yield-ignore` 子树整体跳过；若一个块的祖先也命中了选择器，只保留祖先。
 * querySelectorAll 按文档序返回，祖先必先于后代，所以一次前向扫描即可。
 */
function collectYieldBlocks(): HTMLElement[] {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
  const roots: HTMLElement[] = []
  const rootSet = new Set<HTMLElement>()
  for (const el of candidates) {
    if (el.closest(`[${IGNORE_SCOPE_ATTR}]`)) continue
    // 一个容器既是外层列表的子块、又自己标了 data-yield-list 时，只把它当范围用：
    // 让它自己的子块逐个让路，避免整段（例如评论区连同其中的固定弹窗宿主）被单块蒙版包住。
    if (el.hasAttribute(LIST_SCOPE_ATTR) && !el.hasAttribute(BLOCK_SCOPE_ATTR)) continue
    // 沿祖先链找已收录的最外层块（文档序保证祖先先被处理），比逐个 contains 便宜得多。
    let ancestor = el.parentElement
    while (ancestor && !rootSet.has(ancestor)) ancestor = ancestor.parentElement
    if (ancestor) continue
    roots.push(el)
    rootSet.add(el)
  }
  return roots
}

/**
 * 挂上滚动 / 尺寸 / DOM 变化监听，返回清理函数。
 * 每次都重新查询容器，所以路由切换、异步内容与增删都不需要额外登记。
 */
export function installHeaderYield(): () => void {
  let frame = 0

  const apply = (header: HTMLElement) => {
    const bandBottom = header.getBoundingClientRect().bottom
    const active = new Set<HTMLElement>()

    if (bandBottom > 0) {
      const blocks = collectYieldBlocks()
      // 先读几何、后写样式：读写交替会把一帧变成好几次重排。
      const rects = blocks.map((el) => el.getBoundingClientRect())
      blocks.forEach((el, i) => {
        const rect = rects[i]
        // 零高、完全滚出视口的块不可能与页头发生视觉冲突，不必保留蒙版。
        if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return

        // 页头下沿相对这个块顶部的距离：> 块高说明整块都在栏内，< 行程起点说明还没进栏。
        const top = bandBottom - rect.top
        const fade = Math.max(FADE_MIN_PX, Math.min(FADE_MAX_PX, rect.height * 0.6))
        if (top - fade <= 0) return

        active.add(el)
        if (top >= rect.height) {
          // 整块都压在页头那一栏里：完全淡掉。
          setYield(el, rect.height + fade, fade)
        } else {
          setYield(el, top, fade)
        }
      })
    }

    // 上一帧挂过、这一帧已离开页头带（或刚被 data-yield-ignore 接管）的块统一清掉，
    // 避免全屏切换、条件渲染后留下残蒙版。
    document.querySelectorAll<HTMLElement>(`[${STATE_ATTR}]`).forEach((el) => {
      if (!active.has(el)) clearYield(el)
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
  // capture 让嵌套滚动容器（侧栏、面板内滚动）里移动的内容块也能及时重算。
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  window.addEventListener('resize', schedule)
  window.addEventListener(YIELD_REFRESH_EVENT, schedule)
  window.addEventListener('load', schedule)

  // 路由懒加载、图片解码、列表增删与移动导航展开都会改变块或页头几何：
  // 只观察 childList（本模块写的是属性/样式，不会触发自激循环），再由 ResizeObserver
  // 兜底字体与图片撑开的高度变化。两者都只负责把重算合进下一帧。
  const mutationObserver =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  const observedRoots = [document.querySelector('main'), document.querySelector('.site-header')].filter(
    (el): el is Element => Boolean(el),
  )
  for (const root of observedRoots.length > 0 ? observedRoots : document.body ? [document.body] : []) {
    mutationObserver?.observe(root, { childList: true, subtree: true })
    resizeObserver?.observe(root)
  }

  return () => {
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule, { capture: true })
    window.removeEventListener('resize', schedule)
    window.removeEventListener(YIELD_REFRESH_EVENT, schedule)
    window.removeEventListener('load', schedule)
    mutationObserver?.disconnect()
    resizeObserver?.disconnect()
  }
}
