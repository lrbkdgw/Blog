// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useVisualEffects } from '../../lib/visualEffects'

interface ShimmerAppearance {
  shimmerColor?: string
  shimmerSize?: string
  borderRadius?: string
  shimmerDuration?: string
  background?: string
}
export interface ShimmerButtonProps extends ComponentPropsWithoutRef<'button'>, ShimmerAppearance {}
export interface ShimmerLinkProps extends LinkProps, ShimmerAppearance {}

function shimmerStyle({ shimmerColor = '#ffffff', shimmerSize = '1px', shimmerDuration = '5s', borderRadius = '12px', background = 'linear-gradient(135deg, rgb(var(--brand-600)), rgb(var(--brand-700)))' }: ShimmerAppearance, style?: CSSProperties): CSSProperties {
  return {
    '--spread': '90deg',
    '--shimmer-color': shimmerColor,
    '--radius': borderRadius,
    '--speed': shimmerDuration,
    '--cut': shimmerSize,
    '--bg': background,
    ...style,
  } as CSSProperties
}

/** Shared spark / highlight / inset-backdrop layers; all decoration is noninteractive. */
function ShimmerContent({ children }: { children: ReactNode }) {
  return <>
    <span aria-hidden="true" className="magic-shimmer-spark-container"><span className="magic-shimmer-slide"><span className="magic-shimmer-spin" /></span></span>
    <span className="magic-shimmer-content">{children}</span>
    <span aria-hidden="true" className="magic-shimmer-highlight" />
    <span aria-hidden="true" className="magic-shimmer-backdrop" />
  </>
}

export const ShimmerButton = forwardRef<HTMLButtonElement, ShimmerButtonProps>(({ shimmerColor, shimmerSize, shimmerDuration, borderRadius, background, className, children, style, type = 'button', ...props }, ref) => {
  const { animate } = useVisualEffects()
  return (
    <button {...props} ref={ref} type={type} className={cn('magic-shimmer', className)} style={shimmerStyle({ shimmerColor, shimmerSize, shimmerDuration, borderRadius, background }, style)} data-magic-ui="shimmer-button" data-animating={animate && !props.disabled}>
      <ShimmerContent>{children}</ShimmerContent>
    </button>
  )
})
ShimmerButton.displayName = 'ShimmerButton'

/** A real router anchor, not an anchor wrapped around a button. Keeps base paths and modified clicks. */
export const ShimmerLink = forwardRef<HTMLAnchorElement, ShimmerLinkProps>(({ shimmerColor, shimmerSize, shimmerDuration, borderRadius, background, className, children, style, ...props }, ref) => {
  const { animate } = useVisualEffects()
  return (
    <Link {...props} ref={ref} className={cn('magic-shimmer', className)} style={shimmerStyle({ shimmerColor, shimmerSize, shimmerDuration, borderRadius, background }, style)} data-magic-ui="shimmer-button" data-animating={animate}>
      <ShimmerContent>{children}</ShimmerContent>
    </Link>
  )
})
ShimmerLink.displayName = 'ShimmerLink'
