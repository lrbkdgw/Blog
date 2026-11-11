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
  type FontTarget,
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
import { OfflineSettingsCard } from '../components/OfflineSettingsCard'
import { LanCollabCard } from '../components/LanCollabCard'
import { OFFLINE } from '../lib/runtime'

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

      {/*
        这里原先有一条「某主题适合搭配动态背景某场景」的提示条，但主题的 `scene`
        允许是 'none'（字符串 truthy），于是星野蓝 / 落日橙 / 森野绿 / 鎏金 / 墨白
        都会弹出「适合搭配动态背景『无』」这种空提示（见 issue #55）。
        搭配建议本来就已经写在每张色卡的描述文字里，因此整条提示移除。
      */}

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

    </>
  )
}

/** 正文字体的推荐预设（默认栈已经是 Google Sans → Noto Sans CJK SC）。 */
const PRESET_SANS_FONTS = [
  'Google Sans',
  'Noto Sans CJK SC',
  'LXGW WenKai',
  '霞鹜文楷',
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Noto Serif SC',
  'Source Han Serif SC',
  'Inter',
  'Roboto',
]

/** 代码字体的推荐预设（默认栈已经是 Cascadia Code）。 */
const PRESET_MONO_FONTS = [
  'Cascadia Code',
  'JetBrains Mono',
  'Fira Code',
  'Maple Mono',
  'Sarasa Mono SC',
  'LXGW WenKai Mono',
  'Source Code Pro',
  'Roboto Mono',
  'SF Mono',
  'Consolas',
]

/**
 * 一组字体的优先级编辑器：正文与代码各渲染一份（issue #54）。
 * 排在前面的优先使用，缺字形时依次往后回退，最后落到站点默认字体栈。
 */
function FontPriorityEditor({
  target,
  title,
  desc,
  placeholder,
  presets,
  localFonts,
  loadingFonts,
  onReadLocalFonts,
}: {
  target: FontTarget
  title: string
  desc: string
  placeholder: string
  presets: string[]
  localFonts: string[]
  loadingFonts: boolean
  onReadLocalFonts: () => void
}) {
  const { font, addFont, removeFont, moveFont } = useFont()
  const toast = useToast()
  const [input, setInput] = useState('')
  const mono = target === 'mono'
  const list = mono ? font.monoFamilies : font.families
  const inputId = `font-${target}-input`
  const suggestionsId = `font-${target}-suggestions`

  const handleAdd = async (nameToAdd?: string) => {
    const value = (nameToAdd || input).trim()
    if (!value) return
    try {
      await addFont(value, target)
      setInput('')
      toast(`已将「${value}」加入${title}列表`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '字体名称格式错误', 'error')
    }
  }

  return (
    <div className="mt-5 border-t border-ink-200/70 pt-5 dark:border-white/10">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <p className="text-xs font-medium text-ink-500">{title}优先级</p>
        <span className="font-mono text-[10px] text-ink-400">{mono ? '--font-mono' : '--font-sans'}</span>
      </div>
      <p className="mb-2.5 text-xs leading-relaxed text-ink-400">{desc}</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          list={suggestionsId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleAdd()
            }
          }}
          placeholder={placeholder}
          className={`input flex-1 ${mono ? 'font-mono' : ''}`}
          autoComplete="off"
        />
        <datalist id={suggestionsId}>
          {[...new Set([...presets, ...localFonts])].map((fam) => (
            <option key={fam} value={fam} />
          ))}
        </datalist>

        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!input.trim()}
          className="btn-primary h-10 shrink-0"
        >
          <Plus size={15} />
          添加字体
        </button>
        <button
          type="button"
          onClick={onReadLocalFonts}
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
        {presets.slice(0, 6).map((fam) => (
          <button
            key={fam}
            type="button"
            onClick={() => void handleAdd(fam)}
            className="chip hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-white/10"
          >
            + {fam}
          </button>
        ))}
      </div>

      {/* 已配置的字体列表（优先级排序） */}
      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-ink-500">当前{title}优先级列表（排在前面的优先使用）：</p>
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400 dark:border-white/10">
            当前使用站点默认{title}栈。可在上方输入字体名称并点击“添加字体”。
          </div>
        ) : (
          <div className="divide-y divide-ink-200/60 rounded-xl border border-ink-200/80 bg-ink-50/50 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.02]">
            {list.map((fam, idx) => (
              <div key={fam} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/10 font-mono text-[11px] font-bold text-brand-600 dark:text-brand-300">
                    {idx + 1}
                  </span>
                  <span
                    className={`truncate font-medium text-ink-800 dark:text-ink-100 ${mono ? 'font-mono' : ''}`}
                    style={{ fontFamily: `"${fam}", ${mono ? 'monospace' : 'sans-serif'}` }}
                  >
                    {fam}
                  </span>
                  {idx === 0 && (
                    <span className="shrink-0 rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-600 dark:text-brand-300">
                      最高优先级
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void moveFont(idx, 'up', target)}
                    disabled={idx === 0}
                    title="提升优先级"
                    className="btn-ghost h-7 w-7 !px-0 disabled:opacity-30"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveFont(idx, 'down', target)}
                    disabled={idx === list.length - 1}
                    title="降低优先级"
                    className="btn-ghost h-7 w-7 !px-0 disabled:opacity-30"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await removeFont(fam, target)
                      toast(`已从${title}列表移除「${fam}」`, 'info')
                    }}
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

      {/* 实时样例：所见即所得，正文字体也用它检查中西文混排 */}
      <p
        className={`mt-3 rounded-xl border border-ink-200/70 bg-white/60 px-3 py-2 text-xs leading-relaxed text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-300 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {mono ? 'const 星野 = 0x2A; // AaBbCc 0123 ->=> !==' : '星野笔记 Starlog · AaBbCc 0123'}
      </p>
    </div>
  )
}

export default function SettingsPage() {
  const { isAuthed, ghUser, canPublish, connectGithub, disconnectGithub, logout } = useAuth()
  const { font, accountSync, setFontSize, resetFont, saveForGithub } = useFont()
  const {
    background,
    accountSync: appearanceAccountSync,
    setBackground,
    resetBackground,
    saveForGithub: saveAppearanceForGithub,
  } = useBackground()
  const animatedBackground = useAnimatedBackground()
  const toast = useToast()
  const [editorScrollSync, setEditorScrollSync] = useEditorScrollSync()

  const [repo, setRepo] = useState(getRepoTarget())
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)
  const [savingFont, setSavingFont] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState(background.color || '#FBFBFD')
  const [backgroundIntensity, setBackgroundIntensity] = useState(background.intensity)
  const [savingAppearance, setSavingAppearance] = useState(false)

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

  const saveAppearanceToGithub = async () => {
    setSavingAppearance(true)
    try {
      await saveAppearanceForGithub()
      toast(`外观偏好已加入待更新队列，统一更新后同步到 @${ghUser?.login}`, 'success', {
        label: '查看队列',
        href: '/admin?tab=queue',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存外观偏好失败', 'error')
    } finally {
      setSavingAppearance(false)
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


  return (
    <div className="container-page max-w-3xl pt-12" data-yield-list>
      <header className="mb-8 animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">设置</h1>
        <p className="mt-1.5 text-sm text-ink-500">
          {OFFLINE
            ? '个性化设置使用浏览器本地存储与即时更新机制。离线版不联网，因此没有账号同步：偏好只保存在这台设备的这个文件里。'
            : '个性化设置使用浏览器本地存储与即时更新机制；连接 GitHub 后仍可选择同步偏好至账号。'}
          <Link
            to={isAuthed ? '/admin' : '/'}
            className="ml-2 text-brand-600 hover:underline dark:text-brand-300"
          >
            ← {isAuthed ? '返回内容管理' : '返回首页'}
          </Link>
        </p>
      </header>

      <div className="space-y-5" data-yield-list>
        {/* ------------------------------ 配色主题 ----------------------------- */}
        <Section
          title="配色主题"
          desc="十套配色任选：品牌色、氛围光、页面底色与动态背景会一起换色，切换即时生效，不会丢失文章或草稿。"
          icon={Palette}
        >
          <ColorThemeControls />
        </Section>

        {/* --------------------- 字号 + 正文字体 / 代码字体两组优先级（issue #54） --------------------- */}
        <Section
          title="字体与字号设置"
          desc="字号会按比例调整全站正文、标题、公式和界面文字；正文字体与代码字体是两组独立的优先级，各自按从上到下依次尝试渲染，留空则用站点默认字体栈。"
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

          {/* 正文字体：一组优先级列表 */}
          <FontPriorityEditor
            target="sans"
            title="正文字体"
            desc="作用于文章正文、标题与界面文字。留空则使用站点默认栈：Google Sans → Noto Sans CJK SC → 系统字体。"
            placeholder="输入字体名称，例如：Google Sans、霞鹜文楷、PingFang SC"
            presets={PRESET_SANS_FONTS}
            localFonts={localFonts}
            loadingFonts={loadingFonts}
            onReadLocalFonts={loadLocalFonts}
          />

          {/* 代码字体：单独一组优先级列表（issue #54） */}
          <FontPriorityEditor
            target="mono"
            title="代码字体"
            desc="作用于代码块、行内代码、快捷键与表格里的等宽文字。留空则使用站点默认栈：Cascadia Code → 系统等宽字体。"
            placeholder="输入字体名称，例如：Cascadia Code、JetBrains Mono、Fira Code"
            presets={PRESET_MONO_FONTS}
            localFonts={localFonts}
            loadingFonts={loadingFonts}
            onReadLocalFonts={loadLocalFonts}
          />

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-200/70 pt-5 dark:border-white/10">
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
            <span className="text-xs text-ink-400">
              会同时清空正文与代码字体，回到站点默认字体栈；设置自动保存至当前浏览器
            </span>
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
              {OFFLINE
                ? '离线版只使用本机已安装的字体（不会请求云端字体）；本机没有的字体名会按默认字体栈显示。'
                : '访客设置已直接生效并保存在本地。登录 GitHub 账号后还可将字体与字号偏好同步至云端。'}
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
        </Section>

        {/* ------------------------------ 动态背景 ------------------------------ */}
        <Section
          title="动态背景"
          desc="五种动态场景（樱花、粒子星链、雪花、暴雨、竹林），每种 5 项参数可调，深浅色模式各有一套配色。背景显示在站点内容之下，不影响阅读。"
          icon={CloudRain}
        >
          <AnimatedBackgroundControls pref={animatedBackground} />
        </Section>

        {/* ------------------------------ 外观偏好同步 ------------------------------ */}
        {!OFFLINE && (
          <Section
          title="外观偏好同步"
          desc="把配色主题、明暗模式、背景渐变与动态背景一起保存到 GitHub 账号；在其他设备登录同一账号后会读取并恢复。"
          icon={Cloud}
        >
          {canPublish && ghUser ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveAppearanceToGithub}
                disabled={savingAppearance}
                className="btn-outline h-9"
              >
                {savingAppearance ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
                同步外观到 GitHub（@{ghUser.login}）
              </button>
              <span className="text-xs text-ink-400">
                {appearanceAccountSync === 'loading'
                  ? '正在恢复账号外观偏好…'
                  : appearanceAccountSync === 'queued'
                    ? '已加入待更新队列，统一更新后同步到账号'
                    : appearanceAccountSync === 'synced'
                      ? '已与该账号的外观偏好同步'
                      : '保存后可在其他设备登录同一账号自动恢复'}
              </span>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-ink-400">
              {OFFLINE
                ? '离线版的外观偏好只保存在本机（这个文件不联网，也就没有账号同步）。'
                : '访客设置已直接保存在本地。登录并连接 GitHub 账号后，可在这里把外观偏好同步到云端。'}
            </p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            偏好保存在仓库的 <code className="font-mono">.starlog/settings/background-preferences/</code> 下，每个 GitHub 账号一个文件，不会影响文章与站点其他人的设置。
          </p>
        </Section>
        )}

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
        {!OFFLINE && (
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
        )}

        {/* ------------------------------ 目标仓库设置 ------------------------------- */}
        {!OFFLINE && (
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
        )}

        {/* ------------------------------ 离线版专属 ------------------------------ */}
        {OFFLINE && <OfflineSettingsCard />}
        {OFFLINE && <LanCollabCard />}

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
            {OFFLINE ? (
              <>
                <li>离线版不联网：不登录、不请求云端字体、不加载远程图片，也不提交仓库。</li>
                <li>全部数据只存在这台设备的浏览器里；清除浏览器数据会一并删掉，请在上方「离线版」卡片导出档案备份。</li>
              </>
            ) : (
              <>
                <li>GitHub 使用 OAuth（Device Flow）授权，站点不接触你的密码。</li>
                <li>普通登录用户发表文章会自动走 Pull Request 审批流程；仓库管理员可直接审核合并。</li>
                <li>在公共电脑上使用完毕后，请点击「退出登录」清理本地令牌。</li>
              </>
            )}
          </ul>
        </section>
      </div>

      <div className="h-16" />
    </div>
  )
}
