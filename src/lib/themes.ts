import type { SceneId } from './animatedBackground'

/**
 * 配色主题（皮肤）。
 *
 * 每个主题的真实色值写在 `src/styles/index.css` 的 `[data-starlog-theme='…']` 色卡里，
 * 这里只保存界面需要的元数据（名称、描述、预览色卡、推荐搭配的动态背景）。
 *
 * 实现方式：色阶写成 `R G B` 三元组 → tailwind.config.js 里 `brand-*` 用
 * `rgb(var(--brand-500) / <alpha-value>)` 引用 → 切换 `<html data-starlog-theme>` 即可
 * 让全站的按钮、链接、标签、光晕一起换色，不需要在每个组件里写主题分支。
 */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface ColorTheme {
  id: string
  /** 中文名 */
  name: string
  /** 英文名，显示在色卡角落 */
  en: string
  /** 一句话描述，用于设置页 */
  desc: string
  /** 预览色卡：[浅色调, 主色, 深色调] */
  swatch: [string, string, string]
  /** 建议搭配的动态背景（设置页里可一键套用） */
  scene?: SceneId
  /** 建议搭配的动态背景的中文名 */
  sceneName?: string
  /** 更适合深色模式的主题，切换时会给出提示（不会强制改变用户的选择） */
  darkPreferred?: boolean
  /** 高饱和霓虹风主题，卡片会额外带一层辉光 */
  neon?: boolean
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'starlight',
    name: '星野蓝',
    en: 'Starlight',
    desc: '站点默认的蓝紫色调，安静、克制，适合长时间阅读。',
    swatch: ['#8eb3ff', '#3563f6', '#1a34d8'],
    scene: 'none',
    sceneName: '无',
  },
  {
    id: 'ocean',
    name: '深海青',
    en: 'Ocean',
    desc: '清透的青色，像海面反光，和「粒子星链」的冷光很搭。',
    swatch: ['#87e5f2', '#2bc7ee', '#158cb7'],
    scene: 'network',
    sceneName: '粒子星链',
  },
  {
    id: 'aurora',
    name: '极光紫',
    en: 'Aurora',
    desc: '紫与青交错的极光，夜里最有氛围的一套配色。',
    swatch: ['#a787f3', '#7c2aef', '#6714b8'],
    scene: 'network',
    sceneName: '粒子星链',
    darkPreferred: true,
  },
  {
    id: 'sakura',
    name: '樱花粉',
    en: 'Sakura',
    desc: '柔和的粉色，适合搭配飘落的樱花。',
    swatch: ['#ee8cab', '#e6337a', '#b01c61'],
    scene: 'sakura',
    sceneName: '樱花',
  },
  {
    id: 'sunset',
    name: '落日橙',
    en: 'Sunset',
    desc: '傍晚的暖橙色，让长文读起来更温和。',
    swatch: ['#f7b983', '#f67723', '#bd4b0f'],
    scene: 'none',
    sceneName: '无',
  },
  {
    id: 'emerald',
    name: '森野绿',
    en: 'Emerald',
    desc: '雨林般的绿色，清爽而且对比度好。',
    swatch: ['#8eebc7', '#37e1ae', '#20ac8c'],
    scene: 'none',
    sceneName: '无',
  },
  {
    id: 'crimson',
    name: '绯红',
    en: 'Crimson',
    desc: '偏中性的红色，标签与链接非常有存在感。',
    swatch: ['#f08994', '#ea2e4e', '#b41839'],
    scene: 'network',
    sceneName: '粒子星链',
  },
  {
    id: 'gold',
    name: '鎏金',
    en: 'Gilt',
    desc: '深色背景上的金色描边，克制而华丽。',
    swatch: ['#eecb8c', '#e6b033', '#b08a1c'],
    scene: 'none',
    sceneName: '无',
    darkPreferred: true,
    neon: true,
  },
  {
    id: 'cyber',
    name: '赛博霓虹',
    en: 'Cyber',
    desc: '洋红与青色的霓虹对撞，卡片会带上更强的辉光。',
    swatch: ['#d288f2', '#d02ced', '#b116b6'],
    scene: 'network',
    sceneName: '粒子星链',
    darkPreferred: true,
    neon: true,
  },
  {
    id: 'mono',
    name: '墨白',
    en: 'Monochrome',
    desc: '几乎不带颜色的灰度主题，界面元素最不抢戏。',
    swatch: ['#b6bac3', '#818898', '#5d626f'],
    scene: 'none',
    sceneName: '无',
  },
]

export const DEFAULT_COLOR_THEME = 'starlight'

export function findColorTheme(id: string | null | undefined): ColorTheme | undefined {
  return COLOR_THEMES.find((theme) => theme.id === id)
}

export function isColorThemeId(value: unknown): value is string {
  return typeof value === 'string' && COLOR_THEMES.some((theme) => theme.id === value)
}

/** 把任意输入规范成合法的主题 id（非法值回退到默认主题）。 */
export function normalizeColorTheme(value: unknown): string {
  return isColorThemeId(value) ? value : DEFAULT_COLOR_THEME
}

/** 应用主题到 `<html data-starlog-theme>`；色卡选择器在 index.css 中定义。 */
export function applyColorTheme(id: string) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const theme = normalizeColorTheme(id)
  if (theme === DEFAULT_COLOR_THEME) {
    // 默认主题直接省略属性，让 CSS 里的 :root 值生效（也便于排查问题）
    delete root.dataset.starlogTheme
  } else {
    root.dataset.starlogTheme = theme
  }
}
