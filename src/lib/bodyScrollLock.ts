let activeLocks = 0
let originalOverflow = ''

/**
 * 为全屏编辑器与模态框提供可嵌套的 body 滚动锁。
 *
 * 每个调用方都拿到一个独立的释放函数；只有最后一个锁释放时才恢复进入
 * 第一层锁定前的 inline overflow，避免关闭上层搜索框时顺带解除全屏编辑器的锁。
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined

  if (activeLocks === 0) {
    originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  activeLocks += 1

  let released = false
  return () => {
    if (released) return
    released = true
    activeLocks = Math.max(0, activeLocks - 1)
    if (activeLocks === 0) {
      document.body.style.overflow = originalOverflow
      originalOverflow = ''
    }
  }
}
