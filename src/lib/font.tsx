import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'
import { fetchGithubFontPreference, buildFontPreferenceFile, fontSettingsPath } from './github'
import { OFFLINE, hasNetwork } from './runtime'
import { enqueueSettingsSync, getUpdateQueue } from './updateQueue'
import { useAuth } from './auth'
import { MONO_FALLBACK, SANS_FALLBACK, SERIF_FALLBACK, buildFontStack, quoteFontFamily } from './fontStacks'

export type FontSource = 'default' | 'local' | 'cloud'
export type FontStatus = 'idle' | 'checking-local' | 'loading-cloud' | 'ready' | 'fallback'
/**
 * 字体作用对象（issue #54：代码字体可以单独设置）：
 * - `sans`：正文与界面文字，同时作用于 serif（标题）；
 * - `mono`：代码块、行内代码、kbd 等等宽文字。
 */
export type FontTarget = 'sans' | 'mono'

export const FONT_SIZE_MIN = 80
export const FONT_SIZE_MAX = 130
export const DEFAULT_FONT_SIZE = 100

/**
 * 默认字体栈（issue #54）：正文 Google Sans → Noto Sans CJK SC，代码 Cascadia Code，
 * 后面接各自的系统回退。常量本体在 `./fontStacks`（与文章级排版指令共用一份，
 * 且需与 `src/styles/index.css` 的 `:root`、`index.html` 的首屏脚本保持一致），
 * 这里 re-export 以保持既有引用不变。
 */
export { MONO_FALLBACK, SANS_FALLBACK, SERIF_FALLBACK } from './fontStacks'

export interface FontPreference {
  /** 正文字体列表，按优先级从前到后排列 */
  families: string[]
  /** 代码字体列表，按优先级从前到后排列 */
  monoFamilies: string[]
  /** 全站字号百分比；标题、正文、公式和界面文字会一起缩放。 */
  sizePercent: number
  /** 兼容旧版单个字体字段 */
  family?: string
  /** 兼容旧版单个代码字体字段 */
  monoFamily?: string
  source?: FontSource
  updatedAt: number
}

interface FontCtx {
  font: FontPreference
  status: FontStatus
  accountSync: 'idle' | 'loading' | 'synced' | 'queued' | 'error'
  /** 设置完整的字体优先级列表；target 省略时为正文 */
  setFonts: (families: string[], target?: FontTarget) => Promise<FontPreference>
  /** 添加一个字体到优先级列表末尾（若已存在则移至末尾） */
  addFont: (family: string, target?: FontTarget) => Promise<FontPreference>
  /** 移除某个字体 */
  removeFont: (family: string, target?: FontTarget) => Promise<FontPreference>
  /** 上移或下移某个字体的优先级 */
  moveFont: (index: number, direction: 'up' | 'down', target?: FontTarget) => Promise<FontPreference>
  /** 兼容旧版单个字体设置方法 */
  setFont: (family: string, knownLocal?: boolean) => Promise<FontPreference>
  /** 调整全站字号，标题、正文与公式同步缩放。 */
  setFontSize: (sizePercent: number) => FontPreference
  /** 同时清空正文与代码字体、并把字号恢复 100% */
  resetFont: () => void
  saveForGithub: () => Promise<void>
}

const DEFAULT_FONT: FontPreference = {
  families: [],
  monoFamilies: [],
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

/** 把 `,` / `，` 分隔的字符串拆成字体名数组（账号偏好文件里的写法）。 */
export function splitFamilies(value: string | undefined | null): string[] {
  if (!value) return []
  return value
    .split(/[,，]/)
    .map((family) => family.trim())
    .filter(Boolean)
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

/** 去重 + 校验一组字体名。 */
function normalizeFamilies(families: string[]): string[] {
  return [...new Set(families.map(normalizeFamily).filter(Boolean))]
}

function normalizePreference(preference: FontPreference): FontPreference {
  return {
    ...preference,
    families: normalizeFamilies(preference.families ?? []),
    monoFamilies: normalizeFamilies(preference.monoFamilies ?? []),
    sizePercent: normalizeFontSize(preference.sizePercent),
  }
}

function applyToDocument(preference: FontPreference) {
  const root = document.documentElement
  const normalized = normalizePreference(preference)

  if (normalized.sizePercent === DEFAULT_FONT_SIZE) {
    root.style.removeProperty('--site-font-size')
    root.removeAttribute('data-font-size')
  } else {
    root.style.setProperty('--site-font-size', `${normalized.sizePercent}%`)
    root.dataset.fontSize = String(normalized.sizePercent)
  }

  // 正文：sans 与 serif 用同一组自定义字体，只是回退栈不同。
  const sans = buildFontStack(normalized.families, SANS_FALLBACK)
  if (sans) {
    root.style.setProperty('--font-sans', sans)
    root.style.setProperty('--font-serif', buildFontStack(normalized.families, SERIF_FALLBACK)!)
    root.dataset.fontFamily = normalized.families.join(', ')
  } else {
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-serif')
    root.removeAttribute('data-font-family')
  }

  // 代码：独立的一组优先级，留空则用 CSS 里默认的 Cascadia Code → 系统等宽。
  const mono = buildFontStack(normalized.monoFamilies, MONO_FALLBACK)
  if (mono) {
    root.style.setProperty('--font-mono', mono)
    root.dataset.fontMonoFamily = normalized.monoFamilies.join(', ')
  } else {
    root.style.removeProperty('--font-mono')
    root.removeAttribute('data-font-mono-family')
  }
}

function writeLocal(preference: FontPreference) {
  writePersonalSetting('font', preference)
}

/** 历史数据可能是 families 数组、单个 family 字符串，或者根本没有代码字体字段。 */
function parseFamilies(list: unknown, single: unknown): string[] {
  if (Array.isArray(list)) {
    return list
      .filter((family): family is string => typeof family === 'string')
      .map((family) => {
        try {
          return normalizeFamily(family)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
  }
  if (typeof single === 'string' && single.trim()) {
    try {
      return [normalizeFamily(single)]
    } catch {
      return []
    }
  }
  return []
}

function readLocal(): FontPreference {
  if (typeof window === 'undefined') return DEFAULT_FONT
  try {
    const parsed = readPersonalSetting<{
      families?: unknown
      monoFamilies?: unknown
      family?: unknown
      monoFamily?: unknown
      sizePercent?: unknown
      updatedAt?: unknown
    }>('font', STORAGE_KEYS.font)
    if (parsed && typeof parsed === 'object') {
      return {
        families: parseFamilies(parsed.families, parsed.family),
        monoFamilies: parseFamilies(parsed.monoFamilies, parsed.monoFamily),
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
      context.font = `72px ${quoteFontFamily(family)}, ${fallback}`
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
      document.fonts.load(`16px ${quoteFontFamily(family)}`),
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

/**
 * 为本机没有的字体在后台请求云端（Google Fonts），失败静默回退。
 *
 * 刻意**不阻塞**调用方生效（字体到位后浏览器自己重排）——逐个 `await` 会在
 * 网络不通时假死十几秒。FontProvider 的偏好设置与文章级排版指令（issue #59，
 * `::set-font[…]` 在文章页 / 编辑器里要求读者设备没有的字体时）共用此逻辑；
 * 只应在**可信内容**（自己仓库里的文章）上调用，评论等外部内容不触发网络请求。
 */
export function warmFontFamilies(families: string[]): void {
  // 离线版在没有网络时不去敲 Google Fonts：请求会挂到超时，白等十几秒。
  // 字体只是外观差异，失败仍按既有约定静默回退到本机字体栈。
  if (!hasNetwork()) {
    if (OFFLINE) {
      console.info('[字体] 当前离线，跳过云端字体请求，使用本机字体栈')
    }
    return
  }
  for (const family of families) {
    if (localFontLikelyExists(family)) continue
    void requestCloudFont(family).catch(() => {})
  }
}

export function FontProvider({ children }: { children: ReactNode }) {
  const { ghUser, canPublish, loading: authLoading } = useAuth()
  const [font, setFontState] = useState<FontPreference>(readLocal)
  const fontRef = useRef(font)
  const [status, setStatus] = useState<FontStatus>('idle')
  const [accountSync, setAccountSync] = useState<FontCtx['accountSync']>('idle')
  const accountRef = useRef('')

  const commit = useCallback((candidate: FontPreference, nextStatus?: FontStatus) => {
    const next = normalizePreference(candidate)
    fontRef.current = next
    applyToDocument(next)
    writeLocal(next)
    setFontState(next)
    setStatus(nextStatus ?? (next.families.length || next.monoFamilies.length ? 'ready' : 'idle'))
    return next
  }, [])

  /** 本机没有的字体在后台预热云端版本；逻辑见模块级 `warmFontFamilies`。 */
  const warmCloudFonts = useCallback((families: string[]) => {
    warmFontFamilies(families)
  }, [])

  const resetFont = useCallback(() => {
    commit({ ...DEFAULT_FONT, updatedAt: Date.now() }, 'idle')
  }, [commit])

  const setFonts = useCallback(
    async (rawFamilies: string[], target: FontTarget = 'sans'): Promise<FontPreference> => {
      const unique = normalizeFamilies(rawFamilies)
      warmCloudFonts(unique)
      return commit({
        ...fontRef.current,
        ...(target === 'mono' ? { monoFamilies: unique } : { families: unique }),
        updatedAt: Date.now(),
      })
    },
    [commit, warmCloudFonts],
  )

  const listOf = useCallback(
    (target: FontTarget) => (target === 'mono' ? fontRef.current.monoFamilies : fontRef.current.families),
    [],
  )

  const addFont = useCallback(
    async (family: string, target: FontTarget = 'sans'): Promise<FontPreference> => {
      const normalized = normalizeFamily(family)
      if (!normalized) return fontRef.current
      return setFonts([...listOf(target).filter((item) => item !== normalized), normalized], target)
    },
    [listOf, setFonts],
  )

  const removeFont = useCallback(
    async (family: string, target: FontTarget = 'sans'): Promise<FontPreference> => {
      const normalized = normalizeFamily(family)
      return setFonts(listOf(target).filter((item) => item !== normalized), target)
    },
    [listOf, setFonts],
  )

  const moveFont = useCallback(
    async (index: number, direction: 'up' | 'down', target: FontTarget = 'sans'): Promise<FontPreference> => {
      const list = [...listOf(target)]
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || index >= list.length || targetIndex < 0 || targetIndex >= list.length) {
        return fontRef.current
      }
      const [item] = list.splice(index, 1)
      list.splice(targetIndex, 0, item)
      return setFonts(list, target)
    },
    [listOf, setFonts],
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

  /** 一次性套用（本地账号缓存 / GitHub 上）保存下来的整套偏好。 */
  const applyRestored = useCallback(
    async (restored: {
      families?: string[]
      monoFamilies?: string[]
      sizePercent?: number
    }): Promise<FontPreference> => {
      const families = normalizeFamilies(restored.families ?? [])
      const monoFamilies = normalizeFamilies(restored.monoFamilies ?? [])
      warmCloudFonts([...families, ...monoFamilies])
      return commit({
        families,
        monoFamilies,
        sizePercent: normalizeFontSize(restored.sizePercent),
        updatedAt: Date.now(),
      })
    },
    [commit, warmCloudFonts],
  )

  // Keep settings in other tabs and views in sync.
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
        if (cached && (Array.isArray(cached.families) || Array.isArray(cached.monoFamilies))) {
          await applyRestored(cached)
        }

        // 有尚未更新到仓库的偏好更改时，不用旧的远程版本覆盖本地/队列中的新设置。
        const hasPending = getUpdateQueue().some(
          (item) => item.kind === 'settings-sync' && item.target === fontSettingsPath(login),
        )
        if (hasPending) {
          if (active) setAccountSync('queued')
          return
        }

        const remote = await fetchGithubFontPreference(login)
        if (!active) return
        if (remote) {
          const restored = await applyRestored({
            families: splitFamilies(remote.family),
            monoFamilies: splitFamilies(remote.monoFamily),
            sizePercent: remote.sizePercent,
          })
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
  }, [authLoading, canPublish, ghUser, applyRestored])

  const saveForGithub = useCallback(async () => {
    if (!canPublish || !ghUser) throw new Error('请先登录并连接具备 Contents 写入权限的 GitHub 账号')
    // 更新仓库的操作先加入待更新队列，由内容管理统一更新。
    const file = buildFontPreferenceFile(ghUser.login, {
      family: font.families.join(', '),
      monoFamily: font.monoFamilies.join(', '),
      sizePercent: font.sizePercent,
      updatedAt: font.updatedAt || Date.now(),
    })
    enqueueSettingsSync(file.path, `同步 @${ghUser.login} 的字体与字号偏好`, file.text)
    writeAccountCache(ghUser.login, font)
    setAccountSync('queued')
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
