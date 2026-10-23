/**
 * 双栏编辑器双向高精度滚动同步引擎（Issue #101）。
 *
 * 设计要点：
 * 1. 精确文本镜像（`rebuildTextareaLineMirror`）：完整复制 `<textarea>` 的计算盒模型、字体、字距、
 *    行高与折行规则，测量每一原始行号在编辑器文档中的精确像素区间 `[taTop, taBottom]`。
 * 2. 全层级可见块区间采样（`collectScrollSyncAnchors`）：
 *    - 递归穿透展开态 `<details open>` 折叠框、`<blockquote>`、`<ul>`/`<ol>`、`.table-tuack-wrapper`
 *      等容器，捕获内部每一个可见标题、段落、列表项、公式块、代码块、表格与交互组件的 `[startLine..endLine]`；
 *    - 对闭合态 `<details>` 折叠框整体视为原子块 `[startLine..endLine] <-> [detailsTop..detailsBottom]`，
 *      跳过其隐藏子节点，彻底消除闭合折叠框造成的数百至数千像素漂移。
 * 3. 连续视口视线（Moving Focal Line）双向保序双射映射（`createBidirectionalScrollMapper`）：
 *    - 在滚动进度 `r ∈ [0, 1]` 处对齐两侧视口同一比例视线 `y = scrollTop + r * clientHeight`，
 *      保留全文所有锚点（绝不因 `taY >= maxTa` 丢弃末尾一屏锚点），并在 256 节点保序样条上求精确逆映射，
 *      保证 `左 -> 右` 与 `右 -> 左` 互为严格逆函数、任意时刻切换滚动方向零跳变且零回声死循环。
 */

export interface ScrollAnchor {
  /** 编辑器文档内距顶部的像素纵坐标（`0 .. taScrollHeight`）。 */
  ta: number
  /** 预览区文档内距顶部的像素纵坐标（`0 .. pvScrollHeight`）。 */
  pv: number
}

export interface ScrollViewportMetrics {
  taScrollHeight: number
  taClientHeight: number
  pvScrollHeight: number
  pvClientHeight: number
}

export interface BidirectionalScrollMapper {
  editorToPreview: (taScrollTop: number) => number
  previewToEditor: (pvScrollTop: number) => number
}

const SPLINE_SEGMENTS = 256

function escapeMirrorHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

/** 将 `<textarea>` 的排版样式精确同步到隐藏测量镜像层，保证自动折行与行高一致。 */
export function copyTextareaMirrorStyles(ta: HTMLTextAreaElement, mirror: HTMLElement): void {
  const width = ta.clientWidth
  mirror.style.width = `${width}px`
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return
  const cs = window.getComputedStyle(ta)
  if (!cs) return
  mirror.style.boxSizing = cs.boxSizing || 'border-box'
  mirror.style.paddingTop = cs.paddingTop
  mirror.style.paddingRight = cs.paddingRight
  mirror.style.paddingBottom = cs.paddingBottom
  mirror.style.paddingLeft = cs.paddingLeft
  mirror.style.borderTopWidth = cs.borderTopWidth
  mirror.style.borderRightWidth = cs.borderRightWidth
  mirror.style.borderBottomWidth = cs.borderBottomWidth
  mirror.style.borderLeftWidth = cs.borderLeftWidth
  mirror.style.borderStyle = 'solid'
  mirror.style.fontFamily = cs.fontFamily
  mirror.style.fontSize = cs.fontSize
  mirror.style.fontWeight = cs.fontWeight
  mirror.style.fontStyle = cs.fontStyle
  mirror.style.fontVariantLigatures = cs.fontVariantLigatures
  mirror.style.lineHeight = cs.lineHeight
  mirror.style.letterSpacing = cs.letterSpacing
  mirror.style.wordSpacing = cs.wordSpacing
  mirror.style.tabSize = cs.tabSize
  mirror.style.textIndent = cs.textIndent
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.wordBreak = cs.wordBreak || 'normal'
}

/** 重建 `<textarea>` 行号测量镜像，返回镜像构建时使用的 `clientWidth`。 */
export function rebuildTextareaLineMirror(
  ta: HTMLTextAreaElement,
  mirror: HTMLElement,
): number {
  copyTextareaMirrorStyles(ta, mirror)
  mirror.innerHTML = ta.value
    .split('\n')
    .map(
      (line, i) =>
        `<div data-l="${i + 1}">${line ? escapeMirrorHtml(line) : '&#8203;'}</div>`,
    )
    .join('')
  return ta.clientWidth
}

/** 判断元素是否位于未展开的 `<details>` 折叠框内部（处于隐藏态）。 */
export function isHiddenInsideClosedDetails(el: HTMLElement, stopAt: HTMLElement): boolean {
  let parent = el.parentElement
  while (parent && parent !== stopAt) {
    if (parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open) {
      return true
    }
    parent = parent.parentElement
  }
  return false
}

/**
 * 收集左侧编辑器（镜像层）与右侧预览区之间严格单调递增的文档坐标锚点表 `[(0, 0), ..., (S_E, S_P)]`。
 */
export function collectScrollSyncAnchors(
  ta: HTMLTextAreaElement,
  mirror: HTMLElement,
  pv: HTMLElement,
): ScrollAnchor[] {
  const taTotal = Math.max(ta.scrollHeight, mirror.scrollHeight, ta.clientHeight, 1)
  const pvTotal = Math.max(pv.scrollHeight, pv.clientHeight, 1)

  const lineElements = new Map<number, HTMLElement>()
  for (let i = 0; i < mirror.children.length; i++) {
    const child = mirror.children[i] as HTMLElement
    const lineNum = Number(child.dataset?.l)
    if (Number.isInteger(lineNum) && lineNum >= 1) {
      lineElements.set(lineNum, child)
    }
  }
  const maxLine = lineElements.size
  if (maxLine === 0) {
    return [
      { ta: 0, pv: 0 },
      { ta: taTotal, pv: pvTotal },
    ]
  }

  const getLineTop = (line: number): number | null => {
    const clamped = clamp(line, 1, maxLine)
    const el = lineElements.get(clamped)
    return el ? el.offsetTop : null
  }

  const getLineBottom = (line: number): number | null => {
    const clamped = clamp(line, 1, maxLine)
    const el = lineElements.get(clamped)
    return el ? el.offsetTop + el.offsetHeight : null
  }

  const pvOriginTop = pv.getBoundingClientRect().top
  const pvScrollTop = pv.scrollTop

  interface CandidateBlock {
    el: HTMLElement
    start: number
    end: number
    isClosedDetails: boolean
  }

  const candidates: CandidateBlock[] = []
  const markedList = pv.querySelectorAll<HTMLElement>('[data-source-line]')
  for (const el of markedList) {
    // 跳过行内 <span>（如代码语法高亮 token、行内公式容器），仅以真实块级排版盒对齐行号。
    if (el.tagName === 'SPAN') continue
    if (isHiddenInsideClosedDetails(el, pv)) continue
    const start = Number(el.dataset.sourceLine)
    if (!Number.isInteger(start) || start < 1) continue
    const rawEnd = Number(el.dataset.sourceLineEnd)
    const end = Number.isInteger(rawEnd) && rawEnd >= start ? rawEnd : start
    const isClosedDetails = el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open
    candidates.push({ el, start, end, isClosedDetails })
  }

  // O(N) 构建每个候选元素的最小可见子块起始行（若无可见子块则为 undefined -> 叶级块）。
  const minVisibleChildStart = new Map<HTMLElement, number>()
  const visibleSet = new Set<HTMLElement>(candidates.map((c) => c.el))
  for (const item of candidates) {
    let ancestor = item.el.parentElement
    while (ancestor && ancestor !== pv) {
      if (visibleSet.has(ancestor)) {
        const prevMin = minVisibleChildStart.get(ancestor)
        if (prevMin === undefined || item.start < prevMin) {
          minVisibleChildStart.set(ancestor, item.start)
        }
      }
      ancestor = ancestor.parentElement
    }
  }

  const anchors: ScrollAnchor[] = [{ ta: 0, pv: 0 }]

  const pushAnchor = (rawTa: number, rawPv: number) => {
    const taY = clamp(rawTa, 0, taTotal)
    const pvY = clamp(rawPv, 0, pvTotal)
    const prev = anchors[anchors.length - 1]
    if (taY <= prev.ta + 0.05 || pvY <= prev.pv + 0.05) return
    anchors.push({ ta: taY, pv: pvY })
  }

  for (const item of candidates) {
    const { el, start, end, isClosedDetails } = item
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0 && rect.width <= 0) continue
    const pvTop = rect.top - pvOriginTop + pvScrollTop
    const pvBottom = pvTop + rect.height

    if (isClosedDetails) {
      // 闭合折叠框：整个 [start..end] 区间精确压缩到折叠标题栏高度 [pvTop..pvBottom]
      const taTop = getLineTop(start)
      const taBottom = getLineBottom(end)
      if (taTop !== null) pushAnchor(taTop, pvTop)
      if (taBottom !== null) pushAnchor(taBottom, pvBottom)
      continue
    }

    const firstChildLine = minVisibleChildStart.get(el)
    if (firstChildLine === undefined) {
      // 叶级可见块：同时对齐块顶部（起始行顶边）与块底部（结束行底边）
      const taTop = getLineTop(start)
      const taBottom = getLineBottom(end)
      if (taTop !== null) pushAnchor(taTop, pvTop)
      if (taBottom !== null) pushAnchor(taBottom, pvBottom)
    } else if (start < firstChildLine) {
      // 容器自身带有先于首个子块的头部行（如带嵌套子列表的父级 li）：补齐头部起始锚点
      const taTop = getLineTop(start)
      if (taTop !== null) pushAnchor(taTop, pvTop)
    }
  }

  // 严格闭合文档终点 (taTotal, pvTotal)
  while (
    anchors.length > 1 &&
    (anchors[anchors.length - 1].ta >= taTotal - 0.05 ||
      anchors[anchors.length - 1].pv >= pvTotal - 0.05)
  ) {
    anchors.pop()
  }
  anchors.push({ ta: taTotal, pv: pvTotal })

  return anchors
}

/** 在严格递增节点表 `(xs, ys)` 上进行分段线性插值。 */
export function interpolateMonotonic(xs: number[], ys: number[], x: number): number {
  const n = xs.length
  if (n === 0) return 0
  if (n === 1 || x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]

  let lo = 0
  let hi = n - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const span = xs[hi] - xs[lo]
  if (span <= 1e-9) return ys[lo]
  return ys[lo] + ((x - xs[lo]) / span) * (ys[hi] - ys[lo])
}

/**
 * 基于全文锚点表与两侧视口尺寸构建双向严格互逆的滚动同步映射器。
 */
export function createBidirectionalScrollMapper(
  anchors: ScrollAnchor[],
  metrics: ScrollViewportMetrics,
): BidirectionalScrollMapper {
  const taTotal = Math.max(metrics.taScrollHeight, metrics.taClientHeight, 1)
  const pvTotal = Math.max(metrics.pvScrollHeight, metrics.pvClientHeight, 1)
  const maxTa = Math.max(0, taTotal - metrics.taClientHeight)
  const maxPv = Math.max(0, pvTotal - metrics.pvClientHeight)

  if (maxTa <= 0.5 || maxPv <= 0.5) {
    return {
      editorToPreview: (taScrollTop: number) =>
        maxPv <= 0.5
          ? 0
          : maxTa <= 0.5
            ? 0
            : clamp((taScrollTop / maxTa) * maxPv, 0, maxPv),
      previewToEditor: (pvScrollTop: number) =>
        maxTa <= 0.5
          ? 0
          : maxPv <= 0.5
            ? 0
            : clamp((pvScrollTop / maxPv) * maxTa, 0, maxTa),
    }
  }

  const anchorTa: number[] = []
  const anchorPv: number[] = []
  for (const a of anchors) {
    if (
      anchorTa.length === 0 ||
      (a.ta > anchorTa[anchorTa.length - 1] && a.pv > anchorPv[anchorPv.length - 1])
    ) {
      anchorTa.push(a.ta)
      anchorPv.push(a.pv)
    }
  }
  if (anchorTa.length < 2) {
    anchorTa.length = 0
    anchorPv.length = 0
    anchorTa.push(0, taTotal)
    anchorPv.push(0, pvTotal)
  }

  // 在 K+1 个节点上构建双向严格互逆映射曲线：
  // - 正文主体（0 <= s_E <= s_0, s_0 = max(0, maxTa - taClientHeight)）：alpha = 0，
  //   两侧视口顶边严格对齐同一源码行（s_P = F(s_E)，闭合折叠框、坐标系、公式块零偏移）；
  // - 末尾收尾区（s_0 < s_E <= maxTa）：alpha 从 0 线性过渡至 1，焦点扫过末尾一屏全部锚点并平滑落至 maxPv；
  // - 当整篇编辑区可滚高度不超过一屏（maxTa <= taClientHeight）时自动退化为全篇连续视线对齐。
  const tailStart = Math.max(0, maxTa - metrics.taClientHeight)
  const tailSpan = maxTa - tailStart

  const n = SPLINE_SEGMENTS + 1
  const rawPv = new Array<number>(n)
  rawPv[0] = 0
  rawPv[n - 1] = maxPv
  for (let k = 1; k < n - 1; k++) {
    const sTa = (k / SPLINE_SEGMENTS) * maxTa
    const alpha = tailSpan > 0.5 && sTa > tailStart ? (sTa - tailStart) / tailSpan : 0
    const focalTa = sTa + alpha * metrics.taClientHeight
    const focalPv = interpolateMonotonic(anchorTa, anchorPv, focalTa)
    rawPv[k] = clamp(focalPv - alpha * metrics.pvClientHeight, 0, maxPv)
  }

  // 对称保序包络：当 rawPv 本身单调时 0.5*(fwd + bwd) === rawPv 零失真；
  // 当超长闭合折叠框出现局部微回折时平滑保持单调且不引入单侧偏移。
  const fwd = new Array<number>(n)
  const bwd = new Array<number>(n)
  fwd[0] = 0
  for (let k = 1; k < n; k++) fwd[k] = Math.max(fwd[k - 1], rawPv[k])
  bwd[n - 1] = maxPv
  for (let k = n - 2; k >= 0; k--) bwd[k] = Math.min(bwd[k + 1], rawPv[k])

  const taKnots = new Array<number>(n)
  const pvKnots = new Array<number>(n)
  taKnots[0] = 0
  pvKnots[0] = 0
  for (let k = 1; k < n - 1; k++) {
    taKnots[k] = (k / SPLINE_SEGMENTS) * maxTa
    pvKnots[k] = 0.5 * (fwd[k] + bwd[k])
  }
  taKnots[n - 1] = maxTa
  pvKnots[n - 1] = maxPv

  // 注入极微小严格递增正则项（总幅值 1e-4 px），使正逆插值在水平平台段亦 100% 唯一可逆。
  const epsStep = Math.min(1e-4, maxPv * 1e-6) / SPLINE_SEGMENTS
  for (let k = 1; k < n - 1; k++) {
    const minAllowed = pvKnots[k - 1] + epsStep
    const maxAllowed = maxPv - (n - 1 - k) * epsStep
    pvKnots[k] = clamp(Math.max(pvKnots[k], minAllowed), minAllowed, maxAllowed)
  }

  return {
    editorToPreview: (taScrollTop: number) =>
      interpolateMonotonic(taKnots, pvKnots, clamp(taScrollTop, 0, maxTa)),
    previewToEditor: (pvScrollTop: number) =>
      interpolateMonotonic(pvKnots, taKnots, clamp(pvScrollTop, 0, maxPv)),
  }
}
