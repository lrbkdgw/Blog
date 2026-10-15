import type { ActiveSceneId, SceneValues } from '../scenes'

export type RGB = [number, number, number]
export interface SceneColors { primary: RGB; secondary: RGB; dark: boolean }
export interface Renderer {
  fps: number
  setup(width: number, height: number): void
  configure(values: SceneValues): void
  step(dt: number): void
  draw(ctx: CanvasRenderingContext2D): void
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const tau = Math.PI * 2
const rgba = (color: RGB, alpha: number) => `rgba(${color.join(',')},${clamp(alpha, 0, 1)})`
const area = (w: number, h: number) => clamp(w * h / (1440 * 900), 0.65, 1.6)

function resizeList<T>(list: T[], count: number, make: () => T) {
  if (list.length > count) list.length = count
  while (list.length < count) list.push(make())
}

function sprite(color: RGB) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24)
    g.addColorStop(0, rgba(color, 1))
    g.addColorStop(0.2, rgba(color, 0.55))
    g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 48, 48)
  }
  return canvas
}

/** Transparent, cached atmosphere: the chosen palette and custom gradient stay visible underneath. */
function atmosphere(w: number, h: number, colors: SceneColors, sun = false) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const positions = sun ? [[0.82, 0.14], [0.1, 0.95]] : [[0.18, 0.15], [0.9, 0.8]]
    positions.forEach(([x, y], i) => {
      const color = i === 0 ? colors.primary : colors.secondary
      const gradient = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, Math.max(w, h) * 0.65)
      gradient.addColorStop(0, rgba(color, sun && i === 0 ? 0.2 : 0.09))
      gradient.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, w, h)
    })
  }
  return canvas
}

type ParticleKind = 'rain' | 'stars' | 'petals' | 'snow' | 'fireflies'
interface Particle { x: number; y: number; size: number; phase: number; depth: number }
interface Meteor { x: number; y: number; life: number; duration: number }

/** One bounded particle engine, with a distinct movement and drawing model for each scene. */
function particles(kind: ParticleKind, colors: SceneColors, quality: number): Renderer {
  let width = 1, height = 1
  let items: Particle[] = []
  let meteors: Meteor[] = []
  let values: SceneValues = {}
  let background: HTMLCanvasElement
  const glow = sprite(colors.primary)
  let flash = 0, nextFlash = 20
  const maximum = { rain: 850, stars: 480, petals: 95, snow: 170, fireflies: 85 }[kind]
  const spawn = (): Particle => ({ x: rand(-20, width + 20), y: rand(-20, height + 20), size: rand(1, 3.4), phase: rand(0, tau), depth: rand(0.45, 1) })
  const count = () => Math.round(maximum * ((values.density ?? 50) / 100) * area(width, height) * quality)

  return {
    fps: kind === 'rain' ? 60 : 30,
    setup(w, h) {
      width = Math.max(1, w); height = Math.max(1, h)
      background = atmosphere(width, height, colors)
      items = []
      meteors = []
    },
    configure(next) {
      if (next.lightning !== values.lightning) nextFlash = 8 + (100 - (next.lightning ?? 0)) * 0.25
      values = next
      resizeList(items, count(), spawn)
      if (!values.meteor) meteors = []
      if (!values.lightning) flash = 0
    },
    step(dt) {
      const speed = (values.speed ?? 35) / 100
      const sway = (values.sway ?? 45) / 100
      for (const p of items) {
        if (kind === 'rain') {
          p.y += speed * 850 * p.depth * dt
          p.x += ((values.wind ?? 12) / 100) * speed * 240 * p.depth * dt
        } else if (kind === 'stars') {
          p.phase += dt * (values.twinkle ?? 50) / 100 * (0.5 + p.depth)
        } else if (kind === 'fireflies') {
          p.phase += dt * 0.65
          p.x += Math.sin(p.phase * 0.8) * speed * 28 * dt
          p.y += Math.cos(p.phase * 0.6) * speed * 20 * dt
        } else {
          p.phase += dt * speed * 1.6
          p.y += speed * (kind === 'snow' ? 60 : 95) * p.depth * dt
          p.x += (10 + Math.sin(p.phase) * sway * 65) * speed * dt
        }
        if (p.y > height + 35) { p.y = -30; p.x = rand(-20, width + 20) }
        if (p.y < -40) p.y = height + 30
        if (p.x > width + 40) p.x = -30
        if (p.x < -40) p.x = width + 30
      }
      if (kind === 'rain' && (values.lightning ?? 0) > 0) {
        nextFlash -= dt
        if (nextFlash <= 0) { flash = 1; nextFlash = (8 + (100 - values.lightning) * 0.3) * rand(0.8, 1.2) }
      }
      flash = Math.max(0, flash - dt * 1.1)
      if (kind === 'stars') {
        if (meteors.length < 2 && Math.random() < ((values.meteor ?? 30) / 100) * 0.2 * dt) {
          const duration = rand(1, 1.7)
          meteors.push({ x: rand(width * 0.3, width + 80), y: rand(-40, height * 0.35), life: duration, duration })
        }
        for (const m of meteors) { m.x -= dt * 520; m.y += dt * 250; m.life -= dt }
        meteors = meteors.filter((m) => m.life > 0)
      }
    },
    draw(ctx) {
      ctx.clearRect(0, 0, width, height)
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      const brightness = (values.brightness ?? 70) / 100
      if (kind === 'rain') {
        // Two batched strokes rather than one stroke call per raindrop.
        for (const near of [false, true]) {
          ctx.beginPath()
          for (const p of items) {
            if ((p.depth > 0.7) !== near) continue
            const length = 12 + p.depth * 18
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(p.x + ((values.wind ?? 12) / 100) * length * 0.45, p.y + length)
          }
          ctx.strokeStyle = rgba(colors.primary, near ? 0.48 : 0.22)
          ctx.lineWidth = near ? 1.3 : 0.7
          ctx.stroke()
        }
        if (flash > 0) {
          ctx.fillStyle = rgba(colors.secondary, flash * 0.13)
          ctx.fillRect(0, 0, width, height)
        }
      } else {
        for (const p of items) {
          if (kind === 'petals') {
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.phase)
            ctx.scale(0.45 + Math.abs(Math.cos(p.phase)) * 0.55, 1)
            ctx.fillStyle = rgba(p.depth > 0.7 ? colors.primary : colors.secondary, 0.28 + p.depth * 0.38)
            const size = p.size * 2.1
            ctx.beginPath()
            ctx.moveTo(0, -size)
            ctx.bezierCurveTo(size * 1.5, -size * 0.7, size, size * 0.7, 0, size)
            ctx.bezierCurveTo(-size, size * 0.6, -size * 0.6, -size * 0.8, 0, -size)
            ctx.fill()
            ctx.restore()
          } else if (kind === 'snow') {
            ctx.fillStyle = rgba(colors.primary, 0.2 + p.depth * 0.45)
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * 0.8, 0, tau)
            ctx.fill()
          } else if (kind === 'fireflies') {
            const alpha = brightness * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase)))
            ctx.globalAlpha = alpha
            const size = p.size * 9
            ctx.drawImage(glow, p.x - size / 2, p.y - size / 2, size, size)
            ctx.fillStyle = rgba(colors.primary, 0.9)
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5, 0, tau); ctx.fill()
          } else {
            const twinkle = (values.twinkle ?? 50) / 100
            ctx.globalAlpha = brightness * p.depth * (1 - twinkle * 0.35 + Math.sin(p.phase) * twinkle * 0.35)
            if (p.size > 2.8) {
              const size = p.size * 5
              ctx.drawImage(glow, p.x - size / 2, p.y - size / 2, size, size)
              ctx.strokeStyle = rgba(colors.primary, 0.65)
              ctx.lineWidth = 0.7
              ctx.beginPath(); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y)
              ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3); ctx.stroke()
            } else {
              ctx.fillStyle = rgba(colors.primary, 1)
              ctx.fillRect(p.x, p.y, p.size * 0.5, p.size * 0.5)
            }
          }
        }
        ctx.globalAlpha = 1
        for (const m of meteors) {
          const gradient = ctx.createLinearGradient(m.x, m.y, m.x + 90, m.y - 45)
          gradient.addColorStop(0, rgba(colors.primary, brightness * Math.min(1, m.life / m.duration * 2)))
          gradient.addColorStop(1, rgba(colors.primary, 0))
          ctx.strokeStyle = gradient; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + 90, m.y - 45); ctx.stroke()
        }
      }
      ctx.restore()
    },
  }
}

function fields(kind: 'aurora' | 'waves' | 'sunshine', colors: SceneColors, quality: number): Renderer {
  let width = 1, height = 1, time = 0
  let values: SceneValues = {}
  let background: HTMLCanvasElement
  let motes: Particle[] = []
  const glow = sprite(colors.secondary)
  const spawn = (): Particle => ({ x: rand(0, width), y: rand(0, height), phase: rand(0, tau), size: rand(5, 13), depth: rand(0.5, 1) })
  return {
    fps: 30,
    setup(w, h) {
      width = Math.max(1, w); height = Math.max(1, h)
      background = atmosphere(width, height, colors, kind === 'sunshine')
      motes = []
    },
    configure(next) {
      values = next
      if (kind === 'sunshine') resizeList(motes, Math.round((values.motes ?? 40) / 100 * 95 * area(width, height) * quality), spawn)
    },
    step(dt) {
      const speed = (values.speed ?? values.drift ?? 35) / 100
      time += dt * speed
      for (const p of motes) {
        p.phase += dt * speed
        p.y -= dt * speed * 25 * p.depth
        p.x += Math.sin(p.phase) * dt * speed * 9
        if (p.y < -20) { p.y = height + 20; p.x = rand(0, width) }
      }
    },
    draw(ctx) {
      ctx.clearRect(0, 0, width, height)
      if (background) ctx.drawImage(background, 0, 0, width, height)
      ctx.save()
      const brightness = (values.brightness ?? 55) / 100
      const density = (values.density ?? 55) / 100
      if (kind === 'aurora') {
        const count = Math.ceil(density * 6)
        for (let band = 0; band < count; band++) {
          const y0 = height * (0.18 + band * 0.065)
          const thick = Math.min(height * 0.22, 180)
          const gradient = ctx.createLinearGradient(0, y0 - 100, width * 0.35, y0 + thick + 140)
          gradient.addColorStop(0, rgba(colors.primary, 0))
          gradient.addColorStop(0.45, rgba(band % 2 ? colors.secondary : colors.primary, brightness * (colors.dark ? 0.27 : 0.18)))
          gradient.addColorStop(1, rgba(colors.secondary, 0))
          const y = (x: number) => y0 + Math.sin(x / width * 5 + time * 0.35 + band * 0.7) * height * 0.12 + Math.sin(x / width * 2.5 - time * 0.22) * height * 0.09
          ctx.beginPath()
          for (let i = 0; i <= 40; i++) {
            const x = (i / 40) * (width + 160) - 80
            if (i === 0) ctx.moveTo(x, y(x)); else ctx.lineTo(x, y(x))
          }
          for (let i = 40; i >= 0; i--) {
            const x = (i / 40) * (width + 160) - 80
            ctx.lineTo(x, y(x) + thick * (0.65 + Math.sin(x / width * 3 + band) * 0.25))
          }
          ctx.closePath(); ctx.fillStyle = gradient; ctx.fill()
        }
      } else if (kind === 'waves') {
        const count = Math.ceil(density * 12)
        for (let wave = 0; wave < count; wave++) {
          const base = height * 0.58 + wave * 19
          const color = wave % 3 === 0 ? colors.secondary : colors.primary
          ctx.beginPath()
          for (let i = 0; i <= 64; i++) {
            const x = i / 64 * width
            const y = base + Math.sin(i / 64 * 7 + time * 0.5 + wave * 0.24) * (25 + wave * 2) + Math.cos(i / 64 * 3 - time * 0.3) * 28
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          }
          ctx.strokeStyle = rgba(color, brightness * (colors.dark ? 0.42 : 0.28))
          ctx.lineWidth = wave % 3 === 0 ? 1.5 : 0.8
          ctx.stroke()
          ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath()
          ctx.fillStyle = rgba(color, brightness * 0.015); ctx.fill()
        }
      } else {
        const sunX = width * 0.82, sunY = height * 0.14, reach = Math.hypot(width, height)
        const count = Math.round((values.rays ?? 50) / 100 * 12)
        for (let ray = 0; ray < count; ray++) {
          const angle = (ray / Math.max(count, 1)) * tau + time * 0.08
          const spread = 0.04 + (ray % 3) * 0.02
          const gradient = ctx.createLinearGradient(sunX, sunY, sunX + Math.cos(angle) * reach, sunY + Math.sin(angle) * reach)
          gradient.addColorStop(0, rgba(colors.secondary, brightness * 0.22))
          gradient.addColorStop(1, rgba(colors.secondary, 0))
          ctx.beginPath(); ctx.moveTo(sunX, sunY)
          ctx.lineTo(sunX + Math.cos(angle - spread) * reach, sunY + Math.sin(angle - spread) * reach)
          ctx.lineTo(sunX + Math.cos(angle + spread) * reach, sunY + Math.sin(angle + spread) * reach)
          ctx.closePath(); ctx.fillStyle = gradient; ctx.fill()
        }
        for (const p of motes) {
          ctx.globalAlpha = brightness * (0.45 + Math.sin(p.phase) * 0.3)
          ctx.drawImage(glow, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
        }
      }
      ctx.restore()
    },
  }
}

export function createRenderer(scene: ActiveSceneId, colors: SceneColors, quality: number): Renderer {
  switch (scene) {
    case 'rain': case 'stars': case 'petals': case 'snow': case 'fireflies': return particles(scene, colors, quality)
    case 'aurora': case 'waves': return fields(scene, colors, quality)
    case 'sunshine': {
      // Keep sunshine recognizably warm, while retaining a hint of the selected palette.
      const warm: RGB = [255, 206, 120]
      const blend = (color: RGB): RGB => color.map((channel, i) => Math.round(channel * 0.3 + warm[i] * 0.7)) as RGB
      return fields(scene, { ...colors, primary: blend(colors.primary), secondary: blend(colors.secondary) }, quality)
    }
  }
}
