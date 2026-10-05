import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Markdown } from './Markdown'
import {
  clampShowVariable,
  initialShowValues,
  parseShowMappings,
  parseShowVariables,
  renderShowContent,
  type ShowValue,
  type ShowVariable,
} from '../lib/showBox'

export function ShowBox({ title, variableSpec, body }: { title: string; variableSpec: string; body: string }) {
  const variables = useMemo(() => parseShowVariables(variableSpec, body), [variableSpec, body])
  const mappings = useMemo(() => parseShowMappings(body), [body])
  const initialValues = useMemo(
    () => initialShowValues(variables),
    [variables],
  )
  const [values, setValues] = useState<Record<string, ShowValue>>(initialValues)

  useEffect(() => setValues(initialValues), [initialValues])

  const rendered = useMemo(() => renderShowContent(body, values, mappings), [body, values, mappings])
  const setValue = (variable: ShowVariable, raw: string) => {
    setValues((previous) => ({ ...previous, [variable.name]: clampShowVariable(variable, raw) }))
  }

  return (
    <section className="show-box not-prose my-6 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/70 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-center gap-2 border-b border-ink-200/80 bg-white/75 px-4 py-2.5 font-sans text-xs font-semibold text-ink-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-ink-200">
        <SlidersHorizontal size={14} className="text-brand-500" />
        <span>{title || '交互展示'}</span>
      </div>
      <div className="show-box-content px-4 py-4">
        <Markdown content={rendered} />
      </div>
      {variables.length > 0 && (
        <div className="grid gap-3 border-t border-ink-200/80 bg-white/50 p-4 sm:grid-cols-2 dark:border-white/10 dark:bg-black/10">
          {variables.map((variable) => {
            const value = values[variable.name]
            const canSlide =
              (variable.type === 'integer' || (variable.type === 'rational' && variable.fastSet)) &&
              variable.min !== undefined &&
              variable.max !== undefined
            return (
              <label key={variable.name} className="block min-w-0">
                <span className="mb-1.5 flex items-center justify-between gap-2 font-mono text-xs font-medium text-ink-600 dark:text-ink-300">
                  <span>{variable.name}</span>
                  <span className="text-ink-400">
                    {variable.type === 'string'
                      ? `${String(value).length}/${variable.maxLength ?? 100}`
                      : `${variable.min ?? '−∞'} – ${variable.max ?? '∞'}`}
                  </span>
                </span>
                {variable.type === 'string' ? (
                  <input
                    value={String(value)}
                    minLength={variable.minLength}
                    maxLength={variable.maxLength}
                    onChange={(event) => setValue(variable, event.target.value)}
                    className="input !py-2 font-mono text-xs"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={String(value)}
                      min={variable.min}
                      max={variable.max}
                      step={variable.step}
                      onChange={(event) => setValue(variable, event.target.value)}
                      className="input w-24 !py-2 font-mono text-xs"
                    />
                    {canSlide && (
                      <input
                        type="range"
                        value={Number(value)}
                        min={variable.min}
                        max={variable.max}
                        step={variable.step || 1}
                        onChange={(event) => setValue(variable, event.target.value)}
                        className="h-2 min-w-0 flex-1 cursor-pointer accent-brand-500"
                        aria-label={`${variable.name} 滑动条`}
                      />
                    )}
                  </div>
                )}
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}
