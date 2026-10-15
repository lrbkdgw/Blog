import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { sceneToneOf, useAnimatedBackground } from './animatedBackground'

type Theme = 'light' | 'dark'

interface ThemeCtx {
  /** 实际生效的明暗：动态背景有自己的配色基调时以它为准，否则为用户的设置。 */
  theme: Theme
  /** 用户保存的明暗偏好（不受动态背景影响）。 */
  preferredTheme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const Ctx = createContext<ThemeCtx>({ theme: 'light', preferredTheme: 'light', toggle: () => {}, setTheme: () => {} })

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEYS.theme)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferredTheme, setThemeState] = useState<Theme>(initialTheme)
  const animated = useAnimatedBackground()
  // 深色/浅色基调的动态场景（如雨夜、星空）临时覆盖明暗配色，保证文字可读；
  // 用户保存的偏好不变，关闭动态背景后自动恢复。
  const theme: Theme = sceneToneOf(animated.scene) ?? preferredTheme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, preferredTheme)
  }, [preferredTheme])

  const setTheme = useCallback((t: Theme) => {
    // 使用 View Transition 让明暗切换更顺滑（不支持的浏览器直接切换）
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(() => setThemeState(t))
    } else {
      setThemeState(t)
    }
  }, [])

  const value = useMemo(
    () => ({
      theme,
      preferredTheme,
      setTheme,
      toggle: () => setTheme(preferredTheme === 'dark' ? 'light' : 'dark'),
    }),
    [theme, preferredTheme, setTheme],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(Ctx)
