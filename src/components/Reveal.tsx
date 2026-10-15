import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useTheme } from '../lib/theme'

/** Progressive enhancement: content stays visible if observation or motion is unavailable. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const { effects } = useTheme()
  useEffect(() => {
    const element = ref.current
    if (!element || effects === 'off' || !('IntersectionObserver' in window)) return
    element.dataset.reveal = 'waiting'
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        element.dataset.reveal = 'shown'
        observer.disconnect()
      }
    }, { threshold: 0.04 })
    observer.observe(element)
    return () => { observer.disconnect(); delete element.dataset.reveal }
  }, [effects])
  return <div ref={ref} className={`reveal ${className}`} style={{ '--reveal-delay': `${Math.min(delay, 280)}ms` } as CSSProperties}>{children}</div>
}
