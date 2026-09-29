import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Github, HelpCircle, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { siteConfig } from '../lib/config'

type Tab = 'password' | 'github'

const TOKEN_HELP_URL =
  'https://github.com/settings/personal-access-tokens/new'

export default function Login() {
  const { isAuthed, loginWithPassword, loginWithGithub } = useAuth()
  const [tab, setTab] = useState<Tab>('password')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const toast = useToast()

  if (isAuthed) return <Navigate to={location.state?.from || '/admin'} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'password') {
        await loginWithPassword(password)
        toast('登录成功，欢迎回来', 'success')
      } else {
        const user = await loginWithGithub(token)
        toast(`已连接 GitHub：@${user.login}`, 'success')
      }
      navigate(location.state?.from || '/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-indigo-700 text-2xl text-white shadow-xl shadow-brand-600/30">
            ✦
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            登录 {siteConfig.title}
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">登录后即可在线撰写与发布文章</p>
        </div>

        <div className="card p-6 sm:p-7">
          {/* Tab 切换 */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-100/80 p-1 dark:bg-white/5">
            {(
              [
                { id: 'password', label: '密码登录', icon: Lock },
                { id: 'github', label: 'GitHub Token', icon: Github },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id)
                  setError('')
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${
                  tab === t.id
                    ? 'bg-white text-ink-900 shadow-sm dark:bg-white/10 dark:text-white'
                    : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
                }`}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {tab === 'password' ? (
              <div>
                <label htmlFor="pwd" className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-200">
                  站点密码
                </label>
                <div className="relative">
                  <input
                    id="pwd"
                    type={showSecret ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    required
                    className="input !pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 dark:hover:text-white"
                    aria-label="显示密码"
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-400">
                  <HelpCircle size={13} className="mt-px shrink-0" />
                  默认密码 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">starlog</code>
                  ，可在 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">src/lib/config.ts</code> 中修改。
                  密码登录只能写本地草稿。
                </p>
              </div>
            ) : (
              <div>
                <label htmlFor="token" className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-200">
                  GitHub Personal Access Token
                </label>
                <div className="relative">
                  <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                  <input
                    id="token"
                    type={showSecret ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="github_pat_… 或 ghp_…"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    className="input !pl-9 !pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 dark:hover:text-white"
                    aria-label="显示 Token"
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="mt-3 rounded-xl border border-brand-200/70 bg-brand-50/50 p-3 text-xs leading-relaxed text-ink-600 dark:border-brand-400/20 dark:bg-brand-500/[0.07] dark:text-ink-300">
                  <p className="flex items-center gap-1.5 font-medium text-brand-700 dark:text-brand-300">
                    <ShieldCheck size={13} />
                    如何获取 Token
                  </p>
                  <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                    <li>
                      打开{' '}
                      <a href={TOKEN_HELP_URL} target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline dark:text-brand-300">
                        Fine-grained tokens
                      </a>{' '}
                      页面
                    </li>
                    <li>Repository access 选择本博客仓库</li>
                    <li>
                      Permissions → Contents 设为 <b>Read and write</b>
                    </li>
                    <li>生成后复制粘贴到上方</li>
                  </ol>
                  <p className="mt-2 text-ink-500 dark:text-ink-400">
                    Token 只保存在你当前浏览器的 localStorage 中，不会上传到任何服务器。
                  </p>
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-primary h-11 w-full">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {loading ? '验证中…' : '登录'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          <Link to="/" className="hover:text-brand-600 dark:hover:text-brand-300">
            ← 返回首页
          </Link>
        </p>
      </div>
    </div>
  )
}
