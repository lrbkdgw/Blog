import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  Ban,
  ArrowUp,
  CheckCircle2,
  Cloud,
  CloudRain,
  Columns2,
  Download,
  ExternalLink,
  Flower2,
  Github,
  Laptop,
  Loader2,
  LockKeyhole,
  LogOut,
  Moon,
  Network,
  Snowflake,
  Trees,
  Paintbrush,
  Palette,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import {
  findScene,
  getSceneValues,
  resetSceneValues,
  setAnimatedScene,
  setSceneValue,
  useAnimatedBackground,
  type AnimatedBackgroundPreference,
  type SceneId,
} from '../lib/animatedBackground'
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  useFont,
} from '../lib/font'
import { useBackground } from '../lib/background'
import { useTheme } from '../lib/theme'
import { COLOR_THEMES } from '../lib/themes'
import { useToast } from '../components/Toast'
import GithubConnect from '../components/GithubConnect'
import { getRepoTarget, setRepoTarget } from '../lib/github'
import { getLocalPosts, serializePost } from '../lib/posts'
import { STORAGE_KEYS } from '../lib/config'
import { clearRememberedPostUnlocks } from '../lib/crypto'
import { useEditorScrollSync } from '../lib/editorSettings'

type LocalFontData = { family?: string }

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

function Section({
  title,
  desc,
  icon: Icon,
  children,
}: {
  title: string
  desc?: string
  icon: typeof Github
  children: React.ReactNode
}) {
  return (
    <section className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Icon size={17} />
        </span>
        <div>
          <h2 className="font-medium text-ink-900 dark:text-white">{title}</h2>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

const SCENE_OPTIONS: { id: SceneId; label: string; icon: typeof Github }[] = [
  { id: 'none', label: '无', icon: Ban },
  { id: 'sakura', label: '樱花', icon: Flower2 },
  { id: 'network', label: '粒子星链', icon: Network },
  { id: 'snow', label: '雪花', icon: Snowflake },
  { id: 'rain', label: '暴雨', icon: CloudRain },
  { id: 'bamboo', label: '竹林', icon: Trees },
]

/** 明暗模式选项（新增「跟随系统」） */
const MODE_OPTIONS = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Laptop },
] as const

/**
 * 配色主题：色卡即真实主题色（见 src/lib/themes.ts 与 styles/index.css）。
 * 选中后全站的品牌色、光晕与底色一起切换，无需刷新。
 */
function ColorThemeControls() {
  const { colorTheme, setColorTheme, mode, setMode } = useTheme()
  const animated = useAnimatedBackground()
  const toast = useToast()
  const selected = COLOR_THEMES.find((item) => item.id === colorTheme)
  const suggestion = selected?.scene && selected.scene !== animated.scene ? selected : undefined

  return (
    <>
      <div role="radiogroup" aria-label="配色主题" className="grid gap-2.5 sm:grid-cols-2">
        {COLOR_THEMES.map((item) => {
          const active = item.id === colorTheme
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setColorTheme(item.id)}
              className={`group relative flex items-center gap-2.5 overflow-hidden rounded-xl border p-3 text-left transition ${
                active
                  ? 'border-brand-500/70 bg-brand-500/[0.08] shadow-[0_12px_30px_-20px_rgb(var(--brand-600)/0.9)]'
                  : 'border-ink-200 bg-white/60 hover:-translate-y-0.5 hover:border-brand-300 dark:border-white/12 dark:bg-white/[0.03] dark:hover:border-brand-400/40'
              }`}
            >
              <span className="flex h-9 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/5 dark:ring-white/10">
                {item.swatch.map((color) => (
                  <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-ink-900 dark:text-white">{item.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-ink-400">{item.en}</span>
                  {item.darkPreferred && (
                    <span className="rounded-full bg-ink-900/[.06] px-1.5 py-0.5 text-[10px] text-ink-500 dark:bg-white/10 dark:text-ink-300">
                      深色更佳
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-400">{item.desc}</span>
              </span>
              {active && <CheckCircle2 size={16} className="shrink-0 text-brand-600 dark:text-brand-300" />}
            </button>
          )
        })}
      </div>

      {suggestion && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-brand-300/70 bg-brand-500/[0.05] px-3 py-2.5 dark:border-brand-400/30">
          <Sparkles size={14} className="text-brand-500 dark:text-brand-300" />
          <p className="text-xs text-ink-600 dark:text-ink-300">
            「{suggestion.name}」适合搭配动态背景「{suggestion.sceneName}」
          </p>
          <button
            type="button"
            className="btn-outline ml-auto h-8 !px-3 text-xs"
            onClick={() => {
              setAnimatedScene(suggestion.scene as SceneId)
              toast(`已切换到动态背景「${suggestion.sceneName}」`, 'success')
            }}
          >
            一键套用
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink-200/70 pt-4 dark:border-white/10">
        <span className="text-xs font-medium text-ink-500">明暗模式</span>
        <div
          role="radiogroup"
          aria-label="明暗模式"
          className="flex gap-1 rounded-xl border border-ink-200/80 bg-ink-50/60 p-1 dark:border-white/10 dark:bg-white/[0.03]"
        >
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = mode === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(option.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'bg-brand-500/12 text-brand-700 dark:text-brand-200'
                    : 'text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white'
                }`}
              >
                <Icon size={13} />
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-4 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
        主题色阶通过 CSS 变量注入（<span className="font-mono">--brand-50…950</span>），因此按钮、链接、标签、光晕、
        代码高亮外框与动态背景会一起换色。配色主题与明暗模式只保存在本设备，不会写入仓库。
        <br />
        开启配色主题（不是默认的「星野蓝」）后，页头那个单独的明暗切换按钮会自动收起——明暗模式在上面这一行切换，
        切回「星野蓝」按钮即恢复。
      </p>
    </>
  )
}

function AnimatedBackgroundControls({ pref }: { pref: AnimatedBackgroundPreference }) {
  const active = pref.scene === 'none' ? undefined : findScene(pref.scene)
  const values = active ? getSceneValues(pref, active.id) : {}
  return (
    <>
      <div role="radiogroup" aria-label="动态背景场景" className="grid grid-cols-3 gap-2">
        {SCENE_OPTIONS.map((option) => {
          const selected = pref.scene === option.id
          const Icon = option.icon
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setAnimatedScene(option.id)}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition ${
                selected
                  ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-200'
                  : 'border-ink-200 bg-white/60 text-ink-600 hover:border-brand-300 dark:border-white/12 dark:bg-white/[0.03] dark:text-ink-300'
              }`}
            >
              <Icon size={15} />
              {option.label}
            </button>
          )
        })}
      </div>

      {active && (
        <div className="mt-5 space-y-5">
          <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">{active.desc}</p>
          {active.params.map((param) => {
            const value = values[param.key] ?? param.default
            const id = `scene-${active.id}-${param.key}`
            return (
              <div key={param.key}>
                <div className="mb-1.5 flex items-center justify-between gap-4">
                  <label htmlFor={id} className="text-xs font-medium text-ink-500">
                    {param.label}
                  </label>
                  <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-300">
                    {param.min < 0 && value > 0 ? '+' : ''}
                    {value}
                  </span>
                </div>
                <input
                  id={id}
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={value}
                  onChange={(e) => setSceneValue(active.id, param.key, Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-brand-500"
                />
                <p className="mt-1 text-xs leading-relaxed text-ink-400">{param.hint}</p>
              </div>
            )
          })}
          <button type="button" onClick={() => resetSceneValues(active.id)} className="btn-ghost h-9">
            <RotateCcw size={14} />
            恢复本场景默认参数
          </button>
        </div>
      )}

      <p className="mt-5 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
        动态背景仅保存在本设备，不会同步到 GitHub。五种场景都会跟随上面的明暗模式：白昼 / 夜樱、浅色星图 / 暗夜、雪日 / 雪夜、阴雨白昼 / 冷调雨夜、晨光竹林 / 月夜竹林。粒子星链的颜色还会跟随配色主题。切换明暗时保留粒子与竹竿的位置。暴雨的闪电默认关闭，可按需开启。系统开启“减少动态效果”时，背景只显示静态画面。
      </p>
    </>
  )
}

const PRESET_FONTS = [
  'LXGW WenKai',
  '霞鹜文楷',
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Noto Serif SC',
  'Source Han Serif SC',
  'Fira Code',
  'JetBrains Mono',
  'Inter',
  'Roboto',
]

export default function SettingsPage() {
  const { isAuthed, ghUser, canPublish, connectGithub, disconnectGithub, logout } = useAuth()
  const {
    font,
    accountSync,
    addFont,
    removeFont,
    moveFont,
    setFontSize,
    resetFont,
    saveForGithub,
  } = useFont()
  const {
    background,
    accountSync: backgroundAccountSync,
    setBackground,
    resetBackground,
    saveForGithub: saveBackgroundForGithub,
  } = useBackground()
  const animatedBackground = useAnimatedBackground()
  const toast = useToast()
  const [editorScrollSync, setEditorScrollSync] = useEditorScrollSync()

  const [repo, setRepo] = useState(getRepoTarget())
  const [newFontInput, setNewFontInput] = useState('')
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)
  const [savingFont, setSavingFont] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState(background.color || '#FBFBFD')
  const [backgroundIntensity, setBackgroundIntensity] = useState(background.intensity)
  const [savingBackground, setSavingBackground] = useState(false)

  useEffect(() => {
    setBackgroundColor(background.color || '#FBFBFD')
    setBackgroundIntensity(background.intensity)
  }, [background.color, background.intensity])

  const saveRepo = () => {
    setRepoTarget(repo)
    toast('仓库设置已保存到本地', 'success')
  }

  const loadLocalFonts = async () => {
    if (!window.queryLocalFonts) {
      toast('当前浏览器不支持直接读取本机字体库，可直接手动输入字体名称', 'info')
      return
    }

    setLoadingFonts(true)
    try {
      const faces = await window.queryLocalFonts()
      const families = [
        ...new Set(
          faces
            .map((face) => face.family?.trim())
            .filter((name): name is string => Boolean(name)),
        ),
      ].sort((a, b) => a.localeCompare(b, 'zh-CN'))
      setLocalFonts(families)
      toast(`已读取 ${families.length} 个本机字体`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '未取得读取本机字体的权限', 'error')
    } finally {
      setLoadingFonts(false)
    }
  }

  const handleAddFont = async (nameToAdd?: string) => {
    const target = (nameToAdd || newFontInput).trim()
    if (!target) return
    try {
      await addFont(target)
      setNewFontInput('')
      toast(`已将「${target}」加入字体列表`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '字体名称格式错误', 'error')
    }
  }

  const handleRemoveFont = async (target: string) => {
    await removeFont(target)
    toast(`已移除「${target}」`, 'info')
  }

  const handleMoveFont = async (index: number, direction: 'up' | 'down') => {
    await moveFont(index, direction)
  }

  const saveFontToGithub = async () => {
    setSavingFont(true)
    try {
      await saveForGithub()
      toast(`字体与字号偏好已加入待更新队列，统一更新后同步到 @${ghUser?.login}`, 'success', {
        label: '查看队列',
        href: '/admin?tab=queue',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存字体偏好失败', 'error')
    } finally {
      setSavingFont(false)
    }
  }

  const applyBackground = () => {
    try {
      const next = setBackground(backgroundColor, backgroundIntensity)
      setBackgroundColor(next.color || '#FBFBFD')
      setBackgroundIntensity(next.intensity)
      toast(`已应用渐变背景 ${next.color || '系统默认'} · 明显度 ${next.intensity}%`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '背景颜色格式无效', 'error')
    }
  }

  const saveBackgroundToGithub = async () => {
    setSavingBackground(true)
    try {
      await saveBackgroundForGithub()
      toast(`背景颜色偏好已加入待更新队列，统一更新后同步到 @${ghUser?.login}`, 'success', {
        label: '查看队列',
        href: '/admin?tab=queue',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存背景颜色偏好失败', 'error')
    } finally {
      setSavingBackground(false)
    }
  }

  const exportAll = () => {
    const posts = getLocalPosts()
    if (posts.length === 0) {
      toast('没有本地草稿可导出', 'info')
      return
    }
    const bundle = posts
      .map((p) => `<!-- ${p.slug}.md -->\n${serializePost(p)}`)
      .join('\n\n---\n\n')
    const blob = new Blob([bundle], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `starlog-drafts-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`已导出 ${posts.length} 篇本地草稿`, 'success')
  }

  const clearDrafts = () => {
    if (!confirm('将清空本浏览器中的所有本地草稿，且无法恢复。确定？')) return
    localStorage.removeItem(STORAGE_KEYS.drafts)
    window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
    toast('本地草稿已清空', 'info')
  }

  const clearArticleUnlocks = async () => {
    if (!confirm('清除后，所有加密文章下次查看时都需要重新输入密码。确定？')) return
    try {
      await clearRememberedPostUnlocks()
      toast('已清除本设备记住的文章解锁状态', 'info')
    } catch (error) {
      toast(error instanceof Error ? error.message : '清除文章解锁状态失败', 'error')
    }
  }

  const fontList = font.families || []

  return (
    <div className="container-page max-w-3xl pt-12">
      <header className="mb-8 animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">设置</h1>
        <p className="mt-1.5 text-sm text-ink-500">
          个性化设置使用浏览器本地存储与即时更新机制；连接 GitHub 后仍可选择同步偏好至账号。
          <Link
            to={isAuthed ? '/admin' : '/'}
            className="ml-2 text-brand-600 hover:underline dark:text-brand-300"
          >
            ← {isAuthed ? '返回内容管理' : '返回首页'}
          </Link>
        </p>
      </header>

      <div className="space-y-5">
        {/* ------------------------------ 配色主题 ----------------------------- */}
        <Section
          title="配色主题"
          desc="十套配色任选：品牌色、氛围光、页面底色与动态背景会一起换色，切换即时生效，不会丢失文章或草稿。"
          icon={Palette}
        >
          <ColorThemeControls />
        </Section>

        {/* ------------------------------ 多字体设置（优先级回退） ----------------------------- */}
        <Section
          title="字体与字号设置"
          desc="字号会按比例调整全站正文、标题、公式和界面文字；多个字体则按从上到下的优先级依次尝试渲染。"
          icon={Type}
        >
          <div className="rounded-xl border border-ink-200/80 bg-ink-50/60 p-4 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="mb-2 flex items-center justify-between gap-4">
              <label htmlFor="font-size" className="text-xs font-medium text-ink-600 dark:text-ink-300">
                全站字体大小
              </label>
              <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-300">
                {font.sizePercent}%
              </span>
            </div>
            <input
              id="font-size"
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step="5"
              value={font.sizePercent}
              onChange={(event) => setFontSize(Number(event.target.value))}
              className="h-2 w-full cursor-pointer accent-brand-500"
              aria-valuetext={`${font.sizePercent}%`}
            />
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {[85, 90, DEFAULT_FONT_SIZE, 110, 120].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setFontSize(size)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    font.sizePercent === size
                      ? 'border-brand-400 bg-brand-500/10 font-semibold text-brand-600 dark:text-brand-300'
                      : 'border-ink-200 bg-white/70 text-ink-500 hover:border-brand-300 dark:border-white/10 dark:bg-white/5 dark:text-ink-400'
                  }`}
                >
                  {size}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-400">
              会即时缩放文章正文、文章标题、Markdown 标题与 KaTeX 公式，并自动保存到当前浏览器。
            </p>
          </div>

          {/* 添加新字体 */}
          <div className="mt-5 border-t border-ink-200/70 pt-5 dark:border-white/10">
            <p className="mb-2 text-xs font-medium text-ink-500">字体优先级</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="font-family-input"
                list="font-family-suggestions"
                value={newFontInput}
                onChange={(e) => setNewFontInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddFont()
                  }
                }}
                placeholder="输入字体名称，例如：霞鹜文楷、PingFang SC、Fira Code"
                className="input flex-1"
                autoComplete="off"
              />
              <datalist id="font-family-suggestions">
                {localFonts.map((fam) => (
                  <option key={fam} value={fam} />
                ))}
                {PRESET_FONTS.map((fam) => (
                  <option key={fam} value={fam} />
                ))}
              </datalist>

              <button
                type="button"
                onClick={() => handleAddFont()}
                disabled={!newFontInput.trim()}
                className="btn-primary h-10 shrink-0"
              >
                <Plus size={15} />
                添加字体
              </button>
              <button
                type="button"
                onClick={loadLocalFonts}
                disabled={loadingFonts}
                className="btn-outline h-10 shrink-0"
              >
                {loadingFonts ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {localFonts.length > 0 ? `本机 (${localFonts.length})` : '读取本机字体'}
              </button>
            </div>

          {/* 推荐预设字体快捷点击 */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
            <span>推荐常用：</span>
            {PRESET_FONTS.slice(0, 6).map((fam) => (
              <button
                key={fam}
                type="button"
                onClick={() => handleAddFont(fam)}
                className="chip hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-white/10"
              >
                + {fam}
              </button>
            ))}
          </div>

          {/* 已配置的字体列表（优先级排序） */}
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-ink-500">当前字体优先级列表（排在前面的优先使用）：</p>
            {fontList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400 dark:border-white/10">
                当前使用系统默认字体栈。可在上方输入字体名称并点击“添加字体”。
              </div>
            ) : (
              <div className="divide-y divide-ink-200/60 rounded-xl border border-ink-200/80 bg-ink-50/50 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.02]">
                {fontList.map((fam, idx) => (
                  <div key={fam} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/10 font-mono text-[11px] font-bold text-brand-600 dark:text-brand-300">
                        {idx + 1}
                      </span>
                      <span
                        className="font-medium text-ink-800 dark:text-ink-100"
                        style={{ fontFamily: `"${fam}", sans-serif` }}
                      >
                        {fam}
                      </span>
                      {idx === 0 && (
                        <span className="rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-600 dark:text-brand-300">
                          最高优先级
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveFont(idx, 'up')}
                        disabled={idx === 0}
                        title="提升优先级"
                        className="btn-ghost h-7 w-7 !px-0 disabled:opacity-30"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveFont(idx, 'down')}
                        disabled={idx === fontList.length - 1}
                        title="降低优先级"
                        className="btn-ghost h-7 w-7 !px-0 disabled:opacity-30"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFont(fam)}
                        title="移除字体"
                        className="btn-ghost h-7 w-7 !px-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetFont()
                toast('已恢复默认字体与字号', 'success')
              }}
              className="btn-outline h-9"
            >
              <RotateCcw size={14} />
              恢复默认字体与字号
            </button>
            <span className="text-xs text-ink-400">设置自动保存至当前浏览器</span>
          </div>
          </div>

          {canPublish && ghUser ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200/70 pt-4 dark:border-white/10">
              <button
                type="button"
                onClick={saveFontToGithub}
                disabled={savingFont}
                className="btn-outline h-9"
              >
                {savingFont ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
                保存到 GitHub 账号（@{ghUser.login}）
              </button>
              <span className="text-xs text-ink-400">
                {accountSync === 'loading'
                  ? '正在同步账号字体与字号偏好…'
                  : accountSync === 'queued'
                    ? '已加入待更新队列，统一更新后同步到账号'
                    : accountSync === 'synced'
                      ? '字体与字号已与 GitHub 账号同步'
                      : '保存后可在多台设备登录同一账号自动恢复'}
              </span>
            </div>
          ) : (
            <p className="mt-4 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
              访客设置已直接生效并保存在本地。登录 GitHub 账号后还可将字体与字号偏好同步至云端。
            </p>
          )}
        </Section>

        {/* ------------------------------ 背景颜色与强化渐变 ------------------------------ */}
        <Section
          title="背景渐变与透明度"
          desc="可调整背景颜色与渐变强度。强化渐变效果在 100% 最大效果下将覆盖全屏并完全不透明。"
          icon={Paintbrush}
        >
          <label className="mb-1.5 block text-xs font-medium text-ink-500" htmlFor="background-color">
            背景主色调（十六进制）
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="color"
              value={/^#[0-9A-F]{6}$/i.test(backgroundColor) ? backgroundColor : '#FBFBFD'}
              onChange={(e) => setBackgroundColor(e.target.value.toUpperCase())}
              aria-label="选择背景颜色"
              className="h-11 w-full cursor-pointer rounded-xl border border-ink-200 bg-white p-1.5 dark:border-white/12 dark:bg-white/[0.04] sm:w-14"
            />
            <input
              id="background-color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              placeholder="#F5F7FF"
              className="input flex-1 font-mono uppercase"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={applyBackground} className="btn-primary h-10 shrink-0">
              <Paintbrush size={15} />
              应用背景
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-4">
              <label htmlFor="background-intensity" className="text-xs font-medium text-ink-500">
                渐变强度与覆盖度
              </label>
              <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-300">
                {backgroundIntensity}% {backgroundIntensity === 100 ? '（全屏不透明覆盖）' : ''}
              </span>
            </div>
            <input
              id="background-intensity"
              type="range"
              min="0"
              max="100"
              step="1"
              value={backgroundIntensity}
              onChange={(e) => {
                const nextVal = Number(e.target.value)
                setBackgroundIntensity(nextVal)
                setBackground(backgroundColor, nextVal)
              }}
              className="h-2 w-full cursor-pointer accent-brand-500"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              0% 默认站点背景，50% 柔和环境光渐变，100% 强化渐变覆盖全屏且完全不透明。
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className="h-8 w-8 rounded-lg border border-ink-200 shadow-sm dark:border-white/15"
              style={{ backgroundColor: background.color || '#FBFBFD' }}
              aria-label={`当前背景颜色：${background.color || '系统默认'}`}
            />
            <p className="text-xs text-ink-500 dark:text-ink-400">
              当前颜色：
              <span className="font-mono font-medium text-ink-800 dark:text-ink-100">
                {background.color || '系统默认'}
              </span>
              <span className="ml-2">强度 {background.intensity}%</span>
            </p>
            <button
              type="button"
              onClick={() => {
                resetBackground()
                setBackgroundColor('#FBFBFD')
                setBackgroundIntensity(50)
                toast('已恢复系统默认背景', 'success')
              }}
              className="btn-outline ml-auto h-9"
            >
              <RotateCcw size={14} />
              恢复默认
            </button>
          </div>

          {canPublish && ghUser ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200/70 pt-4 dark:border-white/10">
              <button
                type="button"
                onClick={saveBackgroundToGithub}
                disabled={savingBackground}
                className="btn-outline h-9"
              >
                {savingBackground ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
                保存到 GitHub（@{ghUser.login}）
              </button>
              <span className="text-xs text-ink-400">
                {backgroundAccountSync === 'loading'
                  ? '正在恢复账号背景偏好…'
                  : backgroundAccountSync === 'queued'
                    ? '已加入待更新队列，统一更新后同步到账号'
                    : backgroundAccountSync === 'synced'
                      ? '已与该账号的背景偏好同步'
                      : '保存后可在其他设备同步'}
              </span>
            </div>
          ) : (
            <p className="mt-4 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
              访客设置已直接保存在本地。
            </p>
          )}
        </Section>

        {/* ------------------------------ 动态背景 ------------------------------ */}
        <Section
          title="动态背景"
          desc="五种动态场景（樱花、粒子星链、雪花、暴雨、竹林），每种 5 项参数可调，深浅色模式各有一套配色。背景显示在站点内容之下，不影响阅读。"
          icon={CloudRain}
        >
          <AnimatedBackgroundControls pref={animatedBackground} />
        </Section>

        {/* ------------------------------ 编辑器行为 ----------------------------- */}
        <Section
          title="编辑器"
          desc="调整双栏编辑器的工作方式，设置即时生效并自动保存到当前浏览器。"
          icon={Columns2}
        >
          <div className="flex items-center justify-between gap-4 rounded-xl border border-ink-200/80 bg-ink-50/60 p-4 dark:border-white/10 dark:bg-white/[0.025]">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
                双栏自动同步滚动
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-400 dark:text-ink-500">
                开启后，编辑区滚动时预览区会跟随到对应内容位置；关闭后两侧各自独立滚动。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={editorScrollSync}
              onClick={() => setEditorScrollSync(!editorScrollSync)}
              title={editorScrollSync ? '点击关闭自动同步' : '点击开启自动同步'}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                editorScrollSync
                  ? 'bg-brand-500'
                  : 'bg-ink-300 dark:bg-white/15'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-150 ${
                  editorScrollSync ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
            全屏编辑时可按 <kbd className="rounded border border-ink-200 px-1 font-mono text-[10px] dark:border-white/15">Esc</kbd> 或点击右上角按钮退出。
          </p>
        </Section>

        {/* ------------------------------ GitHub 连接 ----------------------------- */}
        <Section
          title="GitHub 连接"
          desc="连接后即可在线发表/申请文章、参与审核、上传图片，并同步个人偏好。"
          icon={Github}
        >
          {canPublish && ghUser ? (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07]">
              <img src={ghUser.avatar_url} alt="" className="h-11 w-11 rounded-full" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900 dark:text-white">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  {ghUser.name || ghUser.login}
                </p>
                <a
                  href={ghUser.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 flex items-center gap-1 text-xs text-ink-500 hover:text-brand-600"
                >
                  @{ghUser.login}
                  <ExternalLink size={11} />
                </a>
              </div>
              <button onClick={disconnectGithub} className="btn-outline h-9">
                断开连接
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <GithubConnect
                size="sm"
                label="使用 GitHub 授权连接"
                onToken={async (token) => {
                  const user = await connectGithub(token)
                  toast(`已连接 GitHub：@${user.login}`, 'success')
                }}
              />
              <p className="flex items-center gap-1 text-xs text-ink-400 dark:text-ink-500">
                通过 OAuth（Device Flow）授权，无需手动创建 Token；可随时在
                <a
                  href="https://github.com/settings/applications"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-0.5 text-brand-600 hover:underline dark:text-brand-300"
                >
                  GitHub 授权管理
                  <ExternalLink size={11} />
                </a>
                撤销。
              </p>
            </div>
          )}
        </Section>

        {/* ------------------------------ 目标仓库设置 ------------------------------- */}
        <Section title="目标仓库" desc="文章发布与 PR 提交的目标 GitHub 仓库。" icon={Save}>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { key: 'owner', label: '用户 / 组织', placeholder: 'lrbkdgw', locked: false },
                { key: 'repo', label: '仓库名', placeholder: 'Blog', locked: false },
                { key: 'branch', label: '分支（由构建配置决定）', placeholder: 'main', locked: true },
                { key: 'postsDir', label: '文章目录（由构建配置决定）', placeholder: 'content/posts', locked: true },
              ] as const
            ).map((f) => (
              <div key={f.key}>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">{f.label}</label>
                <input
                  value={repo[f.key]}
                  onChange={(e) => setRepo({ ...repo, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  disabled={f.locked}
                  title={f.locked ? '站点只读取构建时配置的分支与目录，此项不可在本地修改' : undefined}
                  className="input font-mono text-xs disabled:opacity-60"
                />
              </div>
            ))}
          </div>
          <button onClick={saveRepo} className="btn-primary mt-4 h-9">
            <Save size={15} />
            保存仓库设置
          </button>
        </Section>

        {/* ------------------------------ 本地数据 ------------------------------- */}
        <Section
          title="本地数据管理"
          desc="草稿与个性化偏好保存在 localStorage；加密文章的不可导出解锁密钥保存在 IndexedDB。清除站点数据会一并移除。"
          icon={Download}
        >
          <div className="flex flex-wrap gap-2">
            <button onClick={exportAll} className="btn-outline h-9">
              <Download size={15} />
              导出全部草稿
            </button>
            <button onClick={clearDrafts} className="btn-danger h-9">
              <Trash2 size={15} />
              清空本地草稿
            </button>
            <button onClick={() => void clearArticleUnlocks()} className="btn-outline h-9">
              <LockKeyhole size={15} />
              忘记文章解锁状态
            </button>
            {isAuthed && (
              <button onClick={logout} className="btn-ghost ml-auto h-9">
                <LogOut size={15} />
                退出登录
              </button>
            )}
          </div>
        </Section>

        {/* -------------------------------- 安全说明 ------------------------------ */}
        <section className="card animate-fade-up border-amber-200/80 bg-amber-50/50 p-5 dark:border-amber-500/20 dark:!bg-amber-500/[0.06]">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <ShieldAlert size={15} />
            关于安全与权限
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
            <li>所有访客与已登录用户均可自由配置字体、背景与深浅色模式。</li>
            <li>GitHub 使用 OAuth（Device Flow）授权，站点不接触你的密码。</li>
            <li>普通登录用户发表文章会自动走 Pull Request 审批流程；仓库管理员可直接审核合并。</li>
            <li>在公共电脑上使用完毕后，请点击「退出登录」清理本地令牌。</li>
          </ul>
        </section>
      </div>

      <div className="h-16" />
    </div>
  )
}
