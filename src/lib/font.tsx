import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import { fetchGithubFontPreference, saveGithubFontPreference } from './github'
import { useAuth } from './auth'

export type FontSource = 'default' | 'local' | 'cloud'
export type FontStatus = 'idle' | 'checking-local' | 'loading-cloud' | 'ready' | 'fallback'

export const FONT_SIZE_MIN = 80
export const FONT_SIZE_MAX = 130
export const DEFAULT_FONT_SIZE = 100

export interface FontPreference {
  /** 字体列表，按优先级从前到后排列 */
  families: string[]
  /** 全站字号百分比；标题、正文、公式和界面文字会一起缩放。 */
  sizePercent: number
  /** 兼容旧版单个字体字段 */
  family?: string
  source?: FontSource
  updatedAt: number
}

interface FontCtx {
  font: FontPreference
  status: FontStatus
  accountSync: 'idle' | 'loading' | 'synced' | 'error'
  /** 设置完整的字体优先级列表 */
  setFonts: (families: string[]) => Promise<FontPreference>
  /** 添加一个字体到优先级列表末尾（若已存在则移至指定位置） */
  addFont: (family: string) => Promise<FontPreference>
  /** 移除某个字体 */
  removeFont: (family: string) => Promise<FontPreference>
  /** 上移或下移某个字体的优先级 */
  moveFont: (index: number, direction: 'up' | 'down') => Promise<FontPreference>
  /** 兼容旧版单个字体设置方法 */
  setFont: (family: string, knownLocal?: boolean) => Promise<FontPreference>
  /** 调整全站字号，标题、正文与公式同步缩放。 */
  setFontSize: (sizePercent: number) => FontPreference
  resetFont: () => void
  saveForGithub: () => Promise<void>
}

const DEFAULT_FONT: FontPreference = {
  families: [],
  sizePercent: DEFAULT_FONT_SIZE,
  updatedAt: 0,
}
const CLOUD_TIMEOUT = 5000
const cloudStyles = new Map<string, HTMLStyleElement>()
const Ctx = createContext<FontCtx>({
  font: DEFAULT_FONT,
  status: 'idle',
  accountSync: 'idle',
  setFonts: async () => DEFAULT_FONT,
  addFont: async () => DEFAULT_FONT,
  removeFont: async () => DEFAULT_FONT,
  moveFont: async () => DEFAULT_FONT,
  setFont: async () => DEFAULT_FONT,
  setFontSize: () => DEFAULT_FONT,
  resetFont: () => {},
  saveForGithub: async () => {},
})

export function normalizeFamily(value: string): string {
  const family = value.trim().replace(/\s+/g, ' ')
  if (!family) return ''
  if (family.length > 120 || /[{};<>\n\r]/.test(family)) {
    throw new Error('字体名称格式不正确，请填写有效字体名称')
  }
  return family
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`
}

export function normalizeFontSize(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SIZE
  return Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, parsed)))
}

function normalizePreference(preference: FontPreference): FontPreference {
  return {
    ...preference,
    families: preference.families.map(normalizeFamily).filter(Boolean),
    sizePercent: normalizeFontSize(preference.sizePercent),
  }
}

function applyToDocument(preference: FontPreference) {
  const root = document.documentElement
  const normalized = normalizePreference(preference)
  const valid = normalized.families

  if (normalized.sizePercent === DEFAULT_FONT_SIZE) {
    root.style.removeProperty('--site-font-size')
    root.removeAttribute('data-font-size')
  } else {
    root.style.setProperty('--site-font-size', `${normalized.sizePercent}%`)
    root.dataset.fontSize = String(normalized.sizePercent)
  }

  if (valid.length === 0) {
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-serif')
    root.removeAttribute('data-font-family')
    return
  }

  const quoted = valid.map(quoteFamily).join(', ')
  root.style.setProperty(
    '--font-sans',
    `${quoted}, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`,
  )
  root.style.setProperty(
    '--font-serif',
    `${quoted}, "Noto Serif SC", "Songti SC", STSong, SimSun, serif`,
  )
  root.dataset.fontFamily = valid.join(', ')
}

function writeLocal(preference: FontPreference) {
  writePersonalSetting('font', preference)
}

function readLocal(): FontPreference {
  if (typeof window === 'undefined') return DEFAULT_FONT
  try {
    const parsed = readPersonalSetting<{
      families?: unknown
      family?: unknown
      sizePercent?: unknown
      updatedAt?: unknown
    }>('font', STORAGE_KEYS.font)
    if (parsed && typeof parsed === 'object') {
      const families = Array.isArray(parsed.families)
        ? parsed.families
            .filter((family): family is string => typeof family === 'string')
            .map(normalizeFamily)
            .filter(Boolean)
        : typeof parsed.family === 'string' && parsed.family.trim()
          ? [normalizeFamily(parsed.family)]
          : []
      return {
        families,
        sizePercent: normalizeFontSize(parsed.sizePercent),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    }
  } catch {
    // 兼容回退
  }
  return DEFAULT_FONT
}

function readAccountCache(): Record<string, FontPreference> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.fontAccounts) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAccountCache(login: string, preference: FontPreference) {
  const cache = readAccountCache()
  cache[login] = preference
  localStorage.setItem(STORAGE_KEYS.fontAccounts, JSON.stringify(cache))
}

export function localFontLikelyExists(family: string): boolean {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return false

  const samples = ['mmmmmmmmmwwwwwwwiiiii', '字体样例測試']
  const fallbacks = ['monospace', 'sans-serif']
  return samples.some((sample) =>
    fallbacks.some((fallback) => {
      context.font = `72px ${fallback}`
      const fallbackWidth = context.measureText(sample).width
      context.font = `72px ${quoteFamily(family)}, ${fallback}`
      return Math.abs(context.measureText(sample).width - fallbackWidth) > 0.1
    }),
  )
}

export async function requestCloudFont(family: string, timeout = CLOUD_TIMEOUT): Promise<void> {
  if (cloudStyles.has(family)) return

  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)
  let style: HTMLStyleElement | undefined
  try {
    const encodedFamily = encodeURIComponent(family).replace(/%20/g, '+')
    const response = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400;500;600;700&display=swap`,
      { signal: controller.signal },
    )
    if (!response.ok) throw new Error('云端未找到该字体')

    const css = await response.text()
    if (!css.includes('@font-face')) throw new Error('云端未找到该字体')
    style = document.createElement('style')
    style.dataset.starlogCloudFont = family
    style.textContent = css
    document.head.append(style)

    const remaining = Math.max(1, timeout - (Date.now() - startedAt))
    await Promise.race([
      document.fonts.load(`16px ${quoteFamily(family)}`),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('云端字体加载超时')), remaining),
      ),
    ])
    cloudStyles.set(family, style)
  } catch (error) {
    style?.remove()
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export function FontProvider({ children }: { children: ReactNode }) {
  const { ghUser, canPublish, loading: authLoading } = useAuth()
  const [font, setFontState] = useState<FontPreference>(readLocal)
  const fontRef = useRef(font)
  const [status, setStatus] = useState<FontStatus>('idle')
  const [accountSync, setAccountSync] = useState<FontCtx['accountSync']>('idle')
  const accountRef = useRef('')

  const commit = useCallback((candidate: FontPreference, nextStatus: FontStatus = 'ready') => {
    const next = normalizePreference(candidate)
    fontRef.current = next
    applyToDocument(next)
    writeLocal(next)
    setFontState(next)
    setStatus(nextStatus)
    return next
  }, [])

  const resetFont = useCallback(() => {
    commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'idle')
  }, [commit])

  const setFonts = useCallback(
    async (
      rawFamilies: string[],
      sizePercent?: number,
    ): Promise<FontPreference> => {
      const unique = [
        ...new Set(rawFamilies.map(normalizeFamily).filter((f) => Boolean(f))),
      ]
      if (unique.length === 0) {
        return commit({
          families: [],
          sizePercent: normalizeFontSize(sizePercent ?? fontRef.current.sizePercent),
          updatedAt: Date.now(),
        }, 'idle')
      }

      // 尝试为不在本机的字体请求云端
      for (const fam of unique) {
        if (!localFontLikelyExists(fam)) {
          try {
            await requestCloudFont(fam)
          } catch {
            // 云端加载失败继续使用本地/系统回退
          }
        }
      }

      return commit({
        families: unique,
        sizePercent: normalizeFontSize(sizePercent ?? fontRef.current.sizePercent),
        updatedAt: Date.now(),
      }, 'ready')
    },
    [commit],
  )

  const addFont = useCallback(
    async (family: string): Promise<FontPreference> => {
      const normalized = normalizeFamily(family)
      if (!normalized) return font
      const current = font.families.filter((f) => f !== normalized)
      return setFonts([...current, normalized])
    },
    [font, setFonts],
  )

  const removeFont = useCallback(
    async (family: string): Promise<FontPreference> => {
      const normalized = normalizeFamily(family)
      return setFonts(font.families.filter((f) => f !== normalized))
    },
    [font.families, setFonts],
  )

  const moveFont = useCallback(
    async (index: number, direction: 'up' | 'down'): Promise<FontPreference> => {
      const list = [...font.families]
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || index >= list.length || targetIndex < 0 || targetIndex >= list.length) {
        return font
      }
      const [item] = list.splice(index, 1)
      list.splice(targetIndex, 0, item)
      return setFonts(list)
    },
    [font, setFonts],
  )

  const setFont = useCallback(
    async (value: string): Promise<FontPreference> => {
      const normalized = normalizeFamily(value)
      return setFonts(normalized ? [normalized] : [])
    },
    [setFonts],
  )

  const setFontSize = useCallback(
    (sizePercent: number): FontPreference => commit({
      ...fontRef.current,
      sizePercent: normalizeFontSize(sizePercent),
      updatedAt: Date.now(),
    }),
    [commit],
  )

  // Keep settings in other tabs/views in sync, just like the comments list.
  useEffect(() => {
    const sync = () => {
      const next = readLocal()
      fontRef.current = next
      applyToDocument(next)
      setFontState(next)
    }
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    fontRef.current = font
    applyToDocument(font)
  }, [font])

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
        if (cached && Array.isArray(cached.families)) {
          await setFonts(cached.families, cached.sizePercent)
        }

        const remote = await fetchGithubFontPreference(login)
        if (!active) return
        if (remote) {
          const list = remote.family
            ? remote.family.split(/[,，]/).map((f) => f.trim()).filter(Boolean)
            : []
          const restored = await setFonts(list, remote.sizePercent)
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
  }, [authLoading, canPublish, ghUser, setFonts])

  const saveForGithub = useCallback(async () => {
    if (!canPublish || !ghUser) throw new Error('请先登录并连接具备 Contents 写入权限的 GitHub 账号')
    await saveGithubFontPreference(ghUser.login, {
      family: font.families.join(', '),
      sizePercent: font.sizePercent,
      updatedAt: font.updatedAt || Date.now(),
    })
    writeAccountCache(ghUser.login, font)
    setAccountSync('synced')
  }, [canPublish, ghUser, font])

  const value = useMemo(
    () => ({
      font,
      status,
      accountSync,
      setFonts,
      addFont,
      removeFont,
      moveFont,
      setFont,
      setFontSize,
      resetFont,
      saveForGithub,
    }),
    [
      font,
      status,
      accountSync,
      setFonts,
      addFont,
      removeFont,
      moveFont,
      setFont,
      setFontSize,
      resetFont,
      saveForGithub,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFont = () => useContext(Ctx)
