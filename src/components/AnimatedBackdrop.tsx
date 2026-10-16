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

const rgbString = (rgb: [number, number, number], alpha: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`

/* -------------------------------- 雨夜 -------------------------------- */

/**
 * 雨丝贴图：一条带渐隐尾巴与亮头的斜线。
 * 斜率在贴图里就烘焙好（按风向取 5 档），绘制时只需一次 drawImage，
 * 不必为每滴雨创建渐变或做 canvas 旋转 —— 这是雨夜场景最大的性能来源。
 */
function makeStreakSprite(slope: number, size = 64): HTMLCanvasElement {
  const width = size
  const height = size * 2
  return paint(width, height, (ctx) => {
    const centerX = width / 2
    const top = 6
    const bottom = height - 7
    const dx = slope * (bottom - top) * 0.5
    const x1 = centerX - dx
    const x2 = centerX + dx

    const body = ctx.createLinearGradient(x1, top, x2, bottom)
    body.addColorStop(0, 'rgba(186, 214, 255, 0)')
    body.addColorStop(0.4, 'rgba(198, 222, 255, 0.42)')
    body.addColorStop(1, 'rgba(228, 240, 255, 0.9)')
    ctx.strokeStyle = body
    ctx.lineCap = 'round'
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.moveTo(x1, top)
    ctx.lineTo(x2, bottom)
    ctx.stroke()

    // 中间更细更亮的一条芯，雨丝才有「发光」的感觉
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.moveTo(x1, top)
    ctx.lineTo(x2, bottom)
    ctx.stroke()

    // 头部的水滴光点（原来是每帧单独画光晕，现在烘焙进贴图）
    const head = ctx.createRadialGradient(x2, bottom, 0, x2, bottom, 7.5)
    head.addColorStop(0, 'rgba(238, 247, 255, 0.9)')
    head.addColorStop(0.5, 'rgba(214, 233, 255, 0.28)')
    head.addColorStop(1, 'rgba(200, 225, 255, 0)')
    ctx.fillStyle = head
    ctx.fillRect(x2 - 8, bottom - 8, 16, 16)
  })
}

/** 贴在「玻璃」上的大颗雨珠：缓慢下滑、带一点虚化与高光 */
function makeGlassDropSprite(): HTMLCanvasElement {
  return paint(96, 128, (ctx) => {
    const body = ctx.createRadialGradient(48, 70, 2, 48, 70, 44)
    body.addColorStop(0, 'rgba(210, 230, 255, 0.5)')
    body.addColorStop(0.45, 'rgba(180, 208, 245, 0.28)')
    body.addColorStop(0.8, 'rgba(150, 185, 235, 0.16)')
    body.addColorStop(1, 'rgba(140, 180, 235, 0)')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.ellipse(48, 72, 26, 40, 0, 0, TAU)
    ctx.fill()
    // 顶部的高光与底部的折射亮边
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.ellipse(40, 52, 8, 12, -0.5, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.34)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(48, 74, 26, 0.5, 2.6)
    ctx.stroke()
  })
}

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
  interface Fog {
    x: number
    y: number
    w: number
    h: number
    vx: number
    alpha: number
  }
  interface GlassDrop {
    x: number
    y: number
    size: number
    speed: number
    wobble: number
    phase: number
    alpha: number
  }
  interface Bolt {
    points: { x: number; y: number }[]
    branches: { x: number; y: number }[][]
    life: number
  }
  // 5 档斜率（贴图空间）：按「横飘 / 下落」的真实比例挑一档，雨丝方向与运动方向一致
  const SLOPES = [0, 0.18, 0.36, 0.55, 0.75]
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let backdrop: HTMLCanvasElement | null = null
  let haze: HTMLCanvasElement | null = null
  let streaks: HTMLCanvasElement[] = []
  let glassSprite: HTMLCanvasElement | null = null
  let ground = 0.86
  let drops: Drop[] = []
  let glassDrops: GlassDrop[] = []
  let ripples: Ripple[] = []
  let fogs: Fog[] = []
  let bolt: Bolt | null = null
  let target = 0
  let speed = 55
  let wind = 12
  let lightning = 20
  let glow = 55
  let flash = 0
  let nextFlash = Infinity

  const spawnDrop = (): Drop => {
    const depth = Math.random()
    return {
      x: rand(-80, width + 80),
      y: rand(-height, height * ground),
      len: 7 + depth * 24,
      speed: 0.5 + depth * 0.75,
      depth,
      alpha: 0.12 + depth * 0.62,
    }
  }

  const spawnGlass = (): GlassDrop => ({
    x: rand(0, width),
    y: rand(-height * 0.3, height),
    size: rand(0.22, 0.5),
    speed: rand(6, 22),
    wobble: rand(2, 9),
    phase: rand(0, TAU),
    alpha: rand(0.35, 0.7),
  })

  const scheduleFlash = () => {
    if (lightning <= 0) {
      nextFlash = Infinity
      return
    }
    // 雷电越强越频繁：平均间隔约 26 秒 → 3 秒
    const base = 26 - (lightning / 100) * 23
    nextFlash = base * rand(0.4, 1.6)
  }

  /** 折线闪电：中点位移 + 分叉，看起来更像真实的落地雷 */
  const strike = () => {
    const segments = 16
    const startX = rand(width * 0.1, width * 0.9)
    const endX = clamp(startX + rand(-width * 0.22, width * 0.22), 0, width)
    const endY = height * rand(0.5, 0.72)
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments
      const jitter = i === 0 || i === segments ? 0 : rand(-1, 1) * (1 - Math.abs(t - 0.5)) * width * 0.06
      points.push({ x: startX + (endX - startX) * t + jitter, y: height * -0.05 + endY * t })
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
      const steps = 5
      for (let s = 0; s < steps; s += 1) {
        a += rand(-0.35, 0.35)
        x += Math.cos(a) * (length / steps)
        y += Math.sin(a) * (length / steps)
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
      const horizon = height * 0.74
      haze = makeGlowSprite(150, 180, 230, 256)
      backdrop = makeBokehSprite(190, 215, 255, 256, 0.32)
      streaks = SLOPES.map((slope) => makeStreakSprite(slope))
      glassSprite = makeGlassDropSprite()
      background = paintBackground(w, h, (ctx) => {
        // 夜空
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#03060f')
        sky.addColorStop(0.45, '#060c1d')
        sky.addColorStop(0.75, '#0a1430')
        sky.addColorStop(1, '#04070f')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)

        // 远处城市的暖色灯火（三层，越远越淡）
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 22; i += 1) {
          const cx = (i / 21) * w + rand(-40, 40)
          const cy = horizon + rand(-12, 14)
          const radius = rand(60, 190)
          const warm = Math.random() < 0.7 ? [255, 196, 128] : [150, 190, 255]
          const glowGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
          glowGradient.addColorStop(0, `rgba(${warm[0]},${warm[1]},${warm[2]},${rand(0.06, 0.2).toFixed(3)})`)
          glowGradient.addColorStop(1, `rgba(${warm[0]},${warm[1]},${warm[2]},0)`)
          ctx.fillStyle = glowGradient
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
        }
        // 高楼剪影
        ctx.fillStyle = 'rgba(4, 8, 18, 0.85)'
        let x = -20
        while (x < w + 20) {
          const bw = rand(40, 130)
          const bh = rand(30, 120)
          ctx.fillRect(x, horizon - bh, bw, bh + 6)
          x += bw + rand(8, 40)
        }
        ctx.restore()

        // 远处的细雨：烘焙成静态雨幕，零逐帧开销（近处的动态雨丝叠加在上面）
        ctx.save()
        ctx.lineCap = 'round'
        for (let i = 0; i < 900; i += 1) {
          const dropX = rand(-60, w + 60)
          const dropY = rand(-20, h * ground)
          const len = rand(4, 13)
          const slant = (dropX % 3) === 0 ? 0.5 : 0.18
          ctx.strokeStyle = `rgba(180, 210, 255, ${rand(0.03, 0.13).toFixed(3)})`
          ctx.lineWidth = Math.random() < 0.2 ? 1.1 : 0.7
          ctx.beginPath()
          ctx.moveTo(dropX, dropY)
          ctx.lineTo(dropX + len * slant, dropY + len)
          ctx.stroke()
        }
        ctx.restore()

        // 湿漉漉的地面：横向反光带 + 拖长的倒影
        const wet = ctx.createLinearGradient(0, horizon, 0, h)
        wet.addColorStop(0, 'rgba(30, 60, 120, 0.30)')
        wet.addColorStop(0.35, 'rgba(14, 30, 66, 0.55)')
        wet.addColorStop(1, 'rgba(6, 12, 28, 0.85)')
        ctx.fillStyle = wet
        ctx.fillRect(0, horizon, w, h - horizon)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 26; i += 1) {
          const rx = rand(0, w)
          const strength = rand(0.05, 0.22)
          const band = ctx.createLinearGradient(rx, horizon, rx, h)
          band.addColorStop(0, `rgba(220, 235, 255, ${strength.toFixed(3)})`)
          band.addColorStop(1, 'rgba(220, 235, 255, 0)')
          ctx.fillStyle = band
          ctx.fillRect(rx, horizon, rand(1, 3), h - horizon)
        }
        // 积水里的光斑
        for (let i = 0; i < 16; i += 1) {
          const px = rand(0, w)
          const py = rand(horizon + 20, h)
          const pr = rand(18, 70)
          const pool = ctx.createRadialGradient(px, py, 0, px, py, pr)
          pool.addColorStop(0, `rgba(255, 200, 140, ${rand(0.04, 0.14).toFixed(3)})`)
          pool.addColorStop(1, 'rgba(255, 200, 140, 0)')
          ctx.fillStyle = pool
          ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2)
        }
        ctx.restore()

        paintVignette(ctx, w, h, 0.55)
        paintGrain(ctx, w, h, 0.05, false)
      })
      drops = []
      ripples = []
      glassDrops = []
      resizeList(drops, target, spawnDrop)
      glassDrops = Array.from({ length: 7 }, spawnGlass)
      fogs = Array.from({ length: 3 }, () => ({
        x: rand(-0.2 * w, w * 1.1),
        y: rand(h * 0.45, h * 0.85),
        w: rand(w * 0.35, w * 0.75),
        h: rand(h * 0.12, h * 0.3),
        vx: rand(4, 14) * (Math.random() < 0.5 ? -1 : 1),
        alpha: rand(0.05, 0.11),
      }))
      scheduleFlash()
    },
    configure(values) {
      speed = values.speed ?? 55
      wind = values.wind ?? 12
      const wasOff = !Number.isFinite(nextFlash)
      lightning = values.lightning ?? 20
      glow = (values.glow ?? 55) / 100
      // 每滴雨现在是一整条带辉光的雨丝，因此数量可以比线条版更少而观感更密
      target = Math.round(((values.density ?? 55) / 100) * 170 * areaFactor(width, height))
      resizeList(drops, target, spawnDrop)
      // 玻璃上的雨珠是「贴脸」的近景层，随密度 4–11 颗
      resizeList(glassDrops, Math.round(4 + ((values.density ?? 55) / 100) * 7), spawnGlass)
      if (lightning <= 0) nextFlash = Infinity
      else if (wasOff) scheduleFlash()
    },
    step(dt) {
      const fall = 320 + (speed / 100) * 900
      const drift = (wind / 100) * 220
      for (const drop of drops) {
        drop.y += fall * drop.speed * dt
        drop.x += drift * drop.speed * dt
        if (drop.y > height * ground) {
          // 落地：在近处溅起一圈涟漪
          if (drop.depth > 0.55 && ripples.length < 70) {
            const maxLife = rand(0.45, 0.95)
            ripples.push({ x: drop.x, y: height * ground + rand(0, height * (1 - ground)), r: 1, life: maxLife, maxLife })
          }
          const fresh = spawnDrop()
          fresh.y = rand(-height * 0.25, -10)
          Object.assign(drop, fresh)
        }
        if (drop.x > width + 100) drop.x -= width + 200
        if (drop.x < -100) drop.x += width + 200
      }
      // 玻璃上的雨珠：缓慢下滑，偶尔被风吹得歪一点
      for (const glass of glassDrops) {
        glass.phase += dt * 0.8
        glass.y += (glass.speed + Math.sin(glass.phase) * 3) * dt
        glass.x += Math.sin(glass.phase * 0.7) * 2 * dt + (wind / 100) * 6 * dt
        if (glass.y > height + 90) Object.assign(glass, spawnGlass(), { y: -100 })
      }
      for (const ripple of ripples) {
        ripple.life -= dt
        ripple.r += dt * 46
      }
      ripples = ripples.filter((ripple) => ripple.life > 0)
      for (const fog of fogs) {
        fog.x += fog.vx * dt
        if (fog.x < -fog.w) fog.x = width + fog.w * 0.3
        if (fog.x > width + fog.w) fog.x = -fog.w * 0.3
      }
      if (flash > 0) flash = Math.max(0, flash - dt * 2.4)
      if (bolt) {
        bolt.life -= dt * 3.6
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

      // 雾团：让雨幕有纵深
      if (haze) {
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        for (const fog of fogs) {
          ctx.globalAlpha = fog.alpha * (0.6 + glow * 0.6)
          ctx.drawImage(haze, fog.x, fog.y, fog.w, fog.h)
        }
        ctx.restore()
      }

      // 雨丝：逐滴只用一次 drawImage；风力决定用哪一档斜率，雨丝不歪得别扭
      const slant = ((wind / 100) * 220) / (320 + (speed / 100) * 900)
      const streak = streaks[clamp(Math.round(slant / 0.09), 0, SLOPES.length - 1)] ?? streaks[0]
      ctx.save()
      if (streak) {
        for (const drop of drops) {
          const spriteWidth = 7 + drop.depth * 9
          const spriteHeight = drop.len * 2.3
          ctx.globalAlpha = clamp(drop.alpha * (0.55 + glow * 0.7), 0, 1)
          ctx.drawImage(streak, drop.x - spriteWidth / 2, drop.y - spriteHeight * 0.72, spriteWidth, spriteHeight)
        }
      }
      ctx.globalAlpha = 1
      ctx.restore()

      // 地面涟漪
      ctx.save()
      ctx.lineWidth = 1
      for (const ripple of ripples) {
        const alpha = clamp(ripple.life / ripple.maxLife, 0, 1) * 0.4
        ctx.strokeStyle = `rgba(200, 225, 255, ${alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.32, 0, 0, TAU)
        ctx.stroke()
      }
      ctx.restore()

      // 闪电与整屏闪光
      if (bolt) {
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        ctx.lineJoin = 'round'
        const jitter = bolt.life * 8
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
        // 先粗后细：外层当作光晕，内层是电流本体
        ctx.strokeStyle = `rgba(150, 190, 255, ${(0.16 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 12
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(225, 240, 255, ${(0.5 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 3.2
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.85 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 1.2
        drawPath(bolt.points)
        ctx.strokeStyle = `rgba(200, 225, 255, ${(0.45 * bolt.life).toFixed(3)})`
        ctx.lineWidth = 1.4
        for (const branch of bolt.branches) drawPath(branch)
        if (backdrop) {
          const head = bolt.points[bolt.points.length - 1]
          const size = 420 * bolt.life + 160
          ctx.globalAlpha = 0.35 * bolt.life
          ctx.drawImage(backdrop, head.x - size / 2, head.y - size / 2, size, size)
        }
        ctx.restore()
      }

      // 贴在「玻璃」上的雨珠：最靠近镜头的一层
      if (glassSprite) {
        for (const glass of glassDrops) {
          const size = Math.min(width, height) * glass.size
          ctx.globalAlpha = glass.alpha * (0.5 + glow * 0.5)
          ctx.drawImage(glassSprite, glass.x - size * 0.375, glass.y - size * 0.5, size * 0.75, size)
        }
        ctx.globalAlpha = 1
      }

      if (flash > 0.01) {
        ctx.save()
        ctx.fillStyle = `rgba(178, 205, 255, ${(flash * flash * 0.16).toFixed(3)})`
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
      }
    },
  }
}

/* -------------------------------- 阳光 -------------------------------- */

/**
 * 体积光束贴图：把整圈光束一次性烘焙成一张「射线环」，
 * 绘制时只需旋转两次贴图（而不是每根光束建两个渐变），
 * 观感反而更接近真实的大气散射。
 */
function makeRayRingSprite(size: number, rays: number): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const center = size / 2
    const reach = size * 0.52
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < rays; i += 1) {
      const angle = (i / Math.max(1, rays)) * TAU + (i % 2 ? 0.018 : 0)
      const long = i % 3 === 0
      const rayReach = reach * (long ? 1 : 0.72)
      const spread = (long ? 0.016 : 0.03) + (i % 4) * 0.011
      const tipX = center + Math.cos(angle) * rayReach
      const tipY = center + Math.sin(angle) * rayReach
      const paintBeam = (width: number, alpha: number) => {
        const gradient = ctx.createLinearGradient(center, center, tipX, tipY)
        gradient.addColorStop(0, `rgba(255, 246, 220, ${alpha.toFixed(3)})`)
        gradient.addColorStop(0.32, `rgba(255, 241, 208, ${(alpha * 0.55).toFixed(3)})`)
        gradient.addColorStop(1, 'rgba(255, 236, 198, 0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(center, center)
        ctx.lineTo(
          center + Math.cos(angle - width) * rayReach,
          center + Math.sin(angle - width) * rayReach,
        )
        ctx.lineTo(
          center + Math.cos(angle + width) * rayReach,
          center + Math.sin(angle + width) * rayReach,
        )
        ctx.closePath()
        ctx.fill()
      }
      paintBeam(spread, 0.5)
      paintBeam(spread * 0.3, 0.8)
    }
    ctx.restore()
  })
}

function createSunshine(): Renderer {
  interface Mote {
    x: number
    y: number
    size: number
    rise: number
    phase: number
    alpha: number
    twinkle: boolean
  }
  interface Flare {
    t: number
    size: number
    color: [number, number, number]
    alpha: number
    ring: boolean
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let bokehSprite: HTMLCanvasElement | null = null
  let sparkle: HTMLCanvasElement | null = null
  let flareSprite: HTMLCanvasElement | null = null
  let flareRing: HTMLCanvasElement | null = null
  let streaks: HTMLCanvasElement | null = null
  let anamorphic: HTMLCanvasElement | null = null
  let sun = { x: 0, y: 0 }
  let motes: Mote[] = []
  let flares: Flare[] = []
  let target = 0
  let brightness = 0.6
  let rayCount = 13
  let rayRing: HTMLCanvasElement | null = null
  let rayKey = ''
  let drift = 0.35
  let flareAmount = 0.45
  let rayAngle = 0
  let step = 0

  const spawnMote = (): Mote => ({
    x: rand(0, width),
    y: rand(0, height),
    size: rand(1, 3.6),
    rise: rand(0.25, 1),
    phase: rand(0, TAU),
    alpha: rand(0.18, 0.6),
    twinkle: Math.random() < 0.16,
  })

  const buildRayRing = () => {
    // 贴图分辨率随主题无关，取屏幕长边即可；射线数量变化时才重建
    const size = Math.round(clamp(Math.max(width, height) * 1.05, 640, 1600))
    rayRing = makeRayRingSprite(size, rayCount)
    rayKey = `${rayCount}`
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      sun = { x: w * 0.78, y: h * 0.16 }
      bokehSprite = makeBokehSprite(255, 232, 190, 128, 0.5)
      sparkle = makeSparkleSprite(255, 250, 230, 64)
      flareSprite = makeBokehSprite(255, 214, 170, 96, 0.35)
      flareRing = paint(96, 96, (ctx) => {
        const gradient = ctx.createRadialGradient(48, 48, 24, 48, 48, 46)
        gradient.addColorStop(0, 'rgba(255,220,180,0)')
        gradient.addColorStop(0.72, 'rgba(255,220,180,0.34)')
        gradient.addColorStop(0.86, 'rgba(255,245,225,0.16)')
        gradient.addColorStop(1, 'rgba(255,220,180,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 96, 96)
      })
      // 横向的「变形宽银幕」光斑，镜头味最足的一笔
      anamorphic = paint(1024, 128, (ctx) => {
        const gradient = ctx.createLinearGradient(0, 64, 1024, 64)
        gradient.addColorStop(0, 'rgba(150, 210, 255, 0)')
        gradient.addColorStop(0.42, 'rgba(180, 225, 255, 0.28)')
        gradient.addColorStop(0.5, 'rgba(235, 246, 255, 0.6)')
        gradient.addColorStop(0.58, 'rgba(180, 225, 255, 0.28)')
        gradient.addColorStop(1, 'rgba(150, 210, 255, 0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 58, 1024, 12)
        const soft = ctx.createLinearGradient(0, 0, 0, 128)
        soft.addColorStop(0, 'rgba(200, 232, 255, 0)')
        soft.addColorStop(0.5, 'rgba(200, 232, 255, 0.18)')
        soft.addColorStop(1, 'rgba(200, 232, 255, 0)')
        ctx.fillStyle = soft
        ctx.fillRect(0, 0, 1024, 128)
      })
      streaks = paint(512, 512, (ctx) => {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 9; i += 1) {
          const y = rand(0, 512)
          const gradient = ctx.createLinearGradient(0, y, 512, y + rand(-40, 40))
          gradient.addColorStop(0, 'rgba(255,236,200,0)')
          gradient.addColorStop(0.5, `rgba(255,240,210,${rand(0.1, 0.3).toFixed(3)})`)
          gradient.addColorStop(1, 'rgba(255,236,200,0)')
          ctx.strokeStyle = gradient
          ctx.lineWidth = rand(2, 9)
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(512, y + rand(-40, 40))
          ctx.stroke()
        }
        ctx.restore()
      })
      flares = [
        { t: 0.28, size: 130, color: [255, 205, 150], alpha: 0.3, ring: false },
        { t: 0.52, size: 62, color: [180, 230, 255], alpha: 0.24, ring: false },
        { t: 0.76, size: 96, color: [255, 226, 170], alpha: 0.2, ring: true },
        { t: 1.08, size: 44, color: [200, 255, 220], alpha: 0.18, ring: false },
        { t: 1.34, size: 150, color: [255, 190, 210], alpha: 0.14, ring: true },
      ]
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, w * 0.4, h)
        sky.addColorStop(0, '#fff7e8')
        sky.addColorStop(0.42, '#fdf1e0')
        sky.addColorStop(1, '#f6ead9')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)

        // 太阳本体与暖色光晕
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const halo = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, Math.max(w, h) * 0.95)
        halo.addColorStop(0, 'rgba(255, 252, 235, 0.95)')
        halo.addColorStop(0.12, 'rgba(255, 236, 190, 0.72)')
        halo.addColorStop(0.32, 'rgba(255, 216, 160, 0.34)')
        halo.addColorStop(0.62, 'rgba(255, 200, 150, 0.13)')
        halo.addColorStop(1, 'rgba(255, 200, 150, 0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, w, h)
        const disc = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, Math.min(w, h) * 0.09)
        disc.addColorStop(0, 'rgba(255, 255, 250, 1)')
        disc.addColorStop(0.7, 'rgba(255, 246, 214, 0.85)')
        disc.addColorStop(1, 'rgba(255, 236, 190, 0)')
        ctx.fillStyle = disc
        ctx.fillRect(sun.x - w, sun.y - w, w * 2, w * 2)
        ctx.restore()

        // 远处的光尘（静态烘焙一部分，动态的部分数量就能少一些）
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 220; i += 1) {
          const px = rand(0, w)
          const py = rand(0, h)
          const pr = rand(3, 16)
          const blob = ctx.createRadialGradient(px, py, 0, px, py, pr)
          blob.addColorStop(0, `rgba(255, 244, 214, ${rand(0.05, 0.22).toFixed(3)})`)
          blob.addColorStop(1, 'rgba(255, 244, 214, 0)')
          ctx.fillStyle = blob
          ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2)
        }
        ctx.restore()

        paintVignette(ctx, w, h, 0.22)
        paintGrain(ctx, w, h, 0.04, true)
      })
      motes = []
      resizeList(motes, target, spawnMote)
      rayKey = ''
      buildRayRing()
    },
    configure(values) {
      brightness = (values.brightness ?? 60) / 100
      drift = (values.drift ?? 35) / 100
      flareAmount = (values.flare ?? 45) / 100
      const nextRays = clamp(Math.round(((values.rays ?? 50) / 100) * 22) + 4, 4, 30)
      if (`${nextRays}` !== rayKey) {
        rayCount = nextRays
        buildRayRing()
      }
      const density = (values.motes ?? 40) / 100
      // 光尘的静态部分已经烘焙在背景里，动态部分只保留最亮的那批
      target = Math.round(density * 150 * areaFactor(width, height))
      resizeList(motes, target, spawnMote)
    },
    step(dt) {
      step += dt
      rayAngle += dt * (0.015 + drift * 0.055)
      const rise = (4 + drift * 26) * dt
      for (const mote of motes) {
        mote.phase += dt * (0.6 + drift * 1.4)
        mote.y -= rise * mote.rise
        mote.x += Math.sin(mote.phase) * 9 * dt
        if (mote.y < -20) {
          mote.y = height + 20
          mote.x = rand(0, width)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      // 体积光束：整圈贴图旋转两层，一快一慢，交叠出流动的层次
      if (rayRing && rayCount > 0) {
        const size = Math.max(width, height) * 1.5
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        ctx.translate(sun.x, sun.y)
        ctx.globalAlpha = clamp(brightness * 0.95, 0, 1)
        ctx.rotate(rayAngle)
        ctx.drawImage(rayRing, -size / 2, -size / 2, size, size)
        ctx.globalAlpha = clamp(brightness * 0.55, 0, 1)
        ctx.rotate(-rayAngle * 1.35)
        const size2 = size * 1.14
        ctx.drawImage(rayRing, -size2 / 2, -size2 / 2, size2, size2)
        ctx.restore()
      }

      if (streaks) {
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        ctx.globalAlpha = clamp(0.25 * brightness, 0, 1)
        ctx.translate(sun.x, sun.y)
        ctx.rotate(rayAngle * 0.4)
        ctx.drawImage(streaks, -width, -height, width * 2, height * 2)
        ctx.restore()
      }

      // 镜头光斑：沿「太阳 → 屏幕中心」的轴线分布，含色散与光圈环
      if (flareAmount > 0.03) {
        const cx = width / 2
        const cy = height / 2
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (const flare of flares) {
          const fx = sun.x + (cx - sun.x) * flare.t
          const fy = sun.y + (cy - sun.y) * flare.t
          const sprite = flare.ring ? flareRing : flareSprite
          if (!sprite) continue
          const pulse = 0.85 + 0.15 * Math.sin(step * 1.2 + flare.t * 6)
          ctx.globalAlpha = clamp(flare.alpha * flareAmount * 2.4 * pulse * (0.4 + brightness), 0, 1)
          const size = flare.size * (0.9 + brightness * 0.6)
          ctx.drawImage(sprite, fx - size / 2, fy - size / 2, size, size)
          if (!flare.ring) {
            ctx.globalAlpha *= 0.5
            ctx.drawImage(sprite, fx - size * 0.62, fy - size * 0.62, size * 1.24, size * 1.24)
          }
        }
        // 横向变形光斑：在太阳高度上拉出一条细长的蓝白线
        if (anamorphic) {
          const aWidth = Math.max(width, height) * 1.5
          ctx.globalAlpha = clamp(flareAmount * 0.5 * (0.4 + brightness), 0, 1)
          ctx.drawImage(anamorphic, sun.x - aWidth / 2, sun.y - (aWidth / 8) / 2, aWidth, aWidth / 8)
        }
        ctx.restore()
      }

      // 光尘：柔和散景 + 少数带星芒的亮点
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const mote of motes) {
        const pulse = 0.65 + 0.35 * Math.sin(mote.phase)
        const alpha = clamp(mote.alpha * brightness * pulse, 0, 1)
        if (!alpha) continue
        ctx.globalAlpha = alpha
        if (mote.twinkle && sparkle) {
          const size = mote.size * 3.4
          ctx.drawImage(sparkle, mote.x - size / 2, mote.y - size / 2, size, size)
        } else if (bokehSprite) {
          const size = mote.size * 4.6
          ctx.drawImage(bokehSprite, mote.x - size / 2, mote.y - size / 2, size, size)
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 星空 -------------------------------- */

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
  }
  interface Meteor {
    x: number
    y: number
    vx: number
    vy: number
    life: number
    maxLife: number
    size: number
  }
  const TINTS: [number, number, number][] = [
    [230, 238, 255],
    [255, 255, 255],
    [198, 216, 255],
    [255, 236, 205],
    [255, 205, 190],
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

  /** 夜空贴图：渐变 + 银河 + 星云 + 噪点，只在尺寸或「星云浓度」变化时重建 */
  const buildSky = (ctx: CanvasRenderingContext2D) => {
    const w = width
    const h = height
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#02040d')
    sky.addColorStop(0.55, '#060c22')
    sky.addColorStop(1, '#0b1338')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // 银河：一条斜向的光带，里面撒满暗弱的小星
    ctx.save()
    ctx.translate(w * 0.5, h * 0.55)
    ctx.rotate(-0.5)
    const band = ctx.createLinearGradient(0, -h * 0.3, 0, h * 0.3)
    band.addColorStop(0, 'rgba(90, 120, 220, 0)')
    band.addColorStop(0.42, `rgba(150, 170, 255, ${(0.1 * nebula).toFixed(3)})`)
    band.addColorStop(0.5, `rgba(232, 224, 255, ${(0.17 * nebula).toFixed(3)})`)
    band.addColorStop(0.6, `rgba(170, 150, 255, ${(0.1 * nebula).toFixed(3)})`)
    band.addColorStop(1, 'rgba(90, 120, 220, 0)')
    ctx.fillStyle = band
    ctx.fillRect(-w, -h * 0.3, w * 2, h * 0.6)
    for (let i = 0; i < 900; i += 1) {
      const px = rand(-w, w)
      const py = rand(-h * 0.3, h * 0.3)
      const fade = 1 - Math.abs(py) / (h * 0.3)
      ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.32 * fade * nebula).toFixed(3)})`
      ctx.fillRect(px, py, 0.9, 0.9)
    }
    ctx.restore()

    // 两团彩色星云
    const nebulae: { x: number; y: number; radius: number; color: [number, number, number] }[] = [
      { x: w * 0.22, y: h * 0.28, radius: Math.max(w, h) * 0.42, color: [150, 100, 255] },
      { x: w * 0.82, y: h * 0.68, radius: Math.max(w, h) * 0.4, color: [60, 140, 220] },
      { x: w * 0.6, y: h * 0.16, radius: Math.max(w, h) * 0.3, color: [220, 120, 180] },
    ]
    for (const item of nebulae) {
      const gradient = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.radius)
      const [r, g, b] = item.color
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(0.17 * nebula).toFixed(3)})`)
      gradient.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${(0.07 * nebula).toFixed(3)})`)
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
      ctx.fillStyle = gradient
      ctx.fillRect(item.x - item.radius, item.y - item.radius, item.radius * 2, item.radius * 2)
    }
    ctx.restore()

    // 远景星场：这些星又小又暗、几乎不闪，直接烘进贴图，每帧零成本
    const staticCount = Math.round(Math.max(0, bakedDensity) * 460 * areaFactor(w, h))
    const glow = bakedBrightness > 0 ? clamp(0.45 + bakedBrightness * 0.75, 0.2, 1.1) : 1
    for (let i = 0; i < staticCount; i += 1) {
      const px = rand(0, w)
      const py = rand(0, h)
      const size = Math.random() < 0.06 ? rand(1.1, 1.9) : rand(0.4, 1.05)
      const alpha = rand(0.18, 0.72) * glow
      const [r, g, b] = TINTS[Math.floor(rand(0, TINTS.length))]
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
      ctx.fillRect(px, py, size, size)
      // 少数亮些的远景星带一点点光晕，让整片星空不至于死板
      if (size > 1.2) {
        ctx.globalAlpha = clamp(alpha * 0.5, 0, 1)
        const halo = size * 6
        ctx.drawImage(starSprites[Math.floor(rand(0, starSprites.length))], px - halo / 2, py - halo / 2, halo, halo)
        ctx.globalAlpha = 1
      }
    }

    paintVignette(ctx, w, h, 0.5)
    paintGrain(ctx, w, h, 0.05, true)
  }

  const spawnStar = (): Star => {
    const layer = Math.random()
    return {
      x: rand(0, width),
      y: rand(0, height),
      size: layer > 0.84 ? rand(1.8, 2.8) : layer > 0.5 ? rand(1.1, 1.8) : rand(0.8, 1.2),
      phase: rand(0, TAU),
      speed: rand(0.5, 2),
      base: rand(0.45, 1),
      tint: Math.floor(rand(0, TINTS.length)),
      layer,
    }
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      starSprites = TINTS.map(([r, g, b]) => makeGlowSprite(r, g, b, 64))
      spikes = makeSparkleSprite(255, 250, 240, 96)
      meteorGlow = makeGlowSprite(214, 232, 255, 128)
      // 彗尾贴图：亮头 → 电离尾迹 → 全透明
      meteorStreak = paint(256, 16, (ctx) => {
        const body = ctx.createLinearGradient(0, 0, 256, 0)
        body.addColorStop(0, 'rgba(255,255,255,0)')
        body.addColorStop(0.5, 'rgba(196, 222, 255, 0.35)')
        body.addColorStop(0.88, 'rgba(226, 238, 255, 0.85)')
        body.addColorStop(1, 'rgba(255,255,255,1)')
        ctx.fillStyle = body
        ctx.fillRect(0, 6, 256, 4)
        const soft = ctx.createLinearGradient(0, 0, 256, 0)
        soft.addColorStop(0, 'rgba(180, 210, 255, 0)')
        soft.addColorStop(1, 'rgba(200, 226, 255, 0.5)')
        ctx.fillStyle = soft
        ctx.fillRect(0, 3, 256, 10)
        const head = ctx.createRadialGradient(252, 8, 0, 252, 8, 8)
        head.addColorStop(0, 'rgba(255,255,255,1)')
        head.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = head
        ctx.fillRect(240, 0, 16, 16)
      })
      bakedDensity = 1
      bakedBrightness = 1
      background = paintBackground(w, h, buildSky)
      stars = []
      resizeList(stars, target, spawnStar)
    },
    configure(values) {
      twinkle = (values.twinkle ?? 50) / 100
      meteorRate = ((values.meteor ?? 30) / 100) * 0.22
      brightness = (values.brightness ?? 60) / 100
      // 动态层只保留约三分之一的亮星（会闪烁、会漂移），其余烘进夜空
      const densityNorm = (values.density ?? 50) / 100
      target = Math.round(densityNorm * 210 * areaFactor(width, height))
      resizeList(stars, target, spawnStar)
      // 星云浓度 / 密度 / 亮度变化时重画夜空贴图（每帧仍然只贴一次图）
      const nextNebula = clamp((values.nebula ?? 45) / 100, 0, 1)
      const nebulaChanged = Math.abs(nextNebula - nebula) > 0.02
      const densityChanged = Math.abs(densityNorm - bakedDensity) > 0.05
      const brightnessChanged = Math.abs(brightness - bakedBrightness) > 0.08
      if (nebulaChanged || densityChanged || brightnessChanged) {
        nebula = nextNebula
        bakedDensity = densityNorm
        bakedBrightness = brightness
        background = paintBackground(width, height, buildSky)
      }
    },
    step(dt) {
      driftTime += dt
      for (const star of stars) {
        star.phase += dt * star.speed * (0.5 + twinkle)
        // 极缓慢的视差漂移，让星空「活」起来
        star.x -= dt * star.layer * 1.6
        if (star.x < -4) star.x = width + 4
      }
      if (meteorRate > 0 && Math.random() < meteorRate * dt) {
        const maxLife = rand(0.9, 1.5)
        meteors.push({
          x: rand(width * 0.3, width + 80),
          y: rand(-40, height * 0.45),
          vx: -rand(520, 900),
          vy: rand(240, 420),
          life: maxLife,
          maxLife,
          size: rand(0.8, 1.5),
        })
      }
      for (const meteor of meteors) {
        meteor.x += meteor.vx * dt
        meteor.y += meteor.vy * dt
        meteor.life -= dt
      }
      meteors = meteors.filter((meteor) => meteor.life > 0 && meteor.y < height + 80)
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const star of stars) {
        const alpha = clamp(
          star.base * brightness * (0.6 + 0.4 * Math.sin(star.phase)) * (0.7 + twinkle * 0.3),
          0,
          1,
        )
        if (!alpha) continue
        ctx.globalAlpha = alpha
        const sprite = starSprites[star.tint]
        if (!sprite) continue
        if (star.size > 2.1 && spikes) {
          // 最亮的几颗带四芒星芒
          const size = star.size * 15
          ctx.drawImage(spikes, star.x - size / 2, star.y - size / 2, size, size)
        }
        const size = star.size * 8
        ctx.drawImage(sprite, star.x - size / 2, star.y - size / 2, size, size)
      }

      // 流星：头部光斑 + 渐隐彗尾（贴图 + 旋转，不再逐帧建渐变）
      if (meteorStreak) {
        for (const meteor of meteors) {
          const fade = clamp(meteor.life / meteor.maxLife, 0, 1)
          const angle = Math.atan2(meteor.vy, meteor.vx)
          const length = 190 * meteor.size
          const thickness = 9 * meteor.size
          ctx.save()
          ctx.translate(meteor.x, meteor.y)
          ctx.rotate(angle)
          ctx.globalAlpha = fade * brightness
          ctx.drawImage(meteorStreak, -length * 0.82, -thickness * 0.28, length, thickness * 0.56)
          ctx.restore()
          if (meteorGlow) {
            const size = 26 * meteor.size
            ctx.globalAlpha = fade * brightness * 0.8
            ctx.drawImage(meteorGlow, meteor.x - size / 2, meteor.y - size / 2, size, size)
          }
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 极光 -------------------------------- */

/** 预渲染一条「带竖纹的极光帘幕」：竖直渐隐、左右柔化、内部还有细密的射线 */
function makeCurtainSprite(rgb: [number, number, number]): HTMLCanvasElement {
  const w = 160
  const h = 320
  return paint(w, h, (ctx) => {
    const [r, g, b] = rgb
    const vertical = ctx.createLinearGradient(0, 0, 0, h)
    vertical.addColorStop(0, `rgba(${r},${g},${b},0.95)`)
    vertical.addColorStop(0.18, `rgba(${r},${g},${b},0.55)`)
    vertical.addColorStop(0.55, `rgba(${r},${g},${b},0.26)`)
    vertical.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = vertical
    ctx.fillRect(0, 0, w, h)
    // 竖纹：极光特有的射线结构
    ctx.globalCompositeOperation = 'destination-out'
    for (let x = 0; x < w; x += 4) {
      const strength = Math.random() < 0.42 ? rand(0.12, 0.5) : 0
      if (!strength) continue
      const strip = ctx.createLinearGradient(x, 0, x + 4, 0)
      strip.addColorStop(0, `rgba(0,0,0,0)`)
      strip.addColorStop(0.5, `rgba(0,0,0,${strength.toFixed(3)})`)
      strip.addColorStop(1, `rgba(0,0,0,0)`)
      ctx.fillStyle = strip
      ctx.fillRect(x, 0, 4, h)
    }
    ctx.globalCompositeOperation = 'destination-in'
    const horizontal = ctx.createLinearGradient(0, 0, w, 0)
    horizontal.addColorStop(0, 'rgba(0,0,0,0)')
    horizontal.addColorStop(0.5, 'rgba(0,0,0,1)')
    horizontal.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = horizontal
    ctx.fillRect(0, 0, w, h)
  })
}

function createAurora(): Renderer {
  interface Band {
    y: number
    amp: number
    height: number
    phase: number
    speed: number
    waves: number
    alpha: number
    color: [number, number, number]
    sprite: HTMLCanvasElement
    /** 整屏帘幕贴图（按层烘焙，每帧只平移贴图） */
    sheet: HTMLCanvasElement
    offset: number
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let bands: Band[] = []
  let intensity = 0.7
  let flow = 0.5
  let hueShift = 0
  let rayAmount = 0.55
  let count = 4
  let spriteKey = ''
  let time = 0

  /**
   * 把「一层极光」烘焙成一张与屏幕等宽的贴图。
   *
   * 旧写法每帧要按 48px 切片画几百次 drawImage（6 层就是 300+ 次），
   * 现在只在主题色 / 层数 / 光线强度变化时烘焙一次，之后每帧只做几次平移贴图。
   * 每层单独烘焙，所以每层保留自己的色相与流速，滚动速度不同就形成了「翻卷」的层次感。
   */
  const buildSheet = (band: Band): HTMLCanvasElement => {
    // 半分辨率：极光本身很柔，缩小一半画好再放大，肉眼几乎无差，显存与填充都省一半
    const w = Math.max(1, Math.round(width * 0.5))
    const span = Math.max(1, Math.round(height * 0.95 * 0.5))
    const bandTop = band.y * 0.5
    const bandHeight = band.height * 0.5
    const bandAmp = band.amp * 0.5
    const slice = 23
    const spriteWidth = slice * 1.55
    return paint(w, span, (ctx) => {
      const curtainHeight = bandHeight * 0.86
      for (let x = -slice; x < w + slice; x += slice) {
        const t = ((x % w) + w) % w
        const phase = (t / w) * TAU * band.waves + band.phase
        const top = bandTop + Math.sin(phase) * bandAmp * 1.35
        ctx.drawImage(band.sprite, x - spriteWidth / 2, top, spriteWidth, curtainHeight)
      }
      // 竖直光柱：极光特有的射线，数量由「光线强度」参数控制
      const rays = Math.round(6 + rayAmount * 30)
      const [r, g, b] = band.color
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = clamp(0.16 + rayAmount * 0.55, 0, 1)
      for (let i = 0; i < rays; i += 1) {
        const x = rand(0, w)
        const top = bandTop + rand(-bandAmp, bandAmp)
        const len = bandHeight * rand(0.5, 0.95)
        const beam = ctx.createLinearGradient(0, top, 0, top + len)
        beam.addColorStop(0, `rgba(${r},${g},${b},0.55)`)
        beam.addColorStop(0.45, `rgba(${r},${g},${b},0.2)`)
        beam.addColorStop(1, `rgba(${r},${g},${b},0)`)
        ctx.fillStyle = beam
        ctx.fillRect(x, top, rand(1.5, 5.5), len)
      }
      ctx.restore()
    })
  }

  const buildBands = () => {
    const { rgb } = themeColors()
    const { h, s } = toHsl(rgb)
    const previous = bands
    bands = Array.from({ length: count }, (_, index) => {
      const spread = index - (count - 1) / 2
      const hue = h + hueShift + spread * 24
      const lightness = 0.58 + (index % 2) * 0.07
      const color = hslToRgb(hue, clamp(s * 0.85 + 0.25, 0.35, 0.95), lightness)
      const reused = previous[index]
      const sprite = makeCurtainSprite(color)
      const base = reused
        ? { ...reused, color, sprite }
        : {
            y: height * rand(0.01, 0.2),
            amp: height * rand(0.04, 0.13),
            height: height * rand(0.34, 0.76),
            phase: rand(0, TAU),
            speed: rand(9, 26),
            // 整数波数 → 贴图左右边缘同相位，横向无缝平铺
            waves: Math.max(1, Math.round(rand(0.7, 2.4))),
            alpha: rand(0.34, 0.68),
            color,
            sprite,
            offset: rand(0, 1),
          }
      const band = { ...base, sheet: buildSheet(base as Band) } as Band
      return band
    })
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      spriteKey = ''
      const horizon = h * 0.82
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#01030a')
        sky.addColorStop(0.5, '#040a1c')
        sky.addColorStop(1, '#071129')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        // 背景星空
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const starCount = Math.round(700 * areaFactor(w, h))
        for (let i = 0; i < starCount; i += 1) {
          const sx = rand(0, w)
          const sy = rand(0, h * 0.85)
          const alpha = rand(0.1, 0.7)
          const size = Math.random() < 0.06 ? rand(1.1, 1.8) : rand(0.5, 1.1)
          ctx.fillStyle = `rgba(226, 236, 255, ${alpha.toFixed(3)})`
          ctx.fillRect(sx, sy, size, size)
        }
        ctx.restore()
        // 地平线附近的冷光
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const horizonGlow = ctx.createLinearGradient(0, horizon - h * 0.12, 0, horizon + h * 0.05)
        horizonGlow.addColorStop(0, 'rgba(60, 120, 170, 0)')
        horizonGlow.addColorStop(0.6, 'rgba(70, 140, 190, 0.16)')
        horizonGlow.addColorStop(1, 'rgba(70, 140, 190, 0)')
        ctx.fillStyle = horizonGlow
        ctx.fillRect(0, horizon - h * 0.12, w, h * 0.17)
        ctx.restore()
        // 地面剪影
        const groundFill = ctx.createLinearGradient(0, horizon, 0, h)
        groundFill.addColorStop(0, 'rgba(3, 6, 15, 0.92)')
        groundFill.addColorStop(1, 'rgba(1, 3, 9, 1)')
        ctx.fillStyle = groundFill
        ctx.beginPath()
        ctx.moveTo(0, horizon)
        for (let x = 0; x <= w; x += 24) {
          ctx.lineTo(x, horizon + Math.sin(x * 0.0055) * 12 + Math.sin(x * 0.017) * 5)
        }
        ctx.lineTo(w, h)
        ctx.lineTo(0, h)
        ctx.closePath()
        ctx.fill()
        paintVignette(ctx, w, h, 0.58)
        paintGrain(ctx, w, h, 0.05, true)
      })
      buildBands()
    },
    configure(values) {
      intensity = (values.intensity ?? 70) / 100
      flow = (values.flow ?? 50) / 100
      hueShift = (values.hue ?? 0) * 1.4
      rayAmount = (values.rays ?? 55) / 100
      const next = clamp(Math.round(((values.layers ?? 50) / 100) * 4) + 2, 2, 6)
      const key = [
        next,
        Math.round(hueShift),
        themeColors().accent,
        Math.round(rayAmount * 10),
        Math.round(width),
        Math.round(height),
      ].join('|')
      if (key !== spriteKey || bands.length !== next) {
        spriteKey = key
        count = next
        buildBands()
      }
    },
    step(dt) {
      time += dt
      // 每层流速不同 → 帘幕互相错开，读起来就是极光在慢慢翻卷
      for (let index = 0; index < bands.length; index += 1) {
        const band = bands[index]
        band.offset += ((dt * band.speed * (0.35 + flow * 1.7)) / Math.max(1, width)) * (1 + index * 0.12)
        if (band.offset > 1) band.offset -= 1
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const horizon = height * 0.82
      const breathe = 0.92 + 0.08 * Math.sin(time * 0.35)

      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      for (const band of bands) {
        const sheet = band.sheet
        // 贴图是半分辨率烘焙的，按屏幕宽度贴回去时高度同样放大两倍
        const drawHeight = sheet.height * 2
        const baseX = band.offset * width
        const x0 = ((baseX % width) + width) % width - width
        ctx.globalAlpha = clamp(band.alpha * intensity * 1.6 * breathe, 0, 1)
        ctx.drawImage(sheet, x0, 0, width, drawHeight)
        ctx.drawImage(sheet, x0 + width, 0, width, drawHeight)
        // 倒影：同一张贴图在地平线下方竖向压扁，亮的部分正好贴着地平线
        ctx.globalAlpha = clamp(band.alpha * intensity * 0.34, 0, 1)
        ctx.save()
        ctx.translate(0, horizon)
        ctx.scale(1, 0.3)
        ctx.drawImage(sheet, x0, 0, width, drawHeight)
        ctx.drawImage(sheet, x0 + width, 0, width, drawHeight)
        ctx.restore()
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

function createWaves(): Renderer {
  interface Layer {
    amplitude: number
    length: number
    speed: number
    phase: number
    base: number
    alpha: number
    sheen: number
  }
  interface Foam {
    x: number
    y: number
    life: number
    maxLife: number
    size: number
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let sparkle: HTMLCanvasElement | null = null
  let bokeh: HTMLCanvasElement | null = null
  let layers: Layer[] = []
  let foams: Foam[] = []
  let glitter: HTMLCanvasElement | null = null
  let amplitudeScale = 0.6
  let speedScale = 0.5
  let depthScale = 0.55
  let foamAmount = 0.5
  let count = 4
  let accent: [number, number, number] = [53, 99, 246]
  let time = 0

  const build = () => {
    layers = Array.from({ length: count }, (_, index) => {
      const t = index / Math.max(1, count)
      return {
        amplitude: height * (0.012 + t * 0.055),
        length: rand(0.6, 1.5) + index * 0.22,
        speed: rand(0.16, 0.5),
        phase: rand(0, TAU),
        base: height * (0.42 + t * 0.52),
        alpha: 0.1 + t * 0.18,
        sheen: 0.2 + t * 0.6,
      }
    })
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      const colors = themeColors()
      accent = colors.rgb
      sparkle = makeSparkleSprite(255, 255, 255, 64)
      bokeh = makeBokehSprite(255, 255, 255, 128, 0.4)
      // 水面碎光毯：一块可以横向循环平铺的「闪点」贴图，逐帧只需两次平移贴图
      glitter = paint(640, 360, (ctx) => {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const glint = makeSparkleSprite(255, 252, 235, 48)
        for (let i = 0; i < 220; i += 1) {
          const size = rand(5, 20)
          const x = rand(0, 640)
          const y = rand(0, 360)
          ctx.globalAlpha = rand(0.05, 0.4)
          ctx.drawImage(glint, x - size / 2, y - size / 2, size, size)
        }
        // 水平的细碎高光条纹，模拟水面的波纹反光
        for (let i = 0; i < 120; i += 1) {
          const y = rand(0, 360)
          const w = rand(8, 60)
          const x = rand(0, 640)
          ctx.globalAlpha = rand(0.05, 0.3)
          ctx.fillStyle = 'rgba(255, 252, 240, 1)'
          ctx.fillRect(x, y, w, rand(0.8, 2))
        }
        ctx.restore()
      })
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#f8fcff')
        sky.addColorStop(0.45, '#eef7fd')
        sky.addColorStop(1, '#dcebf7')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        // 天空里的太阳与云隙光
        const sunX = w * 0.72
        const sunY = h * 0.18
        const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(w, h) * 0.7)
        sunGrad.addColorStop(0, 'rgba(255, 252, 235, 0.9)')
        sunGrad.addColorStop(0.2, 'rgba(255, 240, 200, 0.4)')
        sunGrad.addColorStop(1, 'rgba(255, 240, 200, 0)')
        ctx.fillStyle = sunGrad
        ctx.fillRect(0, 0, w, h)
        for (let i = 0; i < 8; i += 1) {
          const angle = -0.5 + i * 0.16
          const length = Math.max(w, h) * 1.2
          const gradient = ctx.createLinearGradient(sunX, sunY, sunX + Math.cos(angle) * length, sunY + Math.sin(angle) * length)
          gradient.addColorStop(0, `rgba(255, 246, 220, ${rand(0.12, 0.24).toFixed(3)})`)
          gradient.addColorStop(1, 'rgba(255, 246, 220, 0)')
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.moveTo(sunX, sunY)
          ctx.lineTo(sunX + Math.cos(angle - 0.03) * length, sunY + Math.sin(angle - 0.03) * length)
          ctx.lineTo(sunX + Math.cos(angle + 0.03) * length, sunY + Math.sin(angle + 0.03) * length)
          ctx.closePath()
          ctx.fill()
        }
        // 海面上的阳光反射带：竖着的碎光
        const glintTop = h * 0.42
        for (let i = 0; i < 260; i += 1) {
          const t = Math.random()
          const gx = sunX + rand(-1, 1) * (30 + t * w * 0.34)
          const gy = glintTop + t * (h - glintTop)
          const gw = rand(2, 26) * (0.4 + t)
          const gh = rand(1, 3)
          ctx.fillStyle = `rgba(255, 250, 225, ${rand(0.1, 0.5).toFixed(3)})`
          ctx.fillRect(gx - gw / 2, gy, gw, gh)
        }
        // 云
        for (let i = 0; i < 16; i += 1) {
          const cx = rand(0, w)
          const cy = rand(h * 0.05, h * 0.4)
          const radius = rand(80, 260)
          const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
          cloud.addColorStop(0, `rgba(255, 255, 255, ${rand(0.25, 0.55).toFixed(3)})`)
          cloud.addColorStop(1, 'rgba(255, 255, 255, 0)')
          ctx.fillStyle = cloud
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
        }
        ctx.restore()
        paintVignette(ctx, w, h, 0.2)
        paintGrain(ctx, w, h, 0.04, true)
      })
      build()
    },
    configure(values) {
      amplitudeScale = 0.3 + ((values.amplitude ?? 50) / 100) * 1.5
      speedScale = 0.2 + ((values.speed ?? 50) / 100) * 1.9
      depthScale = 0.35 + ((values.depth ?? 55) / 100) * 0.6
      foamAmount = (values.foam ?? 50) / 100
      const next = clamp(Math.round(((values.layers ?? 50) / 100) * 3) + 2, 2, 5)
      if (next !== count) count = next
      build()
    },
    step(dt) {
      time += dt
      for (const layer of layers) layer.phase += dt * layer.speed * speedScale
      // 浪尖上不断冒出泡沫
      const chance = foamAmount * 6 * dt
      for (const layer of layers) {
        if (Math.random() < chance && foams.length < 120) {
          const maxLife = rand(0.6, 1.4)
          const crestY = height * (1 - depthScale) + layer.base * depthScale * 0.5 - layer.amplitude * amplitudeScale
          foams.push({
            x: rand(0, width),
            y: clamp(crestY + rand(-8, 18), 0, height),
            life: maxLife,
            maxLife,
            size: rand(6, 16) * (0.6 + foamAmount),
          })
        }
      }
      for (const foam of foams) foam.life -= dt
      foams = foams.filter((foam) => foam.life > 0)
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const [r, g, b] = accent

      ctx.save()
      for (const layer of layers) {
        const top = height * (1 - depthScale) + layer.base * depthScale * 0.5
        const waveY = (x: number) => {
          const t = (x / Math.max(1, width)) * TAU * layer.length
          return (
            top +
            Math.sin(t + layer.phase) * layer.amplitude * amplitudeScale +
            Math.sin(t * 2.4 + layer.phase * 1.6) * layer.amplitude * 0.34 * amplitudeScale
          )
        }
        const sampleStep = width > 1600 ? 22 : 14
        ctx.beginPath()
        ctx.moveTo(0, height)
        ctx.lineTo(0, waveY(0))
        for (let x = 0; x <= width + sampleStep; x += sampleStep) ctx.lineTo(x, waveY(x))
        ctx.lineTo(width, height)
        ctx.closePath()
        const gradient = ctx.createLinearGradient(0, top - layer.amplitude, 0, height)
        gradient.addColorStop(0, rgbString([Math.round(r * 0.6 + 90), Math.round(g * 0.6 + 130), Math.round(b * 0.6 + 170)], layer.alpha * 1.6))
        gradient.addColorStop(0.45, rgbString([r, g, b], layer.alpha * 1.15))
        gradient.addColorStop(1, rgbString([Math.round(r * 0.7), Math.round(g * 0.7), Math.round(b * 0.75)], layer.alpha * 0.5))
        ctx.fillStyle = gradient
        ctx.fill()
        // 浪尖高光
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = `rgba(255,255,255,${(layer.sheen * 0.6).toFixed(3)})`
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(0, waveY(0))
        for (let x = 0; x <= width + sampleStep; x += sampleStep) ctx.lineTo(x, waveY(x))
        ctx.stroke()
        ctx.restore()
      }

      // 泡沫：浪尖上的星芒与柔和光点
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const foam of foams) {
        const fade = clamp(foam.life / foam.maxLife, 0, 1)
        const size = foam.size * (1.4 - fade * 0.4)
        ctx.globalAlpha = fade * 0.9
        if (sparkle) ctx.drawImage(sparkle, foam.x - size / 2, foam.y - size / 2, size, size)
        if (bokeh) {
          ctx.globalAlpha = fade * 0.5
          const soft = size * 2.4
          ctx.drawImage(bokeh, foam.x - soft / 2, foam.y - soft / 2, soft, soft)
        }
      }
      // 水面碎光：两次循环平移贴图，闪烁由一个缓慢的透明度呼吸带来
      if (glitter) {
        const waterTop = height * (1 - depthScale)
        const waterHeight = height - waterTop
        const scale = 219
        const tileWidth = scale * 2
        const tileHeight = waterHeight
        const offsetA = (time * 26 * (0.4 + speedScale)) % tileWidth
        const offsetB = (time * 15 * (0.4 + speedScale)) % tileWidth
        ctx.globalAlpha = clamp(0.5 + 0.25 * Math.sin(time * 0.8), 0, 1)
        for (let k = -1; k <= 1; k += 1) {
          ctx.drawImage(glitter, k * tileWidth - offsetA, waterTop, tileWidth, tileHeight)
          ctx.drawImage(glitter, k * tileWidth - offsetB, waterTop, tileWidth, tileHeight)
        }
        ctx.globalAlpha = 1
      }
      ctx.restore()
      ctx.restore()
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
