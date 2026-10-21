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
/** 固定种子伪随机：山形、雪岭、雾团等静态部分每次重建都保持一致，缩放窗口不会「换一座山」 */
function seeded(seed: number) {
  let value = (seed * 2654435761) >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}
function resize<T>(items: T[], count: number, make: () => T) {
  items.length = Math.min(items.length, count)
  while (items.length < count) items.push(make())
}
/**
 * 雪花（清冷雪日 · 蓝调雪夜）：
 *   · 远景：三层雪岭依次推远，岭脊压着一线积雪高光，近岭长着落雪的针叶林；
 *     夜间是星野与一轮清冷冬月，白昼只留一抹被雪雾洗淡的薄阳。
 *   · 雪片：六角雪晶（带枝晶分叉）、细雪星屑、近景柔焦大雪花三层景深，另有一层落地雪光闪烁。
 *   · 全部静态部分烘焙进离屏贴图，逐帧只做 drawImage。
 */
export function createSnow(initialDark: boolean): Renderer {
  interface Flake { x: number; y: number; z: number; phase: number; angle: number; spin: number; sparkle: boolean }
  let w = 1, h = 1, dark = initialDark
  let values: SceneValues = {}, flakes: Flake[] = []
  let background: HTMLCanvasElement = paint(1, 1, () => {})
  let sprites: HTMLCanvasElement[] = []
  let sparkleSprite: HTMLCanvasElement | null = null

  const spawn = (top = false): Flake => ({
    x: rand(-60, w + 60),
    y: top ? rand(-70, -10) : rand(0, h),
    z: Math.pow(Math.random(), 1.25) * 0.94 + 0.06,
    phase: rand(0, TAU),
    angle: rand(0, TAU),
    spin: rand(-0.42, 0.42),
    sparkle: Math.random() < 0.12,
  })

  /** 一片六角雪晶：六条主枝 + 每枝两对小分叉 + 中心光核 */
  const crystalSprite = (size: number, tint: string, lineWidth: number, glow: boolean) =>
    paint(size, size, (ctx) => {
      const c = size / 2
      if (glow) {
        const g = ctx.createRadialGradient(c, c, 0, c, c, c)
        g.addColorStop(0, 'rgba(255,255,255,0.32)')
        g.addColorStop(0.5, 'rgba(214,235,255,0.1)')
        g.addColorStop(1, 'rgba(190,220,250,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, size, size)
      }
      ctx.strokeStyle = tint
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      const arm = c * 0.86
      for (let i = 0; i < 6; i += 1) {
        ctx.save()
        ctx.translate(c, c)
        ctx.rotate((i * TAU) / 6)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -arm)
        // 主枝上的两对小分叉，越靠外越短，像真实枝晶
        for (const t of [0.52, 0.76]) {
          const y = -arm * t
          const branch = arm * 0.26 * (1 - t * 0.35)
          ctx.moveTo(0, y)
          ctx.lineTo(-branch, y - branch * 0.72)
          ctx.moveTo(0, y)
          ctx.lineTo(branch, y - branch * 0.72)
        }
        ctx.stroke()
        // 枝端小光点
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.arc(0, -arm, lineWidth * 0.9, 0, TAU)
        ctx.fill()
        ctx.restore()
      }
      const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.3)
      core.addColorStop(0, 'rgba(255,255,255,0.95)')
      core.addColorStop(0.5, 'rgba(226,242,255,0.4)')
      core.addColorStop(1, 'rgba(226,242,255,0)')
      ctx.fillStyle = core
      ctx.fillRect(0, 0, size, size)
    })

  /** 柔焦近景雪片：中心通透、边缘羽化的暖白光斑 */
  const bokehFlake = (size: number) =>
    paint(size, size, (ctx) => {
      const c = size / 2
      const g = ctx.createRadialGradient(c, c, 0, c, c, c)
      g.addColorStop(0, dark ? 'rgba(240,250,255,0.62)' : 'rgba(255,255,255,0.92)')
      g.addColorStop(0.34, dark ? 'rgba(214,236,255,0.3)' : 'rgba(255,255,255,0.5)')
      g.addColorStop(0.72, dark ? 'rgba(186,216,248,0.08)' : 'rgba(226,240,250,0.16)')
      g.addColorStop(1, 'rgba(200,226,250,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
    })

  const buildSprites = () => {
    const crystalTint = dark ? 'rgba(232,246,255,0.92)' : 'rgba(255,255,255,0.98)'
    const fineTint = dark ? 'rgba(206,230,250,0.8)' : 'rgba(255,255,255,0.9)'
    sprites = [
      crystalSprite(96, crystalTint, 2.1, false), // 0: 主雪晶
      crystalSprite(64, fineTint, 1.5, true), // 1: 远景小雪晶（带微光）
      bokehFlake(128), // 2: 近景柔焦
      paint(48, 48, (ctx) => { // 3: 细雪星屑
        const c = 24
        const g = ctx.createRadialGradient(c, c, 0, c, c, c)
        g.addColorStop(0, dark ? 'rgba(240,250,255,0.95)' : 'rgba(255,255,255,1)')
        g.addColorStop(0.45, dark ? 'rgba(214,238,255,0.35)' : 'rgba(210,232,246,0.4)')
        g.addColorStop(1, 'rgba(210,236,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 48, 48)
      }),
    ]
    sparkleSprite = makeSparkle(dark ? 'rgba(236,248,255,0.95)' : 'rgba(255,255,255,0.95)')
  }

  const build = () => {
    buildSprites()
    const scale = Math.max(0.68, Math.min(1.5, w / 1440))
    const horizon = h * 0.74
    background = paint(w, h, (ctx) => {
      const skyGrad = ctx.createLinearGradient(0, 0, w * 0.35, h)
      if (dark) {
        skyGrad.addColorStop(0, '#050b17')
        skyGrad.addColorStop(0.42, '#0b1a2c')
        skyGrad.addColorStop(0.75, '#16314a')
        skyGrad.addColorStop(1, '#1f435c')
      } else {
        skyGrad.addColorStop(0, '#b6d3e6')
        skyGrad.addColorStop(0.42, '#d0e4f1')
        skyGrad.addColorStop(0.72, '#e6f2fa')
        skyGrad.addColorStop(1, '#d3e6f2')
      }
      ctx.fillStyle = skyGrad
      ctx.fillRect(0, 0, w, h)

      const sr = seeded(331)
      if (dark) {
        // 星野与冬月
        for (let i = 0; i < 70; i += 1) {
          const sx = sr() * w
          const sy = Math.pow(sr(), 1.4) * horizon * 0.7
          ctx.fillStyle = `rgba(232,242,255,${(0.12 + sr() * 0.5).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(sx, sy, 0.5 + sr() * 1.1, 0, TAU)
          ctx.fill()
        }
        const moonX = w * 0.79
        const moonY = h * 0.16
        const moonR = Math.max(13, Math.min(34, Math.min(w, h) * 0.032))
        const halo = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 7)
        halo.addColorStop(0, 'rgba(206,232,255,0.22)')
        halo.addColorStop(0.32, 'rgba(160,198,236,0.09)')
        halo.addColorStop(1, 'rgba(120,164,214,0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, w, h)
        ctx.save()
        ctx.beginPath()
        ctx.arc(moonX, moonY, moonR, 0, TAU)
        ctx.clip()
        const disc = ctx.createRadialGradient(moonX - moonR * 0.3, moonY - moonR * 0.3, moonR * 0.1, moonX, moonY, moonR)
        disc.addColorStop(0, 'rgba(255,255,255,0.98)')
        disc.addColorStop(0.7, 'rgba(232,244,255,0.95)')
        disc.addColorStop(1, 'rgba(198,222,244,0.9)')
        ctx.fillStyle = disc
        ctx.fillRect(moonX - moonR, moonY - moonR, moonR * 2, moonR * 2)
        ctx.fillStyle = 'rgba(168,196,224,0.16)'
        for (const [ox, oy, rr] of [[-0.28, -0.12, 0.3], [0.22, 0.24, 0.19], [-0.02, 0.4, 0.13]] as Array<[number, number, number]>) {
          ctx.beginPath()
          ctx.ellipse(moonX + ox * moonR, moonY + oy * moonR, rr * moonR, rr * moonR * 0.8, 0.4, 0, TAU)
          ctx.fill()
        }
        ctx.restore()
      } else {
        // 被雪雾洗淡的薄阳
        const sunX = w * 0.74
        const sunY = h * 0.24
        const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(w, h) * 0.55)
        sunGlow.addColorStop(0, 'rgba(255,253,246,0.72)')
        sunGlow.addColorStop(0.2, 'rgba(255,249,235,0.3)')
        sunGlow.addColorStop(1, 'rgba(255,249,235,0)')
        ctx.fillStyle = sunGlow
        ctx.fillRect(0, 0, w, h)
      }

      /* ---------------- 三层雪岭 ---------------- */
      /**
       * 雪峰剖面：每层放 4–7 座峰，用 cos² 单峰 + 软最大值合成，
       * 峰顶利落、谷地圆缓，比逐点噪声更像真实山脊。
       */
      const makeRange = (seedNum: number, peakH: number, baseY: number, count: number) => {
        const r = seeded(seedNum)
        const summits = Array.from({ length: count }, (_, i) => ({
          c: ((i + 0.15 + r() * 0.7) / count) * w,
          H: peakH * (0.55 + r() * 0.45),
          W: (w / count) * (0.85 + r() * 0.6),
        }))
        const samples = Math.max(120, Math.round(w / 8))
        const pts: Array<{ x: number; y: number }> = []
        for (let i = 0; i <= samples; i += 1) {
          const x = (i / samples) * w
          let sum = 0
          for (const s2 of summits) {
            const t = Math.min(1, Math.abs(x - s2.c) / s2.W)
            const bump = Math.cos((t * Math.PI) / 2) ** 2
            // 峰的右坡比左坡缓一点，山形不对称（迎风面陡、背风面长）
            sum += (s2.H * bump) ** 3
          }
          const height = Math.cbrt(sum) * (0.82 + 0.18 * Math.sin(x * 0.013 + seedNum))
          pts.push({ x, y: baseY - height })
        }
        return pts
      }

      const tone = dark
        ? {
            ranges: [
              { body: ['#16293f', '#0f2033'] as [string, string], lit: 'rgba(150,186,220,0.42)', depth: 0.5 },
              { body: ['#1b3854', '#132a41'] as [string, string], lit: 'rgba(176,208,238,0.5)', depth: 0.52 },
              { body: ['#23496a', '#183552'] as [string, string], lit: 'rgba(206,230,250,0.62)', depth: 0.55 },
            ],
            pines: '#0f2438',
            pineSnow: 'rgba(190,218,242,0.3)',
          }
        : {
            ranges: [
              { body: ['#c3d6e6', '#a3bcd2'] as [string, string], lit: 'rgba(255,255,255,0.98)', depth: 0.5 },
              { body: ['#b0c9dd', '#8fabC4'] as [string, string], lit: 'rgba(255,255,255,1)', depth: 0.52 },
              { body: ['#9fbbd2', '#7f9db6'] as [string, string], lit: 'rgba(255,255,255,1)', depth: 0.55 },
            ],
            pines: '#86a6bd',
            pineSnow: 'rgba(255,255,255,0.92)',
          }

      const traceSmooth = (pts: Array<{ x: number; y: number }>) => {
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length - 1; i += 1) {
          const mx = (pts[i].x + pts[i + 1].x) / 2
          const my = (pts[i].y + pts[i + 1].y) / 2
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
      }

      /**
       * 一座雪岭：
       *   ① 山体：纵向渐变（脊线亮、山脚暗）；
       *   ② 积雪：把同一轮廓裁剪住，用一段自上而下渐隐的白，只在峰顶附近留下雪盖；
       *   ③ 再叠一层从左侧来的方向光，雪岭就有了体积。
       * 全程没有拼接多边形，所以岭脊永远干净、圆润。
       */
      const drawRange = (
        pts: Array<{ x: number; y: number }>,
        cfg: { body: [string, string]; lit: string; depth: number },
        baseY: number,
      ) => {
        const minY = Math.min(...pts.map((p2) => p2.y))
        const bodyGrad = ctx.createLinearGradient(0, minY, 0, baseY + h * 0.08)
        bodyGrad.addColorStop(0, cfg.body[0])
        bodyGrad.addColorStop(1, cfg.body[1])

        const path = () => {
          ctx.beginPath()
          ctx.moveTo(-20, h)
          traceSmooth(pts)
          ctx.lineTo(w + 20, h)
          ctx.closePath()
        }

        path()
        ctx.fillStyle = bodyGrad
        ctx.fill()

        ctx.save()
        path()
        ctx.clip()
        // 雪盖：峰顶最厚，往下 3 段山高内渐隐
        const snowBottom = minY + (baseY - minY) * 1.05
        const snowGrad = ctx.createLinearGradient(0, minY - h * 0.02, 0, snowBottom)
        snowGrad.addColorStop(0, cfg.lit)
        snowGrad.addColorStop(0.42, cfg.lit.replace(/[\d.]+\)$/, '0.55)'))
        snowGrad.addColorStop(0.78, cfg.lit.replace(/[\d.]+\)$/, '0.14)'))
        snowGrad.addColorStop(1, cfg.lit.replace(/[\d.]+\)$/, '0)'))
        ctx.fillStyle = snowGrad
        ctx.fillRect(0, 0, w, h)

        // 方向光：左亮右暗，给山体一点体积
        const dirLight = ctx.createLinearGradient(0, 0, w, h * 0.6)
        dirLight.addColorStop(0, dark ? 'rgba(196,224,250,0.1)' : 'rgba(255,255,255,0.5)')
        dirLight.addColorStop(0.55, 'rgba(255,255,255,0)')
        dirLight.addColorStop(1, dark ? 'rgba(4,10,20,0.24)' : 'rgba(90,124,152,0.16)')
        ctx.fillStyle = dirLight
        ctx.fillRect(0, 0, w, h)
        ctx.restore()

        // 脊线受光：极细的一道亮线
        ctx.save()
        ctx.lineCap = 'round'
        ctx.beginPath()
        traceSmooth(pts)
        ctx.strokeStyle = cfg.lit
        ctx.globalAlpha = dark ? 0.42 : 0.75
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      }

      const drawHaze = (y: number, band: number, alpha: number) => {
        const g = ctx.createLinearGradient(0, y - band, 0, y + band * 0.5)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.55, dark ? `rgba(176,206,234,${alpha})` : `rgba(255,255,255,${alpha * 0.9})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, y - band, w, band * 1.5)
      }

      const ranges = [
        makeRange(17, h * 0.17, horizon + 6, Math.max(4, Math.round(w / 300))),
        makeRange(53, h * 0.125, horizon + 24, Math.max(3, Math.round(w / 400))),
        makeRange(97, h * 0.075, horizon + 48, Math.max(2, Math.round(w / 520))),
      ]
      drawRange(ranges[0], tone.ranges[0], horizon + 6)
      drawHaze(horizon - h * 0.015, h * 0.06, dark ? 0.1 : 0.44)
      drawRange(ranges[1], tone.ranges[1], horizon + 24)
      drawHaze(horizon + h * 0.02, h * 0.045, dark ? 0.08 : 0.36)

      // 最近一道岭：先铺山体，再把落雪针叶林「种」在它的山脊线上
      drawRange(ranges[2], tone.ranges[2], horizon + 48)
      const ridgeAt = (x: number) => {
        const pts = ranges[2]
        const t = Math.min(1, Math.max(0, (x + 20) / (w + 40))) * (pts.length - 1)
        const i = Math.min(pts.length - 2, Math.floor(t))
        const f = t - i
        return pts[i].y + (pts[i + 1].y - pts[i].y) * f
      }
      /** 一棵落雪云杉：三段下垂的枝层，顶上盖一层雪 */
      const paintSpruce = (x: number, baseY: number, height: number, width: number, body: string, snow: string) => {
        ctx.fillStyle = body
        ctx.beginPath()
        const tiers = 3
        ctx.moveTo(x, baseY - height)
        for (let t = 0; t < tiers; t += 1) {
          const top = baseY - height + (height * 0.17) * t
          const bottom = baseY - height + height * (0.52 + t * 0.24)
          const spread = width * (0.34 + t * 0.33)
          ctx.lineTo(x + spread, bottom)
          ctx.quadraticCurveTo(x + spread * 0.34, bottom - height * 0.03, x + spread * 0.16, top + height * 0.06)
        }
        ctx.lineTo(x + width * 0.1, baseY)
        ctx.lineTo(x - width * 0.1, baseY)
        for (let t = tiers - 1; t >= 0; t -= 1) {
          const top = baseY - height + (height * 0.17) * t
          const bottom = baseY - height + height * (0.52 + t * 0.24)
          const spread = width * (0.34 + t * 0.33)
          ctx.lineTo(x - spread * 0.16, top + height * 0.06)
          ctx.quadraticCurveTo(x - spread * 0.34, bottom - height * 0.03, x - spread, bottom)
        }
        ctx.closePath()
        ctx.fill()

        // 积雪：每层枝梢上的一小片白，越往顶越厚
        ctx.fillStyle = snow
        for (let t = 0; t < tiers; t += 1) {
          const top = baseY - height + (height * 0.17) * t
          const spread = width * (0.3 + t * 0.3)
          const snowH = height * (0.13 - t * 0.02)
          ctx.beginPath()
          ctx.moveTo(x - spread * 0.94, top + height * (0.35 - t * 0.06))
          ctx.quadraticCurveTo(x - spread * 0.3, top + height * (0.2 - t * 0.04), x, top + snowH * 0.2)
          ctx.quadraticCurveTo(x + spread * 0.3, top + height * (0.2 - t * 0.04), x + spread * 0.94, top + height * (0.35 - t * 0.06))
          ctx.quadraticCurveTo(x, top + height * (0.34 - t * 0.05), x - spread * 0.94, top + height * (0.35 - t * 0.06))
          ctx.closePath()
          ctx.fill()
        }
      }

      // 成片云杉林：前后两排，后排高而淡、前排矮而实，沿岭脊自然聚成几簇
      const treeRng = seeded(211)
      const groveRng = seeded(463)
      const groves = Array.from({ length: Math.max(3, Math.round(w / 420)) }, () => ({
        center: groveRng() * w,
        span: (0.1 + groveRng() * 0.22) * w,
        strength: 0.55 + groveRng() * 0.45,
      }))
      const densityAt = (x: number) => {
        let value = 0.08
        for (const g of groves) {
          value = Math.max(value, g.strength * Math.max(0, 1 - Math.abs(x - g.center) / g.span))
        }
        return value
      }
      const rows: Array<{ count: number; minH: number; maxH: number; body: string; snow: string; offset: number }> = [
        {
          count: Math.round(w / 8),
          minH: 16,
          maxH: 52,
          body: dark ? 'rgba(20, 44, 64, 0.85)' : 'rgba(126, 156, 178, 0.6)',
          snow: dark ? 'rgba(188, 214, 238, 0.34)' : 'rgba(255, 255, 255, 0.78)',
          offset: 22,
        },
        {
          count: Math.round(w / 11),
          minH: 22,
          maxH: 70,
          body: dark ? '#0e2436' : '#6d8ea6',
          snow: dark ? 'rgba(214, 234, 252, 0.5)' : 'rgba(255, 255, 255, 0.92)',
          offset: 10,
        },
      ]
      for (const row of rows) {
        for (let i = 0; i < row.count; i += 1) {
          const tx = treeRng() * w
          if (treeRng() > densityAt(tx) * 1.25 + 0.12) continue
          const baseY = ridgeAt(tx) + (row.offset + treeRng() * 18) * scale
          const th = (row.minH + Math.pow(treeRng(), 1.3) * (row.maxH - row.minH)) * scale
          const tw = th * (0.26 + treeRng() * 0.12)
          paintSpruce(tx, baseY, th, tw, row.body, row.snow)
        }
      }
      // 林线脚下的一层雪雾，让树林与雪坡自然衔接
      const treeline = ctx.createLinearGradient(0, horizon + h * 0.03, 0, horizon + h * 0.12)
      treeline.addColorStop(0, dark ? 'rgba(120, 168, 200, 0)' : 'rgba(255, 255, 255, 0)')
      treeline.addColorStop(0.55, dark ? 'rgba(146, 190, 216, 0.14)' : 'rgba(255, 255, 255, 0.5)')
      treeline.addColorStop(1, dark ? 'rgba(120, 168, 200, 0)' : 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = treeline
      ctx.fillRect(0, horizon + h * 0.03, w, h * 0.09)

      drawHaze(horizon + h * 0.055, h * 0.05, dark ? 0.09 : 0.28)

      // 前景雪原：柔和起伏，压住正文下方的阅读区
      const field = ctx.createLinearGradient(0, h * 0.82, 0, h)
      if (dark) {
        field.addColorStop(0, '#2b5470')
        field.addColorStop(0.55, '#1d3d55')
        field.addColorStop(1, '#152f45')
      } else {
        field.addColorStop(0, '#f2f9fd')
        field.addColorStop(0.5, '#e2f0f9')
        field.addColorStop(1, '#cfe4f2')
      }
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w + 12; x += 12) {
        const t = x / w
        const drift = h * 0.055 * Math.sin(t * 5.1 + 0.7) + h * 0.02 * Math.sin(t * 11.3 + 2.1)
        ctx.lineTo(x, h * 0.845 + drift)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.fillStyle = field
      ctx.fill()

      // 雪面晶光：稀疏的高光点，绝不成片噪点
      const glint = seeded(877)
      for (let i = 0; i < 120; i += 1) {
        const gx = glint() * w
        const gy = h * 0.86 + Math.pow(glint(), 1.3) * h * 0.13
        const gr = 0.5 + glint() * 1.3
        ctx.fillStyle = dark ? `rgba(212,236,255,${(0.08 + glint() * 0.22).toFixed(3)})` : `rgba(255,255,255,${(0.24 + glint() * 0.5).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(gx, gy, gr, 0, TAU)
        ctx.fill()
      }

      const vignette = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.24, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.66)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, `rgba(0,0,0,${dark ? 0.42 : 0.05})`)
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, w, h)
    })
  }

  /** 极简四芒星：用于少数大雪晶的闪烁 */
  const makeSparkle = (color: string) =>
    paint(64, 64, (ctx) => {
      const drawBeam = (horizontal: boolean) => {
        const g = horizontal
          ? ctx.createLinearGradient(0, 32, 64, 32)
          : ctx.createLinearGradient(32, 0, 32, 64)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.5, color)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        if (horizontal) ctx.fillRect(0, 31, 64, 2)
        else ctx.fillRect(31, 0, 2, 64)
      }
      drawBeam(true)
      drawBeam(false)
    })

  return {
    fps: 60,
    setup(width, height) {
      w = width
      h = height
      build()
      flakes = []
      resize(flakes, Math.round((values.count ?? 55) * 3.1 * area(w, h)), spawn)
    },
    configure(next) {
      values = next
      resize(flakes, Math.round((values.count ?? 55) * 3.1 * area(w, h)), spawn)
    },
    setTone(next) {
      if (dark !== next) {
        dark = next
        build()
      }
    },
    step(dt) {
      const wind = (values.wind ?? 12) / 100
      const swirl = 6 + (values.swirl ?? 45) * 0.28
      for (const f of flakes) {
        f.phase += dt * (0.32 + f.z * 0.85)
        f.angle += f.spin * dt
        f.x += (wind * 88 * f.z + Math.sin(f.phase) * swirl * f.z) * dt
        f.y += (9 + (values.speed ?? 35) * 0.78) * (0.26 + f.z * 1.25) * dt
        if (f.x < -70) f.x = w + 60
        if (f.x > w + 70) f.x = -60
        if (f.y > h + 60) Object.assign(f, spawn(true))
      }
    },
    draw(ctx) {
      ctx.drawImage(background, 0, 0, w, h)
      const sizeScale = 0.5 + (values.size ?? 45) / 100
      ctx.save()
      // 远 → 近三层：先小雪晶，再主雪晶，最后柔焦近景
      for (let layer = 0; layer < 3; layer += 1) {
        for (const f of flakes) {
          const index = f.z > 0.82 ? 2 : f.z > 0.46 ? 0 : 1
          const order = index === 1 ? 0 : index === 0 ? 1 : 2
          if (order !== layer) continue
          const size = index === 2
            ? (10 + f.z * f.z * 34) * sizeScale
            : index === 0
              ? (4.4 + f.z * f.z * 20) * sizeScale
              : (2.4 + f.z * 6) * sizeScale
          ctx.save()
          ctx.translate(f.x, f.y)
          ctx.rotate(f.angle)
          ctx.globalAlpha = (dark ? 0.34 : 0.42) + f.z * 0.42
          ctx.drawImage(sprites[index] ?? sprites[0], -size / 2, -size / 2, size, size)
          ctx.restore()
        }
      }
      // 少数大晶的星芒闪烁
      if (sparkleSprite) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
        for (const f of flakes) {
          if (!f.sparkle || f.z < 0.6) continue
          const twinkle = 0.5 + 0.5 * Math.sin(f.phase * 1.4)
          const size = (8 + f.z * 16) * sizeScale * (0.7 + twinkle * 0.5)
          ctx.globalAlpha = (dark ? 0.5 : 0.4) * twinkle
          ctx.drawImage(sparkleSprite, f.x - size / 2, f.y - size / 2, size, size)
        }
        ctx.restore()
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
const rainVeilCache = new Map<boolean, HTMLCanvasElement>()

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
  let dropBokeh: HTMLCanvasElement
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
  /**
   * 云场：
   * fbm 只跑一遍、缓存成一张「密度 + 受光」的灰度贴图（60k 像素 × 5 个八度，
   * 是整次烘焙里最贵的一步）；深浅两套配色只差一层着色，因此按明暗各缓存一份最终贴图，
   * 换主题 / 重建背景时直接复用。
   */
  const cloudTexture = () => {
    const cached = rainCloudCache.get(dark)
    if (cached) return cached
    const cw = 384, ch = 168
    const maxCloud = dark ? 0.76 : 0.7
    const base = dark ? [5, 9, 16] : [80, 98, 114]
    const lit = dark ? [96, 126, 152] : [240, 247, 251]
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

  const spawn = (top = false): Drop => {
    const z = Math.pow(Math.random(), 1.35)
    return {
      x: rand(-w * 0.45, w * 1.15),
      y: top ? rand(-h * 0.3, -18) : rand(-80, h),
      z,
      size: rand(0.8, 1.28),
      drift: rand(0.85, 1.16),
      bright: rand(0, 1),
      phase: rand(0, TAU),
      bokeh: z > 0.72 && Math.random() < 0.26,
    }
  }

  /**
   * 契合人眼视觉暂留（~45ms）与 60fps 的舒缓自然雨滴速度（约 410–920 px/s，单帧位移 7–15px）：
   * 彻底低于人眼把运动颗粒拖成细直线的融合阈值，使每一滴水珠都呈现出清晰温润的液滴下落质感。
   */
  const dropVelocity = (speed: number, z: number) => (370 + speed * 5.6) * (0.56 + z * 0.68)

  const currentSlope = (d: Drop, atTime = time) => {
    const windBase = (values.wind ?? 25) / 100
    const gust = 1 + 0.14 * Math.sin(atTime * 0.37) + 0.07 * Math.sin(time * 0 + atTime * 0.91 + 1.4)
    return windBase * gust * 0.44 * d.drift + Math.sin(atTime * 1.35 + d.phase) * 0.015
  }

  /**
   * 预烘焙中空折射水滴贴图（40×84 / 40×92）：
   * 下部为圆润半球形液滴弯月面，上部收束为轻柔水汽短尾；内部通透半透明（透出背后山林与页面底色），
   * 边缘具菲涅尔微反光，底端带焦散月牙高光——呈现真正的液态水珠而非粉笔白线或雪点。
   */
  const makeWaterDropSprite = (
    sw: number,
    sh: number,
    rgbBody: [number, number, number],
    rgbRim: [number, number, number],
    sharpness: number,
  ) =>
    paint(sw, sh, (ctx) => {
      const image = ctx.createImageData(sw, sh)
      const data = image.data
      const cx = (sw - 1) * 0.5
      const bellyV = 0.72
      for (let py = 0; py < sh; py += 1) {
        const v = py / (sh - 1)
        const profile =
          v <= bellyV
            ? 0.14 + 0.86 * Math.pow(smooth01(0.02, bellyV, v), 0.78)
            : Math.sqrt(Math.max(0, 1 - Math.pow((v - bellyV) / 0.265, 2)))
        const halfW = profile * (sw * 0.44)
        if (halfW <= 0.25) continue
        const axial =
          Math.pow(smooth01(0.02, 0.46, v), sharpness) * (1 - smooth01(0.92, 0.995, v))
        for (let px = 0; px < sw; px += 1) {
          const u = (px - cx) / halfW
          const r2 = u * u
          if (r2 >= 1) continue
          const r = Math.sqrt(r2)
          const edgeFeather = 1 - smooth01(0.78, 1.0, r)
          const body = 0.34 * Math.pow(1 - r2, 0.85)
          const fresnelRim =
            0.44 * Math.exp(-Math.pow((r - 0.74) / 0.18, 2)) * smooth01(0.26, bellyV, v)
          const meniscusGlint =
            0.58 *
            Math.exp(-(Math.pow((u + 0.16) / 0.48, 2) + Math.pow((v - 0.8) / 0.115, 2)))
          const alpha = Math.min(1, (body + fresnelRim + meniscusGlint) * axial * edgeFeather)
          if (alpha <= 0.002) continue
          const specMix = Math.min(1, (fresnelRim * 0.8 + meniscusGlint * 1.25) / 0.65)
          const idx = (py * sw + px) * 4
          data[idx] = rgbBody[0] + (rgbRim[0] - rgbBody[0]) * specMix
          data[idx + 1] = rgbBody[1] + (rgbRim[1] - rgbBody[1]) * specMix
          data[idx + 2] = rgbBody[2] + (rgbRim[2] - rgbBody[2]) * specMix
          data[idx + 3] = Math.round(alpha * 255)
        }
      }
      ctx.putImageData(image, 0, 0)
    })

  /** 预烘焙近景浅景深散景水珠贴图（64×64）：中心通透、外缘柔焦菲涅尔光晕。 */
  const makeBokehDropSprite = (
    size: number,
    rgbBody: [number, number, number],
    rgbRim: [number, number, number],
  ) =>
    paint(size, size, (ctx) => {
      const image = ctx.createImageData(size, size)
      const data = image.data
      const c = (size - 1) * 0.5
      for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
          const ux = (px - c) / (size * 0.47)
          const uy = (py - c) / (size * 0.47)
          const r2 = ux * ux + uy * uy
          if (r2 >= 1) continue
          const r = Math.sqrt(r2)
          const body = 0.2 * Math.pow(1 - r2, 0.65)
          const ring = 0.36 * Math.exp(-Math.pow((r - 0.76) / 0.15, 2))
          const feather = 1 - smooth01(0.84, 1.0, r)
          const alpha = Math.min(1, (body + ring) * feather)
          const mix = Math.min(1, ring / 0.36)
          const idx = (py * size + px) * 4
          data[idx] = rgbBody[0] + (rgbRim[0] - rgbBody[0]) * mix
          data[idx + 1] = rgbBody[1] + (rgbRim[1] - rgbBody[1]) * mix
          data[idx + 2] = rgbBody[2] + (rgbRim[2] - rgbBody[2]) * mix
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
          // 阴雨白昼的林线要比水色更深，才能读成「长满树的山」而不是一层薄雾
          ridge: ['#9db4bf', '#87a2ae', '#6f8c98'],
          forest: ['#7f99a4', '#6a8791', '#53717b'],
          forestDeep: '#3e5b64',
          reed: '#34525b',
          shore: '#2c4952',
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
      // 必须先定好填充色再攒路径：否则前 70 棵树会沿用上一层（雾带渐变）留下的 fillStyle，
      // 在林线上留下一排发白的「雾团」。
      ctx.fillStyle = cfg.color
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
          ctx.fill()
          ctx.beginPath()
        }
        x += cfg.spacing * (0.5 + r() * 0.95)
      }
      // 收尾：把最后不足 70 棵攒下的路径一并填掉，避免残留到下一层绘制里
      ctx.fill()
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
      haze.addColorStop(1, `rgba(${tone.haze},${dark ? 0.2 : 0.34})`)
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
    // 倒影的纵向渐隐烘焙进贴图本身（贴岸最实、越远越淡）。
    // 以前是分 7 个横带各用一个 globalAlpha 贴回去，带与带的透明度不同，
    // 放大对比度就能看到 6 条横贯水面的接缝；现在整张只贴一次渐隐，接缝不存在。
    mirror = paint(w, landH, (c) => {
      c.drawImage(mirror, 0, 0)
      c.globalCompositeOperation = 'destination-in'
      const fade = c.createLinearGradient(0, 0, 0, landH)
      fade.addColorStop(0, 'rgba(0,0,0,0.95)')
      fade.addColorStop(0.18, 'rgba(0,0,0,0.86)')
      fade.addColorStop(0.55, 'rgba(0,0,0,0.6)')
      fade.addColorStop(0.82, 'rgba(0,0,0,0.34)')
      fade.addColorStop(1, 'rgba(0,0,0,0.16)')
      c.fillStyle = fade
      c.fillRect(0, 0, w, landH)
    })

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
        ctx.fillStyle = 'rgba(238,243,246,0.07)'
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
      40,
      84,
      dark ? [136, 178, 210] : [132, 158, 178],
      dark ? [216, 240, 255] : [250, 253, 255],
      1.35,
    )
    dropCrisp = makeWaterDropSprite(
      40,
      92,
      dark ? [158, 198, 228] : [120, 148, 170],
      dark ? [242, 251, 255] : [255, 255, 255],
      1.1,
    )
    dropBokeh = makeBokehDropSprite(
      64,
      dark ? [142, 184, 214] : [168, 192, 208],
      dark ? [224, 244, 255] : [252, 254, 255],
    )
    const cachedVeil = rainVeilCache.get(dark)
    rainVeil = cachedVeil ?? soften(
      paint(256, 256, (ctx) => {
        const image = ctx.createImageData(256, 256)
        const data = image.data
        const veilRgb = dark ? [150, 188, 218] : [226, 238, 247]
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
    if (!cachedVeil) rainVeilCache.set(dark, rainVeil)
  }

  return {
    fps: 60,
    setup(width, height) {
      w = width
      h = height
      build()
      drops = []
      ripples = []
      resize(drops, Math.round((values.count ?? 70) * 3.8 * area(w, h)), spawn)
    },
    configure(next) {
      values = next
      resize(drops, Math.round((values.count ?? 70) * 3.8 * area(w, h)), spawn)
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

      /*
       * 倒影：整张镜像只贴一次（纵向渐隐已经烘焙在贴图里，所以没有分带接缝），
       * 再叠 9 条横向错位的窄光带——水面会「晃」，但不会出现一圈圈横线。
       */
      ctx.save()
      ctx.globalAlpha = dark ? 0.74 : 0.62
      ctx.drawImage(mirror, 0, horizon, w, mirror.height * 0.88)
      ctx.globalAlpha = dark ? 0.2 : 0.16
      for (let i = 0; i < 9; i += 1) {
        const v = (i + 0.5) / 9
        const drift =
          Math.sin(time * 0.5 + i * 0.9) * (1.4 + v * 6) +
          Math.sin(time * 0.21 + i * 1.7) * 2.2
        const bandH = mirror.height * 0.88 * 0.16
        ctx.drawImage(
          mirror,
          0,
          v * mirror.height - mirror.height * 0.06,
          mirror.width,
          mirror.height * 0.12,
          drift,
          horizon + v * mirror.height * 0.88 - bandH * 0.5,
          w,
          bandH,
        )
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

      /* 自然光学液滴：通透梨形水珠 + 浅景深散景水珠 + 中央阅读净空区 */
      const halfW = Math.max(1, w * 0.5)
      // 中央正文列（约 820px 宽）深度降噪，两侧天空与山湖保留完整烟雨层次
      const readingEdgeInner = Math.min(0.42, 350 / halfW)
      const readingEdgeOuter = Math.min(0.84, 575 / halfW)
      ctx.save()
      ctx.imageSmoothingEnabled = true
      for (const d of drops) {
        const slope = currentSlope(d, time)
        const normX = Math.abs(d.x - halfW) / halfW
        const outsideReading = smooth01(readingEdgeInner, readingEdgeOuter, normX)
        const baseAlpha = dark
          ? (0.15 + d.z * 0.22) * (0.62 + d.bright * 0.48)
          : (0.17 + d.z * 0.24) * (0.62 + d.bright * 0.46)
        let sprite: HTMLCanvasElement
        let dropW: number
        let dropH: number
        if (d.bokeh) {
          sprite = dropBokeh
          dropW = (6.8 + d.z * 5.8) * d.size
          dropH = dropW * 1.18
          ctx.globalAlpha = baseAlpha * 0.3 * (0.08 + 0.92 * outsideReading)
        } else {
          // 真实水珠长宽比仅 1:2.1–1:3.1（宽 2.6–6.2px，长 6.2–18px），圆润晶莹，绝不拉成细硬直线
          sprite = d.z > 0.56 && d.bright > 0.45 ? dropCrisp : dropSoft
          dropW = (3.0 + d.z * 2.5) * d.size
          dropH = dropW * (2.05 + d.z * 1.05) + dropVelocity(speed, d.z) * 0.0022
          ctx.globalAlpha = baseAlpha * (0.18 + 0.82 * outsideReading)
        }
        ctx.save()
        ctx.translate(d.x, d.y)
        ctx.rotate(-Math.atan(slope))
        ctx.drawImage(sprite, -dropW * 0.5, -dropH, dropW, dropH)
        ctx.restore()
      }
      ctx.restore()

      /* 涟漪：外圈 + 内圈 + 落下瞬间溅起的晶莹小水珠 */
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
        if (t < 0.16) {
          const crown = 1 - t / 0.16
          const beadR = (1.6 + r.depth * 1.9) * crown
          const lift = (1.8 + r.depth * 3.8) * Math.sin(Math.PI * (1 - crown * 0.65))
          ctx.globalAlpha = crown * (dark ? 0.42 : 0.58)
          ctx.drawImage(dropBokeh, r.x - beadR, r.y - lift - beadR, beadR * 2, beadR * 2)
          ctx.globalAlpha = 1
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

/**
 * 竹林（晨光青竹 · 幽绿月夜）：
 *
 * 之前每一根竹竿都是一张几乎一样的贴图，满屏复制出「壁纸感」。
 * 现在分成四层：
 *   ① 远景：雾中的竹影剪影（细、淡、冷），只提供纵深；
 *   ② 中景：成竹带竹节与分枝，叶簇沿竹节自然下垂；
 *   ③ 光：斜射的光束与林间浮尘，随呼吸缓慢明灭；
 *   ④ 近景：边缘两丛虚焦竹叶 + 飘落的竹叶。
 * 竹竿贴图按「深度 + 变体」预烘焙，同类竹竿共用一张，逐帧只做旋转贴图。
 */
export function createBamboo(initialDark: boolean): Renderer {
  interface Stem { x: number; depth: number; phase: number; lean: number; speed: number; sprite: number; scale: number }
  interface FallingLeaf { x: number; y: number; vx: number; vy: number; phase: number; angle: number; spin: number; size: number; alpha: number }

  let w = 1, h = 1, dark = initialDark, time = 0
  let values: SceneValues = {}
  let stems: Stem[] = []
  let leaves: FallingLeaf[] = []
  let background: HTMLCanvasElement = paint(1, 1, () => {})
  let foreground: HTMLCanvasElement = paint(1, 1, () => {})
  let mistTex: HTMLCanvasElement = paint(1, 1, () => {})
  let shaftTex: HTMLCanvasElement = paint(1, 1, () => {})
  let stemSprites: HTMLCanvasElement[] = []

  /** 把颜色往背景色方向混一部分，做空气透视（远竹退到雾里） */
  const fadeHex = (hex: string, target: [number, number, number], amount: number) => {
    const value = hex.replace('#', '')
    const rgb = [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ]
    const mixed = rgb.map((c, i) => Math.round(c + (target[i] - c) * amount))
    return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`
  }

  const palette = () =>
    dark
      ? {
          seed: 9,
          far: 'rgba(96, 140, 116, 0.3)',
          stem: ['#16352c', '#2c5847', '#3f7057'] as [string, string, string],
          node: 'rgba(150, 196, 160, 0.3)',
          leafDark: '#1c4034',
          leafLight: '#3f6f52',
          leafEdge: 'rgba(178, 220, 186, 0.45)',
          mist: 'rgba(150, 196, 172,',
          shaft: 'rgba(196, 236, 208,',
          glow: 'rgba(150, 210, 178,',
        }
      : {
          seed: 3,
          far: 'rgba(150, 178, 132, 0.34)',
          stem: ['#8fae76', '#6d9459', '#a9c78c'] as [string, string, string],
          node: 'rgba(244, 250, 214, 0.55)',
          leafDark: '#5c8348',
          leafLight: '#8fb268',
          leafEdge: 'rgba(255, 255, 224, 0.55)',
          mist: 'rgba(250, 252, 232,',
          shaft: 'rgba(255, 252, 216,',
          glow: 'rgba(255, 250, 208,',
        }

  /** 一片竹叶：从叶柄处起笔的柳叶刀形，带主脉与尖端高光 */
  const paintLeaf = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    length: number,
    width: number,
    angle: number,
    fill: string,
    edge: string,
  ) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(length * 0.36, -width * 0.95, length * 0.72, -width * 0.3)
    ctx.quadraticCurveTo(length * 1.02, -width * 0.12, length, 0)
    ctx.quadraticCurveTo(length * 0.98, width * 0.1, length * 0.7, width * 0.3)
    ctx.quadraticCurveTo(length * 0.34, width * 0.8, 0, 0)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(length * 0.6, -width * 0.08, length * 0.98, 0)
    ctx.stroke()
    ctx.restore()
  }

  /** 一簇下垂的竹叶：3–6 片，长短不一，向下俯垂 */
  const paintLeafCluster = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    angle: number,
    rng: () => number,
    fill: string,
    edge: string,
    lightFill: string,
  ) => {
    const count = 3 + Math.floor(rng() * 4)
    for (let i = 0; i < count; i += 1) {
      const spread = (rng() - 0.5) * 1.15
      const droop = 0.28 + rng() * 0.55
      paintLeaf(
        ctx,
        x + (rng() - 0.5) * size * 0.35,
        y + (rng() - 0.5) * size * 0.22,
        size * (0.72 + rng() * 0.6),
        size * (0.14 + rng() * 0.07),
        angle + spread + droop,
        i % 3 === 0 ? lightFill : fill,
        edge,
      )
    }
  }

  /** 预烘焙竹竿：纵向竹青渐变、竹节环、上部两三层下垂叶簇 */
  const buildStemSprite = (variant: number, depth: number) => {
    const c = palette()
    const width = Math.round(150 + depth * 90)
    const height = Math.round(h + 140)
    const thick = (3.4 + depth * 15) * (0.82 + ((variant * 37) % 10) / 26)
    const centerX = width / 2
    return paint(width, height, (ctx) => {
      const rng = seeded(c.seed * 97 + variant * 131 + Math.round(depth * 10))
      // 空气透视：越远的竹竿越接近林间雾色，颜色更淡、更冷
      const haze: [number, number, number] = dark ? [46, 84, 72] : [226, 238, 208]
      const air = Math.pow(1 - depth, 1.5) * 0.42
      const stemShades = c.stem.map((hex) => fadeHex(hex, haze, air)) as [string, string, string]
      const leafTone = fadeHex(c.leafDark, haze, air * 0.8)
      const leafHighlight = fadeHex(c.leafLight, haze, air * 0.8)
      const grad = ctx.createLinearGradient(centerX - thick, 0, centerX + thick, 0)
      grad.addColorStop(0, stemShades[1])
      grad.addColorStop(0.28, stemShades[2])
      grad.addColorStop(0.55, stemShades[0])
      grad.addColorStop(1, stemShades[1])
      ctx.fillStyle = grad
      ctx.fillRect(centerX - thick / 2, -10, thick, height + 20)

      // 竹节：每 100–150px 一道，节上有一圈亮边
      const segment = 84 + rng() * 52
      for (let y = 40 + rng() * segment; y < height; y += segment) {
        ctx.fillStyle = dark ? 'rgba(6, 20, 16, 0.42)' : 'rgba(58, 88, 46, 0.26)'
        ctx.fillRect(centerX - thick / 2 - 0.6, y, thick + 1.2, Math.max(1.6, thick * 0.13))
        ctx.fillStyle = c.node
        ctx.fillRect(centerX - thick / 2 - 0.4, y - 1.8, thick + 0.8, 1.3)

        // 节上分枝 + 叶簇：越往上越密，底部只留秃竿
        if (y < height * 0.86 && rng() < 0.92) {
          const side = rng() < 0.5 ? -1 : 1
          const branchLen = (30 + rng() * 52) * (depth * 0.7 + 0.6)
          const tipX = centerX + side * branchLen
          const tipY = y - (10 + rng() * 26)
          ctx.strokeStyle = stemShades[1]
          ctx.lineWidth = Math.max(0.9, thick * 0.14)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(centerX, y)
          ctx.quadraticCurveTo(centerX + side * branchLen * 0.55, y - branchLen * 0.42, tipX, tipY)
          ctx.stroke()
          const clusterSize = (16 + rng() * 20) * (0.6 + depth * 0.8)
          paintLeafCluster(
            ctx,
            tipX,
            tipY,
            clusterSize,
            side > 0 ? -0.15 : Math.PI - 0.35,
            rng,
            leafTone,
            c.leafEdge,
            leafHighlight,
          )
          if (rng() < 0.55) {
            paintLeafCluster(
              ctx,
              centerX + side * branchLen * 0.45,
              y - branchLen * 0.16,
              clusterSize * 0.8,
              side > 0 ? 0.35 : Math.PI - 0.6,
              rng,
              leafTone,
              c.leafEdge,
              leafHighlight,
            )
          }
        }
      }

      // 顶部叶冠：点在画面外的竹梢
      paintLeafCluster(ctx, centerX, 18, 30 * (0.7 + depth * 0.7), -0.4, rng, leafTone, c.leafEdge, leafHighlight)
      paintLeafCluster(ctx, centerX, 44, 24 * (0.7 + depth * 0.7), 2.6, rng, leafTone, c.leafEdge, leafHighlight)
      paintLeafCluster(ctx, centerX, 72, 20 * (0.7 + depth * 0.7), 1.1, rng, leafTone, c.leafEdge, leafHighlight)
    })
  }

  const spawnLeaf = (top = false): FallingLeaf => ({
    x: rand(-40, w + 40),
    y: top ? rand(-60, -10) : rand(0, h),
    vx: rand(-14, 20),
    vy: rand(12, 34),
    phase: rand(0, TAU),
    angle: rand(0, TAU),
    spin: rand(-0.5, 0.5),
    size: rand(7, 15),
    alpha: rand(0.3, 0.72),
  })

  const rebuildStems = () => {
    const c = palette()
    const factor = Math.max(0.7, Math.min(1.55, w / 1440))
    const count = Math.round((5 + (values.density ?? 55) * 0.16) * factor)
    resize(stems, count, () => ({
      x: Math.random(),
      depth: Math.pow(Math.random(), 0.85) * 0.9 + 0.1,
      phase: rand(0, TAU),
      lean: rand(-0.05, 0.05),
      speed: rand(0.55, 1.15),
      sprite: 0,
      scale: 0.8 + Math.random() * 0.35,
    }))
    stems.sort((a, b) => a.depth - b.depth)
    stemSprites = []
    const variants = 4
    for (let i = 0; i < stems.length; i += 1) {
      const depth = stems[i].depth
      const variant = i % variants
      // 每根竹竿单独烘焙太贵：按「深度档 × 变体」共享贴图
      const bucket = Math.round(depth * 6)
      stems[i].sprite = bucket * variants + variant
      const key = stems[i].sprite
      if (!stemSprites[key]) stemSprites[key] = buildStemSprite(variant, bucket / 6)
    }
    // 远景竹影：贴在背景上的细竹剪影
    void c
  }

  const build = () => {
    const c = palette()
    const horizon = h * 0.92
    background = paint(w, h, (ctx) => {
      const skyGrad = ctx.createLinearGradient(w * 0.15, 0, w * 0.7, h)
      if (dark) {
        skyGrad.addColorStop(0, '#061414')
        skyGrad.addColorStop(0.42, '#0b2320')
        skyGrad.addColorStop(0.78, '#123029')
        skyGrad.addColorStop(1, '#173b30')
      } else {
        skyGrad.addColorStop(0, '#f4f8e6')
        skyGrad.addColorStop(0.42, '#eaf3da')
        skyGrad.addColorStop(0.76, '#dcecd0')
        skyGrad.addColorStop(1, '#cfe4c6')
      }
      ctx.fillStyle = skyGrad
      ctx.fillRect(0, 0, w, h)

      // 晨光 / 月光柔晕
      const glowX = w * 0.66
      const glowY = dark ? h * 0.18 : h * 0.24
      const glowR = Math.max(w, h) * (dark ? 0.5 : 0.62)
      const sun = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowR)
      sun.addColorStop(0, dark ? 'rgba(178, 226, 196, 0.2)' : 'rgba(255, 252, 214, 0.92)')
      sun.addColorStop(0.28, dark ? 'rgba(140, 196, 170, 0.08)' : 'rgba(255, 250, 208, 0.42)')
      sun.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = sun
      ctx.fillRect(0, 0, w, h)

      // 远景竹影：三层，越远越淡越细，形成真正的纵深；
      // 单独画在一张临时画布上再叠进来，用横向渐隐把中央阅读走廊让出来。
      const shadowLayer = paint(w, h, (sc) => {
        for (let layer = 0; layer < 3; layer += 1) {
          const rng = seeded(41 + layer * 17)
          const alpha = (dark ? 0.3 : 0.26) * (1 - layer * 0.26)
          sc.strokeStyle = c.far.replace(/[\d.]+\)$/, `${alpha.toFixed(3)})`)
          const spacing = w / (14 + layer * 5)
          for (let x = -spacing; x < w + spacing; x += spacing * (0.55 + rng() * 0.9)) {
            const sway = Math.sin(x * 0.004 + layer) * w * 0.014
            sc.lineWidth = (1.1 + layer * 0.9) * (0.7 + rng() * 0.7)
            sc.beginPath()
            sc.moveTo(x, h + 10)
            sc.quadraticCurveTo(x + sway * 0.4, h * 0.5, x + sway, -10)
            sc.stroke()
            // 竹梢的几簇虚影叶
            if (rng() < 0.7) {
              paintLeafCluster(
                sc,
                x + sway * 0.86 + (rng() - 0.5) * 26,
                h * (0.02 + rng() * 0.16),
                (16 + rng() * 16) * (0.7 + layer * 0.35),
                1.2 + rng() * 1.1,
                rng,
                c.far.replace(/[\d.]+\)$/, `${(alpha * 1.15).toFixed(3)})`),
                'rgba(0,0,0,0)',
                c.far.replace(/[\d.]+\)$/, `${(alpha * 1.4).toFixed(3)})`),
              )
            }
          }
        }
      })
      // 横向渐隐：中央留白给正文，两侧让竹林占满
      const shadowMask = paint(w, h, (mc) => {
        mc.drawImage(shadowLayer, 0, 0, w, h)
        mc.globalCompositeOperation = 'destination-in'
        const horizontal = mc.createLinearGradient(0, 0, w, 0)
        horizontal.addColorStop(0, 'rgba(0,0,0,1)')
        horizontal.addColorStop(0.22, 'rgba(0,0,0,0.92)')
        horizontal.addColorStop(0.5, 'rgba(0,0,0,0.2)')
        horizontal.addColorStop(0.78, 'rgba(0,0,0,0.92)')
        horizontal.addColorStop(1, 'rgba(0,0,0,1)')
        mc.fillStyle = horizontal
        mc.fillRect(0, 0, w, h)
      })
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(shadowMask, 0, 0, w, h)
      ctx.restore()

      // 林间地面薄雾
      const ground = ctx.createLinearGradient(0, horizon - h * 0.24, 0, h)
      ground.addColorStop(0, 'rgba(255,255,255,0)')
      ground.addColorStop(0.55, dark ? 'rgba(150, 196, 172, 0.1)' : 'rgba(255, 255, 244, 0.55)')
      ground.addColorStop(1, dark ? 'rgba(120, 168, 148, 0.16)' : 'rgba(252, 253, 236, 0.72)')
      ctx.fillStyle = ground
      ctx.fillRect(0, horizon - h * 0.24, w, h - horizon + h * 0.24)

      // 烘焙在背景里的柔焦竹叶剪影（压住两侧顶部，框住画面）
      const frameRng = seeded(613)
      for (const [cx, cy, flip] of [
        [w * 0.06, h * 0.1, 1],
        [w * 0.16, h * 0.04, 1],
        [w * 0.94, h * 0.08, -1],
        [w * 0.84, h * 0.03, -1],
      ] as Array<[number, number, number]>) {
        for (let i = 0; i < 3; i += 1) {
          ctx.save()
          ctx.globalAlpha = dark ? 0.5 : 0.42
          paintLeafCluster(
            ctx,
            cx + (frameRng() - 0.5) * 90,
            cy + (frameRng() - 0.5) * 60,
            (24 + frameRng() * 26),
            flip > 0 ? 2.2 + frameRng() * 0.5 : -0.6 + frameRng() * 0.5,
            frameRng,
            c.leafDark,
            c.leafEdge,
            c.leafLight,
          )
          ctx.restore()
        }
      }

      const vignette = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.26, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.68)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, `rgba(0,0,0,${dark ? 0.44 : 0.06})`)
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, w, h)
    })

    // 雾团贴图：横向无缝（x、x±贴图宽各画一遍），四周羽化
    mistTex = paint(360, 180, (ctx) => {
      const rng = seeded(719)
      for (let i = 0; i < 46; i += 1) {
        const cx = rng() * 360
        const cy = rng() * 180
        const r = 18 + rng() * 62
        const a = 0.05 + rng() * 0.1
        for (const ox of [-360, 0, 360]) {
          const g = ctx.createRadialGradient(cx + ox, cy, 0, cx + ox, cy, r)
          g.addColorStop(0, `${c.mist}${(dark ? a : a * 1.6).toFixed(3)})`)
          g.addColorStop(1, `${c.mist}0)`)
          ctx.fillStyle = g
          ctx.fillRect(cx + ox - r, cy - r * 0.7, r * 2, r * 1.4)
        }
      }
    })

    // 光束贴图：中心亮、两侧渐隐，纵向从上到下淡出
    shaftTex = paint(160, 512, (ctx) => {
      const gx = ctx.createLinearGradient(0, 0, 160, 0)
      gx.addColorStop(0, `${c.shaft}0)`)
      gx.addColorStop(0.5, `${c.shaft}0.6)`)
      gx.addColorStop(1, `${c.shaft}0)`)
      ctx.fillStyle = gx
      ctx.fillRect(0, 0, 160, 512)
      ctx.globalCompositeOperation = 'destination-in'
      const gy = ctx.createLinearGradient(0, 0, 0, 512)
      gy.addColorStop(0, 'rgba(0,0,0,0.85)')
      gy.addColorStop(0.5, 'rgba(0,0,0,0.34)')
      gy.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = gy
      ctx.fillRect(0, 0, 160, 512)
    })

    // 近景虚焦竹叶：左右两侧各一丛，虚化后压在画面最前面
    const fg = paint(w, h, (ctx) => {
      const rng = seeded(907)
      for (const [cx, cy, flip] of [[-w * 0.01, h * 0.73, 1], [w * 1.01, h * 0.8, -1], [w * 0.07, h * 1.0, 1]] as Array<[number, number, number]>) {
        for (let i = 0; i < 4; i += 1) {
          paintLeafCluster(
            ctx,
            cx + (rng() - 0.5) * 120,
            cy + (rng() - 0.5) * 140,
            52 + rng() * 40,
            flip > 0 ? -0.9 + rng() * 0.9 : Math.PI - 0.9 + rng() * 0.9,
            rng,
            dark ? 'rgba(10, 26, 20, 0.85)' : 'rgba(74, 106, 58, 0.6)',
            dark ? 'rgba(120, 170, 140, 0.3)' : 'rgba(255, 255, 226, 0.34)',
            dark ? 'rgba(26, 54, 42, 0.9)' : 'rgba(106, 138, 78, 0.7)',
          )
        }
      }
    })
    foreground = paint(w, h, (ctx) => {
      // 缩小再放大做廉价柔焦
      const factor = 5
      const small = paint(w / factor, h / factor, (c2) => {
        c2.imageSmoothingEnabled = true
        c2.drawImage(fg, 0, 0, w / factor, h / factor)
      })
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, w, h)
    })

    rebuildStems()
    resize(leaves, Math.round(14 * Math.max(0.7, Math.min(1.6, w / 1440))), () => spawnLeaf())
  }

  return {
    fps: 24,
    setup(width, height) {
      w = width
      h = height
      leaves = []
      build()
    },
    configure(next) {
      const previous = values.density
      values = next
      if (previous !== next.density) rebuildStems()
    },
    setTone(next) {
      if (next !== dark) {
        dark = next
        build()
      }
    },
    step(dt) {
      const speed = values.speed ?? 35
      time += dt * (0.16 + speed / 100)
      const wind = (values.wind ?? 40) / 100
      for (const leaf of leaves) {
        leaf.phase += dt * (0.6 + speed / 90)
        leaf.angle += leaf.spin * dt
        leaf.x += (leaf.vx + wind * 46 * Math.sin(leaf.phase * 0.8)) * dt
        leaf.y += leaf.vy * dt
        if (leaf.y > h + 30 || leaf.x > w + 40 || leaf.x < -40) Object.assign(leaf, spawnLeaf(true))
      }
    },
    draw(ctx) {
      ctx.drawImage(background, 0, 0, w, h)

      // 光束：随时间轻微明灭、横向漂移
      const lightAmount = (values.light ?? 45) / 100
      if (lightAmount > 0.03) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'lighter' : 'screen'
        for (let i = 0; i < 4; i += 1) {
          const breathe = 0.55 + 0.45 * Math.sin(time * 0.34 + i * 1.6)
          const x = w * (0.34 + i * 0.17) + Math.sin(time * 0.22 + i) * w * 0.02
          ctx.globalAlpha = lightAmount * (dark ? 0.1 : 0.24) * breathe
          ctx.save()
          ctx.translate(x, -h * 0.05)
          ctx.rotate(-0.22)
          ctx.drawImage(shaftTex, -w * 0.09, 0, w * 0.18, h * 1.15)
          ctx.restore()
        }
        ctx.restore()
      }

      // 竹竿：由远及近，随风摆动（绕根部旋转，顶部摆幅最大）
      const wind = (values.wind ?? 40) / 100
      for (const stem of stems) {
        const sprite = stemSprites[stem.sprite]
        if (!sprite) continue
        const sway = Math.sin(time * stem.speed + stem.phase) * 0.02 * (0.35 + wind * 1.65)
        const sway2 = Math.sin(time * stem.speed * 0.47 + stem.phase * 1.7) * 0.008 * (0.4 + wind)
        ctx.save()
        ctx.translate(stem.x * (w + 160) - 80, h + 46)
        ctx.rotate(stem.lean + sway + sway2)
        ctx.globalAlpha = 0.42 + stem.depth * 0.56
        const drawW = sprite.width * stem.scale
        const drawH = sprite.height * stem.scale
        ctx.drawImage(sprite, -drawW / 2, -drawH + 20, drawW, drawH)
        ctx.restore()
      }

      // 林间薄雾：两层反向缓慢横移
      const mistAmount = (values.mist ?? 45) / 100
      if (mistAmount > 0.02) {
        ctx.save()
        ctx.globalCompositeOperation = dark ? 'screen' : 'source-over'
        for (let i = 0; i < 2; i += 1) {
          const drift = ((time * (0.012 + i * 0.006) + i * 0.4) % 1) * (w + 400) - 200
          ctx.globalAlpha = mistAmount * (dark ? 0.34 : 0.54) * (1 - i * 0.3)
          ctx.drawImage(mistTex, drift - 200, h * (0.52 + i * 0.16), w * 0.9, h * (0.3 + i * 0.08))
        }
        ctx.restore()
      }

      // 飘落的竹叶
      ctx.save()
      for (const leaf of leaves) {
        const swayAngle = leaf.angle + Math.sin(leaf.phase) * 0.5
        paintLeaf(ctx, leaf.x, leaf.y, leaf.size, leaf.size * 0.16, swayAngle, dark ? 'rgba(96, 148, 118, 0.7)' : 'rgba(112, 148, 82, 0.75)', dark ? 'rgba(178, 220, 186, 0.28)' : 'rgba(255, 255, 226, 0.34)')
      }
      ctx.restore()

      // 近景虚焦竹叶
      ctx.save()
      ctx.globalAlpha = dark ? 0.82 : 0.66
      ctx.drawImage(foreground, 0, 0, w, h)
      ctx.restore()
    },
  }
}
