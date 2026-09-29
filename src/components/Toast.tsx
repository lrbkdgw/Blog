import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  action?: { label: string; href: string }
}

interface ToastCtx {
  toast: (message: string, kind?: ToastKind, action?: ToastItem['action']) => void
}

const Ctx = createContext<ToastCtx>({ toast: () => {} })

const styles: Record<ToastKind, { icon: ReactNode; ring: string }> = {
  success: { icon: <CheckCircle2 size={18} className="text-emerald-500" />, ring: 'ring-emerald-500/20' },
  error: { icon: <XCircle size={18} className="text-rose-500" />, ring: 'ring-rose-500/20' },
  warning: { icon: <AlertTriangle size={18} className="text-amber-500" />, ring: 'ring-amber-500/20' },
  info: { icon: <Info size={18} className="text-brand-500" />, ring: 'ring-brand-500/20' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const remove = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), [])

  const toast = useCallback<ToastCtx['toast']>(
    (message, kind = 'info', action) => {
      const id = ++seq.current
      setItems((prev) => [...prev.slice(-3), { id, kind, message, action }])
      setTimeout(() => remove(id), kind === 'error' ? 7000 : 4200)
    },
    [remove],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex animate-scale-in items-start gap-3 rounded-xl border border-ink-200/70 bg-white/95 px-4 py-3 text-sm shadow-xl ring-4 backdrop-blur
                        dark:border-white/10 dark:bg-ink-900/95 dark:text-ink-100 ${styles[t.kind].ring}`}
          >
            <span className="mt-0.5 shrink-0">{styles[t.kind].icon}</span>
            <div className="flex-1 leading-relaxed">
              <p className="whitespace-pre-line break-words">{t.message}</p>
              {t.action && (
                <a
                  href={t.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-medium text-brand-600 hover:underline dark:text-brand-300"
                >
                  {t.action.label} →
                </a>
              )}
            </div>
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 rounded p-0.5 text-ink-400 transition hover:text-ink-700 dark:hover:text-white"
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx).toast
