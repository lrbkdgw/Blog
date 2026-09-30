import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  Github,
  Loader2,
  LogOut,
  Moon,
  Paintbrush,
  Palette,
  RotateCcw,
  Save,
  ShieldAlert,
  Sun,
  Trash2,
  Type,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { useFont } from '../lib/font'
import { useBackground } from '../lib/background'
import { useToast } from '../components/Toast'
import GithubConnect from '../components/GithubConnect'
import { getRepoTarget, setRepoTarget } from '../lib/github'
import { getLocalPosts, serializePost } from '../lib/posts'
import { STORAGE_KEYS } from '../lib/config'

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

export default function SettingsPage() {
  const { isAuthed, ghUser, canPublish, connectGithub, disconnectGithub, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { font, status: fontStatus, accountSync, setFont, resetFont, saveForGithub } = useFont()
  const {
    background,
    accountSync: backgroundAccountSync,
    setBackground,
    resetBackground,
    saveForGithub: saveBackgroundForGithub,
  } = useBackground()
  const toast = useToast()

  const [repo, setRepo] = useState(getRepoTarget())
  const [fontName, setFontName] = useState(font.family)
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)
  const [applyingFont, setApplyingFont] = useState(false)
  const [savingFont, setSavingFont] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState(background.color || '#FBFBFD')
  const [backgroundIntensity, setBackgroundIntensity] = useState(background.intensity)
  const [savingBackground, setSavingBackground] = useState(false)

  useEffect(() => setFontName(font.family), [font.family])
  useEffect(() => {
    setBackgroundColor(background.color || '#FBFBFD')
    setBackgroundIntensity(background.intensity)
  }, [background.color, background.intensity])

  const saveRepo = () => {
    setRepoTarget(repo)
    toast('仓库设置已保存', 'success')
  }

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

  const applySelectedFont = async () => {
    setApplyingFont(true)
    try {
      const next = await setFont(fontName, localFonts.includes(fontName.trim()))
      if (fontName.trim() && next.source === 'default') {
        toast('本机未找到该字体，云端请求失败或超时，已回退为默认字体', 'info')
      } else if (!next.family) {
        toast('已恢复默认字体', 'success')
      } else if (next.source === 'cloud') {
        toast(`已从云端加载「${next.family}」`, 'success')
      } else {
        toast(`已应用本机字体「${next.family}」`, 'success')
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
      toast(`背景颜色偏好已保存到 GitHub 账号 @${ghUser?.login}`, 'success')
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
    const bundle = posts.map((p) => `<!-- ${p.slug}.md -->\n${serializePost(p)}`).join('\n\n---\n\n')
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

  return (
    <div className="container-page max-w-3xl pt-12">
      <header className="mb-8 animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">设置</h1>
        <p className="mt-1.5 text-sm text-ink-500">
          常规设置保存在当前浏览器；连接 GitHub 后可将字体与背景颜色同步到账号。
          <Link to={isAuthed ? '/admin' : '/'} className="ml-2 text-brand-600 hover:underline dark:text-brand-300">
            ← {isAuthed ? '返回内容管理' : '返回首页'}
          </Link>
        </p>
      </header>

      <div className="space-y-5">
        {/* ------------------------------ GitHub 连接 ----------------------------- */}
        <Section
          title="GitHub 连接"
          desc="连接后即可在线发布文章、上传图片，并从站内删除仓库中的文章。"
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

        {/* ------------------------------ 仓库设置 ------------------------------- */}
        <Section title="目标仓库" desc="文章将被提交到这个仓库的指定目录。" icon={Save}>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { key: 'owner', label: '用户 / 组织', placeholder: 'lrbkdgw' },
                { key: 'repo', label: '仓库名', placeholder: 'Blog' },
                { key: 'branch', label: '分支', placeholder: 'main' },
                { key: 'postsDir', label: '文章目录', placeholder: 'content/posts' },
              ] as const
            ).map((f) => (
              <div key={f.key}>
                <label className="mb-1.5 block text-xs font-medium text-ink-500">{f.label}</label>
                <input
                  value={repo[f.key]}
                  onChange={(e) => setRepo({ ...repo, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="input font-mono text-xs"
                />
              </div>
            ))}
          </div>
          <button onClick={saveRepo} className="btn-outline mt-4 h-9">
            <Save size={15} />
            保存
          </button>
        </Section>

        {/* -------------------------------- 外观 --------------------------------- */}
        <Section title="外观" desc="深色模式会自动跟随系统，也可以在这里手动固定。" icon={Palette}>
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

        {/* -------------------------------- 字体 --------------------------------- */}
        <Section
          title="字体"
          desc="按优先级填写多个字体（用逗号或换行分隔）。系统会依次检测本机字体、尝试云端加载，最后回退到系统字体；访客偏好也会保存在当前浏览器。"
          icon={Type}
        >
          <label className="mb-1.5 block text-xs font-medium text-ink-500" htmlFor="font-family">
            字体优先级列表
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="font-family"
              list="local-font-families"
              value={fontName}
              onChange={(e) => setFontName(e.target.value)}
              placeholder="例如：霞鹜文楷, PingFang SC, Noto Serif SC"
              className="input flex-1"
              autoComplete="off"
            />
            <datalist id="local-font-families">
              {localFonts.map((family) => (
                <option key={family} value={family} />
              ))}
            </datalist>
            <button type="button" onClick={loadLocalFonts} disabled={loadingFonts} className="btn-outline h-10 shrink-0">
              {loadingFonts ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {localFonts.length > 0 ? `本机字体（${localFonts.length}）` : '读取本机字体'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={applySelectedFont} disabled={applyingFont} className="btn-primary h-10">
              {applyingFont ? <Loader2 size={15} className="animate-spin" /> : <Type size={15} />}
              {applyingFont ? '正在检测字体…' : '应用字体'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetFont()
                setFontName('')
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
              当前字体：
              <span className="ml-1 font-medium text-ink-900 dark:text-white">{font.family || '系统默认'}</span>
              {font.source === 'cloud' && <span className="ml-2 text-brand-600 dark:text-brand-300">（云端加载）</span>}
              {fontStatus === 'checking-local' && <span className="ml-2 text-ink-400">正在检测本机字体…</span>}
              {fontStatus === 'loading-cloud' && <span className="ml-2 text-ink-400">正在请求云端字体…</span>}
              {fontStatus === 'fallback' && <span className="ml-2 text-amber-600 dark:text-amber-400">已回退默认字体</span>}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              排在前面的字体优先使用。Chromium 浏览器可授权读取本机字体；其他浏览器仍可直接填写字体名称。偏好会自动保存到此浏览器。
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
            <p className="mt-4 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
              登录并连接 GitHub 账号后，可将当前选择保存到账号；下次登录同一账号会自动恢复。
            </p>
          )}
        </Section>

        {/* ------------------------------ 背景颜色 ------------------------------ */}
        <Section
          title="背景颜色"
          desc="所选颜色会作为双渐变柔光叠加到背景上，保留原有的渐变层次；可调整颜色的明显程度。"
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
                {backgroundAccountSync === 'loading'
                  ? '正在恢复账号背景偏好…'
                  : backgroundAccountSync === 'synced'
                    ? '已与该账号的背景偏好同步'
                    : backgroundAccountSync === 'error'
                      ? '账号背景偏好同步失败，可重试保存'
                      : '保存后，下次登录同一账号会自动恢复'}
              </span>
            </div>
          ) : (
            <p className="mt-4 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
              登录并连接 GitHub 账号后，可将当前背景颜色保存到账号；下次登录同一账号会自动恢复。
            </p>
          )}
        </Section>

        {/* ------------------------------ 本地数据 ------------------------------- */}
        <Section title="本地数据" desc="草稿保存在浏览器 localStorage 中，清除浏览器数据会一并丢失。" icon={Download}>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportAll} className="btn-outline h-9">
              <Download size={15} />
              导出全部草稿
            </button>
            <button onClick={clearDrafts} className="btn-danger h-9">
              <Trash2 size={15} />
              清空本地草稿
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
            关于安全
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
            <li>静态站点没有服务端，密码登录只是「防误入」的门帘，不构成安全边界。</li>
            <li>GitHub 使用 OAuth（Device Flow）授权，站点不会接触你的 GitHub 密码。</li>
            <li>授权得到的访问令牌仅保存在你自己浏览器的 localStorage 中，只发送给 api.github.com。</li>
            <li>可随时在 GitHub「Settings → Applications」撤销本站的 OAuth 授权。</li>
            <li>在公共电脑上使用后，记得点「退出登录」清除本地令牌。</li>
          </ul>
        </section>
      </div>

      <div className="h-16" />
    </div>
  )
}
