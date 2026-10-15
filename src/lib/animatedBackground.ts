import { useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

/**
 * 动态背景（雨夜 / 阳光 / 星空）的数据层：场景定义、参数范围、校验与本地保存。
 * 渲染在 components/AnimatedBackdrop.tsx，界面在设置页。
 *
 * 动态背景只保存在浏览器本地（不同步到 GitHub），因为它是纯视觉偏好，
 * 且相比颜色渐变更依赖设备性能。
 */

export type SceneId = 'none' | 'rain' | 'sunshine' | 'stars' | 'aurora' | 'snow' | 'fireflies' | 'sakura' | 'bubbles' | 'matrix' | 'ocean' | 'galaxy'
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
    desc: '深夜的细雨，偶尔伴有远处的闪电。',
    tone: 'dark',
    params: [
      { key: 'density', label: '雨量', hint: '雨滴数量，越大越密', min: 0, max: 100, step: 1, default: 55 },
      { key: 'speed', label: '下落速度', hint: '雨滴下落的快慢', min: 0, max: 100, step: 1, default: 55 },
      { key: 'wind', label: '风向倾斜', hint: '负数向左吹，正数向右吹，0 为垂直下落', min: -100, max: 100, step: 1, default: 12 },
      { key: 'lightning', label: '雷电', hint: '闪电出现的频率，0 为关闭', min: 0, max: 100, step: 1, default: 20 },
    ],
  },
  {
    id: 'sunshine',
    name: '阳光',
    desc: '午后的暖光，光束缓缓转动，尘埃在光中漂浮。',
    tone: 'light',
    params: [
      { key: 'brightness', label: '光照强度', hint: '光晕与光束的明亮程度', min: 0, max: 100, step: 1, default: 60 },
      { key: 'rays', label: '光束数量', hint: '从太阳射出的光束多少，0 为无光束', min: 0, max: 100, step: 1, default: 50 },
      { key: 'motes', label: '光尘', hint: '漂浮在光中的尘埃数量', min: 0, max: 100, step: 1, default: 40 },
      { key: 'drift', label: '漂移速度', hint: '光束转动与尘埃飘动的速度', min: 0, max: 100, step: 1, default: 35 },
    ],
  },
  {
    id: 'stars',
    name: '星空',
    desc: '安静的夜空，星星闪烁，偶尔划过流星。',
    tone: 'dark',
    params: [
      { key: 'density', label: '星星数量', hint: '星星的多少', min: 0, max: 100, step: 1, default: 50 },
      { key: 'twinkle', label: '闪烁程度', hint: '星星明暗变化的幅度', min: 0, max: 100, step: 1, default: 50 },
      { key: 'meteor', label: '流星频率', hint: '流星出现的频率，0 为没有流星', min: 0, max: 100, step: 1, default: 30 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 60 },
    ],
  },
  {
    id: 'aurora',
    name: '极光',
    desc: '夜空中的彩色极光带，缓慢流动，带有微光粒子。',
    tone: 'dark',
    params: [
      { key: 'intensity', label: '极光强度', hint: '光带的明亮程度', min: 0, max: 100, step: 1, default: 60 },
      { key: 'speed', label: '流动速度', hint: '极光带移动的快慢', min: 0, max: 100, step: 1, default: 35 },
      { key: 'particles', label: '微光粒子', hint: '漂浮的光点数量', min: 0, max: 100, step: 1, default: 40 },
      { key: 'brightness', label: '整体亮度', hint: '画面整体亮度', min: 0, max: 100, step: 1, default: 55 },
    ],
  },
  {
    id: 'snow',
    name: '飘雪',
    desc: '安静的雪夜，雪花缓缓飘落，地面泛着微光。',
    tone: 'dark',
    params: [
      { key: 'density', label: '雪量', hint: '雪花数量', min: 0, max: 100, step: 1, default: 50 },
      { key: 'speed', label: '下落速度', hint: '雪花下落的快慢', min: 0, max: 100, step: 1, default: 40 },
      { key: 'wind', label: '风向', hint: '负数向左吹，正数向右吹', min: -100, max: 100, step: 1, default: 8 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 60 },
    ],
  },
  {
    id: 'fireflies',
    name: '萤火虫',
    desc: '夏夜草丛中的点点萤光，忽明忽暗地漂浮。',
    tone: 'dark',
    params: [
      { key: 'density', label: '数量', hint: '萤火虫数量', min: 0, max: 100, step: 1, default: 45 },
      { key: 'speed', label: '漂浮速度', hint: '萤火虫移动的快慢', min: 0, max: 100, step: 1, default: 30 },
      { key: 'glow', label: '发光强度', hint: '光点的亮度', min: 0, max: 100, step: 1, default: 65 },
      { key: 'brightness', label: '背景亮度', hint: '背景的明亮程度', min: 0, max: 100, step: 1, default: 35 },
    ],
  },
  {
    id: 'sakura',
    name: '樱花',
    desc: '春日的粉色花瓣在暖风中缓缓飘落。',
    tone: 'light',
    params: [
      { key: 'density', label: '花瓣数量', hint: '飘落的花瓣多少', min: 0, max: 100, step: 1, default: 45 },
      { key: 'speed', label: '飘落速度', hint: '花瓣下落的快慢', min: 0, max: 100, step: 1, default: 35 },
      { key: 'wind', label: '风向', hint: '负数向左吹，正数向右吹', min: -100, max: 100, step: 1, default: 15 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 70 },
    ],
  },
  {
    id: 'bubbles',
    name: '气泡',
    desc: '清澈水中的气泡缓缓上升，折射出柔和的光。',
    tone: 'light',
    params: [
      { key: 'density', label: '气泡数量', hint: '气泡的多少', min: 0, max: 100, step: 1, default: 40 },
      { key: 'speed', label: '上升速度', hint: '气泡上升的快慢', min: 0, max: 100, step: 1, default: 40 },
      { key: 'size', label: '气泡大小', hint: '气泡的平均大小', min: 0, max: 100, step: 1, default: 50 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 75 },
    ],
  },
  {
    id: 'matrix',
    name: '数字雨',
    desc: '绿色的字符如雨般下落，赛博朋克风格。',
    tone: 'dark',
    params: [
      { key: 'density', label: '密度', hint: '字符列的数量', min: 0, max: 100, step: 1, default: 55 },
      { key: 'speed', label: '下落速度', hint: '字符下落的快慢', min: 0, max: 100, step: 1, default: 50 },
      { key: 'brightness', label: '亮度', hint: '字符的亮度', min: 0, max: 100, step: 1, default: 70 },
      { key: 'glow', label: '发光', hint: '字符的发光程度', min: 0, max: 100, step: 1, default: 40 },
    ],
  },
  {
    id: 'ocean',
    name: '海浪',
    desc: '海面波光粼粼，浪花轻柔滚动。',
    tone: 'light',
    params: [
      { key: 'waves', label: '浪花', hint: '波浪的数量与层次', min: 0, max: 100, step: 1, default: 50 },
      { key: 'speed', label: '流速', hint: '波浪滚动的快慢', min: 0, max: 100, step: 1, default: 40 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 70 },
      { key: 'foam', label: '浪花泡沫', hint: '浪尖泡沫的多少', min: 0, max: 100, step: 1, default: 35 },
    ],
  },
  {
    id: 'galaxy',
    name: '星系',
    desc: '旋转的星系与星云，深邃而神秘。',
    tone: 'dark',
    params: [
      { key: 'speed', label: '旋转速度', hint: '星系旋转的快慢', min: 0, max: 100, step: 1, default: 30 },
      { key: 'density', label: '星星数量', hint: '星星的多少', min: 0, max: 100, step: 1, default: 55 },
      { key: 'nebula', label: '星云', hint: '星云的明显程度', min: 0, max: 100, step: 1, default: 60 },
      { key: 'brightness', label: '亮度', hint: '整体亮度', min: 0, max: 100, step: 1, default: 60 },
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
