import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { useTheme } from './theme'

interface VisualEffects {
  /** Gates JavaScript animations too; CSS reduced-motion overrides alone cannot stop Motion. */
  animate: boolean
  interactive: boolean
}
const Context = createContext<VisualEffects>({ animate: false, interactive: false })

export function VisualEffectsProvider({ children }: { children: ReactNode }) {
  const { effects } = useTheme()
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [finePointer, setFinePointer] = useState(() => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches)
  const [printing, setPrinting] = useState(() => typeof window !== 'undefined' && window.matchMedia('print').matches)

  useEffect(() => {
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const print = window.matchMedia('print')
    const onVisibility = () => setVisible(!document.hidden)
    const onPointer = () => setFinePointer(pointer.matches)
    const onPrint = () => setPrinting(print.matches)
    document.addEventListener('visibilitychange', onVisibility)
    pointer.addEventListener('change', onPointer)
    print.addEventListener('change', onPrint)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      pointer.removeEventListener('change', onPointer)
      print.removeEventListener('change', onPrint)
    }
  }, [])

  const animate = effects !== 'off' && visible && !printing
  const value = useMemo(() => ({ animate, interactive: animate && effects === 'full' && finePointer }), [animate, effects, finePointer])
  return (
    <Context.Provider value={value}>
      <MotionConfig reducedMotion={animate ? 'user' : 'always'}>
        <LazyMotion features={domAnimation} strict>{children}</LazyMotion>
      </MotionConfig>
    </Context.Provider>
  )
}

export const useVisualEffects = () => useContext(Context)
