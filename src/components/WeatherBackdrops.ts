import type { Renderer } from './AnimatedBackdrop'

/**
 * 自然气象与山林唯美场景：雪花（霁雪寒松 / 极光雪夜）、暴雨（烟雨山湖 / 月夜听雨）、竹林（晨雾翠竹 / 幽篁流萤）。
 *
 * 视觉与工程准则：
 *   - 全部升级至丝滑 60fps，远景层、云雾层、松竹芦苇与粒子精灵全部预烘焙至离屏 canvas；
 *   - 逐帧仅做轻量级矩阵贴图与柔和 alpha 混合，零渐变创建、零 GC 抖动；
 *   - 严格守护中央阅读净空列（约 820px），两侧展开纵深景框，兼具电影级意境与舒适阅读体验。
 */

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / Math.max(1e-5, e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const rand = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)
const areaFactor = (w: number, h: number) => clamp((w * h) / (1440 * 900), 0.5, 2.2)

function surface(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  return canvas
}

/** 缩小再双线性高质放大得到光学虚化：兼容所有浏览器与无头环境 */
function soften(src: HTMLCanvasElement, factor: number) {
  const small = surface(src.width / factor, src.height / factor, (ctx) => {
    ctx.drawImage(src, 0, 0, src.width / factor, src.height / factor)
  })
  return surface(src.width, src.height, (ctx) => {
    const prev = ctx.imageSmoothingQuality
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(small, 0, 0, src.width, src.height)
    ctx.imageSmoothingQuality = prev
  })
}

function resize<T>(list: T[], n: number, make: () => T) {
  if (list.length > n) list.length = n
  while (list.length < n) list.push(make())
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, k: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.62)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(0,0,0,${k})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** 丁达尔 / 极光羽化光束贴图：横纵向双向平滑渐隐，无生硬几何切边 */
function makeRaySprite(r: number, g: number, b: number, peak = 0.62) {
  return surface(128, 256, (ctx) => {
    const gx = ctx.createLinearGradient(0, 0, 128, 0)
    gx.addColorStop(0, `rgba(${r},${g},${b},0)`)
    gx.addColorStop(0.28, `rgba(${r},${g},${b},${(peak * 0.44).toFixed(3)})`)
    gx.addColorStop(0.5, `rgba(${r},${g},${b},${peak.toFixed(3)})`)
    gx.addColorStop(0.72, `rgba(${r},${g},${b},${(peak * 0.44).toFixed(3)})`)
    gx.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gx
    ctx.fillRect(0, 0, 128, 256)
    ctx.globalCompositeOperation = 'destination-in'
    const gy = ctx.createLinearGradient(0, 0, 0, 256)
    gy.addColorStop(0, 'rgba(0,0,0,0)')
    gy.addColorStop(0.16, 'rgba(0,0,0,0.88)')
    gy.addColorStop(0.62, 'rgba(0,0,0,0.48)')
    gy.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gy
    ctx.fillRect(0, 0, 128, 256)
  })
}

/** 柔和圆形辉光精灵（萤火、浮尘、暖窗微光共用） */
function makeOrbSprite(r: number, g: number, b: number, size = 48) {
  return surface(size, size, (ctx) => {
    const c = size / 2
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
    grad.addColorStop(0, 'rgba(255,255,255,0.96)')
    grad.addColorStop(0.2, `rgba(${r},${g},${b},0.78)`)
    grad.addColorStop(0.52, `rgba(${r},${g},${b},0.24)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  })
}

/** 无缝平铺薄雾带：X 方向周期环绕绘制、Y 方向双向渐隐，平铺拼接零接缝 */
function mistBand(rgb: string, h = 256) {
  return surface(512, h, (ctx) => {
    const r = rng(91)
    for (let i = 0; i < 56; i += 1) {
      const x = r() * 512, y = h * (0.28 + r() * 0.54), rad = 36 + r() * 108
      const alpha = (0.048 + r() * 0.072).toFixed(3)
      for (const shift of [-512, 0, 512]) {
        const cx = x + shift
        if (cx + rad < 0 || cx - rad > 512) continue
        const g = ctx.createRadialGradient(cx, y, 0, cx, y, rad)
        g.addColorStop(0, `rgba(${rgb},${alpha})`)
        g.addColorStop(1, `rgba(${rgb},0)`)
        ctx.fillStyle = g
        ctx.fillRect(cx - rad, y - rad, rad * 2, rad * 2)
      }
    }
    ctx.globalCompositeOperation = 'destination-in'
    const fade = ctx.createLinearGradient(0, 0, 0, h)
    fade.addColorStop(0, 'rgba(0,0,0,0)')
    fade.addColorStop(0.45, 'rgba(0,0,0,1)')
    fade.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, 512, h)
  })
}

function drawMist(
  ctx: CanvasRenderingContext2D, band: HTMLCanvasElement | null,
  w: number, y: number, h: number, offset: number, alpha: number,
) {
  if (!band || alpha <= 0.01) return
  const tile = w * 1.4, shift = ((offset % tile) + tile) % tile
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(band, -shift, y, tile, h)
  ctx.drawImage(band, tile - shift, y, tile, h)
  ctx.restore()
}

/* ===================================================================== *
 *  一、雪花（霁雪远山寒松 / 极光蓝调雪夜，60fps）
 * ===================================================================== */

export function createSnow(initialDark: boolean): Renderer {
  interface Flake {
    x: number
    y: number
    z: number
    a: number
    spin: number
    ph: number
    freq: number
    twinklePh: number
    kind: number
  }

  let w = 0, h = 0, dark = initialDark, time = 0
  let bg: HTMLCanvasElement | null = null
  let mist: HTMLCanvasElement | null = null
  let auroraCurtain: HTMLCanvasElement | null = null
  let auroraTeal: HTMLCanvasElement | null = null
  let auroraViolet: HTMLCanvasElement | null = null
  let sprites: HTMLCanvasElement[] = []
  let flakes: Flake[] = []
  let snowCountParam = 55, target = 95, speed = 35, wind = 12, size = 45, swirl = 45

  const make = (top = false): Flake => {
    const z = Math.pow(Math.random(), 1.25)
    const kind = z < 0.34 ? 0 : z < 0.68 ? (Math.random() < 0.5 ? 1 : 2) : z < 0.88 ? 3 : 4
    return {
      x: Math.random() * (w + 180) - 90,
      y: top ? -16 - Math.random() * h * 0.32 : Math.random() * h,
      z,
      a: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 0.85,
      ph: Math.random() * TAU,
      freq: 0.42 + Math.random() * 0.72,
      twinklePh: Math.random() * TAU,
      kind,
    }
  }

  /** 绘制精细六角分形冰晶精灵（浅色模式下附带清冷冰蓝折射底晕，令雪晶在晴空下依旧清晰晶莹） */
  const makeCrystalSprite = (detailed: boolean) => surface(72, 72, (ctx) => {
    const c = 36
    const halo = ctx.createRadialGradient(c, c, 0, c, c, 31)
    if (dark) {
      halo.addColorStop(0, 'rgba(255,255,255,0.46)')
      halo.addColorStop(0.5, 'rgba(214,236,255,0.14)')
      halo.addColorStop(1, 'rgba(214,236,255,0)')
    } else {
      halo.addColorStop(0, 'rgba(148,180,214,0.34)')
      halo.addColorStop(0.58, 'rgba(164,194,224,0.14)')
      halo.addColorStop(1, 'rgba(164,194,224,0)')
    }
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, 72, 72)

    ctx.lineCap = 'round'
    for (let k = 0; k < 6; k += 1) {
      const a = (k * TAU) / 6
      const dx = Math.cos(a), dy = Math.sin(a)
      if (!dark) {
        ctx.strokeStyle = 'rgba(128, 162, 198, 0.42)'
        ctx.lineWidth = 3.2
        ctx.beginPath()
        ctx.moveTo(c, c)
        ctx.lineTo(c + dx * 27, c + dy * 27)
        ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.96)'
      ctx.lineWidth = 1.9
      ctx.beginPath()
      ctx.moveTo(c, c)
      ctx.lineTo(c + dx * 27, c + dy * 27)
      ctx.stroke()

      const forks = detailed ? [9, 16, 22] : [11, 19]
      for (const d of forks) {
        const branchLen = detailed ? 9 - d * 0.2 : 7.5 - d * 0.16
        ctx.lineWidth = d > 16 ? 1.15 : 1.45
        for (const s of [-0.62, 0.62]) {
          ctx.beginPath()
          ctx.moveTo(c + dx * d, c + dy * d)
          ctx.lineTo(c + dx * d + Math.cos(a + s) * branchLen, c + dy * d + Math.sin(a + s) * branchLen)
          ctx.stroke()
        }
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.98)'
    ctx.beginPath()
    ctx.arc(c, c, 3.2, 0, TAU)
    ctx.fill()
  })

  /** 绘制蓬松雪绒团精灵 */
  const makeSnowFluff = () => surface(64, 64, (ctx) => {
    const r = rng(47)
    if (!dark) {
      const shade = ctx.createRadialGradient(32, 33, 2, 32, 33, 24)
      shade.addColorStop(0, 'rgba(146,178,210,0.28)')
      shade.addColorStop(1, 'rgba(146,178,210,0)')
      ctx.fillStyle = shade
      ctx.fillRect(0, 0, 64, 64)
    }
    for (let i = 0; i < 12; i += 1) {
      const a = r() * TAU, dist = r() * 8.5
      const cx = 32 + Math.cos(a) * dist, cy = 32 + Math.sin(a) * dist
      const rad = 11 + r() * 9
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, dark ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.86)')
      g.addColorStop(0.55, dark ? 'rgba(236,246,255,0.22)' : 'rgba(244,250,255,0.42)')
      g.addColorStop(1, 'rgba(240,248,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  })

  /** 预烘焙蜿蜒柔和的北极光光带幕布（无硬边、底部翠青发光向上紫罗兰羽化） */
  const makeAuroraCurtain = () => surface(512, 256, (ctx) => {
    for (let i = 0; i < 64; i += 1) {
      const u = i / 63
      const cx = 36 + u * 440
      const baseY = 175 + Math.sin(u * 6.2) * 28 + Math.sin(u * 13.5 + 1.1) * 11
      const colH = 95 + Math.sin(u * 9.4 + 0.5) * 35
      const colW = 18 + Math.sin(u * 17.3) * 6
      const intensity = Math.sin(Math.PI * u) * (0.55 + 0.45 * Math.sin(u * 21.7 + 0.8))
      const g = ctx.createLinearGradient(0, baseY + 18, 0, baseY - colH)
      g.addColorStop(0, 'rgba(64, 236, 190, 0)')
      g.addColorStop(0.22, `rgba(74, 240, 196, ${(0.28 * intensity).toFixed(3)})`)
      g.addColorStop(0.55, `rgba(92, 196, 238, ${(0.16 * intensity).toFixed(3)})`)
      g.addColorStop(0.85, `rgba(148, 146, 250, ${(0.07 * intensity).toFixed(3)})`)
      g.addColorStop(1, 'rgba(148, 146, 250, 0)')
      ctx.fillStyle = g
      ctx.fillRect(cx - colW, baseY - colH, colW * 2, colH + 20)
    }
  })

  /** 绘制自然弧垂、枝头覆雪的寒松林（多层柔弧垂枝取代生硬三角堆叠） */
  const drawSnowPines = (
    ctx: CanvasRenderingContext2D,
    ridgeFn: (x: number) => number,
    seedNum: number,
    count: number,
    scaleH: number,
    treeFill: string,
    snowCapFill: string,
  ) => {
    const r = rng(seedNum)
    for (let i = 0; i < count; i += 1) {
      const sideBias = r() < 0.5 ? r() * 0.33 : 1 - r() * 0.33
      const x = w * (r() < 0.82 ? sideBias : r())
      const baseY = ridgeFn(x) + scaleH * 0.24
      const th = scaleH * (0.64 + r() * 0.78)
      const tw = th * (0.25 + r() * 0.08)
      const tiers = 5
      for (let tier = 0; tier < tiers; tier += 1) {
        const frac = tier / (tiers - 1)
        const ty = baseY - th * (0.14 + frac * 0.78)
        const tierW = tw * (1.06 - frac * 0.72) * (0.9 + r() * 0.2)
        const tierH = th * (0.34 - frac * 0.08)
        ctx.fillStyle = treeFill
        ctx.beginPath()
        ctx.moveTo(x, ty - tierH)
        ctx.quadraticCurveTo(x + tierW * 0.45, ty - tierH * 0.25, x + tierW, ty + tierH * 0.12)
        ctx.quadraticCurveTo(x, ty - tierH * 0.08, x - tierW, ty + tierH * 0.12)
        ctx.quadraticCurveTo(x - tierW * 0.45, ty - tierH * 0.25, x, ty - tierH)
        ctx.closePath()
        ctx.fill()

        // 上层枝肩积雪柔弧
        ctx.fillStyle = snowCapFill
        ctx.beginPath()
        ctx.moveTo(x, ty - tierH)
        ctx.quadraticCurveTo(x + tierW * 0.42, ty - tierH * 0.36, x + tierW * 0.78, ty - tierH * 0.02)
        ctx.quadraticCurveTo(x, ty - tierH * 0.38, x - tierW * 0.76, ty - tierH * 0.02)
        ctx.quadraticCurveTo(x - tierW * 0.42, ty - tierH * 0.36, x, ty - tierH)
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  const buildSnowRidge = (seedNum: number, baseRatio: number, ampRatio: number, roughness: number) => {
    const r = rng(seedNum)
    const n = 22
    const pts: number[] = []
    for (let i = 0; i <= n; i += 1) {
      const u = i / n
      const flankLift = Math.pow(Math.abs(u - 0.5) * 2, 1.35) * ampRatio * 0.85
      pts.push(baseRatio - flankLift - (r() - 0.3) * roughness)
    }
    for (let pass = 0; pass < 2; pass += 1) {
      const copy = [...pts]
      for (let i = 1; i < n; i += 1) {
        pts[i] = copy[i - 1] * 0.24 + copy[i] * 0.52 + copy[i + 1] * 0.24
      }
    }
    return (x: number) => {
      const f = clamp(x / Math.max(1, w), 0, 1) * n
      const i0 = Math.min(n - 1, Math.floor(f))
      const t = smoothstep(0, 1, f - i0)
      return h * (pts[i0] + (pts[i0 + 1] - pts[i0]) * t)
    }
  }

  const build = () => {
    const crystalA = makeCrystalSprite(true)
    const crystalB = makeCrystalSprite(false)
    const fluff = makeSnowFluff()
    const puff = makeOrbSprite(dark ? 240 : 196, dark ? 248 : 218, 255, 64)
    sprites = [
      soften(puff, 3),
      crystalA,
      crystalB,
      fluff,
      soften(fluff, 3.2),
    ]

    auroraCurtain = soften(makeAuroraCurtain(), 2.2)
    auroraTeal = makeRaySprite(82, 238, 198, 0.56)
    auroraViolet = makeRaySprite(142, 172, 255, 0.46)
    mist = mistBand(dark ? '194,218,244' : '255,255,255')

    const ridgeFar = buildSnowRidge(173, 0.72, 0.11, 0.065)
    const ridgeMid = buildSnowRidge(389, 0.8, 0.095, 0.055)
    const ridgeNear = buildSnowRidge(613, 0.885, 0.075, 0.04)
    const r = rng(2027)

    bg = surface(w, h, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h)
      if (dark) {
        sky.addColorStop(0, '#040a15')
        sky.addColorStop(0.35, '#0b192c')
        sky.addColorStop(0.7, '#152c46')
        sky.addColorStop(1, '#223e5a')
      } else {
        sky.addColorStop(0, '#cfdff0')
        sky.addColorStop(0.38, '#e3eef8')
        sky.addColorStop(0.74, '#f3f8fc')
        sky.addColorStop(1, '#e1ecf6')
      }
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      if (dark) {
        for (let i = 0; i < 88; i += 1) {
          const sx = r() * w, sy = r() * h * 0.56
          ctx.fillStyle = `rgba(226, 240, 255, ${(0.1 + r() * 0.44).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(sx, sy, 0.4 + r() * 1.0, 0, TAU)
          ctx.fill()
        }

        // 清冽冬月与冰晶柔晕
        const mx = w * 0.78, my = h * 0.16
        const mr = Math.max(12, Math.min(27, Math.min(w, h) * 0.025))
        const moonHalo = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 9.5)
        moonHalo.addColorStop(0, 'rgba(224, 242, 255, 0.38)')
        moonHalo.addColorStop(0.32, 'rgba(164, 206, 248, 0.13)')
        moonHalo.addColorStop(1, 'rgba(164, 206, 248, 0)')
        ctx.fillStyle = moonHalo
        ctx.fillRect(0, 0, w, h)

        ctx.fillStyle = 'rgba(246, 251, 255, 0.96)'
        ctx.beginPath()
        ctx.arc(mx, my, mr, 0, TAU)
        ctx.fill()
      } else {
        const dawn = ctx.createRadialGradient(w * 0.76, h * 0.24, 0, w * 0.76, h * 0.24, Math.max(w, h) * 0.68)
        dawn.addColorStop(0, 'rgba(255, 236, 224, 0.76)')
        dawn.addColorStop(0.45, 'rgba(255, 226, 232, 0.3)')
        dawn.addColorStop(1, 'rgba(255, 226, 232, 0)')
        ctx.fillStyle = dawn
        ctx.fillRect(0, 0, w, h)
      }

      const drawRidgeLayer = (
        fn: (x: number) => number,
        topColor: string,
        bottomColor: string,
      ) => {
        const grad = ctx.createLinearGradient(0, h * 0.56, 0, h)
        grad.addColorStop(0, topColor)
        grad.addColorStop(1, bottomColor)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w + 16; x += 16) ctx.lineTo(x, fn(x))
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fill()
      }

      drawRidgeLayer(
        ridgeFar,
        dark ? 'rgba(62, 96, 134, 0.55)' : 'rgba(194, 214, 234, 0.76)',
        dark ? 'rgba(28, 50, 78, 0.75)' : 'rgba(174, 198, 222, 0.58)',
      )
      drawRidgeLayer(
        ridgeMid,
        dark ? 'rgba(46, 76, 110, 0.78)' : 'rgba(214, 230, 244, 0.88)',
        dark ? 'rgba(20, 38, 62, 0.9)' : 'rgba(190, 212, 232, 0.8)',
      )
      drawSnowPines(
        ctx,
        ridgeMid,
        512,
        24,
        h * 0.045,
        dark ? 'rgba(15, 32, 52, 0.82)' : 'rgba(122, 150, 176, 0.46)',
        dark ? 'rgba(186, 216, 244, 0.16)' : 'rgba(255, 255, 255, 0.56)',
      )
      drawRidgeLayer(
        ridgeNear,
        dark ? 'rgba(32, 56, 86, 0.92)' : 'rgba(238, 246, 253, 0.96)',
        dark ? 'rgba(13, 25, 44, 0.98)' : 'rgba(220, 234, 247, 0.97)',
      )
      drawSnowPines(
        ctx,
        ridgeNear,
        887,
        18,
        h * 0.062,
        dark ? 'rgba(10, 22, 38, 0.92)' : 'rgba(104, 134, 162, 0.54)',
        dark ? 'rgba(198, 226, 250, 0.2)' : 'rgba(255, 255, 255, 0.65)',
      )

      if (dark) {
        const cx = w * 0.84, cy = ridgeNear(w * 0.84) + h * 0.014
        const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.055)
        warm.addColorStop(0, 'rgba(255, 224, 166, 0.9)')
        warm.addColorStop(0.22, 'rgba(255, 188, 110, 0.34)')
        warm.addColorStop(1, 'rgba(255, 170, 90, 0)')
        ctx.fillStyle = warm
        ctx.fillRect(cx - h * 0.06, cy - h * 0.06, h * 0.12, h * 0.12)
      }

      vignette(ctx, w, h, dark ? 0.34 : 0.07)
    })
  }

  return {
    fps: 60,
    setup(width, height) {
      w = width
      h = height
      build()
      flakes = []
      target = Math.round((snowCountParam / 100) * 235 * areaFactor(w, h))
      resize(flakes, target, () => make())
    },
    setTone(next) {
      dark = next
      build()
    },
    configure(v) {
      snowCountParam = v.count ?? 55
      speed = v.speed ?? 35
      wind = v.wind ?? 12
      size = v.size ?? 45
      swirl = v.swirl ?? 45
      target = Math.round((snowCountParam / 100) * 235 * areaFactor(w, h))
      resize(flakes, target, () => make())
    },
    step(dt) {
      time += dt
      const gust = 0.8 + 0.34 * Math.sin(time * 0.35) + 0.18 * Math.sin(time * 0.92 + 1.4)
      const drift = (wind / 100) * 108 * gust
      const fall = 16 + (speed / 100) * 74
      for (const f of flakes) {
        f.ph += dt * f.freq * (0.72 + f.z * 0.9)
        f.twinklePh += dt * 2.1
        f.a += f.spin * dt
        f.y += fall * (0.34 + f.z * 0.94) * dt
        f.x += (drift * (0.38 + f.z * 0.72) + Math.sin(f.ph) * swirl * 0.56 * (0.4 + f.z)) * dt
        if (f.y > h + 44 || f.x < -100 || f.x > w + 100) Object.assign(f, make(true))
      }
    },
    draw(ctx) {
      if (bg) ctx.drawImage(bg, 0, 0, w, h)

      // 深色雪夜：蜿蜒流动的北极光幕布与极光光束（高悬于夜空天际，不压正文标题）
      if (dark && auroraCurtain && auroraTeal && auroraViolet) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const waveShift = Math.sin(time * 0.14) * w * 0.04
        ctx.globalAlpha = 0.52 + 0.12 * Math.sin(time * 0.28)
        ctx.drawImage(auroraCurtain, -w * 0.05 + waveShift, -h * 0.06, w * 0.68, h * 0.36)
        for (let i = 0; i < 4; i += 1) {
          const sp = i % 2 === 0 ? auroraTeal : auroraViolet
          const phase = time * 0.16 + i * 1.25
          const ax = w * (0.1 + i * 0.14) + Math.sin(phase) * w * 0.04
          const aw = w * (0.13 + (i % 2) * 0.05)
          ctx.save()
          ctx.translate(ax, -h * 0.06)
          ctx.rotate(-0.2 + Math.sin(phase * 0.7) * 0.05)
          ctx.globalAlpha = 0.16 + 0.08 * Math.sin(phase * 1.3)
          ctx.drawImage(sp, -aw / 2, 0, aw, h * 0.38)
          ctx.restore()
        }
        ctx.restore()
      }

      drawMist(ctx, mist, w, h * 0.64, h * 0.28, time * 11, dark ? 0.22 : 0.44)

      const scale = 0.44 + (size / 100) * 1.04
      const half = Math.max(1, w * 0.5)
      ctx.save()
      for (const f of flakes) {
        const sp = sprites[f.kind]
        if (!sp) continue
        const s = (4.5 + f.z * 20) * scale
        const twinkle = f.kind === 1 || f.kind === 2 ? 0.78 + 0.22 * Math.sin(f.twinklePh) : 1
        const centerQuiet =
          0.34 + 0.66 * smoothstep(Math.min(0.38, 330 / half), Math.min(0.82, 580 / half), Math.abs(f.x - half) / half)
        ctx.save()
        ctx.translate(f.x, f.y)
        ctx.rotate(f.a)
        ctx.globalAlpha = (dark ? 0.28 + f.z * 0.6 : 0.42 + f.z * 0.52) * twinkle * (f.z > 0.52 ? centerQuiet : 0.85)
        ctx.drawImage(sp, -s / 2, -s / 2, s, s)
        ctx.restore()
      }
      ctx.restore()
    },
  }
}

/* ===================================================================== *
 *  二、暴雨（新海诚风烟雨山湖 / 月夜听雨，60fps 光学水珠）
 * ===================================================================== */

export function createRain(initialDark: boolean): Renderer {
  interface Drop {
    x: number
    y: number
    z: number
    w: number
    h: number
    swayAmp: number
    swayFreq: number
    phase: number
    alpha: number
  }
  interface Ripple {
    x: number
    y: number
    t: number
    life: number
    maxR: number
    strength: number
  }

  let w = 0, h = 0, dark = initialDark, time = 0
  let bg: HTMLCanvasElement | null = null
  let fgLeft: HTMLCanvasElement | null = null
  let fgRight: HTMLCanvasElement | null = null
  let mistFar: HTMLCanvasElement | null = null
  let mistNear: HTMLCanvasElement | null = null
  let dropSoft: HTMLCanvasElement | null = null
  let dropCrisp: HTMLCanvasElement | null = null
  let dropBokeh: HTMLCanvasElement | null = null
  let shimmerSprite: HTMLCanvasElement | null = null
  let cabinGlowSprite: HTMLCanvasElement | null = null
  let drops: Drop[] = []
  const ripples: Ripple[] = []

  let countParam = 70, speed = 65, wind = 25, mistAmt = 0.4, bolt = 0
  let target = 165
  let flash = 0, nextBolt = 6, boltX = 0.62, cabinX = 0.79, lakeTopY = 0

  const r = rng(1987)

  const makeDropSprite = (
    bodyAlpha: number,
    rimAlpha: number,
    headGlow: number,
  ): HTMLCanvasElement =>
    surface(40, 96, (ctx) => {
      const cx = 20
      const traceDrop = (scaleX: number, topY: number, bottomY: number) => {
        const bellyY = topY + (bottomY - topY) * 0.72
        const halfW = 13 * scaleX
        ctx.beginPath()
        ctx.moveTo(cx, topY)
        ctx.bezierCurveTo(
          cx + halfW * 0.24, topY + (bellyY - topY) * 0.44,
          cx + halfW, bellyY - (bottomY - topY) * 0.16,
          cx + halfW, bellyY,
        )
        ctx.bezierCurveTo(
          cx + halfW, bottomY - (bottomY - bellyY) * 0.14,
          cx + halfW * 0.56, bottomY,
          cx, bottomY,
        )
        ctx.bezierCurveTo(
          cx - halfW * 0.56, bottomY,
          cx - halfW, bottomY - (bottomY - bellyY) * 0.14,
          cx - halfW, bellyY,
        )
        ctx.bezierCurveTo(
          cx - halfW, bellyY - (bottomY - topY) * 0.16,
          cx - halfW * 0.24, topY + (bellyY - topY) * 0.44,
          cx, topY,
        )
        ctx.closePath()
      }

      ctx.save()
      traceDrop(1, 6, 86)
      ctx.clip()

      const body = ctx.createLinearGradient(0, 6, 0, 88)
      if (dark) {
        body.addColorStop(0, 'rgba(182, 212, 244, 0)')
        body.addColorStop(0.34, `rgba(186, 216, 248, ${(bodyAlpha * 0.34).toFixed(3)})`)
        body.addColorStop(0.76, `rgba(214, 234, 255, ${bodyAlpha.toFixed(3)})`)
        body.addColorStop(1, `rgba(244, 250, 255, ${(bodyAlpha * 1.25).toFixed(3)})`)
      } else {
        body.addColorStop(0, 'rgba(116, 146, 176, 0)')
        body.addColorStop(0.34, `rgba(128, 158, 188, ${(bodyAlpha * 0.32).toFixed(3)})`)
        body.addColorStop(0.76, `rgba(156, 184, 212, ${bodyAlpha.toFixed(3)})`)
        body.addColorStop(1, `rgba(238, 246, 255, ${(bodyAlpha * 1.3).toFixed(3)})`)
      }
      ctx.fillStyle = body
      ctx.fillRect(0, 0, 40, 96)

      const spec = ctx.createLinearGradient(cx - 11, 20, cx - 2, 82)
      spec.addColorStop(0, 'rgba(255,255,255,0)')
      spec.addColorStop(0.45, `rgba(255,255,255,${(rimAlpha * 0.72).toFixed(3)})`)
      spec.addColorStop(0.86, `rgba(255,255,255,${rimAlpha.toFixed(3)})`)
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spec
      ctx.beginPath()
      ctx.ellipse(cx - 5.2, 60, 2.5, 22, -0.06, 0, TAU)
      ctx.fill()

      const caustic = ctx.createRadialGradient(cx + 1.5, 79, 0, cx + 1.5, 79, 10.5)
      caustic.addColorStop(0, `rgba(255,255,255,${headGlow.toFixed(3)})`)
      caustic.addColorStop(0.45, `rgba(226,242,255,${(headGlow * 0.45).toFixed(3)})`)
      caustic.addColorStop(1, 'rgba(226,242,255,0)')
      ctx.fillStyle = caustic
      ctx.fillRect(cx - 12, 66, 26, 24)
      ctx.restore()
    })

  const makeRainBokehSprite = (): HTMLCanvasElement =>
    surface(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
      if (dark) {
        g.addColorStop(0, 'rgba(186, 216, 248, 0.2)')
        g.addColorStop(0.68, 'rgba(196, 224, 252, 0.14)')
        g.addColorStop(0.88, 'rgba(232, 244, 255, 0.28)')
        g.addColorStop(1, 'rgba(232, 244, 255, 0)')
      } else {
        g.addColorStop(0, 'rgba(255, 255, 255, 0.24)')
        g.addColorStop(0.7, 'rgba(230, 241, 252, 0.16)')
        g.addColorStop(0.9, 'rgba(255, 255, 255, 0.34)')
        g.addColorStop(1, 'rgba(255, 255, 255, 0)')
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 64)
    })

  const makeShimmerSprite = (): HTMLCanvasElement =>
    surface(96, 20, (ctx) => {
      const g = ctx.createRadialGradient(48, 10, 0, 48, 10, 48)
      if (dark) {
        g.addColorStop(0, 'rgba(228, 242, 255, 0.58)')
        g.addColorStop(0.45, 'rgba(168, 202, 238, 0.22)')
        g.addColorStop(1, 'rgba(168, 202, 238, 0)')
      } else {
        g.addColorStop(0, 'rgba(255, 255, 255, 0.75)')
        g.addColorStop(0.45, 'rgba(232, 242, 252, 0.28)')
        g.addColorStop(1, 'rgba(232, 242, 252, 0)')
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 96, 20)
    })

  const spawnDrop = (initial = false): Drop => {
    const z = Math.pow(r(), 1.55)
    const isBokeh = z > 0.87
    const widthPx = isBokeh ? 14 + rand(r, 0, 12) : 2.6 + z * 5.2
    const aspect = isBokeh ? 1.18 + rand(r, 0, 0.24) : 1.55 + rand(r, 0, 1.35)
    return {
      x: rand(r, -w * 0.28, w * 1.28),
      y: initial ? rand(r, -h * 0.35, h) : rand(r, -h * 0.45, -24),
      z,
      w: widthPx,
      h: widthPx * aspect,
      swayAmp: rand(r, 0.008, 0.028) * (0.5 + z),
      swayFreq: rand(r, 0.7, 1.8),
      phase: rand(r, 0, TAU),
      alpha: isBokeh ? (dark ? 0.14 : 0.12) : dark ? 0.18 + z * 0.42 : 0.16 + z * 0.36,
    }
  }

  const spawnRipple = (x: number) => {
    if (ripples.length >= 28) return
    const bandTop = lakeTopY + h * 0.008
    const y = rand(r, bandTop, h * 0.992)
    const depthK = clamp((y - bandTop) / Math.max(1, h - bandTop), 0, 1)
    ripples.push({
      x,
      y,
      t: 0,
      life: rand(r, 1.15, 2.05),
      maxR: (12 + rand(r, 0, 18)) * (0.45 + depthK * 0.95),
      strength: 0.32 + depthK * 0.5,
    })
  }

  const buildRidge = (seedNum: number, baseY: number, amp: number, detail: number): number[] => {
    const rr = rng(seedNum)
    const n = 24
    const pts: number[] = []
    for (let i = 0; i <= n; i += 1) {
      const t = i / n
      const valley = Math.cos((t - 0.5) * Math.PI * 1.85)
      pts.push(baseY - Math.max(0, -valley) * amp * 0.85 - rr() * detail)
    }
    for (let pass = 0; pass < 2; pass += 1) {
      const copy = [...pts]
      for (let i = 1; i < n; i += 1) {
        pts[i] = copy[i - 1] * 0.25 + copy[i] * 0.5 + copy[i + 1] * 0.25
      }
    }
    return pts
  }

  const fillRidge = (ctx: CanvasRenderingContext2D, pts: number[], fill: string | CanvasGradient) => {
    const n = pts.length - 1
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(0, pts[0])
    for (let i = 0; i < n; i += 1) {
      const x0 = (i / n) * w
      const x1 = ((i + 1) / n) * w
      const mx = (x0 + x1) * 0.5
      const my = (pts[i] + pts[i + 1]) * 0.5
      ctx.quadraticCurveTo(x0, pts[i], mx, my)
    }
    ctx.lineTo(w, pts[n])
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }

  /** 预烘焙单侧前景柔焦水岸芦苇与芦花穗（自然渐细收尖，绝无钝头硬杆） */
  const buildReedSprite = (rw: number, rh: number, seedNum: number, flipX: boolean) => {
    const rr = rng(seedNum)
    const raw = surface(rw, rh, (ctx) => {
      ctx.save()
      if (flipX) {
        ctx.translate(rw, 0)
        ctx.scale(-1, 1)
      }
      const bladeFill = dark ? 'rgba(8, 15, 26, 0.72)' : 'rgba(72, 92, 110, 0.34)'
      const plumeFill = dark ? 'rgba(148, 174, 204, 0.24)' : 'rgba(236, 244, 250, 0.45)'
      for (let i = 0; i < 15; i += 1) {
        const bx = rr() * rw * 0.68
        const lean = rand(rr, 18, 72)
        const bladeH = rand(rr, rh * 0.34, rh * 0.88)
        const halfBase = rand(rr, 1.0, 2.2)
        const tipX = bx + lean
        const tipY = rh - bladeH
        ctx.fillStyle = bladeFill
        ctx.beginPath()
        ctx.moveTo(bx - halfBase, rh + 6)
        ctx.quadraticCurveTo(bx + lean * 0.34, rh - bladeH * 0.56, tipX, tipY)
        ctx.quadraticCurveTo(bx + lean * 0.38 + halfBase * 0.5, rh - bladeH * 0.54, bx + halfBase, rh + 6)
        ctx.closePath()
        ctx.fill()

        if (rr() < 0.42) {
          ctx.save()
          ctx.translate(tipX, tipY)
          ctx.rotate(Math.atan2(lean, bladeH) - 0.15)
          ctx.fillStyle = plumeFill
          ctx.beginPath()
          ctx.ellipse(0, -8, 2.6, 11, 0, 0, TAU)
          ctx.fill()
          ctx.restore()
        }
      }
      ctx.restore()
    })
    return soften(raw, 2.8)
  }

  const build = () => {
    lakeTopY = h * 0.805
    cabinX = 0.79

    const crisp = surface(40, 92, (ctx) => {
      ctx.drawImage(makeDropSprite(0.32, 0.74, 0.76), 0, -2)
    })
    dropCrisp = crisp
    dropSoft = soften(surface(40, 84, (ctx) => {
      ctx.drawImage(makeDropSprite(0.24, 0.5, 0.52), 0, -6)
    }), 2)
    dropBokeh = makeRainBokehSprite()
    shimmerSprite = makeShimmerSprite()
    cabinGlowSprite = makeOrbSprite(255, 206, 134, 48)

    mistFar = mistBand(dark ? '156,184,218' : '240,247,253')
    mistNear = mistBand(dark ? '176,204,236' : '250,253,255')

    const rr = rng(4093)
    bg = surface(w, h, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, lakeTopY)
      if (dark) {
        sky.addColorStop(0, '#070e1d')
        sky.addColorStop(0.36, '#10203a')
        sky.addColorStop(0.72, '#1d3556')
        sky.addColorStop(1, '#2d4b6e')
      } else {
        sky.addColorStop(0, '#afc2d4')
        sky.addColorStop(0.38, '#c7d6e4')
        sky.addColorStop(0.75, '#dde8f1')
        sky.addColorStop(1, '#edf3f8')
      }
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)

      const breakX = w * 0.68, breakY = h * 0.2
      if (dark) {
        for (let i = 0; i < 32; i += 1) {
          const sx = breakX + rand(rr, -w * 0.22, w * 0.22)
          const sy = breakY + rand(rr, -h * 0.16, h * 0.14)
          if (sx < 0 || sx > w || sy < 0) continue
          ctx.fillStyle = `rgba(226, 240, 255, ${(0.08 + rr() * 0.28).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(sx, sy, 0.4 + rr() * 0.85, 0, TAU)
          ctx.fill()
        }
      }

      const skyBreak = ctx.createRadialGradient(breakX, breakY, 0, breakX, breakY, Math.max(w, h) * 0.56)
      if (dark) {
        skyBreak.addColorStop(0, 'rgba(208, 230, 255, 0.36)')
        skyBreak.addColorStop(0.32, 'rgba(136, 174, 218, 0.15)')
        skyBreak.addColorStop(1, 'rgba(30, 50, 78, 0)')
      } else {
        skyBreak.addColorStop(0, 'rgba(255, 255, 255, 0.76)')
        skyBreak.addColorStop(0.42, 'rgba(242, 248, 254, 0.32)')
        skyBreak.addColorStop(1, 'rgba(226, 236, 245, 0)')
      }
      ctx.fillStyle = skyBreak
      ctx.fillRect(0, 0, w, lakeTopY)

      // 丝滑水彩雨云团（局部坐标系原点 0,0 对齐径向渐变圆心，彻底消除矩形裁切硬边）
      for (let layer = 0; layer < 3; layer += 1) {
        const yBase = h * (0.08 + layer * 0.115)
        for (let i = 0; i < 16; i += 1) {
          const cx = rr() * w
          const cy = yBase + (rr() - 0.5) * h * 0.1
          const rx = w * (0.1 + rr() * 0.2)
          const ry = rx * (0.28 + rr() * 0.18)
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
          if (dark) {
            const a = 0.24 - layer * 0.045
            g.addColorStop(0, `rgba(8, 16, 30, ${a.toFixed(3)})`)
            g.addColorStop(0.6, `rgba(15, 28, 50, ${(a * 0.45).toFixed(3)})`)
            g.addColorStop(1, 'rgba(15, 28, 50, 0)')
          } else {
            const a = 0.2 - layer * 0.04
            g.addColorStop(0, `rgba(146, 166, 186, ${a.toFixed(3)})`)
            g.addColorStop(0.6, `rgba(170, 188, 206, ${(a * 0.42).toFixed(3)})`)
            g.addColorStop(1, 'rgba(170, 188, 206, 0)')
          }
          ctx.save()
          ctx.translate(cx, cy)
          ctx.scale(1, ry / rx)
          ctx.fillStyle = g
          ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
          ctx.restore()
        }
      }

      fillRidge(ctx, buildRidge(101, h * 0.725, h * 0.1, h * 0.045), dark ? 'rgba(26, 45, 70, 0.72)' : 'rgba(164, 182, 198, 0.56)')
      const haze1 = ctx.createLinearGradient(0, h * 0.66, 0, lakeTopY)
      haze1.addColorStop(0, dark ? 'rgba(146,178,214,0)' : 'rgba(242,248,253,0)')
      haze1.addColorStop(1, dark ? 'rgba(128,162,198,0.16)' : 'rgba(244,249,254,0.52)')
      ctx.fillStyle = haze1
      ctx.fillRect(0, h * 0.66, w, lakeTopY - h * 0.66)

      fillRidge(ctx, buildRidge(211, h * 0.768, h * 0.082, h * 0.036), dark ? 'rgba(17, 31, 50, 0.86)' : 'rgba(138, 158, 178, 0.68)')
      fillRidge(ctx, buildRidge(307, h * 0.798, h * 0.055, h * 0.024), dark ? '#0d1929' : '#73889d')

      const wx = w * cabinX, wy = lakeTopY - h * 0.012
      const warmGlow = ctx.createRadialGradient(wx, wy, 0, wx, wy, h * 0.052)
      warmGlow.addColorStop(0, dark ? 'rgba(255, 224, 166, 0.92)' : 'rgba(255, 226, 174, 0.68)')
      warmGlow.addColorStop(0.2, dark ? 'rgba(255, 190, 112, 0.36)' : 'rgba(255, 200, 134, 0.22)')
      warmGlow.addColorStop(1, 'rgba(255, 180, 100, 0)')
      ctx.fillStyle = warmGlow
      ctx.fillRect(wx - h * 0.06, wy - h * 0.06, h * 0.12, h * 0.12)
      ctx.fillStyle = dark ? 'rgba(255, 238, 196, 0.95)' : 'rgba(255, 240, 206, 0.8)'
      ctx.fillRect(wx - 2.2, wy - 1.5, 4.4, 3)

      const lake = ctx.createLinearGradient(0, lakeTopY, 0, h)
      if (dark) {
        lake.addColorStop(0, '#14263f')
        lake.addColorStop(0.32, '#0f1e33')
        lake.addColorStop(1, '#070e1a')
      } else {
        lake.addColorStop(0, '#9eb3c6')
        lake.addColorStop(0.38, '#8ba1b6')
        lake.addColorStop(1, '#758c9f')
      }
      ctx.fillStyle = lake
      ctx.fillRect(0, lakeTopY, w, h - lakeTopY)

      const moonRefl = ctx.createRadialGradient(
        breakX, lakeTopY + (h - lakeTopY) * 0.18, 0,
        breakX, lakeTopY + (h - lakeTopY) * 0.35, w * 0.3,
      )
      moonRefl.addColorStop(0, dark ? 'rgba(186, 216, 250, 0.24)' : 'rgba(255, 255, 255, 0.38)')
      moonRefl.addColorStop(1, 'rgba(186, 216, 250, 0)')
      ctx.fillStyle = moonRefl
      ctx.fillRect(0, lakeTopY, w, h - lakeTopY)

      const shoreLine = ctx.createLinearGradient(0, lakeTopY - 2, 0, lakeTopY + h * 0.02)
      shoreLine.addColorStop(0, dark ? 'rgba(156, 188, 224, 0.16)' : 'rgba(244, 249, 254, 0.42)')
      shoreLine.addColorStop(1, 'rgba(156, 188, 224, 0)')
      ctx.fillStyle = shoreLine
      ctx.fillRect(0, lakeTopY - 2, w, h * 0.022)

      vignette(ctx, w, h, dark ? 0.42 : 0.11)
    })

    const rw = Math.max(120, Math.round(w * 0.2))
    const rh = Math.max(90, Math.round(h * 0.24))
    fgLeft = buildReedSprite(rw, rh, 733, false)
    fgRight = buildReedSprite(rw, rh, 941, true)
  }

  const drawBolt = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const segs = 9
    let px = x0, py = y0
    ctx.beginPath()
    ctx.moveTo(px, py)
    for (let i = 1; i <= segs; i += 1) {
      const t = i / segs
      const nx = x0 + (x1 - x0) * t + (i < segs ? (r() - 0.5) * 38 : 0)
      const ny = y0 + (y1 - y0) * t
      ctx.lineTo(nx, ny)
      if (depth > 0 && r() < 0.26) {
        ctx.stroke()
        ctx.save()
        ctx.lineWidth *= 0.5
        ctx.globalAlpha *= 0.55
        drawBolt(ctx, nx, ny, nx + (r() - 0.5) * 140, ny + (y1 - y0) * 0.38, depth - 1)
        ctx.restore()
        ctx.beginPath()
        ctx.moveTo(nx, ny)
      }
      px = nx; py = ny
    }
    ctx.stroke()
  }

  const dropVelocity = (d: Drop) => (430 + (speed / 100) * 340) * (0.62 + d.z * 0.52)
  const currentSlope = (d: Drop, t: number) =>
    (wind / 100) * 0.34 + Math.sin(t * d.swayFreq + d.phase) * d.swayAmp

  return {
    fps: 60,
    setup(width, height) {
      w = width; h = height
      build()
      drops = []
      ripples.length = 0
      target = Math.round((countParam / 100) * 280 * areaFactor(w, h))
      resize(drops, target, () => spawnDrop(true))
    },
    setTone(next) { dark = next; build() },
    configure(v) {
      countParam = v.count ?? 70
      speed = v.speed ?? 65
      wind = v.wind ?? 25
      mistAmt = (v.mist ?? 40) / 100
      bolt = (v.lightning ?? 0) / 100
      target = Math.round((countParam / 100) * 280 * areaFactor(w, h))
      resize(drops, target, () => spawnDrop(false))
    },
    step(dt) {
      const t0 = time
      time += dt

      for (const d of drops) {
        const vy = dropVelocity(d)
        const slope = currentSlope(d, t0)
        d.y += vy * dt
        d.x += vy * slope * dt
        if (d.y > h + 40 || d.x < -w * 0.32 || d.x > w * 1.32) {
          if (d.x >= 0 && d.x <= w && d.z > 0.35 && r() < 0.42) spawnRipple(d.x)
          Object.assign(d, spawnDrop(false))
        }
      }

      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        ripples[i].t += dt
        if (ripples[i].t >= ripples[i].life) ripples.splice(i, 1)
      }
      if (r() < dt * (4 + target * 0.04)) spawnRipple(rand(r, 0, w))

      flash = Math.max(0, flash - dt * 3.8)
      if (bolt > 0.01) {
        nextBolt -= dt
        if (nextBolt <= 0) {
          flash = 1
          boltX = 0.16 + r() * 0.68
          nextBolt = rand(r, 8, 18)
        }
      }
    },
    draw(ctx) {
      if (bg) ctx.drawImage(bg, 0, 0, w, h)

      if (shimmerSprite) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        const shimmerBands = 14
        for (let i = 0; i < shimmerBands; i += 1) {
          const k = i / (shimmerBands - 1)
          const y = lakeTopY + Math.pow(k, 1.45) * (h - lakeTopY) * 0.86 + 3
          const driftX = Math.sin(time * (0.55 + k * 0.35) + i * 2.1) * (22 + k * 54)
          const cx = w * 0.68 + driftX + (i % 3 - 1) * w * 0.055
          const sw = (34 + k * 120) * (0.75 + 0.25 * Math.sin(time * 1.4 + i))
          const sh = 2.2 + k * 5.2
          ctx.globalAlpha = (dark ? 0.24 : 0.2) * (1 - k * 0.52) * (0.65 + 0.35 * Math.sin(time * 1.9 + i * 1.7))
          ctx.drawImage(shimmerSprite, cx - sw / 2, y - sh / 2, sw, sh)
        }
        if (cabinGlowSprite) {
          const wx = w * cabinX + Math.sin(time * 1.3) * 3.5
          const wy = lakeTopY + h * 0.03
          ctx.globalAlpha = dark ? 0.3 + 0.08 * Math.sin(time * 2.4) : 0.18
          ctx.drawImage(cabinGlowSprite, wx - 28, wy - 14, 56, 44)
        }
        ctx.restore()
      }

      drawMist(ctx, mistFar, w, lakeTopY - h * 0.14, h * 0.2, time * 14, mistAmt * (dark ? 0.38 : 0.52))

      ctx.save()
      for (const rp of ripples) {
        const k = rp.t / rp.life
        const ease = 1 - Math.pow(1 - k, 2.3)
        const rx = 2.5 + ease * rp.maxR
        const ry = rx * 0.24
        const alpha = (1 - k) * (1 - k) * rp.strength * (dark ? 0.44 : 0.36)
        ctx.strokeStyle = dark ? `rgba(198,226,255,${alpha.toFixed(3)})` : `rgba(255,255,255,${alpha.toFixed(3)})`
        ctx.lineWidth = 1.15
        ctx.beginPath()
        ctx.ellipse(rp.x, rp.y, rx, ry, 0, 0, TAU)
        ctx.stroke()
        if (k < 0.72) {
          ctx.lineWidth = 0.75
          ctx.strokeStyle = dark
            ? `rgba(198,226,255,${(alpha * 0.45).toFixed(3)})`
            : `rgba(255,255,255,${(alpha * 0.45).toFixed(3)})`
          ctx.beginPath()
          ctx.ellipse(rp.x, rp.y, rx * 0.56, ry * 0.56, 0, 0, TAU)
          ctx.stroke()
        }
      }
      ctx.restore()

      const half = Math.max(1, w * 0.5)
      ctx.save()
      for (const d of drops) {
        const slope = currentSlope(d, time)
        const angle = -Math.atan(slope)
        const normFromCenter = Math.abs(d.x - half) / half
        const centerQuiet = 0.16 + 0.84 * smoothstep(0.32, 0.66, normFromCenter)
        const sprite = d.z > 0.87 ? dropBokeh : d.z > 0.58 ? dropCrisp : dropSoft
        if (!sprite) continue
        ctx.save()
        ctx.translate(d.x, d.y)
        ctx.rotate(angle)
        ctx.globalAlpha = d.alpha * centerQuiet
        ctx.drawImage(sprite, -d.w * 0.5, -d.h * 0.5, d.w, d.h)
        ctx.restore()
      }
      ctx.restore()

      drawMist(ctx, mistNear, w, h * 0.72, h * 0.3, -time * 22, mistAmt * (dark ? 0.24 : 0.36))

      const reedSway = Math.sin(time * 0.85) * 0.022 + (wind / 100) * 0.03
      if (fgLeft) {
        ctx.save()
        ctx.translate(-8, h + 6)
        ctx.rotate(reedSway)
        ctx.drawImage(fgLeft, 0, -fgLeft.height)
        ctx.restore()
      }
      if (fgRight) {
        ctx.save()
        ctx.translate(w + 8, h + 6)
        ctx.rotate(reedSway * 0.88)
        ctx.drawImage(fgRight, -fgRight.width, -fgRight.height)
        ctx.restore()
      }

      if (flash > 0.01 && bolt > 0.01) {
        const a = flash * flash * bolt
        ctx.save()
        ctx.fillStyle = `rgba(214,230,255,${(a * (dark ? 0.3 : 0.22)).toFixed(3)})`
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = `rgba(238,246,255,${(a * 0.85).toFixed(3)})`
        ctx.lineWidth = 1.9
        ctx.lineCap = 'round'
        drawBolt(ctx, w * boltX, 0, w * (boltX + 0.05), h * 0.48, 2)
        ctx.restore()
      }
    },
  }
}

/* ===================================================================== *
 *  三、竹林（岚山晨雾翠竹 / 幽篁月影流萤，60fps 水墨青岚意境）
 * ===================================================================== */

export function createBamboo(initialDark: boolean): Renderer {
  interface Culm {
    x: number
    z: number
    heightScale: number
    widthScale: number
    lean: number
    ph: number
    spriteIdx: number
    flip: boolean
  }
  interface DriftLeaf {
    x: number
    y: number
    size: number
    angle: number
    spin: number
    tumble: number
    vx: number
    vy: number
    ph: number
    alpha: number
  }
  interface Firefly {
    x: number
    y: number
    vx: number
    vy: number
    ph: number
    pulseSpeed: number
    size: number
  }

  let w = 0, h = 0, dark = initialDark, time = 0
  let bg: HTMLCanvasElement | null = null
  let mist: HTMLCanvasElement | null = null
  let raySprite: HTMLCanvasElement | null = null
  let culmSprites: HTMLCanvasElement[] = []
  let leafSprite: HTMLCanvasElement | null = null
  let fireflySprite: HTMLCanvasElement | null = null
  let culms: Culm[] = []
  let driftLeaves: DriftLeaf[] = []
  let fireflies: Firefly[] = []
  let density = 55, wind = 40, speed = 35, mistAmt = 0.45, lightAmt = 0.45

  const r = rng(2029)

  /** 绘制单片自然弧垂的修长竹叶（叶尖微垂，尽显国画水墨韵律） */
  const drawDroopingLeaf = (
    ctx: CanvasRenderingContext2D,
    len: number,
    wid: number,
    fill: string,
    vein: string,
  ) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(len * 0.34, -wid * 0.85, len, wid * 0.65)
    ctx.quadraticCurveTo(len * 0.38, wid * 1.15, 0, 0)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = vein
    ctx.lineWidth = 0.65
    ctx.beginPath()
    ctx.moveTo(len * 0.05, 0)
    ctx.quadraticCurveTo(len * 0.42, wid * 0.14, len * 0.86, wid * 0.54)
    ctx.stroke()
  }

  /** 预烘焙一整株自然弯拱、低垂羽叶成簇的翠竹贴图（3 档景深虚实与高矮变化） */
  const makeCulmSprite = (tier: 0 | 1 | 2, seedNum: number) => {
    const cr = rng(seedNum)
    const cw = 240, ch = 760
    const raw = surface(cw, ch, (ctx) => {
      const stalkW = tier === 0 ? 4.8 : tier === 1 ? 7.6 : 11.2
      const baseX = cw * 0.5
      // 竹竿由根向梢柔和弯拱渐细，绝不画成僵硬笔直水管
      const bow = 20 + cr() * 24
      const topLimit = tier === 0 && seedNum % 2 === 1 ? ch * 0.16 : -18
      const xAt = (y: number) => {
        const t = clamp(1 - y / ch, 0, 1.1)
        return baseX + bow * t * t
      }

      const segLen = tier === 0 ? 64 : tier === 1 ? 76 : 88
      for (let y = ch + 10; y > topLimit; y -= segLen) {
        const yTop = Math.max(topLimit, y - segLen + 1.5)
        const x0 = xAt(y), x1 = xAt(yTop)
        const taper = 0.42 + 0.58 * clamp(y / ch, 0, 1)
        const taperTop = 0.42 + 0.58 * clamp(yTop / ch, 0, 1)
        const hw0 = (stalkW * taper) / 2
        const hw1 = (stalkW * taperTop) / 2

        const grad = ctx.createLinearGradient(x0 - hw0, 0, x0 + hw0, 0)
        if (dark) {
          const lgt = tier === 0 ? [12, 36, 30] : tier === 1 ? [19, 54, 42] : [26, 72, 54]
          const hi = tier === 0 ? [28, 68, 56] : tier === 1 ? [54, 118, 92] : [76, 152, 114]
          grad.addColorStop(0, `rgba(${lgt[0]},${lgt[1]},${lgt[2]},${tier === 0 ? 0.42 : 0.88})`)
          grad.addColorStop(0.36, `rgba(${hi[0]},${hi[1]},${hi[2]},${tier === 0 ? 0.48 : 0.92})`)
          grad.addColorStop(1, `rgba(${Math.round(lgt[0] * 0.6)},${Math.round(lgt[1] * 0.6)},${Math.round(lgt[2] * 0.6)},${tier === 0 ? 0.42 : 0.9})`)
        } else {
          const lgt = tier === 0 ? [154, 182, 152] : tier === 1 ? [98, 142, 98] : [72, 118, 74]
          const hi = tier === 0 ? [182, 206, 178] : tier === 1 ? [146, 188, 136] : [124, 172, 112]
          grad.addColorStop(0, `rgba(${lgt[0]},${lgt[1]},${lgt[2]},${tier === 0 ? 0.36 : 0.82})`)
          grad.addColorStop(0.38, `rgba(${hi[0]},${hi[1]},${hi[2]},${tier === 0 ? 0.4 : 0.86})`)
          grad.addColorStop(1, `rgba(${Math.round(lgt[0] * 0.78)},${Math.round(lgt[1] * 0.78)},${Math.round(lgt[2] * 0.78)},${tier === 0 ? 0.36 : 0.84})`)
        }

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x0 - hw0, y)
        ctx.lineTo(x1 - hw1, yTop)
        ctx.lineTo(x1 + hw1, yTop)
        ctx.lineTo(x0 + hw0, y)
        ctx.closePath()
        ctx.fill()

        ctx.strokeStyle = dark
          ? `rgba(122, 198, 158, ${tier === 0 ? 0.14 : 0.32})`
          : `rgba(234, 248, 226, ${tier === 0 ? 0.22 : 0.5})`
        ctx.lineWidth = tier === 0 ? 0.9 : 1.4
        ctx.beginPath()
        ctx.moveTo(x1 - hw1 * 1.18, yTop)
        ctx.quadraticCurveTo(x1, yTop - 1.3, x1 + hw1 * 1.18, yTop)
        ctx.stroke()

        // 国画式低垂竹叶簇：侧枝斜出后叶簇顺重力自然下垂（22°–76°），层次丰盈
        if (yTop < ch * 0.78 && cr() < 0.78) {
          const dir = cr() < 0.5 ? -1 : 1
          const twigLen = (24 + cr() * 36) * (tier === 0 ? 0.75 : 1)
          ctx.strokeStyle = dark ? 'rgba(38, 88, 68, 0.65)' : 'rgba(96, 138, 94, 0.56)'
          ctx.lineWidth = 1.0
          ctx.beginPath()
          ctx.moveTo(x1, yTop)
          ctx.quadraticCurveTo(x1 + dir * twigLen * 0.55, yTop - 10, x1 + dir * twigLen, yTop + 4 + cr() * 10)
          ctx.stroke()

          const clusters = [0.62, 1.0]
          for (const cPos of clusters) {
            const cx = x1 + dir * twigLen * cPos
            const cy = yTop + (cPos - 0.5) * 8
            const leafCount = 3 + Math.floor(cr() * 3)
            for (let k = 0; k < leafCount; k += 1) {
              ctx.save()
              ctx.translate(cx, cy)
              const spread = 0.28 + k * 0.24 + (cr() - 0.5) * 0.16
              if (dir < 0) ctx.scale(-1, 1)
              ctx.rotate(spread)
              const leafFill = dark
                ? `rgba(${32 + k * 9}, ${94 + k * 15}, ${70 + k * 10}, ${tier === 0 ? 0.36 : 0.8})`
                : `rgba(${86 + k * 12}, ${140 + k * 12}, ${82 + k * 9}, ${tier === 0 ? 0.3 : 0.74})`
              const veinFill = dark ? 'rgba(154, 228, 188, 0.2)' : 'rgba(234, 249, 224, 0.34)'
              drawDroopingLeaf(ctx, (26 + cr() * 20) * (tier === 0 ? 0.8 : 1.05), 3.4 + cr() * 1.4, leafFill, veinFill)
              ctx.restore()
            }
          }
        }
      }
    })
    if (tier === 0) return soften(raw, 2.8)
    if (tier === 2) return soften(raw, 1.8)
    return raw
  }

  const spawnCulm = (): Culm => {
    const z = Math.random()
    // 严格守护中央阅读区 [0.20, 0.80] 清朗通透：两侧竹影成林，绝不压盖正文标题与段落
    const side = Math.random() < 0.5 ? -1 : 1
    const flankFrac = Math.pow(Math.random(), 1.35) * 0.185 - 0.02
    const xFrac = side < 0 ? flankFrac : 1 - flankFrac
    const tier: 0 | 1 | 2 = z < 0.38 ? 0 : z < 0.78 ? 1 : 2
    return {
      x: xFrac * w,
      z,
      heightScale: 0.92 + Math.random() * 0.22,
      widthScale: 0.76 + z * 0.54,
      lean: side < 0 ? rand(r, 0.015, 0.085) : -rand(r, 0.015, 0.085),
      ph: Math.random() * TAU,
      spriteIdx: tier * 2 + (Math.random() < 0.5 ? 0 : 1),
      flip: side > 0,
    }
  }

  const spawnDriftLeaf = (top = false): DriftLeaf => ({
    x: rand(r, -60, w + 60),
    y: top ? rand(r, -h * 0.25, -20) : rand(r, 0, h),
    size: rand(r, 15, 27),
    angle: rand(r, 0, TAU),
    spin: rand(r, -1.5, 1.5),
    tumble: rand(r, 0, TAU),
    vx: rand(r, 12, 34),
    vy: rand(r, 16, 36),
    ph: rand(r, 0, TAU),
    alpha: rand(r, 0.38, 0.8),
  })

  const spawnFirefly = (): Firefly => ({
    x: rand(r, 0, Math.max(1, w)),
    y: rand(r, h * 0.16, Math.max(2, h * 0.94)),
    vx: rand(r, -14, 14),
    vy: rand(r, -10, 10),
    ph: rand(r, 0, TAU),
    pulseSpeed: rand(r, 1.1, 2.4),
    size: rand(r, 12, 26),
  })

  const build = () => {
    culmSprites = [
      makeCulmSprite(0, 101),
      makeCulmSprite(0, 203),
      makeCulmSprite(1, 307),
      makeCulmSprite(1, 409),
      makeCulmSprite(2, 503),
      makeCulmSprite(2, 607),
    ]

    leafSprite = surface(56, 22, (ctx) => {
      drawDroopingLeaf(
        ctx,
        48,
        5.0,
        dark ? 'rgba(68, 156, 114, 0.92)' : 'rgba(98, 154, 88, 0.9)',
        dark ? 'rgba(180, 242, 206, 0.45)' : 'rgba(236, 250, 224, 0.55)',
      )
    })

    fireflySprite = dark
      ? makeOrbSprite(188, 255, 144, 48)
      : makeOrbSprite(255, 244, 184, 48)

    raySprite = dark
      ? makeRaySprite(156, 236, 208, 0.56)
      : makeRaySprite(255, 252, 214, 0.68)

    mist = mistBand(dark ? '126,188,168' : '242,249,238')

    bg = surface(w, h, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      if (dark) {
        g.addColorStop(0, '#040d0c')
        g.addColorStop(0.38, '#091b18')
        g.addColorStop(0.75, '#102923')
        g.addColorStop(1, '#16352c')
      } else {
        g.addColorStop(0, '#f4f8f1')
        g.addColorStop(0.45, '#e7f0e2')
        g.addColorStop(0.8, '#d8e7d1')
        g.addColorStop(1, '#cbe0c3')
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      const lx = dark ? w * 0.72 : w * 0.28
      const ly = h * 0.12
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.68)
      if (dark) {
        glow.addColorStop(0, 'rgba(186, 240, 218, 0.28)')
        glow.addColorStop(0.35, 'rgba(88, 168, 144, 0.1)')
        glow.addColorStop(1, 'rgba(0,0,0,0)')
      } else {
        glow.addColorStop(0, 'rgba(255, 252, 224, 0.88)')
        glow.addColorStop(0.45, 'rgba(232, 245, 214, 0.36)')
        glow.addColorStop(1, 'rgba(232, 245, 214, 0)')
      }
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      // 远景水墨淡影山峦（多峰柔焦水墨洗染）
      for (let layer = 0; layer < 2; layer += 1) {
        const baseY = h * (0.76 + layer * 0.08)
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w + 16; x += 16) {
          const u = x / Math.max(1, w)
          const flank = Math.pow(Math.abs(u - 0.5) * 2, 1.4)
          const undulate =
            Math.sin(u * 5.8 + layer * 2.1) * 0.36 +
            Math.sin(u * 12.7 + layer * 1.3) * 0.16 +
            Math.sin(u * 21.4 + layer) * 0.07
          ctx.lineTo(x, baseY - h * (0.025 + flank * 0.1 + undulate * 0.022))
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        const hillGrad = ctx.createLinearGradient(0, baseY - h * 0.14, 0, h)
        if (dark) {
          hillGrad.addColorStop(0, layer === 0 ? 'rgba(15, 42, 35, 0.64)' : 'rgba(10, 29, 25, 0.82)')
          hillGrad.addColorStop(1, 'rgba(6, 18, 16, 0.3)')
        } else {
          hillGrad.addColorStop(0, layer === 0 ? 'rgba(180, 206, 174, 0.48)' : 'rgba(160, 190, 154, 0.46)')
          hillGrad.addColorStop(1, 'rgba(206, 224, 198, 0.16)')
        }
        ctx.fillStyle = hillGrad
        ctx.fill()
      }

      vignette(ctx, w, h, dark ? 0.42 : 0.07)
    })
  }

  const rebuildCulms = () => {
    const n = Math.round((12 + (density / 100) * 28) * clamp(w / 1440, 0.65, 1.7))
    resize(culms, n, spawnCulm)
    culms.sort((a, b) => a.z - b.z)
  }

  return {
    fps: 60,
    setup(width, height) {
      w = width
      h = height
      build()
      culms = []
      driftLeaves = []
      fireflies = []
      rebuildCulms()
      resize(driftLeaves, Math.round(14 * areaFactor(w, h)), () => spawnDriftLeaf(false))
      resize(fireflies, Math.round(26 * areaFactor(w, h)), spawnFirefly)
    },
    setTone(next) {
      dark = next
      build()
    },
    configure(v) {
      density = v.density ?? 55
      wind = v.wind ?? 40
      speed = v.speed ?? 35
      mistAmt = (v.mist ?? 45) / 100
      lightAmt = (v.light ?? 45) / 100
      rebuildCulms()
      resize(driftLeaves, Math.round((8 + (density / 100) * 14) * areaFactor(w, h)), () => spawnDriftLeaf(false))
      resize(fireflies, Math.round((16 + lightAmt * 24) * areaFactor(w, h)), spawnFirefly)
    },
    step(dt) {
      const rate = 0.42 + (speed / 100) * 1.15
      time += dt * rate
      const breeze = (0.65 + 0.45 * Math.sin(time * 0.55)) * (0.4 + wind / 100)

      for (const leaf of driftLeaves) {
        leaf.ph += dt * 1.6
        leaf.angle += leaf.spin * dt * 0.8
        leaf.tumble += dt * 2.1
        leaf.x += (leaf.vx * breeze + Math.sin(leaf.ph) * 18) * dt
        leaf.y += leaf.vy * (0.7 + 0.3 * Math.cos(leaf.tumble)) * dt
        if (leaf.y > h + 40 || leaf.x > w + 80 || leaf.x < -80) {
          Object.assign(leaf, spawnDriftLeaf(true))
        }
      }

      for (const f of fireflies) {
        f.ph += dt * f.pulseSpeed
        f.vx += Math.sin(time * 0.8 + f.ph) * 6 * dt
        f.vy += Math.cos(time * 0.7 + f.ph * 1.3) * 5 * dt
        f.vx = clamp(f.vx, -18, 18)
        f.vy = clamp(f.vy, -14, 14)
        f.x += f.vx * dt
        f.y += f.vy * dt
        if (f.x < -20) f.x = w + 20
        if (f.x > w + 20) f.x = -20
        if (f.y < h * 0.1) f.y = h * 0.95
        if (f.y > h + 20) f.y = h * 0.15
      }
    },
    draw(ctx) {
      if (bg) ctx.drawImage(bg, 0, 0, w, h)

      const gust = Math.sin(time * 0.42) * 0.5 + Math.sin(time * 0.93 + 1.2) * 0.25 + 0.55
      const drawCulmBand = (minZ: number, maxZ: number) => {
        for (const c of culms) {
          if (c.z < minZ || c.z >= maxZ) continue
          const sp = culmSprites[c.spriteIdx]
          if (!sp) continue
          const sway =
            c.lean +
            (Math.sin(time * 0.85 + c.ph + c.x * 0.0025) * 0.55 + gust * 0.38) *
              (wind / 100) *
              0.085 *
              (0.45 + c.z * 0.75)
          const drawH = h * c.heightScale * (1.02 + c.z * 0.08)
          const drawW = sp.width * (drawH / sp.height) * c.widthScale
          ctx.save()
          ctx.translate(c.x, h + 18)
          ctx.rotate(sway)
          if (c.flip) ctx.scale(-1, 1)
          ctx.drawImage(sp, -drawW / 2, -drawH, drawW, drawH)
          ctx.restore()
        }
      }

      drawCulmBand(0, 0.42)

      // 丁达尔柔和林间斜射光束（晨阳或幽篁清月穿过林隙倾泻而下）
      if (raySprite && lightAmt > 0.02) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 5; i += 1) {
          const rx = w * (0.12 + i * 0.19) + Math.sin(time * 0.18 + i) * 26
          const rw = w * (0.12 + (i % 2) * 0.055)
          ctx.save()
          ctx.translate(rx, -h * 0.08)
          ctx.rotate(dark ? -0.26 : 0.26)
          ctx.globalAlpha = lightAmt * (dark ? 0.28 : 0.42) * (0.72 + 0.28 * Math.sin(time * 0.32 + i * 1.4))
          ctx.drawImage(raySprite, -rw / 2, 0, rw, h * 1.25)
          ctx.restore()
        }
        ctx.restore()
      }

      drawMist(ctx, mist, w, h * 0.48, h * 0.42, time * 14, mistAmt * (dark ? 0.26 : 0.44))

      drawCulmBand(0.42, 1.01)

      const half = Math.max(1, w * 0.5)
      if (leafSprite) {
        ctx.save()
        for (const leaf of driftLeaves) {
          const quiet =
            0.38 + 0.62 * smoothstep(Math.min(0.36, 320 / half), Math.min(0.8, 560 / half), Math.abs(leaf.x - half) / half)
          const squeeze = 0.35 + 0.65 * Math.abs(Math.cos(leaf.tumble))
          ctx.save()
          ctx.translate(leaf.x, leaf.y)
          ctx.rotate(leaf.angle)
          ctx.globalAlpha = leaf.alpha * quiet
          ctx.drawImage(
            leafSprite,
            -leaf.size * 0.5,
            -leaf.size * 0.18 * squeeze,
            leaf.size,
            leaf.size * 0.36 * squeeze,
          )
          ctx.restore()
        }
        ctx.restore()
      }

      if (fireflySprite) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        for (const f of fireflies) {
          const glow = Math.pow(0.5 + 0.5 * Math.sin(f.ph), dark ? 1.8 : 1.4)
          const quiet =
            0.48 + 0.52 * smoothstep(Math.min(0.34, 300 / half), Math.min(0.78, 540 / half), Math.abs(f.x - half) / half)
          ctx.globalAlpha = glow * (dark ? 0.78 : 0.48 * lightAmt * 1.6) * quiet
          ctx.drawImage(fireflySprite, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size)
        }
        ctx.restore()
      }

      drawMist(ctx, mist, w, h * 0.72, h * 0.3, -time * 19, mistAmt * (dark ? 0.2 : 0.34))
    },
  }
}
