// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { useState } from 'react'
import { m, useMotionValueEvent, useScroll } from 'motion/react'
import { cn } from '../../lib/utils'

/** Functional scroll feedback, not a time-based animation; reduced motion still updates it immediately. */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll()
  const [percent, setPercent] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (value) => setPercent(Math.round(Math.max(0, Math.min(1, value)) * 100)))

  return (
    <m.div
      className={cn('magic-scroll-progress no-print pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left', className)}
      style={{ scaleX: scrollYProgress }}
      data-magic-ui="scroll-progress"
      role="progressbar"
      aria-label="页面阅读进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    />
  )
}
