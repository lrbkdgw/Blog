import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { fetchGithubBackgroundPreference, saveGithubBackgroundPreference } from './github'
import { useAuth } from './auth'

export interface BackgroundPreference {
  color: string
  updatedAt: number
}

type AccountSync = 'idle' | 'loading' | 'synced' | 'error'

interface BackgroundCtx {
  background: BackgroundPreference
  accountSync: AccountSync
  setBackground: (color: string) => BackgroundPreference
  resetBackground: () => void
  saveForGithub: () => Promise<void>
}

const DEFAULT_BACKGROUND: BackgroundPreference = { color: '', updatedAt: 0 }
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

function applyToDocument(color: string) {
  const root = document.documentElement
  if (!color) {
    root.style.removeProperty('--site-background')
    root.style.removeProperty('--site-background-dark')
    root.removeAttribute('data-background-color')
    return
  }

  // 自定义颜色同时用于浅色与深色模式，确保管理员选择的背景不会在切换主题时丢失。
  root.style.setProperty('--site-background', color)
  root.style.setProperty('--site-background-dark', color)
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
    applyToDocument(next.color)
    writeLocal(next)
    setBackgroundState(next)
    return next
  }, [])

  const setBackground = useCallback(
    (value: string) => {
      const color = normalizeBackgroundColor(value)
      return commit({ color, updatedAt: Date.now() })
    },
    [commit],
  )

  const resetBackground = useCallback(() => {
    commit({ ...DEFAULT_BACKGROUND, updatedAt: Date.now() })
  }, [commit])

  useEffect(() => {
    applyToDocument(background.color)
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
        if (cached && typeof cached.color === 'string') setBackground(cached.color)

        const remote = await fetchGithubBackgroundPreference(login)
        if (!active) return
        if (remote) {
          const restored = setBackground(remote.color)
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
