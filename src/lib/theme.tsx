import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { STORAGE_KEYS } from './config'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import {
  DEFAULT_APPEARANCE, PALETTES, normalizeAppearance, resolveColorMode,
  type AppearancePreference, type ColorMode, type EffectsLevel, type PaletteId, type PaletteSpec, type Theme,
} from './appearance'

interface ThemeCtx {
  theme: Theme
  palette: PaletteSpec
  appearance: AppearancePreference
  /** Effective motion level, also respecting the operating system's reduced-motion setting. */
  effects: EffectsLevel
  reducedMotion: boolean
  storageError: boolean
  toggle: () => void
  setMode: (mode: ColorMode) => void
  setPalette: (palette: PaletteId) => void
  setEffects: (effects: EffectsLevel) => void
  resetAppearance: () => void
}

const Ctx = createContext<ThemeCtx>({
  theme: 'light', palette: PALETTES[0], appearance: DEFAULT_APPEARANCE,
  effects: 'subtle', reducedMotion: false, storageError: false,
  toggle: () => {}, setMode: () => {}, setPalette: () => {}, setEffects: () => {}, resetAppearance: () => {},
})

function readAppearance(): AppearancePreference {
  let legacy: string | null = null
  try { legacy = localStorage.getItem(STORAGE_KEYS.theme) } catch { /* Private browsing / blocked storage. */ }
  return normalizeAppearance(readPersonalSetting('appearance'), legacy)
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setMatches(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [query])
  return matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(readAppearance)
  const [storageError, setStorageError] = useState(false)
  const current = useRef(appearance)
  const revision = useRef(0)
  const systemDark = useMedia('(prefers-color-scheme: dark)')
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  // Scenes adapt to the chosen mode, rather than silently overriding the user's choice.
  const theme = resolveColorMode(appearance.mode, systemDark)
  const effects = reducedMotion ? 'off' : appearance.effects
  const palette = PALETTES.find((item) => item.id === appearance.palette) || PALETTES[0]

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    root.dataset.palette = appearance.palette
    root.dataset.effects = effects
  }, [theme, appearance.palette, effects])

  useEffect(() => {
    const sync = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name
      if (name && name !== 'appearance') return
      if (event instanceof StorageEvent && event.key && event.key !== STORAGE_KEYS.personalSettings && event.key !== STORAGE_KEYS.theme) return
      const next = readAppearance()
      if (next.palette === current.current.palette && next.mode === current.current.mode && next.effects === current.current.effects) return
      revision.current += 1
      current.current = next
      setAppearance(next)
    }
    const onStorageError = () => setStorageError(true)
    const onVisibility = () => { document.documentElement.dataset.pageHidden = String(document.hidden) }
    onVisibility()
    window.addEventListener('starlog:storage-unavailable', onStorageError)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:storage-unavailable', onStorageError)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const commit = useCallback((patch: Partial<AppearancePreference>, animate = true) => {
    // Merge against the latest intent, not a render captured before a transition.
    const next = normalizeAppearance({ ...current.current, ...patch })
    current.current = next
    const change = ++revision.current
    const apply = () => {
      if (change !== revision.current) return
      setAppearance(next)
      try {
        writePersonalSetting('appearance', next)
        setStorageError(false)
      } catch {
        // Keep the current session usable even when localStorage is disabled or full.
        setStorageError(true)
      }
    }
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> }
    }
    if (animate && effects !== 'off' && !document.hidden && doc.startViewTransition) {
      try {
        const transition = doc.startViewTransition(() => flushSync(apply))
        // `ready` rejects separately when a rapid selection supersedes a snapshot.
        void transition.ready.catch(() => {})
        void transition.updateCallbackDone.catch(() => {})
        void transition.finished.catch(() => {})
      } catch { apply() }
    } else apply()
  }, [effects])

  const setMode = useCallback((mode: ColorMode) => commit({ mode }), [commit])
  const setPalette = useCallback((id: PaletteId) => commit({ palette: id }), [commit])
  const setEffects = useCallback((level: EffectsLevel) => commit({ effects: level }, false), [commit])
  const resetAppearance = useCallback(() => commit({ ...DEFAULT_APPEARANCE }), [commit])
  const toggle = useCallback(() => setMode(resolveColorMode(current.current.mode, systemDark) === 'dark' ? 'light' : 'dark'), [setMode, systemDark])
  const value = useMemo(() => ({
    theme, palette, appearance, effects, reducedMotion, storageError,
    toggle, setMode, setPalette, setEffects, resetAppearance,
  }), [theme, palette, appearance, effects, reducedMotion, storageError, toggle, setMode, setPalette, setEffects, resetAppearance])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
