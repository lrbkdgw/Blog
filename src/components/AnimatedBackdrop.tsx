import { useEffect, useRef } from 'react'
import type { ActiveSceneId, SceneValues } from '../lib/animatedBackground'
import { useTheme } from '../lib/theme'
import { createSnow, createRain, createBamboo } from './WeatherBackdrops'

/**
 * 全屏动态背景（樱花 / 粒子星链 / 雪花 / 暴雨 / 竹林），所有场景都跟随站点的明暗模式换一套配色。
 *
 * 画面构成分为三层，逐层叠加：
 *   ① 远景：一次性烘焙进离屏 canvas 贴图（天幕渐变、云霞、远山、繁花虬枝、星云星盘、暗角…），
 *      每帧只做一次 drawImage，因此再细腻也不增加逐帧开销；
 *   ② 中景：60fps 丝滑流动的主体粒子与光效（翻飞樱瓣、多跳星链脉冲、晶莹雪晶、液态雨珠、风竹…）；
 *   ③ 光效：柔焦散景、星芒、花粉流萤、水面微澜等，统一使用预烘焙贴图合成，绝不在逐帧循环里创建渐变。
 *
 * 性能与体验策略：
 *   - 单个主画布 + 切换时 420ms 电影感叠化过渡层，像素比上限 1.5；
 *   - 所有光点、花瓣、星芒、柔光均在 1:1 贴图空间预烘焙再双线性缩放，彻底消除色阶接缝；
 *   - 粒子数量按屏幕面积自适应缩放并设上限，两侧构图丰盈、中央阅读走廊柔和降噪；
 *   - 标签页隐藏时暂停动画，系统开启「减少动态效果」时只绘制一帧静态画面。
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
  /** 明暗模式变化：重建与配色相关的贴图（粒子本身保留） */
  setTone?(dark: boolean): void
}

/* ------------------------------ 通用工具 ------------------------------ */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rand = (min: number, max: number) => min + Math.random() * (max - min)
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

/** 调整粒子数组长度；新粒子由 make 创建 */
function resizeList<T>(list: T[], target: number, make: () => T) {
  if (list.length > target) list.length = target
  while (list.length < target) list.push(make())
}

/** 新建离屏 canvas 并交给 painter 绘制（一块画布只取一次上下文，避免代理重置） */
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

/**
 * 1:1 空间预烘焙椭圆柔光缓存：
 * 绝不在 ctx.scale(rx, ry) 之后创建小半径 radialGradient，消除 Skia 采样色阶竖缝。
 */
const softBlobCache = new Map<string, HTMLCanvasElement>()
function softBlobSprite(stops: Array<[number, string]>, size = 256): HTMLCanvasElement {
  const key = `${size}:${stops.map(([o, c]) => `${o}|${c}`).join(';')}`
  const hit = softBlobCache.get(key)
  if (hit) return hit
  const sprite = paint(size, size, (ctx) => {
    const half = size / 2
    const g = ctx.createRadialGradient(half, half, 0, half, half, half)
    for (const [offset, color] of stops) g.addColorStop(offset, color)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  })
  softBlobCache.set(key, sprite)
  return sprite
}

function drawSoftBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  stops: Array<[number, string]>,
) {
  const radiusX = Math.max(1, rx)
  const radiusY = Math.max(1, ry)
  const sprite = softBlobSprite(stops)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sprite, cx - radiusX, cy - radiusY, radiusX * 2, radiusY * 2)
  ctx.restore()
}

/** 柔和的圆形光晕（颜色 + 半径），用于光点、花粉、流萤 */
function makeGlowSprite(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`)
    gradient.addColorStop(0.2, `rgba(${r},${g},${b},0.62)`)
    gradient.addColorStop(0.52, `rgba(${r},${g},${b},0.16)`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/**
 * 梦幻柔焦镜头散景：采用宽余弦羽化与温润光晕过渡，彻底消除硬边肥皂泡圆环感。
 */
function makeBokehSprite(r: number, g: number, b: number, size = 128, rim = 0.28): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, `rgba(${r},${g},${b},${(rim * 0.95).toFixed(3)})`)
    gradient.addColorStop(0.38, `rgba(${r},${g},${b},${(rim * 0.82).toFixed(3)})`)
    gradient.addColorStop(0.66, `rgba(${r},${g},${b},${(rim * 0.62).toFixed(3)})`)
    gradient.addColorStop(0.84, `rgba(${r},${g},${b},${(rim * 0.26).toFixed(3)})`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/** 纤细六芒/四芒星耀贴图：针状渐隐星芒 + 柔和光核，精致清透 */
function makeSparkleSprite(r: number, g: number, b: number, size = 96, coreWhite = true): HTMLCanvasElement {
  return paint(size, size, (ctx) => {
    const half = size / 2
    const drawRay = (angle: number, lengthFactor: number, thickness: number, peakAlpha: number) => {
      ctx.save()
      ctx.translate(half, half)
      ctx.rotate(angle)
      const len = half * lengthFactor
      const ray = ctx.createLinearGradient(-len, 0, len, 0)
      ray.addColorStop(0, `rgba(${r},${g},${b},0)`)
      ray.addColorStop(0.35, `rgba(${r},${g},${b},${(peakAlpha * 0.35).toFixed(3)})`)
      ray.addColorStop(0.5, coreWhite ? `rgba(255,255,255,${peakAlpha.toFixed(3)})` : `rgba(${r},${g},${b},${peakAlpha.toFixed(3)})`)
      ray.addColorStop(0.65, `rgba(${r},${g},${b},${(peakAlpha * 0.35).toFixed(3)})`)
      ray.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = ray
      ctx.beginPath()
      ctx.moveTo(-len, 0)
      ctx.quadraticCurveTo(0, -thickness, len, 0)
      ctx.quadraticCurveTo(0, thickness, -len, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    drawRay(0, 0.96, size * 0.022, 0.92)
    drawRay(Math.PI / 2, 0.96, size * 0.022, 0.92)
    drawRay(Math.PI / 4, 0.56, size * 0.014, 0.45)
    drawRay(-Math.PI / 4, 0.56, size * 0.014, 0.45)
    const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.3)
    core.addColorStop(0, coreWhite ? 'rgba(255,255,255,0.96)' : `rgba(${r},${g},${b},0.9)`)
    core.addColorStop(0.42, `rgba(${r},${g},${b},0.48)`)
    core.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = core
    ctx.fillRect(0, 0, size, size)
  })
}

/** 模糊：先缩小再放大（兼容性好，不需要 ctx.filter） */
function blurCanvas(source: HTMLCanvasElement, factor = 3): HTMLCanvasElement {
  const sw = Math.max(1, Math.round(source.width / factor))
  const sh = Math.max(1, Math.round(source.height / factor))
  const small = paint(sw, sh, (ctx) => {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, sw, sh)
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
  const gradient = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.24, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.65)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

/**
 * 噪点贴图：128×128 的噪点瓦片，全局缓存一次，用于消除浅色大面积渐变色阶。
 */
let grainTileLight: HTMLCanvasElement | null = null
let grainTileDark: HTMLCanvasElement | null = null
function getGrainTile(light: boolean): HTMLCanvasElement {
  const cached = light ? grainTileLight : grainTileDark
  if (cached) return cached
  const r = seeded(light ? 131 : 257)
  const tile = paint(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128)
    const tone = light ? '255,255,255' : '0,0,0'
    for (let i = 0; i < 2800; i += 1) {
      const x = Math.floor(r() * 128)
      const y = Math.floor(r() * 128)
      const size = r() < 0.12 ? 2 : 1
      ctx.fillStyle = `rgba(${tone},${(0.02 + r() * 0.065).toFixed(3)})`
      ctx.fillRect(x, y, size, size)
    }
  })
  if (light) grainTileLight = tile
  else grainTileDark = tile
  return tile
}

function paintGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, light = true) {
  const pattern = ctx.createPattern(getGrainTile(light), 'repeat')
  if (!pattern) return
  ctx.save()
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

/**
 * 樱花（春昼晴樱 · 月下夜樱）：
 *   · 远景：春昼为晴空淡绯云霞与远山春水，夜间为紫靛星夜、朦胧春月（胧月）与河畔暖灯倒影；
 *   · 框景花枝：两侧自然分叉虬枝渐变收细，叠三层柔雾花团、背阴粉樱、受光白樱与金粉花蕊，绝无呆板直线；
 *   · 60fps 动态层：四款带尖端缺口（花弁切れ込み）的樱瓣三维翻飞滑翔，辅以柔焦花粉微光与落水涟漪。
 */
function createSakura(initialDark: boolean): Renderer {
  interface Petal {
    x: number
    y: number
    size: number
    depth: number
    angle: number
    spin: number
    tilt: number
    tiltSpeed: number
    fall: number
    sway: number
    phase: number
    alpha: number
    sprite: number
  }
  interface Mote {
    x: number
    y: number
    r: number
    vx: number
    vy: number
    phase: number
    alpha: number
  }
  interface PondRipple {
    x: number
    y: number
    age: number
    life: number
    scale: number
  }
  interface BokehOrb {
    u: number
    v: number
    size: number
    speed: number
    phase: number
    sprite: number
    alpha: number
  }

  let width = 0
  let height = 0
  let dark = initialDark
  let background: HTMLCanvasElement | null = null
  let foregroundBranch: HTMLCanvasElement | null = null
  let sprites: HTMLCanvasElement[] = []
  let moteSprite: HTMLCanvasElement | null = null
  let petals: Petal[] = []
  let motes: Mote[] = []
  let ripples: PondRipple[] = []
  let bokehOrbs: BokehOrb[] = []
  let target = 40
  let speed = 50
  let wind = 15
  let sizeScale = 50
  let bokehAmount = 0.45
  let bokehSprites: HTMLCanvasElement[] = []
  let gust = 0
  let time = 0

  const spawn = (fromTop = false): Petal => {
    const depth = Math.pow(Math.random(), 0.92)
    const variant = Math.random()
    return {
      x: rand(-90, width + 90),
      y: fromTop ? rand(-height * 0.35, -24) : rand(-height * 0.15, height),
      size: 0.28 + depth * 0.78,
      depth,
      angle: rand(0, TAU),
      spin: rand(-1.45, 1.45) * (0.55 + depth * 0.78),
      tilt: rand(0, TAU),
      tiltSpeed: rand(1.1, 2.7),
      fall: 0.34 + depth * 0.9,
      sway: rand(15, 46),
      phase: rand(0, TAU),
      alpha: clamp(0.34 + depth * 0.58, 0.24, 0.95),
      // 0: 清晰浅粉瓣, 1: 清晰绯樱瓣, 2: 中景柔焦瓣, 3: 远/近景大虚焦瓣
      sprite: depth > 0.68 ? (variant < 0.58 ? 0 : 1) : depth > 0.34 ? 2 : 3,
    }
  }

  const spawnMote = (): Mote => ({
    x: rand(0, width),
    y: rand(0, height * 0.9),
    r: rand(6, 17),
    vx: rand(-8, 12),
    vy: rand(-9, -2),
    phase: rand(0, TAU),
    alpha: rand(0.18, 0.55),
  })

  /** 绘制单枚带自然先端缺口与叶脉纹理的樱花花瓣贴图 */
  const makePetalSprite = (
    topColor: string,
    midColor: string,
    baseColor: string,
    veinAlpha: number,
  ) =>
    paint(72, 72, (ctx) => {
      const g = ctx.createLinearGradient(20, 6, 52, 66)
      g.addColorStop(0, topColor)
      g.addColorStop(0.52, midColor)
      g.addColorStop(1, baseColor)
      ctx.fillStyle = g
      ctx.beginPath()
      // 顶端经典 V 形缺口（花弁切れ込み）+ 饱满水滴双弧瓣身
      ctx.moveTo(36, 15)
      ctx.bezierCurveTo(40, 6, 48, 8, 53, 18)
      ctx.bezierCurveTo(60, 32, 52, 52, 36, 65)
      ctx.bezierCurveTo(20, 52, 12, 32, 19, 18)
      ctx.bezierCurveTo(24, 8, 32, 6, 36, 15)
      ctx.closePath()
      ctx.fill()

      // 瓣尖受光边缘高光与细微丝脉
      ctx.strokeStyle = `rgba(255, 255, 255, ${veinAlpha.toFixed(2)})`
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.moveTo(36, 16)
      ctx.quadraticCurveTo(35, 40, 36, 61)
      ctx.stroke()

      ctx.strokeStyle = `rgba(255, 255, 255, ${(veinAlpha * 0.52).toFixed(2)})`
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.moveTo(36, 56)
      ctx.quadraticCurveTo(27, 40, 23, 25)
      ctx.moveTo(36, 56)
      ctx.quadraticCurveTo(45, 40, 49, 25)
      ctx.stroke()
    })

  /** 绘制一朵五瓣樱花（含先端小缺口与花蕊），用于两侧繁花枝头烘焙 */
  const paintBlossom = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rotation: number,
    petalColor: string,
    coreColor: string,
    withStamen: boolean,
  ) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rotation)
    ctx.fillStyle = petalColor
    for (let k = 0; k < 5; k += 1) {
      ctx.save()
      ctx.rotate((k * TAU) / 5)
      const r = radius
      ctx.beginPath()
      ctx.moveTo(0, r * 0.14)
      ctx.bezierCurveTo(r * 0.34, r * 0.24, r * 0.44, r * 0.68, r * 0.14, r * 0.98)
      ctx.lineTo(0, r * 0.84)
      ctx.lineTo(-r * 0.14, r * 0.98)
      ctx.bezierCurveTo(-r * 0.44, r * 0.68, -r * 0.34, r * 0.24, 0, r * 0.14)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = coreColor
    ctx.beginPath()
    ctx.arc(0, 0, Math.max(1, radius * 0.2), 0, TAU)
    ctx.fill()
    if (withStamen && radius > 7) {
      ctx.fillStyle = dark ? 'rgba(255, 236, 198, 0.85)' : 'rgba(226, 118, 148, 0.72)'
      for (let s = 0; s < 5; s += 1) {
        const a = (s * TAU) / 5 + 0.3
        ctx.beginPath()
        ctx.arc(Math.cos(a) * radius * 0.3, Math.sin(a) * radius * 0.3, Math.max(0.7, radius * 0.065), 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  const buildSprites = () => {
    const palePetal = makePetalSprite(
      'rgba(255, 245, 250, 0.99)',
      'rgba(255, 204, 224, 0.97)',
      'rgba(238, 142, 182, 0.94)',
      0.62,
    )
    const rosePetal = makePetalSprite(
      'rgba(255, 234, 244, 0.99)',
      'rgba(250, 176, 206, 0.97)',
      'rgba(222, 112, 160, 0.94)',
      0.55,
    )
    sprites = [palePetal, rosePetal, blurCanvas(palePetal, 2.2), blurCanvas(rosePetal, 4.2)]
    moteSprite = dark
      ? makeGlowSprite(255, 224, 238, 48)
      : makeGlowSprite(255, 244, 226, 48)
    // 柔焦散景：无硬边亮环，尺寸适中分布在枝头与逆光区
    bokehSprites = dark
      ? [
          makeBokehSprite(255, 182, 218, 128, 0.24),
          makeBokehSprite(226, 162, 245, 128, 0.2),
          makeBokehSprite(255, 218, 196, 128, 0.18),
        ]
      : [
          makeBokehSprite(255, 216, 232, 128, 0.3),
          makeBokehSprite(255, 238, 224, 128, 0.28),
          makeBokehSprite(244, 192, 218, 128, 0.24),
        ]
  }

  const buildBackground = () => {
    const w = width
    const h = height
    const scale = clamp(w / 1440, 0.65, 1.45)
    const horizon = h * 0.855

    // 初始化固定散景锚点（集中在左上逆光、两侧枝头与远岸，绝不在正中央糊出巨型肥皂泡）
    const orbRng = seeded(607)
    const anchors: Array<[number, number]> = [
      [0.14, 0.18], [0.24, 0.11], [0.08, 0.34], [0.84, 0.14],
      [0.91, 0.29], [0.76, 0.22], [0.18, 0.72], [0.85, 0.76],
    ]
    bokehOrbs = anchors.map(([u, v], idx) => ({
      u,
      v,
      size: (0.075 + orbRng() * 0.085) * Math.min(w, h),
      speed: 0.14 + orbRng() * 0.16,
      phase: idx * 1.15 + orbRng() * 2,
      sprite: idx % 3,
      alpha: 0.34 + orbRng() * 0.36,
    }))

    background = paintBackground(w, h, (ctx) => {
      // 1. 晴空淡绯天幕（白昼带清透春空蓝粉渐变，彻底告别惨白灰底；夜樱为深邃紫靛夜幕）
      const sky = ctx.createLinearGradient(w * 0.15, 0, w * 0.65, h)
      if (dark) {
        sky.addColorStop(0, '#0a0918')
        sky.addColorStop(0.36, '#15112a')
        sky.addColorStop(0.72, '#25193b')
        sky.addColorStop(1, '#311f42')
      } else {
        sky.addColorStop(0, '#d5e6f7')
        sky.addColorStop(0.32, '#e9eaf7')
        sky.addColorStop(0.68, '#fae9f1')
        sky.addColorStop(1, '#f7dce8')
      }
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      // 2. 夜樱微星 / 白昼春光柔晕（全部走 1:1 预烘焙柔光贴图，零同心色带）
      const rSky = seeded(311)
      if (dark) {
        // 夜空高处的细碎繁星
        for (let i = 0; i < 68; i += 1) {
          const sx = rSky() * w
          const sy = Math.pow(rSky(), 1.35) * horizon * 0.72
          const sr = 0.5 + rSky() * 1.15
          const sa = 0.14 + rSky() * 0.44
          ctx.fillStyle = `rgba(244, 236, 255, ${sa.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(sx, sy, sr, 0, TAU)
          ctx.fill()
        }
        // 胧月（Oborozuki）：柔和银粉月晕 + 精致满月盘面
        const moonX = w * 0.78
        const moonY = h * 0.175
        const moonR = clamp(Math.min(w, h) * 0.036, 15, 38)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        drawSoftBlob(ctx, moonX, moonY, moonR * 8.5, moonR * 7.5, [
          [0, 'rgba(246, 206, 235, 0.24)'],
          [0.34, 'rgba(196, 168, 238, 0.11)'],
          [0.7, 'rgba(150, 128, 210, 0.03)'],
          [1, 'rgba(0,0,0,0)'],
        ])
        drawSoftBlob(ctx, moonX, moonY, moonR * 2.1, moonR * 2.1, [
          [0, 'rgba(255, 240, 248, 0.55)'],
          [0.55, 'rgba(238, 206, 236, 0.2)'],
          [1, 'rgba(0,0,0,0)'],
        ])
        ctx.restore()

        ctx.save()
        ctx.beginPath()
        ctx.arc(moonX, moonY, moonR, 0, TAU)
        ctx.clip()
        const moonGrad = ctx.createRadialGradient(
          moonX - moonR * 0.25,
          moonY - moonR * 0.28,
          moonR * 0.08,
          moonX,
          moonY,
          moonR,
        )
        moonGrad.addColorStop(0, 'rgba(255, 252, 252, 0.97)')
        moonGrad.addColorStop(0.68, 'rgba(248, 234, 244, 0.94)')
        moonGrad.addColorStop(1, 'rgba(224, 198, 224, 0.88)')
        ctx.fillStyle = moonGrad
        ctx.fillRect(moonX - moonR, moonY - moonR, moonR * 2, moonR * 2)
        ctx.fillStyle = 'rgba(196, 168, 202, 0.18)'
        for (const [ox, oy, rr] of [[-0.26, -0.1, 0.28], [0.22, 0.22, 0.2], [-0.04, 0.38, 0.15]] as Array<[number, number, number]>) {
          ctx.beginPath()
          ctx.ellipse(moonX + ox * moonR, moonY + oy * moonR, rr * moonR, rr * moonR * 0.8, 0.4, 0, TAU)
          ctx.fill()
        }
        ctx.restore()
      } else {
        // 白昼：左上角柔和春晨暖阳与漫射粉霞
        drawSoftBlob(ctx, w * 0.2, h * 0.13, w * 0.52, h * 0.48, [
          [0, 'rgba(255, 248, 236, 0.72)'],
          [0.42, 'rgba(255, 236, 238, 0.34)'],
          [1, 'rgba(255, 236, 238, 0)'],
        ])
        drawSoftBlob(ctx, w * 0.82, h * 0.22, w * 0.38, h * 0.32, [
          [0, 'rgba(255, 224, 238, 0.42)'],
          [0.55, 'rgba(255, 232, 242, 0.14)'],
          [1, 'rgba(255, 232, 242, 0)'],
        ])
      }

      // 3. 横掠天际的柔云（春霞流云）
      for (let i = 0; i < 6; i += 1) {
        const cu = (0.1 + i * 0.17 + rSky() * 0.06) * w
        const cv = (0.1 + (i % 3) * 0.11 + rSky() * 0.05) * h
        const crx = w * (0.16 + rSky() * 0.16)
        const cry = h * (0.032 + rSky() * 0.035)
        drawSoftBlob(ctx, cu, cv, crx, cry, [
          [0, dark ? 'rgba(218, 182, 226, 0.09)' : 'rgba(255, 255, 255, 0.58)'],
          [0.52, dark ? 'rgba(176, 142, 206, 0.04)' : 'rgba(255, 246, 250, 0.24)'],
          [1, 'rgba(255,255,255,0)'],
        ])
      }

      // 4. 远方朦胧春山与花雾河岸（压在底部 15%，安静衬托景深，绝不抢正文）
      const drawHill = (seedNum: number, peakH: number, baseY: number, fill: string) => {
        const r = seeded(seedNum)
        const steps = 28
        const raw: number[] = []
        let cur = 0.5
        for (let i = 0; i <= steps; i += 1) {
          cur = clamp(cur + (r() - 0.5) * 0.34, 0.12, 0.92)
          raw.push(cur)
        }
        const sm = raw.map((v, i) => (raw[i - 1] ?? v) * 0.3 + v * 0.4 + (raw[i + 1] ?? v) * 0.3)
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let i = 0; i <= steps; i += 1) {
          const x = (i / steps) * w
          // 中央略低缓，两侧略起伏，形成自然山水抱合感
          const cradle = 0.68 + 0.32 * Math.pow(Math.abs((i / steps) * 2 - 1), 1.4)
          ctx.lineTo(x, baseY - sm[i] * peakH * cradle)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
      }

      drawHill(41, h * 0.085, horizon + 4, dark ? 'rgba(42, 28, 62, 0.72)' : 'rgba(222, 205, 224, 0.46)')
      drawHill(79, h * 0.055, horizon + 8, dark ? 'rgba(31, 20, 48, 0.86)' : 'rgba(210, 188, 212, 0.52)')

      // 远岸樱林柔雾（河畔绵延的淡粉花云）
      const bankRng = seeded(193)
      for (let i = 0; i < 24; i += 1) {
        const bx = (i / 23) * w + (bankRng() - 0.5) * (w / 18)
        const by = horizon - h * (0.004 + bankRng() * 0.018)
        const br = (18 + bankRng() * 34) * scale
        drawSoftBlob(ctx, bx, by, br * 1.45, br * 0.72, [
          [0, dark ? 'rgba(232, 162, 204, 0.22)' : 'rgba(252, 198, 218, 0.44)'],
          [0.6, dark ? 'rgba(204, 134, 184, 0.08)' : 'rgba(248, 212, 226, 0.16)'],
          [1, 'rgba(255,255,255,0)'],
        ])
      }

      // 静谧春水河面与倒影
      const pond = ctx.createLinearGradient(0, horizon, 0, h)
      if (dark) {
        pond.addColorStop(0, '#221637')
        pond.addColorStop(0.45, '#170f28')
        pond.addColorStop(1, '#100a1d')
      } else {
        pond.addColorStop(0, '#f4dce8')
        pond.addColorStop(0.5, '#eed6e5')
        pond.addColorStop(1, '#e6cee1')
      }
      ctx.fillStyle = pond
      ctx.fillRect(0, horizon, w, h - horizon + 2)

      // 水面月影 / 霞光倒影与远岸暖色石灯笼
      if (dark) {
        drawSoftBlob(ctx, w * 0.78, horizon + (h - horizon) * 0.35, w * 0.09, (h - horizon) * 0.85, [
          [0, 'rgba(246, 208, 236, 0.2)'],
          [0.5, 'rgba(202, 166, 226, 0.07)'],
          [1, 'rgba(0,0,0,0)'],
        ])
        const lanternX = w * 0.835
        const lanternY = horizon - h * 0.012
        drawSoftBlob(ctx, lanternX, lanternY, 24, 24, [
          [0, 'rgba(255, 204, 146, 0.42)'],
          [0.45, 'rgba(255, 178, 118, 0.14)'],
          [1, 'rgba(255, 178, 118, 0)'],
        ])
        drawSoftBlob(ctx, lanternX, horizon + 10, 14, 18, [
          [0, 'rgba(255, 198, 136, 0.24)'],
          [1, 'rgba(255, 198, 136, 0)'],
        ])
        ctx.fillStyle = 'rgba(255, 228, 182, 0.9)'
        ctx.beginPath()
        ctx.arc(lanternX, lanternY, 1.9, 0, TAU)
        ctx.fill()
      } else {
        drawSoftBlob(ctx, w * 0.24, horizon + (h - horizon) * 0.3, w * 0.22, (h - horizon) * 0.85, [
          [0, 'rgba(255, 248, 242, 0.52)'],
          [1, 'rgba(255, 248, 242, 0)'],
        ])
      }

      // 水面倒映的霞光与岸上花影：横向长条柔光，随水波自然错开
      const reflRng = seeded(661)
      for (let i = 0; i < 22; i += 1) {
        const ry = horizon + (h - horizon) * (0.06 + Math.pow(reflRng(), 1.25) * 0.9)
        const rw = (0.06 + reflRng() * 0.3) * w
        const rx = dark
          ? w * (0.62 + reflRng() * 0.34)
          : w * (0.05 + reflRng() * 0.9)
        drawSoftBlob(ctx, rx, ry, rw * 0.5, (h - horizon) * (0.012 + reflRng() * 0.026), dark
          ? [
              [0, 'rgba(246, 206, 238, 0.16)'],
              [0.6, 'rgba(206, 156, 214, 0.05)'],
              [1, 'rgba(0,0,0,0)'],
            ]
          : [
              [0, 'rgba(255, 246, 250, 0.5)'],
              [0.6, 'rgba(248, 208, 226, 0.18)'],
              [1, 'rgba(255,255,255,0)'],
            ])
      }

      // 水岸柔雾过渡线（消除水平刀切感）
      const mistBank = ctx.createLinearGradient(0, horizon - h * 0.028, 0, horizon + h * 0.03)
      mistBank.addColorStop(0, 'rgba(255,255,255,0)')
      mistBank.addColorStop(0.5, dark ? 'rgba(186, 152, 212, 0.14)' : 'rgba(255, 248, 252, 0.62)')
      mistBank.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = mistBank
      ctx.fillRect(0, horizon - h * 0.028, w, h * 0.058)

      // 5. 两侧自然虬曲樱枝与三层立体繁花簇（左繁右疏、不对称构图，严守中央阅读走廊）
      interface BlossomCluster { x: number; y: number; r: number }
      const clusters: BlossomCluster[] = []
      const branchRng = seeded(907)

      const drawOrganicLimb = (
        pts: Array<[number, number, number]>,
        twigs: Array<[number, number, number, number]>,
      ) => {
        // 逐段渐变收细树干：控制点沿段法线偏移，画出真实樱树「先扬后俯」的虬曲弧线
        ctx.lineCap = 'round'
        for (let i = 1; i < pts.length; i += 1) {
          const [x0, y0, w0] = pts[i - 1]
          const [x1, y1, w1] = pts[i]
          const dx = x1 - x0
          const dy = y1 - y0
          const length = Math.max(1, Math.hypot(dx, dy))
          const bend = Math.sin(i * 1.7 + 0.4) * length * 0.19
          const cx = (x0 + x1) * 0.5 - (dy / length) * bend
          const cy = (y0 + y1) * 0.5 + (dx / length) * bend

          ctx.strokeStyle = dark ? '#251a30' : '#6b4d57'
          ctx.lineWidth = (w0 + w1) * 0.5 * scale
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.quadraticCurveTo(cx, cy, x1, y1)
          ctx.stroke()

          // 树干受光侧微高光（沿弧线内收，浅色为暖木色、夜色为月照冷光）
          ctx.strokeStyle = dark ? 'rgba(190, 158, 208, 0.26)' : 'rgba(226, 194, 200, 0.42)'
          ctx.lineWidth = Math.max(0.7, (w0 + w1) * 0.13 * scale)
          ctx.beginPath()
          ctx.moveTo(x0, y0 - w0 * 0.2 * scale)
          ctx.quadraticCurveTo(cx, cy - w0 * 0.2 * scale, x1, y1 - w1 * 0.2 * scale)
          ctx.stroke()

          // 主干沿线也挂着花团，花才会「长在枝上」而不是浮在枝旁
          if (i % 2 === 0) {
            clusters.push({ x: x0, y: y0, r: (14 + branchRng() * 10) * scale })
          }
        }

        // 细枝与花簇锚点
        for (const [tx, ty, angle, len] of twigs) {
          const ex = tx + Math.cos(angle) * len
          const ey = ty + Math.sin(angle) * len
          const mx = (tx + ex) * 0.5 + Math.sin(angle * 3) * len * 0.14
          const my = (ty + ey) * 0.5 + len * 0.12
          ctx.strokeStyle = dark ? 'rgba(54, 36, 66, 0.9)' : 'rgba(116, 84, 95, 0.68)'
          ctx.lineWidth = 1.5 * scale
          ctx.beginPath()
          ctx.moveTo(tx, ty)
          ctx.quadraticCurveTo(mx, my, ex, ey)
          ctx.stroke()
          clusters.push({ x: mx, y: my, r: (12 + branchRng() * 9) * scale })
          clusters.push({ x: ex, y: ey, r: (15 + branchRng() * 11) * scale })
        }
      }

      // 左侧主樱枝（从左上与左腰自然探入）
      drawOrganicLimb(
        [
          [-18, h * 0.34, 9.5],
          [w * 0.045, h * 0.255, 7.2],
          [w * 0.105, h * 0.19, 5.2],
          [w * 0.168, h * 0.125, 3.6],
          [w * 0.228, h * 0.072, 2.2],
          [w * 0.275, h * 0.022, 1.2],
        ],
        [
          [w * 0.035, h * 0.27, 0.42, 54 * scale],
          [w * 0.068, h * 0.23, -0.58, 48 * scale],
          [w * 0.095, h * 0.2, 0.32, 62 * scale],
          [w * 0.135, h * 0.158, -0.44, 52 * scale],
          [w * 0.165, h * 0.128, 0.38, 56 * scale],
          [w * 0.205, h * 0.09, -0.25, 46 * scale],
          [w * 0.245, h * 0.05, 0.28, 44 * scale],
          [w * 0.02, h * 0.11, 0.18, 68 * scale],
          [w * 0.08, h * 0.05, 0.35, 64 * scale],
        ],
      )

      // 右侧呼应轻枝（位置更高更轻盈，避免左右镜像对称）
      drawOrganicLimb(
        [
          [w + 18, h * 0.24, 8.2],
          [w * 0.955, h * 0.185, 6.0],
          [w * 0.9, h * 0.135, 4.1],
          [w * 0.845, h * 0.082, 2.5],
          [w * 0.79, h * 0.032, 1.3],
        ],
        [
          [w * 0.96, h * 0.19, 2.58, 54 * scale],
          [w * 0.925, h * 0.16, 3.55, 48 * scale],
          [w * 0.895, h * 0.138, 2.72, 58 * scale],
          [w * 0.86, h * 0.098, 3.4, 46 * scale],
          [w * 0.82, h * 0.058, 2.8, 44 * scale],
          [w * 0.95, h * 0.055, 2.68, 60 * scale],
        ],
      )

      // 第一遍：花团背后的柔光粉云衬底。
      // 夜色里改用 additive（lighter）发光，避免半透明粉色压在深底上变成一圈灰紫的「雾团」。
      ctx.save()
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      for (const c of clusters) {
        drawSoftBlob(ctx, c.x, c.y, c.r * 1.75, c.r * 1.45, dark
          ? [
              [0, 'rgba(236, 138, 196, 0.16)'],
              [0.55, 'rgba(178, 104, 176, 0.055)'],
              [1, 'rgba(0,0,0,0)'],
            ]
          : [
              [0, 'rgba(255, 196, 218, 0.46)'],
              [0.58, 'rgba(255, 218, 232, 0.18)'],
              [1, 'rgba(255,255,255,0)'],
            ])
      }
      ctx.restore()
      // 第二遍：背阴层樱花朵
      for (const c of clusters) {
        const count = 4 + Math.floor(branchRng() * 3)
        for (let i = 0; i < count; i += 1) {
          const a = branchRng() * TAU
          const d = Math.sqrt(branchRng()) * c.r * 0.95
          paintBlossom(
            ctx,
            c.x + Math.cos(a) * d,
            c.y + Math.sin(a) * d * 0.82,
            (5.2 + branchRng() * 4.2) * scale,
            branchRng() * TAU,
            dark ? 'rgba(218, 134, 182, 0.72)' : 'rgba(244, 162, 194, 0.82)',
            dark ? 'rgba(146, 68, 112, 0.8)' : 'rgba(206, 98, 138, 0.75)',
            false,
          )
        }
      }
      // 第三遍：受光层盛放白粉樱与花蕊点睛
      for (const c of clusters) {
        const count = 3 + Math.floor(branchRng() * 3)
        for (let i = 0; i < count; i += 1) {
          const a = branchRng() * TAU
          const d = Math.sqrt(branchRng()) * c.r * 0.72
          paintBlossom(
            ctx,
            c.x + Math.cos(a) * d,
            c.y + Math.sin(a) * d * 0.78 - 1.5 * scale,
            (6.0 + branchRng() * 4.8) * scale,
            branchRng() * TAU,
            dark ? 'rgba(255, 224, 240, 0.92)' : 'rgba(255, 246, 250, 0.96)',
            dark ? 'rgba(232, 132, 174, 0.88)' : 'rgba(232, 128, 164, 0.86)',
            true,
          )
        }
      }

      paintVignette(ctx, w, h, dark ? 0.34 : 0.07)
      if (!dark) paintGrain(ctx, w, h, 0.035, true)
    })

    // 左下与右下极浅景深虚焦花影前景，拉开电影感纵深
    const fgRaw = paint(w, h, (ctx) => {
      const fgRng = seeded(1201)
      const spots: Array<[number, number]> = [
        [w * 0.03, h * 0.93], [w * 0.08, h * 0.97], [w * 0.96, h * 0.91], [w * 0.91, h * 0.96],
      ]
      for (const [sx, sy] of spots) {
        for (let i = 0; i < 5; i += 1) {
          paintBlossom(
            ctx,
            sx + (fgRng() - 0.5) * 68 * scale,
            sy + (fgRng() - 0.5) * 46 * scale,
            (13 + fgRng() * 9) * scale,
            fgRng() * TAU,
            dark ? 'rgba(236, 164, 206, 0.42)' : 'rgba(250, 186, 212, 0.5)',
            dark ? 'rgba(170, 88, 134, 0.4)' : 'rgba(216, 118, 154, 0.4)',
            false,
          )
        }
      }
    })
    foregroundBranch = blurCanvas(fgRaw, 4)
  }

  return {
    fps: 60,
    setup(w, h) {
      width = w
      height = h
      buildSprites()
      buildBackground()
      petals = []
      motes = []
      ripples = []
      resizeList(petals, target, () => spawn())
      resizeList(motes, Math.round(18 * areaFactor(w, h)), spawnMote)
    },
    setTone(next) {
      if (next === dark) return
      dark = next
      buildSprites()
      buildBackground()
    },
    configure(values) {
      speed = values.speed ?? 50
      wind = values.wind ?? 15
      sizeScale = values.size ?? 50
      bokehAmount = (values.bokeh ?? 45) / 100
      target = Math.round(((values.count ?? 40) / 100) * 128 * areaFactor(width, height))
      resizeList(petals, target, () => spawn())
    },
    step(dt) {
      time += dt
      gust += dt * 0.34
      const gustFactor = 0.76 + 0.42 * Math.sin(gust) * Math.sin(gust * 0.41 + 0.6)
      const drift = (wind / 100) * 92 * gustFactor
      const horizon = height * 0.855

      for (const petal of petals) {
        petal.phase += dt * (0.85 + petal.depth * 1.05)
        petal.angle += petal.spin * dt * 0.85
        petal.tilt += petal.tiltSpeed * dt
        // 真实樱瓣滑翔：水平摆荡最剧烈时下沉略缓，倾侧时轻盈顺风滑落
        const glide = 0.82 + 0.28 * Math.abs(Math.cos(petal.phase))
        petal.y += petal.fall * (15 + (speed / 100) * 58) * glide * dt
        petal.x += (drift * (0.55 + petal.depth * 0.65) + Math.sin(petal.phase) * petal.sway) * dt

        if (petal.y > horizon + 10 && petal.depth > 0.55 && ripples.length < 14 && Math.random() < dt * 1.6) {
          ripples.push({
            x: petal.x,
            y: clamp(petal.y + rand(0, height * 0.08), horizon + 4, height - 6),
            age: 0,
            life: rand(0.9, 1.5),
            scale: 0.6 + petal.depth * 0.7,
          })
        }
        if (petal.y > height + 60 || petal.x > width + 100 || petal.x < -100) {
          Object.assign(petal, spawn(true))
        }
      }

      for (const m of motes) {
        m.phase += dt * 1.15
        m.x += (m.vx + drift * 0.22 + Math.sin(m.phase) * 8) * dt
        m.y += m.vy * dt
        if (m.y < -20 || m.x < -30 || m.x > width + 30) {
          m.x = rand(0, width)
          m.y = height * rand(0.75, 0.98)
        }
      }

      for (const r of ripples) r.age += dt
      ripples = ripples.filter((r) => r.age < r.life)
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)

      // 落英轻触春水泛起的细微涟漪
      if (ripples.length > 0) {
        ctx.save()
        for (const r of ripples) {
          const t = r.age / r.life
          const rx = (5 + t * 24) * r.scale
          ctx.strokeStyle = dark
            ? `rgba(244, 198, 228, ${((1 - t) * 0.24).toFixed(3)})`
            : `rgba(255, 255, 255, ${((1 - t) * 0.45).toFixed(3)})`
          ctx.lineWidth = 0.9
          ctx.beginPath()
          ctx.ellipse(r.x, r.y, rx, rx * 0.2, 0, 0, TAU)
          ctx.stroke()
        }
        ctx.restore()
      }

      // 柔焦散景光晕：无硬边亮圈，随春风轻柔呼吸浮动
      if (bokehAmount > 0.03) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        for (const orb of bokehOrbs) {
          const sprite = bokehSprites[orb.sprite]
          if (!sprite) continue
          const ox = orb.u * width + Math.sin(time * orb.speed + orb.phase) * 26
          const oy = orb.v * height + Math.cos(time * orb.speed * 0.8 + orb.phase) * 16
          const breathe = 0.78 + 0.22 * Math.sin(time * 0.65 + orb.phase)
          ctx.globalAlpha = clamp(bokehAmount * orb.alpha * breathe * (dark ? 0.68 : 0.85), 0, 1)
          ctx.drawImage(sprite, ox - orb.size / 2, oy - orb.size / 2, orb.size, orb.size)
        }
        ctx.restore()
      }

      // 空气中浮动的春阳金粉 / 夜樱月华微尘
      if (moteSprite && bokehAmount > 0.05) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        for (const m of motes) {
          const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(m.phase * 1.6))
          ctx.globalAlpha = m.alpha * twinkle * clamp(0.4 + bokehAmount, 0, 1)
          ctx.drawImage(moteSprite, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2)
        }
        ctx.restore()
      }

      // 60fps 三维翻飞樱瓣（中央阅读区柔和减淡，两侧繁花纷飞）
      const halfW = Math.max(1, width * 0.5)
      ctx.save()
      for (const petal of petals) {
        const sprite = sprites[petal.sprite]
        if (!sprite) continue
        const size = sprite.width * petal.size * (0.52 + sizeScale / 100) * 0.48
        const flipX = Math.cos(petal.tilt)
        const flipY = 0.76 + 0.24 * Math.sin(petal.tilt * 0.7 + petal.phase)
        const centerDist = Math.abs(petal.x - halfW) / halfW
        const readingEase = 0.62 + 0.38 * clamp((centerDist - 0.28) / 0.42, 0, 1)
        ctx.save()
        ctx.translate(petal.x, petal.y)
        ctx.rotate(petal.angle * 0.65 + Math.sin(petal.phase) * 0.22)
        ctx.globalAlpha = clamp(petal.alpha * (0.68 + Math.abs(flipX) * 0.32) * readingEase, 0, 1)
        const squeezeX = 0.34 + Math.abs(flipX) * 0.66
        ctx.drawImage(sprite, (-size * squeezeX) / 2, (-size * flipY) / 2, size * squeezeX, size * flipY)
        ctx.restore()
      }
      ctx.restore()

      if (foregroundBranch) {
        ctx.save()
        ctx.globalAlpha = dark ? 0.78 : 0.72
        ctx.drawImage(foregroundBranch, 0, 0, width, height)
        ctx.restore()
      }
    },
  }
}

/* ------------------------------ 粒子星链 ------------------------------ */

/**
 * 粒子星链（星穹织梦 · 浅色星盘）：
 *   · 彻底摒弃方格坐标纸，改以多色相丝绒星云、极淡天体星盘弧线（Astrolabe Arcs）与远景恒星构图；
 *   · 粒子分景深层级，亮星配纤细六芒星耀与双色辉光；
 *   · 数据脉冲沿连通星链「多跳接力」滑行（抵达节点后自动寻路至下一邻接星点，首尾正弦羽化无跳变）。
 */
function createNetwork(initialDark: boolean): Renderer {
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
    prev: number
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
  let target = 60
  let linkDistance = 140
  let speed = 40
  let pulseAmount = 0.5
  let glowStrength = 0.55
  let accent: [number, number, number] = [90, 139, 255]
  let accent2: [number, number, number] = [160, 120, 255]
  let nodeRgb: [number, number, number] = [255, 255, 255]
  let blend: 'lighter' | 'source-over' = 'lighter'
  let linkAlpha = 0.42
  let nodeAlpha = 0.95
  let glowScale = 1
  const pointer = { x: -9999, y: -9999 }

  const spawn = (): Node => {
    const z = 0.25 + Math.pow(Math.random(), 1.15) * 0.75
    return {
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-0.85, 0.85),
      vy: rand(-0.85, 0.85),
      z,
      size: 0.68 + z * 1.48,
      phase: rand(0, TAU),
      pulse: rand(0.65, 1.75),
      hueVariant: Math.random() < 0.34 ? 1 : 0,
    }
  }

  /**
   * 脉冲寻路：优先从刚刚抵达的节点继续跳往相邻星点（形成贯穿星图的流光接力），
   * 若当前星点无其他邻边再平滑重选起点。
   */
  const routePacket = (packet: Packet, relay = false) => {
    const tryFrom = (originIdx: number, avoidIdx: number): number => {
      const origin = nodes[originIdx]
      if (!origin) return originIdx
      let chosen = originIdx
      let count = 0
      for (let i = 0; i < nodes.length; i += 1) {
        if (i === originIdx || i === avoidIdx) continue
        const other = nodes[i]
        const dx = other.x - origin.x
        const dy = other.y - origin.y
        if (dx * dx + dy * dy <= linkDistance * linkDistance && Math.random() < 1 / ++count) {
          chosen = i
        }
      }
      return chosen
    }

    if (relay && nodes[packet.to]) {
      const next = tryFrom(packet.to, packet.from)
      if (next !== packet.to) {
        packet.prev = packet.from
        packet.from = packet.to
        packet.to = next
        packet.t = 0
        packet.speed = rand(0.42, 0.92)
        return
      }
    }

    const start = Math.floor(Math.random() * Math.max(1, nodes.length))
    packet.prev = start
    packet.from = start
    packet.to = tryFrom(start, -1)
    packet.t = 0
    packet.speed = rand(0.42, 0.92)
  }

  const spawnPacket = (): Packet => {
    const packet: Packet = { from: 0, to: 0, prev: 0, t: Math.random(), speed: 0.6, color: Math.random() < 0.48 ? 0 : 1 }
    routePacket(packet, false)
    return packet
  }

  const buildAssets = () => {
    const colors = themeColors()
    const baseRgb = colors.rgb
    const hue = toHsl(baseRgb)
    const secondaryHueRgb = hslToRgb(hue.h + 44, clamp(hue.s * 0.92, 0.52, 0.9), dark ? 0.66 : 0.48)
    const tertiaryHueRgb = hslToRgb(hue.h - 38, clamp(hue.s * 0.85, 0.45, 0.86), dark ? 0.58 : 0.5)

    if (dark) {
      blend = 'lighter'
      accent = hslToRgb(hue.h, clamp(hue.s * 0.95, 0.55, 1), clamp(hue.l, 0.56, 0.7))
      accent2 = secondaryHueRgb
      nodeRgb = [246, 250, 255]
      linkAlpha = 0.5
      nodeAlpha = 0.96
      glowScale = 1
    } else {
      blend = 'source-over'
      accent = hslToRgb(hue.h, clamp(hue.s * 0.95, 0.45, 0.92), 0.36)
      accent2 = hslToRgb(hue.h + 44, clamp(hue.s * 0.95, 0.45, 0.9), 0.4)
      nodeRgb = hslToRgb(hue.h, clamp(hue.s * 0.95, 0.42, 0.92), 0.28)
      linkAlpha = 0.88
      nodeAlpha = 1
      glowScale = 0.6
    }

    glowPrimary = makeGlowSprite(baseRgb[0], baseRgb[1], baseRgb[2], 64)
    glowSecondary = makeGlowSprite(secondaryHueRgb[0], secondaryHueRgb[1], secondaryHueRgb[2], 64)
    sparkle = dark
      ? makeSparkleSprite(baseRgb[0], baseRgb[1], baseRgb[2], 96, true)
      : makeSparkleSprite(nodeRgb[0], nodeRgb[1], nodeRgb[2], 96, false)

    const c1 = `${baseRgb[0]},${baseRgb[1]},${baseRgb[2]}`
    const c2 = `${secondaryHueRgb[0]},${secondaryHueRgb[1]},${secondaryHueRgb[2]}`
    const c3 = `${tertiaryHueRgb[0]},${tertiaryHueRgb[1]},${tertiaryHueRgb[2]}`

    background = paintBackground(width, height, (ctx) => {
      const w = width
      const h = height
      const sky = ctx.createLinearGradient(w * 0.15, 0, w * 0.85, h)
      if (dark) {
        sky.addColorStop(0, '#030612')
        sky.addColorStop(0.45, '#070e22')
        sky.addColorStop(0.82, '#0a1530')
        sky.addColorStop(1, '#0d1b3a')
      } else {
        sky.addColorStop(0, '#f7f9ff')
        sky.addColorStop(0.52, '#eff4fd')
        sky.addColorStop(1, '#e6eefb')
      }
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      // 丝绒星云（三团互补主题色柔光，1:1 预烘焙无色带、无接缝）
      ctx.save()
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      drawSoftBlob(ctx, w * 0.24, h * 0.28, w * 0.5, h * 0.44, [
        [0, `rgba(${c1},${dark ? 0.19 : 0.13})`],
        [0.52, `rgba(${c1},${dark ? 0.065 : 0.045})`],
        [1, 'rgba(0,0,0,0)'],
      ])
      drawSoftBlob(ctx, w * 0.78, h * 0.34, w * 0.44, h * 0.42, [
        [0, `rgba(${c2},${dark ? 0.15 : 0.11})`],
        [0.55, `rgba(${c2},${dark ? 0.05 : 0.04})`],
        [1, 'rgba(0,0,0,0)'],
      ])
      drawSoftBlob(ctx, w * 0.56, h * 0.86, w * 0.62, h * 0.32, [
        [0, `rgba(${c3},${dark ? 0.14 : 0.06})`],
        [0.6, `rgba(${c1},${dark ? 0.045 : 0.02})`],
        [1, 'rgba(0,0,0,0)'],
      ])
      ctx.restore()

      // 极淡天体浑仪星轨圆弧（取代生硬方格网，赋予古典星图仪式感，同时保持天空像素平滑）
      ctx.save()
      const maxDim = Math.hypot(w, h)
      ctx.lineWidth = 1
      for (const [ox, oy, radii] of [
        [-w * 0.1, -h * 0.14, [0.36, 0.54, 0.74]],
        [w * 1.08, h * 1.12, [0.34, 0.52]],
      ] as Array<[number, number, number[]]>) {
        for (let ri = 0; ri < radii.length; ri += 1) {
          const rad = maxDim * radii[ri]
          ctx.strokeStyle = dark
            ? `rgba(${c1},${(0.052 - ri * 0.011).toFixed(3)})`
            : `rgba(${c1},${(0.068 - ri * 0.014).toFixed(3)})`
          ctx.setLineDash(ri % 2 === 1 ? [6, 10] : [])
          ctx.beginPath()
          ctx.arc(ox, oy, rad, 0, TAU)
          ctx.stroke()
        }
      }
      ctx.setLineDash([])

      // 远景深空定星（仅绘制柔和圆润星点，绝不画杂乱噪点）
      const starRng = seeded(509)
      const bgStarCount = dark ? 85 : 32
      for (let i = 0; i < bgStarCount; i += 1) {
        const sx = starRng() * w
        const sy = starRng() * h
        const sr = 0.45 + starRng() * 0.95
        const sa = dark ? 0.1 + starRng() * 0.34 : 0.06 + starRng() * 0.14
        ctx.fillStyle = dark ? `rgba(226, 236, 255, ${sa.toFixed(3)})` : `rgba(${c1}, ${sa.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(sx, sy, sr, 0, TAU)
        ctx.fill()
      }
      ctx.restore()

      paintVignette(ctx, w, h, dark ? 0.52 : 0.07)
      if (!dark) paintGrain(ctx, w, h, 0.025, true)
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
      resizeList(nodes, target, spawn)
    },
    setTone(next) {
      dark = next
      buildAssets()
    },
    configure(values) {
      linkDistance = 92 + ((values.link ?? 50) / 100) * 182
      speed = values.speed ?? 40
      pulseAmount = (values.pulse ?? 50) / 100
      glowStrength = (values.glow ?? 55) / 100
      target = Math.round(((values.density ?? 45) / 100) * 146 * areaFactor(width, height))
      resizeList(nodes, target, spawn)
      const wanted = Math.round(pulseAmount * 28 * areaFactor(width, height))
      while (packets.length < wanted) packets.push(spawnPacket())
      packets.length = Math.min(packets.length, wanted)
    },
    pointer(x, y) {
      pointer.x = x
      pointer.y = y
    },
    step(dt) {
      const velocity = 5 + (speed / 100) * 32
      for (const node of nodes) {
        const dx = pointer.x - node.x
        const dy = pointer.y - node.y
        const distance = Math.hypot(dx, dy)
        if (distance < 250 && distance > 1) {
          const pull = (1 - distance / 250) * 3.8
          node.vx += (dx / distance) * pull * dt
          node.vy += (dy / distance) * pull * dt
        }
        // 阻尼限速，使星点离开光标后恢复优雅巡航速度
        const mag = Math.hypot(node.vx, node.vy)
        if (mag > 1.9) {
          node.vx = (node.vx / mag) * 1.9
          node.vy = (node.vy / mag) * 1.9
        }
        const depthFactor = 0.45 + node.z * 0.75
        node.x += node.vx * velocity * depthFactor * dt
        node.y += node.vy * velocity * depthFactor * dt
        node.phase += dt * node.pulse
        if (node.x < -24) node.x = width + 24
        if (node.x > width + 24) node.x = -24
        if (node.y < -24) node.y = height + 24
        if (node.y > height + 24) node.y = -24
      }
      for (const packet of packets) {
        packet.t += dt * packet.speed * (0.7 + (speed / 100) * 0.7)
        if (packet.t >= 1) {
          routePacket(packet, true)
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

      // 丝缕星链：按距离平方平滑衰减，双色交织
      ctx.lineCap = 'round'
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        const cx = Math.floor(node.x / linkDistance)
        const cy = Math.floor(node.y / linkDistance)
        for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
          for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
            const bucket = cells.get(`${gx}:${gy}`)
            if (!bucket) continue
            for (const j of bucket) {
              if (j <= i) continue
              const other = nodes[j]
              const dx = other.x - node.x
              const dy = other.y - node.y
              const distanceSq = dx * dx + dy * dy
              if (distanceSq > linkDistance * linkDistance) continue
              const distance = Math.sqrt(distanceSq)
              const fade = Math.pow(1 - distance / linkDistance, dark ? 1.35 : 0.9)
              const depthFade = (dark ? 0.45 : 0.62) + (dark ? 0.55 : 0.38) * ((node.z + other.z) * 0.5)
              const useAlt = node.hueVariant && other.hueVariant
              ctx.strokeStyle = useAlt
                ? `rgba(${r2},${g2},${b2},${(fade * linkAlpha * depthFade).toFixed(3)})`
                : `rgba(${r},${g},${b},${(fade * linkAlpha * depthFade).toFixed(3)})`
              ctx.lineWidth = dark ? 0.65 + fade * 0.7 : 1 + fade * 1.05
              ctx.beginPath()
              ctx.moveTo(node.x, node.y)
              ctx.lineTo(other.x, other.y)
              ctx.stroke()
            }
          }
        }
      }

      // 彗尾流光脉冲：首尾正弦包络柔化 + 双阶渐隐彗尾 + 柔光核
      for (const packet of packets) {
        const from = nodes[packet.from]
        const to = nodes[packet.to]
        if (!from || !to || packet.from === packet.to) continue
        const distance = Math.hypot(to.x - from.x, to.y - from.y)
        if (distance > linkDistance) continue
        const env = Math.sin(Math.PI * clamp(packet.t, 0, 1))
        const px = from.x + (to.x - from.x) * packet.t
        const py = from.y + (to.y - from.y) * packet.t
        const midT = Math.max(0, packet.t - 0.08)
        const tailT = Math.max(0, packet.t - 0.2)
        const mx = from.x + (to.x - from.x) * midT
        const my = from.y + (to.y - from.y) * midT
        const tx = from.x + (to.x - from.x) * tailT
        const ty = from.y + (to.y - from.y) * tailT
        const cr = packet.color ? r2 : r
        const cg = packet.color ? g2 : g
        const cb = packet.color ? b2 : b

        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(linkAlpha * 0.75 * env).toFixed(3)})`
        ctx.lineWidth = 1.05
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(mx, my)
        ctx.stroke()

        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(linkAlpha * 1.65 * env).toFixed(3)})`
        ctx.lineWidth = 1.65
        ctx.beginPath()
        ctx.moveTo(mx, my)
        ctx.lineTo(px, py)
        ctx.stroke()

        const sprite = packet.color ? glowSecondary : glowPrimary
        if (sprite && glowStrength > 0.04) {
          const size = 20
          ctx.globalAlpha = (0.48 + 0.45 * glowStrength) * glowScale * env
          ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size)
          ctx.globalAlpha = 1
        }
      }

      // 呼吸恒星节点与纤细星芒
      for (const node of nodes) {
        const pulse = 0.72 + 0.28 * Math.sin(node.phase)
        const haloSize = node.size * (5.2 + pulse * 4.2)
        const haloSprite = node.hueVariant ? glowSecondary : glowPrimary
        if (haloSprite && glowStrength > 0.04) {
          ctx.globalAlpha = 0.48 * glowStrength * pulse * glowScale * (0.45 + node.z * 0.55)
          ctx.drawImage(haloSprite, node.x - haloSize / 2, node.y - haloSize / 2, haloSize, haloSize)
        }
        if (sparkle && glowStrength > 0.04 && node.size > 1.72) {
          const flare = node.size * (dark ? 12.5 : 15) * pulse
          ctx.globalAlpha = (dark ? 0.52 : 0.62) * glowStrength * pulse * Math.max(glowScale, dark ? 0.6 : 0.85)
          ctx.drawImage(sparkle, node.x - flare / 2, node.y - flare / 2, flare, flare)
        }
        ctx.globalAlpha = nodeAlpha * (0.42 + node.z * 0.58)
        ctx.fillStyle = `rgba(${nr},${ng},${nb},1)`
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.size * (dark ? 0.56 : 0.82), 0, TAU)
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

const CROSSFADE_MS = 420

export function AnimatedBackdrop({ scene, values }: { scene: ActiveSceneId; values: SceneValues }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const snapshotRef = useRef<{ canvas: HTMLCanvasElement; startedAt: number } | null>(null)
  const valuesKey = JSON.stringify(values)
  const valuesRef = useRef<SceneValues>(values)
  valuesRef.current = values
  const { theme, colorTheme } = useTheme()
  const dark = theme === 'dark'
  const darkRef = useRef(dark)
  darkRef.current = dark

  /** 在切换场景或明暗/主题前截取上一帧画面，由主循环做 420ms 柔和叠化过渡 */
  const captureSnapshot = () => {
    const src = canvasRef.current
    if (!src || src.width <= 1 || src.height <= 1) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const copy = document.createElement('canvas')
    copy.width = src.width
    copy.height = src.height
    const cctx = copy.getContext('2d')
    if (cctx) {
      cctx.drawImage(src, 0, 0)
      snapshotRef.current = { canvas: copy, startedAt: performance.now() }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    captureSnapshot()
    const renderer = createRenderer(scene, darkRef.current)
    rendererRef.current = renderer

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let last = 0
    let width = 0
    let height = 0
    let dpr = 1
    let resizeFrame = 0

    const compositeFrame = (now: number) => {
      renderer.draw(ctx)
      const snap = snapshotRef.current
      if (snap) {
        const progress = (now - snap.startedAt) / CROSSFADE_MS
        if (progress >= 1) {
          snapshotRef.current = null
        } else if (progress >= 0) {
          const ease = 1 - progress * progress * (3 - 2 * progress)
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.globalAlpha = ease
          ctx.drawImage(snap.canvas, 0, 0, canvas.width, canvas.height)
          ctx.restore()
        }
      }
    }

    const redraw = () => compositeFrame(performance.now())
    redrawRef.current = redraw

    const sizeTo = () => {
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
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
      compositeFrame(now)
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
        snapshotRef.current = null
        sizeTo()
      })
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    const onMotion = () => {
      if (motion.matches) {
        snapshotRef.current = null
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

  // 参数变化：增量更新粒子；减少动态效果时同步刷新静态画面
  useEffect(() => {
    rendererRef.current?.configure(valuesRef.current)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) redrawRef.current?.()
  }, [valuesKey])

  // 明暗或配色主题切换：截取上一帧做柔和叠化，重建配色贴图，不打断粒子运动
  useEffect(() => {
    captureSnapshot()
    rendererRef.current?.setTone?.(dark)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) redrawRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, colorTheme])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="animate-fade-in absolute inset-0 h-full w-full"
    />
  )
}
