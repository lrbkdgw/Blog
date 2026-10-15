// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { m, useAnimationControls, useInView, type MotionProps, type UseInViewOptions, type Variants } from 'motion/react'
import { useVisualEffects } from '../../lib/visualEffects'

type MarginType = UseInViewOptions['margin']
interface BlurFadeProps extends MotionProps {
  children: ReactNode
  className?: string
  variant?: { hidden: { y: number }; visible: { y: number } }
  duration?: number
  delay?: number
  offset?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  inView?: boolean
  inViewMargin?: MarginType
  blur?: string
}
const getFilter = (value: Variants[string]) => typeof value === 'function' ? undefined : value.filter

export function BlurFade({ children, className, variant, duration = 0.4, delay = 0, offset = 6, direction = 'down', inView = false, inViewMargin = '-50px', blur = '6px', ...props }: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { animate } = useVisualEffects()
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin })
  const enabled = animate && canObserve
  const isInView = !enabled || !inView || inViewResult
  const controls = useAnimationControls()
  const combinedVariants = useMemo<Variants>(() => variant ?? {
    hidden: {
      [direction === 'left' || direction === 'right' ? 'x' : 'y']: direction === 'right' || direction === 'down' ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: {
      [direction === 'left' || direction === 'right' ? 'x' : 'y']: 0,
      opacity: 1,
      filter: 'blur(0px)',
    },
  }, [variant, direction, offset, blur])
  const hiddenFilter = getFilter(combinedVariants.hidden)
  const visibleFilter = getFilter(combinedVariants.visible)
  const shouldTransitionFilter = hiddenFilter != null && visibleFilter != null && hiddenFilter !== visibleFilter

  useEffect(() => {
    // Changing transition.duration alone does NOT cancel an in-flight animation whose target is unchanged.
    controls.stop()
    if (!enabled) controls.set('visible')
    else if (!isInView) controls.set('hidden')
    else void controls.start('visible', { delay: 0.04 + delay, duration, ease: 'easeOut', ...(shouldTransitionFilter ? { filter: { duration } } : {}) })
    return () => controls.stop()
  }, [controls, enabled, isInView, combinedVariants, delay, duration, shouldTransitionFilter])

  return (
    <m.div
      {...props}
      ref={canObserve ? ref : undefined}
      data-magic-ui="blur-fade"
      data-motion-enabled={enabled}
      initial={enabled ? 'hidden' : 'visible'}
      animate={controls}
      variants={combinedVariants}
      className={className}
    >{children}</m.div>
  )
}
