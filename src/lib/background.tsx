import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import { fetchGithubBackgroundPreference, buildBackgroundPreferenceFile, backgroundSettingsPath } from './github'
import { enqueueSettingsSync, getUpdateQueue } from './updateQueue'
import { useAuth } from './auth'
import { useTheme } from './theme'
import {
  setAnimatedBackgroundPreference,
  useAnimatedBackground,
  type AnimatedBackgroundPreference,
} from './animatedBackground'

export interface BackgroundPreference {
  color: string
  /** 0–100：自定义颜色在渐变中的明显程度，最大 100% 时全屏覆盖且不透明 */
  intensity: number
  updatedAt: number
}

type AccountSync = 'idle' | 'loading' | 'synced' | 'queued' | 'error'

interface BackgroundCtx {
  background: BackgroundPreference
  accountSync: AccountSync
  setBackground: (color: string, intensity?: number) => BackgroundPreference
  resetBackground: () => void
  saveForGithub: () => Promise<void>
}

const DEFAULT_INTENSITY = 50
const DEFAULT_BACKGROUND: BackgroundPreference = { color: '', intensity: DEFAULT_INTENSITY, updatedAt: 0 }
const Ctx = createContext<BackgroundCtx>({
  background: DEFAULT_BACKGROUND,
  accountSync: 'idle',
  setBackground: () => DEFAULT_BACKGROUND,
  resetBackground: () => {},
  saveForGithub: async () => {},
})

export function normalizeBackgroundColor(value: string): string {
  const color = value.trim().toUpperCase()
  if (!color) return ''
  const match = color.match(/^#([0-9A-F]{3,4}|[0-9A-F]{6}|[0-9A-F]{8})$/)
  if (!match) throw new Error('请输入合法的十六进制颜色，例如 #F5F7FF 或 #1A1A1ACC')

  const hex = match[1]
  if (hex.length === 3 || hex.length === 4) {
    return `#${[...hex].map((part) => part + part).join('')}`
  }
  return `#${hex}`
}

export function normalizeBackgroundIntensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTENSITY
  return Math.round(Math.min(100, Math.max(0, value)))
}

function toRgba(hex: string) {
  const value = hex.slice(1)
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  const alpha = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1
  return { r, g, b, alpha }
}

function mix(first: number, second: number, amount: number) {
  return Math.round(first * (1 - amount) + second * amount)
}

function toRgbaString(r: number, g: number, b: number, alpha: number) {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`
}

function applyToDocument(color: string, intensity: number) {
  const root = document.documentElement

  if (!color) {
    root.style.removeProperty('--site-background')
    root.style.removeProperty('--site-background-dark')
    root.style.removeProperty('--site-background-tint-primary')
    root.style.removeProperty('--site-background-tint-secondary')
    root.style.removeProperty('--site-background-gradient-size-1')
    root.style.removeProperty('--site-background-gradient-size-2')
    root.style.removeProperty('--site-background-gradient-stop-1')
    root.style.removeProperty('--site-background-gradient-stop-2')
    root.removeAttribute('data-background-color')
    return
  }

  const { r, g, b, alpha } = toRgba(color)
  const amount = normalizeBackgroundIntensity(intensity) / 100

  // 强化渐变效果：
  // 100% 最大效果下：alpha 达到 1.0（完全不透明），渐变半径扩展覆盖全屏（100% stop），并在底色层使用混合色使全屏不透明覆盖。
  const effectivePrimaryAlpha = alpha * Math.min(1, 0.15 + 0.85 * (amount ** 1.1))
  const effectiveSecondaryAlpha = alpha * Math.min(1, 0.12 + 0.88 * (amount ** 1.1))

  const secondary = { r: mix(r, 129, 0.35), g: mix(g, 140, 0.35), b: mix(b, 248, 0.35) }
  const primaryGlow = toRgbaString(r, g, b, effectivePrimaryAlpha)
  const secondaryGlow = toRgbaString(secondary.r, secondary.g, secondary.b, effectiveSecondaryAlpha)

  // 动态尺寸与停靠点（最大效果覆盖全屏）
  const size1 = `${Math.round(62 + amount * 120)}rem ${Math.round(44 + amount * 100)}rem`
  const size2 = `${Math.round(54 + amount * 120)}rem ${Math.round(42 + amount * 100)}rem`
  const stop1 = `${Math.round(68 + amount * 32)}%`
  const stop2 = `${Math.round(70 + amount * 30)}%`

  root.style.setProperty('--site-background-tint-primary', primaryGlow)
  root.style.setProperty('--site-background-tint-secondary', secondaryGlow)
  root.style.setProperty('--site-background-gradient-size-1', size1)
  root.style.setProperty('--site-background-gradient-size-2', size2)
  root.style.setProperty('--site-background-gradient-stop-1', stop1)
  root.style.setProperty('--site-background-gradient-stop-2', stop2)

  if (amount >= 0.95) {
    // 最大效果下覆盖全屏且不透明
    const solidBase = toRgbaString(mix(r, 251, 1 - amount), mix(g, 251, 1 - amount), mix(b, 253, 1 - amount), 1)
    const solidBaseDark = toRgbaString(mix(r, 13, 1 - amount), mix(g, 16, 1 - amount), mix(b, 23, 1 - amount), 1)
    root.style.setProperty('--site-background', solidBase)
    root.style.setProperty('--site-background-dark', solidBaseDark)
  } else {
    root.style.removeProperty('--site-background')
    root.style.removeProperty('--site-background-dark')
  }

  root.dataset.backgroundColor = color
  root.dataset.backgroundIntensity = String(intensity)
}

function writeLocal(preference: BackgroundPreference) {
  writePersonalSetting('background', preference)
}

function readLocal(): BackgroundPreference {
  if (typeof window === 'undefined') return DEFAULT_BACKGROUND
  try {
    const parsed = readPersonalSetting<{ color?: unknown; intensity?: unknown; updatedAt?: unknown }>(
      'background',
      STORAGE_KEYS.background,
    )
    if (parsed && typeof parsed.color === 'string') {
      return {
        color: normalizeBackgroundColor(parsed.color),
        intensity: normalizeBackgroundIntensity(Number(parsed.intensity)),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    }
  } catch {
    // 无法识别旧值时使用默认背景
  }
  return DEFAULT_BACKGROUND
}

/**
 * 账号外观缓存：除了旧的渐变背景色，还记住配色主题、明暗模式与动态背景，
 * 这样刚登录、远端文件还没读完时也能先恢复上一台设备的样子。
 */
interface AccountAppearanceCache {
  color?: string
  intensity?: number
  updatedAt?: number
  colorTheme?: string
  mode?: string
  animated?: AnimatedBackgroundPreference
}

function readAccountCache(): Record<string, AccountAppearanceCache> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.backgroundAccounts) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAccountCache(login: string, appearance: AccountAppearanceCache) {
  const cache = readAccountCache()
  cache[login] = appearance
  localStorage.setItem(STORAGE_KEYS.backgroundAccounts, JSON.stringify(cache))
}

function isThemeMode(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const { ghUser, canPublish, loading: authLoading } = useAuth()
  // 配色主题与动态背景也属于「账号外观」，由这里一起恢复 / 保存到同一份 GitHub 偏好文件。
  const { colorTheme, mode, setColorTheme, setMode } = useTheme()
  const animatedBackground = useAnimatedBackground()
  const [background, setBackgroundState] = useState<BackgroundPreference>(readLocal)
  const backgroundRef = useRef(background)
  const [accountSync, setAccountSync] = useState<AccountSync>('idle')
  const accountRef = useRef('')

  const commit = useCallback((next: BackgroundPreference) => {
    applyToDocument(next.color, next.intensity)
    writeLocal(next)
    backgroundRef.current = next
    setBackgroundState(next)
    return next
  }, [])

  // 通过 ref 读取当前强度，让 setBackground 的身份保持稳定：
  // 否则恢复账号偏好时状态一变更就会重建回调，触发恢复 effect 的清理，把远程结果误判为已取消。
  const setBackground = useCallback(
    (value: string, intensity = backgroundRef.current.intensity) => {
      const color = normalizeBackgroundColor(value)
      return commit({ color, intensity: normalizeBackgroundIntensity(intensity), updatedAt: Date.now() })
    },
    [commit],
  )

  const resetBackground = useCallback(() => {
    commit({ ...DEFAULT_BACKGROUND, updatedAt: Date.now() })
  }, [commit])

  // Browser-store updates are immediately visible in other tabs and views.
  // to other mounted views and other tabs without a repository write.
  useEffect(() => {
    const sync = () => {
      const next = readLocal()
      applyToDocument(next.color, next.intensity)
      backgroundRef.current = next
      setBackgroundState(next)
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    applyToDocument(background.color, background.intensity)
  }, [])

  useEffect(() => {
    if (authLoading || !ghUser) {
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
        if (cached) {
          if (typeof cached.color === 'string') {
            setBackground(cached.color, typeof cached.intensity === 'number' ? cached.intensity : DEFAULT_INTENSITY)
          }
          if (cached.colorTheme) setColorTheme(cached.colorTheme)
          if (isThemeMode(cached.mode)) setMode(cached.mode)
          if (cached.animated) setAnimatedBackgroundPreference(cached.animated)
        }

        // 有尚未更新到仓库的偏好更改时，不用旧的远程版本覆盖本地/队列中的新设置。
        const hasPending = getUpdateQueue().some(
          (item) => item.kind === 'settings-sync' && item.target === backgroundSettingsPath(login),
        )
        if (hasPending) {
          if (active) setAccountSync('queued')
          return
        }

        const remote = await fetchGithubBackgroundPreference(login)
        if (!active) return
        if (remote) {
          setBackground(remote.color, remote.intensity)
          if (!active) return
          if (remote.colorTheme) setColorTheme(remote.colorTheme)
          if (isThemeMode(remote.themeMode)) setMode(remote.themeMode)
          if (remote.animatedBackground) setAnimatedBackgroundPreference(remote.animatedBackground)
          writeAccountCache(login, {
            color: remote.color,
            intensity: remote.intensity,
            updatedAt: remote.updatedAt,
            colorTheme: remote.colorTheme,
            mode: remote.themeMode,
            animated: remote.animatedBackground
              ? {
                  scene: remote.animatedBackground.scene as AnimatedBackgroundPreference['scene'],
                  values: remote.animatedBackground.values as AnimatedBackgroundPreference['values'],
                }
              : undefined,
          })
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
  }, [authLoading, canPublish, ghUser, setBackground, setColorTheme, setMode])

  const saveForGithub = useCallback(async () => {
    if (!canPublish || !ghUser) throw new Error('请先登录并连接具备 Contents 写入权限的 GitHub 账号')
    // 更新仓库的操作先加入待更新队列，由内容管理统一更新。
    // 配色主题、明暗模式、渐变背景与动态背景写在同一份账号外观偏好里。
    const file = buildBackgroundPreferenceFile(ghUser.login, {
      color: background.color,
      intensity: background.intensity,
      colorTheme,
      themeMode: mode,
      animatedBackground: {
        scene: animatedBackground.scene,
        values: animatedBackground.values as Record<string, Record<string, number>>,
      },
      updatedAt: Date.now(),
    })
    enqueueSettingsSync(
      file.path,
      `同步 @${ghUser.login} 的配色主题、明暗模式、背景与动态背景`,
      file.text,
    )
    writeAccountCache(ghUser.login, {
      ...background,
      colorTheme,
      mode,
      animated: animatedBackground,
    })
    setAccountSync('queued')
  }, [background, canPublish, ghUser, colorTheme, mode, animatedBackground])

  const value = useMemo(
    () => ({ background, accountSync, setBackground, resetBackground, saveForGithub }),
    [background, accountSync, setBackground, resetBackground, saveForGithub],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBackground = () => useContext(Ctx)
