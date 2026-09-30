import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS } from './config'

export const FONT_OPTIONS = [
  {
    id: 'system',
    label: '系统默认',
    description: '优先使用设备自带的中文界面字体，加载最快。',
    preview: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'modern',
    label: '现代无衬线',
    description: '简洁、利落，适合代码与技术类文章。',
    preview: 'Inter, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'serif',
    label: '阅读衬线',
    description: '更接近纸书阅读感，适合长文与随笔。',
    preview: '"Noto Serif SC", "Songti SC", STSong, SimSun, serif',
  },
  {
    id: 'rounded',
    label: '圆润易读',
    description: '笔画清晰、字面舒展，适合日常记录。',
    preview: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
  },
] as const

export type FontPreference = (typeof FONT_OPTIONS)[number]['id']

interface FontCtx {
  font: FontPreference
  setFont: (font: FontPreference) => void
}

const DEFAULT_FONT: FontPreference = 'system'
const fontIds = new Set<string>(FONT_OPTIONS.map((option) => option.id))
const Ctx = createContext<FontCtx>({ font: DEFAULT_FONT, setFont: () => {} })

function initialFont(): FontPreference {
  if (typeof window === 'undefined') return DEFAULT_FONT
  const stored = localStorage.getItem(STORAGE_KEYS.font)
  return stored && fontIds.has(stored) ? (stored as FontPreference) : DEFAULT_FONT
}

export function FontProvider({ children }: { children: ReactNode }) {
  const [font, setFontState] = useState<FontPreference>(initialFont)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.font = font
    localStorage.setItem(STORAGE_KEYS.font, font)
  }, [font])

  const setFont = useCallback((next: FontPreference) => setFontState(next), [])
  const value = useMemo(() => ({ font, setFont }), [font, setFont])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFont = () => useContext(Ctx)
