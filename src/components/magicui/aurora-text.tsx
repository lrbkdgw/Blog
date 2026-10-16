// Adapted from Magic UI (MIT). See LICENSE.md and README.md in this directory.
import { memo, type ReactNode } from 'react'
export const AuroraText = memo(function AuroraText({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`relative inline-block ${className}`}>
      <span className="sr-only">{children}</span>
      <span className="magic-aurora" aria-hidden="true">
        {children}
      </span>
    </span>
  )
})
