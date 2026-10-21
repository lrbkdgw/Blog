import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import katex from 'katex'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  createInitialWidgetState,
  formatRealValue,
  resolveEffectiveRealString,
  type UiChooseWidgetDef,
  type UiIfWidgetDef,
  type UiSelectWidgetDef,
  type UiStateMap,
  type UiWidgetState,
  type UiWriteWidgetDef,
} from '../lib/uiWidgets'

export interface UiWidgetsContextValue {
  states: UiStateMap
  setWidgetState: (id: string, next: UiWidgetState) => void
  renderMarkdownBlock: (markdown: string) => ReactNode
}

export const UiWidgetsContext = createContext<UiWidgetsContextValue | null>(null)

/** 轻量渲染含 `$...$` 行内 KaTeX 公式的短文本（用于选项徽标、标题与下拉菜单项）。 */
export function InlineMathText({ text }: { text: string }) {
  const parts = useMemo(() => {
    if (!text.includes('$')) return [{ kind: 'text' as const, value: text }]
    const segments: Array<{ kind: 'text' | 'html'; value: string }> = []
    const regex = /\$([^$\n]+)\$/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) {
        segments.push({ kind: 'text', value: text.slice(last, m.index) })
      }
      try {
        const html = katex.renderToString(m[1], { throwOnError: false, displayMode: false })
        segments.push({ kind: 'html', value: html })
      } catch {
        segments.push({ kind: 'text', value: m[0] })
      }
      last = m.index + m[0].length
    }
    if (last < text.length) {
      segments.push({ kind: 'text', value: text.slice(last) })
    }
    return segments
  }, [text])

  return (
    <>
      {parts.map((seg, idx) =>
        seg.kind === 'html' ? (
          <span key={idx} dangerouslySetInnerHTML={{ __html: seg.value }} />
        ) : (
          <span key={idx}>{seg.value}</span>
        ),
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                               1. 选择框组件                                  */
/* -------------------------------------------------------------------------- */

export function UiChooseCard({
  def,
  sourceLine,
}: {
  def: UiChooseWidgetDef
  sourceLine?: number
}) {
  const ctx = useContext(UiWidgetsContext)
  const fallback = useMemo(() => createInitialWidgetState(def), [def])
  const current = ctx?.states[def.id]
  const selected = current?.kind === 'choose' ? current.selected : (fallback as { selected: number[] }).selected
  const [interacted, setInteracted] = useState(false)

  const toggleOption = (optIndex: number) => {
    if (!ctx) return
    setInteracted(true)
    const isSelected = selected.includes(optIndex)
    let next: number[]
    if (def.maxSelect <= 1) {
      next = isSelected && def.minSelect === 0 ? [] : isSelected ? [] : [optIndex]
    } else if (isSelected) {
      next = selected.filter((v) => v !== optIndex)
    } else if (selected.length < def.maxSelect) {
      next = [...selected, optIndex].sort((a, b) => a - b)
    } else {
      return
    }
    ctx.setWidgetState(def.id, { kind: 'choose', selected: next })
  }

  const rangeLabel =
    def.maxSelect <= 1 && !def.hasExplicitRange
      ? '单选'
      : def.minSelect === def.maxSelect
        ? `请选择 ${def.minSelect} 项`
        : `可选 ${def.minSelect}–${def.maxSelect} 项`
  const belowMin = interacted && selected.length < def.minSelect
  const reachedMax = def.maxSelect > 1 && selected.length >= def.maxSelect

  return (
    <div
      className="not-prose ui-widget-card my-5 overflow-hidden rounded-xl border border-ink-200/70 bg-ink-50/40 dark:border-white/10 dark:bg-white/[.025]"
      data-ui-id={def.id}
      data-source-line={sourceLine}
    >
      {(def.name || def.hasExplicitRange) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/60 bg-white/75 px-4 py-2.5 dark:border-white/10 dark:bg-white/[.02]">
          <span className="font-medium text-sm text-ink-900 dark:text-white">
            {def.name ? <InlineMathText text={def.name} /> : def.id}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
              belowMin
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300'
            }`}
          >
            {rangeLabel}
            {def.maxSelect > 1 ? `（已选 ${selected.length}）` : ''}
          </span>
        </div>
      )}

      <div className="divide-y divide-ink-200/60 dark:divide-white/10">
        {def.options.map((opt) => {
          const active = selected.includes(opt.index)
          const disabledByCap = !active && reachedMax
          return (
            <div
              key={opt.index}
              role={def.maxSelect <= 1 ? 'radio' : 'checkbox'}
              aria-checked={active}
              tabIndex={0}
              onClick={() => toggleOption(opt.index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleOption(opt.index)
                }
              }}
              className={`group flex cursor-pointer items-start gap-3 px-4 py-3 transition ${
                active
                  ? 'bg-brand-500/[0.08] dark:bg-brand-400/[0.12]'
                  : disabledByCap
                    ? 'cursor-not-allowed opacity-55'
                    : 'hover:bg-white/80 dark:hover:bg-white/[.04]'
              }`}
            >
              <span
                className={`mt-0.5 inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                    : 'border-ink-300 bg-white text-ink-700 group-hover:border-brand-400 dark:border-white/20 dark:bg-ink-900 dark:text-ink-200'
                }`}
              >
                <InlineMathText text={opt.label} />
              </span>
              <div className="prose prose-sm min-w-0 flex-1 dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                {ctx ? ctx.renderMarkdownBlock(opt.content) : opt.content}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                               2. 下拉选择框组件                              */
/* -------------------------------------------------------------------------- */

export function UiSelectInline({ def }: { def: UiSelectWidgetDef }) {
  const ctx = useContext(UiWidgetsContext)
  const fallback = useMemo(() => createInitialWidgetState(def), [def])
  const current = ctx?.states[def.id]
  const selected = current?.kind === 'select' ? current.selected : (fallback as { selected: number[] }).selected

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)

  const syncPosition = () => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024
    const minWidth = Math.max(rect.width, def.search ? 210 : 168)
    const left = Math.max(8, Math.min(rect.left, viewportW - minWidth - 8))
    setPanelPos({ top: rect.bottom + 6, left, minWidth })
  }

  useLayoutEffect(() => {
    if (!open) return
    syncPosition()
    if (def.search) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [open, def.search])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
      setQuery('')
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    const onViewportChange = () => syncPosition()
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return def.options
    return def.options.filter(
      (opt) => opt.content.toLowerCase().includes(q) || String(opt.index).includes(q),
    )
  }, [def.options, query])

  const toggleItem = (optIndex: number) => {
    if (!ctx) return
    if (def.maxSelect <= 1) {
      const next = selected.includes(optIndex) && def.minSelect === 0 ? [] : [optIndex]
      ctx.setWidgetState(def.id, { kind: 'select', selected: next })
      setOpen(false)
      setQuery('')
      return
    }
    const exists = selected.includes(optIndex)
    if (exists) {
      ctx.setWidgetState(def.id, { kind: 'select', selected: selected.filter((x) => x !== optIndex) })
    } else if (selected.length < def.maxSelect) {
      ctx.setWidgetState(def.id, { kind: 'select', selected: [...selected, optIndex].sort((a, b) => a - b) })
    }
  }

  const summaryLabels = selected
    .map((idx) => def.options.find((o) => o.index === idx)?.content)
    .filter((s): s is string => Boolean(s))

  const dropdownMenu = open && (
    <div
      ref={panelRef}
      style={
        panelPos
          ? { position: 'fixed', top: panelPos.top, left: panelPos.left, minWidth: panelPos.minWidth }
          : undefined
      }
      className="z-[120] max-w-xs overflow-hidden rounded-xl border border-ink-200/80 bg-white shadow-xl dark:border-white/15 dark:bg-ink-900"
      data-ui-select-menu={def.id}
    >
      {def.search && (
        <div className="flex items-center gap-1.5 border-b border-ink-200/70 px-2.5 py-2 dark:border-white/10">
          <Search size={13} className="shrink-0 text-ink-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索选项…"
            className="w-full bg-transparent text-xs text-ink-900 outline-none placeholder:text-ink-400 dark:text-white"
          />
        </div>
      )}
      {def.maxSelect > 1 && (
        <div className="border-b border-ink-200/50 bg-ink-50/70 px-3 py-1 text-[11px] text-ink-500 dark:border-white/10 dark:bg-white/[.03] dark:text-ink-400">
          可选 {def.minSelect}–{def.maxSelect} 项（已选 {selected.length}）
        </div>
      )}
      <div className="max-h-56 overflow-y-auto p-1">
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-center text-xs text-ink-400">无匹配选项</div>
        ) : (
          filteredOptions.map((opt) => {
            const active = selected.includes(opt.index)
            const disabledByCap = !active && def.maxSelect > 1 && selected.length >= def.maxSelect
            return (
              <button
                key={opt.index}
                type="button"
                disabled={disabledByCap}
                onClick={() => toggleItem(opt.index)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  active
                    ? 'bg-brand-500/12 font-medium text-brand-700 dark:bg-brand-400/20 dark:text-brand-200'
                    : disabledByCap
                      ? 'cursor-not-allowed opacity-45'
                      : 'text-ink-700 hover:bg-ink-100/80 dark:text-ink-200 dark:hover:bg-white/10'
                }`}
              >
                <span className="truncate">
                  <InlineMathText text={opt.content} />
                </span>
                {active && <Check size={13} className="shrink-0 text-brand-500" />}
              </button>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <span className="not-prose ui-select-inline mx-1 inline-flex align-middle" data-ui-id={def.id}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300/80 bg-white px-2.5 py-0.5 text-[0.9em] font-medium text-ink-800 shadow-2xs transition hover:border-brand-400 focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-ink-900 dark:text-ink-100"
      >
        <span className="max-w-[14rem] truncate">
          {summaryLabels.length > 0 ? (
            <InlineMathText text={summaryLabels.join('、')} />
          ) : (
            <span className="text-ink-400">请选择…</span>
          )}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {dropdownMenu &&
        (typeof document !== 'undefined' && document.body
          ? createPortal(dropdownMenu, document.body)
          : dropdownMenu)}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*                               3. 是否框组件                                  */
/* -------------------------------------------------------------------------- */

export function UiIfCard({
  def,
  sourceLine,
}: {
  def: UiIfWidgetDef
  sourceLine?: number
}) {
  const ctx = useContext(UiWidgetsContext)
  const fallback = useMemo(() => createInitialWidgetState(def), [def])
  const current = ctx?.states[def.id]
  const checked = current?.kind === 'if' ? current.checked : (fallback as { checked: boolean[] }).checked

  const toggleIndex = (idx: number) => {
    if (!ctx) return
    const next = def.items.map((_, i) => (i === idx ? !checked[i] : Boolean(checked[i])))
    ctx.setWidgetState(def.id, { kind: 'if', checked: next })
  }

  return (
    <div
      className="not-prose ui-widget-card my-5 divide-y divide-ink-200/60 overflow-hidden rounded-xl border border-ink-200/70 bg-ink-50/40 dark:divide-white/10 dark:border-white/10 dark:bg-white/[.025]"
      data-ui-id={def.id}
      data-source-line={sourceLine}
    >
      {def.items.map((item, idx) => {
        const on = Boolean(checked[idx])
        return (
          <div
            key={item.index}
            role="checkbox"
            aria-checked={on}
            tabIndex={0}
            onClick={() => toggleIndex(idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleIndex(idx)
              }
            }}
            className={`group flex cursor-pointer items-center gap-3 px-4 py-3 transition ${
              on
                ? 'bg-brand-500/[0.06] dark:bg-brand-400/[0.09]'
                : 'hover:bg-white/80 dark:hover:bg-white/[.04]'
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                on
                  ? 'border-brand-500 bg-brand-500 text-white shadow-2xs'
                  : 'border-ink-300 bg-white group-hover:border-brand-400 dark:border-white/25 dark:bg-ink-900'
              }`}
            >
              {on && <Check size={13} strokeWidth={2.6} />}
            </span>
            <div
              className={`ui-if-content relative min-w-0 flex-1 transition-opacity duration-300 ${
                def.lined ? 'ui-if-lined' : ''
              } ${on && def.lined ? 'is-lined-checked opacity-60' : ''}`}
            >
              <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                {ctx ? ctx.renderMarkdownBlock(item.content) : item.content}
              </div>
              {def.lined && <span aria-hidden="true" className="ui-if-strike-bar" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                               4. 填空框组件                                  */
/* -------------------------------------------------------------------------- */

export function UiWriteField({ def }: { def: UiWriteWidgetDef }) {
  const ctx = useContext(UiWidgetsContext)
  const fallback = useMemo(() => createInitialWidgetState(def), [def])
  const current = ctx?.states[def.id]
  const value = current?.kind === 'write' ? current.value : (fallback as { value: string }).value

  const updateValue = (raw: string) => {
    if (!ctx) return
    if (def.real) {
      // 允许用户流畅输入负号与小数点，同时限制小数位数不超过 bit
      if (raw !== '' && raw !== '-' && raw !== '+' && !/^[+-]?\d*(?:\.\d*)?$/.test(raw)) {
        return
      }
      if (def.real.bit === 0 && raw.includes('.')) {
        return
      }
      if (def.real.bit > 0 && raw.includes('.')) {
        const [intPart, decPart] = raw.split('.')
        if (decPart.length > def.real.bit) {
          raw = `${intPart}.${decPart.slice(0, def.real.bit)}`
        }
      }
    }
    if (def.len && raw.length > def.len.up) {
      raw = raw.slice(0, def.len.up)
    }
    ctx.setWidgetState(def.id, { kind: 'write', value: raw })
  }

  const normalizeOnBlur = () => {
    if (!ctx || !def.real) return
    const resolved = resolveEffectiveRealString(value, def.real)
    if (resolved.effective !== value) {
      ctx.setWidgetState(def.id, { kind: 'write', value: resolved.effective })
    }
  }

  // 行内模式：紧跟当前行文本后
  if (!def.isNew) {
    const widthCh = Math.max(4, Math.min(18, (value?.length || 2) + 2))
    return (
      <span className="not-prose ui-write-inline mx-1 inline-flex items-center align-baseline" data-ui-id={def.id}>
        <input
          type="text"
          inputMode={def.real ? (def.real.bit === 0 ? 'numeric' : 'decimal') : 'text'}
          value={value}
          maxLength={def.len?.up}
          onChange={(e) => updateValue(e.target.value)}
          onBlur={normalizeOnBlur}
          style={{ width: `${widthCh}ch` }}
          aria-label={def.id}
          className="rounded-md border border-ink-300/90 bg-white px-2 py-0.5 text-center font-mono text-[0.9em] text-ink-900 shadow-2xs transition focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-ink-900 dark:text-white"
        />
      </span>
    )
  }

  // 块级模式（含单列 / merge 多列共用一行 / faster 滑动条）
  const step = def.real ? Number(Math.pow(10, -def.real.bit).toFixed(Math.min(8, def.real.bit))) : 1
  const numericSliderVal = def.real
    ? Number(resolveEffectiveRealString(value, def.real).effective)
    : 0
  const realStatus = def.real ? resolveEffectiveRealString(value, def.real) : null
  const lenTooShort = Boolean(def.len && value.length > 0 && value.length < def.len.down)

  return (
    <div
      className="not-prose ui-write-block flex flex-col justify-between gap-2 rounded-xl border border-ink-200/70 bg-ink-50/40 px-4 py-3 dark:border-white/10 dark:bg-white/[.025]"
      data-ui-id={def.id}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          {def.name ? <InlineMathText text={def.name} /> : def.id}
        </label>
        <span className="font-mono text-[11px] text-ink-400">
          {def.real
            ? realStatus && !realStatus.valid && realStatus.hint
              ? realStatus.hint
              : `${def.real.down} ~ ${def.real.up}`
            : def.len
              ? lenTooShort
                ? `至少 ${def.len.down} 字（${value.length}/${def.len.up}）`
                : `${value.length}/${def.len.up}`
              : null}
        </span>
      </div>

      {def.faster && def.real ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={def.real.down}
            max={def.real.up}
            step={step}
            value={numericSliderVal}
            aria-label={def.name || def.id}
            onChange={(e) => {
              const num = Number(e.target.value)
              updateValue(formatRealValue(num, def.real!.bit))
            }}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-brand-500"
          />
          <input
            type="text"
            inputMode={def.real.bit === 0 ? 'numeric' : 'decimal'}
            value={value}
            onChange={(e) => updateValue(e.target.value)}
            onBlur={normalizeOnBlur}
            className="w-16 rounded-md border border-ink-200/80 bg-white px-2 py-1 text-center font-mono text-xs text-ink-900 outline-none focus:border-brand-500 dark:border-white/15 dark:bg-ink-900 dark:text-white"
          />
        </div>
      ) : (
        <input
          type="text"
          inputMode={def.real ? (def.real.bit === 0 ? 'numeric' : 'decimal') : 'text'}
          value={value}
          maxLength={def.len?.up}
          onChange={(e) => updateValue(e.target.value)}
          onBlur={normalizeOnBlur}
          placeholder={
            def.len
              ? `请输入 ${def.len.down}–${def.len.up} 个字符…`
              : def.real
                ? `${def.real.down} ~ ${def.real.up}`
                : '请输入…'
          }
          className="w-full rounded-lg border border-ink-200/80 bg-white px-3 py-1.5 text-sm text-ink-900 outline-none transition focus:border-brand-500 dark:border-white/15 dark:bg-ink-900 dark:text-white"
        />
      )}
    </div>
  )
}

export function UiWriteRow({
  defs,
  sourceLine,
}: {
  defs: UiWriteWidgetDef[]
  sourceLine?: number
}) {
  return (
    <div
      className="not-prose ui-write-row my-4 grid gap-3"
      data-source-line={sourceLine}
      style={{
        gridTemplateColumns: defs.length > 1 ? `repeat(${defs.length}, minmax(0, 1fr))` : undefined,
      }}
    >
      {defs.map((d) => (
        <UiWriteField key={d.id} def={d} />
      ))}
    </div>
  )
}
