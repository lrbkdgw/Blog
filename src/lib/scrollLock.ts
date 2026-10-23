/**
 * 页面滚动锁（引用计数）。
 *
 * 为什么不能各管各的：全屏编辑器、站内搜索（⌘K）、LaTeX 符号选择框都是浮层，
 * 打开时都要锁住背景滚动。旧实现各自直接写 `document.body.style.overflow`：
 *
 *   1. 在全屏编辑器里按 ⌘K 打开搜索：搜索关闭时把 `overflow` 置空，
 *      全屏编辑器的锁被一并解除，背景又能滚动；
 *   2. 反过来，两个浮层都关掉后，谁最后关谁把 `overflow` 恢复成 `''`，
 *      原本页面若已经有内联 overflow（例如以后加了别的弹层）也会被抹掉；
 *   3. 隐藏滚动条造成的横向跳变没有补偿。
 *
 * 这里用计数 + 只记录/恢复一次原始值解决：最后一个持有者释放时才真正恢复。
 * 返回值是幂等的 release，重复调用不会把计数减成负数。
 */

let holders = 0
let savedOverflow = ''
let savedPaddingRight = ''

function applyLock(): void {
  const body = document.body
  savedOverflow = body.style.overflow
  savedPaddingRight = body.style.paddingRight
  // 桌面端隐藏纵向滚动条后会少掉一条滚动条的宽度，浮层下面的页面会横向抖一下；
  // 用等价 padding 补回来。移动端 / 没有经典滚动条时为 0，不做任何事。
  const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
  body.style.overflow = 'hidden'
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`
}

function releaseLock(): void {
  const body = document.body
  body.style.overflow = savedOverflow
  body.style.paddingRight = savedPaddingRight
}

/** 锁住背景滚动，返回 release；重复调用 release 是安全的。 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => undefined

  if (holders === 0) applyLock()
  holders += 1

  let released = false
  return () => {
    if (released) return
    released = true
    holders = Math.max(0, holders - 1)
    if (holders === 0) releaseLock()
  }
}

/** 仅用于测试 / 极端场景：当前有多少个浮层持有滚动锁。 */
export function bodyScrollLockCount(): number {
  return holders
}
