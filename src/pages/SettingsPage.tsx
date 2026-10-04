import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  Github,
  Loader2,
  LogOut,
  Paintbrush,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
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
  const toast = useToast()

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

  const fontList = font.families || []

  return (
    <div className="container-page max-w-3xl pt-12">
      <header className="mb-8 animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">设置</h1>
        <p className="mt-1.5 text-sm text-ink-500">
          个性化设置使用与评论区相同的浏览器本地存储与即时更新机制；连接 GitHub 后仍可选择同步偏好至账号。
          <Link
            to={isAuthed ? '/admin' : '/'}
            className="ml-2 text-brand-600 hover:underline dark:text-brand-300"
          >
            ← {isAuthed ? '返回内容管理' : '返回首页'}
          </Link>
        </p>
      </header>

      <div className="space-y-5">
        {/* ------------------------------ 多字体设置（优先级回退） ----------------------------- */}
        <Section
          title="字体设置（多字体按优先级生效）"
          desc="可以配置多个字体，系统将按从上到下的优先级依次尝试渲染。支持手动输入系统字体或 Google Fonts 云端字体。"
          icon={Type}
        >
          {/* 添加新字体 */}
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
                toast('已恢复默认字体', 'success')
              }}
              className="btn-outline h-9"
            >
              <RotateCcw size={14} />
              恢复默认字体
            </button>
            <span className="text-xs text-ink-400">设置自动保存至当前浏览器</span>
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
                  ? '正在同步账号字体偏好…'
                  : accountSync === 'synced'
                    ? '已与 GitHub 账号同步'
                    : '保存后可在多台设备登录同一账号自动恢复'}
              </span>
            </div>
          ) : (
            <p className="mt-4 border-t border-ink-200/70 pt-4 text-xs leading-relaxed text-ink-400 dark:border-white/10">
              访客设置已直接生效并保存在本地。登录 GitHub 账号后还可将字体偏好同步至云端。
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
          <button onClick={saveRepo} className="btn-primary mt-4 h-9">
            <Save size={15} />
            保存仓库设置
          </button>
        </Section>

        {/* ------------------------------ 本地数据 ------------------------------- */}
        <Section
          title="本地数据管理"
          desc="草稿与个性化偏好保存在浏览器 localStorage 中，清除浏览器缓存会一并丢失。"
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
