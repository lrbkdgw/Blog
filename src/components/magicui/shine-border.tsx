// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { type CSSProperties, type HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
import { useVisualEffects } from '../../lib/visualEffects'

interface ShineBorderProps extends HTMLAttributes<HTMLSpanElement> {
  borderWidth?: number
  duration?: number
  shineColor?: string | string[]
}

export function ShineBorder({ borderWidth = 1, duration = 14, shineColor = '#000000', className, style, ...props }: ShineBorderProps) {
  const { animate } = useVisualEffects()
  return (
    <span
      {...props}
      aria-hidden="true"
      data-magic-ui="shine-border"
      data-animating={animate}
      className={cn('magic-shine-border', className)}
      style={{
        '--duration': `${duration}s`,
        padding: `${borderWidth}px`,
        backgroundImage: `radial-gradient(transparent,transparent, ${Array.isArray(shineColor) ? shineColor.join(',') : shineColor},transparent,transparent)`,
        maskImage: 'linear-gradient(#fff 0 0), linear-gradient(#fff 0 0)',
        maskClip: 'content-box, border-box',
        maskComposite: 'exclude',
        WebkitMaskComposite: 'xor',
        animationPlayState: animate ? 'running' : 'paused',
        ...style,
      } as CSSProperties}
    />
  )
}
