// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import { memo, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { useVisualEffects } from '../../lib/visualEffects'

interface AuroraTextProps {
  children: ReactNode
  className?: string
  colors?: string[]
  speed?: number
}

export const AuroraText = memo(({ children, className = '', colors = ['#FF0080', '#7928CA', '#0070F3', '#38bdf8'], speed = 1 }: AuroraTextProps) => {
  const { animate } = useVisualEffects()
  const gradientStyle: CSSProperties = {
    backgroundImage: `linear-gradient(135deg, ${colors.join(', ')}, ${colors[0]})`,
    animationDuration: `${10 / speed}s`,
    animationPlayState: animate ? 'running' : 'paused',
  }

  return (
    <span className={cn('relative inline-block', className)} data-magic-ui="aurora-text" data-animating={animate}>
      <span className="sr-only">{children}</span>
      <span aria-hidden="true" className="magic-aurora-text" style={gradientStyle}>{children}</span>
    </span>
  )
})
AuroraText.displayName = 'AuroraText'
