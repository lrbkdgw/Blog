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
      <div className="w-full max-w-[26rem] animate-fade-up" data-yield-list>
        <div className="mb-8">
          <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink-400 dark:text-ink-500">
            Sign in
          </p>
          <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.03em] text-ink-900 dark:text-white">
            登录 {siteConfig.title}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500 dark:text-ink-400">
            使用 GitHub 账号登录以进行创作、发表文章与评论。
          </p>
        </div>

        <div className="card p-6">
          <div className="space-y-4">
            <span className="label">GitHub OAuth 授权登录</span>
            <GithubConnect
              label="使用 GitHub 登录"
              onToken={async (token) => {
                const user = await loginWithGithub(token)
                toast(`已成功登录：@${user.login}`, 'success')
                navigate(location.state?.from || '/admin', { replace: true })
              }}
            />

            <div className="rounded-xl border border-ink-200/70 bg-ink-50/60 p-4 text-[12px] leading-relaxed text-ink-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-ink-400">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-700 dark:text-ink-200">
                <ShieldCheck size={13} />
                OAuth Device Flow 授权流程
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>点击上方按钮，验证码将<strong className="font-medium text-ink-600 dark:text-ink-200">自动复制</strong>到剪贴板。</li>
                <li>系统会自动打开 GitHub 官方验证页面，粘贴验证码并授权。</li>
                <li>返回本站即自动完成登录，全程不需要输入任何密码或 Token。</li>
              </ol>
              <p className="mt-2.5 text-ink-400 dark:text-ink-500">
                申请权限为{' '}
                <code className="rounded bg-ink-900/[.06] px-1 py-px font-mono text-[11px] dark:bg-white/[.08]">
                  {oauthConfig.scope}
                </code>
                ，访问令牌只保存在当前浏览器的本地缓存中。
              </p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[12px] text-ink-400 dark:text-ink-500">
          <Link to="/" className="transition hover:text-brand-600 dark:hover:text-brand-300">
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
      <div className="w-full max-w-[30rem] animate-fade-up">
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200/80 text-ink-500 dark:border-white/[0.09] dark:text-ink-400">
          <WifiOff size={17} />
        </div>
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.02em] text-ink-900 dark:text-white">
          离线版没有在线登录
        </h1>
        <p className="mt-2.5 text-[13.5px] leading-[1.8] text-ink-500 dark:text-ink-400">
          这个 HTML 被设计成<strong className="font-medium text-ink-700 dark:text-ink-200">完全不联网</strong>：不请求 GitHub、不请求云端字体、不加载远程图片。
          所以这里没有 Device Flow 授权，也没有「登录后才能用」的功能。
        </p>
        <ul className="mt-4 space-y-2 border-l border-ink-200/80 pl-4 text-[13px] leading-relaxed text-ink-500 dark:border-white/[0.08] dark:text-ink-400">
          <li>写作、阅读、加密文章、版本历史都照常可用，内容保存在这台设备的浏览器里。</li>
          <li>要把文章带到线上站点：「管理 → 带到线上」导出文章包，再到线上站点导入它的本地文章列表。</li>
          <li>想在网站上发布 / 评论 / 管理远端内容，请打开线上站点本身（它才有登录）。</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/admin" className="btn-primary h-9">
            去管理本机文章
          </Link>
          <Link to="/" className="btn-outline h-9">
            <ArrowLeft size={14} />
            回首页阅读
          </Link>
        </div>
      </div>
    </div>
  )
}
