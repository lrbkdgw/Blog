import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiSyntaxContext } from '../lib/uiSyntaxContext'
import {
  parseUiWriteConfig,
  validateUiWriteRealValue,
  type UiWriteConfig,
  type UiWriteValue,
} from '../lib/uiWrite'

function asInputValue(value: UiWriteValue | undefined): string {
  return value === undefined ? '' : String(value)
}

function validationMessage(config: UiWriteConfig, draft: string): string | null {
  if (config.mode === 'real') return validateUiWriteRealValue(draft, config)
  if (config.minLength !== undefined && draft.length > 0 && draft.length < config.minLength) {
    return `至少需要 ${config.minLength} 个字符。`
  }
  return null
}

export function UiWriteWidget({
  id,
  optionsJson,
  grouped = false,
  sourceLine,
}: {
  id: string
  optionsJson: string
  grouped?: boolean
  sourceLine?: number
}) {
  const syntax = useUiSyntaxContext()
  const resetKey = syntax?.resetKey ?? ''
  const options = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(optionsJson)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }, [optionsJson])
  const config = useMemo(() => parseUiWriteConfig(id, options), [id, options])
  const setValue = syntax?.setValue
  const values = syntax?.values
  const [draft, setDraft] = useState(() => asInputValue(config.initialValue))
  const previousResetKey = useRef(resetKey)
  const rawValue = values?.[id]

  useEffect(() => {
    const reset = previousResetKey.current !== resetKey
    previousResetKey.current = resetKey
    const hasValue = Boolean(values && Object.prototype.hasOwnProperty.call(values, id))
    const nextValue = reset ? config.initialValue : hasValue ? rawValue as UiWriteValue : config.initialValue
    setDraft(asInputValue(nextValue))
  }, [id, optionsJson, resetKey, config])

  useEffect(() => {
    if (values && !Object.prototype.hasOwnProperty.call(values, id) && config.initialValue !== undefined) {
      setValue?.(id, config.initialValue)
    }
  }, [values, id, config.initialValue, setValue])

  const placementErrors = [
    ...config.errors,
    ...(config.merge && !grouped ? ['merge 必须紧跟在一个可合并的 new 填空框之后。'] : []),
  ]
  if (placementErrors.length > 0) {
    return (
      <span
        className="ui-write-error not-prose mx-1 inline-flex max-w-full items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200"
        data-source-line={sourceLine}
        role="status"
      >
        {placementErrors.join(' ')}
      </span>
    )
  }

  const error = validationMessage(config, draft)
  const update = (raw: string) => {
    const next = config.mode === 'text' && config.maxLength !== undefined
      ? raw.slice(0, config.maxLength)
      : raw
    setDraft(next)
    if (!setValue) return

    if (config.mode === 'real') {
      setValue(id, next === '' || validateUiWriteRealValue(next, config) ? '' : Number(next))
    } else {
      const belowMinimum = config.minLength !== undefined && next.length > 0 && next.length < config.minLength
      setValue(id, belowMinimum ? '' : next)
    }
  }

  const step = config.decimalPlaces === undefined ? undefined : String(10 ** -config.decimalPlaces)
  const layout = config.newLine && !grouped
    ? 'flex w-full flex-wrap items-center gap-2 align-middle'
    : 'inline-flex max-w-full flex-wrap items-center gap-2 align-middle'

  return (
    <span className={`ui-write-widget not-prose mx-1 ${layout}`} data-source-line={sourceLine}>
      {config.name && (
        <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{config.name}</span>
      )}
      {config.faster ? (
        <>
          <input
            type="range"
            min={config.minValue}
            max={config.maxValue}
            step={step}
            value={draft === '' ? String(config.minValue ?? 0) : draft}
            onChange={(event) => update(event.currentTarget.value)}
            aria-label={config.name || id}
            aria-valuetext={draft || String(config.minValue ?? 0)}
            data-ui-write-input={id}
            className="h-5 w-36 cursor-pointer accent-brand-500"
          />
          <output className="min-w-8 font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
            {draft || String(config.minValue ?? 0)}
          </output>
        </>
      ) : config.mode === 'real' ? (
        <input
          type="number"
          min={config.minValue}
          max={config.maxValue}
          step={step}
          value={draft}
          onChange={(event) => update(event.currentTarget.value)}
          aria-label={config.name || id}
          aria-invalid={Boolean(error)}
          data-ui-write-input={id}
          className="input !w-28 !py-1.5 text-sm"
        />
      ) : (
        <input
          type="text"
          minLength={config.minLength}
          maxLength={config.maxLength}
          value={draft}
          onChange={(event) => update(event.currentTarget.value)}
          placeholder={config.name || id}
          aria-label={config.name || id}
          aria-invalid={Boolean(error)}
          data-ui-write-input={id}
          className="input !w-auto min-w-28 !py-1.5 text-sm"
        />
      )}
      {error && (
        <span className="basis-full text-xs text-rose-600 dark:text-rose-300" role="status">
          {error}
        </span>
      )}
    </span>
  )
}
