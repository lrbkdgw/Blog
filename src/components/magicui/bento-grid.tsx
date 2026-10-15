// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

interface BentoGridProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode
}

export function BentoGrid({ children, className, ...props }: BentoGridProps) {
  return <div {...props} className={cn('magic-bento-grid grid w-full auto-rows-auto grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3', className)} data-magic-ui="bento-grid">{children}</div>
}

interface BentoCardProps extends Omit<ComponentPropsWithoutRef<'article'>, 'children'> {
  name: string
  description: string
  href: string
  cta?: string
  background?: ReactNode
  metadata?: ReactNode
  footer?: ReactNode
}

/** Source Bento layout / CTA layers, adapted to semantic articles and a single native router link. */
export function BentoCard({ name, description, href, cta = '阅读全文', className, background, metadata, footer, ...props }: BentoCardProps) {
  return (
    <article {...props} data-magic-ui="bento-card" className={cn('magic-bento-card group/bento relative flex h-full flex-col justify-between overflow-hidden rounded-[inherit]', className)}>
      {background && <div className="bento-background">{background}</div>}
      <div className="bento-content flex flex-1 flex-col p-6 sm:p-7">
        {metadata}
        <div className="bento-copy flex flex-1 flex-col gap-3">
          <h2 className="post-title font-serif text-xl font-semibold leading-snug tracking-tight sm:text-[1.35rem]">
            <Link to={href} className="bento-title-link">{name}</Link>
          </h2>
          <p className="post-summary line-clamp-3 text-sm leading-[1.85]">{description}</p>
        </div>
        <div className="post-card-footer mt-6 flex items-end justify-between gap-3 border-t pt-4">
          <div className="flex flex-wrap gap-1.5">{footer}</div>
          <span className="bento-cta pointer-events-none flex shrink-0 items-center gap-2" aria-hidden="true">
            <span className="bento-cta-label">{cta}</span>
            <span className="read-arrow flex h-8 w-8 items-center justify-center rounded-full"><ArrowUpRight size={17} /></span>
          </span>
        </div>
      </div>
      <div className="bento-hover-overlay pointer-events-none absolute inset-0 rounded-[inherit]" aria-hidden="true" />
    </article>
  )
}
