import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Loader2,
  LogOut,
  Moon,
  Palette,
  Save,
  ShieldAlert,
  Sun,
  Trash2,
  Type,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { FONT_OPTIONS, useFont } from '../lib/font'
import { useToast } from '../components/Toast'
import { getRepoTarget, setRepoTarget } from '../lib/github'
import { getLocalPosts, serializePost } from '../lib/posts'
import { STORAGE_KEYS } from '../lib/config'

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
  const { ghUser, canPublish, connectGithub, disconnectGithub, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { font, setFont } = useFont()
  const toast = useToast()

  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [repo, setRepo] = useState(getRepoTarget())

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setConnecting(true)
    try {
      const user = await connectGithub(token)
      setToken('')
      toast(`已连接 GitHub：@${user.login}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '连接失败', 'error')
    } finally {
      setConnecting(false)
    }
  }

  const saveRepo = () => {
    setRepoTarget(repo)
    toast('仓库设置已保存', 'success')
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
          所有设置都保存在当前浏览器本地。
          <Link to="/admin" className="ml-2 text-brand-600 hover:underline dark:text-brand-300">
            ← 返回内容管理
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
            <form onSubmit={connect} className="space-y-3">
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴 GitHub Personal Access Token"
                  className="input !pr-10 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 dark:hover:text-white"
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={connecting} className="btn-primary h-9">
                  {connecting ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />}
                  连接
                </button>
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-300"
                >
                  创建 Fine-grained Token（Contents: Read and write）
                  <ExternalLink size={11} />
                </a>
              </div>
            </form>
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
          desc="以本地管理员密码登录后可在此切换站点字体；选择会立即生效，并保存在当前浏览器。"
          icon={Type}
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            {FONT_OPTIONS.map((option) => {
              const selected = font === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setFont(option.id)
                    toast(`已切换为「${option.label}」`, 'success')
                  }}
                  className={`rounded-xl border-2 p-4 text-left transition ${
                    selected
                      ? 'border-brand-500 bg-brand-500/[0.07] shadow-sm dark:bg-brand-500/[0.12]'
                      : 'border-ink-200 bg-white/50 hover:border-brand-200 hover:bg-brand-50/40 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-brand-400/30 dark:hover:bg-brand-500/[0.06]'
                  }`}
                  aria-pressed={selected}
                >
                  <span
                    className={`block text-base font-semibold ${
                      selected ? 'text-brand-700 dark:text-brand-200' : 'text-ink-800 dark:text-ink-100'
                    }`}
                    style={{ fontFamily: option.preview }}
                  >
                    文字样例 Aa 字体
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                    <b className="font-medium text-ink-700 dark:text-ink-200">{option.label}</b> · {option.description}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            字体来自访问设备已安装的系统字体，不额外请求第三方字体文件，因此不会影响首页加载速度。
          </p>
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
            <button onClick={logout} className="btn-ghost ml-auto h-9">
              <LogOut size={15} />
              退出登录
            </button>
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
            <li>GitHub Token 仅保存在你自己浏览器的 localStorage 中，不会发送到除 api.github.com 以外的任何地方。</li>
            <li>请使用 Fine-grained Token，并把权限限制到本仓库的 Contents 读写。</li>
            <li>在公共电脑上使用后，记得点「退出登录」清除 Token。</li>
          </ul>
        </section>
      </div>

      <div className="h-16" />
    </div>
  )
}
