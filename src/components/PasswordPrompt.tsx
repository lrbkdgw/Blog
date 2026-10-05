import { useState } from 'react'
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react'

interface PasswordPromptProps {
  title?: string
  description?: string
  onUnlock: (password: string) => Promise<void>
  className?: string
}

/** Password is kept only in this controlled input while an unlock attempt runs. */
export function PasswordPrompt({
  title = '这是一篇加密文章',
  description = '文章正文及其他信息已使用密码加密。请输入密码后继续。',
  onUnlock,
  className = '',
}: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password) {
      setError('请输入文章密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onUnlock(password)
      setPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法解锁文章')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`card mx-auto flex max-w-md flex-col items-center p-7 text-center ${className}`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300">
        <LockKeyhole size={22} />
      </span>
      <h2 className="mt-4 font-serif text-xl font-bold text-ink-900 dark:text-white">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-500">{description}</p>
      <label className="mt-5 w-full text-left text-xs font-medium text-ink-500" htmlFor="article-password">
        文章密码
      </label>
      <input
        id="article-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        autoFocus
        className="input mt-1.5"
        placeholder="输入密码"
      />
      {error && <p role="alert" className="mt-2 w-full text-left text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary mt-4 h-10 w-full">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
        {busy ? '正在解锁…' : '解锁文章'}
      </button>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
        密码不会上传或保存；成功后本设备仅记住不可导出的解锁密钥。
      </p>
    </form>
  )
}
