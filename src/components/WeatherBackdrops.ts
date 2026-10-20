import type { Renderer } from './AnimatedBackdrop'
import type { SceneValues } from '../lib/animatedBackground'

const TAU = Math.PI * 2
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const area = (w: number, h: number) => Math.min(2, Math.max(0.45, w * h / 1296000))
function paint(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  return canvas
}
function resize<T>(items: T[], count: number, make: () => T) {
  items.length = Math.min(items.length, count)
  while (items.length < count) items.push(make())
}
function sky(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[]) {
  const gradient = ctx.createLinearGradient(0, 0, w * 0.25, h)
  colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color))
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h)
}

/** 三层景深雪片：六角晶体、清晰小雪与近景柔焦，逐帧复用贴图。 */
export function createSnow(initialDark: boolean): Renderer {
  interface Flake { x: number; y: number; z: number; phase: number; angle: number; spin: number }
  let w = 1, h = 1, dark = initialDark
  let values: SceneValues = {}, flakes: Flake[] = []
  let background: HTMLCanvasElement, sprites: HTMLCanvasElement[] = []
  const spawn = (top = false): Flake => ({ x: rand(-40, w + 40), y: top ? rand(-50, -8) : rand(0, h), z: rand(0.15, 1), phase: rand(0, TAU), angle: rand(0, TAU), spin: rand(-0.4, 0.4) })
  const build = () => {
    sprites = [0, 1, 2].map(layer => paint(64, 64, ctx => {
      const tint = dark ? '225,240,255' : '91,127,158'
      if (layer === 2) {
        const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 30)
        glow.addColorStop(0, dark ? 'rgba(242,249,255,.8)' : 'rgba(255,255,255,.95)')
        glow.addColorStop(.35, dark ? 'rgba(220,237,255,.35)' : 'rgba(137,171,193,.3)')
        glow.addColorStop(1, 'rgba(180,210,240,0)')
        ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64)
      } else {
        ctx.strokeStyle = 'rgba(' + tint + ',.9)'; ctx.lineWidth = layer ? 2.5 : 1.7; ctx.lineCap = 'round'
        for (let i = 0; i < 6; i++) {
          ctx.save(); ctx.translate(32, 32); ctx.rotate(i * TAU / 6)
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -24)
          for (const y of [-11, -18]) { ctx.moveTo(-6, y - 4); ctx.lineTo(0, y); ctx.lineTo(6, y - 4) }
          ctx.stroke(); ctx.restore()
        }
      }
    }))
    background = paint(w, h, ctx => {
      sky(ctx, w, h, dark ? ['#091321', '#172b42', '#25445b'] : ['#e8f1f7', '#f7fafc', '#d4e5ef'])
      // 柔和的远山与积雪坡面，中心保留阅读空间。
      for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = dark ? ['#1d3448', '#263f52', '#314e61'][layer] : ['#c9dce8', '#deebf2', '#f4f9fc'][layer]
        ctx.beginPath(); ctx.moveTo(0, h)
        for (let x = 0; x <= w + 16; x += 16) ctx.lineTo(x, h * (.76 + layer * .09) + Math.sin(x / w * 7 + layer * 2) * h * .045)
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill()
      }
      const glow = ctx.createRadialGradient(w * .72, h * .15, 0, w * .72, h * .15, w * .65)
      glow.addColorStop(0, dark ? 'rgba(183,218,250,.14)' : 'rgba(255,255,255,.7)'); glow.addColorStop(1, 'rgba(210,230,250,0)')
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
    })
  }
  return {
    fps: 30,
    setup(width, height) { w = width; h = height; build(); flakes = []; resize(flakes, Math.round((values.count ?? 55) * 3 * area(w, h)), spawn) },
    configure(next) { values = next; resize(flakes, Math.round((values.count ?? 55) * 3 * area(w, h)), spawn) },
    setTone(next) { if (dark !== next) { dark = next; build() } },
    step(dt) {
      for (const f of flakes) {
        f.phase += dt * (.35 + f.z); f.angle += f.spin * dt
        f.x += (((values.wind ?? 12) / 100) * 85 * f.z + Math.sin(f.phase) * (6 + (values.swirl ?? 45) * .25) * f.z) * dt
        f.y += (8 + (values.speed ?? 35) * .75) * (.3 + f.z * 1.2) * dt
        if (f.x < -50) f.x = w + 45
        if (f.x > w + 50) f.x = -45
        if (f.y > h + 50) Object.assign(f, spawn(true))
      }
    },
    draw(ctx) {
      ctx.drawImage(background, 0, 0, w, h)
      ctx.save()
      // 远景先画，近景后画；深浅切换只重建贴图，不重置雪片。
      for (let layer = 0; layer < 3; layer++) for (const f of flakes) {
        const index = f.z > .84 ? 2 : f.z > .5 ? 0 : 1
        if ((index === 1 ? 0 : index === 0 ? 1 : 2) !== layer) continue
        const size = (3 + f.z * f.z * 26) * (.5 + (values.size ?? 45) / 100)
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.angle)
        ctx.globalAlpha = (dark ? .45 : .5) + f.z * .35
        ctx.drawImage(sprites[index], -size / 2, -size / 2, size, size); ctx.restore()
      }
      ctx.restore()
    },
  }
}

/**
 * 暴雨用的雨雾贴图缓存。
 *
 * 雾团与窗口尺寸无关（绘制时再拉伸），所以只依赖明暗：切换主题 / 重建里
 * 直接复用，不必每次重新烤 200 多个柔光团（实测这一步占了 setup 的一大半）。
 */
const rainMistCache = new Map<boolean, HTMLCanvasElement>()
const rainGlowCache = new Map<string, HTMLCanvasElement>()
const rainCloudCache = new Map<boolean, HTMLCanvasElement>()

/**
 * 暴雨：雨夜 / 阴雨白昼的山湖。
 *
 * 视觉目标是一张「安静但有层次」的风景，而不是特效堆砌：
 *   · 天空用低频噪声云场画出被雨压低的层云，云隙里透出月光 / 天光；
 *   · 三层山脊各自长着一整片混合林（针叶 + 阔叶），远层被雨雾洗淡，
 *     岸边长着芦苇，湖岸线不再是一条硬直线；
 *   · 湖面反射山林，分带错位；月光 / 天光在水面拉出一条抖动的碎光柱；
 *   · 雨丝分三层，亮度与长度各不相同；近景左右各有一丛虚焦芦苇，拉开景深。
 *
 * 所有静态部分在 setup() / setTone() 时烘焙进离屏 canvas，逐帧只做少量
 * drawImage 与批量描边；山形、树林与云场用固定种子，缩放窗口不会换一张脸。
 */
export function createRain(initialDark: boolean): Renderer {
  interface Drop {
    x: number
    y: number
    z: number
    size: number
    drift: number
    bright: number
    phase: number
    bokeh: boolean
  }
  interface Ripple { x: number; y: number; age: number; life: number; scale: number; depth: number }
  interface NoiseGrid { data: Float32Array; size: number }

  let w = 1, h = 1, dark = initialDark, time = 0, flash = 0, second = 0, nextFlash = 9
  let horizon = 0, moonX = 0, moonY = 0
  let values: SceneValues = {}
  let drops: Drop[] = []
  let ripples: Ripple[] = []
  let rippleClock = 0
  let background: HTMLCanvasElement
  let mirror: HTMLCanvasElement
  let water: HTMLCanvasElement
  let mistTex: HTMLCanvasElement
  let flashTex: HTMLCanvasElement
  let shimmer: HTMLCanvasElement
  let grade: HTMLCanvasElement
  let foreground: HTMLCanvasElement
  let dropSoft: HTMLCanvasElement
  let dropCrisp: HTMLCanvasElement
  let rainVeil: HTMLCanvasElement

  const seeded = (seed: number) => {
    let value = (seed * 2654435761) >>> 0
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0
      return value / 4294967296
    }
  }

  /** 缩小再放大 = 廉价柔焦，把光斑、雾团的边缘磨软 */
  const soften = (source: HTMLCanvasElement, factor: number) => {
    const small = paint(Math.max(1, Math.round(source.width / factor)), Math.max(1, Math.round(source.height / factor)), (ctx) => {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(source, 0, 0, source.width / factor, source.height / factor)
    })
    return paint(source.width, source.height, (ctx) => {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, source.width, source.height)
    })
  }

  /**
   * 椭圆柔光。
   *
   * 之前直接在 ctx.scale(rx, ry) 之后画极小的 radialGradient，缩放比动辄几百倍，
   * Skia 在这种极端变换下采样精度不足，会在大面积柔光里留下竖直的色阶接缝
   * （实测在 1440 宽时 x≈660 / x≈1010 各有一条，放大对比度就看得到）。
   * 现在改成「先把 256×256 的圆形柔光烤成贴图，再用 drawImage 拉伸成椭圆」：
   * 渐变永远在 1:1 的空间里生成，缩放交给 drawImage 的双线性插值，接缝消失。
   */
  const glowSprite = (stops: Array<[number, string]>) => {
    const key = stops.map(([offset, color]) => `${offset}|${color}`).join(';')
    const cached = rainGlowCache.get(key)
    if (cached) return cached
    const size = 256
    const sprite = paint(size, size, (ctx) => {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      for (const [offset, color] of stops) g.addColorStop(offset, color)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
    })
    rainGlowCache.set(key, sprite)
    return sprite
  }
  const blob = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    stops: Array<[number, string]>,
  ) => {
    const radiusX = Math.max(0.5, rx)
    const radiusY = Math.max(0.5, ry)
    const sprite = glowSprite(stops)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(sprite, cx - radiusX, cy - radiusY, radiusX * 2, radiusY * 2)
    ctx.restore()
  }

  /* ---------------------- 低频值噪声：云场 ---------------------- */
  const makeNoise = (seed: number): NoiseGrid => {
    const r = seeded(seed)
    const size = 64
    const data = new Float32Array(size * size)
    for (let i = 0; i < data.length; i += 1) data[i] = r()
    return { data, size }
  }
  const sampleNoise = (grid: NoiseGrid, x: number, y: number) => {
    const { data, size } = grid
    const fx = ((x % size) + size) % size
    const fy = ((y % size) + size) % size
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size
    const tx = fx - x0, ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const top = data[y0 * size + x0] + (data[y0 * size + x1] - data[y0 * size + x0]) * sx
    const bottom = data[y1 * size + x0] + (data[y1 * size + x1] - data[y1 * size + x0]) * sx
    return top + (bottom - top) * sy
  }
  const smooth01 = (edge0: number, edge1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }
  const raySprite = paint(128, 256, (c) => {
    const gx = c.createLinearGradient(0, 0, 128, 0)
    gx.addColorStop(0, 'rgba(255,246,226,0)')
    gx.addColorStop(0.5, 'rgba(255,246,226,0.55)')
    gx.addColorStop(1, 'rgba(255,246,226,0)')
    c.fillStyle = gx
    c.fillRect(0, 0, 128, 256)
    c.globalCompositeOperation = 'destination-in'
    const gy = c.createLinearGradient(0, 0, 0, 256)
    gy.addColorStop(0, 'rgba(0,0,0,0.9)')
    gy.addColorStop(0.55, 'rgba(0,0,0,0.35)')
    gy.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = gy
    c.fillRect(0, 0, 128, 256)
  })
  const cloudNoise = [makeNoise(23), makeNoise(71), makeNoise(137)]
  /** 横向拉伸的分形噪声：雨天的层云是横着铺开的 */
  const fbm = (u: number, v: number) => {
    let sum = 0, amplitude = 0.56, norm = 0
    for (let octave = 0; octave < 5; octave += 1) {
      const freq = 2.8 * Math.pow(2, octave)
      sum += sampleNoise(cloudNoise[octave % 3], (u * freq) / 2.3, v * freq) * amplitude
      norm += amplitude
      amplitude *= 0.55
    }
    return sum / norm
  }

  /**
   * 云场贴图只跟明暗有关，按色调缓存。
   * 640×280 的低分辨率噪声放大到整个天空，既省烘焙时间，又自带柔边。
   */
  const cloudTexture = () => {
    const cached = rainCloudCache.get(dark)
    if (cached) return cached
    const cw = 512, ch = 224
    const maxCloud = dark ? 0.76 : 0.7
    const base = dark ? [5, 9, 16] : [86, 104, 120]
    const lit = dark ? [96, 126, 152] : [238, 245, 249]
    const lightU = dark ? 0.84 : 0.76
    const lightV = dark ? 0.236 : 0.74
    const aspect = cw / ch
    const texture = paint(cw, ch, (ctx) => {
      const image = ctx.createImageData(cw, ch)
      const data = image.data
      for (let y = 0; y < ch; y += 1) {
        const v = y / (ch - 1)
        const vertical = 1 - smooth01(0.56, 1, v) * 0.58
        for (let x = 0; x < cw; x += 1) {
          const u = x / (cw - 1)
          const dens = smooth01(0.4, 0.68, fbm(u, v))
          const dx = (u - lightU) * aspect
          const dy = v - lightV
          const d2 = dx * dx + dy * dy
          const glow = Math.exp(-d2 * 6.2)
          const clear = Math.exp(-d2 * 16)
          const highlight = Math.min(1, glow * (0.22 + dens * 0.7) * (dark ? 0.86 : 0.62))
          const index = (y * cw + x) * 4
          data[index] = base[0] + (lit[0] - base[0]) * highlight
          data[index + 1] = base[1] + (lit[1] - base[1]) * highlight
          data[index + 2] = base[2] + (lit[2] - base[2]) * highlight
          data[index + 3] = dens * vertical * (1 - clear * (dark ? 0.5 : 0.58)) * maxCloud * 255
        }
      }
      ctx.putImageData(image, 0, 0)
    })
    rainCloudCache.set(dark, texture)
    return texture
  }

  const spawn = (top = false): Drop => ({
    x: rand(-w * 0.55, w * 1.15),
    y: top ? rand(-h * 0.35, -20) : rand(-80, h),
    z: Math.pow(Math.random(), 1.35),
    size: rand(0.75, 1.3),
    drift: rand(0.84, 1.18),
    bright: rand(0, 1),
    phase: rand(0, TAU),
    bokeh: false,
  })

  /**
   * 契合 60fps 光学快门角的真实雨滴速度（约 900–2,150 px/s，单帧位移 15–35px）：
   * 与 12–34px 的细柔梭形水滴长度 1:1 匹配，既有真实落雨动势，又绝不拉成百像素铁丝线。
   */
  const dropVelocity = (speed: number, z: number) => (760 + speed * 13.5) * (0.52 + z * 0.8)

  const currentSlope = (d: Drop, atTime = time) => {
    const windBase = (values.wind ?? 25) / 100
    const gust = 1 + 0.14 * Math.sin(atTime * 0.37) + 0.07 * Math.sin(atTime * 0.91 + 1.4)
    return windBase * gust * 0.48 * d.drift + Math.sin(atTime * 1.35 + d.phase) * 0.012
  }

  /**
   * 预烘焙光学梭形雨滴贴图：
   * 两端在宽度与透明度上均平滑收尖归零（上端柔和拖尾渐入、下三分之一水珠弯月面微亮、尖端柔化收尾），
   * 横向呈高斯羽化柔焦，彻底消除直线描边的「硬头硬尾等粗铁丝感」，同时保持真雨而非雪点的修长水滴感。
   */
  const makeWaterDropSprite = (
    sw: number,
    sh: number,
    rgbWake: [number, number, number],
    rgbTip: [number, number, number],
    softness: number,
  ) =>
    paint(sw, sh, (ctx) => {
      const image = ctx.createImageData(sw, sh)
      const data = image.data
      const cx = (sw - 1) * 0.5
      const peakV = 0.78
      for (let py = 0; py < sh; py += 1) {
        const v = py / (sh - 1)
        const rise = Math.pow(smooth01(0.0, peakV, v), 1.45)
        const tipFade = 1 - smooth01(peakV, 1.0, v)
        const axial = rise * Math.pow(tipFade, 0.72)
        const halfW =
          (0.3 +
            0.7 *
              Math.pow(smooth01(0.0, peakV + 0.06, v), 0.65) *
              Math.pow(1 - smooth01(0.82, 1.0, v), 0.55)) *
          (sw * 0.42)
        for (let px = 0; px < sw; px += 1) {
          const u = (px - cx) / Math.max(0.65, halfW)
          const r2 = u * u
          if (r2 >= 1) continue
          const radial = Math.pow(1 - r2, softness)
          const tipGlow = smooth01(0.45, peakV + 0.05, v)
          const alpha = Math.min(1, axial * radial)
          const idx = (py * sw + px) * 4
          data[idx] = rgbWake[0] + (rgbTip[0] - rgbWake[0]) * tipGlow
          data[idx + 1] = rgbWake[1] + (rgbTip[1] - rgbWake[1]) * tipGlow
          data[idx + 2] = rgbWake[2] + (rgbTip[2] - rgbWake[2]) * tipGlow
          data[idx + 3] = Math.round(alpha * 255)
        }
      }
      ctx.putImageData(image, 0, 0)
    })

  const build = () => {
    horizon = Math.round(h * 0.7)
    const landH = Math.round(h * 0.19)
    const scale = Math.max(0.72, Math.min(1.55, w / 1440))
    moonX = w * 0.84
    moonY = h * 0.165
    const lampX = w * 0.865
    const lampY = horizon - h * 0.028
    const moonR = Math.max(12, Math.min(36, Math.min(w, h) * 0.03))
    const waterH = h - horizon

    /* -------- 配色：浅色是阴雨白昼，深色是冷调雨夜 -------- */
    const tone = dark
      ? {
          skyTop: '#04070d',
          skyMid: '#091520',
          skyLow: '#13232f',
          skyBase: '#263842',
          haze: '36,56,70',
          waterTop: '#1b303c',
          waterMid: '#0b161d',
          waterLow: '#04090d',
          ridge: ['#334854', '#263a45', '#1a2b34'],
          forest: ['#2a3e49', '#1f323c', '#14222b'],
          forestDeep: '#070f14',
          reed: '#0a1319',
          shore: '#0c1a21',
        }
      : {
          skyTop: '#879caa',
          skyMid: '#a3b5c0',
          skyLow: '#c4cfd6',
          skyBase: '#dee5e9',
          haze: '236,242,246',
          waterTop: '#c5d4db',
          waterMid: '#b4c7d1',
          waterLow: '#a2b9c4',
          ridge: ['#c1ced6', '#b1c2cb', '#a4b7c1'],
          forest: ['#aec0c7', '#9bb0b4', '#88a6a9'],
          forestDeep: '#73908f',
          reed: '#648084',
          shore: '#5c7a7e',
        }

    /* ---------------------------- 山脊 ---------------------------- */
    const makeRidge = (seed: number, peak: number, baseY: number) => {
      const cols = Math.max(14, Math.round(w / 110))
      const step = (w + 240) / cols
      const r = seeded(seed)
      const raw: number[] = []
      let level = 0.45
      for (let i = 0; i <= cols; i += 1) {
        level = Math.max(0.08, Math.min(0.95, level + (r() - 0.5) * 0.26))
        raw.push(level)
      }
      // 三次邻值平滑：山脊像缓坡，而不是随机折线
      let smoothed = raw
      for (let pass = 0; pass < 3; pass += 1) {
        smoothed = smoothed.map((v, i) => (smoothed[i - 1] ?? v) * 0.3 + v * 0.4 + (smoothed[i + 1] ?? v) * 0.3)
      }
      const min = Math.min(...smoothed)
      const max = Math.max(...smoothed)
      const points = smoothed.map((v, i) => ({
        x: -120 + i * step,
        y: baseY - peak * (0.12 + ((v - min) / Math.max(0.0001, max - min)) * 0.88),
      }))
      return { points, baseY }
    }

    const heightAt = (ridge: ReturnType<typeof makeRidge>, x: number) => {
      const { points } = ridge
      for (let i = 1; i < points.length; i += 1) {
        if (points[i].x >= x) {
          const t = (x - points[i - 1].x) / Math.max(1, points[i].x - points[i - 1].x)
          return points[i - 1].y + (points[i].y - points[i - 1].y) * t
        }
      }
      return points[points.length - 1].y
    }

    const fillRidge = (ctx: CanvasRenderingContext2D, ridge: ReturnType<typeof makeRidge>, fill: string) => {
      const { points, baseY } = ridge
      ctx.beginPath()
      ctx.moveTo(points[0].x, baseY + 10)
      for (const p of points) ctx.lineTo(p.x, p.y)
      ctx.lineTo(points[points.length - 1].x, baseY + 10)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }

    const hash = (n: number) => {
      const v = Math.sin(n * 12.9898) * 43758.5453
      return v - Math.floor(v)
    }

    /**
     * 一棵针叶树：细长的塔形，5 层枝梢向外垂，树尖留一段没有分枝的尖顶。
     * 高度不足 6.5px 时退化成三角形，远景里不需要细节。
     */
    const conifer = (ctx: CanvasRenderingContext2D, x: number, base: number, hh: number, hw: number, seed = 0) => {
      if (hh < 6.5) {
        ctx.moveTo(x - hw, base)
        ctx.lineTo(x, base - hh)
        ctx.lineTo(x + hw, base)
        ctx.closePath()
        return
      }
      const tiers = 5
      ctx.moveTo(x, base - hh)
      for (let i = 1; i <= tiers; i += 1) {
        const t = i / tiers
        const y = base - hh * (0.04 + t * 0.88)
        const out = hw * (0.1 + t * 0.9) * (0.88 + 0.12 * Math.sin(i * 2.1 + seed * 3.7))
        ctx.lineTo(x + out, y + hh * 0.012)
        if (i < tiers) ctx.lineTo(x + out * 0.4, y + hh * 0.06)
      }
      ctx.lineTo(x + hw * 0.1, base)
      ctx.lineTo(x - hw * 0.1, base)
      for (let i = tiers; i >= 1; i -= 1) {
        const t = i / tiers
        const y = base - hh * (0.04 + t * 0.88)
        const out = hw * (0.1 + t * 0.9) * (0.88 + 0.12 * Math.sin(i * 2.1 + seed * 3.7))
        if (i < tiers) ctx.lineTo(x - out * 0.4, y + hh * 0.06)
        ctx.lineTo(x - out, y + hh * 0.012)
      }
      ctx.closePath()
    }

    /**
     * 一棵阔叶树：树干 + 十团大小不一的树冠。
     * 树冠不是一个大圆，而是一串高低错落的小圆，远看才有绒毛似的边。
     */
    const broadleaf = (ctx: CanvasRenderingContext2D, x: number, base: number, hh: number, hw: number, seed = 0) => {
      const trunkTop = base - hh * 0.44
      ctx.moveTo(x - hw * 0.09, base)
      ctx.lineTo(x - hw * 0.055, trunkTop)
      ctx.lineTo(x + hw * 0.055, trunkTop)
      ctx.lineTo(x + hw * 0.09, base)
      ctx.closePath()
      const cy = base - hh * 0.63
      const lobes: Array<[number, number, number]> = [
        [-0.62, 0.16, 0.23], [-0.44, -0.06, 0.28], [-0.18, -0.24, 0.27],
        [0.1, -0.3, 0.25], [0.38, -0.12, 0.29], [0.62, 0.14, 0.22],
        [-0.34, 0.28, 0.25], [0.0, 0.3, 0.24], [0.34, 0.27, 0.23],
        [0.0, 0.04, 0.3], [-0.2, 0.02, 0.26], [0.22, 0.13, 0.24],
      ]
      for (const [ox, oy, rr] of lobes) {
        const jitter = 0.82 + hash(seed * 5.3 + ox * 17.3 + oy * 9.1) * 0.4
        const radius = Math.max(1, hw * rr * jitter)
        const cx = x + ox * hw
        const yy = cy + oy * hh
        ctx.moveTo(cx + radius, yy)
        ctx.arc(cx, yy, radius, 0, TAU)
      }
    }

    /**
     * 沿山脊种一片混合林。
     *   · 树高用 1.35 次幂做分布：大部分是矮树，少数冒尖的，林冠顶才有起伏；
     *   · 树种按低频噪声分片，一段针叶、一段阔叶，不会一棵圆一棵尖地交替；
     *   · baseOffset 把前面一排树种到坡面下方几像素，树根不再排成一条直线。
     */
    const forest = (
      ctx: CanvasRenderingContext2D,
      ridge: ReturnType<typeof makeRidge>,
      cfg: { seed: number; spacing: number; height: number; conifer: number; color: string; baseOffset?: number },
    ) => {
      const r = seeded(cfg.seed)
      let x = -80
      let trees = 0
      ctx.beginPath()
      while (x < w + 80) {
        const clump =
          (0.5 + 0.5 * Math.sin(x * 0.0045 + cfg.seed * 0.37)) * 0.6 +
          (0.5 + 0.5 * Math.sin(x * 0.0016 + cfg.seed * 1.7)) * 0.4
        const env = 0.45 + clump * 0.72
        const species = 0.5 + 0.5 * Math.sin(x * 0.0055 + cfg.seed * 0.9) * 0.65 + 0.35 * Math.sin(x * 0.014 + cfg.seed * 2.3)
        const isConifer = r() < cfg.conifer * (0.3 + species * 0.95)
        const size = 0.55 + Math.pow(r(), 0.9) * 0.6
        const emergent = r() < 0.1 ? 1.55 + r() * 0.75 : 1
        const hh = (isConifer
          ? cfg.height * size * env
          : cfg.height * size * 0.92 * env) * emergent * treeF
        const hw = isConifer ? hh * (0.2 + r() * 0.07) : hh * (0.34 + r() * 0.12)
        const base = heightAt(ridge, x) + 2 + (cfg.baseOffset ?? 0) * (0.35 + r() * 0.9)
        if (isConifer) conifer(ctx, x, base, hh, hw, cfg.seed)
        else broadleaf(ctx, x, base, hh, hw, cfg.seed)
        trees += 1
        if (trees % 70 === 0) {
          ctx.fillStyle = cfg.color
          ctx.fill()
          ctx.beginPath()
        }
        x += cfg.spacing * (0.5 + r() * 0.95)
      }
    }

    /**
     * 岸边的低矮灌木：一串半圆贴着水面，把「山脚」和「水」之间的
     * 那条笔直的分界线盖住，也压暗树冠下面的浅色坡面。
     */
    const undergrowth = (ctx: CanvasRenderingContext2D, seed: number, count: number, height: number, color: string) => {
      const r = seeded(seed)
      ctx.fillStyle = color
      ctx.beginPath()
      for (let i = 0; i < count; i += 1) {
        const x = r() * w
        const hh = height * (0.35 + r() * 1)
        const ww = hh * (0.9 + r() * 1.7)
        const cy = landH - hh * 0.2
        ctx.moveTo(x + ww, cy)
        ctx.ellipse(x, cy, ww, hh * 0.78, 0, 0, TAU)
      }
      ctx.fill()
    }

    /**
     * 远看一片森林，先要有一整块「林冠」：
     * 这条曲线由四个不同尺度的正弦叠成，粗的起伏是山坳，细的起伏是树冠，
     * 一次填到山脚，树与树之间就不会露出天空或坡面。
     */
    const canopyMass = (
      ctx: CanvasRenderingContext2D,
      ridge: ReturnType<typeof makeRidge>,
      cfg: { seed: number; height: number; color: string },
    ) => {
      const r = seeded(cfg.seed)
      const step = Math.max(1.2, w / 900)
      ctx.beginPath()
      ctx.moveTo(-40, heightAt(ridge, -40) - cfg.height * 0.6)
      for (let x = -40; x <= w + 40; x += step) {
        const broad =
          0.5 +
          0.22 * Math.sin(x * 0.0038 + cfg.seed * 1.3) +
          0.16 * Math.sin(x * 0.011 + cfg.seed * 2.1) +
          0.1 * Math.sin(x * 0.031 + cfg.seed * 3.7) +
          0.07 * Math.sin(x * 0.077 + cfg.seed * 0.9)
        const jitter = 0.94 + r() * 0.12
        const height = cfg.height * Math.max(0.18, Math.min(1.05, broad + 0.18)) * jitter * treeF
        ctx.lineTo(x, heightAt(ridge, x) - height)
      }
      ctx.lineTo(w + 40, landH + 20)
      ctx.lineTo(-40, landH + 20)
      ctx.closePath()
      ctx.fillStyle = cfg.color
      ctx.fill()
    }

    /* ---------------------------- 陆地 ---------------------------- */
    // 窄屏上树按宽度收一档，避免几棵巨树占满整个林带
    const treeF = Math.max(0.62, Math.min(1.2, Math.pow(w / 1440, 0.35)))
    const ridgeFar = makeRidge(2.3, h * 0.12, landH)
    const ridgeMid = makeRidge(5.7, h * 0.09, landH + 3)
    const ridgeNear = makeRidge(11.4, h * 0.055, landH + 7)

    const land = paint(w, landH, (ctx) => {
      // 远山：几乎融进天色，只留一道薄剪影与细密树梢
      fillRidge(ctx, ridgeFar, tone.ridge[0])
      canopyMass(ctx, ridgeFar, { seed: 13, height: landH * 0.1, color: tone.forest[0] })
      forest(ctx, ridgeFar, { seed: 21, spacing: (w / 150) * scale, height: landH * 0.18, conifer: 0.9, color: tone.forest[0] })

      // 远山与中山之间的一条极薄的雨雾（两端渐隐，不会成为白带）
      const haze1 = ctx.createLinearGradient(0, landH - h * 0.06, 0, landH)
      haze1.addColorStop(0, `rgba(${tone.haze},0)`)
      haze1.addColorStop(0.55, `rgba(${tone.haze},${dark ? 0.24 : 0.26})`)
      haze1.addColorStop(1, `rgba(${tone.haze},${dark ? 0.08 : 0.12})`)
      ctx.fillStyle = haze1
      ctx.fillRect(0, landH - h * 0.06, w, h * 0.06)

      // 中山：坡面本身就是暗色的林地，再叠两排树；前排种低一点，露出前后层次
      fillRidge(ctx, ridgeMid, tone.forest[1])
      canopyMass(ctx, ridgeMid, { seed: 41, height: landH * 0.13, color: tone.forest[1] })
      forest(ctx, ridgeMid, { seed: 53, spacing: (w / 150) * scale, height: landH * 0.26, conifer: 0.55, color: tone.forest[1] })
      forest(ctx, ridgeMid, { seed: 67, spacing: (w / 110) * scale, height: landH * 0.28, conifer: 0.45, color: tone.forest[1], baseOffset: landH * 0.02 })

      const haze2 = ctx.createLinearGradient(0, landH - h * 0.035, 0, landH)
      haze2.addColorStop(0, `rgba(${tone.haze},0)`)
      haze2.addColorStop(0.6, `rgba(${tone.haze},${dark ? 0.16 : 0.18})`)
      haze2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = haze2
      ctx.fillRect(0, landH - h * 0.035, w, h * 0.035)

      // 近山：整片暗林地 + 两排更深的树，最后用灌木把水岸压暗
      fillRidge(ctx, ridgeNear, tone.forestDeep)
      canopyMass(ctx, ridgeNear, { seed: 89, height: landH * 0.16, color: tone.forest[2] })
      forest(ctx, ridgeNear, { seed: 97, spacing: (w / 180) * scale, height: landH * 0.34, conifer: 0.34, color: tone.forest[2] })
      canopyMass(ctx, ridgeNear, { seed: 113, height: landH * 0.08, color: tone.forestDeep })
      forest(ctx, ridgeNear, { seed: 131, spacing: (w / 140) * scale, height: landH * 0.38, conifer: 0.48, color: tone.forestDeep, baseOffset: landH * 0.02 })
      undergrowth(ctx, 191, Math.round(w / 2.6), h * 0.016, tone.shore)
      undergrowth(ctx, 211, Math.round(w / 4), h * 0.024, tone.forestDeep)

      // 岸线：两排高低不一的芦苇，把笔直的水岸线打碎
      const reeds = (seed: number, count: number, height: number, width: number) => {
        const r = seeded(seed)
        ctx.strokeStyle = tone.reed
        ctx.lineCap = 'round'
        for (let i = 0; i < count; i += 1) {
          const x = r() * w
          const hh = 2 + r() * height
          const lean = (r() - 0.5) * hh * 0.9
          ctx.lineWidth = width * (0.5 + r() * 0.8)
          ctx.beginPath()
          ctx.moveTo(x, landH + 1)
          ctx.quadraticCurveTo(x + lean * 0.35, landH - hh * 0.58, x + lean, landH - hh)
          ctx.stroke()
        }
      }
      reeds(151, Math.round(w / 5), h * 0.006 + 2, 0.9)
      reeds(173, Math.round(w / 10), h * 0.011 + 3, 1.2)

      // 岸线底部压暗并略微渐隐，接水面时不会出现一条硬边
      const foot = ctx.createLinearGradient(0, landH - h * 0.014, 0, landH)
      foot.addColorStop(0, 'rgba(0,0,0,0)')
      foot.addColorStop(1, dark ? 'rgba(5,12,16,0.62)' : 'rgba(70,94,99,0.34)')
      ctx.fillStyle = foot
      ctx.fillRect(0, landH - h * 0.014, w, h * 0.014)

      // 光从右侧来：给整片陆地压一层极淡的方向光
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      const tint = ctx.createLinearGradient(w * 0.35, 0, w, 0)
      tint.addColorStop(0, 'rgba(0,0,0,0)')
      tint.addColorStop(1, dark ? 'rgba(150,190,220,0.12)' : 'rgba(255,248,235,0.16)')
      ctx.fillStyle = tint
      ctx.fillRect(0, 0, w, landH)

      // 林冠顶受光、林下压暗：一条很轻的垂直明暗，给树冠一点体积
      const volume = ctx.createLinearGradient(0, 0, 0, landH)
      volume.addColorStop(0, dark ? 'rgba(150,190,220,0.12)' : 'rgba(255,255,255,0.14)')
      volume.addColorStop(0.42, 'rgba(255,255,255,0)')
      volume.addColorStop(1, dark ? 'rgba(0,0,0,0.34)' : 'rgba(24,40,46,0.2)')
      ctx.fillStyle = volume
      ctx.fillRect(0, 0, w, landH)
      ctx.restore()
    })

    /* ---------------------------- 天空 + 陆地 + 水面 ---------------------------- */
    background = paint(w, h, (ctx) => {
      const sky = ctx.createLinearGradient(w * 0.12, 0, w * 0.42, horizon)
      sky.addColorStop(0, tone.skyTop)
      sky.addColorStop(0.34, tone.skyMid)
      sky.addColorStop(0.66, tone.skyLow)
      sky.addColorStop(1, tone.skyBase)
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, horizon + 2)

      if (dark) {
        // 月晕在云层后面
        blob(ctx, moonX, moonY, moonR * 7.5, moonR * 7.5, [
          [0, 'rgba(168,202,234,0.15)'],
          [0.3, 'rgba(138,176,212,0.07)'],
          [0.66, 'rgba(110,150,190,0.022)'],
          [1, 'rgba(0,0,0,0)'],
        ])
        // 月盘：外面一圈柔光，里面才是有边缘的圆盘
        blob(ctx, moonX, moonY, moonR * 1.5, moonR * 1.5, [
          [0, 'rgba(216,234,250,0.55)'],
          [0.5, 'rgba(198,220,242,0.3)'],
          [0.78, 'rgba(180,206,232,0.1)'],
          [1, 'rgba(0,0,0,0)'],
        ])
        ctx.save()
        ctx.beginPath()
        ctx.arc(moonX, moonY, moonR, 0, TAU)
        ctx.clip()
        const disc = ctx.createRadialGradient(moonX - moonR * 0.28, moonY - moonR * 0.32, moonR * 0.08, moonX, moonY, moonR)
        disc.addColorStop(0, 'rgba(248,251,255,0.98)')
        disc.addColorStop(0.62, 'rgba(226,238,251,0.96)')
        disc.addColorStop(1, 'rgba(184,206,227,0.9)')
        ctx.fillStyle = disc
        ctx.fillRect(moonX - moonR, moonY - moonR, moonR * 2, moonR * 2)
        ctx.fillStyle = 'rgba(148,174,200,0.16)'
        for (const [ox, oy, rr] of [[-0.3, -0.14, 0.32], [0.2, 0.24, 0.2], [-0.02, 0.42, 0.14]] as Array<[number, number, number]>) {
          ctx.beginPath()
          ctx.ellipse(moonX + ox * moonR, moonY + oy * moonR, rr * moonR, rr * moonR * 0.82, 0.5, 0, TAU)
          ctx.fill()
        }
        ctx.restore()
      } else {
        // 云后的太阳：只露一个很淡的圆盘，云场会把它遮掉大半
        const sunX = w * 0.765
        const sunY = horizon - h * 0.06
        const sunR = Math.max(7, w * 0.012)
        ctx.save()
        ctx.beginPath()
        ctx.arc(sunX, sunY, sunR, 0, TAU)
        ctx.clip()
        const sunDisc = ctx.createRadialGradient(sunX - sunR * 0.2, sunY - sunR * 0.25, sunR * 0.05, sunX, sunY, sunR)
        sunDisc.addColorStop(0, 'rgba(255,253,246,0.98)')
        sunDisc.addColorStop(0.7, 'rgba(255,248,232,0.85)')
        sunDisc.addColorStop(1, 'rgba(255,241,214,0.6)')
        ctx.fillStyle = sunDisc
        ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2)
        ctx.restore()

        // 云隙天光：地平线右上方的一小片冷光，形状是横着的，不是光柱
        blob(ctx, w * 0.76, horizon - h * 0.04, w * 0.3, h * 0.11, [
          [0, 'rgba(255,253,246,0.44)'],
          [0.32, 'rgba(250,248,240,0.2)'],
          [1, 'rgba(255,255,255,0)'],
        ])
        blob(ctx, w * 0.79, horizon - h * 0.02, w * 0.18, h * 0.06, [
          [0, 'rgba(255,244,224,0.18)'],
          [1, 'rgba(255,255,255,0)'],
        ])
        blob(ctx, w * 0.8, horizon - h * 0.01, w * 0.5, h * 0.07, [
          [0, 'rgba(255,236,206,0.16)'],
          [0.55, 'rgba(255,240,216,0.06)'],
          [1, 'rgba(255,255,255,0)'],
        ])
      }

      // 云场：横向层云，越靠近地平线越薄
      ctx.drawImage(cloudTexture(), 0, 0, w, horizon)

      // 云层之上再补一点光，让月光 / 天光真的「透」出来
      ctx.save()
      if (dark) {
        ctx.globalCompositeOperation = 'lighter'
        blob(ctx, moonX, moonY, moonR * 6, moonR * 6, [
          [0, 'rgba(178,208,238,0.1)'],
          [0.45, 'rgba(142,178,214,0.04)'],
          [1, 'rgba(0,0,0,0)'],
        ])
      } else {
        ctx.globalCompositeOperation = 'lighter'
        blob(ctx, w * 0.76, horizon - h * 0.04, w * 0.18, h * 0.055, [
          [0, 'rgba(255,252,242,0.16)'],
          [1, 'rgba(255,255,255,0)'],
        ])
        // 云缝里最亮的一小团暖光：给阴雨天一个视觉落点
        blob(ctx, w * 0.765, horizon - h * 0.055, w * 0.085, h * 0.032, [
          [0, 'rgba(255,247,229,0.35)'],
          [0.5, 'rgba(255,244,224,0.12)'],
          [1, 'rgba(255,255,255,0)'],
        ])
        blob(ctx, w * 0.765, horizon - h * 0.06, w * 0.026, h * 0.018, [
          [0, 'rgba(255,251,240,0.4)'],
          [0.55, 'rgba(255,246,226,0.16)'],
          [1, 'rgba(255,255,255,0)'],
        ])
      }
      ctx.restore()

      // 云隙光：几束很淡的暖光斜着落向水面，只在浅色白昼出现
      if (!dark) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const originX = w * 0.765
        const originY = horizon - h * 0.15
        const rays: Array<[number, number, number, number]> = [
          [-0.24, 0.075, 0.32, 0.1],
          [-0.1, 0.09, 0.4, 0.12],
          [0.04, 0.11, 0.46, 0.13],
          [0.18, 0.08, 0.34, 0.1],
        ]
        for (const [angle, width, length, alpha] of rays) {
          ctx.save()
          ctx.translate(originX, originY)
          ctx.rotate(angle)
          ctx.globalAlpha = alpha
          ctx.drawImage(raySprite, -w * width * 0.5, 0, w * width, h * length)
          ctx.restore()
        }
        ctx.restore()
      }

      // 地平线一带的雨雾：远处的东西被空气洗淡
      const haze = ctx.createLinearGradient(0, horizon - h * 0.22, 0, horizon)
      haze.addColorStop(0, `rgba(${tone.haze},0)`)
      haze.addColorStop(0.7, `rgba(${tone.haze},${dark ? 0.09 : 0.2})`)
      haze.addColorStop(1, `rgba(${tone.haze},${dark ? 0.2 : 0.44})`)
      ctx.fillStyle = haze
      ctx.fillRect(0, horizon - h * 0.22, w, h * 0.22)

      // 陆地：平滑缩放，避免整数高度差在岸线处留下一行重复像素
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(land, 0, horizon - landH, w, landH)
      ctx.restore()

      // 水面底色
      const sea = ctx.createLinearGradient(0, horizon, 0, h)
      sea.addColorStop(0, tone.waterTop)
      sea.addColorStop(0.18, tone.waterMid)
      sea.addColorStop(1, tone.waterLow)
      ctx.fillStyle = sea
      ctx.fillRect(0, horizon, w, waterH + 1)

      // 远处林间的一点暖光：雨夜里的窗，给冷色画面一个落点
      blob(ctx, lampX, lampY, 26, 26, [
        [0, dark ? 'rgba(255,186,120,0.4)' : 'rgba(236,176,116,0.16)'],
        [0.4, dark ? 'rgba(255,170,96,0.16)' : 'rgba(236,176,116,0.06)'],
        [1, 'rgba(255,170,96,0)'],
      ])
      ctx.save()
      ctx.fillStyle = dark ? 'rgba(255,210,150,0.95)' : 'rgba(230,170,110,0.6)'
      ctx.fillRect(lampX - 1.6, lampY - 1, 3.2, 2)
      ctx.restore()

      // 水岸线：只留一线很淡的反光，避免刀切感
      const shoreLight = ctx.createLinearGradient(0, horizon - 1, 0, horizon + 3)
      shoreLight.addColorStop(0, 'rgba(255,255,255,0)')
      shoreLight.addColorStop(0.5, dark ? 'rgba(190,220,240,0.1)' : 'rgba(255,255,255,0.1)')
      shoreLight.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = shoreLight
      ctx.fillRect(0, horizon - 1, w, 4)
      ctx.fillStyle = dark ? 'rgba(2,6,9,0.55)' : 'rgba(58,84,88,0.4)'
      ctx.fillRect(0, horizon, w, Math.max(1, h * 0.0016))
    })

    /* ---------------------------- 水面覆盖层 ---------------------------- */
    mirror = soften(paint(w, landH, (c) => {
      c.save()
      c.translate(0, landH)
      c.scale(1, -1)
      c.drawImage(land, 0, 0)
      c.restore()
      c.globalCompositeOperation = 'source-atop'
      c.fillStyle = dark ? 'rgba(6,14,20,0.34)' : 'rgba(146,168,180,0.18)'
      c.fillRect(0, 0, w, landH)
    }), 2)

    water = soften(paint(w, waterH, (ctx) => {
      // 倒影顶端（紧贴岸线）压一层水色：镜像会把陆地上的雾带一起翻下来，
      // 不压的话岸线下方会出现一条亮带。真实湖面在掠射角下也偏向水色。
      const shoreLine = ctx.createLinearGradient(0, 0, 0, Math.max(8, waterH * 0.07))
      shoreLine.addColorStop(0, dark ? 'rgba(17,31,39,0.7)' : 'rgba(146,166,178,0.32)')
      shoreLine.addColorStop(0.55, dark ? 'rgba(17,31,39,0.32)' : 'rgba(146,166,178,0.14)')
      shoreLine.addColorStop(1, 'rgba(17,31,39,0)')
      ctx.fillStyle = shoreLine
      ctx.fillRect(0, 0, w, waterH * 0.07)

      const wet = ctx.createLinearGradient(0, 0, 0, waterH)
      if (dark) {
        wet.addColorStop(0, 'rgba(12,23,30,0.12)')
        wet.addColorStop(0.18, 'rgba(7,14,19,0.4)')
        wet.addColorStop(0.55, 'rgba(4,9,12,0.68)')
        wet.addColorStop(1, 'rgba(2,5,7,0.86)')
      } else {
        wet.addColorStop(0, 'rgba(176,193,203,0.06)')
        wet.addColorStop(0.18, 'rgba(158,175,185,0.18)')
        wet.addColorStop(0.55, 'rgba(140,157,168,0.3)')
        wet.addColorStop(1, 'rgba(128,145,157,0.42)')
      }
      ctx.fillStyle = wet
      ctx.fillRect(0, 0, w, waterH)

      // 月光 / 天光在水面拉出的一条碎光柱
      const columnX = dark ? moonX : w * 0.76
      const columnW = Math.max(24, w * 0.052)
      blob(ctx, columnX, 0, columnW * 1.6, waterH * 0.95, [
        [0, dark ? 'rgba(198,226,246,0.46)' : 'rgba(255,240,212,0.46)'],
        [0.28, dark ? 'rgba(170,206,234,0.16)' : 'rgba(255,236,204,0.18)'],
        [1, 'rgba(255,255,255,0)'],
      ])

      const glint = seeded(73)
      for (let i = 0; i < 110; i += 1) {
        const t = Math.pow(glint(), 1.25)
        const y = 2 + t * (waterH - 6)
        const spread = columnW * (0.35 + t * 2.4)
        const x = columnX + (glint() - 0.5) * spread
        const len = (3 + glint() * 22) * (0.45 + t)
        ctx.strokeStyle = dark
          ? `rgba(214,236,250,${(0.04 + glint() * 0.14).toFixed(3)})`
          : `rgba(255,246,226,${(0.08 + glint() * 0.2).toFixed(3)})`
        ctx.lineWidth = 0.6 + glint() * 1.1
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + len, y)
        ctx.stroke()
      }

      // 横向水纹：短、碎、疏密不均；长线只留极淡的几笔当风痕
      const r = seeded(211)
      for (let i = 0; i < 780; i += 1) {
        const t = Math.pow(r(), 1.25)
        const y = 2 + t * (waterH - 5)
        const len = (5 + r() * 38) * (0.6 + t * 1.2)
        const x = r() * w - len * 0.3
        ctx.strokeStyle = dark
          ? `rgba(184,214,232,${(0.024 + r() * 0.06 + t * 0.02).toFixed(3)})`
          : `rgba(255,255,255,${(0.07 + r() * 0.15 + t * 0.04).toFixed(3)})`
        ctx.lineWidth = 0.55 + r() * 1.2
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + len * 0.5, y + (r() - 0.5) * 1.6, x + len, y + (r() - 0.5) * 0.6)
        ctx.stroke()
      }
      // 林间暖光在水面的一小段倒影
      const lampGlint = seeded(83)
      for (let i = 0; i < 9; i += 1) {
        const y = 3 + i * (waterH * 0.012)
        const x = lampX + (lampGlint() - 0.5) * 6 - i * 0.4
        const len = (6 - i * 0.45) * (0.8 + lampGlint() * 0.5)
        ctx.strokeStyle = dark
          ? `rgba(255,194,128,${(0.1 - i * 0.008).toFixed(3)})`
          : `rgba(230,170,110,${(0.05 - i * 0.004).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x - len * 0.5, y)
        ctx.lineTo(x + len * 0.5, y)
        ctx.stroke()
      }

      // 长风痕：几条很淡的横向亮带，给水面一点大尺度的结构
      for (let i = 0; i < 7; i += 1) {
        const y = waterH * (0.16 + i * 0.12) + (r() - 0.5) * 12
        blob(ctx, w * (0.1 + r() * 0.8), y, w * (0.16 + r() * 0.16), 3 + r() * 6, [
          [0, dark ? 'rgba(150,190,216,0.035)' : 'rgba(255,255,255,0.09)'],
          [1, 'rgba(255,255,255,0)'],
        ])
      }
    }), 2)

    /* ------------------------------ 雾团 ------------------------------ */
    const cachedMist = rainMistCache.get(dark)
    if (cachedMist) {
      mistTex = cachedMist
    } else {
      const mistRaw = paint(320, 160, (c) => {
        const r = seeded(97)
        // 每个雾团在 x、x±320 各画一次：贴图左右无缝，横向拉伸时不会露出竖边
        for (let i = 0; i < 70; i += 1) {
          const cx = r() * 320
          const cy = r() * 160
          const radius = 16 + r() * 58
          const a = 0.04 + r() * 0.08
          for (const ox of [-320, 0, 320]) {
            blob(c, cx + ox, cy, radius, radius * 0.7, [
              [0, dark ? `rgba(174,208,226,${a})` : `rgba(255,255,255,${a * 1.5})`],
              [1, 'rgba(255,255,255,0)'],
            ])
          }
        }
      })
      const mistSoft = soften(mistRaw, 4)
      // 边缘羽化：贴图四周的 alpha 收到 0，这样 drawImage 拉伸后不会在屏幕里
      // 留下两条竖直的硬边（screen 混合下尤其明显）。
      mistTex = paint(mistSoft.width, mistSoft.height, (c) => {
        c.drawImage(mistSoft, 0, 0)
        c.globalCompositeOperation = 'destination-in'
        const edgeX = c.createLinearGradient(0, 0, mistSoft.width, 0)
        edgeX.addColorStop(0, 'rgba(0,0,0,0)')
        edgeX.addColorStop(0.16, 'rgba(0,0,0,1)')
        edgeX.addColorStop(0.84, 'rgba(0,0,0,1)')
        edgeX.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = edgeX
        c.fillRect(0, 0, mistSoft.width, mistSoft.height)
        const edgeY = c.createLinearGradient(0, 0, 0, mistSoft.height)
        edgeY.addColorStop(0, 'rgba(0,0,0,0)')
        edgeY.addColorStop(0.2, 'rgba(0,0,0,1)')
        edgeY.addColorStop(0.8, 'rgba(0,0,0,1)')
        edgeY.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = edgeY
        c.fillRect(0, 0, mistSoft.width, mistSoft.height)
      })
      rainMistCache.set(dark, mistTex)
    }

    /* ------------------------------ 雷光 ------------------------------ */
    flashTex = paint(w, h, (ctx) => {
      blob(ctx, w * 0.68, h * 0.13, Math.max(w, h) * 0.72, Math.max(w, h) * 0.6, [
        [0, dark ? 'rgba(198,224,244,0.72)' : 'rgba(255,255,255,0.8)'],
        [0.16, dark ? 'rgba(160,198,226,0.3)' : 'rgba(255,255,255,0.34)'],
        [0.5, dark ? 'rgba(126,166,198,0.08)' : 'rgba(255,255,255,0.08)'],
        [1, 'rgba(255,255,255,0)'],
      ])
      // 闪电：一条主枝 + 两条分叉，带柔光
      const bolt = (fromX: number, fromY: number, toX: number, toY: number, steps: number, seed: number, alpha: number, width: number) => {
        const r = seeded(seed)
        ctx.save()
        ctx.strokeStyle = `rgba(238,248,255,${alpha})`
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps
          ctx.lineTo(fromX + (toX - fromX) * t + (r() - 0.5) * w * 0.02, fromY + (toY - fromY) * t)
        }
        ctx.stroke()
        ctx.restore()
      }
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.shadowColor = 'rgba(198,228,250,0.85)'
      ctx.shadowBlur = 24
      bolt(w * 0.72, h * 0.07, w * 0.65, horizon * 0.78, 10, 5, dark ? 0.8 : 0.55, Math.max(1.3, 1.7 * scale))
      bolt(w * 0.69, h * 0.03, w * 0.65, h * 0.24, 6, 13, dark ? 0.4 : 0.28, Math.max(0.9, 1 * scale))
      bolt(w * 0.89, h * 0.11, w * 0.93, horizon * 0.55, 6, 21, dark ? 0.28 : 0.2, Math.max(0.8, 0.85 * scale))
      ctx.restore()
      // 水面反光
      const wg = ctx.createLinearGradient(0, horizon, 0, h)
      wg.addColorStop(0, dark ? 'rgba(166,200,226,0.26)' : 'rgba(255,255,255,0.22)')
      wg.addColorStop(0.45, dark ? 'rgba(120,158,192,0.05)' : 'rgba(255,255,255,0.04)')
      wg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = wg
      ctx.fillRect(0, horizon, w, waterH)
    })

    /* -------------------------- 水面碎光（动画） -------------------------- */
    shimmer = paint(w, waterH, (ctx) => {
      const r = seeded(307)
      const columnX = dark ? moonX : w * 0.76
      const columnW = Math.max(24, w * 0.052)
      for (let i = 0; i < 64; i += 1) {
        const t = Math.pow(r(), 1.35)
        const y = 2 + t * (waterH - 6)
        const spread = columnW * (0.4 + t * 2.2)
        const x = columnX + (r() - 0.5) * spread
        const len = (3 + r() * 24) * (0.4 + t)
        ctx.strokeStyle = dark
          ? `rgba(222,242,255,${(0.1 + r() * 0.24).toFixed(3)})`
          : `rgba(255,246,226,${(0.1 + r() * 0.24).toFixed(3)})`
        ctx.lineWidth = 0.6 + r() * 1.2
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + len, y)
        ctx.stroke()
      }
    })

    /* ---------------------------- 调色层 ---------------------------- */
    grade = paint(w, h, (ctx) => {
      const sides = ctx.createLinearGradient(0, 0, w, 0)
      sides.addColorStop(0, dark ? 'rgba(1,3,5,0.34)' : 'rgba(74,94,106,0.12)')
      sides.addColorStop(0.26, 'rgba(0,0,0,0)')
      sides.addColorStop(0.74, 'rgba(0,0,0,0)')
      sides.addColorStop(1, dark ? 'rgba(1,3,5,0.34)' : 'rgba(74,94,106,0.12)')
      ctx.fillStyle = sides
      ctx.fillRect(0, 0, w, h)

      const vg = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.24, w * 0.5, h * 0.52, Math.hypot(w, h) * 0.66)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, `rgba(0,0,0,${dark ? 0.48 : 0.06})`)
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)

      // 光的来向：右侧一丝极淡的暖色，让整片灰蓝不至于发闷
      if (!dark) {
        ctx.fillStyle = 'rgba(238,243,246,0.15)'
        ctx.fillRect(0, 0, w, h)
      }

      const warm = ctx.createLinearGradient(w * 0.45, 0, w, 0)
      warm.addColorStop(0, 'rgba(0,0,0,0)')
      warm.addColorStop(1, dark ? 'rgba(140,180,214,0.035)' : 'rgba(255,226,180,0.05)')
      ctx.fillStyle = warm
      ctx.fillRect(0, 0, w, h)

      // 极细颗粒，压掉大面积渐变的色带
      const grain = seeded(5)
      for (let i = 0; i < Math.round((w * h) / 900); i += 1) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(24,32,40,0.03)'
        ctx.fillRect(grain() * w, grain() * h, 1, 1)
      }
    })

    /* ------------------------ 近景虚焦芦苇（景深） ------------------------ */
    foreground = soften(paint(w, h, (ctx) => {
      const r = seeded(401)
      ctx.lineCap = 'round'
      const blade = (origin: number, dir: number) => {
        for (let i = 0; i < 18; i += 1) {
          const x = origin + dir * r() * w * 0.12
          const hh = h * (0.07 + r() * 0.17)
          const lean = dir * w * (0.01 + r() * 0.06)
          ctx.lineWidth = 1.4 + r() * 4.6
          ctx.strokeStyle = dark
            ? `rgba(3,8,11,${(0.36 + r() * 0.36).toFixed(3)})`
            : `rgba(52,72,82,${(0.2 + r() * 0.24).toFixed(3)})`
          ctx.beginPath()
          ctx.moveTo(x, h + 20)
          ctx.quadraticCurveTo(x + lean * 0.2, h - hh * 0.55, x + lean, h - hh)
          ctx.stroke()
        }
      }
      blade(-w * 0.04, 1)
      blade(w * 1.04, -1)
    }), 4)

    /* -------------------- 光学水滴贴图与远景斜向雨幕 -------------------- */
    dropSoft = makeWaterDropSprite(
      16,
      96,
      dark ? [138, 176, 206] : [126, 152, 172],
      dark ? [208, 234, 250] : [246, 251, 255],
      1.55,
    )
    dropCrisp = makeWaterDropSprite(
      16,
      112,
      dark ? [164, 202, 230] : [114, 142, 164],
      dark ? [240, 250, 255] : [255, 255, 255],
      1.2,
    )
    rainVeil = soften(
      paint(256, 256, (ctx) => {
        const image = ctx.createImageData(256, 256)
        const data = image.data
        const veilRgb = dark ? [150, 188, 218] : [224, 236, 245]
        for (let py = 0; py < 256; py += 1) {
          const v = py / 255
          const envY = Math.sin(Math.PI * Math.pow(v, 0.82))
          for (let px = 0; px < 256; px += 1) {
            const u = px / 255
            // 横纵向双端平滑归零，绝不留下贴图边界硬接缝
            const envX = Math.pow(Math.sin(Math.PI * u), 1.4)
            const streak = fbm(u * 3.1 - v * 0.55, v * 0.42)
            const a = smooth01(0.42, 0.78, streak) * envY * envX
            const idx = (py * 256 + px) * 4
            data[idx] = veilRgb[0]
            data[idx + 1] = veilRgb[1]
            data[idx + 2] = veilRgb[2]
            data[idx + 3] = Math.round(a * 255)
          }
        }
        ctx.putImageData(image, 0, 0)
      }),
      4,
    )
  }

  return {
    fps: 60,
    setup(width, height) {
      w = width
      h = height
      build()
      drops = []
      ripples = []
      resize(drops, Math.round((values.count ?? 70) * 6.8 * area(w, h)), spawn)
    },
    configure(next) {
      values = next
      resize(drops, Math.round((values.count ?? 70) * 6.8 * area(w, h)), spawn)
      if (!(values.lightning ?? 0)) {
        flash = 0
        second = 0
      }
    },
    setTone(next) {
      if (next !== dark) {
        dark = next
        build()
      }
    },
    step(dt) {
      time += dt
      flash = Math.max(0, flash - dt * 3.4)
      if (second > 0) {
        second -= dt
        if (second <= 0) flash = Math.max(flash, 0.45)
      }
      if ((values.lightning ?? 0) > 0 && time > nextFlash) {
        flash = 0.5 + (values.lightning ?? 0) * 0.0045
        second = 0.14
        nextFlash = time + rand(8, 18)
      }

      const speed = values.speed ?? 65
      for (const d of drops) {
        // 用推进前的时刻 slope 积分一步，保证上一帧绘制角度与本步位移向量严格同轴
        const slope = currentSlope(d, time - dt)
        const vy = dropVelocity(speed, d.z)
        d.y += vy * dt
        d.x += vy * slope * dt
        if (d.y > h + 40 || d.x < -w * 0.55 || d.x > w * 1.35) Object.assign(d, spawn(true))
      }

      rippleClock += dt * ((values.count ?? 70) / 100) * (0.85 + speed / 95)
      while (rippleClock > 0.032) {
        rippleClock -= 0.032
        if (ripples.length < 56) {
          const depth = Math.pow(Math.random(), 0.6)
          ripples.push({
            x: rand(-20, w + 20),
            y: horizon + 8 + depth * (h - horizon - 12),
            age: 0,
            life: rand(0.42, 0.85),
            scale: rand(0.4, 1.2),
            depth,
          })
        }
      }
      for (const r of ripples) r.age += dt
      ripples = ripples.filter((r) => r.age < r.life)
    },
    draw(ctx) {
      ctx.drawImage(background, 0, 0, w, h)

      /* 倒影：分带贴回，每带横向偏移随时间轻微变化，水面就有了「晃动」 */
      const bands = 7
      const bandH = mirror.height / bands
      const stretch = 0.86
      ctx.save()
      ctx.globalAlpha = dark ? 0.62 : 0.54
      for (let i = 0; i < bands; i += 1) {
        const drift = Math.sin(time * 0.45 + i * 0.85) * (1.1 + i * 1.15) + Math.sin(time * 0.19 + i * 2.2) * 1.8
        const fade = [0.62, 0.84, 0.97, 1, 0.98, 0.9, 0.74][i] ?? 0.8
        ctx.globalAlpha = (dark ? 0.62 : 0.54) * fade
        ctx.drawImage(mirror, 0, i * bandH, mirror.width, bandH, drift, horizon + i * bandH * stretch, w, bandH * stretch + 1)
      }
      ctx.restore()

      /* 水面覆盖层 */
      ctx.drawImage(water, 0, horizon, w, h - horizon)

      /* 碎光柱：亮度随水面呼吸，横向轻微漂移 */
      const breathe = 0.4 + 0.22 * Math.sin(time * 0.9) + 0.08 * Math.sin(time * 2.3)
      ctx.save()
      ctx.globalAlpha = dark ? breathe : breathe * 0.7
      ctx.drawImage(shimmer, Math.sin(time * 0.5) * 3, horizon, w, h - horizon)
      ctx.restore()

      /* 雨雾：贴着山脚与湖面缓慢横移 */
      const mist = (values.mist ?? 40) / 100
      if (mist > 0.02) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'screen' : 'source-over'
        for (let i = 0; i < 4; i += 1) {
          const span = w * 1.6
          const drift = ((time * (0.005 + i * 0.004) + i * 0.29) % 1) * span - w * 0.3
          const y = horizon - h * (0.075 + i * 0.028) + Math.sin(time * 0.07 + i * 1.6) * 5
          ctx.globalAlpha = mist * [0.4, 0.28, 0.2, 0.14][i]
          ctx.drawImage(mistTex, drift, y, w * (0.75 + i * 0.1), h * (0.09 + i * 0.026))
        }
        ctx.restore()
      }
      // 贴着水面的低雾：把岸线与倒影的硬边再柔化一层
      if (mist > 0.02) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'screen' : 'source-over'
        ctx.globalAlpha = mist * (dark ? 0.28 : 0.42)
        const driftLow = ((time * 0.006) % 1) * w * 1.2 - w * 0.1
        ctx.drawImage(mistTex, driftLow, horizon - h * 0.055, w * 1.1, h * 0.1)
        ctx.globalAlpha = mist * (dark ? 0.1 : 0.14)
        const driftLow2 = ((time * 0.004 + 0.4) % 1) * w * 1.2 - w * 0.1
        ctx.drawImage(mistTex, driftLow2, horizon - h * 0.008, w * 1.06, h * 0.05)
        ctx.restore()
      }

      /* 远景柔焦雨幕：用大尺度水汽纹理表现漫天雨势，完全不产生细碎线条噪声 */
      const windBase = (values.wind ?? 25) / 100
      const gust = 1 + 0.14 * Math.sin(time * 0.37) + 0.07 * Math.sin(time * 0.91 + 1.4)
      const wind = windBase * gust
      const speed = values.speed ?? 65
      ctx.save()
      for (let i = 0; i < 2; i += 1) {
        const veilX = (((time * (0.045 + i * 0.028) * (0.4 + wind)) + i * 0.5) % 1) * w * 1.5 - w * 0.45
        ctx.globalAlpha = (dark ? 0.048 : 0.082) * (0.65 + mist * 0.7)
        ctx.drawImage(rainVeil, veilX, -h * 0.06, w * 0.95, horizon * 1.08)
      }
      ctx.restore()

      /* 自然光学雨滴：圆润水珠 + 渐隐短水雾尾迹 + 中央阅读区柔化退让 */
      const halfW = Math.max(1, w * 0.5)
      // 中央正文列（约 820px 宽）平滑降噪，两侧天空与山湖保留完整雨景层次
      const readingEdgeInner = Math.min(0.42, 340 / halfW)
      const readingEdgeOuter = Math.min(0.84, 560 / halfW)
      ctx.save()
      ctx.imageSmoothingEnabled = true
      for (const d of drops) {
        const slope = currentSlope(d, time)
        const normX = Math.abs(d.x - halfW) / halfW
        const outsideReading = smooth01(readingEdgeInner, readingEdgeOuter, normX)
        // 纤细柔焦梭形水滴（宽 1.5–3.1px，长 12–34px）：首尾双端平滑渐隐，既有真雨丝雾感又绝非生硬直线或雪点
        const vy = dropVelocity(speed, d.z)
        const dropW = (1.55 + d.z * 1.45) * d.size
        const dropH = (10 + vy * 0.0095) * d.size
        const baseAlpha = dark
          ? (0.14 + d.z * 0.20) * (0.62 + d.bright * 0.5)
          : (0.16 + d.z * 0.22) * (0.62 + d.bright * 0.48)
        // 阅读区平滑衰减至 32%，两侧山湖烟雨濛濛而中央正文清澈宁静
        ctx.globalAlpha = baseAlpha * (0.32 + 0.68 * outsideReading)
        const sprite = d.z > 0.56 && d.bright > 0.45 ? dropCrisp : dropSoft
        ctx.save()
        ctx.translate(d.x, d.y)
        ctx.rotate(-Math.atan(slope))
        ctx.drawImage(sprite, -dropW * 0.5, -dropH, dropW, dropH)
        ctx.restore()
      }
      ctx.restore()

      /* 涟漪：外圈 + 内圈 + 落下瞬间的一根小水柱 */
      ctx.save()
      ctx.lineCap = 'round'
      for (const r of ripples) {
        const t = r.age / r.life
        const radius = (3.5 + t * 17) * r.scale * (0.55 + r.depth * 1.1)
        ctx.strokeStyle = dark
          ? `rgba(190,222,240,${((1 - t) * (0.14 + r.depth * 0.18)).toFixed(3)})`
          : `rgba(255,255,255,${((1 - t) * (0.26 + r.depth * 0.3)).toFixed(3)})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.ellipse(r.x, r.y, radius, radius * (0.13 + r.depth * 0.1), 0, 0, TAU)
        ctx.stroke()
        if (t < 0.56) {
          ctx.globalAlpha = (1 - t) * 0.4
          ctx.beginPath()
          ctx.ellipse(r.x, r.y, radius * 0.46, radius * (0.07 + r.depth * 0.05), 0, 0, TAU)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        if (t < 0.12) {
          ctx.strokeStyle = dark ? 'rgba(235,248,255,0.4)' : 'rgba(255,255,255,0.62)'
          const hh = (2 + r.depth * 4) * (1 - t / 0.12)
          ctx.beginPath()
          ctx.moveTo(r.x, r.y - hh)
          ctx.lineTo(r.x, r.y)
          ctx.stroke()
        }
      }
      ctx.restore()

      /* 统一调色：两侧压暗 + 暗角 + 细颗粒 */
      ctx.drawImage(grade, 0, 0, w, h)

      /* 雷光：只提亮云层与水面 */
      if (flash > 0.004) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = Math.min(1, flash) * (dark ? 0.72 : 0.36)
        ctx.drawImage(flashTex, 0, 0, w, h)
        ctx.restore()
      }

      /* 近景芦苇：虚焦、压在最前面，给画面一个近处参照 */
      ctx.save()
      ctx.globalAlpha = dark ? 0.82 : 0.6
      ctx.drawImage(foreground, 0, 0, w, h)
      ctx.restore()
    },
  }
}

/** 竹竿与叶簇预绘在独立贴图中，按远中近三层缓慢摆动。 */
export function createBamboo(initialDark: boolean): Renderer {
  interface Stem { x: number; depth: number; phase: number; lean: number; sprite: HTMLCanvasElement }
  let w = 1, h = 1, dark = initialDark, time = 0
  let values: SceneValues = {}, stems: Stem[] = [], background: HTMLCanvasElement, fog: HTMLCanvasElement
  const stemSprite = (seed: number, depth: number) => paint(220, Math.min(1200, h + 100), ctx => {
    const sh = ctx.canvas.height, thick = 3 + depth * 9
    const shade = dark ? ['#284941', '#376658', '#4a7c60'] : ['#a2bd9a', '#6f9467', '#456f4d']
    const gradient = ctx.createLinearGradient(100 - thick, 0, 100 + thick, 0)
    gradient.addColorStop(0, shade[0]); gradient.addColorStop(.35, shade[2]); gradient.addColorStop(1, shade[1])
    ctx.fillStyle = gradient; ctx.fillRect(100 - thick / 2, 0, thick, sh)
    const segment = 75 + seed * 25
    for (let y = 30; y < sh; y += segment) {
      ctx.strokeStyle = dark ? 'rgba(157,193,142,.35)' : 'rgba(233,242,210,.65)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(99 - thick / 2, y); ctx.lineTo(102 + thick / 2, y - 1); ctx.stroke()
      if (y > sh * .84) continue
      const side = Math.sin(y + seed * 9) > 0 ? 1 : -1
      ctx.strokeStyle = shade[1]; ctx.lineWidth = 1.3
      ctx.beginPath(); ctx.moveTo(100, y); ctx.quadraticCurveTo(100 + side * 35, y - 20, 100 + side * 65, y - 35); ctx.stroke()
      ctx.fillStyle = shade[depth > .65 ? 2 : 1]
      for (let j = 0; j < 9; j++) {
        const px = 100 + side * (15 + j * 5), py = y - 9 - j * 3.4, direction = j % 2 ? -1 : 1
        ctx.save(); ctx.translate(px, py); ctx.rotate(side * -.35 + direction * .65)
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -8, 28 + seed * 8, -4); ctx.quadraticCurveTo(13, 4, 0, 0); ctx.fill(); ctx.restore()
      }
    }
  })
  const rebuildStems = () => {
    const count = Math.round(10 + (values.density ?? 55) * .35 * Math.max(.65, Math.min(1.6, w / 1440)))
    resize(stems, count, () => ({ x: Math.random(), depth: rand(.1, 1), phase: rand(0, TAU), lean: rand(-.065, .065), sprite: document.createElement('canvas') }))
    stems.sort((a, b) => a.depth - b.depth)
    for (let i = 0; i < stems.length; i++) stems[i].sprite = stemSprite((i * .618) % 1, stems[i].depth)
  }
  const build = () => {
    background = paint(w, h, ctx => {
      sky(ctx, w, h, dark ? ['#071a18', '#112f28', '#1b3c31'] : ['#e8f0dd', '#f4f5e7', '#cbdcc1'])
      const sun = ctx.createRadialGradient(w * .62, h * .18, 0, w * .62, h * .18, w * .65)
      sun.addColorStop(0, dark ? 'rgba(185,221,201,.12)' : 'rgba(255,253,219,.8)'); sun.addColorStop(1, 'rgba(215,240,207,0)')
      ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h)
    })
    fog = paint(256, 128, ctx => {
      const g = ctx.createRadialGradient(128, 64, 0, 128, 64, 128)
      g.addColorStop(0, dark ? 'rgba(157,197,172,.2)' : 'rgba(246,249,225,.85)'); g.addColorStop(1, 'rgba(210,230,200,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128)
    })
    rebuildStems()
  }
  return {
    fps: 24,
    setup(width, height) { w = width; h = height; build() },
    configure(next) { const previous = values.density; values = next; if (previous !== next.density) rebuildStems() },
    setTone(next) { if (next !== dark) { dark = next; build() } },
    step(dt) { time += dt * (.15 + (values.speed ?? 35) / 100) },
    draw(ctx) {
      ctx.drawImage(background, 0, 0, w, h)
      ctx.save()
      for (const stem of stems) {
        const depth = stem.depth, sway = Math.sin(time + stem.phase) * .02 * (values.wind ?? 40) / 40
        ctx.save(); ctx.translate(stem.x * (w + 160) - 80, h + 40)
        ctx.rotate(stem.lean + sway * (.35 + depth))
        ctx.globalAlpha = .25 + depth * .6
        const scale = .6 + depth * .65
        ctx.drawImage(stem.sprite, -100 * scale, -h * (1.1 + depth * .12), 220 * scale, h * (1.1 + depth * .12)); ctx.restore()
      }
      ctx.globalAlpha = (values.mist ?? 45) / 100
      ctx.drawImage(fog, Math.sin(time * .13) * w * .14 - w * .15, h * .38, w * 1.4, h * .65)
      ctx.globalAlpha = (values.light ?? 45) / 100 * (dark ? .025 : .07)
      ctx.fillStyle = dark ? '#bde7d6' : '#fffce2'
      for (let i = 0; i < 4; i++) {
        const x = w * (.35 + i * .16) + Math.sin(time * .25) * 16
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * .04, 0); ctx.lineTo(x - w * .25, h); ctx.lineTo(x - w * .4, h); ctx.closePath(); ctx.fill()
      }
      ctx.restore()
    },
  }
}
