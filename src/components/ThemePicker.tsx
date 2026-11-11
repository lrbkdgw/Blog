import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Laptop, Moon, Palette, Settings2, Sun } from 'lucide-react'
import { useTheme } from '../lib/theme'
import { COLOR_THEMES } from '../lib/themes'

const MODES = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Laptop },
] as const

/** 页头的配色主题色卡：一眼看到全部主题，点一下即时换肤。 */
export function ThemePicker() {
  const { colorTheme, colorThemeMeta, setColorTheme, mode, setMode } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`配色主题：${colorThemeMeta.name}`}
        title={`配色主题：${colorThemeMeta.name}`}
        className="btn-ghost h-8 w-8 !px-0"
      >
        <span className="flex h-[18px] w-[18px] overflow-hidden rounded-full ring-1 ring-ink-900/10 transition-transform duration-300 hover:rotate-12 dark:ring-white/20">
          {colorThemeMeta.swatch.map((color) => (
            <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
          ))}
        </span>
      </button>

      {open && (
        <div className="card-pop absolute right-0 top-10 z-50 w-[16.5rem] animate-scale-in p-3 sm:w-[19rem]">
          <div className="mb-2.5 flex items-center gap-2 px-1">
            <Palette size={14} className="text-brand-500 dark:text-brand-300" />
            <p className="text-xs font-medium text-ink-600 dark:text-ink-300">配色主题</p>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-ink-400">
              {colorThemeMeta.en}
            </span>
          </div>

          <div role="radiogroup" aria-label="配色主题" className="grid grid-cols-5 gap-2">
            {COLOR_THEMES.map((theme) => {
              const active = theme.id === colorTheme
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={theme.name}
                  title={`${theme.name} · ${theme.desc}`}
                  onClick={() => setColorTheme(theme.id)}
                  className={`group relative h-8 overflow-hidden rounded-[7px] ring-1 transition duration-150 ${
                    active
                      ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-ink-900'
                      : 'ring-ink-900/10 hover:-translate-y-0.5 dark:ring-white/15'
                  }`}
                >
                  <span className="flex h-full w-full">
                    {theme.swatch.map((color) => (
                      <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  {active && (
                    <span className="absolute inset-0 flex items-center justify-center bg-ink-950/25">
                      <Check size={14} className="text-white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center gap-1 border-t border-ink-200/70 pt-3 dark:border-white/[0.07]">
            {MODES.map((item) => {
              const Icon = item.icon
              const active = item.id === mode
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(item.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-ink-900/[.06] text-ink-900 dark:bg-white/[0.09] dark:text-white'
                      : 'text-ink-500 hover:bg-ink-900/[.035] hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
                  }`}
                >
                  <Icon size={13} />
                  {item.label}
                </button>
              )
            })}
          </div>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="btn-ghost mt-2 w-full justify-center text-[11.5px]"
          >
            <Settings2 size={13} />
            更多外观与特效设置
          </Link>
        </div>
      )}
    </div>
  )
}
