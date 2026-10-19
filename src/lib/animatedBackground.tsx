import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import { STORAGE_KEYS } from './config'
import {
  fetchGithubAnimatedPreference,
  buildAnimatedPreferenceFile,
  animatedSettingsPath,
} from './github'
import { enqueueSettingsSync, getUpdateQueue } from './updateQueue'
import { useAuth } from './auth'

/**
 * 动态背景（樱花 / 粒子星链 / 雪花 / 暴雨 / 竹林）的数据层：
 * 场景定义、参数范围、校验与本地保存。
 * 渲染在 components/AnimatedBackdrop.tsx，界面在设置页。
 */

export type SceneId = 'none' | 'sakura' | 'network' | 'snow' | 'rain' | 'bamboo'
export type ActiveSceneId = Exclude<SceneId, 'none'>

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
  params: SceneParam[]
}

export const SCENES: SceneSpec[] = [
{
    id: 'sakura',
    name: '樱花',
    desc: '花瓣旋转着飘落，近处的花瓣更清晰、远处更虚，背景飘着逆光散景；画面会跟随明暗模式换成白昼或夜樱两套配色。',
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
    desc: '光点漂移并彼此连线，数据脉冲沿线滑动，鼠标附近会聚拢；画面会跟随明暗模式在暗夜与浅色星图之间切换。',
    params: [
      { key: 'density', label: '光点数量', hint: '粒子的多少', min: 0, max: 100, step: 1, default: 45 },
      { key: 'link', label: '连线距离', hint: '多远的粒子之间会出现连线', min: 0, max: 100, step: 1, default: 50 },
      { key: 'speed', label: '漂移速度', hint: '粒子移动的快慢', min: 0, max: 100, step: 1, default: 35 },
      { key: 'glow', label: '辉光强度', hint: '粒子周围光晕与星芒的明显程度', min: 0, max: 100, step: 1, default: 55 },
      { key: 'pulse', label: '数据脉冲', hint: '沿连线滑动的亮点的多少', min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  {
    id: 'snow',
    name: '雪花',
    desc: '六角雪晶与柔焦雪片分层飘落，远山隐在雪雾中；浅色是清冷雪日，深色是蓝调雪夜。',
    params: [
      { key: 'count', label: '雪花数量', hint: '远近雪片的密度', min: 0, max: 100, step: 1, default: 55 },
      { key: 'speed', label: '飘落速度', hint: '雪片下降的快慢', min: 0, max: 100, step: 1, default: 35 },
      { key: 'wind', label: '风向风力', hint: '负数向左，正数向右', min: -100, max: 100, step: 1, default: 12 },
      { key: 'size', label: '雪花大小', hint: '整体缩放，立即作用于已有雪片', min: 0, max: 100, step: 1, default: 45 },
      { key: 'swirl', label: '回旋幅度', hint: '雪片左右回旋的幅度', min: 0, max: 100, step: 1, default: 45 },
    ],
  },
  {
    id: 'rain',
    name: '暴雨',
    desc: '远近三层雨丝斜落，水面泛起涟漪，薄雾缓慢流动；浅色是阴雨白昼，深色是冷调雨夜，闪电默认关闭。',
    params: [
      { key: 'count', label: '雨量', hint: '雨丝密度，较低的值更省电', min: 0, max: 100, step: 1, default: 70 },
      { key: 'speed', label: '落雨速度', hint: '雨滴速度与雨丝长度', min: 0, max: 100, step: 1, default: 65 },
      { key: 'wind', label: '风向风力', hint: '负数向左，正数向右', min: -100, max: 100, step: 1, default: 25 },
      { key: 'mist', label: '雨雾强度', hint: '远处低空雨雾的浓度', min: 0, max: 100, step: 1, default: 40 },
      { key: 'lightning', label: '闪电亮度', hint: '0 关闭，开启后每隔 8–18 秒柔和闪亮一次', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    id: 'bamboo',
    name: '竹林',
    desc: '远中近竹竿与叶簇随风轻摆，雾气和斜射光穿过林间；浅色是晨光青竹，深色是幽绿月夜。',
    params: [
      { key: 'density', label: '竹林密度', hint: '竹竿与叶簇数量', min: 0, max: 100, step: 1, default: 55 },
      { key: 'wind', label: '摇曳幅度', hint: '竹竿随风摆动的幅度', min: 0, max: 100, step: 1, default: 40 },
      { key: 'speed', label: '摇曳速度', hint: '林间风节奏的快慢', min: 0, max: 100, step: 1, default: 35 },
      { key: 'mist', label: '林间薄雾', hint: '低处雾气的浓度', min: 0, max: 100, step: 1, default: 45 },
      { key: 'light', label: '透光强度', hint: '穿过竹林的晨光或月光', min: 0, max: 100, step: 1, default: 45 },
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

/* -------------------------------------------------------------------------- */
/*                 文章级临时覆盖（issue #59 ::set-background）                  */
/* -------------------------------------------------------------------------- */

/**
 * 某些文章可在开头用 `::set-background[<id>]` 强制指定阅读本文时的动态背景。
 * 这是**只驻留在内存里**的临时覆盖：不写 localStorage、不进待更新队列，
 * 文章页 / 编辑器挂载时调用 `setAnimatedSceneOverride` 设置、卸载时传 null 清除，
 * 离开后立即恢复读者自己的场景偏好。`'none'` 是有意义的覆盖值（强制无背景），
 * null 才表示「没有覆盖」。
 */
const SCENE_OVERRIDE_EVENT = 'starlog:animated-scene-override'
let sceneOverride: SceneId | null = null

export function setAnimatedSceneOverride(scene: SceneId | null): void {
  if (sceneOverride === scene) return
  sceneOverride = scene
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SCENE_OVERRIDE_EVENT))
  }
}

export function getAnimatedSceneOverride(): SceneId | null {
  return sceneOverride
}

/** 订阅文章级场景覆盖（供 Layout 的动态背景层读取生效场景）。 */
export function useAnimatedSceneOverride(): SceneId | null {
  const [override, setOverride] = useState<SceneId | null>(sceneOverride)
  useEffect(() => {
    const sync = () => setOverride(sceneOverride)
    sync()
    window.addEventListener(SCENE_OVERRIDE_EVENT, sync)
    return () => window.removeEventListener(SCENE_OVERRIDE_EVENT, sync)
  }, [])
  return override
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

type AccountSync = 'idle' | 'loading' | 'synced' | 'queued' | 'error'

interface AnimatedBackgroundCtxValue {
  accountSync: AccountSync
  saveForGithub: () => Promise<void>
}

const AnimatedCtx = createContext<AnimatedBackgroundCtxValue>({
  accountSync: 'idle',
  saveForGithub: async () => {},
})

function readAccountCache(): Record<string, AnimatedBackgroundPreference & { updatedAt: number }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.animatedBackgroundAccounts) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAccountCache(login: string, preference: AnimatedBackgroundPreference) {
  const cache = readAccountCache()
  cache[login] = { ...preference, updatedAt: Date.now() }
  localStorage.setItem(STORAGE_KEYS.animatedBackgroundAccounts, JSON.stringify(cache))
}

export function AnimatedBackgroundProvider({ children }: { children: ReactNode }) {
  const { ghUser, canPublish, loading: authLoading } = useAuth()
  const [accountSync, setAccountSync] = useState<AccountSync>('idle')
  const accountRef = useRef('')

  useEffect(() => {
    if (authLoading || !canPublish || !ghUser) {
      accountRef.current = ''
      if (!authLoading) setAccountSync('idle')
      return
    }
    const login = ghUser.login
    if (accountRef.current === login) return
    accountRef.current = login
    let active = true
    setAccountSync('loading')

    const restore = async () => {
      try {
        const cached = readAccountCache()[login]
        if (cached && typeof cached.scene === 'string') {
          const normalized = normalizePreference(cached)
          if (active) write(normalized)
        }

        const hasPending = getUpdateQueue().some(
          (item) => item.kind === 'settings-sync' && item.target === animatedSettingsPath(login),
        )
        if (hasPending) {
          if (active) setAccountSync('queued')
          return
        }

        const remote = await fetchGithubAnimatedPreference(login)
        if (!active) return
        if (remote) {
          const normalized: AnimatedBackgroundPreference = {
            scene: (SCENES.some((s) => s.id === remote.scene) || remote.scene === 'none'
              ? (remote.scene as SceneId)
              : 'none'),
            values: {},
          }
          // 远程 values 是 Record<string, Record<string, number>>
          if (remote.values && typeof remote.values === 'object') {
            for (const spec of SCENES) {
              const raw = (remote.values as Record<string, unknown>)[spec.id]
              normalized.values[spec.id] = normalizeSceneValues(spec, raw)
            }
          }
          write(normalized)
          if (!active) return
          writeAccountCache(login, normalized)
        }
        setAccountSync('synced')
      } catch {
        if (active) setAccountSync('error')
      }
    }

    void restore()
    return () => {
      active = false
    }
  }, [authLoading, canPublish, ghUser])

  const saveForGithub = useCallback(async () => {
    if (!canPublish || !ghUser) throw new Error('请先登录并连接具备 Contents 写入权限的 GitHub 账号')
    const pref = readAnimatedBackground()
    const file = buildAnimatedPreferenceFile(ghUser.login, {
      scene: pref.scene,
      values: (pref.values as Record<string, Record<string, number>>) || {},
      updatedAt: Date.now(),
    })
    enqueueSettingsSync(file.path, `同步 @${ghUser.login} 的动态背景偏好`, file.text)
    writeAccountCache(ghUser.login, pref)
    setAccountSync('queued')
  }, [canPublish, ghUser])

  const value = useMemo(() => ({ accountSync, saveForGithub }), [accountSync, saveForGithub])

  return <AnimatedCtx.Provider value={value}>{children}</AnimatedCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAnimatedBackgroundSync = () => useContext(AnimatedCtx)

