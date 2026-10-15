/** Pure appearance metadata and validation; shared by the UI and regression tests. */
export const THEME_IDS = ['classic', 'aurora', 'sakura', 'forest', 'ocean', 'sunset', 'neon', 'paper'] as const
export type PaletteId = (typeof THEME_IDS)[number]
export type ColorMode = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'
export type EffectsLevel = 'off' | 'subtle' | 'full'

export interface AppearancePreference {
  palette: PaletteId
  mode: ColorMode
  effects: EffectsLevel
}

export interface PaletteSpec {
  id: PaletteId
  name: string
  english: string
  description: string
  swatches: [string, string, string]
  light: string
  dark: string
  scene: 'none' | 'stars' | 'aurora' | 'petals' | 'fireflies' | 'waves' | 'sunshine'
}

export const PALETTES: PaletteSpec[] = [
  { id: 'classic', name: '星野经典', english: 'STARLOG', description: '蓝紫之间，记录点滴灵感', swatches: ['#3563f6', '#a5a3ef', '#dbe5ff'], light: '#f5f7fc', dark: '#0c101b', scene: 'stars' },
  { id: 'aurora', name: '极光幻境', english: 'AURORA', description: '青绿流光，漫游极地夜空', swatches: ['#168b7b', '#a78bfa', '#c9f1e6'], light: '#eff8f5', dark: '#081c1d', scene: 'aurora' },
  { id: 'sakura', name: '樱落春日', english: 'SAKURA', description: '把温柔，写进春日的风里', swatches: ['#d54b7d', '#ebafb9', '#fbe3ec'], light: '#fff6f8', dark: '#21131d', scene: 'petals' },
  { id: 'forest', name: '森林微光', english: 'WOODLAND', description: '苔绿与萤火，自然地呼吸', swatches: ['#5e8446', '#b3bd72', '#e4ebd8'], light: '#f5f7ef', dark: '#111b16', scene: 'fireflies' },
  { id: 'ocean', name: '深海漫游', english: 'OCEAN', description: '沉入蔚蓝，让思绪轻轻荡漾', swatches: ['#1683af', '#67bfc8', '#d3ecf6'], light: '#eef8fc', dark: '#081922', scene: 'waves' },
  { id: 'sunset', name: '落日余晖', english: 'GOLDEN HOUR', description: '杏橙与玫瑰，收藏一刻暖意', swatches: ['#df7c36', '#d98c9d', '#f9e4cb'], light: '#fff7ed', dark: '#261710', scene: 'sunshine' },
  { id: 'neon', name: '霓虹夜航', english: 'AFTER HOURS', description: '紫电微芒，给深夜一点色彩', swatches: ['#8b5cf6', '#e879c8', '#e8dffc'], light: '#f7f4ff', dark: '#100d22', scene: 'aurora' },
  { id: 'paper', name: '墨色书房', english: 'PAPER & INK', description: '纸白墨深，回到文字本身', swatches: ['#817563', '#b5a489', '#e8e1d5'], light: '#f7f5ef', dark: '#191917', scene: 'none' },
]

export const DEFAULT_APPEARANCE: AppearancePreference = { palette: 'classic', mode: 'system', effects: 'subtle' }

export function normalizeAppearance(raw: unknown, legacyTheme?: string | null): AppearancePreference {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  return {
    palette: THEME_IDS.includes(value.palette as PaletteId) ? value.palette as PaletteId : 'classic',
    mode: value.mode === 'light' || value.mode === 'dark' || value.mode === 'system'
      ? value.mode : legacyTheme === 'light' || legacyTheme === 'dark' ? legacyTheme : 'system',
    effects: value.effects === 'off' || value.effects === 'subtle' || value.effects === 'full'
      ? value.effects : 'subtle',
  }
}

export function resolveColorMode(mode: ColorMode, systemDark: boolean): Theme {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

/** Mobile and subtle modes use a smaller, capped rendering budget. Off still renders a static scene. */
export function backdropBudget(effects: EffectsLevel, width: number) {
  const compact = width < 768
  return {
    fps: effects === 'full' && !compact ? 60 : 30,
    dpr: effects === 'full' && !compact ? 1.5 : 1,
    particles: (effects === 'full' ? 1 : 0.55) * (compact ? 0.65 : 1),
    animate: effects !== 'off',
  }
}
