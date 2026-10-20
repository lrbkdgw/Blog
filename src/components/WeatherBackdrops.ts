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

/**
 * 暴雨：雨夜 / 阴雨白昼的山湖。
 *
 * 视觉目标是「安静但有层次」，不是特效堆砌：
 *   · 天空只有厚薄不一的雨云，靠近地平线的一侧略亮，没有探照灯式的光柱；
 *   · 三层山脊各自带一条连续的林冠剪影，层与层之间夹极薄的雨雾；
 *   · 湖面是深色的镜面，倒影分带错位，靠涟漪和横向水纹把它「打碎」；
 *   · 雨分三层，越近越长越淡；雷光默认关闭，开启后只提亮云层与水面。
 *
 * 所有静态部分在 setup() / setTone() 时烘焙进离屏 canvas，逐帧只做少量
 * drawImage 与批量描边；山形与树林用固定种子，缩放窗口不会换一张脸。
 */
export function createRain(initialDark: boolean): Renderer {
  interface Drop { x: number; y: number; z: number; len: number; drift: number }
  interface Ripple { x: number; y: number; age: number; life: number; scale: number; depth: number }

  let w = 1, h = 1, dark = initialDark, time = 0, flash = 0, second = 0, nextFlash = 9
  let horizon = 0
  let values: SceneValues = {}
  let drops: Drop[] = []
  let ripples: Ripple[] = []
  let rippleClock = 0
  let background: HTMLCanvasElement
  let mirror: HTMLCanvasElement
  let water: HTMLCanvasElement
  let mistTex: HTMLCanvasElement
  let flashTex: HTMLCanvasElement

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

  const spawn = (top = false): Drop => ({
    x: rand(-w * 0.3, w * 1.2),
    y: top ? rand(-h * 0.5, -18) : rand(-60, h),
    z: rand(0.05, 1),
    len: rand(0.45, 1.75),
    drift: rand(0.7, 1.35),
  })

  const build = () => {
    horizon = Math.round(h * 0.7)
    const landH = Math.round(h * 0.185)
    const scale = Math.max(0.72, Math.min(1.55, w / 1440))

    /* -------- 配色：浅色是阴雨白昼，深色是冷调雨夜 -------- */
    const tone = dark
      ? {
          skyTop: '#04070c',
          skyMid: '#0a151f',
          skyLow: '#162b37',
          skyBase: '#223d4a',
          cloud: '3,6,10',
          cloudLow: '44,70,84',
          haze: '18,34,44',
          waterTop: '#0d1b23',
          waterMid: '#071017',
          waterLow: '#03070a',
          ridge: ['#33505f', '#223a47', '#0e1c25'],
          forest: ['#2b4756', '#1a2f3b', '#08121a'],
          rim: 'rgba(168,205,224,0.22)',
          glimmer: 'rgba(196,224,242,0.5)',
        }
      : {
          skyTop: '#8ea3b2',
          skyMid: '#a8b9c4',
          skyLow: '#c2ced6',
          skyBase: '#d8e0e5',
          cloud: '104,124,141',
          cloudLow: '255,255,255',
          haze: '226,235,240',
          waterTop: '#8ea3af',
          waterMid: '#9aadb8',
          waterLow: '#8b9daa',
          ridge: ['#adc0ca', '#92a8b4', '#7c95a2'],
          forest: ['#a6bac5', '#8ba2ae', '#6d8794'],
          rim: 'rgba(255,255,255,0.5)',
          glimmer: 'rgba(255,255,255,0.6)',
        }

    /* ---------------------------- 山脊 ---------------------------- */
    const makeRidge = (seed: number, peak: number, baseY: number) => {
      const cols = Math.max(12, Math.round(w / 88))
      const step = (w + 160) / cols
      const raw: number[] = []
      for (let i = 0; i <= cols; i += 1) {
        raw.push(
          Math.sin(i * 0.38 + seed) * 0.44 +
          Math.sin(i * 0.91 + seed * 2.3) * 0.26 +
          Math.sin(i * 0.17 + seed * 0.9) * 0.3,
        )
      }
      // 平滑一次，山脊线才不抖
      const smooth = raw.map((v, i) => (raw[i - 1] ?? v) * 0.28 + v * 0.44 + (raw[i + 1] ?? v) * 0.28)
      const min = Math.min(...smooth)
      const max = Math.max(...smooth)
      const norm = smooth.map((v) => (v - min) / Math.max(0.0001, max - min))
      const points: Array<{ x: number; y: number }> = []
      for (let i = 0; i <= cols; i += 1) {
        points.push({ x: -80 + i * step, y: baseY - peak * (0.12 + norm[i] * 0.88) })
      }
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

    const fillRidge = (ctx: CanvasRenderingContext2D, ridge: ReturnType<typeof makeRidge>, fill: string, rim?: string) => {
      const { points, baseY } = ridge
      ctx.beginPath()
      ctx.moveTo(points[0].x, baseY + 10)
      for (const p of points) ctx.lineTo(p.x, p.y)
      ctx.lineTo(points[points.length - 1].x, baseY + 10)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      if (rim) {
        ctx.save()
        ctx.strokeStyle = rim
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (const p of points) ctx.lineTo(p.x, p.y)
        ctx.stroke()
        ctx.restore()
      }
    }

    /**
     * 林冠：贴着山脊长出来的连片树林。
     *
     * 做法是把「山脊线」和「树高」各自当成 x 的函数：
     *   树高 = 低频的成簇起伏 × 高频的树梢尖角
     * 再把 canopy = 山脊线 - 树高 一次填成多边形。
     * 于是树林永远贴着坡面，不会有「一排树浮在半空」或「每段重复一条带」的问题。
     */
    const canopy = (
      ctx: CanvasRenderingContext2D,
      topAt: (x: number) => number,
      treeH: (x: number) => number,
      color: string,
    ) => {
      const step = Math.max(1.2, w / 1400)
      ctx.beginPath()
      ctx.moveTo(-40, topAt(-40) - treeH(-40))
      for (let x = -40; x <= w + 40; x += step) ctx.lineTo(x, topAt(x) - treeH(x))
      ctx.lineTo(w + 40, topAt(w + 40) + h)
      ctx.lineTo(-40, topAt(-40) + h)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    }

    /** 树顶：低频成簇 + 高频树梢，最后再叠一点随机让树梢疏密不均 */
    const treeProfile = (seed: number, base: number, spread: number, density: number) => {
      const r = seeded(seed)
      const jitter: number[] = []
      for (let i = 0; i < 256; i += 1) jitter.push(0.55 + r() * 0.9)
      return (x: number) => {
        const cluster = Math.sin(x * 0.0062 + seed) * 0.5 + Math.sin(x * 0.0141 + seed * 2.1) * 0.3 + Math.sin(x * 0.0023 + seed * 0.7) * 0.2
        const clump = Math.max(0, cluster * 0.5 + 0.52)
        const spike = Math.pow(Math.abs(Math.sin(x * (0.155 * density) + seed * 3.1)), 0.82)
        const fine = Math.pow(Math.abs(Math.sin(x * (0.47 * density) + seed * 7.7)), 0.95)
        const j = jitter[Math.floor((x * 0.5) % 256 + 256) % 256]
        return base * (0.18 + clump * 0.92) * (0.66 + spike * 0.42 + fine * 0.18) * j * (1 + spread)
      }
    }

    /* ---------------------------- 陆地 ---------------------------- */
    const ridgeFar = makeRidge(1.6, h * 0.135, landH)
    const ridgeMid = makeRidge(4.8, h * 0.1, landH + 3)
    const ridgeNear = makeRidge(9.3, h * 0.062, landH + 6)

    const land = paint(w, landH, (ctx) => {
      // 远山：几乎融进天色，只留一道薄剪影与稀疏树梢
      fillRidge(ctx, ridgeFar, tone.ridge[0], tone.rim)
      canopy(ctx, (x) => heightAt(ridgeFar, x), treeProfile(2.7, h * 0.021, 0, 0.7), tone.forest[0])

      // 远山与中山之间的一条极薄的雨雾（两端渐隐，不会成为白带）
      const haze1 = ctx.createLinearGradient(0, landH - h * 0.055, 0, landH)
      haze1.addColorStop(0, `rgba(${tone.haze},0)`)
      haze1.addColorStop(0.55, `rgba(${tone.haze},${dark ? 0.26 : 0.24})`)
      haze1.addColorStop(1, `rgba(${tone.haze},${dark ? 0.1 : 0.12})`)
      ctx.fillStyle = haze1
      ctx.fillRect(0, landH - h * 0.055, w, h * 0.055)

      // 中山：林带更密更高
      fillRidge(ctx, ridgeMid, tone.ridge[1], tone.rim)
      canopy(ctx, (x) => heightAt(ridgeMid, x), treeProfile(6.9, h * 0.034, 0.1, 1.05), tone.forest[1])

      // 近山：最暗，树冠也最大
      fillRidge(ctx, ridgeNear, tone.ridge[2], tone.rim)
      canopy(ctx, (x) => heightAt(ridgeNear, x), treeProfile(12.3, h * 0.05, 0.18, 1.4), tone.forest[2])

      // 岸线：把陆地底边压暗并略微渐隐，接水面时不会出现一条硬边
      const foot = ctx.createLinearGradient(0, landH - h * 0.02, 0, landH)
      foot.addColorStop(0, 'rgba(0,0,0,0)')
      foot.addColorStop(1, dark ? 'rgba(6,14,19,0.55)' : 'rgba(126,146,158,0.32)')
      ctx.fillStyle = foot
      ctx.fillRect(0, landH - h * 0.02, w, h * 0.02)
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

      // 云：几团大而软的低压雨云，越靠近地平线越薄
      const clouds: Array<[number, number, number, number, number, string]> = dark
        ? [
            [0.16, -0.05, 0.62, 0.2, 0.72, tone.cloud],
            [0.86, 0.0, 0.5, 0.17, 0.6, tone.cloud],
            [0.46, 0.16, 0.72, 0.12, 0.46, tone.cloud],
            [0.05, 0.32, 0.44, 0.09, 0.3, tone.cloudLow],
            [0.82, 0.3, 0.4, 0.09, 0.28, tone.cloudLow],
            [0.4, 0.46, 0.62, 0.06, 0.22, tone.cloudLow],
          ]
        : [
            [0.12, -0.02, 0.58, 0.19, 0.3, tone.cloud],
            [0.84, 0.03, 0.5, 0.16, 0.26, tone.cloud],
            [0.36, 0.18, 0.62, 0.12, 0.32, tone.cloudLow],
            [0.96, 0.28, 0.36, 0.09, 0.3, tone.cloudLow],
            [0.05, 0.36, 0.36, 0.07, 0.26, tone.cloudLow],
            [0.5, 0.48, 0.5, 0.05, 0.2, tone.cloudLow],
          ]
      for (const [cx, cy, rx, ry, alpha, rgb] of clouds) {
        blob(ctx, w * cx, h * cy, w * rx, h * ry, [
          [0, `rgba(${rgb},${alpha})`],
          [0.45, `rgba(${rgb},${alpha * 0.5})`],
          [0.76, `rgba(${rgb},${alpha * 0.16})`],
          [1, `rgba(${rgb},0)`],
        ])
      }

      // 地平线右侧的一小片天光：不用光柱，只把云底擦亮一点
      blob(ctx, w * 0.7, horizon - h * 0.06, w * 0.34, h * 0.18, [
        [0, dark ? 'rgba(150,190,214,0.2)' : 'rgba(255,255,255,0.5)'],
        [0.4, dark ? 'rgba(130,170,196,0.08)' : 'rgba(255,255,255,0.2)'],
        [1, 'rgba(255,255,255,0)'],
      ])

      // 陆地：平滑缩放，避免整数高度差在岸线处留下一行重复像素
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(land, 0, horizon - landH, w, landH)
      ctx.restore()

      // 水面底色
      const sea = ctx.createLinearGradient(0, horizon, 0, h)
      sea.addColorStop(0, tone.waterTop)
      sea.addColorStop(0.22, tone.waterMid)
      sea.addColorStop(1, tone.waterLow)
      ctx.fillStyle = sea
      ctx.fillRect(0, horizon, w, h - horizon + 1)

      // 两侧压暗 + 暗角：把视线收回中轴，保证正文可读
      const sides = ctx.createLinearGradient(0, 0, w, 0)
      sides.addColorStop(0, dark ? 'rgba(1,3,5,0.36)' : 'rgba(96,117,130,0.18)')
      sides.addColorStop(0.28, 'rgba(0,0,0,0)')
      sides.addColorStop(0.72, 'rgba(0,0,0,0)')
      sides.addColorStop(1, dark ? 'rgba(1,3,5,0.36)' : 'rgba(96,117,130,0.18)')
      ctx.fillStyle = sides
      ctx.fillRect(0, 0, w, h)

      const vg = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.24, w * 0.5, h * 0.52, Math.hypot(w, h) * 0.66)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, `rgba(0,0,0,${dark ? 0.5 : 0.09})`)
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)

      // 极细颗粒，压掉大面积渐变的色带（只烘焙一次）
      const grain = seeded(5)
      ctx.save()
      ctx.globalAlpha = dark ? 0.45 : 0.3
      for (let i = 0; i < Math.round((w * h) / 700); i += 1) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)'
        ctx.fillRect(grain() * w, grain() * h, 1, 1)
      }
      ctx.restore()
    })

    /* ---------------------------- 水面覆盖层 ---------------------------- */
    mirror = paint(w, landH, (c) => {
      c.save()
      c.translate(0, landH)
      c.scale(1, -1)
      c.drawImage(land, 0, 0)
      c.restore()
    })

    water = paint(w, h - horizon, (ctx) => {
      // 倒影顶端（紧贴岸线）压一层水色：镜像会把陆地上的雾带一起翻下来，
      // 不压的话岸线下方会出现一条亮带。真实湖面在掠射角下也偏向水色。
      const shoreLine = ctx.createLinearGradient(0, 0, 0, Math.max(10, (h - horizon) * 0.09))
      shoreLine.addColorStop(0, dark ? 'rgba(13,27,35,0.9)' : 'rgba(142,163,175,0.86)')
      shoreLine.addColorStop(0.55, dark ? 'rgba(13,27,35,0.45)' : 'rgba(142,163,175,0.4)')
      shoreLine.addColorStop(1, 'rgba(13,27,35,0)')
      ctx.fillStyle = shoreLine
      ctx.fillRect(0, 0, w, (h - horizon) * 0.09)

      const wet = ctx.createLinearGradient(0, 0, 0, h - horizon)
      if (dark) {
        wet.addColorStop(0, 'rgba(10,20,26,0.18)')
        wet.addColorStop(0.18, 'rgba(6,13,18,0.5)')
        wet.addColorStop(0.55, 'rgba(3,8,11,0.78)')
        wet.addColorStop(1, 'rgba(2,5,7,0.92)')
      } else {
        wet.addColorStop(0, 'rgba(176,193,203,0.2)')
        wet.addColorStop(0.18, 'rgba(158,175,185,0.46)')
        wet.addColorStop(0.55, 'rgba(140,157,168,0.7)')
        wet.addColorStop(1, 'rgba(128,145,157,0.82)')
      }
      ctx.fillStyle = wet
      ctx.fillRect(0, 0, w, h - horizon)

      // 天光在水面的一片拉长反光（椭圆，没有矩形边）
      blob(ctx, w * 0.7, (h - horizon) * 0.06, w * 0.2, (h - horizon) * 0.42, [
        [0, dark ? 'rgba(188,219,237,0.18)' : 'rgba(255,255,255,0.42)'],
        [0.4, dark ? 'rgba(152,192,218,0.07)' : 'rgba(255,255,255,0.14)'],
        [1, 'rgba(255,255,255,0)'],
      ])

      // 横向水纹
      ctx.save()
      ctx.lineCap = 'round'
      for (let i = 0; i < 160; i += 1) {
        const t = Math.pow(Math.random(), 1.5)
        const y = 3 + t * (h - horizon - 6)
        const length = rand(w * 0.015, w * 0.15) * (0.5 + t)
        const x = rand(-length, w)
        ctx.strokeStyle = dark
          ? `rgba(176,211,230,${(0.012 + Math.random() * 0.045 + t * 0.028).toFixed(3)})`
          : `rgba(255,255,255,${(0.05 + Math.random() * 0.12).toFixed(3)})`
        ctx.lineWidth = rand(0.6, 1.5)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + length * 0.5, y + rand(-1.4, 1.4), x + length, y)
        ctx.stroke()
      }
      ctx.restore()
    })

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
      ctx.fillRect(0, horizon, w, h - horizon)
    })
  }

  return {
    fps: 30,
    setup(width, height) {
      w = width
      h = height
      build()
      drops = []
      ripples = []
      resize(drops, Math.round((values.count ?? 70) * 15 * area(w, h)), spawn)
    },
    configure(next) {
      values = next
      resize(drops, Math.round((values.count ?? 70) * 15 * area(w, h)), spawn)
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

      const wind = (values.wind ?? 25) / 100
      for (const d of drops) {
        const vy = (340 + (values.speed ?? 65) * 9.2) * (0.24 + d.z * 1.06)
        d.y += vy * dt
        d.x += wind * vy * 0.62 * d.drift * dt
        if (d.y > h + 40 || d.x < -w * 0.45 || d.x > w * 1.45) Object.assign(d, spawn(true))
      }

      rippleClock += dt * ((values.count ?? 70) / 100)
      while (rippleClock > 0.04) {
        rippleClock -= 0.04
        if (ripples.length < 34) {
          const depth = Math.pow(Math.random(), 0.6)
          ripples.push({
            x: rand(-20, w + 20),
            y: horizon + 8 + depth * (h - horizon - 12),
            age: 0,
            life: rand(0.5, 0.95),
            scale: rand(0.45, 1.3),
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
      const bands = 5
      const bandH = mirror.height / bands
      ctx.save()
      ctx.globalAlpha = dark ? 0.46 : 0.3
      for (let i = 0; i < bands; i += 1) {
        const drift = Math.sin(time * 0.5 + i * 0.85) * (1 + i * 0.9) + Math.sin(time * 0.21 + i * 2.2) * 1.3
        ctx.drawImage(mirror, 0, i * bandH, mirror.width, bandH, drift, horizon + i * bandH, w, bandH + 1)
      }
      ctx.restore()

      /* 水面覆盖层 */
      ctx.drawImage(water, 0, horizon, w, h - horizon)

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

      /* 雨：三层，越近越长越淡；近层先铺一道柔光，雨丝才有厚度 */
      const wind = (values.wind ?? 25) / 100
      const slant = wind * 1.1
      const speed = values.speed ?? 65
      ctx.save()
      ctx.lineCap = 'round'
      for (let layer = 0; layer < 3; layer += 1) {
        const lineWidth = [0.5, 0.7, 1.05][layer]
        const color = dark
          ? ['rgba(150,186,210,0.09)', 'rgba(178,210,232,0.15)', 'rgba(226,242,255,0.24)'][layer]
          : ['rgba(58,82,99,0.11)', 'rgba(46,70,88,0.17)', 'rgba(32,54,72,0.26)'][layer]
        if (layer === 2) {
          ctx.strokeStyle = dark ? 'rgba(212,238,252,0.06)' : 'rgba(255,255,255,0.14)'
          ctx.lineWidth = lineWidth * 2.6
          ctx.beginPath()
          for (const d of drops) {
            if (Math.min(2, Math.floor(d.z * 3)) !== layer) continue
            const length = (14 + d.z * (22 + speed * 0.5)) * d.len
            ctx.moveTo(d.x, d.y)
            ctx.lineTo(d.x + slant * length, d.y + length)
          }
          ctx.stroke()
        }
        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth
        ctx.beginPath()
        for (const d of drops) {
          if (Math.min(2, Math.floor(d.z * 3)) !== layer) continue
          const length = (10 + d.z * (16 + speed * 0.44)) * d.len
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x + slant * length, d.y + length)
        }
        ctx.stroke()
      }
      ctx.restore()

      /* 涟漪：外圈 + 内圈 + 落下瞬间的一根小水柱 */
      ctx.save()
      ctx.lineCap = 'round'
      for (const r of ripples) {
        const t = r.age / r.life
        const radius = (5 + t * 22) * r.scale * (0.55 + r.depth * 1.1)
        ctx.strokeStyle = dark
          ? `rgba(190,222,240,${((1 - t) * (0.14 + r.depth * 0.18)).toFixed(3)})`
          : `rgba(255,255,255,${((1 - t) * (0.24 + r.depth * 0.28)).toFixed(3)})`
        ctx.lineWidth = 0.85
        ctx.beginPath()
        ctx.ellipse(r.x, r.y, radius, radius * (0.13 + r.depth * 0.1), 0, 0, TAU)
        ctx.stroke()
        if (t < 0.56) {
          ctx.globalAlpha = (1 - t) * 0.42
          ctx.beginPath()
          ctx.ellipse(r.x, r.y, radius * 0.46, radius * (0.07 + r.depth * 0.05), 0, 0, TAU)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        if (t < 0.12) {
          ctx.strokeStyle = dark ? 'rgba(235,248,255,0.36)' : 'rgba(255,255,255,0.6)'
          const hh = (2 + r.depth * 4) * (1 - t / 0.12)
          ctx.beginPath()
          ctx.moveTo(r.x, r.y - hh)
          ctx.lineTo(r.x, r.y)
          ctx.stroke()
        }
      }
      ctx.restore()

      /* 雷光：只提亮云层与水面 */
      if (flash > 0.004) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = Math.min(1, flash) * (dark ? 0.72 : 0.36)
        ctx.drawImage(flashTex, 0, 0, w, h)
        ctx.restore()
      }
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
