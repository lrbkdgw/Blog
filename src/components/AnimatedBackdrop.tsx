import { useEffect, useRef } from 'react'
import type { ActiveSceneId, SceneValues } from '../lib/animatedBackground'
import { useTheme } from '../lib/theme'
import { createSnow, createRain, createBamboo } from './WeatherBackdrops'

/**
 * 全屏唯美动态背景（樱花 / 粒子星链 / 雪花 / 暴雨 / 竹林），所有场景均跟随站点明暗模式与主题色自动换装。
 *
 * 画面构成分为四层，逐层自然融合：
 *   ① 远景天光与山云星雾：一次性烘焙至离屏 canvas 贴图，每帧仅一次 drawImage；
 *   ② 景框层：随风轻摆的繁花樱枝、两侧婆娑翠竹、覆雪寒松与天球星盘，避开中央正文阅读区；
 *   ③ 运动主体层：60fps 丝滑物理驱动的多形态花瓣、多景深星链、分形冰晶、光学水珠与流萤落叶；
 *   ④ 氛围光效层：丁达尔斜射光束、85mm 镜头散景、月晕极光与星芒微尘，赋予画面电影级空气感。
 *
 * 性能与阅读体验保障：
 *   - 单个 canvas，DPR 上限 1.5；
 *   - 全部粒子、花瓣、光斑、光束均预烘焙离屏贴图，逐帧零渐变创建、零 GC 抖动；
 *   - 中央阅读列（约 820px 宽）自动柔和降噪，两侧留足意境层次，绝不干扰正文阅读；
 *   - 标签页不可见时自动挂起，开启「减少动态效果」时渲染一帧静谧定格画。
 */

export interface Renderer {
  fps: number
  /** 按新的视口尺寸重建背景与粒子 */
  setup(width: number, height: number): void
  /** 调整参数；粒子数量变化时增减粒子，不重新随机已有粒子 */
  configure(values: SceneValues): void
  step(dt: number): void
  draw(ctx: CanvasRenderingContext2D): void
  /** 需要鼠标交互的场景（如粒子星链）可选实现 */
  pointer?(x: number, y: number): void
  /** 明暗模式或主题色变化：重建与配色相关的贴图（粒子本身保留） */
  setTone?(dark: boolean): void
}

/* ------------------------------ 通用工具 ------------------------------ */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const smooth01 = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
const TAU = Math.PI * 2

function seeded(seed: number) {
  let value = (seed * 2654435761) >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

/** 粒子数量随屏幕面积缩放（相对 1440×900），限制在 0.5–2.2 倍之间 */
function areaFactor(width: number, height: number) {
  return clamp((width * height) / (1440 * 900), 0.5, 2.2)
}

/** 中央阅读净空区权重：中心柔和收敛，两侧完整绽放 */
function readingQuietWeight(x: number, width: number, centerFloor = 0.36): number {
  const half = Math.max(1, width * 0.5)
  const inner = Math.min(0.4, 340 / half)
  const outer = Math.min(0.84, 590 / half)
  return centerFloor + (1 - centerFloor) * smooth01(inner, outer, Math.abs(x - half) / half)
}

/** 调整粒子数组长度；新粒子由 make 创建 */
function resizeList<T>(list: T[], target: number, make: () => T) {
  if (list.length > target) list.length = target
  while (list.length < target) list.push(make())
}

/** 新建离屏 canvas 并交给 painter 绘制（用于预渲染贴图） */
function paint(width: number, height: number, painter: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (ctx) painter(ctx)
  return canvas
}

/** 背景贴图：视口尺寸，一次画好之后每帧只贴图 */
function paintBackground(width: number, height: number, painter: (ctx: CanvasRenderingContext2D) => void) {
  return paint(width, height, painter)
}

/** 柔和的圆形光晕（高光核心 + 丝滑指数衰减边缘），用于光点、微尘、流光 */
function makeGlowSprite(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, `rgba(255,255,255,0.96)`)
    gradient.addColorStop(0.14, `rgba(${r},${g},${b},0.85)`)
    gradient.addColorStop(0.38, `rgba(${r},${g},${b},0.36)`)
    gradient.addColorStop(0.7, `rgba(${r},${g},${b},0.08)`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/** 85mm 大光圈奶油散景光斑：内部温润通透、边缘柔化渐隐（无生硬亮圈） */
function makeBokehSprite(r: number, g: number, b: number, size = 96, rim = 0.28): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, `rgba(${r},${g},${b},0.38)`)
    gradient.addColorStop(0.55, `rgba(${r},${g},${b},0.28)`)
    gradient.addColorStop(0.8, `rgba(${r},${g},${b},${rim.toFixed(3)})`)
    gradient.addColorStop(0.94, `rgba(${r},${g},${b},${(rim * 0.25).toFixed(3)})`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/** 十字衍射星芒：纤细十字芒线 + 斜向微副芒 + 晶亮核心 */
function makeSparkleSprite(r: number, g: number, b: number, size = 72): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const drawRay = (angle: number, lenScale: number, thickness: number, peakAlpha: number) => {
      ctx.save()
      ctx.translate(half, half)
      ctx.rotate(angle)
      const halfLen = half * lenScale
      const grad = ctx.createLinearGradient(-halfLen, 0, halfLen, 0)
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
      grad.addColorStop(0.38, `rgba(${r},${g},${b},${(peakAlpha * 0.28).toFixed(3)})`)
      grad.addColorStop(0.5, `rgba(255,255,255,${peakAlpha.toFixed(3)})`)
      grad.addColorStop(0.62, `rgba(${r},${g},${b},${(peakAlpha * 0.28).toFixed(3)})`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.ellipse(0, 0, halfLen, size * thickness, 0, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    drawRay(0, 1, 0.022, 0.94)
    drawRay(Math.PI / 2, 1, 0.022, 0.94)
    drawRay(Math.PI / 4, 0.56, 0.014, 0.44)
    drawRay(-Math.PI / 4, 0.56, 0.014, 0.44)
    const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.3)
    core.addColorStop(0, 'rgba(255,255,255,0.98)')
    core.addColorStop(0.42, `rgba(${r},${g},${b},0.62)`)
    core.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = core
    ctx.fillRect(0, 0, size, size)
  })
}

/** 丁达尔柔和光束贴图：横纵向双向高斯羽化，绝无生硬多边形边缘 */
function makeSunbeamSprite(r: number, g: number, b: number): HTMLCanvasElement {
  return paint(128, 256, (ctx) => {
    const gx = ctx.createLinearGradient(0, 0, 128, 0)
    gx.addColorStop(0, `rgba(${r},${g},${b},0)`)
    gx.addColorStop(0.28, `rgba(${r},${g},${b},0.26)`)
    gx.addColorStop(0.5, `rgba(${r},${g},${b},0.58)`)
    gx.addColorStop(0.72, `rgba(${r},${g},${b},0.26)`)
    gx.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gx
    ctx.fillRect(0, 0, 128, 256)
    ctx.globalCompositeOperation = 'destination-in'
    const gy = ctx.createLinearGradient(0, 0, 0, 256)
    gy.addColorStop(0, 'rgba(0,0,0,0.92)')
    gy.addColorStop(0.48, 'rgba(0,0,0,0.42)')
    gy.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gy
    ctx.fillRect(0, 0, 128, 256)
  })
}

/** 模糊：先缩小再双线性高质放大（全平台兼容，无需 ctx.filter） */
function blurCanvas(source: HTMLCanvasElement, factor = 3): HTMLCanvasElement {
  const small = paint(source.width / factor, source.height / factor, (ctx) => {
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(source, 0, 0, source.width / factor, source.height / factor)
  })
  return paint(source.width, source.height, (ctx) => {
    const previous = ctx.imageSmoothingQuality
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(small, 0, 0, source.width, source.height)
    ctx.imageSmoothingQuality = previous
  })
}

/** 暗角：烘焙进背景贴图（零逐帧开销），让视觉重心温和聚焦 */
function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
  const gradient = ctx.createRadialGradient(
    w * 0.5,
    h * 0.45,
    Math.min(w, h) * 0.22,
    w * 0.5,
    h * 0.5,
    Math.hypot(w, h) * 0.64,
  )
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

let grainTileLight: HTMLCanvasElement | null = null
let grainTileDark: HTMLCanvasElement | null = null
function getGrainTile(light: boolean): HTMLCanvasElement {
  const cached = light ? grainTileLight : grainTileDark
  if (cached) return cached
  const rng = seeded(light ? 131 : 257)
  const tile = paint(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128)
    const tone = light ? '255,255,255' : '0,0,0'
    for (let i = 0; i < 2400; i += 1) {
      const x = Math.floor(rng() * 128)
      const y = Math.floor(rng() * 128)
      const size = rng() < 0.12 ? 2 : 1
      ctx.fillStyle = `rgba(${tone},${(0.018 + rng() * 0.065).toFixed(3)})`
      ctx.fillRect(x, y, size, size)
    }
  })
  if (light) grainTileLight = tile
  else grainTileDark = tile
  return tile
}

/** 细腻胶片颗粒：消除大面积渐变色阶断层 */
function paintGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, light = true) {
  if (typeof ctx.createPattern !== 'function') return
  const pattern = ctx.createPattern(getGrainTile(light), 'repeat')
  if (!pattern) return
  ctx.save()
  ctx.globalAlpha = clamp(alpha / 0.05, 0, 1.5)
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/** 读取当前配色主题的主色，让动态背景与站点主题浑然一体 */
function themeColors(): { accent: string; soft: string; rgb: [number, number, number] } {
  const fallback: [number, number, number] = [53, 99, 246]
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return { accent: '#3563f6', soft: '#5a8bff', rgb: fallback }
  }
  const styles = getComputedStyle(document.documentElement)
  const accent = styles.getPropertyValue('--theme-accent').trim() || '#3563f6'
  const soft = styles.getPropertyValue('--theme-accent-soft').trim() || '#5a8bff'
  return { accent, soft, rgb: hexToRgb(accent) ?? fallback }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.replace('#', '').trim()
  const expanded = value.length === 3 ? value.split('').map((part) => part + part).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ]
}

function toHsl([r, g, b]: [number, number, number]) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: lightness }
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6
  else if (max === green) hue = ((blue - red) / delta + 2) / 6
  else hue = ((red - green) / delta + 4) / 6
  return { h: hue * 360, s: saturation, l: lightness }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const value = Math.round(l * 255)
    return [value, value, value]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return [
    Math.round(channel(hue + 1 / 3) * 255),
    Math.round(channel(hue) * 255),
    Math.round(channel(hue - 1 / 3) * 255),
  ]
}

/* -------------------------------- 樱花 -------------------------------- */

/**
 * 樱花（60fps）：白昼晴樱 / 月夜花灯两套诗意画境。
 *
 * - 远景：水彩远黛春山、柔融春雾、白昼丁达尔暖光束 / 夜樱清朗圆月与微星（避开花枝遮挡）；
 * - 景框：左右上角自然渐细垂落的多分叉老干新枝与繁密花簇独立烘焙，随春风轻微呼吸摇曳；
 * - 散景与浮尘：85mm 大光圈奶油散景光斑与逆光花尘错落漂浮，无巨大同心圆环；
 * - 花瓣：3 种真实缺刻樱瓣形态（心形缺刻瓣、微卷侧视瓣、修长迎风瓣）× 3 档光学景深虚化，
 *   配合三维翻滚倾侧与阅读列柔化，营造《秒速五厘米》般的唯美花吹雪意境。
 */
export function createSakura(initialDark: boolean): Renderer {
  interface Petal {
    x: number
    y: number
    size: number
    depth: number
    angle: number
    spin: number
    tumble: number
    tumbleSpeed: number
    fall: number
    sway: number
    swayFreq: number
    phase: number
    alpha: number
    variant: number
    blurTier: number
  }
  interface BokehOrb {
    x: number
    y: number
    r: number
    vx: number
    vy: number
    phase: number
    alpha: number
    spriteIdx: number
  }

  let width = 0
  let height = 0
  let dark = initialDark
  let background: HTMLCanvasElement | null = null
  let boughLeft: HTMLCanvasElement | null = null
  let boughRight: HTMLCanvasElement | null = null
  let petalSprites: HTMLCanvasElement[][] = []
  let bokehSprites: HTMLCanvasElement[] = []
  let moteSprite: HTMLCanvasElement | null = null
  let petals: Petal[] = []
  let orbs: BokehOrb[] = []
  let target = 40
  let countParam = 40
  let speed = 50
  let wind = 15
  let sizeScale = 50
  let bokehAmount = 0.45
  let time = 0

  const spawn = (fromTop = false): Petal => {
    const depth = Math.pow(Math.random(), 0.92)
    return {
      x: rand(-80, width + 80),
      y: fromTop ? rand(-height * 0.35, -24) : rand(-height * 0.15, height),
      size: 0.3 + depth * 0.82,
      depth,
      angle: rand(0, TAU),
      spin: rand(-1.35, 1.35) * (0.55 + depth * 0.75),
      tumble: rand(0, TAU),
      tumbleSpeed: rand(1.1, 2.5) * (0.65 + depth * 0.6),
      fall: 0.34 + depth * 0.88,
      sway: rand(15, 46) * (0.65 + depth * 0.55),
      swayFreq: rand(0.72, 1.38),
      phase: rand(0, TAU),
      alpha: clamp(0.36 + depth * 0.58, 0.28, 0.96),
      variant: Math.floor(Math.random() * 3),
      blurTier: depth > 0.7 ? 0 : depth > 0.34 ? 1 : 2,
    }
  }

  const spawnOrb = (): BokehOrb => {
    const isLargeBokeh = Math.random() < 0.32
    const side = Math.random() < 0.5 ? rand(0, 0.32) : rand(0.68, 1)
    return {
      x: (isLargeBokeh ? side : Math.random()) * Math.max(1, width),
      y: rand(0, Math.max(1, height * 0.88)),
      r: isLargeBokeh ? rand(26, 68) : rand(5, 16),
      vx: rand(-6, 9),
      vy: rand(-8, -2),
      phase: rand(0, TAU),
      alpha: isLargeBokeh ? rand(0.14, 0.34) : rand(0.22, 0.62),
      spriteIdx: isLargeBokeh ? Math.floor(Math.random() * 3) : -1,
    }
  }

  /** 绘制单朵精致五瓣樱花（含绯色花萼与金蕊）供前景繁花垂枝烘焙复用 */
  const drawBlossomCluster = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    rot: number,
    isDark: boolean,
    softAlpha: number,
  ) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.globalAlpha = softAlpha
    for (let k = 0; k < 5; k += 1) {
      const a = (k * TAU) / 5
      ctx.save()
      ctx.rotate(a)
      const pg = ctx.createLinearGradient(0, -r * 0.12, 0, -r * 1.15)
      if (isDark) {
        pg.addColorStop(0, 'rgba(244, 146, 194, 0.96)')
        pg.addColorStop(0.55, 'rgba(255, 208, 232, 0.94)')
        pg.addColorStop(1, 'rgba(255, 244, 250, 0.92)')
      } else {
        pg.addColorStop(0, 'rgba(242, 148, 188, 0.95)')
        pg.addColorStop(0.55, 'rgba(255, 212, 230, 0.95)')
        pg.addColorStop(1, 'rgba(255, 249, 252, 0.97)')
      }
      ctx.fillStyle = pg
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.1)
      ctx.bezierCurveTo(r * 0.46, -r * 0.32, r * 0.5, -r * 0.92, r * 0.14, -r * 1.12)
      ctx.lineTo(0, -r * 0.95)
      ctx.lineTo(-r * 0.14, -r * 1.12)
      ctx.bezierCurveTo(-r * 0.5, -r * 0.92, -r * 0.46, -r * 0.32, 0, -r * 0.1)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    const center = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.34)
    center.addColorStop(0, isDark ? 'rgba(255, 224, 178, 0.92)' : 'rgba(228, 108, 152, 0.86)')
    center.addColorStop(1, 'rgba(226, 116, 160, 0)')
    ctx.fillStyle = center
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.34, 0, TAU)
    ctx.fill()
    ctx.fillStyle = isDark ? 'rgba(255, 242, 198, 0.88)' : 'rgba(255, 216, 140, 0.92)'
    for (let s = 0; s < 6; s += 1) {
      const sa = (s * TAU) / 6 + 0.3
      ctx.beginPath()
      ctx.arc(Math.cos(sa) * r * 0.24, Math.sin(sa) * r * 0.24, Math.max(0.7, r * 0.06), 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }

  /** 绘制自然渐细的弯曲木质樱枝（由粗至细收尖，末端掩映在花簇之中，绝无生硬断棍） */
  const fillTaperedLimb = (
    ctx: CanvasRenderingContext2D,
    pts: Array<[number, number, number]>,
    fill: string,
  ) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    for (let i = 0; i < pts.length; i += 1) {
      const [x, y, hw] = pts[i]
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      const dx = next[0] - prev[0]
      const dy = next[1] - prev[1]
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      if (i === 0) ctx.moveTo(x + nx * hw, y + ny * hw)
      else ctx.lineTo(x + nx * hw, y + ny * hw)
    }
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      const [x, y, hw] = pts[i]
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      const dx = next[0] - prev[0]
      const dy = next[1] - prev[1]
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      ctx.lineTo(x - nx * hw, y - ny * hw)
    }
    ctx.closePath()
    ctx.fill()
  }

  /** 预烘焙一侧繁花簇拥的自然垂樱枝条贴图 */
  const buildBoughSprite = (bw: number, bh: number, seedNum: number, flipX: boolean) => {
    const r = seeded(seedNum)
    return paint(bw, bh, (ctx) => {
      ctx.save()
      if (flipX) {
        ctx.translate(bw, 0)
        ctx.scale(-1, 1)
      }

      const mainLimb: Array<[number, number, number]> = [
        [-10, bh * 0.22, bw * 0.016],
        [bw * 0.14, bh * 0.19, bw * 0.011],
        [bw * 0.3, bh * 0.24, bw * 0.0075],
        [bw * 0.46, bh * 0.33, bw * 0.0048],
        [bw * 0.62, bh * 0.44, bw * 0.0026],
        [bw * 0.75, bh * 0.52, bw * 0.001],
      ]
      const upperTwig: Array<[number, number, number]> = [
        [bw * 0.18, bh * 0.2, bw * 0.007],
        [bw * 0.35, bh * 0.13, bw * 0.0045],
        [bw * 0.54, bh * 0.11, bw * 0.0025],
        [bw * 0.72, bh * 0.16, bw * 0.001],
      ]
      const droopTwig: Array<[number, number, number]> = [
        [bw * 0.26, bh * 0.23, bw * 0.0058],
        [bw * 0.36, bh * 0.42, bw * 0.0036],
        [bw * 0.45, bh * 0.62, bw * 0.0018],
        [bw * 0.5, bh * 0.76, bw * 0.0008],
      ]

      // 底层柔焦樱云微晕衬底（极轻柔雾化，绝不堆叠出明显圆形光斑）
      for (const limb of [mainLimb, upperTwig, droopTwig]) {
        for (const [lx, ly] of limb) {
          const cr = bw * (0.07 + r() * 0.08)
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, cr)
          g.addColorStop(0, dark ? 'rgba(248, 174, 214, 0.075)' : 'rgba(255, 198, 222, 0.16)')
          g.addColorStop(1, 'rgba(255, 200, 224, 0)')
          ctx.fillStyle = g
          ctx.fillRect(lx - cr, ly - cr, cr * 2, cr * 2)
        }
      }

      const bark = dark ? 'rgba(66, 44, 72, 0.85)' : 'rgba(104, 72, 84, 0.55)'
      fillTaperedLimb(ctx, mainLimb, bark)
      fillTaperedLimb(ctx, upperTwig, bark)
      fillTaperedLimb(ctx, droopTwig, bark)

      // 沿三条垂枝层层簇拥盛放花朵（完全包裹枝梢末端）
      for (const limb of [mainLimb, upperTwig, droopTwig]) {
        for (let i = 1; i < limb.length; i += 1) {
          const [lx, ly] = limb[i]
          const count = 4 + Math.floor(r() * 4)
          for (let k = 0; k < count; k += 1) {
            const ox = (r() - 0.5) * bw * 0.075
            const oy = (r() - 0.5) * bh * 0.095
            const radius = Math.max(5, bw * (0.018 + r() * 0.015))
            drawBlossomCluster(ctx, lx + ox, ly + oy, radius, r() * TAU, dark, 0.58 + r() * 0.38)
          }
        }
      }
      ctx.restore()
    })
  }

  const buildSprites = () => {
    const shapes: Array<(ctx: CanvasRenderingContext2D) => void> = [
      (ctx) => {
        ctx.moveTo(32, 58)
        ctx.bezierCurveTo(14, 48, 8, 28, 16, 13)
        ctx.bezierCurveTo(21, 5, 28, 6, 32, 14)
        ctx.bezierCurveTo(36, 6, 43, 5, 48, 13)
        ctx.bezierCurveTo(56, 28, 50, 48, 32, 58)
      },
      (ctx) => {
        ctx.moveTo(30, 58)
        ctx.bezierCurveTo(13, 45, 12, 24, 22, 11)
        ctx.bezierCurveTo(26, 6, 31, 8, 34, 14)
        ctx.bezierCurveTo(39, 7, 46, 9, 49, 18)
        ctx.bezierCurveTo(53, 33, 45, 49, 30, 58)
      },
      (ctx) => {
        ctx.moveTo(32, 59)
        ctx.bezierCurveTo(18, 46, 15, 25, 22, 11)
        ctx.bezierCurveTo(26, 5, 30, 7, 32, 13)
        ctx.bezierCurveTo(34, 7, 38, 5, 42, 11)
        ctx.bezierCurveTo(49, 25, 46, 46, 32, 59)
      },
    ]

    petalSprites = shapes.map((traceShape, idx) => {
      const base = paint(64, 64, (ctx) => {
        const gradient = ctx.createLinearGradient(16, 8, 48, 58)
        if (dark) {
          gradient.addColorStop(0, 'rgba(255, 242, 248, 0.98)')
          gradient.addColorStop(0.52, 'rgba(252, 190, 220, 0.96)')
          gradient.addColorStop(1, 'rgba(232, 132, 180, 0.93)')
        } else {
          gradient.addColorStop(0, 'rgba(255, 244, 249, 0.99)')
          gradient.addColorStop(0.5, 'rgba(252, 178, 208, 0.97)')
          gradient.addColorStop(1, 'rgba(228, 118, 168, 0.94)')
        }
        ctx.fillStyle = gradient
        ctx.beginPath()
        traceShape(ctx)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
        ctx.lineWidth = 1.15
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(32, 15)
        ctx.quadraticCurveTo(31 + idx, 36, 31, 53)
        ctx.stroke()
      })
      return [base, blurCanvas(base, 2), blurCanvas(base, 4)]
    })

    bokehSprites = dark
      ? [
          makeBokehSprite(255, 184, 220, 96, 0.3),
          makeBokehSprite(232, 158, 224, 96, 0.25),
          makeBokehSprite(255, 218, 176, 96, 0.24),
        ]
      : [
          makeBokehSprite(255, 236, 246, 96, 0.34),
          makeBokehSprite(255, 204, 226, 96, 0.28),
          makeBokehSprite(255, 244, 224, 96, 0.28),
        ]

    moteSprite = dark
      ? makeGlowSprite(255, 218, 238, 48)
      : makeGlowSprite(255, 244, 228, 48)
  }

  const buildBackground = () => {
    const w = width
    const h = height
    const rng = seeded(709)
    const sunBeam = makeSunbeamSprite(
      dark ? 228 : 255,
      dark ? 210 : 240,
      dark ? 255 : 226,
    )

    background = paintBackground(w, h, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, w * 0.42, h)
      if (dark) {
        sky.addColorStop(0, '#0a0817')
        sky.addColorStop(0.38, '#140f27')
        sky.addColorStop(0.74, '#211639')
        sky.addColorStop(1, '#2c1c46')
      } else {
        sky.addColorStop(0, '#fffcfd')
        sky.addColorStop(0.42, '#fef5f9')
        sky.addColorStop(0.78, '#fbe9f1')
        sky.addColorStop(1, '#f5ddeb')
      }
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      if (dark) {
        for (let i = 0; i < 68; i += 1) {
          const sx = rng() * w
          const sy = rng() * h * 0.56
          const sr = 0.45 + rng() * 1.05
          ctx.fillStyle = `rgba(248, 238, 255, ${(0.12 + rng() * 0.42).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(sx, sy, sr, 0, TAU)
          ctx.fill()
        }
        // 春夜圆月置于开阔夜空（w * 0.67, h * 0.14），避开右侧花枝遮挡
        const mx = w * 0.67
        const my = h * 0.145
        const mr = Math.max(14, Math.min(30, Math.min(w, h) * 0.028))
        const halo = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 9)
        halo.addColorStop(0, 'rgba(255, 228, 244, 0.36)')
        halo.addColorStop(0.3, 'rgba(214, 186, 255, 0.14)')
        halo.addColorStop(0.68, 'rgba(176, 148, 240, 0.04)')
        halo.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, w, h)

        const moonGrad = ctx.createRadialGradient(mx - mr * 0.25, my - mr * 0.25, mr * 0.1, mx, my, mr)
        moonGrad.addColorStop(0, 'rgba(255, 253, 255, 0.98)')
        moonGrad.addColorStop(0.72, 'rgba(248, 234, 248, 0.94)')
        moonGrad.addColorStop(1, 'rgba(232, 208, 240, 0.88)')
        ctx.fillStyle = moonGrad
        ctx.beginPath()
        ctx.arc(mx, my, mr, 0, TAU)
        ctx.fill()
      } else {
        const warm = ctx.createRadialGradient(w * 0.18, h * 0.08, 0, w * 0.18, h * 0.08, Math.max(w, h) * 0.72)
        warm.addColorStop(0, 'rgba(255, 244, 226, 0.92)')
        warm.addColorStop(0.42, 'rgba(255, 228, 238, 0.42)')
        warm.addColorStop(1, 'rgba(255, 226, 238, 0)')
        ctx.fillStyle = warm
        ctx.fillRect(0, 0, w, h)

        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const [angle, bwScale, lenScale, alpha] of [
          [-0.42, 0.13, 0.85, 0.26],
          [-0.28, 0.17, 0.95, 0.3],
          [-0.14, 0.12, 0.78, 0.22],
        ] as Array<[number, number, number, number]>) {
          ctx.save()
          ctx.translate(w * 0.14, -h * 0.05)
          ctx.rotate(angle)
          ctx.globalAlpha = alpha
          ctx.drawImage(sunBeam, -w * bwScale * 0.5, 0, w * bwScale, h * lenScale)
          ctx.restore()
        }
        ctx.restore()
      }

      // 远黛春山与柔融春雾（多峰水彩起伏取代单调弧带）
      for (let layer = 0; layer < 2; layer += 1) {
        const baseY = h * (0.835 + layer * 0.055)
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w + 16; x += 16) {
          const u = x / Math.max(1, w)
          const arch = Math.pow(Math.abs(u - 0.5) * 2, 1.45)
          const wave =
            Math.sin(u * 6.4 + layer * 2.3) * 0.38 +
            Math.sin(u * 13.7 + layer * 1.1) * 0.18 +
            Math.sin(u * 23.1 + layer) * 0.07
          const y = baseY - h * (0.02 + arch * (0.08 - layer * 0.02) + wave * 0.024)
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        const hillGrad = ctx.createLinearGradient(0, baseY - h * 0.12, 0, h)
        if (dark) {
          hillGrad.addColorStop(0, layer === 0 ? 'rgba(54, 34, 78, 0.56)' : 'rgba(38, 22, 58, 0.76)')
          hillGrad.addColorStop(1, 'rgba(28, 16, 46, 0.2)')
        } else {
          hillGrad.addColorStop(0, layer === 0 ? 'rgba(234, 200, 219, 0.5)' : 'rgba(224, 186, 209, 0.45)')
          hillGrad.addColorStop(1, 'rgba(250, 234, 243, 0.12)')
        }
        ctx.fillStyle = hillGrad
        ctx.fill()
      }

      const mist = ctx.createLinearGradient(0, h * 0.74, 0, h)
      if (dark) {
        mist.addColorStop(0, 'rgba(42, 26, 64, 0)')
        mist.addColorStop(1, 'rgba(84, 44, 92, 0.34)')
      } else {
        mist.addColorStop(0, 'rgba(255, 244, 249, 0)')
        mist.addColorStop(1, 'rgba(255, 246, 250, 0.85)')
      }
      ctx.fillStyle = mist
      ctx.fillRect(0, h * 0.74, w, h * 0.26)

      paintVignette(ctx, w, h, dark ? 0.32 : 0.06)
      if (!dark) paintGrain(ctx, w, h, 0.03, true)
    })

    const bw = Math.max(180, Math.round(Math.min(w * 0.28, 410)))
    const bh = Math.max(140, Math.round(Math.min(h * 0.38, 330)))
    boughLeft = buildBoughSprite(bw, bh, 311, false)
    boughRight = buildBoughSprite(bw, bh, 577, true)
  }

  return {
    fps: 60,
    setup(w, h) {
      width = w
      height = h
      buildSprites()
      buildBackground()
      petals = []
      orbs = []
      target = Math.round((countParam / 100) * 135 * areaFactor(width, height))
      resizeList(petals, target, () => spawn())
      resizeList(orbs, Math.round((14 + bokehAmount * 30) * areaFactor(width, height)), spawnOrb)
    },
    setTone(next) {
      dark = next
      buildSprites()
      buildBackground()
    },
    configure(values) {
      countParam = values.count ?? 40
      speed = values.speed ?? 50
      wind = values.wind ?? 15
      sizeScale = values.size ?? 50
      bokehAmount = (values.bokeh ?? 45) / 100
      target = Math.round((countParam / 100) * 135 * areaFactor(width, height))
      resizeList(petals, target, () => spawn())
      resizeList(orbs, Math.round((14 + bokehAmount * 30) * areaFactor(width, height)), spawnOrb)
    },
    step(dt) {
      time += dt
      const gustFactor = 0.76 + 0.36 * Math.sin(time * 0.42) + 0.18 * Math.sin(time * 1.13 + 0.7)
      const drift = (wind / 100) * 92 * gustFactor
      for (const petal of petals) {
        petal.phase += dt * petal.swayFreq * (0.85 + petal.depth * 0.75)
        petal.angle += petal.spin * dt * 0.85
        petal.tumble += petal.tumbleSpeed * dt
        const flutterLift = 0.82 + 0.24 * Math.sin(petal.tumble * 2)
        petal.y += petal.fall * (15 + (speed / 100) * 58) * flutterLift * dt
        petal.x += (drift * (0.55 + petal.depth * 0.65) + Math.sin(petal.phase) * petal.sway) * dt
        if (petal.y > height + 70 || petal.x > width + 95 || petal.x < -95) {
          Object.assign(petal, spawn(true))
        }
      }
      for (const orb of orbs) {
        orb.phase += dt * 0.85
        orb.x += (orb.vx + drift * 0.12 + Math.sin(orb.phase) * 5) * dt
        orb.y += orb.vy * dt
        if (orb.y < -orb.r * 2) {
          orb.y = height + orb.r
          orb.x = rand(0, width)
        }
        if (orb.x < -orb.r * 2) orb.x = width + orb.r
        if (orb.x > width + orb.r * 2) orb.x = -orb.r
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      // 85mm 大光圈奶油散景光斑与逆光花尘（自然分布在林隙与画面两侧，无突兀大圆环）
      if (bokehAmount > 0.03) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        for (const orb of orbs) {
          const sp = orb.spriteIdx >= 0 ? bokehSprites[orb.spriteIdx] : moteSprite
          if (!sp) continue
          const breathe = 0.62 + 0.38 * Math.sin(orb.phase * 1.5)
          const quiet = readingQuietWeight(orb.x, width, 0.35)
          ctx.globalAlpha = clamp(orb.alpha * breathe * bokehAmount * 1.55 * quiet, 0, 0.85)
          ctx.drawImage(sp, orb.x - orb.r, orb.y - orb.r, orb.r * 2, orb.r * 2)
        }
        ctx.restore()
      }

      // 左右前景繁花垂枝随春风微微摇曳
      const boughSway = Math.sin(time * 0.68) * 0.015 + Math.sin(time * 1.31 + 1.1) * 0.006
      if (boughLeft) {
        ctx.save()
        ctx.translate(-6, -4)
        ctx.rotate(boughSway)
        ctx.drawImage(boughLeft, 0, 0)
        ctx.restore()
      }
      if (boughRight) {
        ctx.save()
        ctx.translate(width + 6, -4)
        ctx.rotate(-boughSway * 0.92)
        ctx.drawImage(boughRight, -boughRight.width, 0)
        ctx.restore()
      }

      // 多形态 3D 翻飞樱瓣（中央阅读区自动温润降噪）
      ctx.save()
      for (const petal of petals) {
        const sprite = petalSprites[petal.variant]?.[petal.blurTier]
        if (!sprite) continue
        const size = sprite.width * petal.size * (0.54 + sizeScale / 100) * 0.56
        const flip = Math.cos(petal.tumble)
        const bank = Math.cos(petal.phase) * 0.28
        const quiet = readingQuietWeight(petal.x, width, 0.42)
        ctx.save()
        ctx.translate(petal.x, petal.y)
        ctx.rotate(petal.angle * 0.65 + bank)
        ctx.globalAlpha = clamp(petal.alpha * (0.68 + Math.abs(flip) * 0.32) * quiet, 0, 1)
        const squeeze = 0.34 + Math.abs(flip) * 0.66
        ctx.drawImage(sprite, (-size * squeeze) / 2, -size / 2, size * squeeze, size)
        ctx.restore()
      }
      ctx.restore()
    },
  }
}

/* ------------------------------ 粒子星链 ------------------------------ */

/**
 * 粒子星链（60fps）：暗夜星河星轨 / 晨曦琉璃星盘。
 *
 * - 双色主题星云与斜向银河微光带交织，四角环绕纤细天球星盘刻度弧；
 * - 多景深星点具备冷暖双星色、宝石级柔和辉光与十字衍射星芒；
 * - 流光彗星脉冲拖曳渐隐光尾滑过星链，鼠标掠过时泛起柔和引力涟漪。
 */
export function createNetwork(initialDark: boolean): Renderer {
  interface Node {
    x: number
    y: number
    vx: number
    vy: number
    z: number
    size: number
    phase: number
    pulse: number
    hueVariant: number
  }
  interface Packet {
    from: number
    to: number
    t: number
    speed: number
    color: number
  }
  let width = 0
  let height = 0
  let dark = initialDark
  let background: HTMLCanvasElement | null = null
  let glowPrimary: HTMLCanvasElement | null = null
  let glowSecondary: HTMLCanvasElement | null = null
  let sparkle: HTMLCanvasElement | null = null
  let nodes: Node[] = []
  let packets: Packet[] = []
  let densityParam = 45
  let target = 60
  let linkDistance = 140
  let speed = 40
  let pulseAmount = 0.5
  let glowStrength = 0.55
  let accent: [number, number, number] = [90, 139, 255]
  let accent2: [number, number, number] = [168, 126, 255]
  let nodeRgb: [number, number, number] = [255, 255, 255]
  let blend: 'lighter' | 'source-over' = 'lighter'
  let linkAlpha = 0.42
  let nodeAlpha = 0.95
  let glowScale = 1
  const pointer = { x: -9999, y: -9999 }

  const spawn = (): Node => {
    const z = Math.pow(Math.random(), 0.82)
    return {
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-1, 1),
      vy: rand(-1, 1),
      z,
      size: 0.78 + z * 1.62,
      phase: rand(0, TAU),
      pulse: rand(0.65, 1.9),
      hueVariant: Math.random() < 0.36 ? 1 : 0,
    }
  }

  const routePacket = (packet: Packet) => {
    packet.from = Math.floor(Math.random() * Math.max(1, nodes.length))
    const from = nodes[packet.from]
    let chosen = packet.from
    let count = 0
    if (from) {
      for (let i = 0; i < nodes.length; i += 1) {
        if (i === packet.from) continue
        const other = nodes[i]
        const dx = other.x - from.x
        const dy = other.y - from.y
        if (dx * dx + dy * dy <= linkDistance * linkDistance && Math.random() < 1 / ++count) {
          chosen = i
        }
      }
    }
    packet.to = chosen
    packet.t = 0
    packet.speed = rand(0.4, 0.95)
  }

  const spawnPacket = (): Packet => {
    const packet = { from: 0, to: 0, t: 0, speed: 0.55, color: Math.random() < 0.5 ? 0 : 1 }
    routePacket(packet)
    return packet
  }

  const buildAssets = () => {
    const colors = themeColors()
    const baseRgb = colors.rgb
    const hue = toHsl(baseRgb)
    const secondaryBase = hslToRgb(hue.h + 44, clamp(hue.s * 1.08, 0.58, 0.94), dark ? 0.68 : 0.48)
    if (dark) {
      blend = 'lighter'
      accent = hslToRgb(hue.h, clamp(hue.s, 0.58, 0.96), 0.66)
      accent2 = secondaryBase
      nodeRgb = [250, 252, 255]
      linkAlpha = 0.42
      nodeAlpha = 0.96
      glowScale = 1.15
    } else {
      blend = 'source-over'
      accent = hslToRgb(hue.h, clamp(hue.s * 0.9, 0.42, 0.88), 0.44)
      accent2 = secondaryBase
      nodeRgb = hslToRgb(hue.h, clamp(hue.s * 0.92, 0.38, 0.9), 0.35)
      linkAlpha = 0.34
      nodeAlpha = 0.88
      glowScale = 0.62
    }

    glowPrimary = makeGlowSprite(colors.rgb[0], colors.rgb[1], colors.rgb[2], 64)
    glowSecondary = makeGlowSprite(accent2[0], accent2[1], accent2[2], 64)
    sparkle = dark
      ? makeSparkleSprite(colors.rgb[0], colors.rgb[1], colors.rgb[2], 72)
      : makeSparkleSprite(nodeRgb[0], nodeRgb[1], nodeRgb[2], 72)

    const c1 = `${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]}`
    const c2 = `${accent2[0]},${accent2[1]},${accent2[2]}`
    const rng = seeded(913)

    background = paintBackground(width, height, (ctx) => {
      const w = width
      const h = height
      const sky = ctx.createLinearGradient(0, 0, w * 0.38, h)
      if (dark) {
        sky.addColorStop(0, '#030612')
        sky.addColorStop(0.5, '#071026')
        sky.addColorStop(1, '#0c1938')
      } else {
        sky.addColorStop(0, '#fcfdff')
        sky.addColorStop(0.55, '#f4f7fe')
        sky.addColorStop(1, '#e9effc')
      }
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      // 深空微尘星底与斜向银河繁星带
      if (dark) {
        for (let i = 0; i < 160; i += 1) {
          const band = i < 70
          const t = rng()
          const sx = band ? w * (0.05 + t * 0.9) + (rng() - 0.5) * w * 0.24 : rng() * w
          const sy = band ? h * (0.1 + t * 0.8) + (rng() - 0.5) * h * 0.24 : rng() * h
          const sr = 0.35 + rng() * 0.95
          ctx.fillStyle = `rgba(226, 238, 255, ${(0.08 + rng() * 0.36).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(sx, sy, sr, 0, TAU)
          ctx.fill()
        }
      }

      // 双色交融星云柔光层
      ctx.save()
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      const clouds: Array<[number, number, number, string, number]> = [
        [w * 0.16, h * 0.24, Math.max(w, h) * 0.6, c1, dark ? 0.22 : 0.085],
        [w * 0.85, h * 0.72, Math.max(w, h) * 0.58, c2, dark ? 0.18 : 0.075],
        [w * 0.72, h * 0.16, Math.max(w, h) * 0.4, c1, dark ? 0.11 : 0.05],
      ]
      for (const [cx, cy, rad, rgb, peak] of clouds) {
        const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
        neb.addColorStop(0, `rgba(${rgb},${peak})`)
        neb.addColorStop(0.52, `rgba(${rgb},${(peak * 0.36).toFixed(3)})`)
        neb.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = neb
        ctx.fillRect(0, 0, w, h)
      }
      ctx.restore()

      // 天球星盘同心细弧（清雅克制地环抱四角）
      ctx.save()
      ctx.strokeStyle = dark ? `rgba(${c1},0.055)` : `rgba(${c1},0.045)`
      ctx.lineWidth = 1
      const poleX = w * 0.88
      const poleY = -h * 0.12
      for (let ring = 1; ring <= 4; ring += 1) {
        const radius = Math.hypot(w, h) * (0.22 + ring * 0.15)
        ctx.beginPath()
        ctx.arc(poleX, poleY, radius, Math.PI * 0.54, Math.PI * 0.96)
        ctx.stroke()
      }
      ctx.restore()

      paintVignette(ctx, w, h, dark ? 0.48 : 0.06)
    })
  }

  return {
    fps: 60,
    setup(w, h) {
      width = w
      height = h
      buildAssets()
      nodes = []
      packets = []
      target = Math.round((densityParam / 100) * 148 * areaFactor(width, height))
      resizeList(nodes, target, spawn)
      const wanted = Math.round(pulseAmount * 26 * areaFactor(width, height))
      while (packets.length < wanted) packets.push(spawnPacket())
      packets.length = Math.min(packets.length, wanted)
    },
    setTone(next) {
      dark = next
      buildAssets()
    },
    configure(values) {
      densityParam = values.density ?? 45
      linkDistance = 92 + ((values.link ?? 50) / 100) * 180
      speed = values.speed ?? 35
      pulseAmount = (values.pulse ?? 50) / 100
      glowStrength = (values.glow ?? 55) / 100
      target = Math.round((densityParam / 100) * 148 * areaFactor(width, height))
      resizeList(nodes, target, spawn)
      const wanted = Math.round(pulseAmount * 26 * areaFactor(width, height))
      while (packets.length < wanted) packets.push(spawnPacket())
      packets.length = Math.min(packets.length, wanted)
    },
    pointer(x, y) {
      pointer.x = x
      pointer.y = y
    },
    step(dt) {
      const velocity = 5.5 + (speed / 100) * 34
      for (const node of nodes) {
        const dx = pointer.x - node.x
        const dy = pointer.y - node.y
        const distance = Math.hypot(dx, dy)
        if (distance < 250 && distance > 1) {
          const pull = (1 - distance / 250) * 3.2 * dt
          node.vx += (dx / distance) * pull
          node.vy += (dy / distance) * pull
        }
        const mag = Math.hypot(node.vx, node.vy)
        if (mag > 1.35) {
          const damp = 1 - Math.min(1, dt * 1.4) * 0.25
          node.vx *= damp
          node.vy *= damp
        }
        node.vx = clamp(node.vx, -2.1, 2.1)
        node.vy = clamp(node.vy, -2.1, 2.1)
        const parallax = 0.45 + node.z * 0.8
        node.x += node.vx * velocity * parallax * dt
        node.y += node.vy * velocity * parallax * dt
        node.phase += dt * node.pulse
        if (node.x < -24) node.x = width + 24
        if (node.x > width + 24) node.x = -24
        if (node.y < -24) node.y = height + 24
        if (node.y > height + 24) node.y = -24
      }
      for (const packet of packets) {
        packet.t += dt * packet.speed
        if (packet.t >= 1) {
          routePacket(packet)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const [r, g, b] = accent
      const [r2, g2, b2] = accent2
      const [nr, ng, nb] = nodeRgb

      ctx.save()
      ctx.globalCompositeOperation = blend

      const cells = new Map<string, number[]>()
      for (let i = 0; i < nodes.length; i += 1) {
        const key = `${Math.floor(nodes[i].x / linkDistance)}:${Math.floor(nodes[i].y / linkDistance)}`
        const cell = cells.get(key)
        if (cell) cell.push(i)
        else cells.set(key, [i])
      }

      // 星链连线：平滑二次衰减，中央阅读区柔和降噪
      ctx.lineCap = 'round'
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        const cx = Math.floor(node.x / linkDistance)
        const cy = Math.floor(node.y / linkDistance)
        for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
          for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
            for (const j of cells.get(`${gx}:${gy}`) ?? []) {
              if (j <= i) continue
              const other = nodes[j]
              const dx = other.x - node.x
              const dy = other.y - node.y
              const distanceSq = dx * dx + dy * dy
              if (distanceSq > linkDistance * linkDistance) continue
              const distance = Math.sqrt(distanceSq)
              const t = 1 - distance / linkDistance
              const fade = t * t
              const quiet = readingQuietWeight((node.x + other.x) * 0.5, width, 0.45)
              const useAlt = node.hueVariant !== other.hueVariant
              ctx.lineWidth = 0.65 + fade * 0.7
              ctx.strokeStyle = useAlt
                ? `rgba(${r2},${g2},${b2},${(fade * linkAlpha * quiet).toFixed(3)})`
                : `rgba(${r},${g},${b},${(fade * linkAlpha * quiet).toFixed(3)})`
              ctx.beginPath()
              ctx.moveTo(node.x, node.y)
              ctx.lineTo(other.x, other.y)
              ctx.stroke()
            }
          }
        }
      }

      // 流光彗星脉冲：渐隐拖尾 + 柔光星核
      for (const packet of packets) {
        const from = nodes[packet.from]
        const to = nodes[packet.to]
        if (!from || !to || packet.from === packet.to) continue
        const distance = Math.hypot(to.x - from.x, to.y - from.y)
        if (distance > linkDistance) continue
        const env = Math.sin(Math.PI * clamp(packet.t, 0, 1))
        const px = from.x + (to.x - from.x) * packet.t
        const py = from.y + (to.y - from.y) * packet.t
        const quiet = readingQuietWeight(px, width, 0.5)
        const trail = 0.22
        const tx = from.x + (to.x - from.x) * Math.max(0, packet.t - trail)
        const ty = from.y + (to.y - from.y) * Math.max(0, packet.t - trail)
        const grad = ctx.createLinearGradient(tx, ty, px, py)
        const [cr, cg, cb] = packet.color ? [r2, g2, b2] : [r, g, b]
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`)
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},${(linkAlpha * 1.75 * env * quiet).toFixed(3)})`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.7
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(px, py)
        ctx.stroke()
        const sprite = packet.color ? glowSecondary : glowPrimary
        if (sprite && glowStrength > 0.04) {
          const size = 22 * (0.7 + 0.3 * env)
          ctx.globalAlpha = (0.58 + 0.42 * glowStrength) * glowScale * env * quiet
          ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size)
          ctx.globalAlpha = 1
        }
      }

      // 星点与衍射十字星芒
      for (const node of nodes) {
        const pulse = 0.68 + 0.32 * Math.sin(node.phase)
        const quiet = readingQuietWeight(node.x, width, 0.52)
        const glowSprite = node.hueVariant ? glowSecondary : glowPrimary
        const size = node.size * (6.2 + pulse * 4.8)
        if (glowSprite && glowStrength > 0.04) {
          ctx.globalAlpha = 0.62 * glowStrength * pulse * glowScale * quiet
          ctx.drawImage(glowSprite, node.x - size / 2, node.y - size / 2, size, size)
        }
        if (sparkle && glowStrength > 0.04 && node.size > 1.55) {
          const flare = node.size * 15 * pulse
          ctx.globalAlpha = 0.6 * glowStrength * pulse * glowScale * quiet
          ctx.drawImage(sparkle, node.x - flare / 2, node.y - flare / 2, flare, flare)
        }
        ctx.globalAlpha = nodeAlpha * quiet * (0.58 + node.z * 0.42)
        ctx.fillStyle = `rgba(${nr},${ng},${nb},1)`
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.size * (dark ? 0.62 : 0.74), 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    },
  }
}

export function createRenderer(scene: ActiveSceneId, dark: boolean): Renderer {
  switch (scene) {
    case 'sakura':
      return createSakura(dark)
    case 'network':
      return createNetwork(dark)
    case 'snow':
      return createSnow(dark)
    case 'rain':
      return createRain(dark)
    case 'bamboo':
      return createBamboo(dark)
  }
}

/* ------------------------------- 组件 -------------------------------- */

export function AnimatedBackdrop({ scene, values }: { scene: ActiveSceneId; values: SceneValues }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const valuesKey = JSON.stringify(values)
  const valuesRef = useRef<SceneValues>(values)
  valuesRef.current = values
  const { theme, colorTheme } = useTheme()
  const dark = theme === 'dark'
  const darkRef = useRef(dark)
  darkRef.current = dark

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const renderer = createRenderer(scene, darkRef.current)
    rendererRef.current = renderer

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let last = 0
    let width = 0
    let height = 0
    let resizeFrame = 0

    const redraw = () => renderer.draw(ctx)
    redrawRef.current = redraw

    const sizeTo = () => {
      width = window.innerWidth
      height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderer.setup(width, height)
      renderer.configure(valuesRef.current)
      redraw()
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const interval = 1000 / renderer.fps
      // 留出约 18% 的 VSync 抖动余量：60Hz 屏幕不会因 15.5ms 帧间隔偶发丢帧掉到 30fps，
      // 120Hz 屏幕仍能稳定按隔帧节奏限幅在目标帧率。
      if (last && now - last < interval * 0.82) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      renderer.step(dt)
      renderer.draw(ctx)
    }

    const start = () => {
      if (frame || motion.matches || document.hidden) return
      last = 0
      frame = requestAnimationFrame(tick)
    }
    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }

    const onResize = () => {
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        sizeTo()
      })
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    const onMotion = () => {
      if (motion.matches) {
        stop()
        redraw()
      } else {
        start()
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      renderer.pointer?.(event.clientX, event.clientY)
    }
    const onPointerLeave = () => renderer.pointer?.(-9999, -9999)
    if (typeof renderer.pointer === 'function') {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', onPointerLeave)
      window.addEventListener('blur', onPointerLeave)
    }

    sizeTo()
    start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    motion.addEventListener('change', onMotion)

    return () => {
      stop()
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('blur', onPointerLeave)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      motion.removeEventListener('change', onMotion)
      rendererRef.current = null
      redrawRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  useEffect(() => {
    rendererRef.current?.configure(valuesRef.current)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) redrawRef.current?.()
  }, [valuesKey])

  useEffect(() => {
    rendererRef.current?.setTone?.(dark)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) redrawRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, colorTheme])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  )
}
