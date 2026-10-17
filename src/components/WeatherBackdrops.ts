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

/** 密集斜雨、远处雨幕与近处积水。闪电为可选，默认关闭。 */
export function createRain(initialDark: boolean): Renderer {
  interface Drop { x: number; y: number; z: number }
  interface Ripple { x: number; y: number; age: number; life: number; scale: number }
  let w = 1, h = 1, dark = initialDark, time = 0, flash = 0, nextFlash = 8
  let values: SceneValues = {}, drops: Drop[] = [], ripples: Ripple[] = []
  let background: HTMLCanvasElement, mist: HTMLCanvasElement
  const spawn = (top = false): Drop => ({ x: rand(-w * .3, w * 1.3), y: top ? rand(-100, -10) : rand(-50, h), z: rand(.15, 1) })
  const build = () => {
    background = paint(w, h, ctx => {
      sky(ctx, w, h, dark ? ['#07111d', '#152b3b', '#10202b'] : ['#c5d4df', '#e0e8ed', '#b6cad5'])
      // 雾中树影与低矮地平线，避免雨丝像贴在纯色纸上。
      ctx.fillStyle = dark ? '#0b1d29' : '#9fb6c1'
      for (let i = 0; i < 32; i++) {
        const x = (i / 31) * w, top = h * (.52 + .09 * Math.sin(i * 2.3))
        const spread = w / 38
        ctx.beginPath(); ctx.moveTo(x, top)
        for (let branch = 1; branch <= 12; branch++) {
          const y = top + (h * .8 - top) * branch / 12
          const radius = spread * branch / 12
          ctx.lineTo(x + radius, y); ctx.lineTo(x + radius * .4, y - 3)
        }
        ctx.lineTo(x - spread, h * .8)
        for (let branch = 12; branch >= 1; branch--) {
          const y = top + (h * .8 - top) * branch / 12
          const radius = spread * branch / 12
          ctx.lineTo(x - radius, y); ctx.lineTo(x - radius * .4, y - 3)
        }
        ctx.closePath(); ctx.fill()
      }
      const ground = ctx.createLinearGradient(0, h * .7, 0, h)
      ground.addColorStop(0, dark ? '#173443' : '#b9d0db'); ground.addColorStop(1, dark ? '#091722' : '#8eaab9')
      ctx.fillStyle = ground; ctx.fillRect(0, h * .76, w, h * .24)
      const light = ctx.createRadialGradient(w * .65, h * .7, 0, w * .65, h * .7, w * .6)
      light.addColorStop(0, dark ? 'rgba(158,199,219,.1)' : 'rgba(255,255,255,.3)'); light.addColorStop(1, 'rgba(180,220,240,0)')
      ctx.fillStyle = light; ctx.fillRect(0, 0, w, h)
    })
    mist = paint(256, 128, ctx => {
      const g = ctx.createRadialGradient(128, 64, 0, 128, 64, 128)
      g.addColorStop(0, dark ? 'rgba(165,198,217,.22)' : 'rgba(244,250,255,.65)'); g.addColorStop(1, 'rgba(200,225,245,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128)
    })
  }
  return {
    fps: 30,
    setup(width, height) { w = width; h = height; build(); drops = []; ripples = []; resize(drops, Math.round((values.count ?? 70) * 14 * area(w, h)), spawn) },
    configure(next) { values = next; resize(drops, Math.round((values.count ?? 70) * 14 * area(w, h)), spawn); if (!(values.lightning ?? 0)) flash = 0 },
    setTone(next) { if (next !== dark) { dark = next; build() } },
    step(dt) {
      time += dt; flash = Math.max(0, flash - dt * 2.8)
      const wind = (values.wind ?? 25) / 100
      for (const d of drops) {
        const vy = (350 + (values.speed ?? 65) * 8) * (.35 + d.z)
        d.y += vy * dt; d.x += wind * vy * .55 * dt
        if (d.y > h + 60 || d.x < -w * .35 || d.x > w * 1.35) {
          if (d.y > h && d.z > .7 && ripples.length < 75) ripples.push({ x: Math.min(w, Math.max(0, d.x)), y: rand(h * .79, h), age: 0, life: rand(.45, .9), scale: rand(.5, 1.5) })
          Object.assign(d, spawn(true))
        }
      }
      for (const r of ripples) r.age += dt
      ripples = ripples.filter(r => r.age < r.life)
      if ((values.lightning ?? 0) > 0 && time > nextFlash) { flash = .15 + (values.lightning ?? 0) * .003; nextFlash = time + rand(8, 18) }
    },
    draw(ctx) {
      ctx.drawImage(background, 0, 0, w, h)
      ctx.save(); ctx.lineCap = 'round'
      for (let layer = 0; layer < 3; layer++) {
        ctx.strokeStyle = dark ? ['rgba(157,190,217,.13)', 'rgba(190,219,239,.27)', 'rgba(222,240,253,.48)'][layer] : ['rgba(61,94,118,.12)', 'rgba(69,104,129,.22)', 'rgba(233,247,255,.65)'][layer]
        ctx.lineWidth = [.6, 1, 1.5][layer]; ctx.beginPath()
        for (const d of drops) {
          if (Math.min(2, Math.floor(d.z * 3)) !== layer) continue
          const length = 6 + d.z * (16 + (values.speed ?? 65) * .3)
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + (values.wind ?? 25) / 100 * length * .55, d.y + length)
        }
        ctx.stroke()
      }
      ctx.lineWidth = .8
      for (const r of ripples) {
        const t = r.age / r.life, radius = (2 + t * 20) * r.scale
        ctx.strokeStyle = dark ? 'rgba(184,220,240,' + ((1 - t) * .25) + ')' : 'rgba(40,80,105,' + ((1 - t) * .24) + ')'
        ctx.beginPath(); ctx.ellipse(r.x, r.y, radius, radius * .2, 0, 0, TAU); ctx.stroke()
      }
      ctx.globalAlpha = (values.mist ?? 40) / 100
      for (let i = 0; i < 3; i++) {
        const x = (Math.sin(time * .04 + i * 2) * .4 + .5) * w
        ctx.drawImage(mist, x - w * .6, h * (.35 + i * .18), w * 1.2, h * .4)
      }
      if (flash > 0) { ctx.globalAlpha = flash; ctx.fillStyle = dark ? '#c9e4ff' : '#f4faff'; ctx.fillRect(0, 0, w, h) }
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
