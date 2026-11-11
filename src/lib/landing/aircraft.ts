/**
 * 程序化建模的窄体客机（外形比例参考 A320，全部由代码生成，不加载任何模型或贴图文件，
 * 因此离线单文件版里同样可用）。
 *
 * 机体坐标系：原点在**主起落架轮底、机身中线**上；机头朝 -Z、右翼朝 +X、向上 +Y，单位米。
 * 把原点放在主轮触地点，接地后「放机头」的俯仰转动自然就是绕主轮进行的。
 */
import * as THREE from 'three'
import { FLIGHT, type FlightState } from './flight'

const R = 1.98 // 机身半径
const CY = 3.92 // 机身中轴离地高度
const NOSE_Z = -17.7
const LENGTH = 37.6
const NOSE_LEN = 5.2
const TAIL_START = 24.5

export const AIRCRAFT_DIM = { radius: R, centerY: CY, noseZ: NOSE_Z, length: LENGTH, span: 34.1 }

/* -------------------------------------------------------------------------- */
/*  通用几何工具                                                               */
/* -------------------------------------------------------------------------- */

interface RingPoint {
  z: number
  r: number
  /** 该截面圆心的 y（默认 0） */
  y?: number
}

/**
 * 绕 Z 轴的回转体（机身、发动机短舱、整流锥都用它）。
 * φ = 0 在正下方，经右侧（+X）转到正上方；UV：u 沿轴向、v 沿周向，接缝落在机腹。
 */
function revolve(profile: RingPoint[], segments = 32, inward = false): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const z0 = profile[0].z
  const span = profile[profile.length - 1].z - z0 || 1
  for (const p of profile) {
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * Math.PI * 2
      positions.push(p.r * Math.sin(phi), (p.y ?? 0) - p.r * Math.cos(phi), p.z)
      uvs.push((p.z - z0) / span, j / segments)
    }
  }
  const ring = segments + 1
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * ring + j
      const b = a + ring
      const c = a + 1
      const d = b + 1
      if (inward) indices.push(a, b, c, b, d, c)
      else indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

interface Section {
  /** 前缘点 */
  le: THREE.Vector3
  /** 弦长 */
  chord: number
  /** 相对厚度（厚度 / 弦长） */
  thick: number
}

/**
 * 把若干翼型截面放样成翼面（机翼、平尾、垂尾、小翼、襟翼共用）。
 * 翼型是 NACA 四位数对称厚度分布加一点弯度；chordDir 指向后缘，thickDir 指向「上表面」。
 */
function loft(
  sections: Section[],
  chordDir: THREE.Vector3,
  thickDir: THREE.Vector3,
  opts: { stations?: number; camber?: number; capStart?: boolean } = {},
): THREE.BufferGeometry {
  const n = opts.stations ?? 10
  const camber = opts.camber ?? 0.018
  const cd = chordDir.clone().normalize()
  const td = thickDir.clone().normalize()
  const outline: Array<[number, number]> = []
  const profile = (x: number) =>
    5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
  for (let i = 0; i <= n; i++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / n))
    outline.push([x, 1])
  }
  for (let i = n - 1; i >= 1; i--) {
    const x = 0.5 * (1 - Math.cos((Math.PI * i) / n))
    outline.push([x, -1])
  }
  const ring = outline.length
  const positions: number[] = []
  const indices: number[] = []
  const tmp = new THREE.Vector3()
  for (const sec of sections) {
    for (const [x, side] of outline) {
      const yt = profile(x) * sec.thick * side + camber * 4 * x * (1 - x)
      tmp.copy(sec.le).addScaledVector(cd, x * sec.chord).addScaledVector(td, yt * sec.chord)
      positions.push(tmp.x, tmp.y, tmp.z)
    }
  }
  const spanDir = sections[sections.length - 1].le.clone().sub(sections[0].le)
  const flip = td.dot(cd.clone().cross(spanDir)) < 0
  for (let k = 0; k < sections.length - 1; k++) {
    for (let j = 0; j < ring; j++) {
      const a = k * ring + j
      const b = (k + 1) * ring + j
      const c = k * ring + ((j + 1) % ring)
      const d = (k + 1) * ring + ((j + 1) % ring)
      if (flip) indices.push(a, b, c, b, d, c)
      else indices.push(a, c, b, b, c, d)
    }
  }
  // 封口：翼尖一定封，翼根按需（翼根通常埋在机身里）
  const cap = (k: number, reverse: boolean) => {
    const base = positions.length / 3
    let cx = 0
    let cy = 0
    let cz = 0
    for (let j = 0; j < ring; j++) {
      cx += positions[(k * ring + j) * 3]
      cy += positions[(k * ring + j) * 3 + 1]
      cz += positions[(k * ring + j) * 3 + 2]
    }
    positions.push(cx / ring, cy / ring, cz / ring)
    for (let j = 0; j < ring; j++) {
      const a = k * ring + j
      const c = k * ring + ((j + 1) % ring)
      if (reverse) indices.push(base, a, c)
      else indices.push(base, c, a)
    }
  }
  cap(sections.length - 1, flip)
  if (opts.capStart) cap(0, !flip)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/* -------------------------------------------------------------------------- */
/*  机身涂装（Canvas 贴图）                                                     */
/* -------------------------------------------------------------------------- */

const TEX_W = 2048
const TEX_H = 512

function fuselageRadius(d: number): number {
  if (d < NOSE_LEN) return R * Math.pow(Math.sin((d / NOSE_LEN) * (Math.PI / 2)), 0.62)
  if (d < TAIL_START) return R
  const v = (d - TAIL_START) / (LENGTH - TAIL_START)
  return R * (1 - 0.93 * Math.pow(v, 1.6))
}

function fuselageCenterY(d: number): number {
  const r = fuselageRadius(d)
  if (d < NOSE_LEN) return CY - (R - r) * 0.2 // 机头略微下垂
  if (d > TAIL_START) return CY + (R - r) * 0.9 // 尾锥上翘，背部保持平直
  return CY
}

/** 舷窗的位置（两侧共用），emissive 贴图也按它画，夜里只有舷窗亮。 */
function forEachWindow(draw: (x: number, y: number, w: number, h: number) => void): void {
  const pxPerMeter = TEX_W / LENGTH
  const w = 0.24 * pxPerMeter
  const h = 15
  const doors = [5.2, 30.8]
  for (let d = 6.6; d < 30; d += 0.56) {
    if (doors.some((door) => Math.abs(d - door) < 0.9)) continue
    if (Math.abs(d - 14.6) < 0.5 || Math.abs(d - 16.9) < 0.5) continue // 翼上应急出口处窗距变化
    const x = d * pxPerMeter
    draw(x - w / 2, (1 - 0.295) * TEX_H - h / 2, w, h) // 右侧
    draw(x - w / 2, (1 - 0.705) * TEX_H - h / 2, w, h) // 左侧
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function paintLivery(ctx: CanvasRenderingContext2D, accent: string): void {
  const W = TEX_W
  const H = TEX_H
  const px = W / LENGTH
  ctx.save()
  ctx.fillStyle = '#f3f5f8'
  ctx.fillRect(0, 0, W, H)

  // 机腹浅灰
  const belly = ctx.createLinearGradient(0, 0, 0, H)
  belly.addColorStop(0, '#b9c0cb')
  belly.addColorStop(0.11, '#b9c0cb')
  belly.addColorStop(0.16, 'rgba(185,192,203,0)')
  belly.addColorStop(0.84, 'rgba(185,192,203,0)')
  belly.addColorStop(0.89, '#b9c0cb')
  belly.addColorStop(1, '#b9c0cb')
  ctx.fillStyle = belly
  ctx.fillRect(0, 0, W, H)

  // 尾部整块主题色，前缘是一道向后上方扫的弧线；前面再压一条细的呼应色带
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H
    const fromTop = Math.abs(v - 0.5) * 2 // 0 = 机背，1 = 机腹
    const start = W * (0.865 - 0.15 * Math.pow(fromTop, 1.4))
    ctx.fillStyle = accent
    ctx.fillRect(start, y, W - start, 1)
    ctx.globalAlpha = 0.45
    ctx.fillRect(start - 26, y, 9, 1)
    ctx.globalAlpha = 1
  }

  // 沿舷窗下方的腰线
  ctx.fillStyle = accent
  for (const v of [0.262, 0.738]) {
    ctx.fillRect(0.045 * W, (1 - v) * H - 2.5, 0.78 * W, 5)
  }

  // 舷窗
  forEachWindow((x, y, w, h) => {
    ctx.fillStyle = '#1b2431'
    roundRect(ctx, x, y, w, h, 4)
    ctx.fill()
    ctx.fillStyle = 'rgba(160,200,235,0.35)'
    ctx.fillRect(x + 1.5, y + 1.5, w - 3, 3)
  })

  // 舱门轮廓
  ctx.strokeStyle = 'rgba(70,80,96,0.75)'
  ctx.lineWidth = 2
  for (const d of [5.2, 30.8]) {
    for (const v of [0.285, 0.715]) {
      roundRect(ctx, d * px - 0.43 * px, (1 - v) * H - 36, 0.86 * px, 72, 7)
      ctx.stroke()
    }
  }

  // 驾驶舱风挡：正面两块 + 两侧各两块
  ctx.fillStyle = '#16202c'
  const pane = (pts: Array<[number, number]>) => {
    ctx.beginPath()
    pts.forEach(([d, v], i) => {
      const x = d * px
      const y = (1 - v) * H
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fill()
  }
  for (const m of [1, -1]) {
    const v = (dv: number) => 0.5 + m * dv
    pane([[1.75, v(0.012)], [2.75, v(0.012)], [2.95, v(0.1)], [1.95, v(0.085)]])
    pane([[2.0, v(0.095)], [3.0, v(0.11)], [3.35, v(0.168)], [2.45, v(0.165)]])
    pane([[3.1, v(0.115)], [3.95, v(0.125)], [4.0, v(0.172)], [3.45, v(0.172)]])
  }

  // 机身标题：两侧的贴图朝向相反，分别镜像，保证从机外看都是正字
  ctx.fillStyle = accent
  ctx.font = 'italic 800 46px "Helvetica Neue", Arial, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const titleX = 10.4 * px
  ctx.save()
  ctx.translate(titleX, (1 - 0.362) * H)
  ctx.scale(-1, 1)
  ctx.fillText('STARLOG', 0, 0)
  ctx.restore()
  ctx.save()
  ctx.translate(titleX, (1 - 0.638) * H)
  ctx.scale(1, -1)
  ctx.fillText('STARLOG', 0, 0)
  ctx.restore()
  ctx.restore()
}

function paintWindowGlow(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  let index = 0
  forEachWindow((x, y, w, h) => {
    // 少数舷窗拉下了遮光板
    const lit = (Math.sin(index * 12.9898) * 43758.5453) % 1
    index++
    if (Math.abs(lit) < 0.14) return
    ctx.fillStyle = '#ffe2a6'
    roundRect(ctx, x, y, w, h, 4)
    ctx.fill()
  })
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.18)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeFanTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#10141b'
    ctx.fillRect(0, 0, 128, 128)
    ctx.translate(64, 64)
    for (let i = 0; i < 22; i++) {
      ctx.rotate((Math.PI * 2) / 22)
      ctx.fillStyle = i % 2 ? '#4a5362' : '#343c49'
      ctx.beginPath()
      ctx.moveTo(4, -3)
      ctx.quadraticCurveTo(34, -14, 62, -4)
      ctx.lineTo(62, 5)
      ctx.quadraticCurveTo(34, -3, 4, 4)
      ctx.closePath()
      ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* -------------------------------------------------------------------------- */
/*  机翼平面形状                                                               */
/* -------------------------------------------------------------------------- */

const WING = {
  tipX: 17.05,
  kinkX: 6.2,
  rootY: 2.45,
  dihedral: Math.tan((5 * Math.PI) / 180),
  le: (x: number) => -7.2 + 0.5 * x,
  te: (x: number) => (x <= 6.2 ? 1.1 : 1.1 + ((x - 6.2) / (17.05 - 6.2)) * 1.78),
  y: (x: number) => 2.45 + Math.tan((5 * Math.PI) / 180) * x,
  thick: (x: number) => (x <= 6.2 ? 0.13 - (x / 6.2) * 0.02 : 0.11 - ((x - 6.2) / (17.05 - 6.2)) * 0.015),
}

/* -------------------------------------------------------------------------- */
/*  整机                                                                        */
/* -------------------------------------------------------------------------- */

export interface Aircraft {
  group: THREE.Group
  /** 按飞行状态摆好活动部件（扰流板、反推、轮胎、减震支柱、灯光闪烁） */
  update(state: FlightState, time: number): void
  /** 切换涂装主色（跟随站点配色主题） */
  setAccent(color: string): void
  /** 昼 / 夜：舷窗灯、航行灯大小、着陆灯光束 */
  setNight(night: boolean): void
  dispose(): void
}

export function createAircraft(accentColor: string): Aircraft {
  const group = new THREE.Group()
  const disposables: Array<{ dispose(): void }> = []
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  /* ---------------------------- 材质 ---------------------------- */
  const liveryCanvas = document.createElement('canvas')
  liveryCanvas.width = TEX_W
  liveryCanvas.height = TEX_H
  const liveryCtx = liveryCanvas.getContext('2d')
  const liveryTex = track(new THREE.CanvasTexture(liveryCanvas))
  liveryTex.colorSpace = THREE.SRGBColorSpace
  liveryTex.anisotropy = 8

  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = TEX_W
  glowCanvas.height = TEX_H
  const glowCtx = glowCanvas.getContext('2d')
  if (glowCtx) paintWindowGlow(glowCtx)
  const windowGlowTex = track(new THREE.CanvasTexture(glowCanvas))
  windowGlowTex.colorSpace = THREE.SRGBColorSpace

  const fuselageMat = track(
    new THREE.MeshStandardMaterial({
      map: liveryTex,
      emissiveMap: windowGlowTex,
      emissive: new THREE.Color('#ffd9a0'),
      emissiveIntensity: 0,
      roughness: 0.38,
      metalness: 0.12,
    }),
  )
  const whiteMat = track(new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.42, metalness: 0.12 }))
  const greyMat = track(new THREE.MeshStandardMaterial({ color: '#aab2bf', roughness: 0.5, metalness: 0.25 }))
  const accentMat = track(new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.36, metalness: 0.15 }))
  const metalMat = track(new THREE.MeshStandardMaterial({ color: '#c8ced8', roughness: 0.22, metalness: 0.9 }))
  const darkMetalMat = track(new THREE.MeshStandardMaterial({ color: '#3a404b', roughness: 0.55, metalness: 0.6 }))
  const blackMat = track(new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.85, metalness: 0 }))
  const fanTex = track(makeFanTexture())
  const fanMat = track(new THREE.MeshStandardMaterial({ map: fanTex, roughness: 0.5, metalness: 0.5 }))

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group): THREE.Mesh => {
    track(geo)
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true
    m.receiveShadow = true
    parent.add(m)
    return m
  }

  /* ---------------------------- 机身 ---------------------------- */
  const profile: RingPoint[] = []
  const rings = 72
  for (let i = 0; i <= rings; i++) {
    // 机头与尾锥曲率大，分段更密
    const u = i / rings
    const d = LENGTH * (u < 0.2 ? (u / 0.2) ** 1.6 * 0.14 : 0.14 + ((u - 0.2) / 0.8) * 0.86)
    const r = i === 0 ? 0.001 : fuselageRadius(d)
    profile.push({ z: NOSE_Z + d, r, y: fuselageCenterY(d) })
  }
  const fuselageGeo = revolve(profile, 40)
  // revolve 的 u 按 z 线性分布，正好与涂装贴图「x = 距机头距离」对应
  mesh(fuselageGeo, fuselageMat)
  // 尾锥末端（APU 排气口）
  const tailEnd = profile[profile.length - 1]
  const apu = mesh(new THREE.CircleGeometry(tailEnd.r, 16), darkMetalMat)
  apu.position.set(0, tailEnd.y ?? CY, tailEnd.z + 0.001)

  // 翼身整流罩
  const fairing = mesh(new THREE.SphereGeometry(1, 28, 16), whiteMat)
  fairing.scale.set(2.25, 0.86, 6.6)
  fairing.position.set(0, 2.32, -2.9)

  /* ---------------------------- 右半机翼（左侧整体镜像） ---------------------------- */
  const wingR = new THREE.Group()
  group.add(wingR)

  const wingSections: Section[] = [0, 1.6, 3.4, WING.kinkX, 9.6, 13.4, WING.tipX].map((x) => ({
    le: new THREE.Vector3(x, WING.y(x), WING.le(x)),
    chord: WING.te(x) - WING.le(x),
    thick: WING.thick(x),
  }))
  const Z = new THREE.Vector3(0, 0, 1)
  const Y = new THREE.Vector3(0, 1, 0)
  const X = new THREE.Vector3(1, 0, 0)
  mesh(loft(wingSections, Z, Y, { stations: 12 }), whiteMat, wingR)

  // 翼尖小翼
  const tipY = WING.y(WING.tipX)
  mesh(
    loft(
      [
        { le: new THREE.Vector3(WING.tipX - 0.05, tipY - 0.05, WING.le(WING.tipX) + 0.1), chord: 1.42, thick: 0.09 },
        { le: new THREE.Vector3(WING.tipX + 0.22, tipY + 0.9, WING.le(WING.tipX) + 0.85), chord: 1.05, thick: 0.08 },
        { le: new THREE.Vector3(WING.tipX + 0.55, tipY + 2.45, WING.le(WING.tipX) + 2.05), chord: 0.6, thick: 0.08 },
      ],
      Z,
      new THREE.Vector3(1, -0.2, 0),
      { stations: 8, camber: 0, capStart: true },
    ),
    accentMat,
    wingR,
  )

  // 襟翼（着陆构型：全放，向后下方伸出）
  const flapAngle = (34 * Math.PI) / 180
  const flapChordDir = new THREE.Vector3(0, -Math.sin(flapAngle), Math.cos(flapAngle))
  const flapThickDir = new THREE.Vector3(0, Math.cos(flapAngle), Math.sin(flapAngle))
  const flapSection = (x: number, chord: number): Section => ({
    le: new THREE.Vector3(x, WING.y(x) - 0.3, WING.te(x) - 0.1),
    chord,
    thick: 0.11,
  })
  for (const [x0, x1, c0, c1] of [
    [2.05, 6.05, 1.75, 1.5],
    [6.4, 12.9, 1.4, 0.95],
  ]) {
    mesh(
      loft([flapSection(x0, c0), flapSection(x1, c1)], flapChordDir, flapThickDir, { stations: 6, capStart: true }),
      whiteMat,
      wingR,
    )
  }
  // 襟翼滑轨整流罩
  for (const x of [3.9, 8.1, 11.2]) {
    const pod = mesh(new THREE.SphereGeometry(1, 12, 8), greyMat, wingR)
    pod.scale.set(0.2, 0.26, 1.5)
    pod.position.set(x, WING.y(x) - 0.48, WING.te(x) - 0.5)
    pod.rotation.x = 0.16
  }

  // 扰流板：铰链在前缘，接地后向上翻起
  const spoilerGeo = track(new THREE.BoxGeometry(1, 0.05, 0.78))
  spoilerGeo.translate(0, 0.025, 0.39)
  const spoilerPanels: Array<[number, number]> = [
    [2.5, 5.7],
    [6.6, 8.05],
    [8.15, 9.6],
    [9.7, 11.15],
    [11.25, 12.6],
  ]
  for (const [x0, x1] of spoilerPanels) {
    const xm = (x0 + x1) / 2
    const chord = WING.te(xm) - WING.le(xm)
    const hingeZ = WING.te(xm) - 0.95
    const frac = (hingeZ - WING.le(xm)) / chord
    const surface =
      5 * (0.2969 * Math.sqrt(frac) - 0.126 * frac - 0.3516 * frac ** 2 + 0.2843 * frac ** 3 - 0.1036 * frac ** 4) *
        WING.thick(xm) *
        chord +
      0.018 * 4 * frac * (1 - frac) * chord
    const pivot = new THREE.Group()
    pivot.position.set(xm, WING.y(xm) + surface + 0.01, hingeZ)
    pivot.rotation.set(0, -Math.atan((WING.te(x1) - WING.te(x0)) / (x1 - x0)), Math.atan(WING.dihedral), 'YZX')
    const panel = new THREE.Mesh(spoilerGeo, whiteMat)
    panel.scale.x = x1 - x0
    panel.castShadow = true
    panel.receiveShadow = true
    panel.userData.spoiler = true
    pivot.add(panel)
    wingR.add(pivot)
  }

  /* ---------------------------- 发动机 ---------------------------- */
  const engine = new THREE.Group()
  engine.position.set(5.75, 1.84, -9.1)
  wingR.add(engine)
  mesh(
    revolve(
      [
        { z: 0.1, r: 1.04 },
        { z: 0.34, r: 1.13 },
        { z: 0.9, r: 1.19 },
        { z: 1.6, r: 1.2 },
        { z: 2.3, r: 1.17 },
      ],
      32,
    ),
    accentMat,
    engine,
  )
  // 进气道唇口（抛光金属）
  mesh(
    revolve(
      [
        { z: 0.3, r: 0.9 },
        { z: 0.06, r: 0.93 },
        { z: 0, r: 0.985 },
        { z: 0.1, r: 1.04 },
      ],
      32,
    ),
    metalMat,
    engine,
  )
  // 进气道内壁
  mesh(
    revolve(
      [
        { z: 0.3, r: 0.9 },
        { z: 1.0, r: 0.88 },
      ],
      32,
      true,
    ),
    greyMat,
    engine,
  )
  const fan = mesh(new THREE.CircleGeometry(0.88, 32), fanMat, engine)
  fan.rotation.y = Math.PI
  fan.position.z = 0.98
  fan.userData.fan = true
  const spinner = mesh(new THREE.ConeGeometry(0.3, 0.62, 20), whiteMat, engine)
  spinner.rotation.x = -Math.PI / 2
  spinner.position.z = 0.72
  // 反推：后段外罩向后滑开，露出里面的叶栅
  mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.9, 28, 1, true).rotateX(Math.PI / 2).translate(0, 0, 2.7), blackMat, engine)
  const sleeve = new THREE.Group()
  sleeve.userData.sleeve = true
  engine.add(sleeve)
  mesh(
    revolve(
      [
        { z: 2.3, r: 1.17 },
        { z: 3.0, r: 1.1 },
        { z: 3.7, r: 0.96 },
        { z: 4.0, r: 0.87 },
        { z: 4.0, r: 0.8 },
      ],
      32,
    ),
    whiteMat,
    sleeve,
  )
  // 核心机喷口与尾锥
  mesh(
    revolve(
      [
        { z: 2.6, r: 0.78 },
        { z: 4.3, r: 0.6 },
        { z: 4.75, r: 0.5 },
        { z: 4.75, r: 0.44 },
      ],
      24,
    ),
    darkMetalMat,
    engine,
  )
  const plug = mesh(new THREE.ConeGeometry(0.36, 1.1, 18), darkMetalMat, engine)
  plug.rotation.x = Math.PI / 2
  plug.position.z = 4.95
  // 挂架
  const pylon = mesh(new THREE.BoxGeometry(0.34, 0.9, 5.2), whiteMat, wingR)
  pylon.position.set(5.75, 2.72, -5.4)
  pylon.rotation.x = -0.06

  /* ---------------------------- 主起落架 ---------------------------- */
  const wheelGeo = track(new THREE.CylinderGeometry(FLIGHT.mainWheelRadius, FLIGHT.mainWheelRadius, 0.44, 24).rotateZ(Math.PI / 2))
  const hubGeo = track(new THREE.CylinderGeometry(0.3, 0.3, 0.46, 16).rotateZ(Math.PI / 2))
  const hubMarkGeo = track(new THREE.BoxGeometry(0.47, 0.5, 0.09))
  const makeWheel = (radius: number): THREE.Group => {
    const wheel = new THREE.Group()
    const scale = radius / FLIGHT.mainWheelRadius
    const tire = new THREE.Mesh(wheelGeo, blackMat)
    const hub = new THREE.Mesh(hubGeo, metalMat)
    const mark = new THREE.Mesh(hubMarkGeo, darkMetalMat)
    for (const part of [tire, hub, mark]) {
      part.castShadow = true
      wheel.add(part)
    }
    wheel.scale.setScalar(scale)
    return wheel
  }

  const mainGear = new THREE.Group()
  mainGear.userData.gear = 'main'
  mainGear.position.set(3.8, 0, 0)
  wingR.add(mainGear)
  const strutTop = WING.y(3.8) - 0.3
  const strut = mesh(new THREE.CylinderGeometry(0.15, 0.17, strutTop - 0.5, 14), metalMat, mainGear)
  strut.position.y = (strutTop + 0.5) / 2
  const brace = mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 10), metalMat, mainGear)
  brace.position.set(-0.75, 1.75, 0)
  brace.rotation.z = -0.72
  const axle = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 10).rotateZ(Math.PI / 2), darkMetalMat, mainGear)
  axle.position.y = FLIGHT.mainWheelRadius
  const gearDoor = mesh(new THREE.BoxGeometry(0.05, 1.5, 0.9), whiteMat, mainGear)
  gearDoor.position.set(0.3, 1.75, 0)
  for (const dx of [-0.47, 0.47]) {
    const wheel = makeWheel(FLIGHT.mainWheelRadius)
    wheel.position.set(dx, FLIGHT.mainWheelRadius, 0)
    wheel.userData.wheel = 'main'
    mainGear.add(wheel)
  }

  // 左半机翼 = 右半机翼镜像（共享几何体与材质）
  const wingL = wingR.clone()
  wingL.scale.x = -1
  group.add(wingL)

  /* ---------------------------- 尾翼 ---------------------------- */
  const tailCenter = fuselageCenterY(31.9 + 1.2)
  const stabR = mesh(
    loft(
      [
        { le: new THREE.Vector3(0, tailCenter + 0.12, 14.2), chord: 3.9, thick: 0.1 },
        { le: new THREE.Vector3(6.22, tailCenter + 0.78, 17.35), chord: 1.5, thick: 0.09 },
      ],
      Z,
      Y,
      { stations: 8, camber: 0 },
    ),
    whiteMat,
  )
  const stabL = stabR.clone()
  stabL.scale.x = -1
  group.add(stabL)

  mesh(
    loft(
      [
        { le: new THREE.Vector3(0, 5.3, 10.5), chord: 6.2, thick: 0.1 },
        { le: new THREE.Vector3(0, 8.6, 13.25), chord: 4.0, thick: 0.095 },
        { le: new THREE.Vector3(0, 11.74, 15.9), chord: 2.0, thick: 0.09 },
      ],
      Z,
      X,
      { stations: 8, camber: 0 },
    ),
    accentMat,
  )

  /* ---------------------------- 前起落架 ---------------------------- */
  const noseGear = new THREE.Group()
  noseGear.userData.gear = 'nose'
  noseGear.position.set(0, 0, -FLIGHT.wheelbase)
  group.add(noseGear)
  const noseStrut = mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.85, 12), metalMat, noseGear)
  noseStrut.position.y = 0.38 + 0.925
  const noseAxle = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 10).rotateZ(Math.PI / 2), darkMetalMat, noseGear)
  noseAxle.position.y = FLIGHT.noseWheelRadius
  for (const dx of [-0.24, 0.24]) {
    const wheel = makeWheel(FLIGHT.noseWheelRadius)
    wheel.position.set(dx, FLIGHT.noseWheelRadius, 0)
    wheel.userData.wheel = 'nose'
    noseGear.add(wheel)
  }
  for (const dx of [-0.42, 0.42]) {
    const door = mesh(new THREE.BoxGeometry(0.04, 0.75, 1.5), whiteMat, noseGear)
    door.position.set(dx, 1.62, 0.2)
    door.rotation.z = dx > 0 ? -0.25 : 0.25
  }

  /* ---------------------------- 灯光 ---------------------------- */
  const glowTex = track(makeGlowTexture())
  interface Lamp {
    sprite: THREE.Sprite
    size: number
    kind: 'steady' | 'strobe' | 'beacon' | 'landing'
    phase: number
  }
  const lamps: Lamp[] = []
  const lamp = (color: string, x: number, y: number, z: number, size: number, kind: Lamp['kind'], phase = 0) => {
    const mat = track(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        transparent: true,
      }),
    )
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(x, y, z)
    group.add(sprite)
    lamps.push({ sprite, size, kind, phase })
  }
  const tipZ = WING.le(WING.tipX) + 0.5
  lamp('#ff2b2b', -WING.tipX - 0.2, tipY + 0.05, tipZ, 1.5, 'steady')
  lamp('#27ff6a', WING.tipX + 0.2, tipY + 0.05, tipZ, 1.5, 'steady')
  lamp('#ffffff', -WING.tipX - 0.3, tipY + 0.1, tipZ + 0.9, 3.4, 'strobe')
  lamp('#ffffff', WING.tipX + 0.3, tipY + 0.1, tipZ + 0.9, 3.4, 'strobe')
  lamp('#ffffff', 0, tailEnd.y ?? CY, tailEnd.z + 0.2, 1.4, 'steady')
  lamp('#ff3030', 0, CY + R + 0.15, -3.2, 2.6, 'beacon')
  lamp('#ff3030', 0, 1.42, -1.6, 2.6, 'beacon', 0.5)
  lamp('#fff3d6', -2.5, 2.55, -5.6, 3.6, 'landing')
  lamp('#fff3d6', 2.5, 2.55, -5.6, 3.6, 'landing')
  lamp('#fff3d6', 0, 1.55, -FLIGHT.wheelbase - 0.25, 2.4, 'landing')

  // 着陆灯光束（只在夜里打开）
  const beam = new THREE.SpotLight('#fff1d0', 0, 420, 0.3, 0.75, 1.6)
  beam.position.set(0, 2.4, -6)
  beam.target.position.set(0, -6, -120)
  group.add(beam)
  group.add(beam.target)

  /* ---------------------------- 活动部件索引 ---------------------------- */
  const spoilers: THREE.Object3D[] = []
  const sleeves: THREE.Object3D[] = []
  const fans: THREE.Object3D[] = []
  const mainWheels: THREE.Object3D[] = []
  const noseWheels: THREE.Object3D[] = []
  const mainGears: THREE.Object3D[] = []
  group.traverse((obj) => {
    if (obj.userData.spoiler) spoilers.push(obj)
    if (obj.userData.sleeve) sleeves.push(obj)
    if (obj.userData.fan) fans.push(obj)
    if (obj.userData.wheel === 'main') mainWheels.push(obj)
    if (obj.userData.wheel === 'nose') noseWheels.push(obj)
    if (obj.userData.gear === 'main') mainGears.push(obj)
  })

  let night = false
  const repaint = (color: string) => {
    if (!liveryCtx) return
    paintLivery(liveryCtx, color)
    liveryTex.needsUpdate = true
  }
  repaint(accentColor)

  return {
    group,
    update(state, time) {
      for (const panel of spoilers) panel.rotation.x = 0.1 - state.spoilers * 0.78
      for (const s of sleeves) s.position.z = state.reverse * 0.62
      // 风扇转速随反推略升；这里只求「看得出在转」，不追求真实转速（否则会频闪）
      const fanAngle = time * (5 + state.reverse * 3)
      for (const f of fans) f.rotation.z = fanAngle
      for (const w of mainWheels) w.rotation.x = -state.mainWheelAngle
      for (const w of noseWheels) w.rotation.x = -state.noseWheelAngle
      // 机身随减震支柱下沉（group.position 已经减去压缩量），轮组反向抬回，轮胎始终贴地
      for (const g of mainGears) g.position.y = state.mainCompress
      noseGear.position.y = state.noseCompress

      const scale = night ? 1.5 : 0.8
      for (const l of lamps) {
        let k = 1
        if (l.kind === 'strobe') {
          const ph = (time * 0.85) % 1
          k = ph < 0.035 || (ph > 0.11 && ph < 0.145) ? 1 : 0
        } else if (l.kind === 'beacon') {
          const ph = (time * 0.9 + l.phase) % 1
          k = ph < 0.12 ? 1 : 0.04
        } else if (l.kind === 'landing') {
          k = night ? 1.5 : 0.9
        }
        l.sprite.visible = k > 0
        l.sprite.scale.setScalar(l.size * scale * (0.35 + 0.65 * k))
        l.sprite.material.opacity = Math.min(1, k)
      }
    },
    setAccent(color) {
      accentMat.color.set(color)
      repaint(color)
    },
    setNight(value) {
      night = value
      fuselageMat.emissiveIntensity = value ? 1.6 : 0
      beam.intensity = value ? 1500 : 0
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
