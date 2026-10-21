import { useEffect, useMemo, useState } from 'react'
import { Markdown } from './Markdown'
import { useUiSyntaxContext } from '../lib/uiSyntaxContext'
import {
  initialUiChoiceValue,
  normalizeSelectedIndexes,
  parseUiChoiceConfig,
  type UiStateValue,
} from '../lib/uiChoices'

function selectedIfFlags(value: UiStateValue | undefined, count: number): boolean[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'boolean')) {
    return Array.from({ length: count }, (_, index) => value[index] === true)
  }
  return Array.from({ length: count }, () => false)
}

function optionPlainText(value: string): string {
  return value
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function UiChoiceWidget({
  kind,
  id,
  title,
  extra,
  body,
  sourceLine,
}: {
  kind: 'choose' | 'select' | 'if'
  id: string
  title?: string
  extra?: string
  body: string
  sourceLine?: number
}) {
  const syntax = useUiSyntaxContext()
  const values = syntax?.values ?? {}
  const setValue = syntax?.setValue ?? (() => undefined)
  const config = useMemo(
    () => parseUiChoiceConfig(kind, id, title ?? '', extra ?? '', body),
    [kind, id, title, extra, body],
  )
  const initialValue = useMemo(() => initialUiChoiceValue(config), [config])
  const [searchTerm, setSearchTerm] = useState('')
  const rawValue = values[id]

  useEffect(() => {
    if (syntax && !Object.prototype.hasOwnProperty.call(values, id)) setValue(id, initialValue)
  }, [syntax, values, id, initialValue, setValue])

  if (config.errors.some((error) => error.startsWith('控件 id'))) {
    return (
      <div className="ui-choice-error not-prose my-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
        {config.errors[0]}
      </div>
    )
  }

  const selected = normalizeSelectedIndexes(
    rawValue,
    config.options.length,
    initialValue as number[],
  )
  const multiple = config.maxCount > 1
  const chooseIndex = (index: number) => setValue(id, [index])
  const toggleIndex = (index: number) => {
    if (selected.includes(index)) {
      if (selected.length <= config.minCount) return
      setValue(id, selected.filter((value) => value !== index))
      return
    }
    if (selected.length >= config.maxCount) return
    setValue(id, [...selected, index].sort((a, b) => a - b))
  }

  if (kind === 'select') {
    const visibleOptions = config.options
      .map((option, index) => ({ option, index: index + 1 }))
      .filter(({ option, index }) =>
        selected.includes(index) || optionPlainText(option.content).toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase()),
      )
    return (
      <span
        className="ui-select-widget not-prose my-1 inline-flex max-w-full flex-col gap-1 align-middle"
        data-source-line={sourceLine}
      >
        {config.search && (
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="搜索选项…"
            aria-label={`搜索 ${title || id} 选项`}
            className="input !w-auto min-w-32 !py-1.5 text-xs"
          />
        )}
        <select
          multiple={multiple}
          value={multiple ? selected.map(String) : String(selected[0] ?? '')}
          onChange={(event) => {
            if (multiple) {
              const next = Array.from(event.currentTarget.selectedOptions)
                .map((option) => Number(option.value))
                .filter((index) => Number.isInteger(index))
                .slice(0, config.maxCount)
              if (next.length >= config.minCount) setValue(id, next.sort((a, b) => a - b))
            } else if (event.currentTarget.value === '' && config.minCount === 0) {
              setValue(id, [])
            } else {
              const next = Number(event.currentTarget.value)
              if (Number.isInteger(next) && next > 0) setValue(id, [next])
            }
          }}
          aria-label={title || id}
          className={`input !py-1.5 font-sans text-sm ${multiple ? 'min-h-24 min-w-40' : 'min-w-28'}`}
        >
          {!multiple && config.minCount === 0 && <option value="">（不选择）</option>}
          {!multiple && config.minCount > 0 && selected.length === 0 && <option value="" disabled>请选择…</option>}
          {visibleOptions.map(({ option, index }) => (
            <option key={index} value={index}>{optionPlainText(option.content)}</option>
          ))}
        </select>
      </span>
    )
  }

  if (kind === 'if') {
    const flags = selectedIfFlags(rawValue, config.options.length)
    return (
      <section
        className="ui-if-box not-prose my-5 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/50 shadow-sm dark:border-white/10 dark:bg-white/[.025]"
        data-source-line={sourceLine}
      >
        {title && (
          <header className="border-b border-ink-200/70 bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink-700 dark:border-white/10 dark:bg-white/[.035] dark:text-ink-200">
            {title}
          </header>
        )}
        <div className="divide-y divide-ink-200/60 dark:divide-white/[.07]">
          {config.options.map((option, index) => {
            const checked = flags[index] === true
            return (
              <label key={index} className="flex cursor-pointer items-start gap-3 px-4 py-3.5 text-sm text-ink-700 transition hover:bg-white/60 dark:text-ink-200 dark:hover:bg-white/[.035]">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = [...flags]
                    next[index] = event.target.checked
                    setValue(id, next)
                  }}
                  className="mt-1 h-4 w-4 shrink-0 rounded accent-brand-500"
                  aria-label={`${id}-${index + 1}`}
                />
                <span
                  className={`relative min-w-0 flex-1 transition-colors ${
                    config.lined && checked ? 'text-ink-400 line-through dark:text-ink-500' : ''
                  }`}
                >
                  {config.lined && (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute left-0 right-0 top-1/2 z-10 h-px origin-left bg-current transition-transform duration-300 ${
                        checked ? 'scale-x-100' : 'scale-x-0'
                      }`}
                    />
                  )}
                  <Markdown content={option.content} headingAnchors={false} />
                </span>
              </label>
            )
          })}
        </div>
      </section>
    )
  }

  const isSingleChoice = config.minCount > 0 && config.maxCount === 1
  return (
    <section
      className="ui-choose-box not-prose my-5 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/50 shadow-sm dark:border-white/10 dark:bg-white/[.025]"
      data-source-line={sourceLine}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-200/70 bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink-700 dark:border-white/10 dark:bg-white/[.035] dark:text-ink-200">
          <span>{title}</span>
          <span className="text-[11px] font-normal text-ink-400">
            {multiple ? `${selected.length} / ${config.minCount}–${config.maxCount}` : '单选'}
          </span>
        </header>
      )}
      <div className="divide-y divide-ink-200/60 dark:divide-white/[.07]">
        {config.options.map((option, index) => {
          const optionIndex = index + 1
          const checked = selected.includes(optionIndex)
          const disabled = !checked && selected.length >= config.maxCount
          return (
            <div key={`${option.label}-${index}`} className={`px-4 py-3.5 transition ${checked ? 'bg-brand-50/60 dark:bg-brand-500/[.06]' : ''}`}>
              <label className={`flex items-center gap-2.5 text-sm font-semibold ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}>
                <input
                  type={isSingleChoice ? 'radio' : 'checkbox'}
                  name={isSingleChoice ? `ui-choice-${id}` : undefined}
                  checked={checked}
                  disabled={disabled || (checked && selected.length <= config.minCount)}
                  onChange={() => (isSingleChoice ? chooseIndex(optionIndex) : toggleIndex(optionIndex))}
                  className="h-4 w-4 shrink-0 accent-brand-500"
                  aria-label={`${id}-${optionIndex}`}
                />
                <span className="min-w-0 flex-1"><Markdown content={option.label} headingAnchors={false} /></span>
                <span className="shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 dark:bg-white/10">
                  {optionIndex}
                </span>
              </label>
              {option.content && (
                <div className="ml-6 mt-2 border-l-2 border-ink-200 pl-3 text-sm text-ink-600 dark:border-white/10 dark:text-ink-300">
                  <Markdown content={option.content} headingAnchors={false} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {config.errors.length > 0 && (
        <div className="border-t border-amber-200/70 bg-amber-50/60 px-4 py-2 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/[.06] dark:text-amber-200">
          {config.errors.map((error, index) => <p key={index}>{error}</p>)}
        </div>
      )}
    </section>
  )
}
