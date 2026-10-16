import { Check, Moon, Sun, Sparkles } from 'lucide-react'
import {
  DESIGN_THEMES,
  useAppearance,
  type EffectLevel,
} from '../lib/appearance'
import { useTheme } from '../lib/theme'
import { sceneToneOf, useAnimatedBackground } from '../lib/animatedBackground'

export function AppearancePicker({ compact = false }: { compact?: boolean }) {
  const { appearance, setAppearance } = useAppearance()
  const { theme: activeTone, preferredTheme, setTheme } = useTheme()
  const scene = useAnimatedBackground()
  return (
    <div>
      <div
        role="group"
        aria-label="配色主题"
        className={
          compact
            ? 'flex flex-wrap gap-2'
            : 'grid grid-cols-2 gap-3 sm:grid-cols-3'
        }
      >
        {DESIGN_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            aria-pressed={appearance.design === theme.id}
            aria-label={theme.name}
            title={theme.name}
            onClick={() => setAppearance({ design: theme.id })}
            className={
              compact
                ? `theme-dot ${appearance.design === theme.id ? 'is-selected' : ''}`
                : `theme-preview ${appearance.design === theme.id ? 'is-selected' : ''}`
            }
            style={compact ? { background: theme.color } : undefined}
          >
            {compact ? (
              appearance.design === theme.id && (
                <Check size={13} className="text-white" />
              )
            ) : (
              <>
                <span
                  className="theme-preview-art"
                  style={{
                    background: `radial-gradient(ellipse at 80% 0%, ${theme.color}55, transparent 75%), ${activeTone === 'dark' ? theme.dark : theme.light}`,
                  }}
                >
                  <span
                    className="h-1.5 w-10 rounded-full"
                    style={{ background: theme.color }}
                  />
                  <span className="mt-3 block h-1 w-3/4 rounded-full bg-slate-400/30" />
                  <span className="mt-1.5 block h-1 w-1/2 rounded-full bg-slate-400/20" />
                  <span className="mt-3 flex gap-1.5">
                    <span className="h-5 w-1/2 rounded border border-slate-400/20" />
                    <span className="h-5 w-1/2 rounded border border-slate-400/20" />
                  </span>
                  {appearance.design === theme.id && (
                    <span
                      className="absolute right-2 top-2 rounded-full p-1 text-white"
                      style={{ background: theme.color }}
                    >
                      <Check size={12} />
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-sm font-medium">
                  {theme.name}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-500 dark:text-ink-400">
                  {theme.subtitle}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
      {!compact && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">明暗模式</span>
            <div className="flex gap-2" role="group" aria-label="明暗模式">
              {(['light', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={preferredTheme === mode}
                  onClick={() => setTheme(mode)}
                  className={`btn-outline ${preferredTheme === mode ? '!border-brand-400 !bg-brand-500/10' : ''}`}
                >
                  {mode === 'light' ? <Sun size={14} /> : <Moon size={14} />}
                  {mode === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </div>
          {sceneToneOf(scene.scene) && (
            <p className="mt-2 text-xs text-ink-500">
              当前动态场景暂时覆盖明暗模式；关闭动态背景后恢复此偏好。
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles size={15} />
              装饰动效
            </span>
            <div
              className="flex gap-1 rounded-xl bg-ink-500/5 p-1"
              role="group"
              aria-label="装饰动效强度"
            >
              {(
                [
                  { id: 'full', label: '完整' },
                  { id: 'subtle', label: '轻柔' },
                  { id: 'off', label: '关闭' },
                ] as { id: EffectLevel; label: string }[]
              ).map((level) => (
                <button
                  key={level.id}
                  type="button"
                  aria-pressed={appearance.effects === level.id}
                  onClick={() => setAppearance({ effects: level.id })}
                  className={`rounded-lg px-3 py-2 text-xs transition ${appearance.effects === level.id ? 'bg-brand-500/15 font-medium text-brand-700 dark:text-brand-200' : 'text-ink-500 dark:text-ink-400'}`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            配色和动效仅保存在本设备。自定义背景优先于主题底色；动态场景单独管理。轻柔模式停止循环装饰，关闭模式同时取消入场与悬停位移。系统“减少动态效果”始终优先。
          </p>
        </>
      )}
    </div>
  )
}
