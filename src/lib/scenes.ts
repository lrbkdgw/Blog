export type SceneId = 'none' | 'rain' | 'sunshine' | 'stars' | 'aurora' | 'petals' | 'fireflies' | 'snow' | 'waves'
export type ActiveSceneId = Exclude<SceneId, 'none'>
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
  /** A recommendation only. All renderers adapt to both light and dark mode. */
  tone: SceneTone
  params: SceneParam[]
}
export type SceneValues = Record<string, number>
export interface AnimatedBackgroundPreference {
  scene: SceneId
  values: Partial<Record<ActiveSceneId, SceneValues>>
}

const param = (key: string, label: string, hint: string, initial: number): SceneParam => ({ key, label, hint, min: 0, max: 100, step: 1, default: initial })

export const SCENES: SceneSpec[] = [
  {
    id: 'rain', name: '雨夜', desc: '近处的细雨，远处的微光。听不见的雨，也可以很安静。', tone: 'dark',
    params: [
      param('density', '雨量', '雨滴的疏密程度', 55),
      param('speed', '下落速度', '0 为暂停雨滴下落', 55),
      { key: 'wind', label: '风向倾斜', hint: '负数向左，正数向右，0 为垂直下落', min: -100, max: 100, step: 1, default: 12 },
      param('lightning', '雷电', '默认关闭；开启后偶尔出现柔和闪光，减少动态效果时不闪烁', 0),
    ],
  },
  {
    id: 'sunshine', name: '阳光', desc: '暖光洒下来，细小的光尘在午后缓缓漂浮。', tone: 'light',
    params: [param('brightness', '光照强度', '光晕和光束的亮度', 60), param('rays', '光束数量', '0 为隐藏光束', 50), param('motes', '光尘', '光尘的数量', 40), param('drift', '漂移速度', '0 为暂停光束和光尘', 35)],
  },
  {
    id: 'stars', name: '星空', desc: '星光有自己的节奏，偶尔有流星路过。', tone: 'dark',
    params: [param('density', '星星数量', '星空的疏密程度', 50), param('twinkle', '闪烁程度', '0 为常亮星光', 50), param('meteor', '流星频率', '0 为关闭流星', 30), param('brightness', '亮度', '星光的明亮程度', 60)],
  },
  {
    id: 'aurora', name: '极光', desc: '多层光带缓缓舒展，像写在天空里的诗。', tone: 'dark',
    params: [param('density', '光带层次', '光带的数量', 55), param('speed', '流动速度', '0 为静止光带', 35), param('brightness', '光带亮度', '0 为隐藏光带', 55)],
  },
  {
    id: 'petals', name: '樱落', desc: '花瓣翻转着飘落，让一阵春风经过你的文字。', tone: 'light',
    params: [param('density', '花瓣数量', '花瓣的疏密程度', 45), param('speed', '飘落速度', '0 为静止花瓣', 35), param('sway', '摇曳幅度', '花瓣左右摇摆的程度', 55)],
  },
  {
    id: 'fireflies', name: '萤火', desc: '一点点微光，在安静的森林里慢慢呼吸。', tone: 'dark',
    params: [param('density', '萤火数量', '光点的数量', 45), param('speed', '游动速度', '0 为暂停游动', 35), param('brightness', '微光亮度', '0 为隐藏微光', 60)],
  },
  {
    id: 'snow', name: '轻雪', desc: '远近不一的雪花，轻轻落在这个小小的空间里。', tone: 'light',
    params: [param('density', '雪花数量', '雪花的疏密程度', 50), param('speed', '飘落速度', '0 为静止雪花', 35), param('sway', '随风摇曳', '雪花随风飘动的幅度', 35)],
  },
  {
    id: 'waves', name: '海波', desc: '层叠的水光轻轻起伏，把节奏交给潮汐。', tone: 'light',
    params: [param('density', '波纹层次', '波浪线条的数量', 50), param('speed', '潮汐速度', '0 为静止波纹', 35), param('brightness', '水光强度', '0 为隐藏波纹', 55)],
  },
]

export const DEFAULT_ANIMATED_BACKGROUND: AnimatedBackgroundPreference = { scene: 'none', values: {} }
export function findScene(id: SceneId): SceneSpec | undefined { return SCENES.find((scene) => scene.id === id) }
export function defaultSceneValues(spec: SceneSpec): SceneValues { return Object.fromEntries(spec.params.map((item) => [item.key, item.default])) }

export function normalizeSceneValues(spec: SceneSpec, raw: unknown): SceneValues {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return Object.fromEntries(spec.params.map((item) => {
    const rawValue = source[item.key]
    const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : item.default
    const clamped = Math.min(item.max, Math.max(item.min, value))
    const rounded = item.min + Math.round((clamped - item.min) / item.step) * item.step
    return [item.key, Math.min(item.max, Math.max(item.min, rounded))]
  }))
}

export function normalizeAnimatedBackground(raw: unknown): AnimatedBackgroundPreference {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const scene = SCENES.some((item) => item.id === data.scene) ? data.scene as ActiveSceneId : 'none'
  const source = data.values && typeof data.values === 'object' ? data.values as Record<string, unknown> : {}
  const values = Object.fromEntries(SCENES.map((spec) => [spec.id, normalizeSceneValues(spec, source[spec.id])]))
  return { scene, values }
}

export function getSceneValues(pref: AnimatedBackgroundPreference, scene: ActiveSceneId): SceneValues {
  const spec = findScene(scene)
  return spec ? normalizeSceneValues(spec, pref.values[scene]) : {}
}
