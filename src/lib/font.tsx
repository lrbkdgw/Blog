import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { fetchGithubFontPreference, saveGithubFontPreference } from './github'
import { useAuth } from './auth'

export type FontSource = 'default' | 'local' | 'cloud'
export type FontStatus = 'idle' | 'checking-local' | 'loading-cloud' | 'ready' | 'fallback'

export interface FontPreference {
  family: string
  source: FontSource
  updatedAt: number
}

interface FontCtx {
  font: FontPreference
  status: FontStatus
  accountSync: 'idle' | 'loading' | 'synced' | 'error'
  setFont: (family: string, knownLocal?: boolean) => Promise<FontPreference>
  resetFont: () => void
  saveForGithub: () => Promise<void>
}

const DEFAULT_FONT: FontPreference = { family: '', source: 'default', updatedAt: 0 }
const CLOUD_TIMEOUT = 5000
const cloudStyles = new Map<string, HTMLStyleElement>()
const Ctx = createContext<FontCtx>({
  font: DEFAULT_FONT,
  status: 'idle',
  accountSync: 'idle',
  setFont: async () => DEFAULT_FONT,
  resetFont: () => {},
  saveForGithub: async () => {},
})

function normalizeFamily(value: string): string {
  const families = value
    .split(/[,，\n]+/)
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  if (families.length > 8 || families.some((family) => family.length > 120 || /[{};<>\r]/.test(family))) {
    throw new Error('字体列表格式不正确，最多可设置 8 个字体名称')
  }
  return [...new Set(families)].join(', ')
}

function familyList(value: string): string[] {
  return normalizeFamily(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`
}

function applyToDocument(family: string) {
  const root = document.documentElement
  if (!family) {
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-serif')
    root.removeAttribute('data-font-family')
    return
  }

  const stack = familyList(family).map(quoteFamily).join(', ')
  root.style.setProperty('--font-sans', `${stack}, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`)
  root.style.setProperty('--font-serif', `${stack}, "Noto Serif SC", "Songti SC", STSong, SimSun, serif`)
  root.dataset.fontFamily = family
}

function writeLocal(preference: FontPreference) {
  localStorage.setItem(STORAGE_KEYS.font, JSON.stringify(preference))
}

function readLocal(): FontPreference {
  if (typeof window === 'undefined') return DEFAULT_FONT
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.font)
    if (!raw) return DEFAULT_FONT
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.family === 'string') {
      return {
        family: normalizeFamily(parsed.family),
        source: parsed.source === 'cloud' || parsed.source === 'local' ? parsed.source : 'default',
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    }
  } catch {
    // 兼容旧版仅保存预设名称的值；无法转换时回退为默认字体。
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
  const [accountSync, setAccountSync] = useState<FontCtx['accountSync']>('idle')
  const accountRef = useRef('')

  const commit = useCallback((next: FontPreference, nextStatus: FontStatus) => {
    applyToDocument(next.family)
    writeLocal(next)
    setFontState(next)
    setStatus(nextStatus)
    return next
  }, [])

  const resetFont = useCallback(() => {
    commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'idle')
  }, [commit])

  const setFont = useCallback(
    async (value: string, knownLocal = false): Promise<FontPreference> => {
      const family = normalizeFamily(value)
      if (!family) {
        return commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'idle')
      }

      setStatus('checking-local')
      const families = familyList(family)
      let localCount = 0
      let cloudCount = 0

      for (const candidate of families) {
        if ((knownLocal && families.length === 1) || localFontLikelyExists(candidate)) {
          localCount += 1
          continue
        }
        setStatus('loading-cloud')
        try {
          await requestCloudFont(candidate)
          cloudCount += 1
        } catch {
          // 按优先级继续尝试下一个字体，最终再回退到系统字体。
        }
      }

      if (localCount + cloudCount === 0) {
        return commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'fallback')
      }
      return commit({ family, source: cloudCount > 0 ? 'cloud' : 'local', updatedAt: Date.now() }, 'ready')
    },
    [commit],
  )

  // 本地偏好先立即恢复并校验；字体在这台设备上不存在时会尝试云端，再按规则回退。
  useEffect(() => {
    if (font.family) {
      void setFont(font.family)
    } else if (typeof document !== 'undefined') {
      applyToDocument('')
    }
    // 只在首次挂载时校验本地已保存的偏好，后续变更由 commit() 统一处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFont])

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
        if (cached && typeof cached.family === 'string') await setFont(cached.family)

        const remote = await fetchGithubFontPreference(login)
        if (!active) return
        if (remote) {
          const restored = await setFont(remote.family)
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
  }, [authLoading, canPublish, ghUser, setFont])

  const saveForGithub = useCallback(async () => {
    if (!canPublish || !ghUser) throw new Error('请先登录并连接具备 Contents 写入权限的 GitHub 账号')
    await saveGithubFontPreference(ghUser.login, { family: font.family, updatedAt: font.updatedAt })
    writeAccountCache(ghUser.login, font)
    setAccountSync('synced')
  }, [canPublish, ghUser, font])

  const value = useMemo(
    () => ({ font, status, accountSync, setFont, resetFont, saveForGithub }),
    [font, status, accountSync, setFont, resetFont, saveForGithub],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFont = () => useContext(Ctx)
