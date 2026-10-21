import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { UiStateValue } from './uiChoices'

export interface UiSyntaxContextValue {
  values: Record<string, UiStateValue>
  setValue: (id: string, value: UiStateValue) => void
  resetKey: string
}

export const UiSyntaxContext = createContext<UiSyntaxContextValue | null>(null)

/** The outermost Markdown view owns values; nested Markdown shares that state. */
export function UiSyntaxProvider({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  const [values, setValues] = useState<Record<string, UiStateValue>>({})
  const previousKey = useRef(resetKey)

  useEffect(() => {
    if (previousKey.current !== resetKey) {
      previousKey.current = resetKey
      setValues({})
    }
  }, [resetKey])

  const setValue = useCallback((id: string, value: UiStateValue) => {
    setValues((previous) => (Object.is(previous[id], value) ? previous : { ...previous, [id]: value }))
  }, [])

  const context = useMemo(() => ({ values, setValue, resetKey }), [values, setValue, resetKey])
  return <UiSyntaxContext.Provider value={context}>{children}</UiSyntaxContext.Provider>
}

export function useUiSyntaxContext(): UiSyntaxContextValue | null {
  return useContext(UiSyntaxContext)
}
