import type { CSSProperties } from 'react'
import { Ban, Check, CloudRain, Flower2, Leaf, Monitor, Moon, Palette, Pause, RotateCcw, Snowflake, Sparkles, Star, Sun, Waves, WandSparkles, type LucideIcon } from 'lucide-react'
import { PALETTES, type ColorMode, type EffectsLevel } from '../lib/appearance'
import { SCENES, findScene, getSceneValues, resetAnimatedBackground, resetSceneValues, setAnimatedScene, setSceneValue, useAnimatedBackground, type SceneId } from '../lib/animatedBackground'
import { useTheme } from '../lib/theme'
import { ThemeArtwork } from './ThemeArtwork'
import { ShineBorder } from './magicui/shine-border'

const SCENE_ICONS: Record<SceneId, LucideIcon> = { none: Ban, rain: CloudRain, sunshine: Sun, stars: Star, aurora: Sparkles, petals: Flower2, fireflies: Leaf, snow: Snowflake, waves: Waves }
const MODES: { id: ColorMode; label: string; icon: LucideIcon }[] = [{ id: 'light', label: '浅色', icon: Sun }, { id: 'dark', label: '深色', icon: Moon }, { id: 'system', label: '跟随系统', icon: Monitor }]
const EFFECTS: { id: EffectsLevel; label: string; icon: LucideIcon }[] = [{ id: 'off', label: '关闭', icon: Pause }, { id: 'subtle', label: '轻量', icon: Leaf }, { id: 'full', label: '完整', icon: Sparkles }]

function SceneThumbnail({ scene }: { scene: SceneId }) {
  return <svg viewBox="0 0 120 48" fill="none" aria-hidden="true" className="scene-thumbnail">
    {scene === 'none' && <><path d="M26 26H94" stroke="currentColor" strokeOpacity=".2" /><circle cx="60" cy="26" r="5" stroke="currentColor" strokeOpacity=".4" /></>}
    {scene === 'rain' && Array.from({ length: 13 }, (_, i) => <path key={i} d={`M${12 + i * 8} ${6 + i % 3 * 6}l-4 16`} stroke="currentColor" strokeOpacity={0.2 + i % 3 * 0.2} />)}
    {(scene === 'stars' || scene === 'fireflies' || scene === 'snow') && Array.from({ length: 15 }, (_, i) => {
      const x = 10 + (i * 31) % 100, y = 7 + (i * 13) % 33
      return scene === 'stars' && i % 3 === 0 ? <path key={i} d={`M${x} ${y - 3}v6m-3-3h6`} stroke="currentColor" strokeOpacity=".6" /> : <circle key={i} cx={x} cy={y} r={scene === 'fireflies' ? 2.6 : 1.3} fill="currentColor" fillOpacity={0.2 + i % 3 * 0.25} />
    })}
    {scene === 'petals' && Array.from({ length: 7 }, (_, i) => <ellipse key={i} cx={15 + i * 15} cy={10 + i % 3 * 12} rx="2.5" ry="5" transform={`rotate(${i * 30} ${15 + i * 15} ${10 + i % 3 * 12})`} fill="currentColor" fillOpacity={0.3 + i % 2 * 0.25} />)}
    {scene === 'aurora' && [0, 1, 2].map((i) => <path key={i} d={`M5 ${20 + i * 8}Q25 ${-2 + i * 8} 55 ${25 + i * 6}T115 ${7 + i * 8}`} stroke="currentColor" strokeWidth="5" strokeOpacity={0.15 + i * 0.12} />)}
    {scene === 'waves' && [0, 1, 2, 3].map((i) => <path key={i} d={`M5 ${15 + i * 7}Q30 ${i * 7} 60 ${15 + i * 7}T115 ${15 + i * 7}`} stroke="currentColor" strokeOpacity={0.2 + i * 0.15} />)}
    {scene === 'sunshine' && <><circle cx="72" cy="20" r="10" fill="currentColor" fillOpacity=".18" /><circle cx="72" cy="20" r="5" fill="currentColor" fillOpacity=".6" />{[0, 45, 90, 135, 180, 225, 270, 315].map((r) => <path key={r} d="M72 5V1" transform={`rotate(${r} 72 20)`} stroke="currentColor" strokeOpacity=".5" />)}<circle cx="34" cy="31" r="1.5" fill="currentColor" fillOpacity=".3" /></>}
  </svg>
}

export function AppearanceSettings() {
  const { appearance, palette, theme, effects, reducedMotion, storageError, setPalette, setMode, setEffects, resetAppearance } = useTheme()
  const pref = useAnimatedBackground()
  const active = pref.scene === 'none' ? undefined : findScene(pref.scene)
  const values = active ? getSceneValues(pref, active.id) : {}
  const choices = [{ id: 'none' as const, name: '纯净背景' }, ...SCENES]

  return (
    <section id="appearance" className="card appearance-panel scroll-mt-24 p-5 sm:p-8" aria-labelledby="appearance-title">
      <div className="appearance-heading">
        <div className="flex items-center gap-3"><span className="appearance-icon"><Palette size={20} /></span><div><p className="section-eyebrow">MAKE YOURSELF AT HOME</p><h2 id="appearance-title" className="text-xl font-semibold">装扮你的阅读空间</h2></div></div>
        <span className="local-badge">仅本设备</span>
      </div>
      <p className="appearance-intro">换一种色彩，也换一种心情。主题、明暗和背景可以自由搭配，即选即用。</p>

      <fieldset className="mt-7">
        <legend className="appearance-legend">色彩主题 <span>8 个风格，同一个你</span></legend>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PALETTES.map((item) => (
            <label key={item.id} className="theme-choice">
              <input className="sr-only" type="radio" name="palette" value={item.id} checked={appearance.palette === item.id} onChange={() => setPalette(item.id)} aria-label={item.name} />
              <span className="theme-option-content">
                {appearance.palette === item.id && <ShineBorder borderWidth={2} duration={12} shineColor={[item.swatches[0], item.swatches[1]]} />}
                <span className="theme-preview" style={{ '--art-primary': item.swatches[0], '--art-secondary': item.swatches[1], '--art-bg': theme === 'dark' ? item.dark : item.light, backgroundColor: theme === 'dark' ? item.dark : item.light } as CSSProperties}>
                  <ThemeArtwork palette={item.id} miniature />
                  <span className="theme-preview-label">{item.english}</span>
                  <span className="theme-choice-check"><Check size={12} strokeWidth={3} /></span>
                </span>
                <span className="theme-choice-copy"><span className="theme-choice-name">{item.name}<span className="palette-dots">{item.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span></span><span className="theme-choice-description">{item.description}</span></span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="appearance-options-grid">
        <fieldset><legend className="appearance-legend">明暗模式</legend><div className="segmented-control mt-3">{MODES.map(({ id, label, icon: Icon }) => <label key={id}><input type="radio" name="color-mode" className="sr-only" checked={appearance.mode === id} onChange={() => setMode(id)} /><span><Icon size={15} />{label}</span></label>)}</div><p className="control-hint">{appearance.mode === 'system' ? `随系统自动切换，当前为${theme === 'dark' ? '深' : '浅'}色。` : '所有背景均适配当前明暗，不会强制切换。'}</p></fieldset>
        <fieldset><legend className="appearance-legend">动态效果</legend><div className="segmented-control mt-3">{EFFECTS.map(({ id, label, icon: Icon }) => <label key={id}><input type="radio" name="effects" className="sr-only" checked={appearance.effects === id} onChange={() => setEffects(id)} /><span><Icon size={15} />{label}</span></label>)}</div><p className="control-hint">{effects === 'off' ? '保持静态画面，停止背景、装饰与过渡动画。' : effects === 'full' ? '丰富粒子与鼠标聚光；手机端仍自动降低开销。' : '低密度背景与轻柔过渡，兼顾阅读与续航。'}</p></fieldset>
      </div>
      {reducedMotion && <p className="motion-notice"><Leaf size={15} />已遵循系统的“减少动态效果”，暂时使用静态画面；你的动效偏好仍会保留。</p>}

      <fieldset className="scene-fieldset">
        <legend className="appearance-legend">背景氛围 <span>也可以，什么都不加</span></legend>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {choices.map((item) => {
            const Icon = SCENE_ICONS[item.id]
            return <label key={item.id} className="scene-choice"><input type="radio" name="scene" className="sr-only" checked={pref.scene === item.id} onChange={() => setAnimatedScene(item.id)} aria-label={`背景：${item.name}`} /><span className="scene-choice-content"><SceneThumbnail scene={item.id} /><span><Icon size={13} />{item.name}</span></span></label>
          })}
        </div>
      </fieldset>
      <div className="scene-recommendation"><p>{active?.desc || '仅保留主题底色与渐变，让注意力回到文字。'}</p><button type="button" className="recommend-button" onClick={() => setAnimatedScene(palette.scene)}><WandSparkles size={14} />应用主题推荐场景</button></div>

      {active && <div className="scene-parameters">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">微调 · {active.name}</h3><button type="button" className="reset-scene" onClick={() => resetSceneValues(active.id)}><RotateCcw size={12} />恢复场景参数</button></div>
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">{active.params.map((item) => <div key={item.key}><div className="mb-2 flex items-center justify-between"><label htmlFor={`scene-${active.id}-${item.key}`} className="text-xs font-medium">{item.label}</label><output htmlFor={`scene-${active.id}-${item.key}`} className="font-mono text-xs text-brand-600 dark:text-brand-300">{values[item.key]}</output></div><input id={`scene-${active.id}-${item.key}`} type="range" min={item.min} max={item.max} step={item.step} value={values[item.key]} onChange={(event) => setSceneValue(active.id, item.key, Number(event.target.value))} className="scene-range" /><p className="control-hint">{item.hint}</p></div>)}</div>
      </div>}

      <div className="appearance-footer"><p role="status">{storageError ? '浏览器存储不可用，当前选择仅在本次访问中生效。' : `当前：${palette.name} · ${theme === 'dark' ? '深色' : '浅色'} · ${active?.name || '纯净背景'}。自动保存在本设备，不同步到 GitHub。`}</p><button type="button" className="reset-scene shrink-0" onClick={() => { resetAppearance(); resetAnimatedBackground() }}><RotateCcw size={13} />重置主题与特效</button></div>
      <p className="control-hint">重置不会改动字体、字号、自定义渐变或文章。自定义渐变仍可在下方单独调整。</p>
    </section>
  )
}
