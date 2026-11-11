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
  return missing
}

/**
 * GitHub OAuth 授权（Device Flow，RFC 8628）：
 * 点按钮 → 显示一次性验证码并自动复制到剪贴板，自动打开 GitHub 验证页 → 轮询直至授权完成。
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

  const copyCode = useCallback(async (codeToCopy?: string) => {
    const targetCode = codeToCopy || flow?.userCode
    if (!targetCode) return
    try {
      await navigator.clipboard.writeText(targetCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用时容错，用户仍可手动复制 */
    }
  }, [flow])

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

      // 点击登录后自动复制登录代码
      try {
        await navigator.clipboard.writeText(info.userCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* 容错 */
      }

      // 自动打开 GitHub 验证页
      window.open(info.verificationUri, '_blank', 'noopener')
      const token = await pollDeviceToken(info, controller.signal)
      if (controller.signal.aborted) return
      setPhase('finishing')
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

  if (missing.length > 0) {
    return (
      <div className="rounded-[10px] border border-amber-300/50 bg-amber-50/60 p-4 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/[0.08] dark:text-amber-300">
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
  const btnBase = size === 'lg' ? 'btn-primary h-11 w-full' : 'btn-primary h-9'

  return (
    <div className="space-y-3">
      {phase === 'waiting' && flow ? (
        <div className="animate-fade-up rounded-[10px] border border-ink-200/80 bg-ink-50/60 p-4 text-center dark:border-white/[0.09] dark:bg-white/[0.03]">
          <p className="text-[11.5px] text-ink-500 dark:text-ink-300">
            {copied ? '✅ 验证码已自动复制！请在 GitHub 页面粘贴授权：' : '在 GitHub 验证页面输入下面的验证码：'}
          </p>
          <button
            type="button"
            onClick={() => copyCode(flow.userCode)}
            title="点击复制"
            className="group mx-auto mt-2 flex items-center gap-2 rounded-[10px] border border-ink-200/80 bg-ink-50/60 px-4 py-2 font-mono text-[1.35rem] font-semibold tracking-[0.18em] text-ink-900 transition hover:border-ink-300 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-white dark:hover:border-white/[0.2]"
          >
            {flow.userCode}
            {copied ? (
              <ClipboardCheck size={16} className="text-emerald-500" />
            ) : (
              <ClipboardCopy size={16} className="text-ink-300 transition group-hover:text-brand-500" />
            )}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[10.5px] text-ink-400 dark:text-ink-500">
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
              className="btn-primary h-8 px-3.5 text-[12px]"
            >
              <ExternalLink size={14} />
              打开 GitHub 验证
            </a>
            <button type="button" onClick={reset} className="btn-ghost h-8 px-3 text-[12px]">
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
        <p className="rounded-[10px] border border-rose-300/50 bg-rose-50/70 px-3 py-2 text-[11.5px] text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/[0.08] dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  )
}
