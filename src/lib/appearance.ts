import { useCallback, useEffect, useState } from 'react'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

export const DESIGN_THEMES = [
  {
    id: 'blue',
    name: '星野蓝',
    subtitle: '灵感，始于一片星光',
    color: '#3563f6',
    accent: '#22b8cf',
    light: '#f7f9ff',
    dark: '#0d101d',
  },
  {
    id: 'aurora',
    name: '极光紫',
    subtitle: '在光与影之间漫游',
    color: '#8b5cf6',
    accent: '#ec4899',
    light: '#faf7ff',
    dark: '#130e20',
  },
  {
    id: 'forest',
    name: '翡翠森',
    subtitle: '让思绪自由呼吸',
    color: '#10b981',
    accent: '#22d3ee',
    light: '#f3fbf8',
    dark: '#0a1715',
  },
  {
    id: 'amber',
    name: '琥珀暮色',
    subtitle: '收藏日落时的灵感',
    color: '#f59e0b',
    accent: '#f97316',
    light: '#fffbf3',
    dark: '#1c150e',
  },
  {
    id: 'rose',
    name: '樱雾粉',
    subtitle: '温柔记录每个瞬间',
    color: '#ec4899',
    accent: '#a78bfa',
    light: '#fff7fb',
    dark: '#1c101a',
  },
  {
    id: 'graphite',
    name: '石墨极简',
    subtitle: '留白之中，自有天地',
    color: '#64748b',
    accent: '#94a3b8',
    light: '#f8fafc',
    dark: '#101318',
  },
] as const
export type DesignTheme = (typeof DESIGN_THEMES)[number]['id']
export type EffectLevel = 'full' | 'subtle' | 'off'
export interface Appearance {
  design: DesignTheme
  effects: EffectLevel
}
const DEFAULT: Appearance = { design: 'blue', effects: 'full' }

export function normalizeAppearance(raw: unknown): Appearance {
  const value =
    raw && typeof raw === 'object' ? (raw as Partial<Appearance>) : {}
  return {
    design: DESIGN_THEMES.some((t) => t.id === value.design)
      ? value.design!
      : DEFAULT.design,
    effects: ['full', 'subtle', 'off'].includes(value.effects || '')
      ? value.effects!
      : DEFAULT.effects,
  }
}
function readAppearance() {
  return normalizeAppearance(readPersonalSetting('appearance'))
}

/** Local-only, shared with mounted controls and other tabs. */
export function useAppearance() {
  const [appearance, setState] = useState(readAppearance)
  useEffect(() => {
    const sync = () => setState(readAppearance())
    window.addEventListener('starlog:settings-changed', sync)
    window.addEventListener('storage', sync)
    sync()
    return () => {
      window.removeEventListener('starlog:settings-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    const next = normalizeAppearance({ ...readAppearance(), ...patch })
    setState(next)
    writePersonalSetting('appearance', next)
  }, [])
  return { appearance, setAppearance }
}
