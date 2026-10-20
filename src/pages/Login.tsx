import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, WifiOff } from 'lucide-react'
import { OFFLINE } from '../lib/runtime'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import GithubConnect from '../components/GithubConnect'
import { oauthConfig, siteConfig } from '../lib/config'

export default function Login() {
  const { isAuthed, loginWithGithub } = useAuth()
  // 离线单文件版没有在线登录：登录需要 GitHub Device Flow（联网能力），而这个文件按设计不联网。
  // 直接给出解释与去处，而不是显示一个必然失败的授权按钮。
  if (OFFLINE) return <OfflineLoginNotice />
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const toast = useToast()

  if (isAuthed) return <Navigate to={location.state?.from || '/admin'} replace />

  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] items-center justify-center py-12" data-yield-list>
      <div className="w-full max-w-md animate-fade-up" data-yield-list>
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

/** 离线版的登录页：说明「为什么这里没有登录」以及写作该怎么做 */
function OfflineLoginNotice() {
  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] items-center justify-center py-12" data-yield-list>
      <div className="card w-full max-w-lg animate-fade-up p-7">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-ink-500/10 text-ink-500">
          <WifiOff size={19} />
        </div>
        <h1 className="font-serif text-xl font-bold">离线版没有在线登录</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          这个 HTML 被设计成<strong>完全不联网</strong>：不请求 GitHub、不请求云端字体、不加载远程图片。
          所以这里没有 Device Flow 授权，也没有「登录后才能用」的功能。
        </p>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-ink-500">
          <li>· 写作、阅读、加密文章、版本历史都照常可用，内容保存在这台设备的浏览器里。</li>
          <li>· 要把文章带到线上站点：「管理 → 带到线上」导出文章包，再到线上站点导入它的本地文章列表。</li>
          <li>· 想在网站上发布 / 评论 / 管理远端内容，请打开线上站点本身（它才有登录）。</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/admin" className="btn-primary h-9">
            去管理本机文章
          </Link>
          <Link to="/" className="btn-outline h-9">
            <ArrowLeft size={15} />
            回首页阅读
          </Link>
        </div>
      </div>
    </div>
  )
}
