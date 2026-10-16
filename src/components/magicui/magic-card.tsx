// Adapted from Magic UI (MIT). Pointer-position radial gradient, without Next.js/Motion dependencies.
import {
  useRef,
  useEffect,
  type ComponentPropsWithoutRef,
  type PointerEvent,
} from 'react'
export function MagicCard({
  children,
  className = '',
  ...props
}: ComponentPropsWithoutRef<'article'>) {
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const move = (event: PointerEvent<HTMLElement>) => {
    if (
      event.pointerType !== 'mouse' ||
      !window.matchMedia(
        '(hover: hover) and (prefers-reduced-motion: no-preference)',
      ).matches ||
      document.documentElement.dataset.effects !== 'full'
    )
      return
    const target = event.currentTarget
    const { clientX, clientY } = event
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (!target.isConnected) return
      const rect = target.getBoundingClientRect()
      target.style.setProperty('--mouse-x', `${clientX - rect.left}px`)
      target.style.setProperty('--mouse-y', `${clientY - rect.top}px`)
    })
  }
  return (
    <article
      {...props}
      className={`magic-card ${className}`}
      onPointerMove={move}
      onPointerLeave={() => cancelAnimationFrame(frame.current)}
    >
      <span className="magic-card-glow" aria-hidden="true" />
      {children}
    </article>
  )
}
