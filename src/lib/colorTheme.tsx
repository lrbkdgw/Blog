import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export interface ColorTheme {
  id: string
  name: string
  /** 每个色阶的 RGB 三元组（空格分隔），写入 CSS 变量 --brand-XX */
  colors: Record<string, string>
}

const STORAGE_KEY = 'starlog:colorTheme'

// 默认主题保留站点原有的品牌蓝，其余主题取自 Tailwind 调色板。
export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'blue',
    name: '星野蓝',
    colors: {
      '50': '238 244 255', '100': '217 229 255', '200': '188 209 255', '300': '142 179 255',
      '400': '90 139 255', '500': '53 99 246', '600': '32 68 235', '700': '26 52 216',
      '800': '28 46 174', '900': '29 45 137', '950': '21 29 83',
    },
  },
  {
    id: 'indigo',
    name: '靛紫',
    colors: {
      '50': '238 242 255', '100': '224 231 255', '200': '199 210 254', '300': '165 180 252',
      '400': '129 140 248', '500': '99 102 241', '600': '79 70 229', '700': '67 56 202',
      '800': '55 48 163', '900': '49 46 129', '950': '30 27 75',
    },
  },
  {
    id: 'violet',
    name: '紫罗兰',
    colors: {
      '50': '245 243 255', '100': '237 233 254', '200': '221 214 254', '300': '196 181 253',
      '400': '167 139 250', '500': '139 92 246', '600': '124 58 237', '700': '109 40 217',
      '800': '91 33 182', '900': '76 29 149', '950': '46 16 101',
    },
  },
  {
    id: 'emerald',
    name: '翡翠绿',
    colors: {
      '50': '236 253 245', '100': '209 250 229', '200': '167 243 208', '300': '110 231 183',
      '400': '52 211 153', '500': '16 185 129', '600': '5 150 105', '700': '4 120 87',
      '800': '6 95 70', '900': '6 78 59', '950': '2 44 34',
    },
  },
  {
    id: 'rose',
    name: '玫瑰红',
    colors: {
      '50': '255 241 242', '100': '255 228 230', '200': '254 205 211', '300': '253 164 175',
      '400': '251 113 133', '500': '244 63 94', '600': '225 29 72', '700': '190 18 60',
      '800': '159 18 57', '900': '136 19 55', '950': '76 5 25',
    },
  },
  {
    id: 'amber',
    name: '琥珀金',
    colors: {
      '50': '255 251 235', '100': '254 243 199', '200': '253 230 138', '300': '252 211 77',
      '400': '251 191 36', '500': '245 158 11', '600': '217 119 6', '700': '180 83 9',
      '800': '146 64 14', '900': '120 53 15', '950': '69 26 3',
    },
  },
  {
    id: 'teal',
    name: '青碧',
    colors: {
      '50': '240 253 250', '100': '204 251 241', '200': '153 246 228', '300': '94 234 212',
      '400': '45 212 191', '500': '20 184 166', '600': '13 148 136', '700': '15 118 110',
      '800': '17 94 89', '900': '19 78 74', '950': '4 47 46',
    },
  },
  {
    id: 'cyan',
    name: '天青',
    colors: {
      '50': '236 254 255', '100': '207 250 254', '200': '165 243 252', '300': '103 232 249',
      '400': '34 211 238', '500': '6 182 212', '600': '8 145 178', '700': '14 116 144',
      '800': '21 94 117', '900': '22 78 99', '950': '8 51 68',
    },
  },
]

interface ColorThemeCtx {
  theme: string
  setTheme: (id: string) => void
}

const Ctx = createContext<ColorThemeCtx>({ theme: 'blue', setTheme: () => {} })

function applyTheme(id: string) {
  const theme = COLOR_THEMES.find((t) => t.id === id) || COLOR_THEMES[0]
  const root = document.documentElement
  for (const [shade, rgb] of Object.entries(theme.colors)) {
    root.style.setProperty(`--brand-${shade}`, rgb)
  }
  root.dataset.colorTheme = theme.id
}

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'blue'
    return localStorage.getItem(STORAGE_KEY) || 'blue'
  })

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((id: string) => {
    const next = COLOR_THEMES.some((t) => t.id === id) ? id : 'blue'
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useColorTheme = () => useContext(Ctx)
