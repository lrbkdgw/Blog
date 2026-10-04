import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Github,
  LogOut,
  Paintbrush,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import GithubConnect from '../components/GithubConnect'
import { Section } from '../components/AppearanceSections'
import { getRepoTarget, setRepoTarget } from '../lib/github'
import { getLocalPosts, serializePost } from '../lib/posts'
import { STORAGE_KEYS } from '../lib/config'

export default function SettingsPage() {
  const { ghUser, canPublish, connectGithub, disconnectGithub, logout } = useAuth()
  const toast = useToast()

  const [repo, setRepo] = useState(getRepoTarget())

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
          常规设置保存在当前浏览器；连接 GitHub 后可将字体与背景颜色同步到账号。
          <Link to="/settings" className="ml-2 text-brand-600 hover:underline dark:text-brand-300">
            个性化（主题 / 字体 / 背景）→
          </Link>
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

        {/* ------------------------------ 个性化外观 ------------------------------ */}
        <Section
          title="外观 / 字体 / 背景"
          desc="主题、字体栈（可设置多个字体按优先级尝试）与背景颜色已经移到对所有访客开放的个性化设置页。"
          icon={Paintbrush}
        >
          <Link to="/settings" className="btn-outline h-10">
            <Paintbrush size={15} />
            前往个性化设置
          </Link>
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
