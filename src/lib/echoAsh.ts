/**
 * 回声洞「化灰随风消散」粒子引擎（Canvas 2D · Retina 自适应 · 20 级预编译色板零 GC 批渲染）
 *
 * 视觉与物理流程：
 * 1. 直接采样屏幕上当前已显现字符（含出处）的真实排版像素与墨色，在完全重合的屏幕坐标生成数千枚细碎尘埃粒子；
 *    若运行于开启画布指纹防护（getImageData 受限）或无布局尺寸的测试环境，自动回退为按字符包围盒均匀散布的细灰点阵。
 * 2. 带有二维多频有机噪声的微风剥蚀波前从左下向右上扫过整句：波前到达前粒子静止保持原笔画形态（首帧零跳变），
 *    波前扫过瞬间笔画层层钙化剥落为灰白/银灰细尘，沿无散度（divergence-free）旋流风场向右上轻盈卷起、变淡直至消散。
 */

export const ASH_EXIT_STAGE_MS = 560

const PALETTE_STEPS = 20
const MAX_PARTICLES_PER_BURST = 4600
const SWEEP_MS = 270
const LIFE_MIN_MS = 380
const LIFE_MAX_MS = 560

interface RgbColor {
  r: number
  g: number
  b: number
}

export interface AshParticleBurst {
  palette: string[]
  count: number
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  size: Float32Array
  delayMs: Float32Array
  lifeMs: Float32Array
  phase: Float32Array
  baseAlpha: Float32Array
  elapsedMs: number
  speedScale: number
  seed: number
}

export interface EchoAshController {
  disintegrateFromElement: (containerEl: HTMLElement | null) => number
  accelerate: () => void
  hasActiveParticles: () => boolean
  activeParticleCount: () => number
  stepFrame: (dtMs: number) => void
  destroy: () => void
}

function parseCssColor(cssColor: string | null | undefined): RgbColor {
  if (!cssColor) return { r: 36, g: 42, b: 54 }
  const match = cssColor.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (!match) return { r: 36, g: 42, b: 54 }
  return {
    r: Math.max(0, Math.min(255, Math.round(Number(match[1])))),
    g: Math.max(0, Math.min(255, Math.round(Number(match[2])))),
    b: Math.max(0, Math.min(255, Math.round(Number(match[3])))),
  }
}

/**
 * 预生成 20 级从「原墨色」渐变至「钙化骨灰/银尘色」并平滑衰减透明度的色板，渲染期零字符串分配
 */
export function buildAshPalette(ink: RgbColor): string[] {
  const lum = (0.299 * ink.r + 0.587 * ink.g + 0.114 * ink.b) / 255
  const midAsh: RgbColor =
    lum < 0.5 ? { r: 96, g: 102, b: 114 } : { r: 204, g: 212, b: 224 }
  const tailAsh: RgbColor =
    lum < 0.5 ? { r: 158, g: 164, b: 176 } : { r: 146, g: 156, b: 174 }

  const palette: string[] = []
  for (let i = 0; i < PALETTE_STEPS; i++) {
    const u = i / (PALETTE_STEPS - 1)
    let r: number
    let g: number
    let b: number
    if (u < 0.42) {
      const k = u / 0.42
      r = Math.round(ink.r + (midAsh.r - ink.r) * k)
      g = Math.round(ink.g + (midAsh.g - ink.g) * k)
      b = Math.round(ink.b + (midAsh.b - ink.b) * k)
    } else {
      const k = (u - 0.42) / 0.58
      r = Math.round(midAsh.r + (tailAsh.r - midAsh.r) * k)
      g = Math.round(midAsh.g + (tailAsh.g - midAsh.g) * k)
      b = Math.round(midAsh.b + (tailAsh.b - midAsh.b) * k)
    }
    const alpha = Math.max(0.015, Math.pow(1 - u, 1.5) * 0.96)
    palette.push(`rgba(${r},${g},${b},${alpha.toFixed(3)})`)
  }
  return palette
}

interface GlyphTarget {
  text: string
  left: number
  top: number
  width: number
  height: number
  font: string
  opacity: number
}

interface RawSamplePoint {
  x: number
  y: number
  alpha: number
}

function readComputedStyle(el: Element): CSSStyleDeclaration | null {
  const view = el.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined)
  return view ? view.getComputedStyle(el) : null
}

function collectVisibleGlyphTargets(containerEl: HTMLElement): {
  ink: RgbColor
  bounds: { left: number; top: number; width: number; height: number }
  targets: GlyphTarget[]
} {
  const viewW = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280
  const viewH = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 720

  const charSpans = Array.from(containerEl.querySelectorAll<HTMLElement>('.echo-char'))
  const fromEl = containerEl.querySelector<HTMLElement>('.echo-from')

  let primaryInk: RgbColor | null = null
  const targets: GlyphTarget[] = []

  charSpans.forEach((span, idx) => {
    const ch = span.textContent ?? ''
    if (!ch.trim()) return
    const style = readComputedStyle(span)
    const computedOpacity = Number.parseFloat(style?.opacity || '0')
    const dataShown = span.getAttribute('data-char-shown') === 'true'
    const effectiveOpacity =
      Number.isFinite(computedOpacity) && computedOpacity > 0
        ? computedOpacity
        : dataShown
          ? 1
          : 0
    if (effectiveOpacity <= 0.04) return

    if (!primaryInk) {
      primaryInk = parseCssColor(style?.color)
    }

    const rect = span.getBoundingClientRect()
    const fontSizePx = Number.parseFloat(style?.fontSize || '22') || 22
    const hasRealRect = rect.width > 0.5 && rect.height > 0.5

    const width = hasRealRect ? rect.width : fontSizePx
    const height = hasRealRect ? rect.height : fontSizePx * 1.25
    const totalCols = Math.max(1, Math.min(24, charSpans.length))
    const col = idx % totalCols
    const row = Math.floor(idx / totalCols)
    const fallbackLeft = viewW / 2 - (totalCols * width) / 2 + col * width
    const fallbackTop = viewH / 2 - height + row * (height * 1.5)

    targets.push({
      text: ch,
      left: hasRealRect ? rect.left : fallbackLeft,
      top: hasRealRect ? rect.top : fallbackTop,
      width,
      height,
      font: `${style?.fontStyle || 'normal'} ${style?.fontWeight || '400'} ${fontSizePx}px ${
        style?.fontFamily || 'serif'
      }`,
      opacity: Math.max(0.18, Math.min(1, effectiveOpacity || 1)),
    })
  })

  if (fromEl && (fromEl.textContent ?? '').trim()) {
    const fromStyle = readComputedStyle(fromEl)
    const fromOpacity = Number.parseFloat(fromStyle?.opacity || '0')
    const fromShown = fromEl.getAttribute('data-from-shown') === 'true'
    const effectiveFromOpacity =
      Number.isFinite(fromOpacity) && fromOpacity > 0 ? fromOpacity : fromShown ? 0.78 : 0
    if (effectiveFromOpacity > 0.06) {
      const rect = fromEl.getBoundingClientRect()
      const fontSizePx = Number.parseFloat(fromStyle?.fontSize || '12') || 12
      const text = fromEl.textContent ?? ''
      const hasRealRect = rect.width > 0.5 && rect.height > 0.5
      const width = hasRealRect ? rect.width : text.length * fontSizePx * 0.75
      const height = hasRealRect ? rect.height : fontSizePx * 1.3
      targets.push({
        text,
        left: hasRealRect ? rect.left : (viewW - width) / 2,
        top: hasRealRect ? rect.top : viewH / 2 + 34,
        width,
        height,
        font: `${fromStyle?.fontStyle || 'normal'} ${fromStyle?.fontWeight || '400'} ${fontSizePx}px ${
          fromStyle?.fontFamily || 'sans-serif'
        }`,
        opacity: Math.max(0.15, Math.min(0.85, effectiveFromOpacity)),
      })
    }
  }

  if (!primaryInk) {
    const p = containerEl.querySelector('p')
    primaryInk = parseCssColor(p ? readComputedStyle(p)?.color : null)
  }

  if (targets.length === 0) {
    return {
      ink: primaryInk,
      bounds: { left: viewW / 2 - 120, top: viewH / 2 - 24, width: 240, height: 48 },
      targets: [],
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const t of targets) {
    minX = Math.min(minX, t.left)
    minY = Math.min(minY, t.top)
    maxX = Math.max(maxX, t.left + t.width)
    maxY = Math.max(maxY, t.top + t.height)
  }

  const pad = 12
  return {
    ink: primaryInk,
    bounds: {
      left: minX - pad,
      top: minY - pad,
      width: Math.max(24, maxX - minX + pad * 2),
      height: Math.max(24, maxY - minY + pad * 2),
    },
    targets,
  }
}

export function createAshBurstFromElement(containerEl: HTMLElement): AshParticleBurst | null {
  const { ink, bounds, targets } = collectVisibleGlyphTargets(containerEl)
  if (targets.length === 0) return null

  const rawPoints: RawSamplePoint[] = []

  // 优先采样离屏画布上的真实字形笔画像素，精确还原每一笔撇捺与标点
  if (typeof document !== 'undefined') {
    try {
      const sampleScale =
        typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1
      const bw = Math.min(2400, Math.max(16, Math.ceil(bounds.width * sampleScale)))
      const bh = Math.min(1200, Math.max(16, Math.ceil(bounds.height * sampleScale)))
      const offscreen = document.createElement('canvas')
      offscreen.width = bw
      offscreen.height = bh
      const octx = offscreen.getContext('2d')

      if (octx && typeof octx.fillText === 'function' && typeof octx.getImageData === 'function') {
        octx.scale(sampleScale, sampleScale)
        octx.textAlign = 'left'
        octx.textBaseline = 'alphabetic'
        octx.fillStyle = '#000000'

        for (const t of targets) {
          octx.font = t.font
          octx.globalAlpha = t.opacity
          let baselineOffset = t.height * 0.8
          if (typeof octx.measureText === 'function') {
            const metrics = octx.measureText(t.text)
            const asc = metrics?.fontBoundingBoxAscent ?? metrics?.actualBoundingBoxAscent
            const desc = metrics?.fontBoundingBoxDescent ?? metrics?.actualBoundingBoxDescent
            if (typeof asc === 'number' && typeof desc === 'number' && asc + desc > 0) {
              baselineOffset = (t.height + asc - desc) / 2
            }
          }
          octx.fillText(t.text, t.left - bounds.left, t.top - bounds.top + baselineOffset)
        }

        const img = octx.getImageData(0, 0, bw, bh)
        const data = img.data
        // 先统计墨迹像素总数，自适应计算采样步幅，保证既细腻又稳定控制在 MAX_PARTICLES_PER_BURST 以内
        let opaqueTotal = 0
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 28) opaqueTotal += 1
        }

        if (opaqueTotal > 0) {
          const stride = Math.max(1, Math.sqrt(opaqueTotal / MAX_PARTICLES_PER_BURST))
          const stepInt = Math.max(1, Math.round(stride))
          const invScale = 1 / sampleScale
          for (let py = 0; py < bh; py += stepInt) {
            const rowOffset = py * bw
            for (let px = 0; px < bw; px += stepInt) {
              const a = data[(rowOffset + px) * 4 + 3]
              if (a > 28) {
                rawPoints.push({
                  x: bounds.left + (px + (Math.random() - 0.5) * 0.45) * invScale,
                  y: bounds.top + (py + (Math.random() - 0.5) * 0.45) * invScale,
                  alpha: a / 255,
                })
              }
            }
          }
        }
      }
    } catch {
      /* 画布指纹保护或受限环境自动走下方字符点阵合成兜底 */
    }
  }

  // 兜底路径：若离屏像素读回为 0（如浏览器隐私防指纹模式或无光栅 JSDOM），按每个可见字符包围盒生成细腻尘埃簇
  if (rawPoints.length === 0) {
    const perTarget = Math.max(18, Math.min(90, Math.floor(2400 / targets.length)))
    for (const t of targets) {
      for (let k = 0; k < perTarget; k++) {
        // 聚拢于字形中心笔画区域而非均匀铺满外框，视觉更接近真实字迹化灰
        const rx = 0.14 + 0.72 * ((Math.random() + Math.random()) * 0.5)
        const ry = 0.16 + 0.68 * ((Math.random() + Math.random()) * 0.5)
        rawPoints.push({
          x: t.left + t.width * rx,
          y: t.top + t.height * ry,
          alpha: t.opacity * (0.65 + Math.random() * 0.35),
        })
      }
    }
  }

  // 若超出单次上限则等距抽稀，确保高帧率
  let selected = rawPoints
  if (rawPoints.length > MAX_PARTICLES_PER_BURST) {
    selected = []
    const ratio = rawPoints.length / MAX_PARTICLES_PER_BURST
    for (let i = 0; i < MAX_PARTICLES_PER_BURST; i++) {
      selected.push(rawPoints[Math.min(rawPoints.length - 1, Math.floor(i * ratio))])
    }
  }

  const count = selected.length
  const x = new Float32Array(count)
  const y = new Float32Array(count)
  const vx = new Float32Array(count)
  const vy = new Float32Array(count)
  const size = new Float32Array(count)
  const delayMs = new Float32Array(count)
  const lifeMs = new Float32Array(count)
  const phase = new Float32Array(count)
  const baseAlpha = new Float32Array(count)
  const seed = Math.random() * Math.PI * 2

  const spanW = Math.max(1, bounds.width)
  const spanH = Math.max(1, bounds.height)

  for (let i = 0; i < count; i++) {
    const pt = selected[i]
    x[i] = pt.x
    y[i] = pt.y

    const nx = Math.max(0, Math.min(1, (pt.x - bounds.left) / spanW))
    const ny = Math.max(0, Math.min(1, (pt.y - bounds.top) / spanH))

    // 二维有机噪声剥蚀波前：从左下向右上层层化灰剥落，边缘呈自然烟絮状而非生硬直线
    const noise =
      0.16 * Math.sin(pt.x * 0.048 + pt.y * 0.033 + seed) +
      0.1 * Math.cos(pt.x * 0.115 - pt.y * 0.088 + seed * 1.7) +
      (Math.random() - 0.5) * 0.11
    const sweepProgress = Math.max(0, Math.min(1, nx * 0.78 + (1 - ny) * 0.14 + 0.08 + noise))
    delayMs[i] = sweepProgress * SWEEP_MS

    // 脱离笔画瞬间的微风初速度：整体向右上飘散，夹带轻微随机散射如骨灰扬起
    const angle = -0.52 + (Math.random() - 0.5) * 1.15
    const speed = 18 + Math.random() * 44
    vx[i] = Math.cos(angle) * speed + 16
    vy[i] = Math.sin(angle) * speed - 12

    size[i] = Math.random() < 0.76 ? 0.95 + Math.random() * 0.42 : 1.42 + Math.random() * 0.55
    lifeMs[i] = LIFE_MIN_MS + Math.random() * (LIFE_MAX_MS - LIFE_MIN_MS)
    phase[i] = Math.random() * Math.PI * 2
    baseAlpha[i] = pt.alpha
  }

  return {
    palette: buildAshPalette(ink),
    count,
    x,
    y,
    vx,
    vy,
    size,
    delayMs,
    lifeMs,
    phase,
    baseAlpha,
    elapsedMs: 0,
    speedScale: 1,
    seed,
  }
}

/**
 * 推进单个消散粒子簇一帧并批量绘制到目标 2D 上下文，返回当前存活粒子数
 */
export function advanceAndRenderAshBurst(
  ctx: CanvasRenderingContext2D,
  burst: AshParticleBurst,
  dtMs: number,
  buckets: number[][],
): number {
  const effectiveDtMs = Math.min(48, Math.max(0, dtMs)) * burst.speedScale
  burst.elapsedMs += effectiveDtMs
  const dtSec = effectiveDtMs / 1000
  const elapsed = burst.elapsedMs
  const tSec = elapsed / 1000

  for (let b = 0; b < PALETTE_STEPS; b++) {
    buckets[b].length = 0
  }

  let alive = 0
  const { count, x, y, vx, vy, delayMs, lifeMs, phase, baseAlpha } = burst

  for (let i = 0; i < count; i++) {
    const localMs = elapsed - delayMs[i]
    if (localMs <= 0) {
      // 剥蚀波前尚未扫过该像素：保持原笔画坐标与原墨色静止不动
      const initialBucket = Math.min(
        PALETTE_STEPS - 1,
        Math.max(0, Math.round((1 - baseAlpha[i]) * 5)),
      )
      buckets[initialBucket].push(i)
      alive += 1
      continue
    }

    const u = localMs / lifeMs[i]
    if (u >= 1) continue

    // 无散度旋流风场（curl noise 近似）：形成真实轻烟骨灰在微风中翻卷上升的丝缕感
    const px = x[i]
    const py = y[i]
    const ph = phase[i]
    const swirlX = Math.sin(py * 0.032 + tSec * 4.3 + ph) * 62 + Math.cos(px * 0.017 - tSec * 2.6) * 24
    const swirlY = Math.cos(px * 0.029 + tSec * 3.8 + ph) * 50 + Math.sin(py * 0.021 + tSec * 2.9) * 20

    vx[i] = (vx[i] + (30 + swirlX) * dtSec) * 0.986
    vy[i] = (vy[i] + (-26 + swirlY) * dtSec) * 0.986
    x[i] = px + vx[i] * dtSec
    y[i] = py + vy[i] * dtSec

    const effectiveU = Math.min(0.999, Math.max(0, 1 - (1 - u) * baseAlpha[i]))
    const bucketIdx = Math.min(PALETTE_STEPS - 1, Math.floor(effectiveU * PALETTE_STEPS))
    buckets[bucketIdx].push(i)
    alive += 1
  }

  const { palette, size } = burst
  for (let b = 0; b < PALETTE_STEPS; b++) {
    const indices = buckets[b]
    if (indices.length === 0) continue
    const shrink = 1 - (b / PALETTE_STEPS) * 0.34
    ctx.fillStyle = palette[b]
    ctx.beginPath()
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k]
      const s = size[idx] * shrink
      ctx.rect(x[idx], y[idx], s, s)
    }
    ctx.fill()
  }

  return alive
}

export function attachEchoAshCanvas(canvas: HTMLCanvasElement): EchoAshController {
  const bursts: AshParticleBurst[] = []
  const buckets: number[][] = Array.from({ length: PALETTE_STEPS }, () => [])
  let rafId: number | null = null
  let lastTs = 0
  let destroyed = false

  const syncDataset = (particleCount: number) => {
    canvas.dataset.ashActive = particleCount > 0 ? 'true' : 'false'
    canvas.dataset.ashParticles = String(particleCount)
  }

  const resizeCanvasIfNeeded = (ctx: CanvasRenderingContext2D) => {
    const dpr = typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1
    const viewW = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280
    const viewH = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 720
    const targetW = Math.round(viewW * dpr)
    const targetH = Math.round(viewH * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { viewW, viewH }
  }

  const renderStep = (dtMs: number) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bursts.length = 0
      syncDataset(0)
      return
    }
    const { viewW, viewH } = resizeCanvasIfNeeded(ctx)
    ctx.clearRect(0, 0, viewW, viewH)

    let totalAlive = 0
    for (let i = bursts.length - 1; i >= 0; i--) {
      const alive = advanceAndRenderAshBurst(ctx, bursts[i], dtMs, buckets)
      if (alive <= 0) {
        bursts.splice(i, 1)
      } else {
        totalAlive += alive
      }
    }
    syncDataset(totalAlive)
  }

  const tick = (now: number) => {
    if (destroyed) return
    const dtMs = lastTs > 0 ? Math.min(48, Math.max(4, now - lastTs)) : 16
    lastTs = now
    renderStep(dtMs)

    if (bursts.length > 0) {
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = null
      lastTs = 0
    }
  }

  const ensureLoop = () => {
    if (destroyed || rafId !== null) return
    lastTs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    rafId = requestAnimationFrame(tick)
  }

  syncDataset(0)

  return {
    disintegrateFromElement(containerEl: HTMLElement | null): number {
      if (destroyed || !containerEl) return 0
      const burst = createAshBurstFromElement(containerEl)
      if (!burst || burst.count === 0) return 0
      bursts.push(burst)
      // 同步立即绘制首帧：在 React 卸载旧 DOM 的同一渲染帧无缝接管原字迹像素，零闪烁零空窗
      renderStep(0)
      ensureLoop()
      return burst.count
    },
    accelerate() {
      for (const b of bursts) {
        b.speedScale = Math.max(b.speedScale, 2.6)
      }
    },
    hasActiveParticles() {
      return bursts.length > 0
    },
    activeParticleCount() {
      let n = 0
      for (const b of bursts) n += b.count
      return n
    },
    stepFrame(dtMs: number) {
      renderStep(dtMs)
    },
    destroy() {
      destroyed = true
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      bursts.length = 0
      syncDataset(0)
    },
  }
}
