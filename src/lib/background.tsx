import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { fetchGithubBackgroundPreference, saveGithubBackgroundPreference } from './github'
import { useAuth } from './auth'

export interface BackgroundPreference {
  color: string
  /** 0–100：自定义颜色在渐变中的明显程度 */
  intensity: number
  updatedAt: number
}

type AccountSync = 'idle' | 'loading' | 'synced' | 'error'

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
  // 清理旧版“纯色覆盖”变量：自定义颜色现在始终作为原渐变上的柔光层。
  root.style.removeProperty('--site-background')
  root.style.removeProperty('--site-background-dark')

  if (!color) {
    root.style.removeProperty('--site-background-tint-primary')
    root.style.removeProperty('--site-background-tint-secondary')
    root.removeAttribute('data-background-color')
    return
  }

  const { r, g, b, alpha } = toRgba(color)
  const amount = normalizeBackgroundIntensity(intensity) / 100
  // 两束不同色相与不同透明度的柔光叠在基础双渐变上；50% 接近站点原始渐变强度。
  const secondary = { r: mix(r, 129, 0.3), g: mix(g, 140, 0.3), b: mix(b, 248, 0.3) }
  const primaryGlow = toRgbaString(r, g, b, alpha * 0.42 * amount)
  const secondaryGlow = toRgbaString(secondary.r, secondary.g, secondary.b, alpha * 0.3 * amount)

  root.style.setProperty('--site-background-tint-primary', primaryGlow)
  root.style.setProperty('--site-background-tint-secondary', secondaryGlow)
  root.dataset.backgroundColor = color
}

function writeLocal(preference: BackgroundPreference) {
  localStorage.setItem(STORAGE_KEYS.background, JSON.stringify(preference))
}

function readLocal(): BackgroundPreference {
  if (typeof window === 'undefined') return DEFAULT_BACKGROUND
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.background) || 'null')
    if (parsed && typeof parsed.color === 'string') {
      return {
        color: normalizeBackgroundColor(parsed.color),
        intensity: normalizeBackgroundIntensity(Number(parsed.intensity)),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    }
  } catch {
    // 无法识别旧值时使用默认背景，避免非法样式注入页面。
  }
  return DEFAULT_BACKGROUND
}

function readAccountCache(): Record<string, BackgroundPreference> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.backgroundAccounts) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAccountCache(login: string, preference: BackgroundPreference) {
  const cache = readAccountCache()
  cache[login] = preference
  localStorage.setItem(STORAGE_KEYS.backgroundAccounts, JSON.stringify(cache))
}

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const { ghUser, canPublish, loading: authLoading } = useAuth()
  const [background, setBackgroundState] = useState<BackgroundPreference>(readLocal)
  const [accountSync, setAccountSync] = useState<AccountSync>('idle')
  const accountRef = useRef('')

  const commit = useCallback((next: BackgroundPreference) => {
    applyToDocument(next.color, next.intensity)
    writeLocal(next)
    setBackgroundState(next)
    return next
  }, [])

  const setBackground = useCallback(
    (value: string, intensity = background.intensity) => {
      const color = normalizeBackgroundColor(value)
      return commit({ color, intensity: normalizeBackgroundIntensity(intensity), updatedAt: Date.now() })
    },
    [background.intensity, commit],
  )

  const resetBackground = useCallback(() => {
    commit({ ...DEFAULT_BACKGROUND, updatedAt: Date.now() })
  }, [commit])

  useEffect(() => {
    applyToDocument(background.color, background.intensity)
    // 只在首次挂载时恢复本地背景；后续更新由 commit() 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        if (cached && typeof cached.color === 'string') {
          setBackground(cached.color, typeof cached.intensity === 'number' ? cached.intensity : DEFAULT_INTENSITY)
        }

        const remote = await fetchGithubBackgroundPreference(login)
        if (!active) return
        if (remote) {
          const restored = setBackground(remote.color, remote.intensity)
          if (!active) return
          writeAccountCache(login, restored)
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
  }, [authLoading, canPublish, ghUser, setBackground])

  const saveForGithub = useCallback(async () => {
    if (!canPublish || !ghUser) throw new Error('请先登录并连接具备 Contents 写入权限的 GitHub 账号')
    await saveGithubBackgroundPreference(ghUser.login, background)
    writeAccountCache(ghUser.login, background)
    setAccountSync('synced')
  }, [background, canPublish, ghUser])

  const value = useMemo(
    () => ({ background, accountSync, setBackground, resetBackground, saveForGithub }),
    [background, accountSync, setBackground, resetBackground, saveForGithub],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBackground = () => useContext(Ctx)
