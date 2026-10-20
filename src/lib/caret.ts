/**
 * 受控 textarea 的光标恢复（issue #70）。
 *
 * 背景：React 把新的 `value` 写回受控 `<textarea>` 时，浏览器按规范会把光标放到
 * **文本末尾**（只有元素处于聚焦态时 React 才会代为保存/恢复选区）。所以工具栏按钮、
 * LaTeX 符号选择框这类「先让焦点在别处、再改 value」的交互里，如果按惯性写法
 * `ta.focus(); ta.setSelectionRange(a, b)`，`focus()` 会先为了「把光标滚进视野」
 * 把整页拽到文章末尾——正是 issue #70 报的「使用搜索 LaTeX 功能后异常跳转到文章末尾」。
 *
 * 因此顺序必须是：先 setSelectionRange 把光标放回插入点，再以 `preventScroll` 拿回焦点；
 * 最后把这一瞬间被顺带改掉的窗口滚动位置还原（`setSelectionRange` 也会「揭示」光标，
 * 在某些浏览器里会连带滚动祖先滚动容器，包括窗口）。
 */

/** 聚焦但不滚动：`preventScroll` 是老浏览器可能不认识的对象参数，用 try 兜一层。 */
export function focusWithoutScroll(el: HTMLElement | null | undefined): void {
  if (!el) return
  try {
    el.focus({ preventScroll: true })
  } catch {
    el.focus()
  }
}

/**
 * 把光标放到 `start`/`end`，抢回焦点，并且保证页面不跟着滚。
 * 供「程序化改完 textarea 内容」之后立即恢复光标的场景使用。
 */
export function restoreCaret(
  ta: HTMLTextAreaElement | null | undefined,
  start: number,
  end: number = start,
): void {
  if (!ta) return
  const left = window.scrollX
  const top = window.scrollY
  const max = ta.value.length
  const from = Math.max(0, Math.min(start, max))
  const to = Math.max(from, Math.min(end, max))
  ta.setSelectionRange(from, to)
  focusWithoutScroll(ta)
  // 上面两步中任何一步把页面滚走（例如光标落在很长文本的末尾、而 textarea 本身
  // 不是唯一的滚动容器）都在此还原；textarea 内部滚动保留，光标仍是可见的。
  if (window.scrollX !== left || window.scrollY !== top) {
    window.scrollTo({ top, left, behavior: 'instant' as ScrollBehavior })
  }
}
