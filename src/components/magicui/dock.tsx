// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.
import React, { useEffect, useRef } from 'react'
import { m, useMotionValue, useSpring, useTransform, type MotionValue, type HTMLMotionProps } from 'motion/react'
import { cn } from '../../lib/utils'
import { useVisualEffects } from '../../lib/visualEffects'

interface DockProps {
  className?: string
  iconSize?: number
  iconMagnification?: number
  iconDistance?: number
  disableMagnification?: boolean
  direction?: 'top' | 'middle' | 'bottom'
  children: React.ReactNode
}

export const Dock = React.forwardRef<HTMLDivElement, DockProps>(({ className, children, iconSize = 44, iconMagnification = 54, iconDistance = 100, disableMagnification = false, direction = 'middle' }, ref) => {
  const mouseX = useMotionValue(Infinity)
  const { interactive } = useVisualEffects()
  const enabled = interactive && !disableMagnification
  useEffect(() => {
    if (!enabled) mouseX.jump(Infinity)
    return () => mouseX.jump(Infinity)
  }, [enabled, mouseX])

  return (
    <m.div
      ref={ref}
      data-magic-ui="dock"
      data-interactive={enabled}
      onPointerMove={enabled ? (event) => { if (event.pointerType === 'mouse') mouseX.set(event.clientX) } : undefined}
      onPointerLeave={enabled ? () => mouseX.set(Infinity) : undefined}
      onFocusCapture={enabled ? (event) => { const bounds = event.target.getBoundingClientRect(); mouseX.set(bounds.x + bounds.width / 2) } : undefined}
      onBlurCapture={enabled ? (event) => { if (!event.currentTarget.contains(event.relatedTarget)) mouseX.set(Infinity) } : undefined}
      className={cn('magic-dock flex w-max justify-center gap-1 rounded-2xl border p-1', { 'items-start': direction === 'top', 'items-center': direction === 'middle', 'items-end': direction === 'bottom' }, className)}
    >
      {React.Children.map(children, (child) => React.isValidElement<DockIconProps>(child) && child.type === DockIcon
        ? React.cloneElement(child, { ...child.props, mouseX, size: iconSize, magnification: iconMagnification, distance: iconDistance, disableMagnification: !enabled })
        : child)}
    </m.div>
  )
})
Dock.displayName = 'Dock'

interface DockIconProps extends Omit<HTMLMotionProps<'div'>, 'children' | 'style'> {
  size?: number
  magnification?: number
  distance?: number
  disableMagnification?: boolean
  mouseX?: MotionValue<number>
  children?: React.ReactNode
}

export function DockIcon({ size = 44, magnification = 54, distance = 100, disableMagnification = false, mouseX, className, children, ...props }: DockIconProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { interactive } = useVisualEffects()
  const enabled = interactive && !disableMagnification
  const defaultMouseX = useMotionValue(Infinity)
  const distanceCalc = useTransform(mouseX ?? defaultMouseX, (value: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return value - bounds.x - bounds.width / 2
  })
  const sizeTransform = useTransform(distanceCalc, [-distance, 0, distance], [size, enabled ? magnification : size, size])
  const scaleSize = useSpring(sizeTransform, { mass: 0.1, stiffness: 150, damping: 12 })

  useEffect(() => {
    const stop = () => { scaleSize.set(size); scaleSize.jump(size) }
    if (!enabled) stop()
    return stop
  }, [enabled, scaleSize, size])

  return (
    <m.div {...props} ref={ref} className={cn('magic-dock-item flex aspect-square items-center justify-center rounded-xl', className)} style={{ width: enabled ? scaleSize : size, height: enabled ? scaleSize : size }}>
      {children}
    </m.div>
  )
}
