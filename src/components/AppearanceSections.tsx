import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cloud,
  Download,
  Github,
  Loader2,
  Moon,
  Paintbrush,
  Palette,
  Plus,
  RotateCcw,
  Sun,
  Type,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { useFont } from '../lib/font'
import { useBackground } from '../lib/background'
import { useToast } from './Toast'

type LocalFontData = { family?: string }

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

export function Section({
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

/* --------------------------------- 外观 --------------------------------- */

export function ThemeSection() {
  const { theme, setTheme } = useTheme()
  return (
    <Section title="外观" desc="深色模式会自动跟随系统，也可以在这里手动固定。访客也可以设置，保存在本浏览器。" icon={Palette}>
      <div className="flex gap-2">
        {(
          [
            { id: 'light', label: '浅色', icon: Sun },
            { id: 'dark', label: '深色', icon: Moon },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition ${
              theme === t.id
                ? 'border-brand-500 bg-brand-500/[0.07] text-brand-700 dark:text-brand-300'
                : 'border-ink-200 text-ink-500 hover:border-ink-300 dark:border-white/10 dark:hover:border-white/20'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>
    </Section>
  )
}

/* --------------------------------- 字体 --------------------------------- */

const SOURCE_LABEL = { local: '本机', cloud: '云端', missing: '未找到' } as const
const SOURCE_STYLE = {
  local: 'text-emerald-600 dark:text-emerald-400',
  cloud: 'text-brand-600 dark:text-brand-300',
  missing: 'text-amber-600 dark:text-amber-400',
} as const

export function FontSection() {
  const { ghUser, canPublish } = useAuth()
  const { font, status: fontStatus, resolved, accountSync, setFonts, resetFont, saveForGithub } = useFont()
  const toast = useToast()

  const [fontList, setFontList] = useState<string[]>(font.families)
  const [fontName, setFontName] = useState('')
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)
  const [applyingFont, setApplyingFont] = useState(false)
  const [savingFont, setSavingFont] = useState(false)

  useEffect(() => setFontList(font.families), [font.families])

  const addFont = () => {
    const name = fontName.trim()
    if (!name) return
    if (fontList.some((f) => f.toLowerCase() === name.toLowerCase())) {
      toast(`「${name}」已在字体列表中`, 'info')
      return
    }
    if (fontList.length >= 6) {
      toast('最多设置 6 个字体', 'warning')
      return
    }
    setFontList([...fontList, name])
    setFontName('')
  }

  const move = (index: number, delta: number) => {
    const next = [...fontList]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setFontList(next)
  }

  const removeAt = (index: number) => setFontList(fontList.filter((_, i) => i !== index))

  const loadLocalFonts = async () => {
    if (!window.queryLocalFonts) {
      toast('当前浏览器不支持读取本机字体；可直接手动输入已安装的字体名称', 'info')
      return
    }
    setLoadingFonts(true)
    try {
      const faces = await window.queryLocalFonts()
      const families = [...new Set(faces.map((face) => face.family?.trim()).filter((name): name is string => !!name))].sort(
        (a, b) => a.localeCompare(b, 'zh-CN'),
      )
      setLocalFonts(families)
      toast(`已读取 ${families.length} 个本机字体`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '未取得读取本机字体的权限', 'error')
    } finally {
      setLoadingFonts(false)
    }
  }

  const applyFonts = async () => {
    setApplyingFont(true)
    try {
      const next = await setFonts(fontList)
      if (next.families.length === 0) {
        toast('已恢复默认字体', 'success')
        return
      }
      const missing = next.families.filter((f) => resolved[f] === 'missing')
      if (missing.length === next.families.length) {
        toast('这些字体本机和云端都没有，实际显示将回退到系统字体', 'warning')
      } else if (missing.length > 0) {
        toast(`已应用字体栈；「${missing.join('」「')}」未找到，将排它后面的字体顶上`, 'info')
      } else {
        toast(`已应用 ${next.families.length} 个字体，按优先级依次生效`, 'success')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '字体名称无效', 'error')
    } finally {
      setApplyingFont(false)
    }
  }

  const saveFontToGithub = async () => {
    setSavingFont(true)
    try {
      await saveForGithub()
      toast(`字体偏好已保存到 GitHub 账号 @${ghUser?.login}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存字体偏好失败', 'error')
    } finally {
      setSavingFont(false)
    }
  }

  return (
    <Section
      title="字体"
      desc="可以设置多个字体（最多 6 个），页面按列表顺序从上到下依次尝试：本机没有的会尝试云端加载，都找不到的会自动落到下一个字体。访客设置会保存在本浏览器。"
      icon={Type}
    >
      {/* 当前字体栈 */}
      {fontList.length > 0 && (
        <ol className="mb-3 space-y-1.5">
          {fontList.map((family, i) => (
            <li
              key={`${family}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-ink-200/80 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-500/10 font-mono text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-800 dark:text-ink-100" style={{ fontFamily: `"${family.replace(/["\\]/g, '')}"` }}>
                {family}
              </span>
              {resolved[family] && (
                <span className={`shrink-0 text-[11px] ${SOURCE_STYLE[resolved[family]]}`}>
                  {SOURCE_LABEL[resolved[family]]}
                </span>
              )}
              <span className="flex shrink-0 items-center">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移" title="提高优先级" className="rounded p-1 text-ink-400 transition hover:text-ink-800 disabled:opacity-30 dark:hover:text-white">
                  <ArrowUp size={13} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === fontList.length - 1} aria-label="下移" title="降低优先级" className="rounded p-1 text-ink-400 transition hover:text-ink-800 disabled:opacity-30 dark:hover:text-white">
                  <ArrowDown size={13} />
                </button>
                <button onClick={() => removeAt(i)} aria-label="移除" title="移除" className="rounded p-1 text-ink-400 transition hover:text-rose-500">
                  <X size={13} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* 添加字体 */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          list="local-font-families"
          value={fontName}
          onChange={(e) => setFontName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addFont()
            }
          }}
          placeholder="例如：霞鹜文楷、PingFang SC、Noto Serif SC"
          className="input flex-1"
          autoComplete="off"
        />
        <datalist id="local-font-families">
          {localFonts.map((family) => (
            <option key={family} value={family} />
          ))}
        </datalist>
        <button type="button" onClick={addFont} disabled={!fontName.trim()} className="btn-outline h-10 shrink-0">
          <Plus size={15} />
          添加
        </button>
        <button type="button" onClick={loadLocalFonts} disabled={loadingFonts} className="btn-outline h-10 shrink-0">
          {loadingFonts ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {localFonts.length > 0 ? `本机字体（${localFonts.length}）` : '读取本机字体'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={applyFonts} disabled={applyingFont} className="btn-primary h-10">
          {applyingFont ? <Loader2 size={15} className="animate-spin" /> : <Type size={15} />}
          {applyingFont ? '正在检测字体…' : '应用字体'}
        </button>
        <button
          type="button"
          onClick={() => {
            resetFont()
            setFontList([])
            toast('已恢复默认字体', 'success')
          }}
          className="btn-outline h-10"
        >
          <RotateCcw size={15} />
          恢复默认
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-ink-200/80 bg-ink-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-300">
          当前字体栈：
          <span className="ml-1 font-medium text-ink-900 dark:text-white">
            {font.families.length > 0 ? font.families.join(' → ') : '系统默认'}
          </span>
          {fontStatus === 'checking-local' && <span className="ml-2 text-ink-400">正在检测本机字体…</span>}
          {fontStatus === 'loading-cloud' && <span className="ml-2 text-ink-400">正在请求云端字体…</span>}
          {fontStatus === 'fallback' && <span className="ml-2 text-amber-600 dark:text-amber-400">均未找到，已回退系统字体</span>}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Chromium 浏览器会请求一次“读取本机字体”权限；不支持该功能的浏览器仍可直接输入本机字体名称。
        </p>
      </div>

      {canPublish && ghUser ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200/70 pt-4 dark:border-white/10">
          <button type="button" onClick={saveFontToGithub} disabled={savingFont} className="btn-outline h-9">
            {savingFont ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
            保存到 GitHub（@{ghUser.login}）
          </button>
          <span className="text-xs text-ink-400">
            {accountSync === 'loading'
              ? '正在恢复账号字体偏好…'
              : accountSync === 'synced'
                ? '已与该账号的字体偏好同步'
                : accountSync === 'error'
                  ? '账号字体偏好同步失败，可重试保存'
                  : '保存后，下次登录同一账号会自动恢复'}
          </span>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-1.5 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
          <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />
          未登录也能设置字体——选择会保存在本浏览器；登录并连接 GitHub 后还可以同步到账号。
        </p>
      )}
    </Section>
  )
}

/* ------------------------------- 背景颜色 ------------------------------- */

export function BackgroundSection() {
  const { ghUser, canPublish } = useAuth()
  const { background, accountSync, setBackground, resetBackground, saveForGithub } = useBackground()
  const toast = useToast()

  const [backgroundColor, setBackgroundColor] = useState(background.color || '#FBFBFD')
  const [backgroundIntensity, setBackgroundIntensity] = useState(background.intensity)
  const [savingBackground, setSavingBackground] = useState(false)

  useEffect(() => {
    setBackgroundColor(background.color || '#FBFBFD')
    setBackgroundIntensity(background.intensity)
  }, [background.color, background.intensity])

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
      await saveForGithub()
      toast(`背景颜色偏好已保存到 GitHub 账号 @${ghUser?.login}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存背景颜色偏好失败', 'error')
    } finally {
      setSavingBackground(false)
    }
  }

  return (
    <Section
      title="背景颜色"
      desc="所选颜色会作为双渐变柔光叠加到背景上，保留原有的渐变层次；可调整颜色的明显程度。访客设置会保存在本浏览器。"
      icon={Paintbrush}
    >
      <label className="mb-1.5 block text-xs font-medium text-ink-500" htmlFor="background-color">
        十六进制颜色
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
            渐变颜色明显度
          </label>
          <span className="font-mono text-xs font-medium text-brand-600 dark:text-brand-300">{backgroundIntensity}%</span>
        </div>
        <input
          id="background-intensity"
          type="range"
          min="0"
          max="100"
          step="1"
          value={backgroundIntensity}
          onChange={(e) => setBackgroundIntensity(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-brand-500"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
          0% 隐藏自定义柔光，50% 接近原有渐变效果，100% 为最明显效果。点击“应用背景”后生效。
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className="h-8 w-8 rounded-lg border border-ink-200 shadow-sm dark:border-white/15"
          style={{ backgroundColor: background.color || '#FBFBFD' }}
          aria-label={`当前背景颜色：${background.color || '系统默认'}`}
        />
        <p className="text-xs text-ink-500 dark:text-ink-400">
          当前叠加色：<span className="font-mono font-medium text-ink-800 dark:text-ink-100">{background.color || '未设置'}</span>
          <span className="ml-2">渐变明显度 {background.intensity}%</span>
        </p>
        <button
          type="button"
          onClick={() => {
            resetBackground()
            setBackgroundColor('#FBFBFD')
            setBackgroundIntensity(50)
            toast('已恢复系统默认渐变背景', 'success')
          }}
          className="btn-outline ml-auto h-9"
        >
          <RotateCcw size={15} />
          恢复默认
        </button>
      </div>

      {canPublish && ghUser ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200/70 pt-4 dark:border-white/10">
          <button type="button" onClick={saveBackgroundToGithub} disabled={savingBackground} className="btn-outline h-9">
            {savingBackground ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
            保存到 GitHub（@{ghUser.login}）
          </button>
          <span className="text-xs text-ink-400">
            {accountSync === 'loading'
              ? '正在恢复账号背景偏好…'
              : accountSync === 'synced'
                ? '已与该账号的背景偏好同步'
                : accountSync === 'error'
                  ? '账号背景偏好同步失败，可重试保存'
                  : '保存后，下次登录同一账号会自动恢复'}
          </span>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-1.5 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
          <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />
          未登录也能设置背景——选择会保存在本浏览器；登录并连接 GitHub 后还可以同步到账号。
        </p>
      )}
    </Section>
  )
}
