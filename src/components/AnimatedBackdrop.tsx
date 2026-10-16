import { useEffect, useRef } from 'react'
import type { ActiveSceneId, SceneValues } from '../lib/animatedBackground'

/**
 * 全屏动态背景（樱花 / 粒子星链）。
 *
 * 画面构成分为三层，逐层叠加：
 *   ① 远景：一次性画进离屏 canvas 贴图（天空渐变、逆光光斑、暗角…），
 *      每帧只做一次 drawImage，因此再华丽也不增加逐帧开销；
 *   ② 中景：流动的粒子与光效（花瓣、光点与连线…）；
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

function createRenderer(scene: ActiveSceneId): Renderer {
  switch (scene) {
    case 'sakura':
      return createSakura()
    case 'network':
      return createNetwork()
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
