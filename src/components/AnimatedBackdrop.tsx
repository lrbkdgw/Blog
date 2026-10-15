import { useEffect, useRef } from 'react'
import type { ActiveSceneId, SceneValues } from '../lib/animatedBackground'

/**
 * 全屏动态背景（雨夜 / 阳光 / 星空）。
 *
 * 性能策略：
 *   - 单个 canvas，像素比上限 1.5，避免高分屏上的过度绘制；
 *   - 背景渐变预先绘制到离屏 canvas，每帧只做一次图像拷贝；
 *   - 粒子数量按屏幕面积缩放，并设定上限；
 *   - 星星与尘埃使用预渲染的光晕贴图（drawImage），避免每帧创建渐变；
 *   - 帧率按场景限制（雨 60fps，阳光/星空 30fps）；
 *   - 标签页隐藏时暂停动画；
 *   - 系统开启“减少动态效果”时只绘制一帧静态画面。
 *
 * 画面：canvas 固定铺满视口，位于内容下方（由 Layout 放在 -z-10 的装饰层中）。
 */

interface Renderer {
  fps: number
  /** 按新的视口尺寸重建背景与粒子 */
  setup(width: number, height: number): void
  /** 调整参数；粒子数量变化时增减粒子，不重新随机已有粒子 */
  configure(values: SceneValues): void
  step(dt: number): void
  draw(ctx: CanvasRenderingContext2D): void
}

/* ------------------------------ 通用工具 ------------------------------ */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rand = (min: number, max: number) => min + Math.random() * (max - min)

/** 粒子数量随屏幕面积缩放（相对 1440×900），限制在 0.5–2.2 倍之间 */
function areaFactor(width: number, height: number) {
  return clamp((width * height) / (1440 * 900), 0.5, 2.2)
}

/** 调整粒子数组长度；新粒子由 make 创建 */
function resizeList<T>(list: T[], target: number, make: () => T) {
  if (list.length > target) list.length = target
  while (list.length < target) list.push(make())
}

/** 预渲染的径向光晕贴图（一次性创建，之后用 drawImage 复用） */
function makeGlowSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`)
    gradient.addColorStop(0.3, `rgba(${r},${g},${b},0.4)`)
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
  }
  return canvas
}

/** 把背景绘制到离屏 canvas，之后每帧直接贴图 */
function paintBackground(width: number, height: number, painter: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (ctx) painter(ctx)
  return canvas
}

/* -------------------------------- 雨夜 -------------------------------- */

function createRain(): Renderer {
  interface Drop {
    x: number
    y: number
    len: number
    speed: number
    near: boolean
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let drops: Drop[] = []
  let target = 0
  let speed = 55
  let wind = 12
  // 注意：speed/wind/density 等参数由 configure 设置，见下方
  let lightning = 20
  let flash = 0
  let nextFlash = Infinity

  const spawn = (): Drop => {
    const near = Math.random() < 0.35
    return {
      x: rand(-60, width + 60),
      y: rand(-height, height),
      len: near ? rand(16, 30) : rand(8, 16),
      speed: near ? rand(0.9, 1.1) : rand(0.55, 0.7),
      near,
    }
  }

  const scheduleFlash = () => {
    if (lightning <= 0) {
      nextFlash = Infinity
      return
    }
    // 平均间隔约 4–30 秒，雷电越强越频繁
    const base = 4 + (1 - lightning / 100) * 26
    nextFlash = base * rand(0.5, 1.5)
  }

  return {
    fps: 60,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#060a16')
        sky.addColorStop(0.6, '#0c1426')
        sky.addColorStop(1, '#131d33')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        // 远处城市的雾光：底部一圈淡蓝色
        const mist = ctx.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, Math.max(w, h) * 0.7)
        mist.addColorStop(0, 'rgba(70,95,150,0.35)')
        mist.addColorStop(1, 'rgba(70,95,150,0)')
        ctx.fillStyle = mist
        ctx.fillRect(0, 0, w, h)
      })
    },
    configure(values) {
      speed = values.speed ?? speed
      wind = values.wind ?? wind
      const density = values.density ?? 55
      target = Math.round((density / 100) * 900 * areaFactor(width, height))
      const nextLightning = values.lightning ?? lightning
      // 雷电参数变化，或尚未安排过闪电时，重新安排下一次闪电
      if (nextLightning !== lightning || nextFlash === Infinity) {
        lightning = nextLightning
        scheduleFlash()
      }
      resizeList(drops, target, spawn)
    },
    step(dt) {
      const fall = (260 + speed * 5.6) * dt
      const drift = (wind / 100) * 220 * dt
      for (const drop of drops) {
        drop.y += fall * drop.speed
        drop.x += drift * drop.speed
        if (drop.y - drop.len > height) {
          drop.y = -drop.len - rand(0, 40)
          drop.x = rand(-60, width + 60)
        }
        if (drop.x > width + 80) drop.x -= width + 140
        if (drop.x < -80) drop.x += width + 140
      }
      if (flash > 0) flash = Math.max(0, flash - dt * 2.4)
      if (nextFlash !== Infinity) {
        nextFlash -= dt
        if (nextFlash <= 0) {
          flash = 1
          scheduleFlash()
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const tilt = (wind / 100) * 0.35
      // 两层雨滴各用一次 path + stroke，减少绘制调用
      ctx.beginPath()
      for (const drop of drops) {
        if (drop.near) continue
        ctx.moveTo(drop.x, drop.y)
        ctx.lineTo(drop.x + tilt * drop.len, drop.y + drop.len)
      }
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(150,175,230,0.28)'
      ctx.stroke()
      ctx.beginPath()
      for (const drop of drops) {
        if (!drop.near) continue
        ctx.moveTo(drop.x, drop.y)
        ctx.lineTo(drop.x + tilt * drop.len, drop.y + drop.len)
      }
      ctx.lineWidth = 1.6
      ctx.strokeStyle = 'rgba(200,220,255,0.5)'
      ctx.stroke()
      if (flash > 0) {
        ctx.fillStyle = `rgba(210,222,255,${(flash * 0.32).toFixed(3)})`
        ctx.fillRect(0, 0, width, height)
      }
    },
  }
}

/* -------------------------------- 阳光 -------------------------------- */

function createSunshine(): Renderer {
  interface Mote {
    x: number
    y: number
    size: number
    rise: number
    phase: number
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let glow: HTMLCanvasElement | null = null
  let motes: Mote[] = []
  let rayCount = 6
  let brightness = 0.6
  let drift = 35
  let rayAngle = 0
  const sun = { x: 0, y: 0 }

  const spawn = (): Mote => ({
    x: rand(0, width),
    y: rand(0, height),
    size: rand(1.2, 3.2),
    rise: rand(0.7, 1.3),
    phase: rand(0, Math.PI * 2),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      sun.x = w * 0.82
      sun.y = h * 0.12
      glow = makeGlowSprite(255, 226, 150)
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#fffaf0')
        sky.addColorStop(1, '#ffe9c2')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        const sunGlow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, Math.max(w, h) * 0.55)
        sunGlow.addColorStop(0, 'rgba(255,244,205,0.95)')
        sunGlow.addColorStop(0.35, 'rgba(255,226,160,0.35)')
        sunGlow.addColorStop(1, 'rgba(255,220,150,0)')
        ctx.fillStyle = sunGlow
        ctx.fillRect(0, 0, w, h)
        // 右下角的暖色暗角，让画面有层次
        const vignette = ctx.createRadialGradient(w, h, 0, w, h, Math.max(w, h) * 0.7)
        vignette.addColorStop(0, 'rgba(255,190,110,0.22)')
        vignette.addColorStop(1, 'rgba(255,190,110,0)')
        ctx.fillStyle = vignette
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(motes, motes.length, spawn)
    },
    configure(values) {
      brightness = clamp((values.brightness ?? 60) / 100, 0, 1)
      rayCount = Math.round(((values.rays ?? 50) / 100) * 12)
      drift = values.drift ?? drift
      const target = Math.round(((values.motes ?? 40) / 100) * 120 * areaFactor(width, height))
      resizeList(motes, target, spawn)
    },
    step(dt) {
      rayAngle += dt * (0.02 + (drift / 100) * 0.05)
      const rise = (6 + drift * 0.35) * dt
      for (const mote of motes) {
        mote.phase += dt * 0.9
        mote.y -= rise * mote.rise
        mote.x += Math.sin(mote.phase) * 6 * dt
        if (mote.y < -10) {
          mote.y = height + 10
          mote.x = rand(0, width)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      const reach = Math.hypot(width, height) * 1.1
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      // 光束：从太阳发出的细长三角形，每根带线性渐变
      for (let i = 0; i < rayCount; i += 1) {
        const angle = rayAngle + (i / Math.max(1, rayCount)) * Math.PI * 2 + Math.sin(i * 1.7) * 0.08
        const spread = 0.05 + (i % 3) * 0.02
        const x1 = sun.x + Math.cos(angle - spread) * reach
        const y1 = sun.y + Math.sin(angle - spread) * reach
        const x2 = sun.x + Math.cos(angle + spread) * reach
        const y2 = sun.y + Math.sin(angle + spread) * reach
        const tx = sun.x + Math.cos(angle) * reach
        const ty = sun.y + Math.sin(angle) * reach
        const gradient = ctx.createLinearGradient(sun.x, sun.y, tx, ty)
        gradient.addColorStop(0, `rgba(255,240,190,${(0.34 * brightness).toFixed(3)})`)
        gradient.addColorStop(1, 'rgba(255,240,190,0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(sun.x, sun.y)
        ctx.lineTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.closePath()
        ctx.fill()
      }
      // 光尘：金色光晕，轻微闪烁
      if (glow) {
        for (const mote of motes) {
          const alpha = (0.4 + 0.4 * Math.sin(mote.phase)) * brightness
          ctx.globalAlpha = clamp(alpha, 0, 1)
          const size = mote.size * 4
          ctx.drawImage(glow, mote.x - size / 2, mote.y - size / 2, size, size)
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
  }
  interface Meteor {
    x: number
    y: number
    vx: number
    vy: number
    life: number
    maxLife: number
  }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let glow: HTMLCanvasElement | null = null
  let stars: Star[] = []
  let meteors: Meteor[] = []
  let twinkle = 0.5
  let meteorRate = 0.3
  let brightness = 0.6
  let target = 0

  const spawnStar = (): Star => ({
    x: rand(0, width),
    y: rand(0, height),
    size: Math.random() < 0.12 ? rand(1.1, 1.8) : rand(0.4, 1.0),
    phase: rand(0, Math.PI * 2),
    speed: rand(0.6, 1.8),
    base: rand(0.45, 1),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      glow = makeGlowSprite(200, 220, 255)
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#03050f')
        sky.addColorStop(0.7, '#080d26')
        sky.addColorStop(1, '#0d1538')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        // 淡淡的星云
        const nebulaA = ctx.createRadialGradient(w * 0.25, h * 0.3, 0, w * 0.25, h * 0.3, Math.max(w, h) * 0.45)
        nebulaA.addColorStop(0, 'rgba(120,80,200,0.12)')
        nebulaA.addColorStop(1, 'rgba(120,80,200,0)')
        ctx.fillStyle = nebulaA
        ctx.fillRect(0, 0, w, h)
        const nebulaB = ctx.createRadialGradient(w * 0.8, h * 0.7, 0, w * 0.8, h * 0.7, Math.max(w, h) * 0.4)
        nebulaB.addColorStop(0, 'rgba(40,140,200,0.1)')
        nebulaB.addColorStop(1, 'rgba(40,140,200,0)')
        ctx.fillStyle = nebulaB
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(stars, target, spawnStar)
    },
    configure(values) {
      twinkle = clamp((values.twinkle ?? 50) / 100, 0, 1)
      meteorRate = clamp((values.meteor ?? 30) / 100, 0, 1) * 0.2
      brightness = clamp((values.brightness ?? 60) / 100, 0, 1)
      target = Math.round(((values.density ?? 50) / 100) * 520 * areaFactor(width, height))
      resizeList(stars, target, spawnStar)
    },
    step(dt) {
      for (const star of stars) {
        star.phase += dt * star.speed * (0.5 + twinkle)
      }
      if (meteorRate > 0 && Math.random() < meteorRate * dt) {
        const maxLife = rand(0.9, 1.4)
        meteors.push({
          x: rand(width * 0.35, width + 80),
          y: rand(-40, height * 0.4),
          vx: -rand(520, 820),
          vy: rand(260, 420),
          life: maxLife,
          maxLife,
        })
      }
      for (const meteor of meteors) {
        meteor.x += meteor.vx * dt
        meteor.y += meteor.vy * dt
        meteor.life -= dt
      }
      meteors = meteors.filter((meteor) => meteor.life > 0 && meteor.y < height + 60)
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      for (const star of stars) {
        const alpha = clamp(star.base * brightness * (0.6 + 0.4 * Math.sin(star.phase)) * (0.7 + twinkle * 0.3), 0, 1)
        if (star.size > 1.1 && glow) {
          // 较亮的星星带光晕
          ctx.globalAlpha = alpha
          const size = star.size * 7
          ctx.drawImage(glow, star.x - size / 2, star.y - size / 2, size, size)
        } else {
          ctx.globalAlpha = alpha
          ctx.fillStyle = '#e6eeff'
          ctx.fillRect(star.x, star.y, star.size, star.size)
        }
      }
      // 流星：头部亮、尾部渐隐
      for (const meteor of meteors) {
        const fade = clamp(meteor.life / meteor.maxLife, 0, 1)
        const tailX = meteor.x - meteor.vx * 0.12
        const tailY = meteor.y - meteor.vy * 0.12
        const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY)
        gradient.addColorStop(0, 'rgba(255,255,255,1)')
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.globalAlpha = fade * brightness
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(meteor.x, meteor.y)
        ctx.lineTo(tailX, tailY)
        ctx.stroke()
      }
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

    sizeTo()
    start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    motion.addEventListener('change', onMotion)

    return () => {
      stop()
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
