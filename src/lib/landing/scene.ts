/**
 * 「飞机降落」3D 场景：渲染器、天空、光照、云、轮胎烟、机位调度与播放控制。
 *
 * 这个模块静态依赖 three.js，页面用 `import()` 懒加载它——线上站点里 three.js 因此落在
 * 独立的分包中，不访问该页面就不会下载；离线单文件版则和其他代码一起内联。
 *
 * 画面完全由时间 t 决定（见 flight.ts），这里不保存任何逐帧累积的模拟状态，
 * 所以暂停、变速、拖动进度条都只是「换一个 t 重新摆一遍」。
 */
import * as THREE from 'three'
import { AIRCRAFT_DIM, createAircraft } from './aircraft'
import { RUNWAY, createAirport } from './airport'
import { FLIGHT, clamp, distanceAt, lerp, sampleFlight, smoothstep, type FlightState } from './flight'

export type CameraMode = 'auto' | 'chase' | 'side' | 'tower' | 'cockpit' | 'free'

export interface FrameInfo {
  /** 当前机位的中文名 */
  shot: string
  /** 循环首尾的黑场程度 0–1（页面据此盖一层黑幕，循环衔接不突兀） */
  fade: number
}

export interface LandingOptions {
  canvas: HTMLCanvasElement
  night: boolean
  /** 涂装主色（站点配色主题的主色） */
  accent: string
  /** 初始时间与是否自动播放（系统开启「减少动态效果」时页面会传 autoplay: false） */
  startTime?: number
  autoplay?: boolean
  onFrame?: (state: FlightState, info: FrameInfo) => void
  onPlayingChange?: (playing: boolean) => void
  onContextLost?: () => void
}

export interface LandingController {
  play(): void
  pause(): void
  isPlaying(): boolean
  setTime(t: number): void
  getTime(): number
  setSpeed(rate: number): void
  setCamera(mode: CameraMode): void
  /** 自由视角：拖动旋转（像素增量）与缩放 */
  orbit(dx: number, dy: number): void
  zoom(factor: number): void
  setNight(night: boolean): void
  setAccent(color: string): void
  dispose(): void
}

/* -------------------------------------------------------------------------- */
/*  天空                                                                        */
/* -------------------------------------------------------------------------- */

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // 永远落在最远处
  }
`

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunColor;
  uniform vec3 uGlowColor;
  uniform vec3 uSunDir;
  uniform float uGlow;
  uniform float uDisc;
  uniform float uStars;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    // 三段渐变：地平线暖色 → 低空 → 天顶
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
    col = mix(col, uZenith, smoothstep(0.12, 0.85, h));
    col = mix(col, uHaze, smoothstep(0.015, -0.05, d.y));

    float cosSun = max(dot(d, uSunDir), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.55, d.y) * 0.75;
    col += uGlowColor * uGlow * (pow(cosSun, 5.0) * 0.55 * low + pow(cosSun, 48.0) * 0.9);
    col += uSunColor * uDisc * (smoothstep(0.99978, 0.99988, cosSun) * 8.0 + pow(cosSun, 1400.0) * 1.6);

    if (uStars > 0.0) {
      vec3 g = d * 190.0;
      vec3 cell = floor(g);
      float n = hash(cell);
      float r = length(fract(g) - 0.5);
      float star = smoothstep(0.32, 0.0, r) * step(0.988, n) * (0.4 + 0.6 * fract(n * 91.7));
      col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.03, 0.35, d.y);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface Palette {
  zenith: string
  mid: string
  horizon: string
  haze: string
  sunColor: string
  glowColor: string
  glow: number
  disc: number
  stars: number
  fog: string
  fogDensity: number
  /** 指向太阳（或月亮）的方向：决定天空里的光晕位置 */
  skyDir: [number, number, number]
  /** 主光源方向（白天 = 太阳；夜里 = 月光，比落日余晖的位置高得多） */
  lightDir: [number, number, number]
  lightColor: string
  lightIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  exposure: number
  env: number
  cloud: string
  cloudOpacity: number
  smoke: string
}

const DAY: Palette = {
  zenith: '#1f5cc4',
  mid: '#86b6ee',
  horizon: '#ffdcae',
  haze: '#dcc6a2',
  sunColor: '#fff0cf',
  glowColor: '#ffab57',
  glow: 0.85,
  disc: 1,
  stars: 0,
  fog: '#ecd3ad',
  fogDensity: 0.00011,
  skyDir: [-0.38, 0.2, -0.9],
  lightDir: [-0.38, 0.24, -0.9],
  lightColor: '#ffd3a1',
  lightIntensity: 3.3,
  hemiSky: '#b4ccff',
  hemiGround: '#8a7558',
  hemiIntensity: 1.05,
  exposure: 0.92,
  env: 0.55,
  cloud: '#fff0dc',
  cloudOpacity: 0.92,
  smoke: '#e6e2da',
}

const NIGHT: Palette = {
  zenith: '#040817',
  mid: '#0e1838',
  horizon: '#22306a',
  haze: '#161f45',
  sunColor: '#ffffff',
  glowColor: '#ff7f45',
  glow: 0.55,
  disc: 0,
  stars: 1,
  fog: '#18214a',
  fogDensity: 0.00013,
  skyDir: [-0.38, -0.03, -0.9],
  lightDir: [-0.42, 0.72, 0.3],
  lightColor: '#9db6ff',
  lightIntensity: 0.8,
  hemiSky: '#4560ad',
  hemiGround: '#1a2038',
  hemiIntensity: 0.9,
  exposure: 1.05,
  env: 0.35,
  cloud: '#2c3765',
  cloudOpacity: 0.6,
  smoke: '#7d86a6',
}

function blobTexture(kind: 'cloud' | 'smoke'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = kind === 'cloud' ? 256 : 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const puff = (x: number, y: number, r: number, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(0.55, `rgba(255,255,255,${a * 0.5})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    if (kind === 'smoke') {
      puff(64, 64, 62, 0.9)
      puff(46, 54, 34, 0.5)
      puff(84, 72, 36, 0.5)
    } else {
      const blobs: Array<[number, number, number]> = [
        [70, 82, 44],
        [112, 66, 52],
        [156, 74, 46],
        [196, 86, 36],
        [128, 90, 60],
        [44, 92, 30],
        [220, 94, 26],
      ]
      for (const [x, y, r] of blobs) puff(x, y, r, 0.6)
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* -------------------------------------------------------------------------- */
/*  导演机位时间表                                                              */
/* -------------------------------------------------------------------------- */

type ShotId = 'chase' | 'threshold' | 'side' | 'front' | 'orbit'

const DIRECTOR: Array<{ id: ShotId; from: number; to: number }> = [
  { id: 'chase', from: 0, to: 6.5 },
  { id: 'threshold', from: 6.5, to: 12.2 },
  { id: 'side', from: 12.2, to: 19.4 },
  { id: 'front', from: 19.4, to: 26 },
  { id: 'orbit', from: 26, to: FLIGHT.duration },
]

const SHOT_LABELS: Record<ShotId | 'tower' | 'cockpit' | 'free', string> = {
  chase: '尾随机位',
  threshold: '跑道入口',
  side: '侧面跟拍',
  front: '跑道前方',
  orbit: '环绕航拍',
  tower: '塔台',
  cockpit: '驾驶舱',
  free: '自由视角',
}

/* -------------------------------------------------------------------------- */
/*  场景                                                                        */
/* -------------------------------------------------------------------------- */

export function createLandingScene(opts: LandingOptions): LandingController {
  const { canvas } = opts
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const fog = new THREE.FogExp2('#ffffff', 0.00015)
  scene.fog = fog
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 60000)

  const disposables: Array<{ dispose(): void }> = []
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  /* ---------------------------- 天空与环境反射 ---------------------------- */
  const skyUniforms = {
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uGlowColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uGlow: { value: 1 },
    uDisc: { value: 1 },
    uStars: { value: 0 },
  }
  const skyMat = track(
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  )
  const skyGeo = track(new THREE.SphereGeometry(1000, 40, 24))
  const sky = new THREE.Mesh(skyGeo, skyMat)
  sky.frustumCulled = false
  sky.renderOrder = -10
  scene.add(sky)

  const pmrem = track(new THREE.PMREMGenerator(renderer))
  const envScene = new THREE.Scene()
  envScene.add(new THREE.Mesh(skyGeo, skyMat))
  let envTarget: THREE.WebGLRenderTarget | null = null

  /* ---------------------------- 光照 ---------------------------- */
  const hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight('#ffffff', 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 520
  sun.shadow.camera.left = -64
  sun.shadow.camera.right = 64
  sun.shadow.camera.top = 64
  sun.shadow.camera.bottom = -64
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.06
  scene.add(sun)
  scene.add(sun.target)
  const lightDir = new THREE.Vector3(0, 1, 0)

  /* ---------------------------- 机场与飞机 ---------------------------- */
  const airport = createAirport()
  scene.add(airport.group)
  const aircraft = createAircraft(opts.accent)
  aircraft.group.rotation.order = 'YXZ'
  scene.add(aircraft.group)

  // 停机坪上停几架同款飞机，给画面一点尺度参照（共享几何体与材质）
  for (const [z, heading] of [
    [-900, Math.PI / 2],
    [-1100, Math.PI / 2],
    [-1400, Math.PI / 2],
  ] as Array<[number, number]>) {
    const parked = aircraft.group.clone()
    parked.position.set(300, 0, z)
    parked.rotation.set(0, heading, 0)
    parked.traverse((obj) => {
      // 停场飞机不亮灯、不带着陆灯光束
      if ((obj as THREE.Sprite).isSprite || (obj as THREE.SpotLight).isSpotLight) obj.visible = false
    })
    scene.add(parked)
  }

  /* ---------------------------- 云 ---------------------------- */
  const cloudTex = track(blobTexture('cloud'))
  const cloudMat = track(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false }))
  const cloudSeeds: Array<[number, number, number, number]> = [
    [-0.4, 5200, 900, 2100],
    [-0.95, 6800, 1300, 2700],
    [-1.5, 4300, 760, 1700],
    [-2.05, 7400, 1500, 3000],
    [-2.6, 5600, 1000, 2200],
    [-3.2, 6400, 1250, 2500],
    [0.25, 6000, 1100, 2300],
    [0.9, 7200, 1400, 2800],
    [1.5, 5000, 820, 1800],
    [2.2, 6600, 1200, 2600],
    [2.75, 4600, 700, 1600],
    [-1.2, 8600, 1900, 3400],
    [-2.35, 9000, 2100, 3600],
    [0.6, 8800, 2000, 3300],
  ]
  for (const [angle, dist, alt, size] of cloudSeeds) {
    const cloud = new THREE.Sprite(cloudMat)
    cloud.position.set(Math.sin(angle) * dist, alt, Math.cos(angle) * dist - RUNWAY.length / 2)
    cloud.scale.set(size, size * 0.42, 1)
    scene.add(cloud)
  }

  /* ---------------------------- 轮胎烟 ---------------------------- */
  const smokeTex = track(blobTexture('smoke'))
  interface Puff {
    sprite: THREE.Sprite
    birth: number
    x: number
    z: number
    side: number
    seed: number
    big: boolean
  }
  const puffs: Puff[] = []
  const smokeMats: THREE.SpriteMaterial[] = []
  const addPuff = (birth: number, x: number, side: number, seed: number, big: boolean) => {
    const mat = track(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }))
    smokeMats.push(mat)
    const sprite = new THREE.Sprite(mat)
    sprite.visible = false
    scene.add(sprite)
    const at = sampleFlight(birth)
    puffs.push({ sprite, birth, x: at.lateral + x, z: -at.s, side, seed, big })
  }
  for (let i = 0; i < 28; i++) {
    const side = i % 2 === 0 ? -1 : 1
    addPuff(FLIGHT.touchdown + Math.floor(i / 2) * 0.032, side * 3.8, side, (i * 0.618) % 1, true)
  }
  for (let i = 0; i < 8; i++) {
    const birth = FLIGHT.noseTouchdown + i * 0.03
    const s = sampleFlight(birth)
    const mat = track(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }))
    smokeMats.push(mat)
    const sprite = new THREE.Sprite(mat)
    sprite.visible = false
    scene.add(sprite)
    puffs.push({ sprite, birth, x: s.lateral, z: -s.s - FLIGHT.wheelbase, side: i % 2 ? 1 : -1, seed: (i * 0.37) % 1, big: false })
  }
  const SMOKE_LIFE = 2.8

  /* ---------------------------- 昼夜 ---------------------------- */
  let night = opts.night
  const applyPalette = () => {
    const p = night ? NIGHT : DAY
    skyUniforms.uZenith.value.set(p.zenith)
    skyUniforms.uMid.value.set(p.mid)
    skyUniforms.uHorizon.value.set(p.horizon)
    skyUniforms.uHaze.value.set(p.haze)
    skyUniforms.uSunColor.value.set(p.sunColor)
    skyUniforms.uGlowColor.value.set(p.glowColor)
    skyUniforms.uSunDir.value.set(...p.skyDir).normalize()
    skyUniforms.uGlow.value = p.glow
    skyUniforms.uDisc.value = p.disc
    skyUniforms.uStars.value = p.stars
    fog.color.set(p.fog)
    fog.density = p.fogDensity
    lightDir.set(...p.lightDir).normalize()
    sun.color.set(p.lightColor)
    sun.intensity = p.lightIntensity
    hemi.color.set(p.hemiSky)
    hemi.groundColor.set(p.hemiGround)
    hemi.intensity = p.hemiIntensity
    renderer.toneMappingExposure = p.exposure
    cloudMat.color.set(p.cloud)
    cloudMat.opacity = p.cloudOpacity
    for (const m of smokeMats) m.color.set(p.smoke)
    airport.setNight(night, p.fog)
    aircraft.setNight(night)
    // 用当前天空重新烘一张环境贴图，机身漆面的反射随昼夜变化
    envTarget?.dispose()
    envTarget = pmrem.fromScene(envScene, 0.03)
    scene.environment = envTarget.texture
    scene.environmentIntensity = p.env
    dirty = true
  }

  /* ---------------------------- 播放状态 ---------------------------- */
  let time = clamp(opts.startTime ?? 0, 0, FLIGHT.duration)
  let playing = opts.autoplay ?? true
  let speed = 1
  let mode: CameraMode = 'auto'
  let dirty = true
  let disposed = false
  let visible = true
  let raf = 0
  let last = 0
  const free = { azimuth: -2.25, elevation: 0.2, distance: 72 }

  const planePos = new THREE.Vector3()
  const target = new THREE.Vector3()
  const tmp = new THREE.Vector3()

  const fovFor = (dist: number, size: number, lo: number, hi: number) =>
    clamp((2 * Math.atan(size / Math.max(1, dist)) * 180) / Math.PI, lo, hi)

  /** 把相机摆到指定机位，返回机位名 */
  const placeCamera = (st: FlightState): string => {
    let shot: ShotId | 'tower' | 'cockpit' | 'free'
    let u = 0.5
    if (mode === 'auto') {
      const entry = DIRECTOR.find((d) => st.t >= d.from && st.t < d.to) ?? DIRECTOR[DIRECTOR.length - 1]
      shot = entry.id
      u = (st.t - entry.from) / (entry.to - entry.from)
    } else {
      shot = mode
    }
    camera.up.set(0, 1, 0)
    switch (shot) {
      case 'chase': {
        camera.position.set(planePos.x - 10 - 3 * u, planePos.y + 7.5 + 2 * u, planePos.z + 50 - 9 * u)
        target.set(planePos.x * 0.6, planePos.y + 3, planePos.z - 46)
        camera.fov = 40
        break
      }
      case 'threshold': {
        camera.position.set(-46, 1.7, -38)
        target.set(planePos.x, planePos.y + 4.2, planePos.z)
        camera.fov = fovFor(camera.position.distanceTo(target), 30, 13, 58)
        break
      }
      case 'side': {
        camera.position.set(-60, 3.2, planePos.z + lerp(-20, 12, u))
        target.set(planePos.x, planePos.y + 3.6, planePos.z + lerp(-3, 1, u))
        camera.fov = 33
        break
      }
      case 'front': {
        camera.position.set(17, 1.6, -distanceAt(25.9))
        target.set(planePos.x, planePos.y + 4, planePos.z - 4)
        camera.fov = fovFor(camera.position.distanceTo(target), 21, 9, 52)
        break
      }
      case 'orbit': {
        const a = lerp(-2.45, -0.95, smoothstep(0, 1, u))
        const r = lerp(66, 54, u)
        camera.position.set(planePos.x + Math.sin(a) * r, 15 + 3 * u, planePos.z + Math.cos(a) * r)
        target.set(planePos.x, planePos.y + 4, planePos.z)
        camera.fov = 36
        break
      }
      case 'tower': {
        camera.position.copy(RUNWAY.tower)
        target.set(planePos.x, planePos.y + 4, planePos.z)
        camera.fov = fovFor(camera.position.distanceTo(target), 34, 5, 40)
        break
      }
      case 'cockpit': {
        // 飞行员眼位：机身蒙皮是单面的，从里面往外看是透明的，不需要另建座舱
        tmp.set(-0.52, AIRCRAFT_DIM.centerY + 0.78, AIRCRAFT_DIM.noseZ + 2.3)
        camera.position.copy(aircraft.group.localToWorld(tmp))
        tmp.set(-0.52, AIRCRAFT_DIM.centerY + 0.78 - 5, AIRCRAFT_DIM.noseZ - 60)
        target.copy(aircraft.group.localToWorld(tmp))
        tmp.set(0, 1, 0).applyQuaternion(aircraft.group.quaternion)
        camera.up.copy(tmp)
        camera.fov = 62
        break
      }
      default: {
        const el = clamp(free.elevation, -0.02, 1.35)
        const r = free.distance
        camera.position.set(
          planePos.x + Math.sin(free.azimuth) * Math.cos(el) * r,
          Math.max(0.6, planePos.y + 4 + Math.sin(el) * r),
          planePos.z + Math.cos(free.azimuth) * Math.cos(el) * r,
        )
        target.set(planePos.x, planePos.y + 4, planePos.z)
        camera.fov = 40
      }
    }
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    return SHOT_LABELS[shot]
  }

  const renderFrame = () => {
    const st = sampleFlight(time)
    planePos.set(st.lateral, st.h - st.mainCompress, -st.s)
    aircraft.group.position.copy(planePos)
    // YXZ：先偏航、再俯仰、最后滚转。机头朝 -Z，所以抬头是绕 +X 的正向转动
    aircraft.group.rotation.set(st.pitch, -st.yaw, -st.roll)
    aircraft.update(st, time)
    aircraft.group.updateMatrixWorld(true)

    for (const p of puffs) {
      const age = time - p.birth
      if (age < 0 || age > SMOKE_LIFE) {
        p.sprite.visible = false
        continue
      }
      const k = age / SMOKE_LIFE
      p.sprite.visible = true
      p.sprite.position.set(
        p.x + p.side * (0.5 + p.seed) * age * 0.9,
        0.5 + (1.3 + p.seed) * Math.pow(age, 0.8),
        p.z - (7 + p.seed * 5) * (1 - Math.exp(-age * 1.8)),
      )
      const size = (p.big ? 2.4 : 1.4) + (p.big ? 6 : 3) * Math.pow(age, 0.7) * (0.7 + p.seed * 0.6)
      p.sprite.scale.setScalar(size)
      p.sprite.material.opacity = (p.big ? 0.5 : 0.35) * Math.pow(1 - k, 1.6) * Math.min(1, age * 14)
      p.sprite.material.rotation = p.seed * 6 + age * (p.side * 0.4)
    }

    const shot = placeCamera(st)

    sky.position.copy(camera.position)
    sun.target.position.copy(planePos)
    sun.position.copy(planePos).addScaledVector(lightDir, 240)

    const lightUniforms = airport.lights.uniforms
    lightUniforms.uTime.value = time
    lightUniforms.uScale.value = canvas.height / (2 * Math.tan((camera.fov * Math.PI) / 360))
    // 夜里灯光有眩光，远处的灯也保持几个像素大，跑道轮廓才会像真实夜航那样由灯勾出来
    lightUniforms.uMinPx.value = (night ? 3.4 : 1.8) * renderer.getPixelRatio()

    renderer.render(scene, camera)

    const fade = Math.max(1 - time / 0.7, (time - (FLIGHT.duration - 0.8)) / 0.8)
    opts.onFrame?.(st, { shot, fade: playing ? clamp(fade, 0, 1) : 0 })
  }

  const resize = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    dirty = true
    schedule()
  }

  const tick = (now: number) => {
    raf = 0
    if (disposed) return
    const dt = last ? Math.min(0.5, (now - last) / 1000) : 0
    last = now
    if (playing) {
      time += dt * speed
      if (time >= FLIGHT.duration) time %= FLIGHT.duration
      dirty = true
    }
    if (dirty) {
      dirty = false
      renderFrame()
    }
    // 暂停且画面没有变化时不再空转；任何会改变画面的操作都会重新 schedule()
    if (playing || dirty) schedule()
  }

  const schedule = () => {
    if (!raf && !disposed && visible) raf = requestAnimationFrame(tick)
  }

  const setVisible = (v: boolean) => {
    visible = v
    last = 0 // 重新可见时不把离开的那段时间算进 dt
    if (v) schedule()
  }

  const onVisibility = () => setVisible(!document.hidden)
  document.addEventListener('visibilitychange', onVisibility)
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
  resizeObserver?.observe(canvas)
  const intersection =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting) && !document.hidden))
      : null
  intersection?.observe(canvas)
  const onLost = (e: Event) => {
    e.preventDefault()
    opts.onContextLost?.()
  }
  canvas.addEventListener('webglcontextlost', onLost)

  applyPalette()
  resize()
  schedule()

  return {
    play() {
      if (playing) return
      playing = true
      last = 0
      opts.onPlayingChange?.(true)
      schedule()
    },
    pause() {
      if (!playing) return
      playing = false
      dirty = true
      opts.onPlayingChange?.(false)
    },
    isPlaying: () => playing,
    setTime(t) {
      time = clamp(t, 0, FLIGHT.duration - 0.001)
      dirty = true
      schedule()
    },
    getTime: () => time,
    setSpeed(rate) {
      speed = clamp(rate, 0.1, 4)
    },
    setCamera(next) {
      mode = next
      dirty = true
      schedule()
    },
    orbit(dx, dy) {
      free.azimuth -= dx * 0.006
      free.elevation = clamp(free.elevation + dy * 0.005, -0.02, 1.35)
      dirty = true
      schedule()
    },
    zoom(factor) {
      free.distance = clamp(free.distance * factor, 28, 320)
      dirty = true
      schedule()
    },
    setNight(value) {
      if (night === value) return
      night = value
      applyPalette()
      schedule()
    },
    setAccent(color) {
      aircraft.setAccent(color)
      dirty = true
      schedule()
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      resizeObserver?.disconnect()
      intersection?.disconnect()
      airport.dispose()
      aircraft.dispose()
      envTarget?.dispose()
      for (const item of disposables) item.dispose()
      renderer.dispose()
    },
  }
}
