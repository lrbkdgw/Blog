import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ClipboardCopy,
  ClipboardCheck,
  ExternalLink,
  Github,
  Loader2,
  Timer,
  X,
} from 'lucide-react'
import { oauthConfig } from '../lib/config'
import { pollDeviceToken, requestDeviceCode } from '../lib/github'
import type { DeviceAuthInfo } from '../lib/github'

type Phase = 'idle' | 'starting' | 'waiting' | 'finishing'

interface Props {
  /** 拿到 OAuth access_token 后的回调（可抛错，错误会内联展示） */
  onToken: (token: string) => void | Promise<void>
  /** 触发按钮文案 */
  label?: string
  /** 视觉尺寸：登录页用大按钮，设置页用小按钮 */
  size?: 'lg' | 'sm'
}

/** 当前 OAuth 配置缺失项（站长部署时未完成配置则提示） */
export function missingOAuthConfig(): string[] {
  const missing: string[] = []
  if (!oauthConfig.clientId.trim()) missing.push('OAuth App Client ID（oauthConfig.clientId）')
  if (!oauthConfig.relayUrl.trim()) missing.push('OAuth 中转地址（oauthConfig.relayUrl）')
  return missing
}

/**
 * GitHub OAuth 授权（Device Flow，RFC 8628）：
 * 点按钮 → 显示一次性验证码并自动打开 GitHub 验证页 → 轮询直至授权完成。
 */
export default function GithubConnect({ onToken, label = '使用 GitHub 登录', size = 'lg' }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [flow, setFlow] = useState<DeviceAuthInfo | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const missing = missingOAuthConfig()

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle')
    setFlow(null)
    setCopied(false)
  }, [])

  // 组件卸载时停止轮询
  useEffect(() => reset, [reset])

  // 验证码倒计时（仅在 waiting 阶段显示）
  useEffect(() => {
    if (phase !== 'waiting' || !flow) return
    const expiresAt = Date.now() + flow.expiresIn * 1000
    const tick = () => setRemaining(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [phase, flow])

  const start = useCallback(async () => {
    setError('')
    setPhase('starting')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const info = await requestDeviceCode()
      if (controller.signal.aborted) return
      setFlow(info)
      setPhase('waiting')
      // 自动打开 GitHub 验证页（若被浏览器拦截，界面里还有手动按钮）
      window.open(info.verificationUri, '_blank', 'noopener')
      const token = await pollDeviceToken(info, controller.signal)
      if (controller.signal.aborted) return
      setPhase('finishing')
      // 等待父级完成登录（校验 token、写会话等）；失败则回退展示错误
      await onToken(token)
      reset()
    } catch (err) {
      if (controller.signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '授权失败，请重试')
      setPhase('idle')
      setFlow(null)
    }
  }, [onToken, reset])

  const copyCode = useCallback(async () => {
    if (!flow) return
    try {
      await navigator.clipboard.writeText(flow.userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* 剪贴板不可用时忽略，用户可手动选择复制 */
    }
  }, [flow])

  if (missing.length > 0) {
    return (
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-xs leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/[0.08] dark:text-amber-300">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={14} />
          站长尚未完成 OAuth 配置
        </p>
        <p className="mt-1.5">
          缺少：{missing.join('、')}。配置方法见仓库 README「🔑 配置 OAuth 登录」一节或{' '}
          <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-500/15">src/lib/config.ts</code>。
        </p>
      </div>
    )
  }

  const busy = phase === 'starting' || phase === 'finishing'
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const btnBase =
    size === 'lg'
      ? 'btn-primary h-11 w-full'
      : 'btn-primary h-9'

  return (
    <div className="space-y-3">
      {phase === 'waiting' && flow ? (
        <div className="animate-fade-up rounded-xl border border-brand-200/80 bg-brand-50/60 p-4 text-center dark:border-brand-400/25 dark:bg-brand-500/[0.08]">
          <p className="text-xs text-ink-500 dark:text-ink-300">在 GitHub 验证页面输入下面的验证码</p>
          <button
            type="button"
            onClick={copyCode}
            title="点击复制"
            className="group mx-auto mt-2 flex items-center gap-2 rounded-lg bg-white/80 px-4 py-2 font-mono text-2xl font-bold tracking-[0.18em] text-ink-900 shadow-sm ring-1 ring-ink-900/5 transition hover:ring-brand-400/50 dark:bg-white/10 dark:text-white dark:ring-white/10"
          >
            {flow.userCode}
            {copied ? (
              <ClipboardCheck size={16} className="text-emerald-500" />
            ) : (
              <ClipboardCopy size={16} className="text-ink-300 transition group-hover:text-brand-500" />
            )}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-ink-400">
            <Timer size={12} />
            {remaining > 0 ? `验证码 ${mm}:${ss} 后过期` : '验证码已过期'}
            <span className="mx-1">·</span>
            <Loader2 size={12} className="animate-spin" />
            等待 GitHub 授权…
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <a
              href={flow.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="btn-primary h-9 px-4 text-sm"
            >
              <ExternalLink size={14} />
              打开 GitHub 验证
            </a>
            <button type="button" onClick={reset} className="btn-ghost h-9 px-3 text-sm">
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={start} disabled={busy} className={btnBase}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Github size={16} />}
          {phase === 'starting' ? '正在获取验证码…' : phase === 'finishing' ? '正在完成登录…' : label}
        </button>
      )}

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  )
}
