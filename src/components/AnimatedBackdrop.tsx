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

/* -------------------------------- 极光 -------------------------------- */

function createAurora(): Renderer {
  interface Particle { x: number; y: number; size: number; phase: number; speed: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let particles: Particle[] = []
  let intensity = 0.6
  let speed = 35
  let particleCount = 40
  let brightness = 0.55
  let t = 0
  const glow = makeGlowSprite(120, 200, 255)

  const spawn = (): Particle => ({
    x: rand(0, width),
    y: rand(0, height),
    size: rand(1, 3),
    phase: rand(0, Math.PI * 2),
    speed: rand(0.3, 1.2),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, h * 0.2, h)
        sky.addColorStop(0, '#020817')
        sky.addColorStop(0.5, '#050d24')
        sky.addColorStop(1, '#0a1633')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(particles, particles.length, spawn)
    },
    configure(values) {
      intensity = clamp((values.intensity ?? 60) / 100, 0, 1)
      speed = values.speed ?? speed
      particleCount = Math.round(((values.particles ?? 40) / 100) * 120 * areaFactor(width, height))
      brightness = clamp((values.brightness ?? 55) / 100, 0, 1)
      resizeList(particles, particleCount, spawn)
    },
    step(dt) {
      t += dt * (0.2 + (speed / 100) * 0.6)
      for (const p of particles) {
        p.phase += dt * p.speed
        p.x += Math.sin(p.phase) * 12 * dt
        p.y += Math.cos(p.phase * 0.7) * 6 * dt
        if (p.x < -10) p.x = width + 10
        if (p.x > width + 10) p.x = -10
        if (p.y < -10) p.y = height + 10
        if (p.y > height + 10) p.y = -10
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      // 极光带
      for (let i = 0; i < 4; i++) {
        const baseY = height * (0.18 + i * 0.12)
        const amp = height * (0.06 + i * 0.03)
        ctx.beginPath()
        for (let x = 0; x <= width; x += 8) {
          const y = baseY + Math.sin(x * 0.003 + t * (0.6 + i * 0.2) + i) * amp
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        // 闭合到底部形成带状
        ctx.lineTo(width, height)
        ctx.lineTo(0, height)
        ctx.closePath()
        const hue = [160, 200, 260, 300][i]
        const grad = ctx.createLinearGradient(0, baseY - amp, 0, baseY + amp * 3)
        grad.addColorStop(0, `hsla(${hue},80%,65%,${(0.18 * intensity * brightness).toFixed(3)})`)
        grad.addColorStop(1, `hsla(${hue},80%,65%,0)`)
        ctx.fillStyle = grad
        ctx.fill()
      }
      // 微光粒子
      if (glow) {
        for (const p of particles) {
          const alpha = (0.3 + 0.5 * Math.sin(p.phase)) * brightness
          ctx.globalAlpha = clamp(alpha, 0, 1)
          const size = p.size * 6
          ctx.drawImage(glow, p.x - size / 2, p.y - size / 2, size, size)
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 飘雪 -------------------------------- */

function createSnow(): Renderer {
  interface Flake { x: number; y: number; size: number; speed: number; drift: number; phase: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let flakes: Flake[] = []
  let target = 0
  let speed = 40
  let wind = 8
  let brightness = 0.6
  const glow = makeGlowSprite(230, 240, 255)

  const spawn = (): Flake => ({
    x: rand(-40, width + 40),
    y: rand(-height, 0),
    size: rand(1.5, 4.5),
    speed: rand(0.7, 1.3),
    drift: rand(0.5, 1.5),
    phase: rand(0, Math.PI * 2),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#0b1224')
        sky.addColorStop(1, '#1a2340')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        // 地面微光
        const ground = ctx.createLinearGradient(0, h * 0.85, 0, h)
        ground.addColorStop(0, 'rgba(180,200,255,0)')
        ground.addColorStop(1, 'rgba(180,200,255,0.12)')
        ctx.fillStyle = ground
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(flakes, flakes.length, spawn)
    },
    configure(values) {
      speed = values.speed ?? speed
      wind = values.wind ?? wind
      const density = values.density ?? 50
      brightness = clamp((values.brightness ?? 60) / 100, 0, 1)
      target = Math.round((density / 100) * 600 * areaFactor(width, height))
      resizeList(flakes, target, spawn)
    },
    step(dt) {
      const fall = (40 + speed * 1.2) * dt
      const drift = (wind / 100) * 60 * dt
      for (const f of flakes) {
        f.y += fall * f.speed
        f.x += (drift + Math.sin(f.phase) * 12) * dt * f.drift
        f.phase += dt * 0.8
        if (f.y > height + 10) {
          f.y = -10
          f.x = rand(-40, width + 40)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      for (const f of flakes) {
        const alpha = (0.5 + 0.5 * Math.sin(f.phase)) * brightness
        ctx.globalAlpha = clamp(alpha, 0, 1)
        if (f.size > 2.5 && glow) {
          const size = f.size * 5
          ctx.drawImage(glow, f.x - size / 2, f.y - size / 2, size, size)
        } else {
          ctx.fillStyle = '#eaf1ff'
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 萤火虫 -------------------------------- */

function createFireflies(): Renderer {
  interface Bug { x: number; y: number; vx: number; vy: number; phase: number; size: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let bugs: Bug[] = []
  let target = 0
  let speed = 30
  let glowAmt = 0.65
  let brightness = 0.35
  const glow = makeGlowSprite(180, 255, 120)

  const spawn = (): Bug => ({
    x: rand(0, width),
    y: rand(height * 0.3, height),
    vx: rand(-20, 20),
    vy: rand(-15, 15),
    phase: rand(0, Math.PI * 2),
    size: rand(1.5, 3),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#040a14')
        sky.addColorStop(1, '#0a1820')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        // 草丛剪影
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        for (let i = 0; i < 8; i++) {
          const x = (i / 7) * w
          ctx.beginPath()
          ctx.ellipse(x, h + 20, w * 0.18, h * 0.12, 0, Math.PI, Math.PI * 2)
          ctx.fill()
        }
      })
      resizeList(bugs, bugs.length, spawn)
    },
    configure(values) {
      speed = values.speed ?? speed
      glowAmt = clamp((values.glow ?? 65) / 100, 0, 1)
      brightness = clamp((values.brightness ?? 35) / 100, 0, 1)
      const density = values.density ?? 45
      target = Math.round((density / 100) * 80 * areaFactor(width, height))
      resizeList(bugs, target, spawn)
    },
    step(dt) {
      for (const b of bugs) {
        b.phase += dt * (0.8 + Math.random() * 0.4)
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.vx += rand(-8, 8) * dt
        b.vy += rand(-8, 8) * dt
        b.vx = clamp(b.vx, -30, 30)
        b.vy = clamp(b.vy, -25, 25)
        if (b.x < 0) { b.x = 0; b.vx *= -1 }
        if (b.x > width) { b.x = width; b.vx *= -1 }
        if (b.y < height * 0.2) { b.y = height * 0.2; b.vy *= -1 }
        if (b.y > height) { b.y = height; b.vy *= -1 }
      }
      // speed factor
      void speed
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      for (const b of bugs) {
        const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(b.phase))
        const alpha = pulse * glowAmt * (0.6 + brightness * 0.4)
        ctx.globalAlpha = clamp(alpha, 0, 1)
        const size = b.size * 8
        ctx.drawImage(glow, b.x - size / 2, b.y - size / 2, size, size)
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 樱花 -------------------------------- */

function createSakura(): Renderer {
  interface Petal { x: number; y: number; size: number; speed: number; rot: number; rotSpeed: number; sway: number; phase: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let petals: Petal[] = []
  let target = 0
  let speed = 35
  let wind = 15
  let brightness = 0.7

  const spawn = (): Petal => ({
    x: rand(-40, width + 40),
    y: rand(-height, 0),
    size: rand(6, 14),
    speed: rand(0.7, 1.3),
    rot: rand(0, Math.PI * 2),
    rotSpeed: rand(-1.5, 1.5),
    sway: rand(0.5, 1.5),
    phase: rand(0, Math.PI * 2),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#fff1f7')
        sky.addColorStop(1, '#ffe4f0')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(petals, petals.length, spawn)
    },
    configure(values) {
      speed = values.speed ?? speed
      wind = values.wind ?? wind
      const density = values.density ?? 45
      brightness = clamp((values.brightness ?? 70) / 100, 0, 1)
      target = Math.round((density / 100) * 90 * areaFactor(width, height))
      resizeList(petals, target, spawn)
    },
    step(dt) {
      const fall = (30 + speed * 0.9) * dt
      const drift = (wind / 100) * 50 * dt
      for (const p of petals) {
        p.y += fall * p.speed
        p.x += (drift + Math.sin(p.phase) * 20) * dt * p.sway
        p.phase += dt * 1.2
        p.rot += p.rotSpeed * dt
        if (p.y > height + 20) {
          p.y = -20
          p.x = rand(-40, width + 40)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      for (const p of petals) {
        ctx.globalAlpha = brightness
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = 'rgba(255,182,210,0.85)'
        ctx.beginPath()
        ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 气泡 -------------------------------- */

function createBubbles(): Renderer {
  interface Bubble { x: number; y: number; size: number; speed: number; phase: number; wobble: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let bubbles: Bubble[] = []
  let target = 0
  let speed = 40
  let sizeFactor = 0.5
  let brightness = 0.75
  const glow = makeGlowSprite(180, 220, 255)

  const spawn = (): Bubble => ({
    x: rand(0, width),
    y: rand(height, height + 100),
    size: rand(4, 16),
    speed: rand(0.7, 1.3),
    phase: rand(0, Math.PI * 2),
    wobble: rand(0.5, 1.5),
  })

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#e8f4ff')
        sky.addColorStop(1, '#d6ecff')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(bubbles, bubbles.length, spawn)
    },
    configure(values) {
      speed = values.speed ?? speed
      sizeFactor = clamp((values.size ?? 50) / 100, 0, 1)
      brightness = clamp((values.brightness ?? 75) / 100, 0, 1)
      const density = values.density ?? 40
      target = Math.round((density / 100) * 70 * areaFactor(width, height))
      resizeList(bubbles, target, spawn)
    },
    step(dt) {
      const rise = (30 + speed * 0.9) * dt
      for (const b of bubbles) {
        b.y -= rise * b.speed
        b.x += Math.sin(b.phase) * 12 * dt * b.wobble
        b.phase += dt * 1.2
        if (b.y < -30) {
          b.y = height + 30
          b.x = rand(0, width)
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      for (const b of bubbles) {
        const r = b.size * (0.6 + sizeFactor * 1.2)
        ctx.globalAlpha = 0.55 * brightness
        ctx.strokeStyle = 'rgba(120,180,255,0.7)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
        ctx.stroke()
        // 高光
        ctx.globalAlpha = 0.8 * brightness
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.25, 0, Math.PI * 2)
        ctx.fill()
        if (glow) {
          ctx.globalAlpha = 0.15 * brightness
          const size = r * 4
          ctx.drawImage(glow, b.x - size / 2, b.y - size / 2, size, size)
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 数字雨 -------------------------------- */

function createMatrix(): Renderer {
  interface Column { x: number; y: number; speed: number; chars: string[]; len: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let columns: Column[] = []
  let speed = 50
  let brightness = 0.7
  let glowAmt = 0.4
  const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF'

  const spawn = (x: number): Column => {
    const len = Math.floor(rand(8, 22))
    return {
      x,
      y: rand(-height, 0),
      speed: rand(0.7, 1.3),
      chars: Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]),
      len,
    }
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        ctx.fillStyle = '#020a04'
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(columns, columns.length, () => spawn(0))
    },
    configure(values) {
      speed = values.speed ?? speed
      brightness = clamp((values.brightness ?? 70) / 100, 0, 1)
      glowAmt = clamp((values.glow ?? 40) / 100, 0, 1)
      const density = values.density ?? 55
      const colWidth = 18
      const count = Math.max(4, Math.round((density / 100) * (width / colWidth)))
      // 重建列
      columns = []
      for (let i = 0; i < count; i++) {
        columns.push(spawn(i * colWidth + rand(0, 6)))
      }
    },
    step(dt) {
      const fall = (80 + speed * 2.4) * dt
      for (const c of columns) {
        c.y += fall * c.speed
        if (c.y - c.len * 18 > height) {
          c.y = -c.len * 18
          c.chars = Array.from({ length: c.len }, () => chars[Math.floor(Math.random() * chars.length)])
        }
        // 偶尔变换字符
        if (Math.random() < 0.05) {
          const idx = Math.floor(Math.random() * c.chars.length)
          c.chars[idx] = chars[Math.floor(Math.random() * chars.length)]
        }
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      // 拖尾
      ctx.fillStyle = 'rgba(0,10,4,0.18)'
      ctx.fillRect(0, 0, width, height)
      ctx.save()
      ctx.font = '14px monospace'
      for (const c of columns) {
        for (let i = 0; i < c.chars.length; i++) {
          const y = c.y - i * 18
          if (y < -20 || y > height + 20) continue
          const isHead = i === 0
          const alpha = isHead ? 1 : Math.max(0, 1 - i / c.chars.length) * 0.8
          ctx.globalAlpha = alpha * brightness
          ctx.fillStyle = isHead ? '#b7ffb7' : `rgba(60,220,90,${(0.6 + glowAmt * 0.4).toFixed(2)})`
          ctx.fillText(c.chars[i], c.x, y)
        }
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 海浪 -------------------------------- */

function createOcean(): Renderer {
  interface Foam { x: number; y: number; size: number; life: number; maxLife: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let foams: Foam[] = []
  let target = 0
  let speed = 40
  let waves = 50
  let brightness = 0.7
  let foamAmt = 0.35
  let t = 0

  const spawnFoam = (): Foam => {
    const maxLife = rand(0.8, 1.6)
    return { x: rand(0, width), y: height * 0.55 + rand(-10, 10), size: rand(2, 6), life: maxLife, maxLife }
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55)
        sky.addColorStop(0, '#bfe6ff')
        sky.addColorStop(1, '#7fc8f0')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        const sea = ctx.createLinearGradient(0, h * 0.55, 0, h)
        sea.addColorStop(0, '#1a6fa0')
        sea.addColorStop(1, '#0d3f66')
        ctx.fillStyle = sea
        ctx.fillRect(0, h * 0.55, w, h * 0.45)
      })
      resizeList(foams, foams.length, spawnFoam)
    },
    configure(values) {
      speed = values.speed ?? speed
      waves = values.waves ?? waves
      brightness = clamp((values.brightness ?? 70) / 100, 0, 1)
      foamAmt = clamp((values.foam ?? 35) / 100, 0, 1)
      target = Math.round(foamAmt * 60 * areaFactor(width, height))
      resizeList(foams, target, spawnFoam)
    },
    step(dt) {
      t += dt * (0.3 + (speed / 100) * 0.7)
      for (const f of foams) {
        f.x += (speed * 0.6 + 20) * dt * 0.3
        f.life -= dt
        if (f.life <= 0 || f.x > width + 20) {
          f.x = rand(0, width * 0.3)
          f.y = height * 0.55 + rand(-8, 8)
          f.life = f.maxLife
        }
      }
      if (Math.random() < foamAmt * 0.3 * dt * 60) {
        if (foams.length < target) foams.push(spawnFoam())
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      // 波浪
      const waveCount = 3 + Math.round((waves / 100) * 4)
      for (let i = 0; i < waveCount; i++) {
        const baseY = height * (0.5 + i * 0.07)
        const amp = 8 + i * 4
        ctx.beginPath()
        for (let x = 0; x <= width; x += 6) {
          const y = baseY + Math.sin(x * 0.008 + t * (0.8 + i * 0.2) + i) * amp
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.lineTo(width, height)
        ctx.lineTo(0, height)
        ctx.closePath()
        ctx.globalAlpha = (0.18 + i * 0.05) * brightness
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#a8d8f0'
        ctx.fill()
      }
      // 泡沫
      for (const f of foams) {
        const fade = clamp(f.life / f.maxLife, 0, 1)
        ctx.globalAlpha = fade * 0.7 * brightness
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    },
  }
}

/* -------------------------------- 星系 -------------------------------- */

function createGalaxy(): Renderer {
  interface Star { x: number; y: number; size: number; phase: number; speed: number; base: number; arm: number }
  let width = 0
  let height = 0
  let background: HTMLCanvasElement | null = null
  let stars: Star[] = []
  let target = 0
  let speed = 30
  let density = 55
  let nebula = 0.6
  let brightness = 0.6
  let t = 0
  const glow = makeGlowSprite(200, 180, 255)

  const cx = () => width * 0.5
  const cy = () => height * 0.5

  const spawn = (): Star => {
    const arm = Math.floor(Math.random() * 3)
    const r = rand(0, Math.min(width, height) * 0.42)
    const angle = (arm / 3) * Math.PI * 2 + r * 0.012 + rand(-0.4, 0.4)
    return {
      x: cx() + Math.cos(angle) * r,
      y: cy() + Math.sin(angle) * r * 0.6,
      size: rand(0.4, 1.4),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.4, 1.4),
      base: rand(0.4, 1),
      arm,
    }
  }

  return {
    fps: 30,
    setup(w, h) {
      width = w
      height = h
      background = paintBackground(w, h, (ctx) => {
        const sky = ctx.createRadialGradient(cx(), cy(), 0, cx(), cy(), Math.max(w, h) * 0.7)
        sky.addColorStop(0, '#0a0620')
        sky.addColorStop(0.5, '#05031a')
        sky.addColorStop(1, '#02010d')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
      })
      resizeList(stars, stars.length, spawn)
    },
    configure(values) {
      speed = values.speed ?? speed
      density = values.density ?? density
      nebula = clamp((values.nebula ?? 60) / 100, 0, 1)
      brightness = clamp((values.brightness ?? 60) / 100, 0, 1)
      target = Math.round((density / 100) * 700 * areaFactor(width, height))
      resizeList(stars, target, spawn)
    },
    step(dt) {
      t += dt * (0.05 + (speed / 100) * 0.15)
      for (const s of stars) {
        s.phase += dt * s.speed
      }
    },
    draw(ctx) {
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      // 星云
      ctx.globalCompositeOperation = 'screen'
      for (let i = 0; i < 3; i++) {
        const r = Math.min(width, height) * (0.25 + i * 0.12)
        const grad = ctx.createRadialGradient(cx(), cy(), 0, cx(), cy(), r)
        const hue = [260, 300, 200][i]
        grad.addColorStop(0, `hsla(${hue},70%,55%,${(0.12 * nebula).toFixed(3)})`)
        grad.addColorStop(1, `hsla(${hue},70%,55%,0)`)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, width, height)
      }
      // 旋转星星
      ctx.translate(cx(), cy())
      ctx.rotate(t)
      ctx.translate(-cx(), -cy())
      for (const s of stars) {
        const alpha = clamp(s.base * brightness * (0.6 + 0.4 * Math.sin(s.phase)), 0, 1)
        ctx.globalAlpha = alpha
        if (s.size > 1.1 && glow) {
          const size = s.size * 6
          ctx.drawImage(glow, s.x - size / 2, s.y - size / 2, size, size)
        } else {
          ctx.fillStyle = '#e6eeff'
          ctx.fillRect(s.x, s.y, s.size, s.size)
        }
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
    case 'aurora':
      return createAurora()
    case 'snow':
      return createSnow()
    case 'fireflies':
      return createFireflies()
    case 'sakura':
      return createSakura()
    case 'bubbles':
      return createBubbles()
    case 'matrix':
      return createMatrix()
    case 'ocean':
      return createOcean()
    case 'galaxy':
      return createGalaxy()
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
