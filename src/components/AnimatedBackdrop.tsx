import { useEffect, useRef } from 'react'
import type { ActiveSceneId, SceneValues } from '../lib/animatedBackground'

/**
 * 全屏动态背景（雨夜 / 阳光 / 星空 / 极光 / 樱花 / 飘雪 / 粒子星链 / 海浪）。
 *
 * 画面构成分为三层，逐层叠加：
 *   ① 远景：一次性画进离屏 canvas 贴图（天空渐变、城市灯火、银河、光斑、暗角…），
 *      每帧只做一次 drawImage，因此再华丽也不增加逐帧开销；
 *   ② 中景：流动的粒子与光效（雨丝、花瓣、极光帘幕、波浪…）；
 *   ③ 光效：光晕、辉光、闪光、镜头光斑等，统一用 screen / lighter 叠加，
 *      得到类似「泛光」的观感。
 *
 * 性能策略：
 *   - 单个 canvas，像素比上限 1.5；
 *   - 所有光点、花瓣、星芒、光斑都用预渲染贴图 + drawImage，绝不在逐帧循环里创建渐变；
 *   - 粒子数量按屏幕面积缩放并设上限，各场景有各自的帧率上限；
 *   - 标签页隐藏时暂停动画，系统开启「减少动态效果」时只绘制一帧静态画面。
 */

interface Renderer {
  fps: number
  /** 按新的视口尺寸重建背景与粒子 */
  setup(width: number, height: number): void
  /** 调整参数；粒子数量变化时增减粒子，不重新随机已有粒子 */
  configure(values: SceneValues): void
  step(dt: number): void
  draw(ctx: CanvasRenderingContext2D): void
  /** 需要鼠标交互的场景（如粒子星链）可选实现 */
  pointer?(x: number, y: number): void
}

/* ------------------------------ 通用工具 ------------------------------ */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const TAU = Math.PI * 2

/** 粒子数量随屏幕面积缩放（相对 1440×900），限制在 0.5–2.2 倍之间 */
function areaFactor(width: number, height: number) {
  return clamp((width * height) / (1440 * 900), 0.5, 2.2)
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

/** 柔和的圆形光晕（颜色 + 半径），用于光点、星芒、浮尘 */
function makeGlowSprite(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`)
    gradient.addColorStop(0.22, `rgba(${r},${g},${b},0.55)`)
    gradient.addColorStop(0.55, `rgba(${r},${g},${b},0.14)`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/** 散景光斑：内部柔和、边缘略亮的一圈，比纯光晕更像镜头虚化 */
function makeBokehSprite(r: number, g: number, b: number, size = 128, rim = 0.55): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, `rgba(${r},${g},${b},0.42)`)
    gradient.addColorStop(0.62, `rgba(${r},${g},${b},0.30)`)
    gradient.addColorStop(0.86, `rgba(${r},${g},${b},${rim.toFixed(3)})`)
    gradient.addColorStop(0.97, `rgba(${r},${g},${b},${(rim * 0.35).toFixed(3)})`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/** 四芒星闪光：两条交叉的细渐变 + 中心光点，用于星芒、雪光、浪花泡沫 */
function makeSparkleSprite(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const beam = (horizontal: boolean) => {
      const gradient = horizontal
        ? ctx.createLinearGradient(0, half, size, half)
        : ctx.createLinearGradient(half, 0, half, size)
      gradient.addColorStop(0, `rgba(${r},${g},${b},0)`)
      gradient.addColorStop(0.5, `rgba(${r},${g},${b},0.95)`)
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = gradient
      if (horizontal) ctx.fillRect(0, half - size * 0.028, size, size * 0.056)
      else ctx.fillRect(half - size * 0.028, 0, size * 0.056, size)
    }
    beam(true)
    beam(false)
    const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.34)
    core.addColorStop(0, `rgba(255,255,255,0.95)`)
    core.addColorStop(0.45, `rgba(${r},${g},${b},0.6)`)
    core.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = core
    ctx.fillRect(0, 0, size, size)
  })
}

/** 模糊：先缩小再放大（兼容性好，不需要 ctx.filter） */
function blurCanvas(source: HTMLCanvasElement, factor = 3): HTMLCanvasElement {
  const small = paint(source.width / factor, source.height / factor, (ctx) => {
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

/** 暗角：烘焙进背景贴图（免费），让画面中心更聚焦 */
function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
  const gradient = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

/**
 * 噪点贴图：128×128 的噪点瓦片，全局缓存一次。
 *
 * 以前是「遍历整屏每 2 像素」随机打点，一块 1920×1080 的背景要跑 50 万次循环，
 * 场景切换 / 拖动参数时能明显卡一下；现在改成缓存瓦片 + repeat 填充，
 * 视觉上几乎没差别（同样细密的随机噪点），重建背景的成本降到一次 fillRect。
 */
let grainTileLight: HTMLCanvasElement | null = null
let grainTileDark: HTMLCanvasElement | null = null
function getGrainTile(light: boolean): HTMLCanvasElement {
  const cached = light ? grainTileLight : grainTileDark
  if (cached) return cached
  const tile = paint(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128)
    const tone = light ? '255,255,255' : '0,0,0'
    for (let i = 0; i < 2800; i += 1) {
      const x = Math.floor(rand(0, 128))
      const y = Math.floor(rand(0, 128))
      const size = Math.random() < 0.12 ? 2 : 1
      ctx.fillStyle = `rgba(${tone},${rand(0.02, 0.09).toFixed(3)})`
      ctx.fillRect(x, y, size, size)
    }
  })
  if (light) grainTileLight = tile
  else grainTileDark = tile
  return tile
}

/** 细腻噪点：让大面积渐变不出现色带（只在建立背景时画一次） */
function paintGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, light = true) {
  const pattern = ctx.createPattern(getGrainTile(light), 'repeat')
  if (!pattern) return
  ctx.save()
  // 参数语义保持不变：alpha 约 0.04–0.05 时接近原来的密度
  ctx.globalAlpha = clamp(alpha / 0.05, 0, 1.6)
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/** 读取当前配色主题的主色，让动态背景也能跟着主题换色 */
function themeColors(): { accent: string; soft: string; rgb: [number, number, number] } {
  const fallback: [number, number, number] = [53, 99, 246]
  if (typeof window === 'undefined') return { accent: '#3563f6', soft: '#5a8bff', rgb: fallback }
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


/**
 * 昂贵重建的「延迟执行」小工具。
 *
 * 拖动参数滑块时，如果每一帧都重建贴图（星空要逐像素算银河、极光要算发光缓冲）
 * 会明显卡顿。这里把重建推迟到参数停止变化 ~200ms 之后再执行，
 * 拖动过程中画面保持上一帧的贴图，松手后立刻更新。
 */
function createDeferred(delay = 200) {
  let at = 0
  return {
    mark() {
      at = performance.now()
    },
    /** 返回 true 表示这次该执行重建了 */
    ready() {
      if (!at) return false
      if (performance.now() - at < delay) return false
      at = 0
      return true
    },
    pending() {
      return at !== 0
    },
  }
}

/* ---------------------------- 噪声与柔和贴图 ---------------------------- */

/**
 * 二维值噪声 + 分形叠加（fbm）。
 *
 * 星空里的银河、阳光里的云、极光的光斑都需要「有机、连续」的纹理，
 * 纯随机点只会得到噪点。这里用一个轻量的值噪声（双线性插值 + 平滑曲线），
 * 再叠几层不同频率，就能得到真实的云/星云质感——而且只在建立贴图时算一次。
 */
function makeNoise2D(seed = 1) {
  const table = new Float32Array(65536)
  let state = seed >>> 0 || 1
  for (let i = 0; i < table.length; i += 1) {
    // xorshift：稳定、无依赖
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    table[i] = ((state >>> 0) % 65536) / 65535
  }
  const at = (x: number, y: number) => table[((x * 1619 + y * 31337) & 65535 + 65536) % 65536]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = smooth(x - xi)
    const yf = smooth(y - yi)
    const a = at(xi, yi)
    const b = at(xi + 1, yi)
    const c = at(xi, yi + 1)
    const d = at(xi + 1, yi + 1)
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf
  }
  const fbm = (x: number, y: number, octaves = 4, gain = 0.5, lacunarity = 2.03) => {
    let sum = 0
    let amp = 0.5
    let freq = 1
    let norm = 0
    for (let i = 0; i < octaves; i += 1) {
      sum += noise(x * freq, y * freq) * amp
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
  return { noise, fbm }
}

/** 在色相环上按最短路径混合两个色相 */
function mixHue(a: number, b: number, t: number): number {
  let delta = ((b - a) % 360 + 540) % 360 - 180
  return a + delta * t
}

/** 柔和光斑：半径内近似高斯衰减，用于散景、光晕、泡沫 */
function makeSoftDot(rgb: [number, number, number], size = 96, power = 2.2): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const image = ctx.createImageData(size, size)
    const [r, g, b] = rgb
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5 - half) / half
        const dy = (y + 0.5 - half) / half
        const d = Math.sqrt(dx * dx + dy * dy)
        const a = d >= 1 ? 0 : Math.pow(1 - d, power)
        const index = (y * size + x) * 4
        image.data[index] = r
        image.data[index + 1] = g
        image.data[index + 2] = b
        image.data[index + 3] = Math.round(a * 255)
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

/** 柔化：先缩小再用高质量插值放大，等价于一次廉价的高斯模糊（不需要 ctx.filter） */
function soften(source: HTMLCanvasElement, factor = 4): HTMLCanvasElement {
  const small = paint(source.width / factor, source.height / factor, (ctx) => {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, source.width / factor, source.height / factor)
  })
  return paint(source.width, source.height, (ctx) => {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(small, 0, 0, source.width, source.height)
  })
}

/** 柔和竖线（雨丝 / 光柱 / 瀑布光）：两端渐隐 + 一侧亮边 */
function makeSoftStreak(r: number, g: number, b: number, slope = 0, size = 48): HTMLCanvasElement {
  return paint(size, size * 3, (ctx) => {
    const w = size
    const h = size * 3
    const cx = w / 2
    const dx = slope * h * 0.5
    ctx.save()
    ctx.translate(cx, 0)
    ctx.rotate(Math.atan2(dx, h))
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, `rgba(${r},${g},${b},0)`)
    gradient.addColorStop(0.25, `rgba(${r},${g},${b},0.3)`)
    gradient.addColorStop(0.78, `rgba(${r},${g},${b},0.62)`)
    gradient.addColorStop(0.98, `rgba(${r},${g},${b},0.2)`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(-w * 0.05, 0, w * 0.1, h)
    ctx.restore()
  })
}

/* -------------------------------- 雨夜 -------------------------------- */

/**
 * 雨夜的画面参考真实雨夜街拍：夜云 → 城市天际线与亮着的窗 → 湿街反光 → 三层雨丝。
 *
 * 关键细节（都是观感上的分水岭）：
 *  - 天际线不是等比矩形，而是有高有矮、带天线与楼顶灯、窗户随机点亮的剪影；
 *  - 湿街道上要有「被拉长的竖向灯光倒影」，这是雨夜最标志性的东西；
 *  - 雨丝用两端渐隐的柔化贴图，并且近处带虚化、远处细密；
 *  - 雨点落地用「扩散的柔光环 + 向上溅起的小水花」，而不是空心圆圈；
 *  - 镜头前的散景光斑要非常淡、非常虚，否则会变成一堆灰色卵石。
 */
function createRain(): Renderer {
  interface Drop {
    x: number
    y: number
    len: number
    speed: number
    depth: number
    alpha: number
  }
  interface Ripple {
    x: number
    y: number
    r: number
    life: number
    maxLife: number
  }
  interface Splash {
    x: number
    y: number
    life: number
    vy: number
  }
  interface Bokeh {
    x: number
    y: number
    size: number
    alpha: number
    drift: number
    phase: number
  }
  interface Bolt {
    points: { x: number; y: number }[]
    branches: { x: number; y: number }[][]
    life: number
  }
  let width = 0
  let height = 0
  let ground = 0.8
  let background: HTMLCanvasElement | null = null
  let cloudFlash: HTMLCanvasElement | null = null
  let softByWind: HTMLCanvasElement[] = []
  let nearByWind: HTMLCanvasElement[] = []
  let ringSprite: HTMLCanvasElement | null = null
  let splashSprite: HTMLCanvasElement | null = null
  let bokehSprite: HTMLCanvasElement | null = null
  let drops: Drop[] = []
  let ripples: Ripple[] = []
  let splashes: Splash[] = []
  let bokehs: Bokeh[] = []
  let bolt: Bolt | null = null
  let target = 0
  let nearCount = 0
  let speed = 55
  let wind = 12
  let lightning = 20
  let glow = 55
  let flash = 0
  let nextFlash = Infinity
  let time = 0

  const spawnDrop = (near = false): Drop => {
    const depth = near ? rand(0.72, 1) : rand(0, 0.72)
    return {
      x: rand(-100, width + 100),
      y: rand(-height, height * ground),
      len: 12 + depth * 46,
      speed: 0.55 + depth * 0.7,
      depth,
      alpha: (near ? 0.3 : 0.1) + depth * (near ? 0.5 : 0.28),
    }
  }
  const spawnBokeh = (): Bokeh => ({
    x: rand(0, width),
    y: rand(height * 0.55, height * 0.98),
    size: rand(28, 96),
    alpha: rand(0.05, 0.14),
    drift: rand(4, 14),
    phase: rand(0, TAU),
  })

  const scheduleFlash = () => {
    if (lightning <= 0) {
      nextFlash = Infinity
      return
    }
    const base = 26 - (lightning / 100) * 23
    nextFlash = base * rand(0.35, 1.7)
  }

  /** 折线闪电：中点位移 + 分叉，绘制时分三层做辉光 */
  const strike = () => {
    const segments = 18
    const startX = rand(width * 0.15, width * 0.85)
    const endX = clamp(startX + rand(-width * 0.2, width * 0.2), 0, width)
    const endY = height * rand(0.45, 0.68)
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments
      const jitter = i === 0 || i === segments ? 0 : rand(-1, 1) * (1 - Math.abs(t - 0.5)) * width * 0.05
      points.push({ x: startX + (endX - startX) * t + jitter, y: height * -0.06 + endY * t })
    }
    const branches: { x: number; y: number }[][] = []
    for (let b = 0; b < 3; b += 1) {
      const from = Math.round(rand(4, segments - 3))
      const origin = points[from]
      const dir = points[from + 1]
      const angle = Math.atan2(dir.y - origin.y, dir.x - origin.x) + rand(-0.7, 0.7)
      const length = rand(0.08, 0.2) * height
      const branch: { x: number; y: number }[] = [origin]
      let x = origin.x
      let y = origin.y
      let a = angle
      for (let st = 0; st < 5; st += 1) {
        a += rand(-0.35, 0.35)
        x += Math.cos(a) * (length / 5)
        y += Math.sin(a) * (length / 5)
        branch.push({ x, y })
      }
      branches.push(branch)
    }
    bolt = { points, branches, life: 1 }
    flash = 1
  }

  return {
    fps: 60,
    setup(w, h) {
      width = w
      height = h
      // 3 档风向的雨丝贴图：风越大用越斜的一张，避免逐滴旋转的开销
      const slopes = [0.08, 0.34, 0.62]
      softByWind = slopes.map((slope) => makeSoftStreak(196, 218, 255, slope, 30))
      nearByWind = slopes.map((slope) => soften(makeSoftStreak(214, 232, 255, slope, 36), 2))
      // 落点涟漪：柔和的环（不是空心圆圈）
      ringSprite = paint(128, 128, (ctx) => {
        const ring = ctx.createRadialGradient(64, 64, 30, 64, 64, 60)
        ring.addColorStop(0, 'rgba(190, 220, 255, 0)')
        ring.addColorStop(0.68, 'rgba(200, 226, 255, 0.28)')
        ring.addColorStop(0.86, 'rgba(226, 240, 255, 0.5)')
        ring.addColorStop(1, 'rgba(190, 220, 255, 0)')
        ctx.fillStyle = ring
        ctx.fillRect(0, 0, 128, 128)
      })
      ringSprite = soften(ringSprite, 2)
      splashSprite = soften(makeSoftStreak(226, 240, 255, 0, 14), 2)
      bokehSprite = makeSoftDot([255, 208, 150], 128, 2.6)

      const horizon = h * 0.72
      const noise = makeNoise2D(20261016)

      background = paintBackground(w, h, (ctx) => {
        // ---------- 夜空：顶部近黑，地平线附近是城市的暖色光污染 ----------
        const sky = ctx.createLinearGradient(0, 0, 0, horizon)
        sky.addColorStop(0, '#04060d')
        sky.addColorStop(0.5, '#080d1a')
        sky.addColorStop(0.82, '#131c2e')
        sky.addColorStop(1, '#26303f')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, horizon)

        // 低垂的雨云：分形噪声做形状，底部被城市灯光从下面照亮
        const cloudCanvas = paint(Math.max(32, Math.round(w / 2)), Math.max(24, Math.round(horizon / 2)), (c) => {
          const image = c.createImageData(w >> 1, Math.max(1, Math.round(horizon / 2)))
          const cw = w >> 1
          const ch = Math.max(1, Math.round(horizon / 2))
          for (let y = 0; y < ch; y += 1) {
            const ny = y / ch
            for (let x = 0; x < cw; x += 1) {
              const nx = x / cw
              const density = noise.fbm(nx * 3.1, ny * 2.4 + 0.5, 5, 0.55)
              // 云在天地之间，越靠近地平线越亮（灯光从下方打亮云底）
              const body = clamp((density - 0.42) * 3.1, 0, 1) * clamp(1.25 - ny * 1.1, 0, 1)
              const lit = Math.pow(clamp((ny - 0.35) / 0.65, 0, 1), 1.7)
              const index = (y * cw + x) * 4
              image.data[index] = 60 + lit * 150 * body
              image.data[index + 1] = 66 + lit * 130 * body
              image.data[index + 2] = 82 + lit * 110 * body
              image.data[index + 3] = Math.round(body * 190)
            }
          }
          c.putImageData(image, 0, 0)
        })
        ctx.save()
        ctx.globalAlpha = 0.75
        ctx.drawImage(soften(cloudCanvas, 3), 0, 0, w, horizon)
        ctx.restore()
        cloudFlash = soften(cloudCanvas, 3)

        // 城市光污染：地平线上方的一层暖色 + 冷色混合辉光
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const pollution = ctx.createLinearGradient(0, horizon - h * 0.3, 0, horizon)
        pollution.addColorStop(0, 'rgba(34, 46, 78, 0)')
        pollution.addColorStop(0.6, 'rgba(74, 80, 116, 0.1)')
        pollution.addColorStop(1, 'rgba(198, 152, 104, 0.17)')
        ctx.fillStyle = pollution
        ctx.fillRect(0, horizon - h * 0.3, w, h * 0.3)
        ctx.restore()

        // ---------- 天际线：高低错落的楼、楼顶灯、随机点亮的窗 ----------
        const litWindows: { x: number; y: number; w: number; h: number; warm: boolean }[] = []
        ctx.save()
        const silhouette = ctx.createLinearGradient(0, horizon - h * 0.2, 0, horizon)
        silhouette.addColorStop(0, 'rgba(9, 13, 24, 0.92)')
        silhouette.addColorStop(1, 'rgba(5, 8, 16, 1)')
        let bx = -40
        const bases: { x: number; top: number; bw: number }[] = []
        while (bx < w + 40) {
          const bw = rand(30, 138)
          // 少量高楼，多数为中低层，形成有节奏的天际线
          const tall = Math.random() < 0.2
          const bh = tall ? rand(h * 0.2, h * 0.35) : rand(h * 0.045, h * 0.16)
          const base = horizon + rand(1, 7) // 楼基略微错开，避免连成一条直线
          const top = base - bh
          // 楼体：底部被城市灯光微微染暖（近处雾气的散射），越往上越黑
          const body = ctx.createLinearGradient(0, top, 0, base)
          body.addColorStop(0, '#080c15')
          body.addColorStop(0.62, '#0a0f1b')
          body.addColorStop(1, '#141a28')
          ctx.fillStyle = body
          ctx.fillRect(bx, top, bw, bh)
          bases.push({ x: bx, top, bw })
          // 一部分楼有退台的「塔冠」，天际线立刻不像积木
          if (tall && Math.random() < 0.7) {
            const crownW = bw * rand(0.4, 0.68)
            const crownH = bh * rand(0.1, 0.24)
            ctx.fillStyle = '#080c15'
            ctx.fillRect(bx + (bw - crownW) / 2, top - crownH, crownW, crownH)
          }
          // 楼顶的航空警示灯与天线
          if (tall) {
            ctx.fillStyle = 'rgba(9, 13, 24, 1)'
            ctx.fillRect(bx + bw * 0.5 - 1, top - rand(8, 26), 2, 26)
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            const beacon = ctx.createRadialGradient(bx + bw * 0.5, top - 4, 0, bx + bw * 0.5, top - 4, 7)
            beacon.addColorStop(0, 'rgba(255, 120, 120, 0.85)')
            beacon.addColorStop(1, 'rgba(255, 90, 90, 0)')
            ctx.fillStyle = beacon
            ctx.fillRect(bx + bw * 0.5 - 8, top - 12, 16, 16)
            ctx.restore()
          }
          // 窗户：网格排布 + 随机点亮（暖白 / 冷白两色温）
          const cellW = 5
          const cellH = 7
          const cols = Math.max(1, Math.floor((bw - 8) / cellW))
          const rows = Math.max(1, Math.floor((bh - 12) / cellH))
          for (let cx = 0; cx < cols; cx += 1) {
            for (let cy = 0; cy < rows; cy += 1) {
              if (Math.random() > 0.19) continue
              const wx = bx + 5 + cx * cellW
              const wy = top + 8 + cy * cellH
              const warm = Math.random() < 0.72
              litWindows.push({ x: wx, y: wy, w: rand(1.6, 2.6), h: rand(2.4, 3.4), warm })
            }
          }
          bx += bw + rand(2, 16)
        }
        ctx.restore()

        // 窗户亮灯：先把所有窗户画在一张透明贴图上，再叠一层柔化副本做辉光
        // （只在建立背景时做一次，逐帧零开销）
        const windowLayer = paint(w, h, (c) => {
          for (const win of litWindows) {
            c.fillStyle = win.warm
              ? `rgba(255, 208, 144, ${rand(0.28, 0.78).toFixed(2)})`
              : `rgba(206, 226, 255, ${rand(0.24, 0.6).toFixed(2)})`
            c.fillRect(win.x, win.y, win.w, win.h)
          }
        })
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.3
        ctx.drawImage(soften(windowLayer, 4), 0, 0)
        ctx.globalAlpha = 1
        ctx.drawImage(windowLayer, 0, 0)
        ctx.restore()

        // ---------- 湿漉漉的街道 ----------
        const street = ctx.createLinearGradient(0, horizon, 0, h)
        street.addColorStop(0, '#18202f')
        street.addColorStop(0.18, '#0d1421')
        street.addColorStop(0.62, '#060a12')
        street.addColorStop(1, '#03050a')
        ctx.fillStyle = street
        ctx.fillRect(0, horizon, w, h - horizon)

        // 地面湿光的横向条纹（沥青上的水膜）
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 140; i += 1) {
          const y = horizon + Math.pow(Math.random(), 0.6) * (h - horizon)
          const len = rand(20, 190)
          const x = rand(-20, w)
          const alpha = rand(0.02, 0.08) * (1 - (y - horizon) / (h - horizon) * 0.6)
          ctx.fillStyle = `rgba(150, 178, 224, ${alpha.toFixed(3)})`
          ctx.fillRect(x, y, len, rand(0.6, 1.8))
        }
        ctx.restore()

        // 灯光的竖向倒影：雨夜里最标志性的笔触——把灯色沿街面垂直拉长
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const win of litWindows) {
          if (Math.random() > 0.14) continue
          const rx = win.x + win.w / 2
          const len = rand(h * 0.05, h * 0.2) * (0.45 + (win.y - (horizon - h * 0.3)) / h)
          const rw = rand(1.4, 4.5)
          const color = win.warm ? '255, 196, 128' : '190, 214, 255'
          // 分 2–3 段画，中间留缝，像被水波打断的倒影而不是一根根灯管
          const pieces = 2 + (Math.random() < 0.5 ? 1 : 0)
          let y = horizon + rand(0, 4)
          for (let piece = 0; piece < pieces; piece += 1) {
            const pieceLen = (len / pieces) * rand(0.6, 1.1)
            const reflection = ctx.createLinearGradient(0, y, 0, y + pieceLen)
            reflection.addColorStop(0, `rgba(${color}, ${rand(0.1, 0.26).toFixed(3)})`)
            reflection.addColorStop(1, `rgba(${color}, 0)`)
            ctx.fillStyle = reflection
            ctx.fillRect(rx - rw / 2, y, rw, pieceLen)
            y += pieceLen + rand(2, 12)
          }
        }
        // 几盏路灯：暖色光池 + 竖直的灯杆倒影，让街面不空
        for (let i = 0; i < Math.round(4 + (w / 320)); i += 1) {
          const lx = rand(0, w)
          const ly = horizon + rand(h * 0.04, h * 0.34)
          const radius = rand(50, 130)
          const pool = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius)
          pool.addColorStop(0, `rgba(255, 190, 122, ${rand(0.06, 0.13).toFixed(3)})`)
          pool.addColorStop(1, 'rgba(255, 190, 122, 0)')
          ctx.fillStyle = pool
          ctx.fillRect(lx - radius, ly - radius * 0.6, radius * 2, radius * 1.2)
          ctx.fillStyle = `rgba(255, 198, 132, ${rand(0.12, 0.24).toFixed(3)})`
          ctx.fillRect(lx - 1.2, horizon, 2.4, rand(h * 0.05, h * 0.16))
        }

        // 大面积的城市光晕倒影（整条街的暖色底光）
        const streetGlow = ctx.createLinearGradient(0, horizon, 0, h * 0.9)
        streetGlow.addColorStop(0, 'rgba(255, 186, 120, 0.11)')
        streetGlow.addColorStop(0.35, 'rgba(110, 122, 180, 0.07)')
        streetGlow.addColorStop(1, 'rgba(50, 60, 105, 0)')
        ctx.fillStyle = streetGlow
        ctx.fillRect(0, horizon, w, h - horizon)
        ctx.restore()

        // 地平线处的暗色水膜：压掉「台面」感
        const membrane = ctx.createLinearGradient(0, horizon - 2, 0, horizon + h * 0.1)
        membrane.addColorStop(0, 'rgba(0, 0, 0, 0.28)')
        membrane.addColorStop(0.35, 'rgba(0, 0, 0, 0.16)')
        membrane.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = membrane
        ctx.fillRect(0, horizon - 2, w, h * 0.1 + 2)

        paintVignette(ctx, w, h, 0.5)
        paintGrain(ctx, w, h, 0.035, false)
      })

      drops = []
      ripples = []
      splashes = []
      bokehs = Array.from({ length: 6 }, spawnBokeh)
      resizeList(drops, target + nearCount, spawnDrop)
      scheduleFlash()
    },
    configure(values) {
      speed = values.speed ?? 55
      wind = values.wind ?? 12
      const wasOff = !Number.isFinite(nextFlash)
      lightning = values.lightning ?? 20
      glow = (values.glow ?? 55) / 100
      const dense = (values.density ?? 55) / 100
      // 中层雨丝细密、近层雨丝粗而虚——两层叠加才有「下大了」的纵深感
      target = Math.round(dense * 190 * areaFactor(width, height))
      nearCount = Math.round(dense * 40 * areaFactor(width, height))
      drops = []
      resizeList(drops, target + nearCount, spawnDrop)
      drops.forEach((drop, index) => {
        if (index >= target) Object.assign(drop, spawnDrop(true))
      })
      if (lightning <= 0) nextFlash = Infinity
      else if (wasOff) scheduleFlash()
    },
    step(dt) {
      time += dt
      const fall = 420 + (speed / 100) * 1150
      const drift = (wind / 100) * 260
      for (const drop of drops) {
        drop.y += fall * drop.speed * dt
        drop.x += drift * drop.speed * dt
        if (drop.y > height * ground) {
          const splashY = height * ground + rand(0, height * (1 - ground) * 0.9)
          if (drop.depth > 0.35) {
            if (splashes.length < 220) {
              splashes.push({ x: drop.x, y: splashY, life: 1, vy: rand(26, 62) })
            }
            if (drop.depth > 0.75 && ripples.length < 60) {
              const maxLife = rand(0.5, 1.05)
              ripples.push({ x: drop.x, y: splashY, r: 1, life: maxLife, maxLife })
            }
          }
          const fresh = spawnDrop(drop.depth > 0.72)
          fresh.y = rand(-height * 0.3, -12)
          Object.assign(drop, fresh)
        }
        if (drop.x > width + 120) drop.x -= width + 240
        if (drop.x < -120) drop.x += width + 240
      }
      for (const ripple of ripples) {
        ripple.life -= dt
        ripple.r += dt * (30 + ripple.r * 1.4)
      }
      ripples = ripples.filter((ripple) => ripple.life > 0)
      for (const splash of splashes) {
        splash.life -= dt * 3.4
        splash.y -= splash.vy * dt
        splash.vy *= 0.9
      }
      splashes = splashes.filter((splash) => splash.life > 0)
      for (const bokeh of bokehs) {
        bokeh.phase += dt * 0.4
        bokeh.y -= bokeh.drift * dt
        if (bokeh.y < height * 0.5) bokeh.y = height * 0.98
      }
      if (flash > 0) flash = Math.max(0, flash - dt * 2.2)
      if (bolt) {
        bolt.life -= dt * 3.4
        if (bolt.life <= 0) bolt = null
      }
      if (Number.isFinite(nextFlash)) {
        nextFlash -= dt
        if (nextFlash <= 0) {
          strike()
          scheduleFlash()
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      // 闪电照亮云层（叠一层被提亮的云）
      if (cloudFlash && flash > 0.02) {
        ctx.save()
        ctx.globalAlpha = clamp(flash * 0.5, 0, 1)
        ctx.globalCompositeOperation = 'screen'
        ctx.drawImage(cloudFlash, 0, 0, width, height * 0.72)
        ctx.restore()
      }

      // 雨丝：中层细密 + 近层虚化，各一层 drawImage
      const slant = ((wind / 100) * 260) / (420 + (speed / 100) * 1150)
      const windBucket = clamp(Math.round(slant / 0.25), 0, 2)
      const streakSoft = softByWind[windBucket]
      const streakNear = nearByWind[windBucket]
      ctx.save()
      const boost = 0.6 + glow * 0.7 + flash * 1.1
      if (streakSoft) {
        for (let i = 0; i < target; i += 1) {
          const drop = drops[i]
          if (!drop) continue
          const sw = 2.4 + drop.depth * 4
          const sh = drop.len * 2.6
          ctx.globalAlpha = clamp(drop.alpha * boost * 0.8, 0, 1)
          ctx.drawImage(streakSoft, drop.x - sw / 2, drop.y - sh * 0.55, sw, sh)
        }
      }
      if (streakNear) {
        for (let i = target; i < drops.length; i += 1) {
          const drop = drops[i]
          if (!drop) continue
          const sw = 5 + drop.depth * 12
          const sh = drop.len * 3.6
          ctx.globalAlpha = clamp(drop.alpha * boost * 0.5, 0, 1)
          ctx.drawImage(streakNear, drop.x - sw / 2, drop.y - sh * 0.55, sw, sh)
        }
      }
      ctx.restore()

      // 落点涟漪：柔光环，越扩越淡
      if (ringSprite) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const ripple of ripples) {
          const fade = clamp(ripple.life / ripple.maxLife, 0, 1)
          const size = ripple.r * 2.4
          ctx.globalAlpha = fade * fade * 0.42 * (0.6 + glow * 0.6)
          ctx.drawImage(ringSprite, ripple.x - size / 2, ripple.y - size * 0.16, size, size * 0.32)
        }
        ctx.restore()
      }
      // 溅起的小水花
      if (splashSprite) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const splash of splashes) {
          const size = 5
          const h2 = 16 * splash.life
          ctx.globalAlpha = clamp(splash.life, 0, 1) * 0.4
          ctx.drawImage(splashSprite, splash.x - size / 2, splash.y - h2, size, h2)
        }
        ctx.restore()
      }

      // 镜头前的散景光斑（非常淡、非常虚，只做氛围）
      if (bokehSprite) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const bokeh of bokehs) {
          const size = bokeh.size * (1 + 0.06 * Math.sin(bokeh.phase))
          ctx.globalAlpha = bokeh.alpha * (0.5 + glow * 0.7)
          ctx.drawImage(bokehSprite, bokeh.x - size / 2, bokeh.y - size / 2, size, size)
        }
        ctx.restore()
      }

      // 闪电：三层辉光 + 分叉
      if (bolt) {
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        const jitter = bolt.life * 6
        const drawPath = (points: { x: number; y: number }[]) => {
          ctx.beginPath()
          points.forEach((point, index) => {
            const x = point.x + rand(-jitter, jitter)
            const y = point.y + rand(-jitter, jitter)
            if (index === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()
        }
        ctx.strokeStyle = `rgba(140, 178, 255, ${(0.1 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 26
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(180, 210, 255, ${(0.28 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 9
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.9 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 2
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(210, 230, 255, ${(0.4 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 1.6
        for (const branch of bolt.branches) drawPath(branch)
        ctx.restore()
      }

      // 整屏闪光：让整幅画面（包括雨丝与街道）都亮一下
      if (flash > 0.02) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(flash * 0.32, 0, 1)
        ctx.fillStyle = 'rgb(150, 180, 240)'
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
      }

      void time
    },
  }
}

/* -------------------------------- 阳光 -------------------------------- */

/**
 * 阳光：蓝天 + 云 + 逆光，参考真实逆光风景摄影。
 *
 * 之前的版本把太阳光晕铺满全屏直接「爆成白屏」，这版改成：
 *  - 天顶是饱和的蓝，越靠近地平线越浅、越暖（瑞利散射）；
 *  - 云用 fbm 生成真正的积云形状：顶部被阳光照亮（暖白），底部偏冷灰，
 *    并且带一层柔化副本做体积感；
 *  - 太阳放在右上角，本体 + 多层暖色光晕 + 光轴上的冰晶光环（镜头光斑）；
 *  - 再加一层很淡的光尘与飞絮，以及远山/树林剪影作地面锚点；
 *  - 全程避免纯白大面积铺开，正文依然能看清。
 */
function createSunshine(): Renderer {
  interface Mote {
    x: number
    y: number
    size: number
    rise: number
    phase: number
    twinkle: boolean
    alpha: number
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let cloudLayer: HTMLCanvasElement | null = null
  let cloudSoft: HTMLCanvasElement | null = null
  let moteSprite: HTMLCanvasElement | null = null
  let sparkleSprite: HTMLCanvasElement | null = null
  let glowSprite: HTMLCanvasElement | null = null
  let burstSprite: HTMLCanvasElement | null = null
  let flareRing: HTMLCanvasElement | null = null
  let flareDot: HTMLCanvasElement | null = null
  let hazeShift = 0
  let time = 0
  let sun = { x: 0, y: 0 }
  const flares: { t: number; size: number; color: [number, number, number]; alpha: number; ring: boolean }[] = [
    { t: 0.3, size: 62, color: [255, 208, 150], alpha: 0.1, ring: false },
    { t: 0.5, size: 30, color: [180, 226, 255], alpha: 0.09, ring: false },
    { t: 0.7, size: 50, color: [255, 224, 176], alpha: 0.075, ring: true },
    { t: 0.95, size: 24, color: [196, 246, 220], alpha: 0.07, ring: false },
    { t: 1.2, size: 70, color: [255, 196, 210], alpha: 0.05, ring: true },
  ]
  let target = 0
  let motes: Mote[] = []
  let brightness = 0.6
  let drift = 0.35
  let flareAmount = 0.45
  let rayAmount = 0.5
  let cloudCover = 0.4

  // 光尘只出现在向阳的一侧（真实逆光里的浮尘都聚在光里），越靠近太阳越密
  const inSunlit = (x: number, y: number) => {
    const dx = (x - sun.x) / width
    const dy = (y - sun.y) / height
    const d = Math.sqrt(dx * dx * 0.55 + dy * dy)
    return Math.random() < clamp(1.15 - d * 1.5, 0.05, 1)
  }
  const spawnMote = (): Mote => {
    let x = rand(0, width)
    let y = rand(0, height)
    for (let tries = 0; tries < 6 && !inSunlit(x, y); tries += 1) {
      x = rand(0, width)
      y = rand(0, height)
    }
    return {
      x,
      y,
      size: rand(0.16, 0.5),
      rise: rand(0.3, 1),
      phase: rand(0, TAU),
      twinkle: Math.random() < 0.08,
      alpha: rand(0.2, 0.5),
    }
  }

  const buildSky = (ctx: CanvasRenderingContext2D) => {
    const w = width
    const h = height
    const noise = makeNoise2D(31337)
    const horizon = h * 0.86

    // ---------- 天空：饱和的蓝 → 地平线的暖白 ----------
    const sky = ctx.createLinearGradient(0, 0, w * 0.24, h)
    sky.addColorStop(0, '#2e75c9')
    sky.addColorStop(0.26, '#4d95dd')
    sky.addColorStop(0.5, '#7fb8e8')
    sky.addColorStop(0.72, '#a9cef0')
    sky.addColorStop(0.88, '#cfdceb')
    sky.addColorStop(1, '#e7ddcb')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    // ---------- 云：fbm 形状，顶部被照亮、底部偏冷 ----------
    const cw = Math.max(64, Math.round(w / 3))
    const ch = Math.max(48, Math.round(h / 3))
    const cloudCanvas = paint(cw, ch, (c) => {
      const image = c.createImageData(cw, ch)
      for (let y = 0; y < ch; y += 1) {
        const ny = y / ch
        // 云的分布：中上部为主，靠近地平线是薄薄的层云
        const bandMask = clamp(1.34 - Math.abs(ny - 0.32) * 2.2, 0, 1)
        for (let x = 0; x < cw; x += 1) {
          const nx = x / cw
          const density = noise.fbm(nx * 2.9 + 1.7, ny * 3.6 + 8.3, 5, 0.55)
          const detail = noise.fbm(nx * 9.4 + 4.1, ny * 7.2 + 2.2, 3, 0.5)
          const shape = clamp((density * 0.7 + detail * 0.3 - (0.56 - cloudCover * 0.3)) * 5.2, 0, 1)
          const body = shape * bandMask
          if (body <= 0.01) {
            image.data[(y * cw + x) * 4 + 3] = 0
            continue
          }
          // 云顶亮（暖白），云底冷（灰蓝）——逆光时最明显
          // 云顶被太阳照亮（近白、微暖），云底偏冷灰蓝——逆光的立体感全靠这个
          const vertical = clamp(ny * 1.9, 0, 1)
          const index = (y * cw + x) * 4
          image.data[index] = Math.round(255 - vertical * 26)
          image.data[index + 1] = Math.round(255 - vertical * 30)
          image.data[index + 2] = Math.round(252 - vertical * 12)
          image.data[index + 3] = Math.round(body * (196 + cloudCover * 56))
        }
      }
      c.putImageData(image, 0, 0)
    })
    cloudLayer = cloudCanvas
    cloudSoft = soften(cloudCanvas, 3)

    // ---------- 太阳：本体 + 多层暖色光晕 ----------
    sun = { x: w * 0.76, y: h * 0.19 }
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // 大范围的天光（不是纯白，是暖黄）
    const halo = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, Math.max(w, h) * 0.5)
    halo.addColorStop(0, 'rgba(255, 246, 214, 0.52)')
    halo.addColorStop(0.1, 'rgba(255, 234, 182, 0.3)')
    halo.addColorStop(0.3, 'rgba(255, 220, 162, 0.12)')
    halo.addColorStop(0.65, 'rgba(246, 210, 168, 0.04)')
    halo.addColorStop(1, 'rgba(240, 210, 170, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)
    // 太阳本体：核心偏白，边缘暖黄
    const disc = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, Math.min(w, h) * 0.055)
    disc.addColorStop(0, 'rgba(255, 253, 240, 0.9)')
    disc.addColorStop(0.34, 'rgba(255, 244, 202, 0.42)')
    disc.addColorStop(1, 'rgba(255, 226, 168, 0)')
    ctx.fillStyle = disc
    ctx.fillRect(sun.x - w, sun.y - w, w * 2, w * 2)
    ctx.restore()

    // ---------- 云（叠在太阳之上，被阳光照亮；一部分云挡在太阳前面） ----------
    ctx.save()
    ctx.globalAlpha = 0.34
    ctx.drawImage(cloudSoft, -w * 0.06, -h * 0.02, w * 1.12, h * 0.78)
    ctx.globalAlpha = 0.92
    ctx.drawImage(cloudCanvas, 0, 0, w, h * 0.76)
    // 太阳前方的一缕薄云：光被「罩」住一点，不那么刺眼
    ctx.globalAlpha = 0.34
    ctx.drawImage(cloudCanvas, -w * 0.16, h * 0.04, w * 1.24, h * 0.6)
    ctx.restore()

    // ---------- 地平线附近的雾霭 ----------
    ctx.save()
    const haze = ctx.createLinearGradient(0, h * 0.68, 0, horizon)
    haze.addColorStop(0, 'rgba(255, 246, 226, 0)')
    haze.addColorStop(0.6, `rgba(244, 240, 228, ${(0.1 + brightness * 0.12).toFixed(3)})`)
    haze.addColorStop(1, 'rgba(238, 232, 216, 0.38)')
    ctx.fillStyle = haze
    ctx.fillRect(0, h * 0.68, w, h - h * 0.68)
    ctx.restore()

    // ---------- 地面：远处的丘陵与树林剪影（逆光下是半透明的青灰色） ----------
    const ridgeNoise = makeNoise2D(515)
    for (let ridge = 0; ridge < 3; ridge += 1) {
      const depth = ridge / 2
      const baseY = horizon + depth * h * 0.055
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(0, baseY)
      for (let x = 0; x <= w + 30; x += 24) {
        const y =
          baseY -
          ridgeNoise.fbm(x * 0.0014 + ridge * 5.2, ridge * 1.7, 4, 0.5) * h * (0.05 + depth * 0.03) -
          Math.sin(x * 0.0022 + ridge * 2) * h * 0.006
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const tone = ctx.createLinearGradient(0, baseY - h * 0.1, 0, h)
      if (ridge === 0) {
        tone.addColorStop(0, 'rgba(120, 142, 154, 0.42)')
        tone.addColorStop(1, 'rgba(96, 118, 130, 0.66)')
      } else if (ridge === 1) {
        tone.addColorStop(0, 'rgba(74, 98, 106, 0.7)')
        tone.addColorStop(1, 'rgba(50, 72, 80, 0.9)')
      } else {
        tone.addColorStop(0, 'rgba(40, 60, 64, 0.95)')
        tone.addColorStop(1, 'rgba(20, 34, 38, 1)')
      }
      ctx.fillStyle = tone
      ctx.fill()
      // 逆光的地面轮廓：脊线上一条极淡的暖光
      if (ridge < 2) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = `rgba(255, 236, 196, ${(0.1 - depth * 0.04).toFixed(3)})`
        ctx.lineWidth = 1.3
        ctx.stroke()
        ctx.restore()
      }
    }

    // ---------- 光尘：静态一部分 ----------
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 150; i += 1) {
      const px = rand(0, w)
      const py = rand(0, h)
      const pr = rand(2, 7)
      const blob = ctx.createRadialGradient(px, py, 0, px, py, pr)
      blob.addColorStop(0, `rgba(255, 246, 216, ${rand(0.04, 0.14).toFixed(3)})`)
      blob.addColorStop(1, 'rgba(255, 246, 216, 0)')
      ctx.fillStyle = blob
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2)
    }
    ctx.restore()

    paintVignette(ctx, w, h, 0.14)
    paintGrain(ctx, w, h, 0.018, true)
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      moteSprite = makeSoftDot([255, 248, 220], 64, 2.6)
      sparkleSprite = makeSparkleSprite(255, 252, 232, 96)
      glowSprite = makeSoftDot([255, 240, 200], 256, 2.2)
      // 光轴上的冰晶光环（六边形感）：用两道同心环近似
      flareRing = paint(96, 96, (ctx) => {
        const ring = ctx.createRadialGradient(48, 48, 26, 48, 48, 46)
        ring.addColorStop(0, 'rgba(255, 226, 180, 0)')
        ring.addColorStop(0.74, 'rgba(255, 226, 186, 0.3)')
        ring.addColorStop(0.86, 'rgba(255, 250, 235, 0.14)')
        ring.addColorStop(1, 'rgba(255, 226, 180, 0)')
        ctx.fillStyle = ring
        ctx.fillRect(0, 0, 96, 96)
      })
      flareDot = makeSoftDot([255, 236, 200], 96, 2.4)
      // 太阳的星芒（四芒，横向更长，模拟镜头的光圈叶片）
      burstSprite = paint(512, 256, (ctx) => {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const beam = (horizontal: boolean) => {
          const gradient = horizontal
            ? ctx.createLinearGradient(0, 128, 512, 128)
            : ctx.createLinearGradient(256, 0, 256, 256)
          gradient.addColorStop(0, 'rgba(255, 244, 214, 0)')
          gradient.addColorStop(0.5, 'rgba(255, 246, 220, 0.5)')
          gradient.addColorStop(1, 'rgba(255, 244, 214, 0)')
          ctx.fillStyle = gradient
          if (horizontal) ctx.fillRect(0, 126, 512, 4)
          else ctx.fillRect(254, 0, 4, 256)
        }
        beam(true)
        beam(false)
        ctx.restore()
      })
      background = paintBackground(w, h, buildSky)
      motes = []
      resizeList(motes, target, spawnMote)
    },
    configure(values) {
      brightness = (values.brightness ?? 60) / 100
      drift = (values.drift ?? 35) / 100
      flareAmount = (values.flare ?? 45) / 100
      rayAmount = (values.rays ?? 50) / 100
      const nextCover = (values.motes ?? 40) / 100
      const density = (values.motes ?? 40) / 100
      target = Math.round(density * 90 * areaFactor(width, height))
      resizeList(motes, target, spawnMote)
      if (Math.abs(nextCover - cloudCover) > 0.06) {
        cloudCover = nextCover
        background = paintBackground(width, height, buildSky)
      }
    },
    step(dt) {
      time += dt
      hazeShift += dt * (0.004 + drift * 0.01)
      const rise = (5 + drift * 24) * dt
      for (const mote of motes) {
        mote.phase += dt * (0.5 + drift * 1.3)
        mote.y -= rise * mote.rise
        mote.x += Math.sin(mote.phase) * 7 * dt
        if (mote.y < -20) {
          mote.y = height + 20
          mote.x = rand(0, width)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      // 云层极缓慢地平移（两层反向漂移，云就有了「活」的感觉）
      if (cloudLayer && cloudSoft) {
        ctx.save()
        const shift = ((hazeShift % 1) + 1) % 1
        ctx.globalAlpha = 0.5
        ctx.drawImage(cloudSoft, -width * 0.08 - shift * width * 0.06, -height * 0.02, width * 1.16, height * 0.8)
        ctx.globalAlpha = 0.32
        ctx.drawImage(cloudLayer, width * 0.1 - shift * width * 0.1, height * 0.02, width, height * 0.72)
        ctx.restore()
      }

      // 太阳的柔和辉光与横向星芒（随「镜头光斑」参数变化）
      if (glowSprite) {
        const size = Math.max(width, height) * (0.34 + brightness * 0.16)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.12 + brightness * 0.16, 0, 0.36)
        ctx.drawImage(glowSprite, sun.x - size / 2, sun.y - size / 2, size, size)
        ctx.restore()
      }
      if (burstSprite) {
        const bw = Math.max(width, height) * (0.55 + brightness * 0.3)
        const bh = bw * 0.5
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp((0.07 + brightness * 0.15) * (0.5 + rayAmount), 0, 0.34)
        ctx.drawImage(burstSprite, sun.x - bw / 2, sun.y - bh / 2, bw, bh)
        ctx.restore()
      }

      // 镜头光斑：沿太阳 → 画面中心的轴分布
      if (flareAmount > 0.03) {
        const cx = width / 2
        const cy = height / 2
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const flare of flares) {
          const fx = sun.x + (cx - sun.x) * flare.t
          const fy = sun.y + (cy - sun.y) * flare.t
          const sprite = flare.ring ? flareRing : flareDot
          if (!sprite) continue
          const pulse = 0.88 + 0.12 * Math.sin(time * 1.1 + flare.t * 6)
          ctx.globalAlpha = clamp(flare.alpha * flareAmount * 2.2 * pulse, 0, 0.5)
          const size = flare.size * (0.85 + brightness * 0.5)
          ctx.drawImage(sprite, fx - size / 2, fy - size / 2, size, size)
        }
        ctx.restore()
      }

      // 光尘：柔和小点，少数带星芒
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const mote of motes) {
        const pulse = 0.6 + 0.4 * Math.sin(mote.phase)
        const alpha = clamp(mote.alpha * (0.3 + brightness * 0.45) * pulse, 0, 0.75)
        if (alpha <= 0.01) continue
        ctx.globalAlpha = alpha
        if (mote.twinkle && sparkleSprite) {
          const size = mote.size * 14
          ctx.globalAlpha = alpha * 0.85
          ctx.drawImage(sparkleSprite, mote.x - size / 2, mote.y - size / 2, size, size)
        } else if (moteSprite) {
          const size = mote.size * 11
          ctx.drawImage(moteSprite, mote.x - size / 2, mote.y - size / 2, size, size)
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 星空 -------------------------------- */

/**
 * 星空参考真实银河摄影：
 *  - 银河是一条有分形结构的斜向亮带，里面既有密集的暗弱小星，也有暗尘带（把星光「吸掉」的区域）；
 *  - 星云用 fbm 噪声生成真正的云絮形状，而不是几个模糊的圆；
 *  - 星星亮度服从幂律（大量极暗 + 少数亮星），亮星带十字星芒与色温差异；
 *  - 地面加一层起伏的山脊剪影作锚点，画面立刻有了纵深。
 *
 * 远景（天空、银河、星云、山脊）全部烘焙进一张贴图；逐帧只画会闪烁的亮星、流星与流星的辉光。
 */
function createStars(): Renderer {
  interface Star {
    x: number
    y: number
    size: number
    phase: number
    speed: number
    base: number
    tint: number
    layer: number
    spike: boolean
  }
  interface Meteor {
    x: number
    y: number
    vx: number
    vy: number
    life: number
    maxLife: number
    size: number
    hue: number
  }
  const TINTS: [number, number, number][] = [
    [214, 226, 255],
    [255, 255, 255],
    [186, 208, 255],
    [255, 238, 214],
    [255, 214, 196],
  ]
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let starSprites: HTMLCanvasElement[] = []
  let spikes: HTMLCanvasElement | null = null
  let meteorGlow: HTMLCanvasElement | null = null
  let meteorStreak: HTMLCanvasElement | null = null
  let stars: Star[] = []
  let meteors: Meteor[] = []
  let twinkle = 0.5
  let meteorRate = 0.3
  let brightness = 0.6
  let nebula = 0.45
  let target = 0
  let driftTime = 0
  let bakedDensity = -1
  let bakedBrightness = -1
  let bakedNebula = -1
  const defer = createDeferred()
  let time = 0

  /** 幂律分布：大量暗星 + 少数亮星，和真实星等分布一致 */
  const starMagnitude = () => Math.pow(Math.random(), 3.1)

  const spawnStar = (): Star => {
    const mag = starMagnitude()
    const layer = Math.random()
    return {
      x: rand(0, width),
      y: rand(0, height * 0.94),
      size: 0.7 + mag * 2.6 + (layer > 0.9 ? 0.6 : 0),
      phase: rand(0, TAU),
      speed: rand(0.4, 1.9),
      base: 0.32 + mag * 0.68,
      tint: Math.floor(rand(0, TINTS.length)),
      layer,
      spike: mag > 0.74,
    }
  }

  const buildSky = (ctx: CanvasRenderingContext2D) => {
    const w = width
    const h = height
    const horizon = h * 0.86
    const noise = makeNoise2D(90210)

    // ---------- 天幕底色：从「天顶近黑」到「地平线深蓝」 ----------
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#02030a')
    sky.addColorStop(0.42, '#04071a')
    sky.addColorStop(0.72, '#070d26')
    sky.addColorStop(1, '#0d1636')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    // ---------- 银河：一条斜向的分形亮带 + 暗尘 ----------
    // 半分辨率烘焙再放大：逐像素的 fbm 很贵，减半后成本只有 1/4，观感几乎无差
    const halfW = Math.max(32, Math.round(w * 0.36))
    const halfH = Math.max(24, Math.round(h * 0.36))
    const bandCanvas = paint(halfW, halfH, (c) => {
      const image = c.createImageData(halfW, halfH)
      const angle = -0.42
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const cx = halfW * 0.5
      const cy = halfH * 0.52
      const widthBand = Math.max(halfW, halfH) * 0.19
      for (let y = 0; y < halfH; y += 1) {
        for (let x = 0; x < halfW; x += 1) {
          const dx = x - cx
          const dy = y - cy
          const u = dx * cos - dy * sin
          const v = dx * sin + dy * cos
          const t = Math.abs(v) / widthBand
          const index = (y * halfW + x) * 4
          if (t > 1.6) {
            image.data[index + 3] = 0
            continue
          }
          const profile = Math.exp(-t * t * 4.2)
          const along = u / Math.max(halfW, halfH)
          const clumps = noise.fbm(along * 6.4 + 5.2, t * 2.1 + 1.7, 4, 0.55)
          const dust = noise.fbm(along * 11.5 + 11.4, t * 3.4 + 3.1, 4, 0.62)
          // 暗尘带：把一部分星光「吸掉」，星空的层次感主要来自这里
          const dustMask = clamp(1 - Math.pow(clamp((dust - 0.38) * 4.2, 0, 1), 1.2), 0, 1)
          const strength = profile * (0.32 + clumps * 1.15) * dustMask
          if (strength <= 0.01) {
            image.data[index + 3] = 0
            continue
          }
          // 银心偏暖，边缘偏蓝
          const warm = clamp(strength * 1.5 + 0.1, 0, 1)
          image.data[index] = 150 + warm * 90
          image.data[index + 1] = 158 + warm * 60
          image.data[index + 2] = 190 + warm * 20
          image.data[index + 3] = Math.round(clamp(strength * 132 * (0.5 + nebula * 1.1), 0, 255))
        }
      }
      c.putImageData(image, 0, 0)
    })
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.5
    ctx.drawImage(soften(bandCanvas, 2), 0, 0, w, h)
    ctx.globalAlpha = 0.5
    ctx.drawImage(bandCanvas, 0, 0, w, h)
    ctx.restore()

    // 银河里的密集暗弱小星（沿带撒点，越靠带中心越密）
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const milkyCount = Math.round(3400 * areaFactor(w, h))
    for (let i = 0; i < milkyCount; i += 1) {
      const u = rand(-0.62, 0.62)
      const spread = Math.pow(Math.random(), 0.6) * 0.5
      const v = (Math.random() < 0.5 ? -1 : 1) * spread
      const bx = u * w
      const by = v * h
      const x = w * 0.5 + bx * Math.cos(-0.42) + by * Math.sin(-0.42)
      const y = h * 0.52 - bx * Math.sin(-0.42) + by * Math.cos(-0.42)
      if (x < 0 || x > w || y < 0 || y > h) continue
      const a = rand(0.05, 0.4) * clamp(1 - spread * 1.7, 0, 1) * (0.5 + nebula)
      ctx.fillStyle = `rgba(224, 234, 255, ${a.toFixed(3)})`
      const size = Math.random() < 0.08 ? rand(1, 1.7) : rand(0.35, 0.8)
      ctx.fillRect(x, y, size, size)
    }
    ctx.restore()

    // ---------- 彩色星云：fbm 形状 + 色彩分层 ----------
    // 星云放在远离银河带的角落，否则会把银河「糊」掉
    const nebulae: { x: number; y: number; scale: number; color: [number, number, number]; strength: number }[] = [
      { x: w * 0.13, y: h * 0.17, scale: 2.2, color: [104, 70, 216], strength: 0.3 },
      { x: w * 0.87, y: h * 0.74, scale: 2.6, color: [40, 108, 200], strength: 0.26 },
      { x: w * 0.48, y: h * 0.07, scale: 2.4, color: [196, 72, 150], strength: 0.2 },
    ]
    for (const item of nebulae) {
      const radius = Math.max(w, h) * 0.26
      const cloud = paint(radius, radius, (c) => {
        const size = Math.round(radius)
        const image = c.createImageData(size, size)
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const nx = (x / size) * item.scale
            const ny = (y / size) * item.scale
            const density = noise.fbm(nx + item.scale * 3.7, ny + item.scale * 1.9, 4, 0.58)
            const dx = (x / size - 0.5) * 2
            const dy = (y / size - 0.5) * 2
            const falloff = clamp(1 - Math.sqrt(dx * dx + dy * dy), 0, 1)
            const value = clamp((density - 0.44) * 2.6, 0, 1) * Math.pow(falloff, 1.6)
            const index = (y * size + x) * 4
            image.data[index] = item.color[0]
            image.data[index + 1] = item.color[1]
            image.data[index + 2] = item.color[2]
            image.data[index + 3] = Math.round(value * 120 * item.strength * (0.35 + nebula * 1.1))
          }
        }
        c.putImageData(image, 0, 0)
      })
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(soften(cloud, 2), item.x - radius / 2, item.y - radius / 2, radius, radius)
      ctx.restore()
    }

    // ---------- 静态星场：远景暗星一次画好，逐帧零成本 ----------
    const staticCount = Math.round(Math.max(0, bakedDensity) * 420 * areaFactor(w, h))
    const glowScale = bakedBrightness > 0 ? clamp(0.45 + bakedBrightness * 0.75, 0.2, 1.1) : 1
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < staticCount; i += 1) {
      const px = rand(0, w)
      const py = rand(0, h * 0.94)
      const mag = starMagnitude()
      const size = 0.45 + mag * 1.5
      const alpha = rand(0.16, 0.55) * (0.5 + mag) * glowScale
      const [r, g, b] = TINTS[Math.floor(rand(0, TINTS.length))]
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`
      ctx.fillRect(px, py, size, size)
      if (mag > 0.86) {
        const halo = size * 7
        ctx.globalAlpha = clamp(alpha * 0.6, 0, 1)
        ctx.drawImage(starSprites[Math.floor(rand(0, starSprites.length))], px - halo / 2, py - halo / 2, halo, halo)
        ctx.globalAlpha = 1
      }
    }
    ctx.restore()

    // ---------- 地面：起伏的山脊剪影（让星空有落点） ----------
    const ridges = 3
    for (let ridge = 0; ridge < ridges; ridge += 1) {
      const depth = ridge / (ridges - 1)
      const baseY = horizon + (h - horizon) * depth * 0.7
      const amplitude = h * (0.02 + depth * 0.035)
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(0, baseY)
      const step = 26
      for (let x = 0; x <= w + step; x += step) {
        const y =
          baseY -
          noise.fbm(x * 0.0016 + ridge * 4.1, ridge * 2.3, 4, 0.5) * amplitude * 2.6 +
          Math.sin(x * 0.0021 + ridge) * amplitude * 0.5
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.fillStyle = ridge === ridges - 1 ? '#010206' : `rgba(2, 4, 12, ${(0.82 + depth * 0.16).toFixed(2)})`
      ctx.fill()
      // 山脊线上的一丝轮廓光：远山被地平线后面的光晕勾出边
      if (ridge < ridges - 1) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = `rgba(88, 122, 190, ${(0.055 - depth * 0.02).toFixed(3)})`
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.restore()
      }
    }

    paintVignette(ctx, w, h, 0.42)
    paintGrain(ctx, w, h, 0.04, true)
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      starSprites = TINTS.map(([r, g, b]) => makeSoftDot([r, g, b], 64, 2.8))
      spikes = makeSparkleSprite(255, 250, 240, 128)
      meteorGlow = makeSoftDot([206, 226, 255], 128, 2.4)
      // 彗尾：亮头 → 电离尾迹 → 全透明（横向，绘制时旋转）
      meteorStreak = paint(256, 20, (ctx) => {
        const body = ctx.createLinearGradient(0, 0, 256, 0)
        body.addColorStop(0, 'rgba(255,255,255,0)')
        body.addColorStop(0.55, 'rgba(186, 216, 255, 0.22)')
        body.addColorStop(0.9, 'rgba(226, 238, 255, 0.8)')
        body.addColorStop(1, 'rgba(255,255,255,1)')
        ctx.fillStyle = body
        ctx.fillRect(0, 8, 256, 4)
        const soft = ctx.createLinearGradient(0, 0, 256, 0)
        soft.addColorStop(0, 'rgba(170, 200, 255, 0)')
        soft.addColorStop(1, 'rgba(200, 226, 255, 0.42)')
        ctx.fillStyle = soft
        ctx.fillRect(0, 4, 256, 12)
        const head = ctx.createRadialGradient(250, 10, 0, 250, 10, 10)
        head.addColorStop(0, 'rgba(255,255,255,1)')
        head.addColorStop(0.55, 'rgba(232, 242, 255, 0.5)')
        head.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = head
        ctx.fillRect(238, 0, 20, 20)
      })
      bakedDensity = 1
      bakedBrightness = 1
      bakedNebula = -1
      background = paintBackground(w, h, buildSky)
      stars = []
      resizeList(stars, target, spawnStar)
    },
    configure(values) {
      twinkle = (values.twinkle ?? 50) / 100
      meteorRate = ((values.meteor ?? 30) / 100) * 0.2
      brightness = (values.brightness ?? 60) / 100
      const densityNorm = (values.density ?? 50) / 100
      const nextNebula = clamp((values.nebula ?? 45) / 100, 0, 1)
      // 逐帧只保留「会闪烁的亮星」，远景暗星在贴图里
      target = Math.round(densityNorm * 170 * areaFactor(width, height))
      resizeList(stars, target, spawnStar)
      const changed =
        Math.abs(nextNebula - bakedNebula) > 0.04 ||
        Math.abs(densityNorm - bakedDensity) > 0.05 ||
        Math.abs(brightness - bakedBrightness) > 0.08
      if (changed) {
        nebula = nextNebula
        bakedDensity = densityNorm
        bakedBrightness = brightness
        bakedNebula = nextNebula
        defer.mark()
      }
    },
    step(dt) {
      time += dt
      driftTime += dt
      for (const star of stars) {
        star.phase += dt * star.speed * (0.45 + twinkle)
        // 极缓慢的视差漂移，让星空「活」起来
        star.x -= dt * star.layer * 1.4
        if (star.x < -6) star.x = width + 6
      }
      if (meteorRate > 0 && Math.random() < meteorRate * dt) {
        const maxLife = rand(0.9, 1.6)
        meteors.push({
          x: rand(width * 0.25, width + 120),
          y: rand(-60, height * 0.4),
          vx: -rand(430, 780),
          vy: rand(190, 380),
          life: maxLife,
          maxLife,
          size: rand(0.7, 1.5),
          hue: rand(0, 1),
        })
      }
      for (const meteor of meteors) {
        meteor.x += meteor.vx * dt
        meteor.y += meteor.vy * dt
        meteor.life -= dt
      }
      meteors = meteors.filter((meteor) => meteor.life > 0 && meteor.y < height + 100)
    },
    draw(ctx) {
      if (defer.ready()) background = paintBackground(width, height, buildSky)
      if (background) ctx.drawImage(background, 0, 0, width, height)

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const star of stars) {
        const flicker = 0.62 + 0.38 * Math.sin(star.phase)
        const alpha = clamp(star.base * brightness * (0.55 + flicker * 0.65), 0, 1)
        if (alpha <= 0.01) continue
        const sprite = starSprites[star.tint]
        if (!sprite) continue
        ctx.globalAlpha = alpha
        const size = star.size * 7
        ctx.drawImage(sprite, star.x - size / 2, star.y - size / 2, size, size)
        if (star.spike && spikes) {
          const flare = star.size * 13
          ctx.globalAlpha = alpha * 0.55
          ctx.drawImage(spikes, star.x - flare / 2, star.y - flare / 2, flare, flare)
        }
      }

      // 流星：旋转的贴图彗尾 + 亮头光斑
      if (meteorStreak) {
        for (const meteor of meteors) {
          const fade = clamp(meteor.life / meteor.maxLife, 0, 1)
          const angle = Math.atan2(meteor.vy, meteor.vx)
          const length = 260 * meteor.size
          const thickness = 7 * meteor.size
          ctx.save()
          ctx.translate(meteor.x, meteor.y)
          ctx.rotate(angle)
          ctx.globalAlpha = fade * brightness * 1.25
          ctx.drawImage(meteorStreak, -length * 0.86, -thickness * 0.5, length, thickness)
          ctx.restore()
          if (meteorGlow) {
            const size = 30 * meteor.size
            ctx.globalAlpha = fade * brightness
            ctx.drawImage(meteorGlow, meteor.x - size / 2, meteor.y - size / 2, size, size)
          }
        }
      }
      ctx.restore()
      void driftTime
      void time
    },
  }
}

/* -------------------------------- 极光 -------------------------------- */

/**
 * 极光：按公开项目里常见的做法（低分辨率发光缓冲 → 模糊 → 叠加）重做。
 *
 * 参考的是「极光帘幕本质上是沿磁场线排列的一束束竖直光柱」这一物理事实：
 *  1. 在低分辨率缓冲上画帘幕——一条从西到东的波浪「底边」+ 每根光柱按高度着色
 *     （绿在低空最强，往上过渡到青、最上面是氧的红），透明度用 fbm 沿帘幕起伏；
 *  2. 把这张缓冲放大贴到天上，再叠一层放大模糊版本当辉光（bloom）；
 *  3. 加星空、地平线暗红辉光，以及湖面镜像倒影（竖向拉伸 + 波纹扰动 + 压暗）。
 *
 * 每帧只有个位数次的贴图绘制，观感却比「拿贴图切片平移」真实得多。
 */
function createAurora(): Renderer {
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let auroraLayer: HTMLCanvasElement | null = null
  let lake: HTMLCanvasElement | null = null
  let glowSprite: HTMLCanvasElement | null = null
  let stars: { x: number; y: number; r: number; phase: number; speed: number }[] = []
  let intensity = 0.7
  let flow = 0.5
  let layers = 3
  let rayAmount = 0.55
  let hueShift = 0
  let sceneKey = ''
  const defer = createDeferred()
  let time = 0

  const bands = (): number => clamp(Math.round(((layers - 1) / 7) * 3) + 2, 2, 5)

  /**
   * 烘焙一帧极光。
   *
   * 关键做法（参考「按高度发射 + 低分辨率发光缓冲」的思路）：
   *  1. 在很小的缓冲里逐像素计算发光量——沿帘幕方向的密度用 fbm 决定，
   *     竖直方向按高度着色（下缘主色 → 中部青 → 顶部红），下缘是一条锐利的亮边；
   *  2. 用 64 级 LUT 做颜色渐变，逐像素只剩纯算术，烘焙一次只要几毫秒；
   *  3. 累加后用 1 - exp(-E) 做色调映射，避免大量叠加「爆成白屏」；
   *  4. 放大贴到天上，再叠一层模糊副本做辉光（bloom）。
   */
  const buildScene = () => {
    const noise = makeNoise2D(4242)
    // 发光缓冲：很小，放大后天然柔和（相当于低通滤波）
    const pw = Math.max(64, Math.round(width * 0.17))
    const ph = Math.max(48, Math.round(height * 0.17))
    const horizonLow = height * 0.78 * (ph / height)
    const { rgb } = themeColors()
    const { h: baseHue, s: baseSat } = toHsl(rgb)
    const hueBase = baseHue + hueShift
    const count = bands()

    const acc = new Float32Array(pw * ph * 3)

    for (let layer = 0; layer < count; layer += 1) {
      const frac = count > 1 ? layer / (count - 1) : 0 // 0 = 最靠前的低帘幕
      // 每层的参数：底边高度、厚度、波浪、光柱频率、整体亮度
      const baseBottom = horizonLow * rand(0.8, 1.0) - frac * ph * 0.05
      const thickness = ph * rand(0.26, 0.52) * (1 - frac * 0.12)
      const waveAmp = ph * rand(0.025, 0.06)
      const waveFreq = rand(1.3, 2.9)
      const phase = rand(0, TAU)
      const gain = rand(0.5, 0.95) * (0.6 + intensity * 0.7) * (1 - frac * 0.2)
      // 真实极光下缘是氧的 557.7nm 青绿；这里把主题色相往青绿拉，既保留主题关联又有极光的味道
      const hue = mixHue(hueBase, 154, 0.62) + (frac - 0.5) * 26 - layer * 2
      const sat = clamp(baseSat * 0.7 + 0.35, 0.4, 0.95)
      const rayDensity = 34 + rayAmount * 170 * (1.2 - frac * 0.5)
      const lumpFreq = rand(2.4, 4.4)

      // 颜色 LUT：alt=0 在帘幕底缘，alt=1 在帘幕顶端
      const LUT = 48
      const rampR = new Float32Array(LUT)
      const rampG = new Float32Array(LUT)
      const rampB = new Float32Array(LUT)
      for (let i = 0; i < LUT; i += 1) {
        const alt = i / (LUT - 1)
        // 下缘主色 → 中段青 → 顶上偏红（氧原子的红光是真实极光里最高的那层）
        const hueAt = hue + 6 + Math.pow(alt, 1.15) * 96
        const light = 0.56 + alt * 0.12
        const [r, g, b] = hslToRgb(hueAt, clamp(sat * (1 - alt * 0.25), 0, 1), light)
        rampR[i] = r / 255
        rampG[i] = g / 255
        rampB[i] = b / 255
      }

      // 沿帘幕方向（只需算 pw 次，逐像素循环里只剩乘加）
      const bottomAt = new Float32Array(pw)
      const topAt = new Float32Array(pw)
      const stripAt = new Float32Array(pw)
      const lumpAt = new Float32Array(pw)
      for (let x = 0; x < pw; x += 1) {
        const u = x / pw
        const wobble =
          Math.sin(u * TAU * waveFreq + phase) * waveAmp +
          Math.sin(u * TAU * (waveFreq * 2.3) + phase * 1.7) * waveAmp * 0.4
        bottomAt[x] = baseBottom + wobble
        // 厚度沿帘幕起伏，形成「翻卷」的团块
        const thick = thickness * (0.62 + noise.fbm(u * lumpFreq + layer * 3.1, layer * 1.7, 3, 0.55) * 0.9)
        topAt[x] = bottomAt[x] - thick
        // 竖直光柱：高频噪声取幂，得到一根根疏密不均的射线
        const s1 = noise.noise(u * rayDensity + layer * 11.3, layer * 3.7)
        const s2 = noise.noise(u * rayDensity * 0.42 + 5.1, layer * 1.9)
        stripAt[x] = Math.pow(clamp(s1 * 0.72 + s2 * 0.42, 0, 1), 3.1) * (0.35 + s2 * 1.1)
        // 大尺度亮度：让某些段落整体更亮，读起来像极光在「翻卷」
        lumpAt[x] = clamp((noise.fbm(u * lumpFreq * 1.1 + layer * 2.3, layer * 0.9, 4, 0.6) - 0.3) * 1.8, 0, 1.4)
      }

      // 逐像素累加发光量（纯算术；alt 用整数 LUT 索引查色彩，避免每次调用哈希）
      for (let x = 0; x < pw; x += 1) {
        const bottom = bottomAt[x]
        const top = topAt[x]
        const yStart = Math.max(0, Math.floor(top))
        const yEnd = Math.min(ph - 1, Math.ceil(bottom))
        if (yEnd <= yStart) continue
        const invSpan = 1 / Math.max(1, bottom - top)
        const strip = stripAt[x] * lumpAt[x]
        if (strip <= 0.01) continue
        for (let y = yStart; y <= yEnd; y += 1) {
          const alt = (bottom - y) * invSpan
          if (alt < 0 || alt > 1) continue
          // 下缘锐利（极光底边最亮最硬）、上缘渐隐
          // 下缘锐利 → 中段最亮 → 顶部渐隐；再乘一个竖直遮罩，让帘幕上方自然融进夜空
          const edge = Math.min(1, alt / 0.06) * Math.pow(1 - alt, 0.6)
          const altitudeFade = Math.min(1, (bottom - y) / (thickness * 1.15))
          const energy = strip * gain * edge * (1 - altitudeFade * 0.55)
          if (energy <= 0.002) continue
          const index = Math.round(alt * (LUT - 1))
          const cell = (y * pw + x) * 3
          acc[cell] += energy * rampR[index]
          acc[cell + 1] += energy * rampG[index]
          acc[cell + 2] += energy * rampB[index]
        }
      }
    }

    const buffer = paint(pw, ph, (ctx) => {
      const image = ctx.createImageData(pw, ph)
      for (let i = 0; i < pw * ph; i += 1) {
        const r = acc[i * 3]
        const g = acc[i * 3 + 1]
        const b = acc[i * 3 + 2]
        if (r + g + b <= 0.002) continue
        // 色调映射：平滑压缩，绝不爆白
        image.data[i * 4] = Math.round((1 - Math.exp(-r * 1.15)) * 255)
        image.data[i * 4 + 1] = Math.round((1 - Math.exp(-g * 1.15)) * 255)
        image.data[i * 4 + 2] = Math.round((1 - Math.exp(-b * 1.15)) * 255)
        image.data[i * 4 + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
    })

    // ---------- 天空层：不透明，每帧先铺一遍（同时起到「清屏」作用） ----------
    background = paint(width, height, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.8)
      sky.addColorStop(0, '#01030b')
      sky.addColorStop(0.45, '#030818')
      sky.addColorStop(0.8, '#061024')
      sky.addColorStop(1, '#0a1730')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, width, height * 0.8)

      // 星空（烘焙，不闪烁）
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const starCount = Math.round(420 * areaFactor(width, height))
      for (let i = 0; i < starCount; i += 1) {
        const mag = Math.pow(Math.random(), 3)
        const size = 0.4 + mag * 1.6
        const alpha = rand(0.12, 0.6) * (0.5 + mag)
        ctx.fillStyle = `rgba(222, 234, 255, ${clamp(alpha, 0, 1).toFixed(3)})`
        ctx.fillRect(rand(0, width), rand(0, height * 0.74), size, size)
      }
      ctx.restore()

      // ---------- 地平线：远处氧的暗红辉光 + 冷色底光 ----------
      const horizon = height * 0.78
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const hGlow = ctx.createLinearGradient(0, horizon - height * 0.18, 0, horizon + 4)
      hGlow.addColorStop(0, 'rgba(20, 40, 70, 0)')
      hGlow.addColorStop(0.65, 'rgba(28, 74, 92, 0.14)')
      hGlow.addColorStop(1, 'rgba(104, 44, 74, 0.2)')
      ctx.fillStyle = hGlow
      ctx.fillRect(0, horizon - height * 0.18, width, height * 0.18 + 4)
      ctx.restore()

      // ---------- 地面剪影 ----------
      const ridgeNoise = makeNoise2D(777)
      ctx.beginPath()
      ctx.moveTo(0, height)
      ctx.lineTo(0, horizon)
      for (let x = 0; x <= width + 30; x += 26) {
        const y =
          horizon -
          ridgeNoise.fbm(x * 0.0012, 3.1, 4, 0.5) * height * 0.05 -
          Math.sin(x * 0.0016) * height * 0.008
        ctx.lineTo(x, y)
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      const ground = ctx.createLinearGradient(0, horizon - height * 0.05, 0, height)
      ground.addColorStop(0, '#03060f')
      ground.addColorStop(0.5, '#02040b')
      ground.addColorStop(1, '#010206')
      ctx.fillStyle = ground
      ctx.fill()

      paintVignette(ctx, width, height, 0.5)
      paintGrain(ctx, width, height, 0.04, true)
    })

    // ---------- 极光层：缓冲放大 + 模糊辉光（单独一层，方便逐帧做缩放/漂移） ----------
    const auroraHeight = Math.round(height * 1.02)
    auroraLayer = paint(width, auroraHeight, (ctx) => {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.5
      ctx.drawImage(soften(buffer, 2), 0, 0, width, auroraHeight)
      ctx.globalAlpha = 0.95
      ctx.drawImage(buffer, 0, 0, width, auroraHeight)
      ctx.restore()
    })

    // ---------- 湖面倒影：天空层的镜像，压暗 + 细条错位模拟波纹 ----------
    const mirrorBottom = height * 0.78
    const mirrorHeight = height - mirrorBottom
    const skyForMirror = paint(width, height, (ctx) => {
      ctx.drawImage(background as HTMLCanvasElement, 0, 0)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(auroraLayer as HTMLCanvasElement, 0, 0)
      ctx.restore()
    })
    const mirror = paint(width, mirrorHeight, (ctx) => {
      ctx.save()
      ctx.globalAlpha = 0.4
      ctx.drawImage(
        skyForMirror,
        0, mirrorBottom - mirrorHeight, width, mirrorHeight,
        0, 0, width, mirrorHeight,
      )
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'multiply'
      const shade = ctx.createLinearGradient(0, 0, 0, mirrorHeight)
      shade.addColorStop(0, 'rgba(96, 116, 152, 1)')
      shade.addColorStop(0.5, 'rgba(48, 62, 96, 1)')
      shade.addColorStop(1, 'rgba(16, 22, 44, 1)')
      ctx.fillStyle = shade
      ctx.fillRect(0, 0, width, mirrorHeight)
      ctx.restore()
    })
    lake = paint(width, mirrorHeight, (ctx) => {
      ctx.drawImage(mirror, 0, 0)
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      const ripples = 60
      for (let i = 0; i < ripples; i += 1) {
        const y = (i / ripples) * mirrorHeight
        const h2 = mirrorHeight / ripples
        const shift = Math.sin(i * 1.7) * width * 0.005
        ctx.globalAlpha = 0.45
        ctx.drawImage(mirror, 0, y, width, h2, shift, y, width, h2)
      }
      ctx.restore()
    })
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      sceneKey = ''
      glowSprite = makeSoftDot([124, 206, 190], 256, 2.2)
      stars = Array.from({ length: 40 }, () => ({
        x: rand(0, w),
        y: rand(0, h * 0.6),
        r: rand(0.6, 1.6),
        phase: rand(0, TAU),
        speed: rand(0.5, 1.6),
      }))
      buildScene()
    },
    configure(values) {
      intensity = (values.intensity ?? 70) / 100
      flow = (values.flow ?? 50) / 100
      layers = ((values.layers ?? 50) / 100) * 9
      rayAmount = (values.rays ?? 55) / 100
      hueShift = (values.hue ?? 0) * 1.4
      const key = [
        Math.round(intensity * 20),
        Math.round(layers),
        Math.round(rayAmount * 20),
        Math.round(hueShift),
        themeColors().accent,
        Math.round(width),
        Math.round(height),
      ].join('|')
      if (key !== sceneKey) {
        sceneKey = key
        defer.mark()
      }
    },
    step(dt) {
      time += dt
      for (const star of stars) star.phase += dt * star.speed
    },
    draw(ctx) {
      if (defer.ready()) buildScene()
      if (!background) return
      const horizon = height * 0.78
      // 先铺不透明天空：既是背景，也负责清掉上一帧的内容
      ctx.drawImage(background, 0, 0, width, height)

      if (auroraLayer) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        // 帘幕缓慢「呼吸」+ 横向漂移：两拷贝交替平移，观感像极光在流动
        const drift = (Math.sin(time * 0.05) * 0.5 + 0.5) * 0.06
        const scale = 1 + (0.012 + flow * 0.02) * Math.sin(time * 0.11)
        const breathe = 0.9 + 0.1 * Math.sin(time * 0.23)
        ctx.globalAlpha = clamp(breathe, 0.7, 1)
        ctx.translate(width / 2, horizon)
        ctx.scale(scale, scale)
        ctx.translate(-width / 2, -horizon)
        ctx.drawImage(auroraLayer, -drift * width, 0)
        ctx.drawImage(auroraLayer, width - drift * width, 0)
        ctx.restore()
      }

      // 倒影：整体随水面轻微晃动，亮度由辉光强度控制
      if (lake) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.28 + intensity * 0.34, 0, 0.75)
        const sway = Math.sin(time * 0.4) * width * 0.004
        ctx.drawImage(lake, sway, height * 0.78, width, height - horizon)
        ctx.restore()
      }

      // 极光在地平线上的整体辉光（fbm 贴图，缓慢呼吸）
      if (glowSprite) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.3)
        const size = width * (0.9 + pulse * 0.25)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.05 + intensity * 0.12, 0, 0.3)
        ctx.drawImage(glowSprite, width * 0.5 - size / 2, horizon - size / 2, size, size)
        ctx.restore()
      }

      // 星星闪烁（前景层，画在极光之上，避免被极光盖住）
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const star of stars) {
        const twinkleAlpha = clamp(0.25 + 0.55 * Math.sin(star.phase), 0, 1)
        ctx.globalAlpha = twinkleAlpha * clamp(0.4 + intensity * 0.5, 0, 1)
        ctx.fillStyle = 'rgba(226, 238, 255, 1)'
        ctx.fillRect(star.x, star.y, star.r, star.r)
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 樱花 -------------------------------- */

function createSakura(): Renderer {
  interface Petal {
    x: number
    y: number
    size: number
    depth: number
    angle: number
    spin: number
    fall: number
    sway: number
    phase: number
    alpha: number
    sprite: number
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let sprites: HTMLCanvasElement[] = []
  let petals: Petal[] = []
  let target = 40
  let speed = 50
  let wind = 15
  let sizeScale = 50
  let bokehAmount = 0.45
  let bokehSprites: HTMLCanvasElement[] = []
  let gust = 0

  const spawn = (fromTop = false): Petal => {
    const depth = Math.random()
    return {
      x: rand(-60, width + 60),
      y: fromTop ? rand(-height * 0.4, -20) : rand(-height * 0.2, height),
      size: (0.28 + depth * 0.8) * (0.55 + sizeScale / 100),
      depth,
      angle: rand(0, TAU),
      spin: rand(-1.6, 1.6) * (0.6 + depth * 0.8),
      fall: 0.35 + depth * 0.95,
      sway: rand(12, 42),
      phase: rand(0, TAU),
      alpha: clamp(0.3 + depth * 0.6, 0.22, 0.96),
      // 越近的花瓣越清晰，越远越模糊（三档预渲染贴图）
      sprite: depth > 0.72 ? 0 : depth > 0.38 ? 1 : 2,
    }
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      const base = paint(64, 64, (ctx) => {
        const gradient = ctx.createLinearGradient(12, 6, 52, 58)
        gradient.addColorStop(0, 'rgba(255, 226, 238, 0.99)')
        gradient.addColorStop(0.45, 'rgba(250, 176, 205, 0.97)')
        gradient.addColorStop(1, 'rgba(226, 118, 165, 0.94)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(32, 5)
        ctx.bezierCurveTo(54, 13, 58, 40, 32, 59)
        ctx.bezierCurveTo(6, 40, 10, 13, 32, 5)
        ctx.closePath()
        ctx.fill()
        // 花瓣的浅色纹路与小缺口
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(32, 10)
        ctx.lineTo(30, 52)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
        ctx.beginPath()
        ctx.moveTo(32, 16)
        ctx.quadraticCurveTo(22, 26, 20, 36)
        ctx.moveTo(32, 16)
        ctx.quadraticCurveTo(42, 26, 44, 36)
        ctx.stroke()
      })
      sprites = [base, blurCanvas(base, 2), blurCanvas(base, 4)]
      bokehSprites = [
        makeBokehSprite(255, 236, 244, 128, 0.4),
        makeBokehSprite(255, 214, 232, 128, 0.35),
        makeBokehSprite(255, 246, 236, 128, 0.3),
      ]
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, w * 0.6, h)
        sky.addColorStop(0, '#fffafc')
        sky.addColorStop(0.5, '#fdf0f5')
        sky.addColorStop(1, '#f8e6ef')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const warm = ctx.createRadialGradient(w * 0.2, h * 0.12, 0, w * 0.2, h * 0.12, Math.max(w, h) * 0.8)
        warm.addColorStop(0, 'rgba(255, 232, 210, 0.9)')
        warm.addColorStop(0.5, 'rgba(255, 226, 236, 0.35)')
        warm.addColorStop(1, 'rgba(255, 226, 236, 0)')
        ctx.fillStyle = warm
        ctx.fillRect(0, 0, w, h)
        // 远处的花枝与花簇：柔和的粉色团块，给画面加一层「景深」
        const clusters: [number, number, number][] = [
          [w * 0.06, h * 0.1, Math.min(w, h) * 0.26],
          [w * 0.94, h * 0.06, Math.min(w, h) * 0.22],
          [w * 0.28, h * 0.02, Math.min(w, h) * 0.16],
          [w * 0.72, h * 0.16, Math.min(w, h) * 0.12],
        ]
        for (const [cx, cy, radius] of clusters) {
          for (let i = 0; i < 26; i += 1) {
            const a = rand(0, TAU)
            const d = Math.sqrt(Math.random()) * radius
            const px = cx + Math.cos(a) * d
            const py = cy + Math.sin(a) * d * 0.6
            const pr = rand(6, 20) * (1 - d / radius / 2)
            const blob = ctx.createRadialGradient(px, py, 0, px, py, pr)
            blob.addColorStop(0, `rgba(255, 216, 232, ${rand(0.14, 0.34).toFixed(3)})`)
            blob.addColorStop(1, 'rgba(255, 216, 232, 0)')
            ctx.fillStyle = blob
            ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2)
          }
        }
        ctx.restore()
        paintVignette(ctx, w, h, 0.16)
        paintGrain(ctx, w, h, 0.04, true)
      })
      petals = []
      resizeList(petals, target, () => spawn())
    },
    configure(values) {
      speed = values.speed ?? 50
      wind = values.wind ?? 15
      sizeScale = values.size ?? 50
      bokehAmount = (values.bokeh ?? 45) / 100
      target = Math.round(((values.count ?? 40) / 100) * 130 * areaFactor(width, height))
      resizeList(petals, target, () => spawn())
    },
    step(dt) {
      gust += dt * 0.35
      const gustFactor = 0.75 + 0.45 * Math.sin(gust) * Math.sin(gust * 0.37)
      const drift = (wind / 100) * 90 * gustFactor
      for (const petal of petals) {
        petal.phase += dt * (0.8 + petal.depth)
        petal.angle += petal.spin * dt * 0.8
        petal.y += petal.fall * (14 + (speed / 100) * 60) * dt
        petal.x += (drift + Math.sin(petal.phase) * petal.sway) * dt
        if (petal.y > height + 70 || petal.x > width + 90 || petal.x < -90) {
          Object.assign(petal, spawn(true))
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      // 背景散景：像逆光下的光斑，随花瓣一起慢慢飘
      if (bokehAmount > 0.03) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < bokehSprites.length; i += 1) {
          const sprite = bokehSprites[i]
          const phase = gust * (0.2 + i * 0.05)
          const bx = ((Math.sin(phase) * 0.5 + 0.5) * 1.2 - 0.1) * width
          const by = height * (0.2 + i * 0.26) + Math.sin(phase * 1.7) * 24
          const size = Math.min(width, height) * (0.5 + i * 0.16)
          ctx.globalAlpha = clamp(bokehAmount * (0.34 - i * 0.08), 0, 1)
          ctx.drawImage(sprite, bx - size / 2, by - size / 2, size, size)
        }
        ctx.restore()
      }

      ctx.save()
      for (const petal of petals) {
        const sprite = sprites[petal.sprite]
        if (!sprite) continue
        const size = sprite.width * petal.size * 0.55
        // 翻转带来的明暗变化，让旋转更有立体感
        const flip = Math.cos(petal.angle)
        ctx.save()
        ctx.translate(petal.x, petal.y)
        ctx.rotate(petal.angle * 0.6)
        ctx.globalAlpha = clamp(petal.alpha * (0.72 + Math.abs(flip) * 0.28), 0, 1)
        const squeeze = 0.55 + Math.abs(flip) * 0.45
        ctx.drawImage(sprite, (-size * squeeze) / 2, -size / 2, size * squeeze, size)
        ctx.restore()
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 飘雪 -------------------------------- */

function createSnow(): Renderer {
  interface Flake {
    x: number
    y: number
    size: number
    depth: number
    phase: number
    sway: number
    fall: number
    alpha: number
    glint: boolean
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let bokeh: HTMLCanvasElement | null = null
  let soft: HTMLCanvasElement | null = null
  let sparkle: HTMLCanvasElement | null = null
  let flakes: Flake[] = []
  let target = 60
  let speed = 45
  let wind = 10
  let sizeScale = 50
  let glintAmount = 0.45
  let gust = 0

  const spawn = (fromTop = false): Flake => {
    const depth = Math.random()
    return {
      x: rand(-40, width + 40),
      y: fromTop ? rand(-height * 0.3, -14) : rand(-height * 0.15, height),
      size: (1.1 + depth * 3.6) * (0.5 + sizeScale / 100),
      depth,
      phase: rand(0, TAU),
      sway: rand(8, 38),
      fall: 0.4 + depth * 0.95,
      alpha: clamp(0.32 + depth * 0.55, 0.24, 0.95),
      glint: depth > 0.7 && Math.random() < 0.28,
    }
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      bokeh = makeBokehSprite(240, 248, 255, 128, 0.45)
      soft = makeGlowSprite(232, 242, 255, 96)
      sparkle = makeSparkleSprite(255, 255, 255, 64)
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, w * 0.5, h)
        sky.addColorStop(0, '#eef5fd')
        sky.addColorStop(0.45, '#f6fafe')
        sky.addColorStop(1, '#e7f0fa')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(w * 0.68, h * 0.16, 0, w * 0.68, h * 0.16, Math.max(w, h) * 0.72)
        halo.addColorStop(0, 'rgba(255, 255, 255, 0.96)')
        halo.addColorStop(0.35, 'rgba(255, 252, 240, 0.4)')
        halo.addColorStop(1, 'rgba(255, 252, 240, 0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, w, h)
        // 远处模糊的雪片：让画面有「下雪天」的空气感
        for (let i = 0; i < 120; i += 1) {
          const px = rand(0, w)
          const py = rand(0, h)
          const pr = rand(6, 26)
          const blob = ctx.createRadialGradient(px, py, 0, px, py, pr)
          blob.addColorStop(0, `rgba(255,255,255,${rand(0.08, 0.3).toFixed(3)})`)
          blob.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = blob
          ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2)
        }
        ctx.restore()
        // 底部积雪的柔和反光
        const ground = ctx.createLinearGradient(0, h * 0.82, 0, h)
        ground.addColorStop(0, 'rgba(255, 255, 255, 0)')
        ground.addColorStop(1, 'rgba(255, 255, 255, 0.75)')
        ctx.fillStyle = ground
        ctx.fillRect(0, h * 0.82, w, h * 0.18)
        paintVignette(ctx, w, h, 0.18)
        paintGrain(ctx, w, h, 0.04, true)
      })
      flakes = []
      resizeList(flakes, target, () => spawn())
    },
    configure(values) {
      speed = values.speed ?? 45
      wind = values.wind ?? 10
      sizeScale = values.size ?? 50
      glintAmount = (values.glint ?? 45) / 100
      target = Math.round(((values.density ?? 45) / 100) * 230 * areaFactor(width, height))
      resizeList(flakes, target, () => spawn())
    },
    step(dt) {
      gust += dt * 0.3
      const gustFactor = 0.7 + 0.5 * Math.sin(gust) * Math.sin(gust * 0.43)
      const drift = (wind / 100) * 70 * gustFactor
      for (const flake of flakes) {
        flake.phase += dt * (0.6 + flake.depth)
        flake.y += (10 + flake.fall * (speed / 100) * 62) * dt
        flake.x += (drift + Math.sin(flake.phase * 1.3) * flake.sway) * dt
        if (flake.y > height + 26 || flake.x > width + 70 || flake.x < -70) {
          Object.assign(flake, spawn(true))
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      for (const flake of flakes) {
        const twinkle = 0.7 + 0.3 * Math.sin(flake.phase * 1.6)
        ctx.globalAlpha = clamp(flake.alpha * twinkle, 0, 1)
        if (flake.depth > 0.78 && bokeh) {
          // 近处的雪花是虚化的大光斑
          const size = flake.size * 6.2
          ctx.drawImage(bokeh, flake.x - size / 2, flake.y - size / 2, size, size)
          if (flake.glint && sparkle && glintAmount > 0.05) {
            const glint = flake.size * 9
            ctx.globalAlpha = clamp(ctx.globalAlpha * glintAmount * 1.4, 0, 1)
            ctx.drawImage(sparkle, flake.x - glint / 2, flake.y - glint / 2, glint, glint)
          }
        } else if (flake.depth > 0.45 && soft) {
          const size = flake.size * 4.2
          ctx.drawImage(soft, flake.x - size / 2, flake.y - size / 2, size, size)
          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.beginPath()
          ctx.arc(flake.x, flake.y, flake.size * 0.62, 0, TAU)
          ctx.fill()
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.92)'
          ctx.beginPath()
          ctx.arc(flake.x, flake.y, flake.size * 0.6, 0, TAU)
          ctx.fill()
        }
      }
      ctx.restore()
    },
  }
}

/* ------------------------------ 粒子星链 ------------------------------ */

function createNetwork(): Renderer {
  interface Node {
    x: number
    y: number
    vx: number
    vy: number
    size: number
    phase: number
    pulse: number
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
  let background: HTMLCanvasElement | null = null
  let glow: HTMLCanvasElement | null = null
  let sparkle: HTMLCanvasElement | null = null
  let nodes: Node[] = []
  let packets: Packet[] = []
  let target = 60
  let linkDistance = 140
  let speed = 40
  let pulseAmount = 0.5
  let glowStrength = 0.55
  let accent: [number, number, number] = [90, 139, 255]
  let accent2: [number, number, number] = [160, 120, 255]
  const pointer = { x: -9999, y: -9999 }

  const spawn = (): Node => ({
    x: rand(0, width),
    y: rand(0, height),
    vx: rand(-1, 1),
    vy: rand(-1, 1),
    size: rand(0.8, 2.1),
    phase: rand(0, TAU),
    pulse: rand(0.6, 1.8),
  })

  const spawnPacket = (): Packet => ({
    from: Math.floor(Math.random() * Math.max(1, nodes.length)),
    to: Math.floor(Math.random() * Math.max(1, nodes.length)),
    t: 0,
    speed: rand(0.35, 1.1),
    color: Math.random() < 0.5 ? 0 : 1,
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      const colors = themeColors()
      accent = colors.rgb
      accent2 = hslToRgb(toHsl(colors.rgb).h + 40, 0.8, 0.62)
      // 64 像素的光晕贴图放大到几十像素时非常柔和，一张就够；不再另建大尺寸贴图
      glow = makeGlowSprite(colors.rgb[0], colors.rgb[1], colors.rgb[2], 64)
      sparkle = makeSparkleSprite(255, 255, 255, 64)
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#03060f')
        sky.addColorStop(0.6, '#070d1f')
        sky.addColorStop(1, '#0a1229')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        // 主题色星云 + 弥散的暗星
        const nebula = ctx.createRadialGradient(w * 0.3, h * 0.35, 0, w * 0.3, h * 0.35, Math.max(w, h) * 0.7)
        nebula.addColorStop(0, `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.2)`)
        nebula.addColorStop(0.6, `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.07)`)
        nebula.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = nebula
        ctx.fillRect(0, 0, w, h)
        for (let i = 0; i < 500 * areaFactor(w, h); i += 1) {
          const sx = rand(0, w)
          const sy = rand(0, h)
          ctx.fillStyle = `rgba(220, 235, 255, ${rand(0.05, 0.4).toFixed(3)})`
          const size = Math.random() < 0.05 ? 1.4 : 0.8
          ctx.fillRect(sx, sy, size, size)
        }
        // 远处的地平线辉光
        const horizon = ctx.createLinearGradient(0, h * 0.72, 0, h)
        horizon.addColorStop(0, 'rgba(0,0,0,0)')
        horizon.addColorStop(0.6, `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.1)`)
        horizon.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = horizon
        ctx.fillRect(0, h * 0.72, w, h * 0.28)
        ctx.restore()
        // 淡淡的技术网格
        ctx.strokeStyle = `rgba(${colors.rgb[0]},${colors.rgb[1]},${colors.rgb[2]},0.05)`
        ctx.lineWidth = 1
        for (let x = 0; x <= w; x += 64) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
          ctx.stroke()
        }
        for (let y = 0; y <= h; y += 64) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        paintVignette(ctx, w, h, 0.58)
        paintGrain(ctx, w, h, 0.05, true)
      })
      nodes = []
      packets = []
      resizeList(nodes, target, spawn)
    },
    configure(values) {
      linkDistance = 90 + ((values.link ?? 50) / 100) * 180
      speed = values.speed ?? 40
      pulseAmount = (values.pulse ?? 50) / 100
      glowStrength = (values.glow ?? 55) / 100
      target = Math.round(((values.density ?? 45) / 100) * 150 * areaFactor(width, height))
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
      const velocity = 6 + (speed / 100) * 36
      for (const node of nodes) {
        // 轻微聚拢到鼠标附近，鼠标离开后自然散开
        const dx = pointer.x - node.x
        const dy = pointer.y - node.y
        const distance = Math.hypot(dx, dy)
        if (distance < 240 && distance > 1) {
          node.vx += (dx / distance) * 3.4 * dt
          node.vy += (dy / distance) * 3.4 * dt
        }
        node.vx = clamp(node.vx, -2.2, 2.2)
        node.vy = clamp(node.vy, -2.2, 2.2)
        node.x += node.vx * velocity * dt
        node.y += node.vy * velocity * dt
        node.phase += dt * node.pulse
        if (node.x < -20) node.x = width + 20
        if (node.x > width + 20) node.x = -20
        if (node.y < -20) node.y = height + 20
        if (node.y > height + 20) node.y = -20
      }
      for (const packet of packets) {
        packet.t += dt * packet.speed
        if (packet.t >= 1) {
          packet.t = 0
          packet.from = Math.floor(Math.random() * Math.max(1, nodes.length))
          packet.to = Math.floor(Math.random() * Math.max(1, nodes.length))
          packet.speed = rand(0.35, 1.1)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const [r, g, b] = accent
      const [r2, g2, b2] = accent2

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      // 连线：越近越亮，并带一点主题色的偏移
      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        for (let j = i + 1; j < nodes.length; j += 1) {
          const other = nodes[j]
          const dx = other.x - node.x
          const dy = other.y - node.y
          const distanceSq = dx * dx + dy * dy
          if (distanceSq > linkDistance * linkDistance) continue
          const distance = Math.sqrt(distanceSq)
          const fade = 1 - distance / linkDistance
          ctx.strokeStyle = `rgba(${r},${g},${b},${(fade * 0.42).toFixed(3)})`
          ctx.beginPath()
          ctx.moveTo(node.x, node.y)
          ctx.lineTo(other.x, other.y)
          ctx.stroke()
        }
      }

      // 数据脉冲：沿线滑动的亮点
      for (const packet of packets) {
        const from = nodes[packet.from]
        const to = nodes[packet.to]
        if (!from || !to) continue
        const px = from.x + (to.x - from.x) * packet.t
        const py = from.y + (to.y - from.y) * packet.t
        const distance = Math.hypot(to.x - from.x, to.y - from.y)
        if (distance > linkDistance * 1.5) continue
        const trail = 0.14
        const tx = from.x + (to.x - from.x) * Math.max(0, packet.t - trail)
        const ty = from.y + (to.y - from.y) * Math.max(0, packet.t - trail)
        ctx.strokeStyle = packet.color ? `rgba(${r2},${g2},${b2},0.6)` : `rgba(${r},${g},${b},0.6)`
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(px, py)
        ctx.stroke()
        if (glow && glowStrength > 0.04) {
          const size = 22
          ctx.globalAlpha = 0.6 + 0.4 * glowStrength
          ctx.drawImage(glow, px - size / 2, py - size / 2, size, size)
          ctx.globalAlpha = 1
        }
      }

      // 节点：呼吸的光点，少数带星芒（鼠标旁的光圈已移除，这里只保留节点自身的辉光）
      for (const node of nodes) {
        const pulse = 0.7 + 0.3 * Math.sin(node.phase)
        const size = node.size * (5 + pulse * 4)
        if (glow && glowStrength > 0.04) {
          ctx.globalAlpha = 0.5 * glowStrength * pulse
          ctx.drawImage(glow, node.x - size / 2, node.y - size / 2, size, size)
        }
        if (sparkle && glowStrength > 0.04 && node.size > 1.6) {
          const flare = node.size * 14 * pulse
          ctx.globalAlpha = 0.5 * glowStrength * pulse
          ctx.drawImage(sparkle, node.x - flare / 2, node.y - flare / 2, flare, flare)
        }
        ctx.globalAlpha = 0.95
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.size * 0.55, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 海浪 -------------------------------- */

/**
 * 海浪：参考真实的海景摄影。
 *
 * 关键手法是「把每一层波峰烘焙成可横向循环的贴图，靠平移表现流动」：
 *  - 天空：暖色地平线 + fbm 云 + 低垂的太阳；
 *  - 海面：从地平线的亮青到近处的深蓝，中间有一条太阳在海面上的光路（碎光柱）；
 *  - 波浪：6 层波峰贴图（整数个波周期保证左右无缝），越近的层越大、越亮、流速越快，
 *          波峰上带白色的浪花与高光，形成真实的海浪层次；
 *  - 近景再加两道大浪与溅起的浪花。
 */
function createWaves(): Renderer {
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let seaTile: HTMLCanvasElement | null = null
  let seaNear: HTMLCanvasElement | null = null
  let glitter: HTMLCanvasElement | null = null
  let foamSprite: HTMLCanvasElement | null = null
  let amplitude = 0.5
  let speedScale = 0.6
  let foamAmount = 0.5
  let depthScale = 0.55
  let layerAmount = 0.5
  let hue = 205
  let time = 0
  let scrollA = 0
  let scrollB = 0
  const defer = createDeferred()

  /**
   * 海面贴图：一次把「整片海」按透视关系画进一张可横向无缝平铺的贴图。
   *
   * 关键是让浪脊保持「水平」，只随距离改变密度与振幅：
   *  - 每一行的相位只随 t 缓慢漂移（φ = t * 1.4），所以浪脊是近水平的，
   *    再叠一点点随机的行抖动，避免死板；
   *  - 波长与振幅随「离海平线的距离」急剧变化：远处又短又密、近乎平整，
   *    近处波长几百像素、振幅几十像素，浪脊上带白色浪花；
   *  - 近海那一层贴图的顶边做透明度渐变，和远海自然融合（没有硬边）。
   * 逐帧只是把贴图横向平移（两层速度不同），成本是两次 drawImage。
   */
  const buildSea = (pixelWidth: number, seaHeight: number, near: boolean): HTMLCanvasElement => {
    const pw = Math.max(64, Math.round(pixelWidth / 2))
    const ph = Math.max(32, Math.round(seaHeight / 2))
    const noise = makeNoise2D(near ? 6161 : 6262)
    return paint(pw, ph, (ctx) => {
      const image = ctx.createImageData(pw, ph)
      const targetHue = near ? hue - 5 : hue
      // 竖向的浪脊条数：远处多而密，近处少而宽
      const bands = near ? 8 : 16
      for (let y = 0; y < ph; y += 1) {
        const t = y / ph // 0 = 海平线，1 = 画面底部
        const lightness = (near ? 42 - t * 18 : 68 - Math.pow(t, 1.15) * 30) * (0.85 + layerAmount * 0.3)
        const sat = near ? 60 - t * 10 : 42 - t * 14
        // 近处的浪更高更暗、对比更强（透视：越近越「立体」）
        const contrast = (near ? 6 + t * 9 : 3 + t * 2.4) * (0.5 + amplitude)
        for (let x = 0; x < pw; x += 1) {
          const u = x / pw
          // 浪脊保持水平，只做缓慢的横向抖动，避免像条纹布
          const wobble =
            Math.sin(u * TAU + t * 1.7) * 0.5 +
            Math.sin(u * TAU * 3 - t * 2.3) * 0.22
          const phase = TAU * (t * bands + wobble * 0.08)
          const wave = 0.5 + 0.5 * Math.sin(phase)
          const crest = Math.pow(wave, 3.4)
          // 沿 x 把浪脊切成一段段「水面亮块」，而不是贯穿整屏的直线
          const patchMask = clamp((noise.fbm(u * 8.6 + 3.1, t * 4.3, 3, 0.55) - 0.4) * 2.3, 0, 1)
          // 细碎的水面皱褶：高频小振幅，负责「水感」
          const fine =
            Math.sin(TAU * (u * 26 + t * 11)) * 0.5 + Math.sin(TAU * (u * 15 - t * 6)) * 0.5
          const light =
            lightness +
            crest * contrast * (0.3 + patchMask * 0.85) +
            fine * (0.5 + t * 2.2) * (near ? 1 : 0.6)
          let foam = 0
          if (near) {
            const streak = noise.fbm(u * 6.4 + 1.3, t * 5.1, 3, 0.6)
            foam =
              clamp((crest - 0.5) * 2.1, 0, 1) *
              clamp(streak * 1.9 - 0.8, 0, 1) *
              patchMask *
              foamAmount *
              (0.25 + t * 0.9)
          }
          const index = (y * pw + x) * 4
          const mixFoam = foam * 0.9
          const [r, g, b] = hslToRgb(
            targetHue + (crest - 0.5) * 4,
            clamp((sat * (1 - mixFoam)) / 100, 0, 1),
            clamp((light + mixFoam * 50) / 100, 0, 1),
          )
          image.data[index] = r
          image.data[index + 1] = g
          image.data[index + 2] = b
          // 近海层顶边渐隐，和远海自然接上；远海层贴着海平线的两行也淡出
          const edgeFade = near ? clamp(t / 0.24, 0, 1) : 1
          const topFade = near ? 1 : clamp(t / 0.045, 0, 1)
          image.data[index + 3] = Math.round(255 * edgeFade * topFade)
        }
      }
      ctx.putImageData(image, 0, 0)
    })
  }

  const buildAll = () => {
    const horizon = height * 0.44
    const span = height - horizon
    seaTile = buildSea(width * 1.4, span, false)
    seaNear = buildSea(width * 1.1, span * 0.9, true)
  }

  const buildBackground = () => {
    const horizon = height * 0.44
    const w = width
    const h = height
    background = paintBackground(w, h, (ctx) => {
      const noise = makeNoise2D(8899)
      // ---------- 天空 ----------
      const sky = ctx.createLinearGradient(0, 0, 0, horizon)
      sky.addColorStop(0, `hsl(${hue + 14} 44% 66%)`)
      sky.addColorStop(0.42, `hsl(${hue + 8} 50% 77%)`)
      sky.addColorStop(0.78, `hsl(${hue + 2} 56% 86%)`)
      sky.addColorStop(1, `hsl(${hue - 6} 60% 92%)`)
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, horizon)

      // 低垂的层云
      const cw = Math.max(64, Math.round(w / 3))
      const ch = Math.max(32, Math.round(horizon / 2))
      const clouds = paint(cw, ch, (c) => {
        const image = c.createImageData(cw, ch)
        for (let y = 0; y < ch; y += 1) {
          const ny = y / ch
          const bandMask = clamp(1.2 - Math.abs(ny - 0.5) * 2.4, 0, 1)
          for (let x = 0; x < cw; x += 1) {
            const density = noise.fbm((x / cw) * 3.4 + 2.2, ny * 9.6 + 1.4, 5, 0.55)
            const shape = clamp((density - 0.55) * 4.6, 0, 1) * bandMask
            const index = (y * cw + x) * 4
            image.data[index] = 255
            image.data[index + 1] = 251
            image.data[index + 2] = 245
            image.data[index + 3] = Math.round(shape * 140)
          }
        }
        c.putImageData(image, 0, 0)
      })
      ctx.save()
      ctx.globalAlpha = 0.8
      ctx.drawImage(clouds, 0, 0, w, horizon * 0.85)
      ctx.restore()

      // ---------- 太阳：低垂在海平线上 ----------
      const sunX = w * 0.68
      const sunY = horizon * 0.5
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(w, h) * 0.34)
      sunGlow.addColorStop(0, 'rgba(255, 247, 218, 0.6)')
      sunGlow.addColorStop(0.16, 'rgba(255, 238, 190, 0.3)')
      sunGlow.addColorStop(0.45, 'rgba(255, 228, 184, 0.1)')
      sunGlow.addColorStop(1, 'rgba(255, 224, 192, 0)')
      ctx.fillStyle = sunGlow
      ctx.fillRect(0, 0, w, horizon)
      const sunDisc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.min(w, h) * 0.045)
      sunDisc.addColorStop(0, 'rgba(255, 252, 238, 0.9)')
      sunDisc.addColorStop(0.5, 'rgba(255, 244, 208, 0.34)')
      sunDisc.addColorStop(1, 'rgba(255, 232, 190, 0)')
      ctx.fillStyle = sunDisc
      ctx.fillRect(sunX - w * 0.2, sunY - w * 0.2, w * 0.4, w * 0.4)
      ctx.restore()

      // 海平线：被太阳点亮的一条极细亮线
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const line = ctx.createLinearGradient(0, horizon - h * 0.02, 0, horizon + h * 0.03)
      line.addColorStop(0, 'rgba(255, 246, 220, 0)')
      line.addColorStop(0.4, 'rgba(255, 240, 206, 0.16)')
      line.addColorStop(0.55, 'rgba(255, 248, 228, 0.3)')
      line.addColorStop(1, 'rgba(255, 242, 214, 0)')
      ctx.fillStyle = line
      ctx.fillRect(0, horizon - h * 0.02, w, h * 0.05)
      ctx.restore()

      // ---------- 太阳在海面上的碎光路 ----------
      const pw = Math.round(w / 3)
      const ph2 = Math.round((h - horizon) / 2)
      const path = paint(pw, ph2, (c) => {
        c.save()
        c.globalCompositeOperation = 'lighter'
        for (let y = 0; y < ph2; y += 1) {
          const t = y / ph2
          const spread = 0.05 + Math.pow(t, 1.6) * 0.5
          const alpha = (0.16 - t * 0.1) * (0.5 + amplitude * 0.7)
          if (alpha <= 0.006) continue
          const segs = 5 + Math.round(t * 16)
          for (let i = 0; i < segs; i += 1) {
            const u = (i / Math.max(1, segs - 1) - 0.5) * 2
            const x = pw * 0.5 + u * pw * spread * 0.5
            const segWidth = ((pw * spread) / segs) * rand(0.3, 1.2)
            c.fillStyle = `rgba(255, 248, 224, ${(alpha * rand(0.35, 1)).toFixed(3)})`
            c.fillRect(x - segWidth / 2, y, segWidth, 1)
          }
        }
        c.restore()
      })
      glitter = soften(path, 3)

      paintVignette(ctx, w, h, 0.18)
      paintGrain(ctx, w, h, 0.022, true)
    })
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      foamSprite = makeSoftDot([255, 255, 255], 64, 2.2)
      buildBackground()
      buildAll()
    },
    configure(values) {
      const nextAmplitude = (values.amplitude ?? 50) / 100
      const nextDepth = (values.depth ?? 55) / 100
      speedScale = (values.speed ?? 45) / 100
      foamAmount = (values.foam ?? 50) / 100
      const nextLayers = (values.layers ?? 50) / 100
      const changed =
        Math.abs(nextAmplitude - amplitude) > 0.04 ||
        Math.abs(nextDepth - depthScale) > 0.06 ||
        Math.abs(nextLayers - layerAmount) > 0.06
      amplitude = nextAmplitude
      depthScale = nextDepth
      layerAmount = nextLayers
      if (changed && height > 0) defer.mark()
    },
    step(dt) {
      time += dt
      const base = 26 * (0.35 + speedScale)
      scrollA = (scrollA + base * dt) % 2048
      scrollB = (scrollB + base * (1.9 + layerAmount) * dt) % 2048
    },
    draw(ctx) {
      if (defer.ready()) buildAll()
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const horizon = height * 0.44
      const span = height - horizon

      // 远处的海面：整片横向平移（两层错开速度，水面就有了流动感）
      if (seaTile) {
        const tileWidth = width * 1.4
        const heightScale = span * (0.92 + layerAmount * 0.16)
        let x = -(scrollA % tileWidth)
        for (let px = x - tileWidth; px < width + tileWidth; px += tileWidth) {
          ctx.drawImage(seaTile, px, horizon - span * 0.02, tileWidth, heightScale)
        }
      }

      // 太阳光路：叠在远海之上
      if (glitter) {
        const gw = width * 0.9
        const gh = span
        const shift = Math.sin(time * 0.32) * width * 0.014
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.24 + amplitude * 0.3, 0, 0.62)
        ctx.drawImage(glitter, width * 0.68 - gw * 0.5 + shift, horizon, gw, gh)
        ctx.globalAlpha *= 0.55
        ctx.drawImage(glitter, width * 0.68 - gw * 0.5 - shift * 1.8, horizon, gw * 1.2, gh)
        ctx.restore()
      }

      // 近处的浪：更大的波长与振幅、带白色浪花，速度更快
      if (seaNear) {
        const tileWidth = width * 1.1
        const nearHeight = span * (0.62 + layerAmount * 0.2)
        const bob = Math.sin(time * 0.5) * (2 + amplitude * 5)
        let x = -(scrollB % tileWidth)
        for (let px = x - tileWidth; px < width + tileWidth; px += tileWidth) {
          ctx.drawImage(seaNear, px, height - nearHeight + bob, tileWidth, nearHeight)
        }
      }

      // 近景浪尖炸开的泡沫
      if (foamSprite && foamAmount > 0.15) {
        const count = Math.round(2 + foamAmount * 5)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < count; i += 1) {
          const phase = (time / (5.5 + i) + i * 0.37) % 1
          const burst = Math.sin(phase * Math.PI)
          const x = ((i * 213 + time * (10 + i * 5) * (0.4 + speedScale)) % (width + 200)) - 100
          const y = horizon + (0.78 + (i % 3) * 0.07) * span + Math.sin(time * 0.85 + i) * 5
          const size = (20 + i * 9) * (0.6 + foamAmount) * (0.55 + burst * 0.75)
          ctx.globalAlpha = clamp(0.12 + foamAmount * 0.22, 0, 0.4) * burst
          ctx.drawImage(foamSprite, x - size / 2, y - size / 2, size, size)
        }
        ctx.restore()
      }
    },
  }
}

function createRenderer(scene: ActiveSceneId): Renderer {
  switch (scene) {
    case 'rain':
      return createRain()
    case 'sunshine':
      return createSunshine()
    case 'stars':
      return createStars()
    case 'aurora':
      return createAurora()
    case 'sakura':
      return createSakura()
    case 'snow':
      return createSnow()
    case 'network':
      return createNetwork()
    case 'waves':
      return createWaves()
  }
}

/* ------------------------------- 组件 -------------------------------- */

export function AnimatedBackdrop({ scene, values }: { scene: ActiveSceneId; values: SceneValues }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const valuesKey = JSON.stringify(values)
  // 始终保存最新参数，供窗口尺寸变化时的重建使用（避免回退到旧值）
  const valuesRef = useRef<SceneValues>(values)
  valuesRef.current = values

  // 场景切换：重新创建渲染器与动画循环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const renderer = createRenderer(scene)
    rendererRef.current = renderer

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let last = 0
    let width = 0
    let height = 0
    let resizeQueued = false

    const redraw = () => renderer.draw(ctx)
    redrawRef.current = redraw

    const sizeTo = () => {
      width = window.innerWidth
      height = window.innerHeight
      // 像素比上限 1.5：更高的分辨率对氛围画面的观感提升很小，但开销成倍增加
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // 先按视口尺寸铺设背景与粒子，再套用当前参数（粒子数量依赖面积）
      renderer.setup(width, height)
      renderer.configure(valuesRef.current)
      if (motion.matches) redraw()
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const interval = 1000 / renderer.fps
      if (last && now - last < interval - 1) return
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
      if (resizeQueued) return
      resizeQueued = true
      requestAnimationFrame(() => {
        resizeQueued = false
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
    if (typeof renderer.pointer === 'function') {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
    }

    sizeTo()
    start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    motion.addEventListener('change', onMotion)

    return () => {
      stop()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      motion.removeEventListener('change', onMotion)
      rendererRef.current = null
      redrawRef.current = null
    }
    // 参数变化由下面的 effect 增量处理，避免每次拖动滑块都重置动画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // 参数变化：增量更新粒子；减少动态效果时同步刷新静态画面
  useEffect(() => {
    rendererRef.current?.configure(valuesRef.current)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) redrawRef.current?.()
  }, [valuesKey])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  )
}
