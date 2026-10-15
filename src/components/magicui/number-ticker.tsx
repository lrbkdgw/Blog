// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { useCallback, useEffect, useMemo, useRef, type ComponentPropsWithoutRef } from 'react'
import { useInView, useMotionValue, useSpring } from 'motion/react'
import { cn } from '../../lib/utils'
import { useVisualEffects } from '../../lib/visualEffects'

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  startValue?: number
  direction?: 'up' | 'down'
  delay?: number
  decimalPlaces?: number
}

export function NumberTicker({ value, startValue = 0, direction = 'up', delay = 0, decimalPlaces = 0, className, ...props }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)
  const { animate } = useVisualEffects()
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const isInView = useInView(ref, { once: true, margin: '0px' })
  const motionValue = useMotionValue(direction === 'down' ? value : startValue)
  const springValue = useSpring(motionValue, { damping: 28, stiffness: 180, mass: 0.7 })
  const formatter = useMemo(() => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces }), [decimalPlaces])
  const target = direction === 'down' ? startValue : value
  const render = useCallback((latest: number) => { if (ref.current) ref.current.textContent = formatter.format(latest) }, [formatter])
  const enabled = animate && canObserve

  useEffect(() => springValue.on('change', render), [springValue, render])
  useEffect(() => {
    const stop = () => {
      motionValue.jump(target)
      springValue.set(target)
      springValue.jump(target)
      render(target)
    }
    if (!enabled) { started.current = true; stop(); return stop }
    if (!isInView) { render(target); return stop }
    if (!started.current) {
      const initial = direction === 'down' ? value : startValue
      motionValue.jump(initial)
      springValue.set(initial)
      springValue.jump(initial)
      render(initial)
      started.current = true
    }
    const timer = window.setTimeout(() => motionValue.set(target), Math.max(0, delay) * 1000)
    return () => { window.clearTimeout(timer); stop() }
  }, [enabled, isInView, target, value, startValue, direction, delay, motionValue, springValue, render])

  return (
    <span {...props} className={cn('magic-number-ticker inline-block tabular-nums', className)} data-magic-ui="number-ticker" data-animating={enabled && isInView}>
      <span className="sr-only">{formatter.format(target)}</span>
      <span ref={canObserve ? ref : undefined} aria-hidden="true" className="magic-number-visual">{formatter.format(target)}</span>
    </span>
  )
}
