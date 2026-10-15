import type { ReactNode } from 'react'
import { BlurFade } from './magicui/blur-fade'

/** Magic UI reveal, with shared motion policy and a visible no-observer fallback. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return <BlurFade inView inViewMargin="0px 0px -24px 0px" direction="up" offset={12} blur="4px" delay={Math.min(Math.max(delay, 0), 280) / 1000} className={`reveal ${className}`}>{children}</BlurFade>
}
