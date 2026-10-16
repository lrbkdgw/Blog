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

/** 光柱：横向柔边、纵向均匀的色带，用来做湿路面上的拉长倒影（拉伸后不会断成一串珠子） */
function makeSoftColumn(rgb: [number, number, number], width = 64, height = 16): HTMLCanvasElement {
  return paint(width, height, (ctx) => {
    const image = ctx.createImageData(width, height)
    const [r, g, b] = rgb
    const half = width / 2
    for (let x = 0; x < width; x += 1) {
      const dx = Math.abs(x + 0.5 - half) / half
      const a = dx >= 1 ? 0 : Math.pow(1 - dx, 2.1)
      for (let y = 0; y < height; y += 1) {
        const dy = (y + 0.5) / height
        // 纵向只在两端各淡一点点，中间保持均匀
        const fade = Math.min(1, Math.min(dy, 1 - dy) * 6)
        const index = (y * width + x) * 4
        image.data[index] = r
        image.data[index + 1] = g
        image.data[index + 2] = b
        image.data[index + 3] = Math.round(a * fade * 255)
      }
    }
    ctx.putImageData(image, 0, 0)
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
 * 雨夜：参考真实的雨夜街拍重做。
 *
 * 参考照片的两个关键特征（此前都没抓到）：
 *  1. 是一条**单点透视的街道**——两侧楼体沿着透视线向消失点收拢，远处有城市灯光的辉光，
 *     而不是一排等高的剪影积木；
 *  2. 湿沥青上是被水波拉长、打断的**彩色光带**（青、洋红、琥珀），
 *     还有镜头前虚化的大颗散景光斑，整体色调偏青绿而非灰蓝。
 *
 * 静态的城市、街道、招牌与倒影全部烘焙进背景贴图；
 * 逐帧只画雨丝（两档 + 近景虚化）、倒影的轻微搅动和几颗散景。
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
    size: number
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
    kind: number
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
  let background: HTMLCanvasElement | null = null
  let skyOnly: HTMLCanvasElement | null = null
  let reflectionLayer: HTMLCanvasElement | null = null
  let cloudFlash: HTMLCanvasElement | null = null
  let softByWind: HTMLCanvasElement[] = []
  let nearByWind: HTMLCanvasElement[] = []
  let ringSprite: HTMLCanvasElement | null = null
  let splashSprite: HTMLCanvasElement | null = null
  let bokehSprites: HTMLCanvasElement[] = []
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

  /** 霓虹招牌的配色：青、洋红、琥珀、紫 */
  const NEON: [number, number, number][] = [
    [96, 226, 236],
    [238, 108, 196],
    [255, 188, 96],
    [168, 130, 246],
  ]
  /**
   * 倒影 / 招牌用的柔光精灵，按颜色预渲染缓存。
   * 注意：这些画布必须在 setup() 里一次性建好——绝不能在任何 paint 回调内部新建画布
   * （预览钻机的 canvas 代理会在回调里换掉绘制目标，踩过一次坑）。
   */
  const smearSprites = new Map<string, HTMLCanvasElement>()
  const buildSmearSprites = () => {
    smearSprites.clear()
    const palette: [number, number, number][] = [
      ...NEON,
      [255, 216, 166],
      [255, 92, 76],
      [255, 244, 220],
      [180, 216, 255],
    ]
    for (const color of palette) smearSprites.set(color.join(','), makeSoftColumn(color, 64, 16))
  }
  const smearFor = (color: [number, number, number]) =>
    smearSprites.get(color.join(',')) ?? (smearSprites.get('255,244,220') as HTMLCanvasElement)

  const spawnDrop = (near = false): Drop => {
    const depth = near ? rand(0.72, 1) : rand(0, 0.72)
    return {
      x: rand(-100, width + 100),
      y: rand(-height, height),
      len: 14 + depth * 42,
      speed: 0.55 + depth * 0.7,
      depth,
      alpha: (near ? 0.3 : 0.11) + depth * (near ? 0.5 : 0.28),
    }
  }
  // 散景：镜头前虚化的灯光，三种色温（青、琥珀、洋红），全都极淡
  const spawnBokeh = (): Bokeh => ({
    x: rand(0, width),
    y: rand(height * 0.25, height * 0.95),
    size: rand(16, 46),
    alpha: rand(0.02, 0.06),
    kind: Math.floor(rand(0, 3)),
    drift: rand(3, 12),
    phase: rand(0, TAU),
  })

  const scheduleFlash = () => {
    if (lightning <= 0) {
      nextFlash = Infinity
      return
    }
    nextFlash = (26 - (lightning / 100) * 23) * rand(0.35, 1.7)
  }

  const strike = () => {
    const segments = 18
    const startX = rand(width * 0.15, width * 0.85)
    const endX = clamp(startX + rand(-width * 0.2, width * 0.2), 0, width)
    const endY = height * rand(0.4, 0.6)
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

  /**
   * 真正的针孔相机投影。
   *
   * 之前那版把「深度」直接当屏幕比例用，楼顶会被算到地平线以下，整条街读起来像梯子。
   * 这里改成标准透视模型，世界坐标直接用「米」：
   *  - 视高 EYE = 1.6m，街道半宽 4.2m，人行道 1.2m，于是楼体落在 x = ±5.4m 之外；
   *  - 焦距 focal 由「z = 1 处的路面正好落在画面底部」确定，远处自然收拢到消失点；
   *  - 屏幕 x = 消失点 + focal·X/z，屏幕 y = 地平线 + focal·(EYE − 高度)/z。
   * 楼顶、窗户、招牌、路灯因此都落在正确的透视位置上。
   */
  const EYE = 1.6
  let focal = 1
  const project3 = (xWorld: number, z: number, yWorld: number) => {
    const horizon = height * 0.54
    return {
      x: width * 0.5 + (focal * xWorld) / z,
      y: horizon + (focal * (EYE - yWorld)) / z,
    }
  }

  /** 把天空、街道、楼群、倒影一次性烘焙进背景贴图（只在 setup / resize 时跑一次） */
  const buildCity = (w: number, h: number) => {
    const horizon = h * 0.54
    const vpX = w * 0.5
    const groundSpan = h - horizon
    const noise = makeNoise2D(20261016)
    // 收集「发光点」，最后统一交给倒影层做竖向拉长的湿路反光
    const lights: { x: number; y: number; size: number; color: [number, number, number]; strength: number }[] = []

    /**
     * 两侧的楼群。
     *
     * 每栋楼是一个盒体：临街的「侧面」（从近到远沿 z 展开）朝向街心，
     * 「正面」（垂直于街道）朝向镜头。近处的楼会遮住远处楼的正面，
     * 所以从远到近绘制，就得到照片里那种一层层退进去的街道。
     */
    const paintWalls = (ctx: CanvasRenderingContext2D, side: -1 | 1) => {
      const wallInner = 4.3 // 临街墙面到街心的距离
      const wallDepth = 7 // 楼体进深
      const buildings: { z: number; zEnd: number; h: number; anchor: boolean }[] = []
      // 第一栋楼当作「镜头旁的那面墙」：从 z≈1.2 一直延伸出去，不画正面，
      // 否则 1 点透视里会出现一块贴在画面边缘的巨大黑板。
      buildings.push({ z: 1.2, zEnd: 9, h: rand(9, 15), anchor: true })
      let z = 9
      while (z < 130) {
        const zEnd = z + rand(4, 13)
        buildings.push({ z, zEnd, h: rand(9, 34) * (rand(0, 1) < 0.18 ? rand(1.2, 1.7) : 1), anchor: false })
        z = zEnd + rand(0.05, 0.5) // 楼与楼几乎贴在一起，缝太大就会露出黑板似的正面墙
      }
      const fog = (value: number) => clamp(value / 110, 0, 0.66)
      const neon = () => NEON[Math.floor(rand(0, NEON.length))]
      const rgba = (color: [number, number, number], alpha: number) =>
        `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`

      // 从远到近：近处的楼会压在远处楼的前面
      for (let index = buildings.length - 1; index >= 0; index -= 1) {
        const building = buildings[index]
        const xInner = side * wallInner
        const xOuter = side * (wallInner + wallDepth)
        const f1 = fog(building.z)
        const f2 = fog(building.zEnd)
        // ---------- 临街的侧面 ----------
        const nearBase = project3(xInner, building.z, 0)
        const nearTop = project3(xInner, building.z, building.h)
        const farBase = project3(xInner, building.zEnd, 0)
        const farTop = project3(xInner, building.zEnd, building.h)
        const shade = ctx.createLinearGradient(nearBase.x, 0, farBase.x, 0)
        shade.addColorStop(0, `rgba(${(9 + f1 * 48).toFixed(0)}, ${(13 + f1 * 52).toFixed(0)}, ${(19 + f1 * 58).toFixed(0)}, 1)`)
        shade.addColorStop(1, `rgba(${(9 + f2 * 48).toFixed(0)}, ${(13 + f2 * 52).toFixed(0)}, ${(19 + f2 * 58).toFixed(0)}, 1)`)
        ctx.fillStyle = shade
        ctx.beginPath()
        ctx.moveTo(nearBase.x, nearBase.y)
        ctx.lineTo(farBase.x, farBase.y)
        ctx.lineTo(farTop.x, farTop.y)
        ctx.lineTo(nearTop.x, nearTop.y)
        ctx.closePath()
        ctx.fill()
        // ---------- 朝向镜头的正面 ----------
        if (!building.anchor) {
          const frontBase = project3(xOuter, building.z, 0)
          const frontTop = project3(xOuter, building.z, building.h)
          ctx.beginPath()
          ctx.moveTo(nearBase.x, nearBase.y)
          ctx.lineTo(frontBase.x, frontBase.y)
          ctx.lineTo(frontTop.x, frontTop.y)
          ctx.lineTo(nearTop.x, nearTop.y)
          ctx.closePath()
          ctx.fillStyle = `rgba(${(6 + f1 * 40).toFixed(0)}, ${(10 + f1 * 44).toFixed(0)}, ${(15 + f1 * 50).toFixed(0)}, 1)`
          ctx.fill()
        }

        // ---------- 立面的楼层线 + 竖向分隔：给墙一个透视尺度 ----------
        const floors = Math.max(2, Math.floor(building.h / 3.1))
        const depthSlots = Math.max(2, Math.floor((building.zEnd - building.z) / 2.6))
        ctx.save()
        ctx.lineWidth = 1
        for (let floor = 1; floor <= floors; floor += 1) {
          const yWorld = floor * 3.1 - 1.1
          const a = project3(xInner, building.z, yWorld)
          const b = project3(xInner, building.zEnd, yWorld)
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
        for (let slot = 1; slot < depthSlots; slot += 1) {
          const zc = building.z + (slot / depthSlots) * (building.zEnd - building.z)
          const top = project3(xInner, zc, building.h)
          const base = project3(xInner, zc, 0)
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'
          ctx.beginPath()
          ctx.moveTo(top.x, top.y)
          ctx.lineTo(base.x, base.y)
          ctx.stroke()
        }
        ctx.restore()

        // ---------- 高层的窗：按「层 × 进深」排布 ----------
        for (let floor = 3; floor <= floors; floor += 1) {
          const yWorld = floor * 3.1 - 1.1
          for (let slot = 0; slot < depthSlots; slot += 1) {
            if (Math.random() > 0.42) continue
            const winFrom = building.anchor ? 4.5 : building.z
            const zc = winFrom + ((slot + rand(0.2, 0.8)) / depthSlots) * (building.zEnd - winFrom)
            const at = project3(xInner, zc, yWorld)
            const next = project3(xInner, zc + 1, yWorld)
            const winW = Math.max(1.2, Math.abs(next.x - at.x) * 0.32)
            const winH = Math.max(1.4, winW * 1.2)
            const warm = Math.random() < 0.62
            const strength = rand(0.1, 0.5)
            const color = warm ? '255, 204, 146' : '168, 214, 255'
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            const lit = ctx.createLinearGradient(at.x, at.y - winH, at.x, at.y)
            lit.addColorStop(0, `rgba(${color}, ${(strength * 0.3).toFixed(3)})`)
            lit.addColorStop(1, `rgba(${color}, ${(strength * 0.62).toFixed(3)})`)
            ctx.fillStyle = lit
            ctx.fillRect(at.x - winW / 2, at.y - winH, winW, winH)
            if (strength > 0.36) {
              const r2 = winW * 2.6
              const spill = ctx.createRadialGradient(at.x, at.y - winH / 2, 0, at.x, at.y - winH / 2, r2)
              spill.addColorStop(0, `rgba(${color}, ${(strength * 0.26).toFixed(3)})`)
              spill.addColorStop(1, `rgba(${color}, 0)`)
              ctx.fillStyle = spill
              ctx.fillRect(at.x - r2, at.y - winH / 2 - r2, r2 * 2, r2 * 2)
            }
            ctx.restore()
          }
        }

        // ---------- 店面：一层的一串橱窗（离散的、暖的，而不是整条光带） ----------
        if (building.z < 42) {
          const shopFrom = building.anchor ? 5 : building.z
          const count = 3 + Math.floor(rand(0, 4))
          for (let k = 0; k < count; k += 1) {
            const zc = shopFrom + rand(0.5, Math.max(0.6, building.zEnd - shopFrom - 1.5))
            const wM = rand(0.7, 1.7)
            const yBottom = rand(0.55, 1.1)
            const yTop = yBottom + rand(1.1, 2.1)
            const a = project3(xInner, zc, yBottom)
            const b = project3(xInner, zc + wM, yBottom)
            const ta = project3(xInner, zc, yTop)
            const tb = project3(xInner, zc + wM, yTop)
            const color = Math.random() < 0.68
              ? ([255, 214, 164] as [number, number, number])
              : neon()
            const strength = rand(0.32, 0.62) * (1 - fog(zc))
            if (strength < 0.08) continue
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            const win = ctx.createLinearGradient(ta.x, ta.y, a.x, a.y)
            win.addColorStop(0, rgba(color, strength * 0.42))
            win.addColorStop(0.7, rgba(color, strength * 0.8))
            win.addColorStop(1, rgba(color, strength * 0.95))
            ctx.fillStyle = win
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.lineTo(tb.x, tb.y)
            ctx.lineTo(ta.x, ta.y)
            ctx.closePath()
            ctx.fill()
            // 玻璃分隔（竖梃）与上沿的暗框
            ctx.strokeStyle = rgba([8, 12, 16], 0.6)
            ctx.lineWidth = Math.max(1, Math.abs(a.x - b.x) * 0.06)
            for (let m = 1; m <= 2; m += 1) {
              const mx = a.x + ((b.x - a.x) * m) / 3
              const my = a.y + ((b.y - a.y) * m) / 3
              const mtx = ta.x + ((tb.x - ta.x) * m) / 3
              ctx.beginPath()
              ctx.moveTo(mx, my)
              ctx.lineTo(mtx, ta.y + ((tb.y - ta.y) * m) / 3)
              ctx.stroke()
            }
            ctx.fillStyle = 'rgba(6, 9, 12, 0.5)'
            ctx.fillRect(Math.min(a.x, b.x), ta.y - Math.max(2, Math.abs(a.x - b.x) * 0.1), Math.abs(b.x - a.x), Math.max(2, Math.abs(a.x - b.x) * 0.1))
            // 橱窗漏到街上的光晕
            const cx = (a.x + b.x) / 2
            const r2 = Math.max(6, Math.abs(a.x - b.x) * 2.4)
            const halo = ctx.createRadialGradient(cx, (a.y + ta.y) / 2, 0, cx, (a.y + ta.y) / 2, r2)
            halo.addColorStop(0, rgba(color, strength * 0.3))
            halo.addColorStop(1, rgba(color, 0))
            ctx.fillStyle = halo
            ctx.fillRect(cx - r2, (a.y + ta.y) / 2 - r2, r2 * 2, r2 * 2)
            ctx.restore()
            lights.push({
              x: (a.x + b.x) / 2,
              y: (a.y + ta.y) / 2,
              size: Math.max(2.5, Math.abs(a.x - b.x) * 0.7),
              color,
              strength: strength * 0.55,
            })
          }
        }

        // ---------- 招牌：贴墙的发光牌（尺寸按「米」算，否则近处会糊成一大片） ----------
        if (Math.random() < 0.75 && building.zEnd > 6 && building.z < 74) {
          const signFrom = building.anchor ? 5 : building.z
          const zc = rand(signFrom + 0.4, Math.max(signFrom + 0.6, building.zEnd - 0.6))
          const hM = rand(0.6, 1.5)
          const yBottom = rand(3.2, Math.min(Math.max(4.6, building.h - 3), 10.5))
          const zFar = zc + rand(0.4, 1.05)
          const a = project3(xInner, zc, yBottom)
          const b = project3(xInner, zFar, yBottom)
          const ta = project3(xInner, zc, yBottom + hM)
          const tb = project3(xInner, zFar, yBottom + hM)
          const color = neon()
          const strength = (1 - fog(zc)) * 0.72 * clamp(1.15 - yBottom / 13, 0.3, 1)
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          const board = ctx.createLinearGradient(a.x, a.y, b.x, ta.y)
          board.addColorStop(0, rgba(color, strength * 0.9))
          board.addColorStop(0.5, rgba(color, strength * 0.55))
          board.addColorStop(1, rgba(color, strength * 0.85))
          ctx.fillStyle = board
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.lineTo(tb.x, tb.y)
          ctx.lineTo(ta.x, ta.y)
          ctx.closePath()
          ctx.fill()
          // 招牌内部：中间一条亮芯 + 上下两条暗边，像真的灯箱
          const cx0 = (a.x + b.x) / 2
          const cy0 = (a.y + b.y) / 2
          const tx0 = (ta.x + tb.x) / 2
          const ty0 = (ta.y + tb.y) / 2
          ctx.strokeStyle = rgba(color, strength * 0.95)
          ctx.lineWidth = Math.max(1.2, Math.abs(a.x - b.x) * 0.12)
          ctx.beginPath()
          ctx.moveTo(cx0 * 0.42 + tx0 * 0.58, cy0 * 0.42 + ty0 * 0.58)
          ctx.lineTo(tx0, ty0)
          ctx.stroke()
          ctx.strokeStyle = 'rgba(6, 10, 14, 0.75)'
          ctx.lineWidth = Math.max(1, Math.abs(a.x - b.x) * 0.16)
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
          // 光晕：招牌往外霍开的一团光
          const cx = (a.x + b.x + ta.x + tb.x) / 4
          const cy = (a.y + b.y + ta.y + tb.y) / 4
          const r2 = Math.max(10, Math.abs(a.x - tb.x) * 1.6 + Math.abs(ta.y - a.y) * 1.1)
          const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2)
          halo.addColorStop(0, rgba(color, strength * 0.42))
          halo.addColorStop(0.45, rgba(color, strength * 0.12))
          halo.addColorStop(1, rgba(color, 0))
          ctx.fillStyle = halo
          ctx.fillRect(cx - r2, cy - r2, r2 * 2, r2 * 2)
          ctx.restore()
          lights.push({ x: cx, y: cy, size: Math.max(3, Math.abs(a.x - b.x) * 0.8), color, strength })
        }

        // ---------- 竖招牌：垂直于墙挑出来的小灯箱 ----------
        if (Math.random() < 0.42 && building.zEnd > 6 && building.z < 52) {
          const vsignFrom = building.anchor ? 5 : building.z
          const zc = rand(vsignFrom + 0.5, Math.max(vsignFrom + 0.7, building.zEnd - 0.5))
          const yBottom = rand(2.6, 6.5)
          const yTop = yBottom + rand(1.4, 2.8)
          const a = project3(xInner, zc, yBottom)
          const ta = project3(xInner, zc, yTop)
          const color = neon()
          const strength = (1 - fog(zc)) * 0.9
          const boardW = Math.max(2.5, Math.abs(ta.x - a.x) * 0.42)
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          const board = ctx.createLinearGradient(a.x - boardW, 0, a.x + boardW, 0)
          board.addColorStop(0, rgba(color, 0))
          board.addColorStop(0.5, rgba(color, strength * 0.85))
          board.addColorStop(1, rgba(color, 0))
          ctx.fillStyle = board
          ctx.fillRect(a.x - boardW, ta.y, boardW * 2, a.y - ta.y)
          const r2 = boardW * 3.2
          const halo = ctx.createRadialGradient(a.x, (ta.y + a.y) / 2, 0, a.x, (ta.y + a.y) / 2, r2)
          halo.addColorStop(0, rgba(color, strength * 0.34))
          halo.addColorStop(1, rgba(color, 0))
          ctx.fillStyle = halo
          ctx.fillRect(a.x - r2, (ta.y + a.y) / 2 - r2, r2 * 2, r2 * 2)
          ctx.restore()
          lights.push({ x: a.x, y: (ta.y + a.y) / 2, size: boardW * 0.6, color, strength })
        }

        // ---------- 路灯：立在人行道边，顶端一颗暖灯 ----------
        if (Math.random() < 0.36 && building.zEnd > 6 && building.z < 45) {
          const lampZ = rand(building.anchor ? 5 : building.z, building.zEnd)
          const foot = project3(side * 3.7, lampZ, 0)
          const head = project3(side * 3.7, lampZ, 3.4)
          ctx.save()
          ctx.strokeStyle = `rgba(8, 13, 17, ${(0.7 + fog(lampZ) * 0.28).toFixed(2)})`
          ctx.lineWidth = Math.max(1, focal * 0.08 / lampZ)
          ctx.beginPath()
          ctx.moveTo(foot.x, foot.y)
          ctx.lineTo(head.x, head.y)
          ctx.stroke()
          ctx.globalCompositeOperation = 'lighter'
          const radius = Math.max(5, focal * 0.85 / lampZ)
          const lamp = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, radius)
          lamp.addColorStop(0, 'rgba(255, 232, 190, 0.85)')
          lamp.addColorStop(0.26, 'rgba(255, 212, 156, 0.26)')
          lamp.addColorStop(1, 'rgba(255, 200, 140, 0)')
          ctx.fillStyle = lamp
          ctx.fillRect(head.x - radius, head.y - radius, radius * 2, radius * 2)
          ctx.restore()
          lights.push({ x: head.x, y: head.y, size: radius * 0.2, color: [255, 216, 166], strength: Math.max(0.4, 0.8 - fog(lampZ)) })
        }
      }
    }

    // ---------- 天际线（远景，只有暗影与零星窗光） ----------
    skyOnly = paint(w, h, (ctx) => {
      // 夜空：被城市灯光从下方染成青灰
      const sky = ctx.createLinearGradient(0, 0, 0, horizon)
      sky.addColorStop(0, '#0a1018')
      sky.addColorStop(0.55, '#132030')
      sky.addColorStop(0.86, '#1d3340')
      sky.addColorStop(1, '#2a4a52')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, horizon)
      // 云：fbm 生成的雨云，被城市灯光从下方照亮
      const cw = Math.max(64, Math.round(w * 0.34))
      const ch = Math.max(32, Math.round(horizon * 0.6))
      const clouds = paint(cw, ch, (c) => {
        const image = c.createImageData(cw, ch)
        for (let y = 0; y < ch; y += 1) {
          const ny = y / ch
          for (let x = 0; x < cw; x += 1) {
            const density = noise.fbm((x / cw) * 3.1 + 1.3, ny * 2.6 + 4.1, 5, 0.55)
            const body = clamp((density - 0.44) * 3.1, 0, 1) * clamp(1.2 - ny * 1.1, 0, 1)
            const lit = Math.pow(clamp((ny - 0.3) / 0.7, 0, 1), 1.6)
            const index = (y * cw + x) * 4
            image.data[index] = 58 + lit * 120 * body
            image.data[index + 1] = 68 + lit * 104 * body
            image.data[index + 2] = 88 + lit * 96 * body
            image.data[index + 3] = Math.round(body * 170)
          }
        }
        c.putImageData(image, 0, 0)
      })
      ctx.save()
      ctx.globalAlpha = 0.8
      ctx.drawImage(soften(clouds, 3), 0, 0, w, horizon)
      ctx.restore()
      cloudFlash = soften(clouds, 3)

      // 远处的城市辉光：消失点附近最亮（照片里最抓眼的一处）
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const cityGlow = ctx.createRadialGradient(vpX, horizon, 0, vpX, horizon, Math.max(w, h) * 0.46)
      cityGlow.addColorStop(0, 'rgba(255, 218, 172, 0.34)')
      cityGlow.addColorStop(0.18, 'rgba(180, 216, 236, 0.17)')
      cityGlow.addColorStop(0.5, 'rgba(96, 148, 176, 0.06)')
      cityGlow.addColorStop(1, 'rgba(60, 110, 140, 0)')
      ctx.fillStyle = cityGlow
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    })

    background = paint(w, h, (ctx) => {
      // 先铺夜空
      ctx.drawImage(skyOnly as HTMLCanvasElement, 0, 0)
      // 远景天际线：低矮、稀疏的剪影
      ctx.save()
      let bx = -20
      while (bx < w + 20) {
        const bw = rand(24, 90)
        const bh = rand(h * 0.03, h * 0.14)
        const top = horizon - bh
        ctx.fillStyle = `rgba(10, 18, 26, ${rand(0.5, 0.85).toFixed(2)})`
        ctx.fillRect(bx, top, bw, bh + 4)
        for (let i = 0; i < 6; i += 1) {
          if (Math.random() > 0.4) continue
          ctx.fillStyle = Math.random() < 0.7
            ? `rgba(255, 206, 150, ${rand(0.1, 0.4).toFixed(2)})`
            : `rgba(170, 216, 255, ${rand(0.08, 0.3).toFixed(2)})`
          ctx.fillRect(bx + rand(4, bw - 6), top + rand(6, bh - 4), 2, 2.6)
        }
        bx += bw + rand(6, 26)
      }
      ctx.restore()

      // ---------- 两侧的楼群：先画远处的楼，再被近处的楼压住 ----------
      paintWalls(ctx, -1)
      paintWalls(ctx, 1)

      // ---------- 路面与两侧人行道（都按透视画） ----------
      const roadHalf = 3.1
      const walkOuter = 4.3
      const zNear = 0.42
      // 人行道：两片梯形
      for (const side of [-1, 1]) {
        const a = project3(side * roadHalf, zNear, 0)
        const b = project3(side * walkOuter, zNear, 0)
        const c = project3(side * walkOuter, 200, 0)
        const d = project3(side * roadHalf, 200, 0)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.lineTo(c.x, c.y)
        ctx.lineTo(d.x, d.y)
        ctx.closePath()
        const walk = ctx.createLinearGradient(0, height, 0, horizon)
        walk.addColorStop(0, '#131c1f')
        walk.addColorStop(0.45, '#0e161a')
        walk.addColorStop(1, '#1b2a31')
        ctx.fillStyle = walk
        ctx.fill()
        // 路缘：一条亮一点的石边
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(d.x, d.y)
        ctx.strokeStyle = 'rgba(150, 172, 176, 0.1)'
        ctx.lineWidth = Math.max(1.2, focal * 0.02 / zNear)
        ctx.stroke()
      }
      // 车道：沥青（近处深、远处被灯光照亮）
      const road = ctx.createLinearGradient(0, height, 0, horizon)
      road.addColorStop(0, '#05080a')
      road.addColorStop(0.45, '#081015')
      road.addColorStop(0.86, '#16242c')
      road.addColorStop(1, '#2b4149')
      ctx.beginPath()
      const ra = project3(-roadHalf, zNear, 0)
      const rb = project3(roadHalf, zNear, 0)
      const rc = project3(roadHalf, 200, 0)
      const rd = project3(-roadHalf, 200, 0)
      ctx.moveTo(ra.x, ra.y)
      ctx.lineTo(rb.x, rb.y)
      ctx.lineTo(rc.x, rc.y)
      ctx.lineTo(rd.x, rd.y)
      ctx.closePath()
      ctx.fillStyle = road
      ctx.fill()
      // 车道上的虚线：沿 z 排布，越远越短（透视自动处理）
      ctx.save()
      ctx.fillStyle = 'rgba(226, 234, 238, 0.16)'
      for (let markZ = 3; markZ < 90; markZ *= 1.28) {
        const m0 = project3(0, markZ, 0.02)
        const m1 = project3(0, markZ + markZ * 0.16, 0.02)
        const wpx = Math.max(1, focal * 0.16 / markZ)
        ctx.fillRect(m0.x - wpx / 2, m1.y, wpx, Math.max(1, m0.y - m1.y))
      }
      ctx.restore()

      // ---------- 湿路面上的彩色光带倒影 ----------
      // ---------- 消失点附近的车辆灯光（远景的一点人间气） ----------
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 8; i += 1) {
        const z = rand(24, 90)
        const at = project3(rand(-2.5, 2.5), z, 0.6)
        const radius = Math.max(2, focal * 0.34 / z)
        const warm = Math.random() < 0.55
        const color: [number, number, number] = warm ? [255, 92, 76] : [255, 244, 220]
        const glow = ctx.createRadialGradient(at.x, at.y - radius, 0, at.x, at.y - radius, radius * 2.4)
        glow.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.7)`)
        glow.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`)
        ctx.fillStyle = glow
        ctx.fillRect(at.x - radius * 2.4, at.y - radius * 3.4, radius * 4.8, radius * 4.8)
        lights.push({ x: at.x, y: at.y - radius, size: radius * 0.6, color, strength: 0.7 })
      }
      ctx.restore()

      // ---------- 湿路面上的彩色光带倒影 ----------
      // 真实雨夜照片里，倒影是「从地平线往下拉长的柔光带，被水面的横向波纹打断」，
      // 所以这里用预渲染的柔光精灵纵向拉伸（而不是一堆矩形），最后整体柔化一次。
      const reflectionRaw = paint(w, h, (r) => {
        r.save()
        // 只落在车道范围内：人行道上的反光要淡得多
        r.beginPath()
        r.moveTo(width * 0.5, horizon)
        r.lineTo(width * 0.5 + focal * 3.1 / 0.42, height)
        r.lineTo(width * 0.5 - focal * 3.1 / 0.42, height)
        r.closePath()
        r.clip()
        r.globalCompositeOperation = 'lighter'
        // 只让最亮的十几盏灯产生明显倒影，否则整条路会糊成地砖
        const mirrored = lights
          .filter((light) => light.strength >= 0.5 && light.size >= 3.5)
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 17)
        for (const light of mirrored) {
          const depth = clamp(1 - (light.y - horizon) / groundSpan, 0.12, 1)
          const length = groundSpan * (0.38 + depth * 0.78) * (0.6 + light.strength * 1.2)
          const smearW = Math.max(5, light.size * (0.3 + depth * 0.7) * 2.4)
          const sprite = smearFor(light.color)
          const central = clamp(1 - Math.abs(light.x - width * 0.5) / (width * 0.16), 0.45, 1)
          const core = clamp(0.2 + Math.pow(light.strength, 1.5) * 0.6, 0, 0.8) * central * 0.85
          // 一条细而亮的芯（远处的灯在湿地上的拉长像）
          r.globalAlpha = core
          r.drawImage(sprite, light.x - smearW * 0.34, horizon + 2, smearW * 0.68, length)
          // 外圈更宽更淡的一圈（近处散开的反光）
          r.globalAlpha = core * 0.5
          r.drawImage(sprite, light.x - smearW * 1.1, horizon + 4 + length * 0.22, smearW * 2.2, length * 0.86)
          // 最宽最淡的底色（湿地上摊开的光池）
          r.globalAlpha = core * 0.2
          r.drawImage(sprite, light.x - smearW * 2.4, horizon + 6 + length * 0.42, smearW * 4.8, length * 0.62)
        }
        r.restore()
      })
      const reflectionSoft = soften(reflectionRaw, 3)
      // 水面的横向波纹把光带打断成一段一段（雨夜照片的关键质感）
      // 注意：每块画布只允许取一次 2D 上下文——预览钻机的 canvas 代理会在 getContext 时重置尺寸，
      // 二次取上下文会把已经画好的内容清空（踩过这个坑）。
      reflectionLayer = paint(w, h, (r) => {
        r.drawImage(reflectionSoft, 0, 0)
        r.globalCompositeOperation = 'destination-out'
        // 越靠近镜头，反光越淡（水面越远越平，反射越实）
        const fade = r.createLinearGradient(0, horizon, 0, height)
        fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
        fade.addColorStop(0.45, 'rgba(0, 0, 0, 0.28)')
        fade.addColorStop(1, 'rgba(0, 0, 0, 0.78)')
        r.globalAlpha = 1
        r.fillStyle = fade
        r.fillRect(0, horizon - 4, width, height - horizon + 4)
        r.globalCompositeOperation = 'destination-out'
        for (let y = horizon - 2; y < height; y += rand(3.5, 11)) {
          const t = clamp((y - horizon) / groundSpan, 0.25, 1)
          r.globalAlpha = rand(0.03, 0.14) * t
          r.fillRect(0, y, width, rand(1, 3.2))
        }
        for (let k = 0; k < 26; k += 1) {
          const y = horizon + Math.pow(Math.random(), 0.5) * groundSpan
          r.globalAlpha = rand(0.04, 0.13) * clamp((y - horizon) / groundSpan, 0.2, 1)
          r.fillRect(0, y, width, rand(1.5, 5))
        }
      })

      // ---------- 湿路面上的彩色光带倒影 ----------
      // 真实雨夜照片里，倒影是「从地平线往下拉长的柔光带，被水面的横向波纹打断」，
      // 所以这里用预渲染的柔光精灵纵向拉伸（而不是一堆矩形），整体再柔化两次。
      ctx.save()
      ctx.globalAlpha = 0.82
      ctx.drawImage(reflectionLayer, 0, 0)
      ctx.restore()


      // 近处湿沥青的整体光泽：雨夜的路面从来不是纯黑的
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const sheen = ctx.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.95)
      sheen.addColorStop(0, 'rgba(120, 156, 178, 0.09)')
      sheen.addColorStop(0.5, 'rgba(96, 130, 152, 0.045)')
      sheen.addColorStop(1, 'rgba(80, 110, 132, 0)')
      ctx.fillStyle = sheen
      ctx.fillRect(0, horizon, w, h - horizon)
      ctx.restore()

      // 整体雾气与暗角
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const haze = ctx.createLinearGradient(0, horizon - h * 0.22, 0, height * 0.9)
      haze.addColorStop(0, 'rgba(120, 168, 176, 0)')
      haze.addColorStop(0.35, 'rgba(120, 168, 176, 0.07)')
      haze.addColorStop(1, 'rgba(110, 150, 160, 0.03)')
      ctx.fillStyle = haze
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
      paintVignette(ctx, w, h, 0.44)
      paintGrain(ctx, w, h, 0.035, false)
    })
  }

  return {
    fps: 60,
    setup(w, h) {
      width = w
      height = h
      const slopes = [0.08, 0.3, 0.55]
      softByWind = slopes.map((slope) => makeSoftStreak(198, 226, 236, slope, 30))
      nearByWind = slopes.map((slope) => soften(makeSoftStreak(210, 234, 244, slope, 36), 2))
      ringSprite = soften(
        paint(128, 128, (ctx) => {
          const ring = ctx.createRadialGradient(64, 64, 30, 64, 64, 60)
          ring.addColorStop(0, 'rgba(190, 226, 226, 0)')
          ring.addColorStop(0.68, 'rgba(200, 232, 232, 0.26)')
          ring.addColorStop(0.86, 'rgba(226, 244, 244, 0.46)')
          ring.addColorStop(1, 'rgba(190, 226, 226, 0)')
          ctx.fillStyle = ring
          ctx.fillRect(0, 0, 128, 128)
        }),
        2,
      )
      splashSprite = soften(makeSoftStreak(226, 244, 246, 0, 14), 2)
      focal = ((height - height * 0.54) * 1.08) / 1.6
      bokehSprites = [
        makeSoftDot([120, 226, 226], 128, 2.6),
        makeSoftDot([255, 196, 130], 128, 2.6),
        makeSoftDot([238, 128, 186], 128, 2.6),
      ]
      buildSmearSprites()
      buildCity(width, height)
      drops = []
      ripples = []
      splashes = []
      bokehs = Array.from({ length: 7 }, spawnBokeh)
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
      target = Math.round(dense * 200 * areaFactor(width, height))
      nearCount = Math.round(dense * 46 * areaFactor(width, height))
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
      const fall = 460 + (speed / 100) * 1250
      const drift = (wind / 100) * 240
      for (const drop of drops) {
        drop.y += fall * drop.speed * dt
        drop.x += drift * drop.speed * dt
        if (drop.y > height * 0.96) {
          if (drop.depth > 0.3) {
            if (splashes.length < 200) splashes.push({ x: drop.x, y: height * rand(0.72, 1), life: 1, vy: rand(24, 56) })
            if (drop.depth > 0.7 && ripples.length < 56) {
              const maxLife = rand(0.5, 1)
              ripples.push({ x: drop.x, y: height * rand(0.74, 1), size: rand(0.7, 1.5), life: maxLife, maxLife })
            }
          }
          const fresh = spawnDrop(drop.depth > 0.72)
          fresh.y = rand(-height * 0.35, -12)
          Object.assign(drop, fresh)
        }
        if (drop.x > width + 120) drop.x -= width + 240
        if (drop.x < -120) drop.x += width + 240
      }
      for (const ripple of ripples) {
        ripple.life -= dt
      }
      ripples = ripples.filter((ripple) => ripple.life > 0)
      for (const splash of splashes) {
        splash.life -= dt * 3.2
        splash.y -= splash.vy * dt
        splash.vy *= 0.9
      }
      splashes = splashes.filter((splash) => splash.life > 0)
      for (const bokeh of bokehs) {
        bokeh.phase += dt * 0.35
        bokeh.y -= bokeh.drift * dt
        if (bokeh.y < height * 0.2) bokeh.y = height * 0.98
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

      // 闪电照亮云层
      if (cloudFlash && flash > 0.02) {
        ctx.save()
        ctx.globalAlpha = clamp(flash * 0.45, 0, 1)
        ctx.globalCompositeOperation = 'screen'
        ctx.drawImage(cloudFlash, 0, 0, width, height * 0.54)
        ctx.restore()
      }

      // 湿路面的倒影：整体极缓慢地上下浮动，模拟水面的搅动
      if (reflectionLayer) {
        const wobble = 1 + Math.sin(time * 0.9) * 0.01
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.34 + glow * 0.4, 0, 1)
        ctx.drawImage(reflectionLayer, 0, height * 0.54 * (1 - wobble), width, height * wobble)
        ctx.globalAlpha *= 0.5
        ctx.drawImage(reflectionLayer, 0, height * 0.54 * (1 - wobble) + 2, width, height * wobble)
        ctx.restore()
      }

      // 雨丝：近景虚化的一层 + 中景细密的一层
      const slant = ((wind / 100) * 240) / (460 + (speed / 100) * 1250)
      const bucket = clamp(Math.round(slant / 0.22), 0, 2)
      const streakSoft = softByWind[bucket]
      const streakNear = nearByWind[bucket]
      ctx.save()
      const boost = 0.55 + glow * 0.6 + flash * 1.1
      if (streakSoft) {
        for (let i = 0; i < target; i += 1) {
          const drop = drops[i]
          if (!drop) continue
          const sw = 2.2 + drop.depth * 3.6
          const sh = drop.len * 2.6
          ctx.globalAlpha = clamp(drop.alpha * boost * 0.85, 0, 1)
          ctx.drawImage(streakSoft, drop.x - sw / 2, drop.y - sh * 0.5, sw, sh)
        }
      }
      if (streakNear) {
        for (let i = target; i < drops.length; i += 1) {
          const drop = drops[i]
          if (!drop) continue
          const sw = 6 + drop.depth * 16
          const sh = drop.len * 3.6
          ctx.globalAlpha = clamp(drop.alpha * boost * 0.45, 0, 1)
          ctx.drawImage(streakNear, drop.x - sw / 2, drop.y - sh * 0.5, sw, sh)
        }
      }
      ctx.restore()

      // 溅起的水花与落点涟漪
      if (splashSprite) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const splash of splashes) {
          const size = 4
          const h2 = 14 * splash.life
          ctx.globalAlpha = clamp(splash.life, 0, 1) * 0.3
          ctx.drawImage(splashSprite, splash.x - size / 2, splash.y - h2, size, h2)
        }
        ctx.restore()
      }
      if (ringSprite) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const ripple of ripples) {
          const fade = clamp(ripple.life / ripple.maxLife, 0, 1)
          const size = 26 * (1.6 - fade) * ripple.size
          ctx.globalAlpha = fade * fade * 0.3 * (0.6 + glow * 0.6)
          ctx.drawImage(ringSprite, ripple.x - size / 2, ripple.y - size * 0.16, size, size * 0.32)
        }
        ctx.restore()
      }

      // 镜头前的散景（青 / 琥珀 / 洋红三种色温，极淡；用预渲染的柔光斑，边缘不带圆环）
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const bokeh of bokehs) {
        const sprite = bokehSprites[bokeh.kind]
        if (!sprite) continue
        const size = bokeh.size * (1 + 0.05 * Math.sin(bokeh.phase))
        ctx.globalAlpha = clamp(bokeh.alpha * (0.6 + glow * 0.9), 0, 1)
        ctx.drawImage(sprite, bokeh.x - size / 2, bokeh.y - size / 2, size, size)
      }
      ctx.restore()

      // 闪电
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
        ctx.strokeStyle = `rgba(140, 200, 210, ${(0.1 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 24
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(180, 226, 232, ${(0.26 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 8
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.85 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 2
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(214, 240, 240, ${(0.38 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 1.5
        for (const branch of bolt.branches) drawPath(branch)
        ctx.restore()
      }
      if (flash > 0.02) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(flash * 0.3, 0, 1)
        ctx.fillStyle = 'rgb(140, 190, 200)'
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
      }
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
      const widthBand = Math.max(halfW, halfH) * 0.125
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
          // 沿带方向拉长的高频噪声：银河的「絮状条带」是同向的，
          // 各向同性的噪声会立刻变成一朵云。
          const clumps =
            noise.fbm(along * 21 + 5.2, t * 3.1 + 1.7, 4, 0.55) * 0.72 +
            noise.fbm(along * 46 + 21.7, t * 5.6 + 4.4, 3, 0.6) * 0.45
          // 暗尘：沿带方向细长的暗纹（t 方向频率高于 along 方向，才能「顺带」）
          const dust =
            noise.fbm(along * 9.5 + 11.4, t * 12.4 + 3.1, 4, 0.6) * 0.72 +
            noise.fbm(along * 24 + 7.1, t * 19.3 + 1.2, 2, 0.5) * 0.4
          const dustMask = clamp(1 - Math.pow(clamp((dust - 0.52) * 3.2, 0, 1), 1.4), 0, 1)
          // 颗粒：让亮带由无数小点组成，而不是一块平滑的雾
          const grain =
            clamp((noise.fbm(along * 168 + 3.3, t * 17.5 + 9.9, 3, 0.62) - 0.42) * 3.2, 0, 1) * 0.62 +
            clamp((noise.fbm(along * 62 + 13.7, t * 9.4 + 2.2, 2, 0.6) - 0.4) * 3, 0, 1) * 0.5
          const strength = profile * (0.2 + clumps * 0.95) * (0.56 + grain * 0.62) * dustMask
          if (strength <= 0.01) {
            image.data[index + 3] = 0
            continue
          }
          // 银心偏暖，边缘偏蓝
          const warm = clamp(strength * 1.5 + 0.1, 0, 1)
          image.data[index] = 146 + warm * 96
          image.data[index + 1] = 154 + warm * 66
          image.data[index + 2] = 188 + warm * 24
          image.data[index + 3] = Math.round(clamp(strength * 88 * (0.55 + nebula * 0.9), 0, 255))
        }
      }
      c.putImageData(image, 0, 0)
    })
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.2
    ctx.drawImage(soften(bandCanvas, 2), 0, 0, w, h)
    ctx.globalAlpha = 0.56
    ctx.drawImage(bandCanvas, 0, 0, w, h)
    ctx.restore()

    // 银河里的密集暗弱小星（沿带撒点，越靠带中心越密）
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const milkyCount = Math.round(11000 * areaFactor(w, h))
    for (let i = 0; i < milkyCount; i += 1) {
      const u = rand(-0.62, 0.62)
      const spread = Math.pow(Math.random(), 0.6) * 0.5
      const v = (Math.random() < 0.5 ? -1 : 1) * spread
      const bx = u * w
      const by = v * h
      const x = w * 0.5 + bx * Math.cos(-0.42) + by * Math.sin(-0.42)
      const y = h * 0.52 - bx * Math.sin(-0.42) + by * Math.cos(-0.42)
      if (x < 0 || x > w || y < 0 || y > h) continue
      const a = rand(0.04, 0.34) * clamp(1 - spread * 1.7, 0, 1) * (0.5 + nebula)
      ctx.fillStyle = `rgba(222, 232, 255, ${a.toFixed(3)})`
      const size = Math.random() < 0.05 ? rand(1, 1.6) : rand(0.3, 0.72)
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
    const staticCount = Math.round(Math.max(0, bakedDensity) * 1500 * areaFactor(w, h))
    const glowScale = bakedBrightness > 0 ? clamp(0.45 + bakedBrightness * 0.75, 0.2, 1.1) : 1
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < staticCount; i += 1) {
      const px = rand(0, w)
      const py = rand(0, h * 0.94)
      const mag = starMagnitude()
      const size = 0.4 + mag * 1.4
      const alpha = rand(0.12, 0.5) * (0.45 + mag) * glowScale
      const [r, g, b] = TINTS[Math.floor(rand(0, TINTS.length))]
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`
      ctx.fillRect(px, py, size, size)
      if (mag > 0.94) {
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
      const thickness = ph * rand(0.17, 0.32) * (1 - frac * 0.12)
      const waveAmp = ph * rand(0.025, 0.06)
      const waveFreq = rand(1.3, 2.9)
      const phase = rand(0, TAU)
      const gain = rand(0.6, 0.98) * (0.6 + intensity * 0.7) * (1 - frac * 0.18)
      // 真实极光下缘是氧的 557.7nm 青绿；这里把主题色相往青绿拉，既保留主题关联又有极光的味道
      const hue = mixHue(hueBase, 154, 0.62) + (frac - 0.5) * 26 - layer * 2
      const sat = clamp(baseSat * 0.7 + 0.3, 0.35, 0.82)
      const rayDensity = 34 + rayAmount * 170 * (1.2 - frac * 0.5)
      const lumpFreq = rand(2.4, 4.4)

      // 颜色 LUT：alt=0 在帘幕底缘，alt=1 在帘幕顶端
      const LUT = 48
      const rampR = new Float32Array(LUT)
      const rampG = new Float32Array(LUT)
      const rampB = new Float32Array(LUT)
      for (let i = 0; i < LUT; i += 1) {
        const alt = i / (LUT - 1)
        // 极光的真实色序：下缘黄绿（O 557.7nm）→ 中段绿 → 顶端青
        const hueAt = 104 + alt * 78 + (hue - 154) * 0.25
        const light = 0.6 + alt * 0.06
        const [r, g, b] = hslToRgb(hueAt, clamp(sat * (1 - alt * 0.3), 0, 1), light)
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
        // 竖直条纹只是「细纹」，主体是一整团连着的光，不能再是条形码
        stripAt[x] = 0.58 + Math.pow(clamp(s1 * 0.6 + s2 * 0.5, 0, 1), 2.4) * 0.7 + s2 * 0.28
        // 大尺度亮度：让某些段落整体更亮，读起来像极光在「翻卷」
        lumpAt[x] = clamp((noise.fbm(u * lumpFreq * 1.1 + layer * 2.3, layer * 0.9, 4, 0.6) - 0.3) * 1.8, 0, 1.4)
      }

      // 帘幕顶端的一层氮紫红花边（真实极光里的粉边，点缀感很强）
      for (let x = 0; x < pw; x += 1) {
        const strip = stripAt[x] * lumpAt[x]
        if (strip <= 0.01) continue
        const fringeH = Math.max(1, Math.round(ph * 0.07))
        const fringeStart = Math.max(0, Math.floor(topAt[x]) - fringeH)
        for (let y = fringeStart; y < Math.min(ph, Math.floor(topAt[x]) + 1); y += 1) {
          const k = clamp((Math.floor(topAt[x]) - y) / fringeH, 0, 1)
          const e = strip * gain * 0.34 * Math.pow(1 - k, 1.7)
          if (e <= 0.002) continue
          const cell = (y * pw + x) * 3
          acc[cell] += e * 0.96
          acc[cell + 1] += e * 0.36
          acc[cell + 2] += e * 0.78
        }
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
        image.data[i * 4] = Math.round((1 - Math.exp(-r * 0.98)) * 255)
        image.data[i * 4 + 1] = Math.round((1 - Math.exp(-g * 0.98)) * 255)
        image.data[i * 4 + 2] = Math.round((1 - Math.exp(-b * 0.98)) * 255)
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
      hGlow.addColorStop(0.5, 'rgba(30, 86, 96, 0.16)')
      hGlow.addColorStop(0.82, 'rgba(72, 70, 92, 0.2)')
      hGlow.addColorStop(1, 'rgba(132, 52, 78, 0.3)')
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
          ridgeNoise.fbm(x * 0.0012, 3.1, 4, 0.5) * height * 0.028 -
          Math.sin(x * 0.0016) * height * 0.006
        ctx.lineTo(x, y)
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      const ground = ctx.createLinearGradient(0, horizon - height * 0.05, 0, height)
      ground.addColorStop(0, '#08131f')
      ground.addColorStop(0.5, '#040a14')
      ground.addColorStop(1, '#010206')
      ctx.fillStyle = ground
      ctx.fill()
      // 山脊顶上的一道青绿轮廓光：极光把远岸勾出一条边
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = 'rgba(104, 220, 184, 0.22)'
      ctx.lineWidth = 2.2
      ctx.stroke()
      ctx.restore()

      paintVignette(ctx, width, height, 0.4)
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
      ctx.globalAlpha = 0.62
      ctx.drawImage(
        skyForMirror,
        0, mirrorBottom - mirrorHeight, width, mirrorHeight,
        0, 0, width, mirrorHeight,
      )
      // 极光在水里的那条绿光：单独叠一层，否则会被压暗的乘色吃掉
      ctx.globalAlpha = 0.55
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(
        auroraLayer as HTMLCanvasElement,
        0, mirrorBottom - mirrorHeight, width, mirrorHeight,
        0, 0, width, mirrorHeight,
      )
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'multiply'
      const shade = ctx.createLinearGradient(0, 0, 0, mirrorHeight)
      shade.addColorStop(0, 'rgba(158, 176, 206, 1)')
      shade.addColorStop(0.5, 'rgba(88, 108, 146, 1)')
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
        ctx.globalAlpha = 0.62
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
        // 只在 1.0 以上做「呼吸」：缩放一旦小于 1，画面边缘就会露出没被盖住的矩形缝
        const scale = 1.045 + (0.012 + flow * 0.02) * Math.sin(time * 0.11)
        const drift = Math.sin(time * 0.05) * width * 0.012
        const breathe = 0.9 + 0.1 * Math.sin(time * 0.23)
        ctx.globalAlpha = clamp(breathe, 0.7, 1)
        ctx.translate(width / 2, horizon)
        ctx.scale(scale, scale)
        ctx.translate(-width / 2, -horizon)
        ctx.drawImage(
          auroraLayer,
          -width * 0.035 + drift,
          -height * 0.03,
          width * 1.07,
          (height * 1.02) * 1.06,
        )
        ctx.restore()
      }

      // 倒影：整体随水面轻微晃动，亮度由辉光强度控制
      if (lake) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.4 + intensity * 0.4, 0, 0.85)
        const sway = Math.sin(time * 0.4) * width * 0.004
        ctx.drawImage(lake, sway - width * 0.012, height * 0.78, width * 1.024, height - horizon)
        ctx.restore()
      }

      // 岸边过渡：一条很软的暗带，把远岸剪影和湖面倒影揉在一起
      ctx.save()
      const shore = ctx.createLinearGradient(0, height * 0.745, 0, height * 0.815)
      shore.addColorStop(0, 'rgba(6, 12, 20, 0)')
      shore.addColorStop(0.42, 'rgba(6, 14, 22, 0.72)')
      shore.addColorStop(0.62, 'rgba(8, 18, 28, 0.5)')
      shore.addColorStop(1, 'rgba(10, 20, 32, 0)')
      ctx.fillStyle = shore
      ctx.fillRect(0, height * 0.74, width, height * 0.085)
      ctx.restore()

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
  let warmSeaLayer: HTMLCanvasElement | null = null
  let foamSprite: HTMLCanvasElement | null = null
  let amplitude = 0.5
  let speedScale = 0.6
  let foamAmount = 0.5
  let depthScale = 0.55
  let layerAmount = 0.5
  let hue = 176
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
    // 只横向压缩一点点（水面细节横向变化慢），纵向保留原生分辨率，
    // 不然贴图被放大后浪脊会糊成一片平的色带。
    const pw = Math.max(64, Math.round(pixelWidth / 2))
    const ph = Math.max(32, Math.round(seaHeight))
    const noise = makeNoise2D(near ? 6161 : 6262)
    return paint(pw, ph, (ctx) => {
      const image = ctx.createImageData(pw, ph)
      const targetHue = near ? hue - 5 : hue
      // 竖向的浪脊条数：远处多而密，近处少而宽
      const bands = near ? 6 : 11
      for (let y = 0; y < ph; y += 1) {
        const t = y / ph // 0 = 海平线，1 = 画面底部
        // 太阳落山后的海：近处是深青绿，越靠海平线越亮
        // 真实的海：整体是暗青绿，只有浪脊被打亮；越靠近镜头越深
        const lightness = (near ? 22 - Math.pow(t, 0.85) * 8 : 34 - Math.pow(t, 1.15) * 19) * (0.85 + layerAmount * 0.3)
        const sat = near ? 50 - t * 6 : 46 - t * 10
        // 近处的浪更高更暗、对比更强（透视：越近越「立体」）
        const contrast = (near ? 10 + t * 15 : 5.5 + t * 4.6) * (0.5 + amplitude)
        for (let x = 0; x < pw; x += 1) {
          const u = x / pw
          // 浪脊保持水平，只做缓慢的横向抖动，避免像条纹布
          const wobble =
            Math.sin(u * TAU + t * 1.7) * 0.5 +
            Math.sin(u * TAU * 3 - t * 2.3) * 0.3 +
            (noise.fbm(u * 4.2 + 1.7, t * 3.1, 2, 0.6) - 0.5) * 1.1
          // 非线性相位：越远浪脊挤得越紧（透视压缩），近处舒展开
          const phase = TAU * (Math.pow(t, 1.22) * bands + wobble * 0.14)
          const wave = 0.5 + 0.5 * Math.sin(phase)
          const crest = Math.pow(wave, 4.1)
          // 沿 x 把浪脊切成一段段「水面亮块」，而不是贯穿整屏的直线
          const patchMask = clamp((noise.fbm(u * 8.6 + 3.1, t * 4.3, 3, 0.55) - 0.34) * 2.6, 0, 1)
          // 细碎的水面皱褶：高频小振幅，负责「水感」
          const fine =
            Math.sin(TAU * (u * 26 + t * 11)) * 0.5 +
            Math.sin(TAU * (u * 15 - t * 6)) * 0.34 +
            (noise.fbm(u * 22 + 7.4, t * 14, 2, 0.5) - 0.5) * 1.3
          // 浪脊高光只出现在「一段一段」的水面上（虚线化），否则会读成条纹布
          const dash = clamp((noise.fbm(u * 11 + 0.6, t * 6.2, 2, 0.55) - 0.34) * 3.1, 0, 1)
          const trough = Math.pow(1 - wave, 3.4)
          const light =
            lightness +
            crest * contrast * (0.18 + patchMask * 0.6) * (0.35 + dash * 0.95) -
            trough * contrast * 0.4 +
            fine * (0.5 + t * 2.6) * (near ? 1.05 : 0.7)
          // 浪花：浪脊顶部一条断续的白边，远近都有（远处的更细更淡）
          const streak = noise.fbm(u * 6.4 + 1.3, t * 5.1, 3, 0.6)
          const foam =
            clamp((crest - (near ? 0.34 : 0.46)) * 2.3, 0, 1) *
            clamp(streak * 2.5 - 0.72, 0, 1) *
            patchMask *
            foamAmount *
            (near ? 0.3 + t * 0.7 : 0.26 + t * 0.5)
          const index = (y * pw + x) * 4
          const mixFoam = clamp(foam * 1.15, 0, 0.78)
          const [r, g, b] = hslToRgb(
            targetHue + (crest - 0.5) * 4,
            clamp((sat * (1 - mixFoam * 0.92)) / 100, 0, 1),
            clamp((light + mixFoam * 78) / 100, 0, 1),
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
      sky.addColorStop(0, `hsl(${hue + 26} 52% 46%)`)
      sky.addColorStop(0.26, `hsl(${hue + 22} 58% 62%)`)
      sky.addColorStop(0.55, `hsl(${hue + 26} 62% 74%)`)
      sky.addColorStop(0.8, 'hsl(34 76% 82%)')
      sky.addColorStop(1, 'hsl(32 88% 88%)')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, horizon)
      // 落在太阳周围的暖光（日落的金色方向感）
      const warmWash = ctx.createRadialGradient(w * 0.66, horizon * 0.94, 0, w * 0.66, horizon * 0.94, Math.max(w, h) * 0.5)
      warmWash.addColorStop(0, 'rgba(255, 216, 152, 0.46)')
      warmWash.addColorStop(0.3, 'rgba(255, 190, 128, 0.19)')
      warmWash.addColorStop(0.66, 'rgba(255, 168, 120, 0.05)')
      warmWash.addColorStop(1, 'rgba(255, 160, 120, 0)')
      ctx.fillStyle = warmWash
      ctx.fillRect(0, 0, w, horizon)

      // 低垂的层云
      const cw = Math.max(96, Math.round(w / 1.6))
      const ch = Math.max(64, Math.round(horizon / 1.4))
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
            image.data[index + 1] = 232
            image.data[index + 2] = 206
            image.data[index + 3] = Math.round(shape * 150)
          }
        }
        c.putImageData(image, 0, 0)
      })
      ctx.save()
      ctx.globalAlpha = 0.75
      ctx.drawImage(clouds, 0, 0, w, horizon * 0.85)
      // 云的受光面（金边）与更低的云翳（宽度一定要盖满画面，否则会出现接缝）
      ctx.globalAlpha = 0.32
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(clouds, -w * 0.08, horizon * 0.06, w * 1.16, horizon * 0.72)
      ctx.restore()

      // ---------- 太阳：低垂在海平线上 ----------
      const sunX = w * 0.66
      const sunY = horizon - h * 0.035
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(w, h) * 0.3)
      sunGlow.addColorStop(0, 'rgba(255, 244, 206, 0.72)')
      sunGlow.addColorStop(0.12, 'rgba(255, 226, 164, 0.34)')
      sunGlow.addColorStop(0.4, 'rgba(255, 206, 148, 0.11)')
      sunGlow.addColorStop(1, 'rgba(255, 196, 140, 0)')
      ctx.fillStyle = sunGlow
      ctx.fillRect(0, 0, w, horizon + h * 0.02)
      const sunDisc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.min(w, h) * 0.058)
      sunDisc.addColorStop(0, 'rgba(255, 254, 246, 0.98)')
      sunDisc.addColorStop(0.32, 'rgba(255, 246, 216, 0.8)')
      sunDisc.addColorStop(0.62, 'rgba(255, 226, 168, 0.26)')
      sunDisc.addColorStop(1, 'rgba(255, 214, 150, 0)')
      ctx.fillStyle = sunDisc
      ctx.fillRect(sunX - w * 0.22, sunY - w * 0.22, w * 0.44, w * 0.44)
      ctx.restore()

      // 海平线上的薄雾（让海天之间不是一条硬边）
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const seam = ctx.createLinearGradient(0, horizon - h * 0.055, 0, horizon + h * 0.05)
      seam.addColorStop(0, 'rgba(255, 226, 186, 0)')
      seam.addColorStop(0.5, 'rgba(255, 232, 198, 0.14)')
      seam.addColorStop(1, 'rgba(255, 214, 180, 0)')
      ctx.fillStyle = seam
      ctx.fillRect(0, horizon - h * 0.06, w, h * 0.12)
      ctx.restore()

      // 海平线：被太阳点亮的一条极细亮线
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const line = ctx.createLinearGradient(0, horizon - h * 0.02, 0, horizon + h * 0.03)
      line.addColorStop(0, 'rgba(255, 246, 220, 0)')
      line.addColorStop(0.4, 'rgba(255, 238, 198, 0.16)')
      line.addColorStop(0.55, 'rgba(255, 250, 232, 0.26)')
      line.addColorStop(1, 'rgba(255, 242, 214, 0)')
      // 横向也衰减：亮线只在太阳那一侧明显
      const lineMask = ctx.createLinearGradient(sunX - w * 0.45, 0, sunX + w * 0.45, 0)
      lineMask.addColorStop(0, 'rgba(0, 0, 0, 0.85)')
      lineMask.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
      lineMask.addColorStop(1, 'rgba(0, 0, 0, 0.85)')
      ctx.fillStyle = line
      ctx.fillRect(0, horizon - h * 0.02, w, h * 0.05)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = lineMask
      ctx.fillRect(0, horizon - h * 0.02, w, h * 0.05)
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = line
      ctx.fillRect(0, horizon - h * 0.02, w, h * 0.05)
      ctx.restore()

      // 太阳方向上的暖色海面（整片水被落日染暖，越远越明显）
      const warmSea = paint(Math.round(w / 4), Math.round((h - horizon) / 2), (c) => {
        const grad = c.createLinearGradient(0, 0, c.canvas.width, 0)
        grad.addColorStop(0, 'rgba(255, 186, 132, 0)')
        grad.addColorStop(0.5, 'rgba(255, 198, 140, 0.5)')
        grad.addColorStop(1, 'rgba(255, 186, 132, 0)')
        c.fillStyle = grad
        c.fillRect(0, 0, c.canvas.width, c.canvas.height)
        const vg = c.createLinearGradient(0, 0, 0, c.canvas.height)
        vg.addColorStop(0, 'rgba(0, 0, 0, 0.4)')
        vg.addColorStop(0.55, 'rgba(0, 0, 0, 0)')
        vg.addColorStop(1, 'rgba(0, 0, 0, 0.85)')
        c.globalCompositeOperation = 'destination-out'
        c.fillStyle = vg
        c.fillRect(0, 0, c.canvas.width, c.canvas.height)
      })
      warmSeaLayer = soften(warmSea, 3)

      // ---------- 太阳在海面上的碎光路 ----------
      const pw = Math.round(w / 3)
      const ph2 = Math.round((h - horizon) / 2)
      const noise2 = makeNoise2D(7788).noise
      const path = paint(pw, ph2, (c) => {
        c.save()
        c.globalCompositeOperation = 'lighter'
        for (let y = 0; y < ph2; y += 1) {
          const t = y / ph2
          const spread = 0.035 + Math.pow(t, 1.9) * 0.46
          const alpha = (0.5 - t * 0.28) * (0.5 + amplitude * 0.7)
          if (alpha <= 0.006) continue
          const segs = 8 + Math.round(t * 26)
          for (let i = 0; i < segs; i += 1) {
            const u = (i / Math.max(1, segs - 1) - 0.5) * 2
            // 越靠中间（太阳正下方）越亮，往两侧平滑衰减——不能有硬边
            const falloff = Math.pow(1 - Math.abs(u), 1.6)
            const x = pw * 0.5 + u * pw * spread * 0.5 + (noise2(u * 7.3, t * 5.1) - 0.5) * pw * 0.05
            const segWidth = ((pw * spread) / segs) * rand(0.22, 1.15)
            const stab = noise2(u * 5.1 + 2.2, t * 3.7)
            c.fillStyle = `rgba(255, 250, 226, ${(alpha * falloff * rand(0.25, 1.15) * (0.35 + stab)).toFixed(3)})`
            c.fillRect(x - segWidth / 2, y, segWidth, 1)
          }
        }
        c.restore()
      })
      glitter = soften(path, 2)

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

      // 暖色海面（太阳那一边的水被染暖）
      if (warmSeaLayer) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.2 + amplitude * 0.16, 0, 0.4)
        ctx.drawImage(warmSeaLayer, width * 0.66 - width * 0.42, horizon, width * 0.84, span)
        ctx.restore()
      }

      // 太阳光路：叠在远海之上
      if (glitter) {
        const gw = width * 0.9
        const gh = span
        const shift = Math.sin(time * 0.32) * width * 0.014
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp(0.55 + amplitude * 0.42, 0, 0.95)
        ctx.drawImage(glitter, width * 0.66 - gw * 0.5 + shift, horizon, gw, gh)
        ctx.globalAlpha *= 0.55
        ctx.drawImage(glitter, width * 0.66 - gw * 0.5 - shift * 1.8, horizon, gw * 1.2, gh)
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
          ctx.globalAlpha = clamp(0.07 + foamAmount * 0.13, 0, 0.24) * burst
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
