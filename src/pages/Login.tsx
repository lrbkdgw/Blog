import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import GithubConnect from '../components/GithubConnect'
import { oauthConfig, siteConfig } from '../lib/config'

export default function Login() {
  const { isAuthed, loginWithGithub } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const toast = useToast()

  if (isAuthed) return <Navigate to={location.state?.from || '/admin'} replace />

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
          <p className="mt-1.5 text-sm text-ink-500">使用 GitHub 账号登录以进行创作、发表文章与评论</p>
        </div>

        <div className="card p-6 sm:p-7">
          <div className="space-y-4">
            <span className="mb-1 block text-sm font-medium text-ink-700 dark:text-ink-200">
              GitHub OAuth 授权登录
            </span>
            <GithubConnect
              label="使用 GitHub 登录"
              onToken={async (token) => {
                const user = await loginWithGithub(token)
                toast(`已成功登录：@${user.login}`, 'success')
                navigate(location.state?.from || '/admin', { replace: true })
              }}
            />

            <div className="mt-4 rounded-xl border border-brand-200/70 bg-brand-50/50 p-4 text-xs leading-relaxed text-ink-600 dark:border-brand-400/20 dark:bg-brand-500/[0.07] dark:text-ink-300">
              <p className="flex items-center gap-1.5 font-medium text-brand-700 dark:text-brand-300">
                <ShieldCheck size={14} />
                安全与授权说明（OAuth Device Flow）
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>点击上方按钮，验证码将<strong>自动复制</strong>到您的剪贴板。</li>
                <li>系统将自动打开 GitHub 官方验证页面，粘贴验证码并授权即可。</li>
                <li>返回本站将自动完成登录，全过程无需输入或生成任何 GitHub 密码或 Token。</li>
              </ol>
              <p className="mt-2 text-ink-400 dark:text-ink-400">
                申请权限为 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">{oauthConfig.scope}</code>
                ，访问令牌仅保存在您当前浏览器的本地缓存中。
              </p>
            </div>
          </div>
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
