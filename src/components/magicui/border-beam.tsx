// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { useRef, type CSSProperties } from 'react'
import { m, useInView, type Transition } from 'motion/react'
import { cn } from '../../lib/utils'
import { useVisualEffects } from '../../lib/visualEffects'

interface BorderBeamProps {
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  transition?: Transition
  className?: string
  style?: CSSProperties
  reverse?: boolean
  initialOffset?: number
  borderWidth?: number
}

export function BorderBeam({
  className,
  size = 100,
  delay = 0,
  duration = 12,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { animate } = useVisualEffects()
  // Without the optional observer API, keep the existing static border instead of running offscreen.
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const inView = useInView(ref, { amount: 'some' })
  const active = animate && canObserve && inView

  return (
    <div
      ref={canObserve ? ref : undefined}
      aria-hidden="true"
      className="magic-border-beam"
      data-magic-ui="border-beam"
      data-animating={active}
      style={{ '--border-width': `${borderWidth}px` } as CSSProperties}
    >
      {active && (
        <m.div
          className={cn('magic-border-beam-trace', className)}
          style={{
            width: size,
            offsetPath: 'rect(0 auto auto 0 round var(--card-radius))',
            '--color-from': colorFrom,
            '--color-to': colorTo,
            ...style,
          } as CSSProperties}
          initial={{ offsetDistance: `${initialOffset}%` }}
          animate={{ offsetDistance: reverse ? [`${100 - initialOffset}%`, `${-initialOffset}%`] : [`${initialOffset}%`, `${100 + initialOffset}%`] }}
          transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay, ...transition }}
        />
      )}
    </div>
  )
}
