import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { fetchGithubFontPreference, saveGithubFontPreference } from './github'
import { useAuth } from './auth'

export type FontStatus = 'idle' | 'checking-local' | 'loading-cloud' | 'ready' | 'fallback'
/** 每个字体命中的来源：本机 / 云端 / 两边都没有 */
export type FontResolve = Record<string, 'local' | 'cloud' | 'missing'>

export interface FontPreference {
  /**
   * 字体栈（issue #9）：可以设置多个字体，渲染时按列表顺序依次尝试，
   * 前一个不可用（本机未安装且云端加载失败）时自动落到下一个。
   */
  families: string[]
  updatedAt: number
}

interface FontCtx {
  font: FontPreference
  status: FontStatus
  resolved: FontResolve
  accountSync: 'idle' | 'loading' | 'synced' | 'error'
  setFonts: (families: string[]) => Promise<FontPreference>
  resetFont: () => void
  saveForGithub: () => Promise<void>
}

const DEFAULT_FONT: FontPreference = { families: [], updatedAt: 0 }
const CLOUD_TIMEOUT = 5000
const MAX_FONTS = 6
const cloudStyles = new Map<string, HTMLStyleElement>()
const Ctx = createContext<FontCtx>({
  font: DEFAULT_FONT,
  status: 'idle',
  resolved: {},
  accountSync: 'idle',
  setFonts: async () => DEFAULT_FONT,
  resetFont: () => {},
  saveForGithub: async () => {},
})

function normalizeFamilies(values: string[]): string[] {
  const out: string[] = []
  for (const raw of values) {
    const family = String(raw ?? '').trim().replace(/\s+/g, ' ')
    if (!family) continue
    if (family.length > 120 || /[{};<>\n\r]/.test(family)) {
      throw new Error(`字体名称「${family.slice(0, 20)}…」格式不正确`)
    }
    if (!out.some((v) => v.toLowerCase() === family.toLowerCase())) out.push(family)
  }
  if (out.length > MAX_FONTS) throw new Error(`最多设置 ${MAX_FONTS} 个字体`)
  return out
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`
}

function applyToDocument(families: string[]) {
  const root = document.documentElement
  if (families.length === 0) {
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-serif')
    root.removeAttribute('data-font-family')
    return
  }

  const stack = families.map(quoteFamily).join(', ')
  // 自定义字体按优先级排在最前，后面始终垫上系统字体兜底
  root.style.setProperty('--font-sans', `${stack}, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`)
  root.style.setProperty('--font-serif', `${stack}, "Noto Serif SC", "Songti SC", STSong, SimSun, serif`)
  root.dataset.fontFamily = families.join(' / ')
}

function writeLocal(preference: FontPreference) {
  localStorage.setItem(STORAGE_KEYS.font, JSON.stringify(preference))
}

function normalizePreference(parsed: Record<string, unknown>): FontPreference {
  // 兼容旧版 {family, source} 单字体格式
  const families = Array.isArray(parsed.families)
    ? parsed.families
    : typeof parsed.family === 'string' && parsed.family.trim()
      ? [parsed.family]
      : []
  return {
    families: normalizeFamilies(families.map((v) => String(v))),
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  }
}

function readLocal(): FontPreference {
  if (typeof window === 'undefined') return DEFAULT_FONT
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.font)
    if (!raw) return DEFAULT_FONT
    return normalizePreference(JSON.parse(raw))
  } catch {
    return DEFAULT_FONT
  }
}

function readAccountCache(): Record<string, FontPreference> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.fontAccounts) || '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, FontPreference> = {}
    for (const [login, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') {
        try {
          out[login] = normalizePreference(value as Record<string, unknown>)
        } catch {
          /* 单条坏数据跳过 */
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeAccountCache(login: string, preference: FontPreference) {
  const cache = readAccountCache()
  cache[login] = preference
  localStorage.setItem(STORAGE_KEYS.fontAccounts, JSON.stringify(cache))
}

function localFontLikelyExists(family: string): boolean {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return false

  // 无法直接从 CSS Font Loading API 得知“是否命中后备字体”，故以两组字符宽度作保守检测。
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

async function requestCloudFont(family: string, timeout = CLOUD_TIMEOUT): Promise<void> {
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
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('云端字体加载超时')), remaining)),
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
  const [status, setStatus] = useState<FontStatus>('idle')
  const [resolved, setResolved] = useState<FontResolve>({})
  const [accountSync, setAccountSync] = useState<FontCtx['accountSync']>('idle')
  const accountRef = useRef('')

  const commit = useCallback((next: FontPreference, nextStatus: FontStatus, resolveMap: FontResolve = {}) => {
    applyToDocument(next.families)
    writeLocal(next)
    setFontState(next)
    setStatus(nextStatus)
    setResolved(resolveMap)
    return next
  }, [])

  const resetFont = useCallback(() => {
    commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'idle')
  }, [commit])

  /** 设置字体栈：逐个检测本机是否安装，缺失的尝试云端加载，最后按优先级依次生效 */
  const setFonts = useCallback(
    async (values: string[]): Promise<FontPreference> => {
      const families = normalizeFamilies(values)
      if (families.length === 0) {
        return commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'idle')
      }

      setStatus('checking-local')
      const resolveMap: FontResolve = {}
      const missing: string[] = []
      for (const family of families) {
        if (localFontLikelyExists(family)) resolveMap[family] = 'local'
        else missing.push(family)
      }

      if (missing.length > 0) {
        setStatus('loading-cloud')
        await Promise.all(
          missing.map(async (family) => {
            try {
              await requestCloudFont(family)
              resolveMap[family] = 'cloud'
            } catch {
              resolveMap[family] = 'missing'
            }
          }),
        )
      }

      const allMissing = families.every((f) => resolveMap[f] === 'missing')
      return commit({ families, updatedAt: Date.now() }, allMissing ? 'fallback' : 'ready', resolveMap)
    },
    [commit],
  )

  // 本地偏好先立即恢复并校验；字体在这台设备上不存在时会尝试云端，再按规则回退。
  useEffect(() => {
    if (font.families.length > 0) {
      void setFonts(font.families)
    } else if (typeof document !== 'undefined') {
      applyToDocument([])
    }
    // 只在首次挂载时校验本地已保存的偏好，后续变更由 commit() 统一处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFonts])

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
        if (cached && cached.families.length > 0) await setFonts(cached.families)

        const remote = await fetchGithubFontPreference(login)
        if (!active) return
        if (remote) {
          const restored = await setFonts(remote.families)
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
    await saveGithubFontPreference(ghUser.login, { families: font.families, updatedAt: font.updatedAt })
    writeAccountCache(ghUser.login, font)
    setAccountSync('synced')
  }, [canPublish, ghUser, font])

  const value = useMemo(
    () => ({ font, status, resolved, accountSync, setFonts, resetFont, saveForGithub }),
    [font, status, resolved, accountSync, setFonts, resetFont, saveForGithub],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFont = () => useContext(Ctx)
