// Adapted from Magic UI, MIT License, Copyright (c) Magic UI.
// Upstream: 85f97fd27b053339af74ba9dd4ca428ee25989fb. See README.md in this directory.

import React, { useCallback, useEffect, useRef } from "react"
import {
  m as motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
} from "motion/react"
import { useTheme } from "../../lib/theme"
import { useVisualEffects } from "../../lib/visualEffects"

import { cn } from "../../lib/utils"

interface MagicCardBaseProps {
  children?: React.ReactNode
  className?: string
  contentClassName?: string
  interactive?: boolean
  surface?: "solid" | "transparent"
  gradientSize?: number
  gradientFrom?: string
  gradientTo?: string
}

interface MagicCardGradientProps extends MagicCardBaseProps {
  mode?: "gradient"

  gradientColor?: string
  gradientOpacity?: number

  glowFrom?: never
  glowTo?: never
  glowAngle?: never
  glowSize?: never
  glowBlur?: never
  glowOpacity?: never
}

interface MagicCardOrbProps extends MagicCardBaseProps {
  mode: "orb"

  glowFrom?: string
  glowTo?: string
  glowAngle?: number
  glowSize?: number
  glowBlur?: number
  glowOpacity?: number

  gradientColor?: never
  gradientOpacity?: never
}

type MagicCardProps = MagicCardGradientProps | MagicCardOrbProps
type ResetReason = "enter" | "leave" | "global" | "init"

function isOrbMode(props: MagicCardProps): props is MagicCardOrbProps {
  return props.mode === "orb"
}

export function MagicCard(props: MagicCardProps) {
  const {
    children,
    className,
    contentClassName,
    surface = "solid",
    gradientSize = 200,
    gradientColor = "rgb(var(--brand-400))",
    gradientOpacity = 0.12,
    gradientFrom = "rgb(var(--brand-400))",
    gradientTo = "rgb(var(--theme-secondary))",
    mode = "gradient",
  } = props

  const glowFrom = isOrbMode(props) ? (props.glowFrom ?? "#ee4f27") : "#ee4f27"
  const glowTo = isOrbMode(props) ? (props.glowTo ?? "#6b21ef") : "#6b21ef"
  const glowAngle = isOrbMode(props) ? (props.glowAngle ?? 90) : 90
  const glowSize = isOrbMode(props) ? (props.glowSize ?? 420) : 420
  const glowBlur = isOrbMode(props) ? (props.glowBlur ?? 60) : 60
  const glowOpacity = isOrbMode(props) ? (props.glowOpacity ?? 0.9) : 0.9
  const { theme } = useTheme()
  const { interactive } = useVisualEffects()
  const canInteract = (props.interactive ?? true) && interactive
  const isDarkTheme = theme === "dark"

  const mouseX = useMotionValue(-gradientSize)
  const mouseY = useMotionValue(-gradientSize)

  const orbX = useSpring(mouseX, { stiffness: 250, damping: 30, mass: 0.6 })
  const orbY = useSpring(mouseY, { stiffness: 250, damping: 30, mass: 0.6 })
  const orbVisible = useSpring(0, { stiffness: 300, damping: 35 })

  const modeRef = useRef(mode)
  const glowOpacityRef = useRef(glowOpacity)
  const gradientSizeRef = useRef(gradientSize)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    glowOpacityRef.current = glowOpacity
  }, [glowOpacity])

  useEffect(() => {
    gradientSizeRef.current = gradientSize
  }, [gradientSize])

  const reset = useCallback(
    (reason: ResetReason = "leave") => {
      const currentMode = modeRef.current

      if (currentMode === "orb") {
        if (reason === "enter") orbVisible.set(glowOpacityRef.current)
        else orbVisible.set(0)
        return
      }

      const off = -gradientSizeRef.current
      mouseX.set(off)
      mouseY.set(off)
    },
    [mouseX, mouseY, orbVisible]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "mouse") return
      const rect = e.currentTarget.getBoundingClientRect()
      mouseX.set(e.clientX - rect.left)
      mouseY.set(e.clientY - rect.top)
    },
    [mouseX, mouseY]
  )

  useEffect(() => {
    reset("init")
  }, [reset])

  useEffect(() => {
    if (!canInteract) return
    const handleGlobalPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) reset("global")
    }
    const handleBlur = () => reset("global")
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") reset("global")
    }

    window.addEventListener("pointerout", handleGlobalPointerOut)
    window.addEventListener("blur", handleBlur)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      window.removeEventListener("pointerout", handleGlobalPointerOut)
      window.removeEventListener("blur", handleBlur)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [reset, canInteract])

  useEffect(() => {
    const stop = () => {
      mouseX.jump(-gradientSize)
      mouseY.jump(-gradientSize)
      orbX.jump(-gradientSize)
      orbY.jump(-gradientSize)
      // Reset the spring's pending target too, so an already queued frame cannot restart it.
      orbVisible.set(0)
      orbVisible.jump(0)
    }
    if (!canInteract) stop()
    return stop
  }, [canInteract, gradientSize, mode, mouseX, mouseY, orbX, orbY, orbVisible])

  const borderGradient = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientFrom}, ${gradientTo}, var(--line-color) 100%)`
  const borderBackground = useMotionTemplate`linear-gradient(rgb(var(--surface)) 0 0) padding-box, ${borderGradient} border-box`
  const gradientBackground = useMotionTemplate`
              radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
                ${gradientColor},
                transparent 100%
              )
            `

  return (
    <motion.div
      data-magic-ui="magic-card"
      data-interactive={canInteract}
      data-mode={mode}
      data-surface={surface}
      className={cn(
        "magic-card group relative isolate overflow-hidden rounded-[var(--card-radius)] border border-transparent",
        className
      )}
      onPointerMove={canInteract ? handlePointerMove : undefined}
      onPointerLeave={canInteract ? () => reset("leave") : undefined}
      onPointerEnter={canInteract ? (event) => { if (event.pointerType === "mouse") reset("enter") } : undefined}
      style={{
        background: surface === "transparent" ? "transparent" : borderBackground,
      }}
    >
      {surface === "transparent" ? (
        <motion.div aria-hidden="true" className="magic-card-border" style={{ background: borderGradient }} />
      ) : (
        <div aria-hidden="true" data-magic-card-fill="true" className="pointer-events-none absolute inset-px z-20 rounded-[inherit]" style={{ background: "rgb(var(--surface))" }} />
      )}

      {mode === "gradient" && (
        <motion.div
          aria-hidden="true"
          className="magic-card-glow pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: gradientBackground,
            opacity: canInteract ? gradientOpacity : 0,
          }}
        />
      )}

      {mode === "orb" && (
        <motion.div
          aria-hidden="true"
          className="magic-card-orb pointer-events-none absolute z-30"
          style={{
            width: glowSize,
            height: glowSize,
            x: orbX,
            y: orbY,
            translateX: "-50%",
            translateY: "-50%",
            borderRadius: 9999,
            filter: `blur(${glowBlur}px)`,
            opacity: orbVisible,
            background: `linear-gradient(${glowAngle}deg, ${glowFrom}, ${glowTo})`,

            mixBlendMode: isDarkTheme ? "screen" : "multiply",
            willChange: "transform, opacity",
          }}
        />
      )}
      <div className={cn("relative z-40 h-full", contentClassName)}>{children}</div>
    </motion.div>
  )
}
