/**
 * 机场与周边环境：跑道、标线、助航灯光、滑行道、航站楼、塔台、田野、树林、远山。
 * 同样全部程序化生成。
 *
 * 世界坐标：跑道沿 Z 轴，入口在 z = 0，飞机朝 -Z 方向落地；+X 是飞行员的右手边；单位米。
 */
import * as THREE from 'three'
import { FLIGHT } from './flight'

export const RUNWAY = {
  length: 2400,
  width: 45,
  shoulder: 7.5,
  /** 塔台顶部（「塔台」机位） */
  tower: new THREE.Vector3(262, 47, -640),
}

/** 可复现的伪随机数（同一个种子每次生成同样的田野与树林） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 水平矩形面片的批量构建器：标线、道面都是「很多矩形合成一个网格」 */
class QuadBatch {
  private positions: number[] = []
  private uvs: number[] = []
  private indices: number[] = []

  /**
   * 轴对齐矩形（世界坐标），uv 取世界坐标 / uvScale，便于贴图无缝平铺。
   *
   * 长条会被自动切成不超过 SPLIT 米的小段：几公里长的单个三角形在光栅化时深度插值误差
   * 可达数厘米，足以让相距几厘米的道面 / 标线 / 草地互相穿透（表现为跑道一块块消失）。
   */
  rect(x0: number, z0: number, x1: number, z1: number, y: number, uvScale = 8): this {
    const SPLIT = 60
    const nx = Math.max(1, Math.ceil(Math.abs(x1 - x0) / SPLIT))
    const nz = Math.max(1, Math.ceil(Math.abs(z1 - z0) / SPLIT))
    for (let i = 0; i < nx; i++) {
      const xa = x0 + ((x1 - x0) * i) / nx
      const xb = x0 + ((x1 - x0) * (i + 1)) / nx
      for (let j = 0; j < nz; j++) {
        const za = z0 + ((z1 - z0) * j) / nz
        const zb = z0 + ((z1 - z0) * (j + 1)) / nz
        this.quad([xa, za], [xb, za], [xb, zb], [xa, zb], y, uvScale)
      }
    }
    return this
  }

  /** 任意四边形，四个角按逆时针（从上往下看）或顺时针给都可以，内部自动保证法线朝上 */
  quad(a: [number, number], b: [number, number], c: [number, number], d: [number, number], y: number, uvScale = 8): this {
    const base = this.positions.length / 3
    for (const [x, z] of [a, b, c, d]) {
      this.positions.push(x, y, z)
      this.uvs.push(x / uvScale, z / uvScale)
    }
    // 叉积的 y 分量为正 → 法线朝上
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
    if (up > 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    return this
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geo.setIndex(this.indices)
    geo.computeVertexNormals()
    return geo
  }
}

function noiseTexture(size: number, base: [number, number, number], spread: number, seed: number, streaks = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const rnd = mulberry32(seed)
    const img = ctx.createImageData(size, size)
    for (let i = 0; i < size * size; i++) {
      const n = (rnd() - 0.5) * spread + (rnd() < 0.02 ? spread * 0.9 : 0)
      img.data[i * 4] = base[0] + n
      img.data[i * 4 + 1] = base[1] + n
      img.data[i * 4 + 2] = base[2] + n
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (streaks) {
      // 道面上的修补缝与油渍
      ctx.globalAlpha = 0.12
      ctx.strokeStyle = '#000'
      for (let i = 0; i < 9; i++) {
        ctx.lineWidth = 1 + rnd() * 2
        ctx.beginPath()
        const x = rnd() * size
        ctx.moveTo(x, 0)
        ctx.lineTo(x + (rnd() - 0.5) * 14, size)
        ctx.stroke()
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

/** 大地底图：机场周围是草地，远处是一块块田、树林、河与公路 */
function terrainTexture(extent: number): THREE.CanvasTexture {
  const size = 2048
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const rnd = mulberry32(20261111)
  if (ctx) {
    const px = size / extent
    // 贴图中心 = 世界 (0, -1200)（跑道中点）；画布 x → 世界 +X，画布 y → 世界 +Z
    const toX = (wx: number) => size / 2 + wx * px
    const toY = (wz: number) => size / 2 + (wz + RUNWAY.length / 2) * px
    ctx.fillStyle = '#7b9a57'
    ctx.fillRect(0, 0, size, size)
    // 田块
    const fields = ['#7c9a52', '#8aa35a', '#667f44', '#a3a660', '#b7ad6c', '#5f7a46', '#94a868', '#7f8f4a', '#c2b477']
    for (let i = 0; i < 520; i++) {
      const cx = rnd() * size
      const cy = rnd() * size
      const w = 30 + rnd() * 110
      const h = 20 + rnd() * 80
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(((rnd() < 0.5 ? 0.21 : -0.38) + (rnd() - 0.5) * 0.08) * Math.PI)
      ctx.globalAlpha = 0.55 + rnd() * 0.4
      ctx.fillStyle = fields[Math.floor(rnd() * fields.length)]
      ctx.fillRect(-w / 2, -h / 2, w, h)
      // 垄沟
      if (rnd() < 0.5) {
        ctx.globalAlpha = 0.1
        ctx.fillStyle = '#2b3a1c'
        for (let s = -h / 2; s < h / 2; s += 4) ctx.fillRect(-w / 2, s, w, 1)
      }
      ctx.restore()
    }
    // 树林
    for (let i = 0; i < 140; i++) {
      const cx = rnd() * size
      const cy = rnd() * size
      ctx.globalAlpha = 0.5
      ctx.fillStyle = rnd() < 0.5 ? '#3f6136' : '#48693a'
      for (let k = 0; k < 9; k++) {
        ctx.beginPath()
        ctx.arc(cx + (rnd() - 0.5) * 70, cy + (rnd() - 0.5) * 50, 10 + rnd() * 22, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    // 河
    ctx.strokeStyle = '#5f8fae'
    ctx.lineWidth = 16
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(toX(-8000), toY(2600))
    ctx.bezierCurveTo(toX(-3600), toY(1500), toX(-2600), toY(-2600), toX(-1500), toY(-3400))
    ctx.bezierCurveTo(toX(-600), toY(-4100), toX(1800), toY(-4600), toX(8000), toY(-5200))
    ctx.stroke()
    // 公路
    ctx.strokeStyle = '#b9b7ac'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(toX(700), toY(8000))
    ctx.bezierCurveTo(toX(900), toY(2000), toX(520), toY(200), toX(560), toY(-1200))
    ctx.bezierCurveTo(toX(600), toY(-3000), toX(1500), toY(-5000), toX(1700), toY(-9000))
    ctx.moveTo(toX(-8000), toY(900))
    ctx.bezierCurveTo(toX(-3000), toY(700), toX(-1500), toY(1400), toX(800), toY(1300))
    ctx.lineTo(toX(8000), toY(1900))
    ctx.stroke()
    // 机场范围内统一成修剪过的草地
    const grd = ctx.createRadialGradient(toX(60), toY(-1200), 80 * px, toX(60), toY(-1200), 1800 * px)
    grd.addColorStop(0, 'rgba(126,158,90,1)')
    grd.addColorStop(0.7, 'rgba(126,158,90,0.96)')
    grd.addColorStop(1, 'rgba(126,158,90,0)')
    ctx.save()
    ctx.translate(toX(60), toY(-1200))
    ctx.scale(0.42, 1)
    ctx.translate(-toX(60), -toY(-1200))
    ctx.fillStyle = grd
    ctx.fillRect(-size, -size, size * 4, size * 3)
    ctx.restore()
    // 整体颗粒
    const rnd2 = mulberry32(7)
    ctx.globalAlpha = 0.05
    for (let i = 0; i < 26000; i++) {
      ctx.fillStyle = rnd2() < 0.5 ? '#000' : '#fff'
      ctx.fillRect(rnd2() * size, rnd2() * size, 2, 2)
    }
    ctx.globalAlpha = 1
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function windowTexture(lit: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const rnd = mulberry32(99)
    ctx.fillStyle = lit ? '#000' : '#c9ccd2'
    ctx.fillRect(0, 0, 128, 64)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 16; col++) {
        const on = rnd() < 0.62
        ctx.fillStyle = lit ? (on ? '#ffd89a' : '#1a1508') : '#5d7184'
        ctx.fillRect(col * 8 + 1.5, row * 16 + 4, 5, 9)
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/* -------------------------------------------------------------------------- */
/*  助航灯光：一个 Points 画完所有灯                                             */
/* -------------------------------------------------------------------------- */

const LIGHT_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  attribute float aNight;
  uniform float uTime;
  uniform float uScale;
  uniform float uNight;
  uniform float uMinPx;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * mix(1.0, 1.6, uNight) * uScale / max(0.1, -mv.z);
    // 远处的灯在屏幕上不足一个像素时保持最小尺寸、改为降低亮度，避免闪烁
    float visible = clamp(size / uMinPx, 0.0, 1.0);
    gl_PointSize = clamp(size, uMinPx, uMinPx * 14.0);
    float flash = 1.0;
    if (aPhase >= 0.0) {
      // 进近灯的顺序闪光（「兔子灯」）：每秒两次从远端跑向入口
      float ph = fract(uTime * 2.0 - aPhase);
      flash = smoothstep(0.1, 0.0, ph) * 2.2;
    }
    float day = mix(0.55, 1.0, uNight);
    float nightOnly = mix(1.0, uNight, aNight);
    vAlpha = flash * day * nightOnly * mix(0.5, 1.0, visible);
    vColor = aColor;
  }
`

const LIGHT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(0.42, 0.0, d);
    float halo = pow(max(0.0, 1.0 - d), 2.4);
    float a = (core * 0.9 + halo * 0.55) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

class LightField {
  private positions: number[] = []
  private colors: number[] = []
  private sizes: number[] = []
  private phases: number[] = []
  private nights: number[] = []
  private tmp = new THREE.Color()

  add(x: number, y: number, z: number, color: string, size: number, opts: { phase?: number; nightOnly?: boolean } = {}): void {
    this.tmp.set(color)
    this.positions.push(x, y, z)
    this.colors.push(this.tmp.r, this.tmp.g, this.tmp.b)
    this.sizes.push(size)
    this.phases.push(opts.phase ?? -1)
    this.nights.push(opts.nightOnly ? 1 : 0)
  }

  build(): { points: THREE.Points; material: THREE.ShaderMaterial } {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(this.colors, 3))
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(this.sizes, 1))
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phases, 1))
    geo.setAttribute('aNight', new THREE.Float32BufferAttribute(this.nights, 1))
    const material = new THREE.ShaderMaterial({
      vertexShader: LIGHT_VERTEX,
      fragmentShader: LIGHT_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 600 },
        uNight: { value: 0 },
        uMinPx: { value: 2 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    })
    const points = new THREE.Points(geo, material)
    points.frustumCulled = false
    points.renderOrder = 5
    return { points, material }
  }
}

/* -------------------------------------------------------------------------- */
/*  跑道标线                                                                    */
/* -------------------------------------------------------------------------- */

/** 七段数码式的跑道号数字：a 上横、b 右上竖、c 右下竖、d 下横、e 左下竖、f 左上竖、g 中横 */
const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '2': 'abged',
  '7': 'abc',
  '9': 'abcdfg',
}

function addRunwayMarkings(batch: QuadBatch, y: number): void {
  const half = RUNWAY.width / 2
  const L = RUNWAY.length

  // dir = -1：从入口端落地的方向（本动画的方向）；dir = +1：对向跑道
  const end = (dir: 1 | -1) => {
    const origin = dir === -1 ? 0 : -L
    // 把「沿落地方向的距离 s、向飞行员右侧的偏移 r」换成世界坐标
    const rect = (r0: number, s0: number, r1: number, s1: number) => {
      const x0 = dir === -1 ? r0 : -r0
      const x1 = dir === -1 ? r1 : -r1
      batch.rect(Math.min(x0, x1), origin + dir * s0, Math.max(x0, x1), origin + dir * s1, y)
    }
    // 入口斑马线：每侧 6 条
    for (let i = 0; i < 6; i++) {
      const r = 3 + i * 3.1
      rect(r, 6, r + 1.8, 36)
      rect(-r - 1.8, 6, -r, 36)
    }
    // 跑道号
    const digits = dir === -1 ? '27' : '09'
    const dw = 3.4
    const dh = 9
    const stroke = 0.85
    const gap = 2.6
    const startR = -(dw * 2 + gap) / 2
    const baseS = 48
    for (let i = 0; i < digits.length; i++) {
      const r0 = startR + i * (dw + gap)
      const seg = DIGIT_SEGMENTS[digits[i]]
      const mid = dh / 2
      if (seg.includes('a')) rect(r0, baseS + dh - stroke, r0 + dw, baseS + dh)
      if (seg.includes('d')) rect(r0, baseS, r0 + dw, baseS + stroke)
      if (seg.includes('g')) rect(r0, baseS + mid - stroke / 2, r0 + dw, baseS + mid + stroke / 2)
      if (seg.includes('b')) rect(r0 + dw - stroke, baseS + mid, r0 + dw, baseS + dh)
      if (seg.includes('c')) rect(r0 + dw - stroke, baseS, r0 + dw, baseS + mid)
      if (seg.includes('f')) rect(r0, baseS + mid, r0 + stroke, baseS + dh)
      if (seg.includes('e')) rect(r0, baseS, r0 + stroke, baseS + mid)
    }
    // 接地带标志：150 m 处 3 条、300/500 m 处 2 条、650/800 m 处 1 条（400 m 处让给瞄准点标志）
    for (const [s, count] of [
      [150, 3],
      [300, 2],
      [500, 2],
      [650, 1],
      [800, 1],
    ]) {
      for (let k = 0; k < count; k++) {
        const r = 9 + k * 3.3
        rect(r, s, r + 1.8, s + 22.5)
        rect(-r - 1.8, s, -r, s + 22.5)
      }
    }
    // 瞄准点标志（下滑道指向这里）
    rect(9, 400, 15.5, 450)
    rect(-15.5, 400, -9, 450)
  }
  end(-1)
  end(1)

  // 中线虚线与两侧边线
  for (let z = -72; z > -L + 72; z -= 50) batch.rect(-0.45, z - 30, 0.45, z, y)
  batch.rect(-half + 1, -L, -half + 1.9, 0, y)
  batch.rect(half - 1.9, -L, half - 1, 0, y)
}

/* -------------------------------------------------------------------------- */
/*  组装                                                                        */
/* -------------------------------------------------------------------------- */

export interface Airport {
  group: THREE.Group
  /** 助航灯光的着色器材质（需要每帧更新 uTime / uScale） */
  lights: THREE.ShaderMaterial
  /** haze：当前雾色，远山的山脚会融进这个颜色 */
  setNight(night: boolean, haze: string): void
  dispose(): void
}

export function createAirport(): Airport {
  const group = new THREE.Group()
  const disposables: Array<{ dispose(): void }> = []
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, receiveShadow = true): THREE.Mesh => {
    track(geo)
    const m = new THREE.Mesh(geo, mat)
    m.receiveShadow = receiveShadow
    group.add(m)
    return m
  }
  const rnd = mulberry32(42)
  const half = RUNWAY.width / 2
  const L = RUNWAY.length

  /* ---------------------------- 大地 ---------------------------- */
  const EXTENT = 22000
  const terrainTex = track(terrainTexture(EXTENT))
  const groundMat = track(new THREE.MeshLambertMaterial({ map: terrainTex }))
  // 底图 10 米一个像素，贴近地面看是一片纯色；这里叠两层平铺噪声（草的颗粒 + 成片的深浅），
  // 远处经 mipmap 平均后恰好回到 1，不改变底图的整体颜色
  const detailTex = track(noiseTexture(256, [128, 128, 128], 150, 3))
  detailTex.colorSpace = THREE.NoColorSpace
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTex }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float grassFine = texture2D(uDetail, vMapUv * 2600.0).g;
        float grassPatch = texture2D(uDetail, vMapUv * 173.0).g;
        float grassBroad = texture2D(uDetail, vMapUv * 31.0).g;
        diffuseColor.rgb *= (0.62 + 0.76 * grassFine) * (0.8 + 0.4 * grassPatch) * (0.86 + 0.28 * grassBroad);`,
      )
  }
  // 细分成约 170 米的网格，理由同 QuadBatch.rect：避免巨型三角形的深度误差
  const ground = add(new THREE.PlaneGeometry(EXTENT, EXTENT, 128, 128).rotateX(-Math.PI / 2), groundMat)
  ground.position.set(0, -0.15, -L / 2)
  // 贴图外再垫一圈纯色，地平线不会露底（做成环形，相机脚下没有它，不会和底图抢深度）
  const farMat = track(new THREE.MeshLambertMaterial({ color: '#7b9a57' }))
  const far = add(new THREE.RingGeometry(EXTENT * 0.49, 48000, 96, 6).rotateX(-Math.PI / 2), farMat, false)
  far.position.set(0, -0.6, -L / 2)

  /* ---------------------------- 道面 ---------------------------- */
  const asphaltTex = track(noiseTexture(256, [74, 77, 84], 22, 1, true))
  const concreteTex = track(noiseTexture(256, [128, 130, 132], 16, 2, true))
  const asphaltMat = track(new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 }))
  const shoulderMat = track(new THREE.MeshStandardMaterial({ map: asphaltTex, color: '#b8bcc4', roughness: 0.95 }))
  const concreteMat = track(new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }))

  const TAXI_X = 172
  const TAXI_HALF = 11.5
  const connectors = [-60, -830, -1420, -2340]

  // 道肩 / 防吹坪（比跑道略低，避免共面闪烁）
  add(
    new QuadBatch().rect(-half - RUNWAY.shoulder, -L - 60, half + RUNWAY.shoulder, 60, -0.05).build(),
    shoulderMat,
  )
  add(new QuadBatch().rect(-half, -L, half, 0, 0).build(), asphaltMat)

  const concrete = new QuadBatch()
  concrete.rect(TAXI_X - TAXI_HALF, -L, TAXI_X + TAXI_HALF, 0, -0.02, 12)
  for (const z of connectors) concrete.rect(half + RUNWAY.shoulder - 1, z - 14, TAXI_X - TAXI_HALF + 1, z + 14, -0.035, 12)
  concrete.rect(TAXI_X + TAXI_HALF - 1, -1520, 345, -780, -0.035, 12)
  add(concrete.build(), concreteMat)

  /* ---------------------------- 标线 ---------------------------- */
  const whiteMarkMat = track(
    new THREE.MeshStandardMaterial({ color: '#e9e9e4', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  )
  const yellowMarkMat = track(
    new THREE.MeshStandardMaterial({ color: '#e5b62c', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  )
  const rubberMat = track(
    new THREE.MeshBasicMaterial({
      color: '#0c0d10',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  )

  // 接地带的轮胎橡胶痕（先画，标线压在上面会显得被磨花）
  const rubber = new QuadBatch()
  for (const endZ of [-(FLIGHT.touchdownPoint + 60), -(L - FLIGHT.touchdownPoint - 60)]) {
    for (let i = 0; i < 110; i++) {
      const side = rnd() < 0.5 ? -1 : 1
      const x = side * (3.8 + (rnd() - 0.5) * 3.2) + (rnd() - 0.5) * 0.8
      const z = endZ + (rnd() - 0.5) * 520
      const len = 30 + rnd() * 120
      rubber.rect(x - 0.22, z - len / 2, x + 0.22, z + len / 2, 0.012)
    }
  }
  add(rubber.build(), rubberMat).renderOrder = 1

  const white = new QuadBatch()
  addRunwayMarkings(white, 0.022)
  add(white.build(), whiteMarkMat).renderOrder = 2

  const yellow = new QuadBatch()
  // 防吹坪 V 形标志
  for (const [zBase, dir] of [
    [8, 1],
    [-L - 8, -1],
  ]) {
    for (let k = 0; k < 3; k++) {
      const z = zBase + dir * k * 16
      yellow.quad([-half, z + dir * 14], [-half, z + dir * 16.2], [0, z + dir * 2.2], [0, z], 0.022)
      yellow.quad([half, z + dir * 14], [half, z + dir * 16.2], [0, z + dir * 2.2], [0, z], 0.022)
    }
  }
  // 滑行道中线与联络道引导线
  yellow.rect(TAXI_X - 0.2, -L + 10, TAXI_X + 0.2, -10, 0.012)
  for (const z of connectors) yellow.rect(half - 2, z - 0.2, TAXI_X, z + 0.2, 0.012)
  // 停机位引导线
  for (let z = -850; z >= -1450; z -= 100) yellow.rect(TAXI_X, z - 0.2, 318, z + 0.2, 0.012)
  add(yellow.build(), yellowMarkMat).renderOrder = 2

  /* ---------------------------- 助航灯光 ---------------------------- */
  const field = new LightField()
  const Y_LIGHT = 0.35
  // 跑道边灯（末端 600 m 改黄色）、中线灯（末端 900 m 红白相间、最后 300 m 全红）
  for (let z = 0; z >= -L; z -= 60) {
    const color = z < -(L - 600) ? '#ffd27a' : '#fff6e0'
    field.add(-half - 1.5, Y_LIGHT, z, color, 1.5)
    field.add(half + 1.5, Y_LIGHT, z, color, 1.5)
  }
  for (let z = -15, i = 0; z >= -L + 15; z -= 15, i++) {
    const remaining = L + z
    const red = remaining < 300 || (remaining < 900 && i % 2 === 0)
    field.add(0, 0.1, z, red ? '#ff4a3c' : '#fff6e0', 0.85)
  }
  // 入口绿灯、末端红灯
  for (let x = -half; x <= half + 0.01; x += 3) {
    field.add(x, Y_LIGHT, 1.5, '#3dff8a', 1.6)
    field.add(x, Y_LIGHT, -L - 1.5, '#ff4a3c', 1.6)
  }
  // 接地带灯：900 m 内每 60 m 两侧各一排三灯
  for (let z = -60; z >= -900; z -= 60) {
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) field.add(side * (9 + k * 1.5), 0.1, z, '#fff6e0', 0.8)
  }
  // 进近灯光系统：中线短排灯延伸 720 m、300 m 处横排灯、顺序闪光灯
  for (let d = 30; d <= 720; d += 30) {
    const y = 0.6 + d * 0.004
    for (let k = -2; k <= 2; k++) field.add(k * 1.1, y, d, '#fff6e0', 1.5)
    if (d <= 270) {
      // 内段两侧的红色侧排灯
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) field.add(side * (10.5 + k * 1.2), y, d, '#ff4a3c', 1.3)
    }
    if (d >= 330) field.add(0, y + 0.3, d, '#ffffff', 3.2, { phase: (720 - d) / 30 / 14 })
  }
  for (let k = -9; k <= 9; k++) if (Math.abs(k) > 2) field.add(k * 1.6, 1.8, 300, '#fff6e0', 1.5)
  // PAPI：四灯，下滑道正确时两白两红
  const papiZ = -(FLIGHT.touchdownPoint + 15)
  ;['#ff3b30', '#ff3b30', '#ffffff', '#ffffff'].forEach((color, i) => {
    field.add(-half - 15 - i * 9, 0.9, papiZ, color, 2.6)
  })
  // 滑行道蓝色边灯
  for (let z = -15; z >= -L + 15; z -= 30) {
    field.add(TAXI_X - TAXI_HALF - 0.8, 0.3, z, '#3d6bff', 0.9)
    field.add(TAXI_X + TAXI_HALF + 0.8, 0.3, z, '#3d6bff', 0.9)
  }
  for (const z of connectors) {
    for (let x = half + RUNWAY.shoulder + 6; x < TAXI_X - TAXI_HALF; x += 20) {
      field.add(x, 0.3, z - 14.6, '#3d6bff', 0.9)
      field.add(x, 0.3, z + 14.6, '#3d6bff', 0.9)
    }
  }
  // 停机坪高杆灯、塔台灯
  for (let z = -800; z >= -1500; z -= 140) field.add(338, 26, z, '#ffe9bd', 5, { nightOnly: true })
  field.add(RUNWAY.tower.x, RUNWAY.tower.y + 6.5, RUNWAY.tower.z, '#ff3b30', 3)
  // 远处的城镇与公路灯火（只在夜里亮）
  const towns: Array<[number, number, number, number]> = [
    [1900, -700, 900, 380],
    [-2600, -2300, 1100, 300],
    [2600, -4200, 1500, 520],
    [-1500, 2400, 800, 220],
    [-4200, -5200, 1600, 420],
    [5200, 600, 1300, 360],
    [600, -6400, 1800, 520],
  ]
  for (const [cx, cz, radius, count] of towns) {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2
      const r = Math.pow(rnd(), 0.7) * radius
      const warm = rnd()
      field.add(
        cx + Math.cos(a) * r,
        3 + rnd() * 10,
        cz + Math.sin(a) * r * 0.75,
        warm < 0.62 ? '#ffc37a' : warm < 0.9 ? '#ffe7c2' : '#bfd6ff',
        4 + rnd() * 5,
        { nightOnly: true },
      )
    }
  }
  for (let i = 0; i < 150; i++) {
    const z = 3000 - i * 62
    field.add(560 + Math.sin(z / 900) * 160, 6, z, '#ffb65c', 5, { nightOnly: true })
  }
  const lights = field.build()
  track(lights.points.geometry)
  track(lights.material)
  group.add(lights.points)

  /* ---------------------------- 建筑 ---------------------------- */
  const wallTex = track(windowTexture(false))
  const wallGlowTex = track(windowTexture(true))
  const buildingMat = track(
    new THREE.MeshStandardMaterial({
      map: wallTex,
      emissiveMap: wallGlowTex,
      emissive: new THREE.Color('#ffd9a0'),
      emissiveIntensity: 0,
      roughness: 0.7,
    }),
  )
  const roofMat = track(new THREE.MeshStandardMaterial({ color: '#8a919c', roughness: 0.8 }))
  const glassMat = track(
    new THREE.MeshStandardMaterial({
      color: '#4f7f9c',
      roughness: 0.15,
      metalness: 0.6,
      emissive: new THREE.Color('#9fd0e8'),
      emissiveIntensity: 0,
    }),
  )
  const towerMat = track(new THREE.MeshStandardMaterial({ color: '#d9dde3', roughness: 0.7 }))

  const box = (w: number, h: number, d: number, x: number, z: number, mat: THREE.Material, uv?: [number, number]): THREE.Mesh => {
    const geo = new THREE.BoxGeometry(w, h, d)
    if (uv) {
      // 让窗户贴图按建筑尺寸重复
      const attr = geo.getAttribute('uv')
      for (let i = 0; i < attr.count; i++) attr.setXY(i, attr.getX(i) * uv[0], attr.getY(i) * uv[1])
    }
    const m = add(geo, mat)
    m.position.set(x, h / 2, z)
    m.castShadow = true
    return m
  }
  // 航站楼：主楼 + 玻璃幕墙 + 指廊
  box(46, 17, 560, 372, -1150, buildingMat, [6, 1.2])
  box(47, 1.2, 566, 372, -1150, roofMat).position.y = 17.6
  box(2, 11, 540, 348, -1150, glassMat).position.y = 6.5
  for (let z = -900; z >= -1400; z -= 100) box(26, 5, 5, 332, z + 22, towerMat).position.y = 5.5
  // 机库与油库
  for (const z of [-330, -430]) {
    box(80, 20, 70, 300, z, towerMat)
    const roof = add(new THREE.CylinderGeometry(40, 40, 70, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), roofMat)
    roof.scale.y = 0.3
    roof.position.set(300, 20, z)
    roof.castShadow = true
  }
  for (const [x, z] of [
    [420, -300],
    [445, -330],
    [420, -360],
  ]) {
    const tank = add(new THREE.CylinderGeometry(13, 13, 14, 20), towerMat)
    tank.position.set(x, 7, z)
    tank.castShadow = true
  }
  // 塔台
  const shaft = add(new THREE.CylinderGeometry(3.6, 4.6, 40, 16), towerMat)
  shaft.position.set(RUNWAY.tower.x, 20, RUNWAY.tower.z)
  shaft.castShadow = true
  const cabBase = add(new THREE.CylinderGeometry(7.6, 5, 4, 16), towerMat)
  cabBase.position.set(RUNWAY.tower.x, 41.5, RUNWAY.tower.z)
  cabBase.castShadow = true
  const cab = add(new THREE.CylinderGeometry(8.4, 7.2, 5.4, 16), glassMat)
  cab.position.set(RUNWAY.tower.x, 46.2, RUNWAY.tower.z)
  const cabRoof = add(new THREE.CylinderGeometry(6, 8.8, 1.4, 16), roofMat)
  cabRoof.position.set(RUNWAY.tower.x, 49.6, RUNWAY.tower.z)
  // 城镇里的楼房
  const cityGeo = track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))
  const cityMat = track(new THREE.MeshLambertMaterial({ color: '#b6b3ad' }))
  const city = new THREE.InstancedMesh(cityGeo, cityMat, 420)
  const dummy = new THREE.Object3D()
  let ci = 0
  for (const [cx, cz, radius] of towns) {
    const n = Math.round(60 * (radius / 1100))
    for (let i = 0; i < n && ci < 420; i++, ci++) {
      const a = rnd() * Math.PI * 2
      const r = Math.pow(rnd(), 0.8) * radius * 0.8
      const tall = rnd() < 0.12 ? 40 + rnd() * 70 : 8 + rnd() * 22
      dummy.position.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r * 0.75)
      dummy.scale.set(18 + rnd() * 40, tall, 18 + rnd() * 40)
      dummy.rotation.y = rnd() < 0.5 ? 0.21 * Math.PI : -0.38 * Math.PI
      dummy.updateMatrix()
      city.setMatrixAt(ci, dummy.matrix)
    }
  }
  city.count = ci
  city.instanceMatrix.needsUpdate = true
  group.add(city)

  /* ---------------------------- 树 ---------------------------- */
  const treeGeo = track(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0))
  const treeMat = track(new THREE.MeshLambertMaterial({ color: '#3d6b3a' }))
  const TREE_COUNT = 1500
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, TREE_COUNT)
  const tint = new THREE.Color()
  let ti = 0
  let guard = 0
  while (ti < TREE_COUNT && guard++ < 40000) {
    // 成团分布：先撒团心，再在团心附近撒树
    const cx = (rnd() - 0.5) * 9000
    const cz = -L / 2 + (rnd() - 0.5) * 11000
    const n = 6 + Math.floor(rnd() * 30)
    for (let k = 0; k < n && ti < TREE_COUNT; k++) {
      const x = cx + (rnd() - 0.5) * 260
      const z = cz + (rnd() - 0.5) * 260
      // 跑道净空区、滑行道与航站区不种树
      if (x > -330 && x < 560 && z < 1100 && z > -L - 500) continue
      const hgt = 9 + rnd() * 12
      dummy.position.set(x, 0, z)
      dummy.scale.set(hgt * 0.36, hgt, hgt * 0.36)
      dummy.rotation.y = rnd() * 6
      dummy.updateMatrix()
      trees.setMatrixAt(ti, dummy.matrix)
      tint.setHSL(0.27 + rnd() * 0.07, 0.34 + rnd() * 0.16, 0.2 + rnd() * 0.1)
      trees.setColorAt(ti, tint)
      ti++
    }
  }
  trees.count = ti
  trees.instanceMatrix.needsUpdate = true
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true
  treeMat.color.set('#ffffff')
  group.add(trees)

  /* ---------------------------- 远山 ---------------------------- */
  // 不吃场景雾：山脚取雾色、山顶取山色，自己做一层「空气透视」，否则落日时分远山会被雾染成沙丘
  const ridgeMats: THREE.ShaderMaterial[] = []
  const ridge = (radius: number, base: number, amp: number, seed: number) => {
    const segs = 260
    const positions: number[] = []
    const heights: number[] = []
    const indices: number[] = []
    const r2 = mulberry32(seed)
    const phases = [r2() * 6, r2() * 6, r2() * 6, r2() * 6, r2() * 6]
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const n =
        0.5 +
        0.26 * Math.sin(a * 3 + phases[0]) +
        0.2 * Math.sin(a * 7 + phases[1]) +
        0.13 * Math.sin(a * 17 + phases[2]) +
        0.08 * Math.sin(a * 37 + phases[3]) +
        0.05 * Math.sin(a * 83 + phases[4])
      const h = base + amp * Math.max(0.05, n)
      const x = Math.cos(a) * radius
      const z = Math.sin(a) * radius - L / 2
      positions.push(x, -30, z, x, h, z)
      heights.push(0, h / (base + amp))
    }
    for (let i = 0; i < segs; i++) {
      const k = i * 2
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1))
    geo.setIndex(indices)
    const mat = track(
      new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          attribute float aHeight;
          varying float vHeight;
          void main() {
            vHeight = aHeight;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          varying float vHeight;
          void main() {
            gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.0, 0.55, vHeight)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        side: THREE.DoubleSide,
      }),
    )
    ridgeMats.push(mat)
    const m = add(geo, mat, false)
    m.frustumCulled = false
  }
  ridge(15000, 150, 1500, 5)
  ridge(10500, 60, 720, 11)

  return {
    group,
    lights: lights.material,
    setNight(night, haze) {
      buildingMat.emissiveIntensity = night ? 1.3 : 0
      glassMat.emissiveIntensity = night ? 0.55 : 0
      ridgeMats[0].uniforms.uTop.value.set(night ? '#111a3a' : '#93a2c8')
      ridgeMats[1].uniforms.uTop.value.set(night ? '#0b1129' : '#6f7fa6')
      for (const m of ridgeMats) m.uniforms.uBottom.value.set(haze)
      lights.material.uniforms.uNight.value = night ? 1 : 0
    },
    dispose() {
      for (const item of disposables) item.dispose()
      city.dispose()
      trees.dispose()
    },
  }
}
