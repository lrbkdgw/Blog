/**
 * 正文给吸顶页头让路（issue #71）。
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
 * 只给「与这一栏有交集」的块挂 mask（整页通常 0～3 个），且这些块都是内容容器
 * （Markdown 段落、卡片、列表项），不含 fixed 后代，因此不会踩到 `mask` 会为
 * fixed 后代建立包含块这个坑。
 */

/** 列表类页面在这里标记自己的容器；`.prose > *` 由 Markdown 自动覆盖。 */
export const LIST_SCOPE_ATTR = 'data-yield-list'

const STATE_ATTR = 'data-yield'
const VAR_TOP = '--yield-top'
const VAR_FADE = '--yield-fade'

/**
 * 需要参与让路的「内容块」选择器。
 * `.prose` 容器若本身就是某个 yield-list 的直接子节点（如关于页），
 * 不在列表选择器里重复挂 mask——它自己的子块由 `.prose > *` 逐个处理，
 * 避免父 / 子两层蒙版叠加导致淡出过陡。
 */
const BLOCK_SELECTOR = `.prose > *, [${LIST_SCOPE_ATTR}] > *:not(.prose)`

/** 淡出行程区间：块越薄过渡越短，避免一行标题被抹得太夸张。 */
const FADE_MIN_PX = 24
const FADE_MAX_PX = 64

/** 内容变了（换文章、切路由、Markdown 渲染完）就重算一次；此时不一定伴随滚动事件。 */
export const YIELD_REFRESH_EVENT = 'starlog:content-changed'

/** 供页面在内容就绪后主动请求重算。 */
export function requestHeaderYieldRefresh(): void {
  window.dispatchEvent(new Event(YIELD_REFRESH_EVENT))
}

/**
 * 挂上滚动 / 尺寸监听，返回清理函数。
 * 每次都重新查询容器，所以路由切换、内容增减都不需要额外登记。
 */
export function installHeaderYield(): () => void {
  let frame = 0

  const apply = (header: HTMLElement) => {
    const bandBottom = header.getBoundingClientRect().bottom
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    // 先读几何、后写样式：读写交替会把一帧变成好几次重排。
    const rects = blocks.map((el) => el.getBoundingClientRect())
    blocks.forEach((el, i) => {
      const rect = rects[i]
      if (rect.height <= 0) {
        el.removeAttribute(STATE_ATTR)
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
        el.removeAttribute(STATE_ATTR)
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
  return () => {
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener(YIELD_REFRESH_EVENT, schedule)
  }
}
