/**
 * 「飞机降落」3D 动画的飞行剖面：纯数学，不依赖 three.js / DOM。
 *
 * 整段动画是时间 t 的**纯函数**——位置、姿态、扰流板、反推、轮胎转角都由 `sampleFlight(t)`
 * 直接给出，不存在逐帧累积的状态。于是进度条可以任意拖动、倒放、变速，
 * 单元测试也能在 Node 里直接断言「接地瞬间高度为 0」「下滑角是 3°」这类物理约束。
 *
 * 轨迹坐标：
 *   s —— 沿跑道方向的距离（米），跑道入口为 0，越往前越大；
 *   h —— 主起落架轮底离地高度（米）；
 *   俯仰以抬头为正，围绕主轮触地点转动（落地后放机头时正好是绕主轮转）。
 *
 * 时间线（秒）：
 *   0 ─ 进近（3° 下滑道，约 140 节）─ 12 ─ 拉平 ─ 16 主轮接地 ─ 放机头 ─ 19.6 前轮接地
 *   ─ 扰流板 + 反推 + 刹车减速 ─ 约 30 降到滑行速度 ─ 32 循环
 */

export const FLIGHT = {
  /** 一个循环的总时长（秒） */
  duration: 32,
  /** 开始拉平 */
  flareStart: 12,
  /** 主轮接地 */
  touchdown: 16,
  /** 开始放机头 */
  derotateStart: 16.5,
  /** 前轮接地 */
  noseTouchdown: 19.6,
  /** 进近速度（米/秒，约 140 节） */
  approachSpeed: 72,
  /** 接地速度（米/秒） */
  touchdownSpeed: 68.5,
  /** 减速后的滑行速度（米/秒） */
  taxiSpeed: 11,
  /** 最大减速度（米/秒²） */
  maxDecel: 4.2,
  /** 下滑角（度） */
  glideSlopeDeg: 3,
  /** 开始拉平时的高度（米） */
  flareHeight: 8.5,
  /** 接地瞬间的下沉率（米/秒） */
  sinkAtTouchdown: 0.6,
  /** 接地点距跑道入口的距离（米），正好在瞄准点标志上 */
  touchdownPoint: 400,
  /** 前后轮轴距（米） */
  wheelbase: 12.64,
  mainWheelRadius: 0.58,
  noseWheelRadius: 0.39,
} as const

export type FlightPhase = 'approach' | 'flare' | 'derotation' | 'rollout' | 'taxi'

export interface FlightState {
  t: number
  /** 沿跑道距离（米） */
  s: number
  /** 主轮离地高度（米） */
  h: number
  /** 偏离跑道中线的横向距离（米，向右为正） */
  lateral: number
  /** 地速（米/秒） */
  speed: number
  /** 垂直速度（米/秒，下降为负） */
  verticalSpeed: number
  /** 纵向减速度（米/秒²，减速为正） */
  decel: number
  /** 俯仰 / 滚转 / 偏航（弧度）：抬头为正、右坡度为正、机头偏右为正 */
  pitch: number
  roll: number
  yaw: number
  /** 扰流板展开程度 0–1 */
  spoilers: number
  /** 反推展开程度 0–1 */
  reverse: number
  /** 主起落架 / 前起落架减震支柱压缩量（米） */
  mainCompress: number
  noseCompress: number
  /** 主轮 / 前轮累计转角（弧度） */
  mainWheelAngle: number
  noseWheelAngle: number
  onGround: boolean
  noseOnGround: boolean
  phase: FlightPhase
}

const DEG = Math.PI / 180
const STEP = 1 / 120
const SAMPLES = Math.round(FLIGHT.duration / STEP) + 1

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** 速度 / 距离 / 减速度查找表：对加速度做一次数值积分，之后任意时刻都是 O(1) 查表。 */
const speedTable = new Float32Array(SAMPLES)
const distTable = new Float32Array(SAMPLES)
const decelTable = new Float32Array(SAMPLES)

;(function integrate() {
  let v: number = FLIGHT.approachSpeed
  let s = 0
  const flareDecel = (FLIGHT.approachSpeed - FLIGHT.touchdownSpeed) / (FLIGHT.touchdown - FLIGHT.flareStart)
  for (let i = 0; i < SAMPLES; i++) {
    const t = i * STEP
    let a = 0
    if (t >= FLIGHT.touchdown) {
      // 接地后刹车逐渐建立；接近滑行速度时松刹车，速度平滑收敛而不是一刀切
      a =
        FLIGHT.maxDecel *
        smoothstep(0, 1.4, t - FLIGHT.touchdown) *
        smoothstep(FLIGHT.taxiSpeed, FLIGHT.taxiSpeed + 7, v)
    } else if (t >= FLIGHT.flareStart) {
      a = flareDecel
    }
    speedTable[i] = v
    distTable[i] = s
    decelTable[i] = a
    s += v * STEP
    v -= a * STEP
  }
  // 平移整条轨迹，让接地点精确落在 touchdownPoint
  const shift = FLIGHT.touchdownPoint - distTable[Math.round(FLIGHT.touchdown / STEP)]
  for (let i = 0; i < SAMPLES; i++) distTable[i] += shift
})()

function lookup(table: Float32Array, t: number): number {
  const f = clamp(t, 0, FLIGHT.duration) / STEP
  const i = Math.min(SAMPLES - 2, Math.floor(f))
  return lerp(table[i], table[i + 1], f - i)
}

/** 沿跑道距离（米） */
export function distanceAt(t: number): number {
  return lookup(distTable, t)
}

/** 主轮离地高度（米）：进近段是直线下滑道，拉平段用三次 Hermite 曲线衔接到接地。 */
export function heightAt(t: number): number {
  const sink = FLIGHT.approachSpeed * Math.tan(FLIGHT.glideSlopeDeg * DEG)
  if (t <= FLIGHT.flareStart) return FLIGHT.flareHeight + sink * (FLIGHT.flareStart - t)
  if (t >= FLIGHT.touchdown) return 0
  const span = FLIGHT.touchdown - FLIGHT.flareStart
  const u = (t - FLIGHT.flareStart) / span
  const u2 = u * u
  const u3 = u2 * u
  return (
    FLIGHT.flareHeight * (2 * u3 - 3 * u2 + 1) +
    span * -sink * (u3 - 2 * u2 + u) +
    span * -FLIGHT.sinkAtTouchdown * (u3 - u2)
  )
}

function pitchAt(t: number, decel: number): number {
  const wobble = 0.35 * Math.sin(1.3 * t) + 0.2 * Math.sin(2.9 * t + 1)
  const airborne = 2.9 + wobble * (1 - smoothstep(FLIGHT.flareStart - 1, FLIGHT.touchdown, t))
  const flare = 3.4 * smoothstep(FLIGHT.flareStart - 0.3, FLIGHT.touchdown - 0.2, t)
  if (t < FLIGHT.derotateStart) return (airborne + flare) * DEG
  if (t < FLIGHT.noseTouchdown) {
    const u = (t - FLIGHT.derotateStart) / (FLIGHT.noseTouchdown - FLIGHT.derotateStart)
    // 放机头：先慢后快再轻放（smootherstep）
    const ease = u * u * u * (u * (u * 6 - 15) + 10)
    return (2.9 + 3.4) * (1 - ease) * DEG
  }
  // 前轮接地后：前支柱被压一下再回弹，刹车期间机头保持轻微下沉
  const since = t - FLIGHT.noseTouchdown
  const bounce = 0.42 * Math.exp(-3.2 * since) * Math.abs(Math.sin(7 * since))
  const brakeDip = 0.24 * (decel / FLIGHT.maxDecel) * smoothstep(0, 0.8, since)
  return -(bounce + brakeDip) * DEG
}

export function phaseAt(t: number, speed: number): FlightPhase {
  if (t < FLIGHT.flareStart) return 'approach'
  if (t < FLIGHT.touchdown) return 'flare'
  if (t < FLIGHT.noseTouchdown) return 'derotation'
  return speed > FLIGHT.taxiSpeed + 9 ? 'rollout' : 'taxi'
}

export const PHASE_LABELS: Record<FlightPhase, string> = {
  approach: '进近 · 3° 下滑道',
  flare: '拉平',
  derotation: '主轮接地 · 放机头',
  rollout: '扰流板 · 反推 · 刹车',
  taxi: '减速至滑行速度',
}

export function sampleFlight(time: number): FlightState {
  const t = clamp(time, 0, FLIGHT.duration)
  const s = distanceAt(t)
  const speed = lookup(speedTable, t)
  const decel = lookup(decelTable, t)
  const h = heightAt(t)
  // 中心差分；在时间轴两端退化为单侧差分（分母用实际跨度，否则端点处的读数会少一半）
  const eps = 1 / 60
  const t0 = Math.max(0, t - eps)
  const t1 = Math.min(FLIGHT.duration, t + eps)
  const verticalSpeed = (heightAt(t1) - heightAt(t0)) / (t1 - t0)

  // 空中的小幅扰动：越接近接地越收敛，接地时机翼放平、机头对正跑道（蹬舵消除偏流角）
  const settle = 1 - smoothstep(FLIGHT.flareStart - 2.5, FLIGHT.touchdown - 0.3, t)
  const roll = (1.7 * Math.sin(0.9 * t + 0.4) + 0.8 * Math.sin(2.1 * t + 1.3)) * DEG * settle
  const yaw = -3.2 * DEG * (1 - smoothstep(FLIGHT.flareStart + 0.5, FLIGHT.touchdown - 0.2, t))
  const lateral = 2.4 * Math.sin(0.5 * t + 0.6) * (1 - smoothstep(4, FLIGHT.touchdown - 1, t))

  const pitch = pitchAt(t, decel)

  const sinceTouchdown = t - FLIGHT.touchdown
  const onGround = sinceTouchdown >= 0
  const noseOnGround = t >= FLIGHT.noseTouchdown
  const mainCompress = onGround
    ? 0.2 * (1 - Math.exp(-7 * sinceTouchdown)) + 0.1 * Math.exp(-5 * sinceTouchdown) * Math.sin(11 * sinceTouchdown)
    : 0
  const noseCompress = noseOnGround ? Math.max(0, -pitch) * FLIGHT.wheelbase : 0

  const spoilers = smoothstep(0.25, 1.05, sinceTouchdown)
  const reverse = smoothstep(1.3, 2.8, sinceTouchdown) * (1 - smoothstep(FLIGHT.taxiSpeed + 16, FLIGHT.taxiSpeed + 8, speed))

  const mainWheelAngle = onGround ? (s - FLIGHT.touchdownPoint) / FLIGHT.mainWheelRadius : 0
  const noseWheelAngle = noseOnGround ? (s - distanceAt(FLIGHT.noseTouchdown)) / FLIGHT.noseWheelRadius : 0

  return {
    t,
    s,
    h,
    lateral,
    speed,
    verticalSpeed,
    decel,
    pitch,
    roll,
    yaw,
    spoilers,
    reverse,
    mainCompress,
    noseCompress,
    mainWheelAngle,
    noseWheelAngle,
    onGround,
    noseOnGround,
    phase: phaseAt(t, speed),
  }
}

/** 米/秒 → 节 */
export function toKnots(mps: number): number {
  return mps * 1.943844
}

/** 米 → 英尺 */
export function toFeet(m: number): number {
  return m * 3.28084
}
