import { useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

/**
 * 动态背景（樱花 / 粒子星链）的数据层：
 * 场景定义、参数范围、校验与本地保存。
 * 渲染在 components/AnimatedBackdrop.tsx，界面在设置页。
 *
 * 动态背景只保存在浏览器本地（不同步到 GitHub），因为它是纯视觉偏好，
 * 且相比颜色渐变更依赖设备性能。
 */

export type SceneId = 'none' | 'sakura' | 'network'
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
