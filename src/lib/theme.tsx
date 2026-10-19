import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import {
  applyColorTheme,
  DEFAULT_COLOR_THEME,
  findColorTheme,
  normalizeColorTheme,
  type ColorTheme,
  type ThemeMode,
} from './themes'

type Theme = 'light' | 'dark'

const COLOR_THEME_SETTING = 'colorTheme'

interface ThemeCtx {
  /** 实际生效的明暗（用户的设置 / 跟随系统）；动态背景会读取它来切换自己的配色。 */
  theme: Theme
  /** 用户保存的明暗偏好（不受动态背景影响）。 */
  preferredTheme: Theme
  /** 明暗模式，可选「跟随系统」。 */
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
  setTheme: (t: Theme) => void
  /** 当前配色主题 id（见 src/lib/themes.ts） */
  colorTheme: string
  /** 当前配色主题的元数据 */
  colorThemeMeta: ColorTheme
  setColorTheme: (id: string) => void
}

const Ctx = createContext<ThemeCtx>({
  theme: 'light',
  preferredTheme: 'light',
  mode: 'light',
  setMode: () => {},
  toggle: () => {},
  setTheme: () => {},
  colorTheme: DEFAULT_COLOR_THEME,
  colorThemeMeta: findColorTheme(DEFAULT_COLOR_THEME)!,
  setColorTheme: () => {},
})

function readMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // 隐私模式下 localStorage 可能不可用
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readColorTheme(): string {
  if (typeof window === 'undefined') return DEFAULT_COLOR_THEME
  try {
    return normalizeColorTheme(readPersonalSetting<string>(COLOR_THEME_SETTING))
  } catch {
    return DEFAULT_COLOR_THEME
  }
}

/** 跟随系统：监听 prefers-color-scheme 变化 */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  const [colorTheme, setColorThemeState] = useState<string>(readColorTheme)
  const systemDark = useSystemDark()

  const preferredTheme: Theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  // 明暗完全由用户（或系统）决定；动态背景不再抢占明暗，而是自己按 theme 换一套配色
  // （樱花有白昼 / 夜樱两版，粒子星链有暗夜 / 浅色星图两版）。
  const theme: Theme = preferredTheme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])

  // 配色主题：写入 <html data-starlog-theme>，色卡选择器见 styles/index.css
  useEffect(() => {
    applyColorTheme(colorTheme)
  }, [colorTheme])

  /**
   * 浏览器外壳（手机上的地址栏 / 状态栏）颜色跟随「实际生效的明暗 + 配色主题」。
   *
   * index.html 里原先是两个写死的 media 版 theme-color，只跟随系统的 prefers-color-scheme：
   * 站内选了浅色而系统是深色时，浏览器顶栏会取到 #0d1017，页面下滑时顶部就是一条黑带；
   * 反过来则是白带。它也完全不知道 10 套配色主题的存在。
   *
   * 这个 effect 必须排在 applyColorTheme 之后（React 按声明顺序执行 effect），
   * 这样读到的 CSS 变量才是当前配色主题自己的页面底色。
   */
  useEffect(() => {
    const root = document.documentElement
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const surface = getComputedStyle(root)
      .getPropertyValue(theme === 'dark' ? '--theme-surface-dark' : '--theme-surface-light')
      .trim()
    meta.setAttribute('content', surface || (theme === 'dark' ? '#0d1017' : '#fbfbfd'))
  }, [theme, colorTheme])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, mode)
    } catch {
      // 忽略存储失败（无痕模式等）
    }
  }, [mode])

  // 设置页 / 页头色卡 / 其它标签页的修改都立即生效
  useEffect(() => {
    const sync = (event?: Event) => {
      const name = (event as CustomEvent<{ name?: string }> | undefined)?.detail?.name
      if (!name || name === COLOR_THEME_SETTING) setColorThemeState(readColorTheme())
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setColorTheme = useCallback((id: string) => {
    const next = normalizeColorTheme(id)
    writePersonalSetting(COLOR_THEME_SETTING, next)
    applyColorTheme(next)
    setColorThemeState(next)
  }, [])

  const setMode = useCallback((next: ThemeMode) => setModeState(next), [])

  const setTheme = useCallback((t: Theme) => {
    // 使用 View Transition 让明暗切换更顺滑（不支持的浏览器直接切换）
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(() => setModeState(t))
    } else {
      setModeState(t)
    }
  }, [])

  const value = useMemo(
    () => ({
      theme,
      preferredTheme,
      mode,
      setMode,
      setTheme,
      toggle: () => setTheme(preferredTheme === 'dark' ? 'light' : 'dark'),
      colorTheme,
      colorThemeMeta: findColorTheme(colorTheme) ?? findColorTheme(DEFAULT_COLOR_THEME)!,
      setColorTheme,
    }),
    [theme, preferredTheme, mode, setMode, setTheme, colorTheme, setColorTheme],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(Ctx)
