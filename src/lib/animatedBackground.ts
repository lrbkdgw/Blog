import { useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

/**
 * 动态背景（雨夜 / 阳光 / 星空 / 极光 / 樱花 / 飘雪 / 粒子星链 / 海浪）的数据层：
 * 场景定义、参数范围、校验与本地保存。
 * 渲染在 components/AnimatedBackdrop.tsx，界面在设置页。
 *
 * 动态背景只保存在浏览器本地（不同步到 GitHub），因为它是纯视觉偏好，
 * 且相比颜色渐变更依赖设备性能。
 */

export type SceneId =
  | 'none'
  | 'rain'
  | 'sunshine'
  | 'stars'
  | 'aurora'
  | 'sakura'
  | 'snow'
  | 'network'
  | 'waves'
export type ActiveSceneId = Exclude<SceneId, 'none'>
/** 场景的配色基调：深色场景会让站点临时使用深色配色，保证文字可读。 */
export type SceneTone = 'light' | 'dark'

export interface SceneParam {
  key: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  default: number
}

export interface SceneSpec {
  id: ActiveSceneId
  name: string
  desc: string
  tone: SceneTone
  params: SceneParam[]
}

export const SCENES: SceneSpec[] = [
  {
    id: 'rain',
    name: '雨夜',
    desc: '深夜的雨：城市灯火、湿漉漉的街道、雨丝的辉光、落地溅起的涟漪，偶尔划过一道落地雷。',
    tone: 'dark',
    params: [
      { key: 'density', label: '雨量', hint: '雨滴数量，越大越密', min: 0, max: 100, step: 1, default: 55 },
      { key: 'speed', label: '下落速度', hint: '雨滴下落的快慢', min: 0, max: 100, step: 1, default: 55 },
      { key: 'wind', label: '风向倾斜', hint: '负数向左吹，正数向右吹，0 为垂直下落', min: -100, max: 100, step: 1, default: 12 },
      { key: 'lightning', label: '雷电', hint: '落地雷出现的频率，0 为关闭', min: 0, max: 100, step: 1, default: 20 },
      { key: 'glow', label: '光晕强度', hint: '雨滴辉光、雾团与地面反光的明显程度', min: 0, max: 100, step: 1, default: 55 },
    ],
  },
  {
    id: 'sunshine',
    name: '阳光',
    desc: '午后的暖光：体积光束缓缓转动，镜头光斑与浮尘散景交织。',
    tone: 'light',
    params: [
      { key: 'brightness', label: '光照强度', hint: '光晕与光束的明亮程度', min: 0, max: 100, step: 1, default: 60 },
      { key: 'rays', label: '光束数量', hint: '从太阳射出的光束多少，0 为无光束', min: 0, max: 100, step: 1, default: 50 },
      { key: 'motes', label: '光尘', hint: '漂浮在光中的尘埃散景数量', min: 0, max: 100, step: 1, default: 40 },
      { key: 'drift', label: '漂移速度', hint: '光束转动与尘埃飘动的速度', min: 0, max: 100, step: 1, default: 35 },
      { key: 'flare', label: '镜头光斑', hint: '沿光轴分布的色散光斑与光圈环', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'stars',
    name: '星空',
    desc: '安静的夜空：银河与星云铺底，亮星带四芒星芒，偶尔划过流星。',
    tone: 'dark',
    params: [
      { key: 'density', label: '星星数量', hint: '星星的多少', min: 0, max: 100, step: 1, default: 50 },
      { key: 'twinkle', label: '闪烁程度', hint: '星星明暗变化的幅度', min: 0, max: 100, step: 1, default: 50 },
      { key: 'meteor', label: '流星频率', hint: '流星出现的频率，0 为没有流星', min: 0, max: 100, step: 1, default: 30 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 60 },
      { key: 'nebula', label: '银河浓度', hint: '银河光带与星云的明显程度', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'aurora',
    name: '极光',
    desc: '夜空中的极光帘幕：带竖纹的帘幕缓慢流动，倒映在地平线上，颜色跟随站点配色主题。',
    tone: 'dark',
    params: [
      { key: 'intensity', label: '极光亮度', hint: '帘幕的整体明暗', min: 0, max: 100, step: 1, default: 70 },
      { key: 'flow', label: '流动速度', hint: '极光飘动的快慢', min: 0, max: 100, step: 1, default: 50 },
      { key: 'layers', label: '层次数量', hint: '叠在一起的极光层数，越多越厚', min: 0, max: 100, step: 1, default: 50 },
      { key: 'rays', label: '帘幕纹理', hint: '帘幕内部竖纹（射线）的细密程度', min: 0, max: 100, step: 1, default: 55 },
      { key: 'hue', label: '色相偏移', hint: '在主题色基础上偏转颜色，负数偏冷、正数偏暖', min: -100, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'sakura',
    name: '樱花',
    desc: '浅色场景：花瓣旋转着飘落，近处的花瓣更清晰、远处更虚，背景飘着逆光散景。',
    tone: 'light',
    params: [
      { key: 'count', label: '花瓣数量', hint: '屏幕上同时存在的花瓣数', min: 0, max: 100, step: 1, default: 40 },
      { key: 'speed', label: '飘落速度', hint: '花瓣下落与旋转的快慢', min: 0, max: 100, step: 1, default: 50 },
      { key: 'wind', label: '风向风力', hint: '负数向左吹，正数向右吹', min: -100, max: 100, step: 1, default: 15 },
      { key: 'size', label: '花瓣大小', hint: '整体缩放比例', min: 0, max: 100, step: 1, default: 50 },
      { key: 'bokeh', label: '背景散景', hint: '远处粉色光斑的明显程度', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'snow',
    name: '飘雪',
    desc: '浅色场景：细雪静静落下，近处的雪花是虚化的大光斑，少数会闪出十字星芒。',
    tone: 'light',
    params: [
      { key: 'density', label: '雪量', hint: '雪花数量', min: 0, max: 100, step: 1, default: 45 },
      { key: 'speed', label: '下落速度', hint: '雪花飘落的快慢', min: 0, max: 100, step: 1, default: 45 },
      { key: 'wind', label: '风向风力', hint: '负数向左吹，正数向右吹，会有阵风起伏', min: -100, max: 100, step: 1, default: 10 },
      { key: 'size', label: '雪花大小', hint: '整体缩放比例', min: 0, max: 100, step: 1, default: 50 },
      { key: 'glint', label: '闪光', hint: '雪花上星芒闪烁的多少', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'network',
    name: '粒子星链',
    desc: '深色场景：光点漂移并彼此连线，数据脉冲沿线滑动，鼠标附近会聚拢。',
    tone: 'dark',
    params: [
      { key: 'density', label: '光点数量', hint: '粒子的多少', min: 0, max: 100, step: 1, default: 45 },
      { key: 'link', label: '连线距离', hint: '多远的粒子之间会出现连线', min: 0, max: 100, step: 1, default: 50 },
      { key: 'speed', label: '漂移速度', hint: '粒子移动的快慢', min: 0, max: 100, step: 1, default: 35 },
      { key: 'glow', label: '辉光强度', hint: '粒子周围光晕与星芒的明显程度', min: 0, max: 100, step: 1, default: 55 },
      { key: 'pulse', label: '数据脉冲', hint: '沿连线滑动的亮点的多少', min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  {
    id: 'waves',
    name: '海浪',
    desc: '浅色场景：层叠的波浪带着浪尖高光与泡沫涌过，海面上洒满阳光的碎光。',
    tone: 'light',
    params: [
      { key: 'layers', label: '波浪层数', hint: '叠在一起的波浪数量', min: 0, max: 100, step: 1, default: 50 },
      { key: 'amplitude', label: '起伏幅度', hint: '波浪的高低', min: 0, max: 100, step: 1, default: 50 },
      { key: 'speed', label: '流动速度', hint: '波浪推进的快慢', min: 0, max: 100, step: 1, default: 45 },
      { key: 'depth', label: '占据高度', hint: '波浪在屏幕上占的比例', min: 0, max: 100, step: 1, default: 55 },
      { key: 'foam', label: '浪花泡沫', hint: '浪尖泡沫与碎光的多少', min: 0, max: 100, step: 1, default: 50 },
    ],
  },
]

export type SceneValues = Record<string, number>

export interface AnimatedBackgroundPreference {
  scene: SceneId
  /** 每个场景各自记住自己的参数，切换场景不会丢失已调好的数值。 */
  values: Partial<Record<ActiveSceneId, SceneValues>>
}

const STORAGE_NAME = 'animatedBackground'
const DEFAULT_PREFERENCE: AnimatedBackgroundPreference = { scene: 'none', values: {} }

export function findScene(id: SceneId): SceneSpec | undefined {
  return SCENES.find((scene) => scene.id === id)
}

export function defaultSceneValues(spec: SceneSpec): SceneValues {
  return Object.fromEntries(spec.params.map((param) => [param.key, param.default]))
}

/** 将任意输入限制在参数范围内（非数字回退为默认值） */
export function normalizeSceneValues(spec: SceneSpec, raw: unknown): SceneValues {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const result: SceneValues = {}
  for (const param of spec.params) {
    const value = Number(source[param.key])
    const clamped = Number.isFinite(value) ? Math.min(param.max, Math.max(param.min, value)) : param.default
    result[param.key] = Math.round(clamped / param.step) * param.step
  }
  return result
}

/** 当前场景的完整参数（缺失的项使用默认值） */
export function getSceneValues(pref: AnimatedBackgroundPreference, scene: ActiveSceneId): SceneValues {
  const spec = findScene(scene)
  if (!spec) return {}
  return normalizeSceneValues(spec, pref.values[scene])
}

function normalizePreference(raw: unknown): AnimatedBackgroundPreference {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFERENCE
  const data = raw as { scene?: unknown; values?: unknown }
  const scene = SCENES.some((item) => item.id === data.scene) || data.scene === 'none'
    ? (data.scene as SceneId)
    : 'none'
  const values: AnimatedBackgroundPreference['values'] = {}
  const source = data.values && typeof data.values === 'object' ? (data.values as Record<string, unknown>) : {}
  for (const spec of SCENES) {
    values[spec.id] = normalizeSceneValues(spec, source[spec.id])
  }
  return { scene, values }
}

export function readAnimatedBackground(): AnimatedBackgroundPreference {
  try {
    return normalizePreference(readPersonalSetting<unknown>(STORAGE_NAME))
  } catch {
    return DEFAULT_PREFERENCE
  }
}

function write(next: AnimatedBackgroundPreference) {
  writePersonalSetting(STORAGE_NAME, next)
}

export function setAnimatedScene(scene: SceneId) {
  const current = readAnimatedBackground()
  write({ ...current, scene })
}

export function setSceneValue(scene: ActiveSceneId, key: string, value: number) {
  const spec = findScene(scene)
  if (!spec) return
  const current = readAnimatedBackground()
  const values = { ...getSceneValues(current, scene), [key]: value }
  write({ ...current, values: { ...current.values, [scene]: normalizeSceneValues(spec, values) } })
}

export function resetSceneValues(scene: ActiveSceneId) {
  const spec = findScene(scene)
  if (!spec) return
  const current = readAnimatedBackground()
  write({ ...current, values: { ...current.values, [scene]: defaultSceneValues(spec) } })
}

/** 订阅动态背景设置（同一页面、其他标签页的修改都会立即生效）。 */
export function useAnimatedBackground(): AnimatedBackgroundPreference {
  const [pref, setPref] = useState(readAnimatedBackground)
  useEffect(() => {
    const sync = (event?: Event) => {
      const name = (event as CustomEvent<{ name?: string }> | undefined)?.detail?.name
      if (!name || name === STORAGE_NAME) setPref(readAnimatedBackground())
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return pref
}

/** 当前动态场景的配色基调；没有动态场景时返回 null（沿用用户的主题设置）。 */
export function sceneToneOf(scene: SceneId): SceneTone | null {
  return findScene(scene)?.tone ?? null
}
