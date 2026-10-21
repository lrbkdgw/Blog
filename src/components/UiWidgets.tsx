import {
  createContext,
  useContext,
  useEffect,
  useId,
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
  renderMarkdownBlock: (markdown: string, options?: { linedStrikethrough?: boolean }) => ReactNode
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

/**
 * 保留选项块内的自然单行换行（如 `[B]\n我！\n爱！\n香！\n蕉！` 或多行判断文本），
 * 同时完整保留围栏代码块、`$$...$$` 块级公式、表格、标题与列表。
 */
export function preserveOptionLineBreaks(markdown: string): string {
  const lines = markdown.split('\n')
  if (lines.length <= 1) return markdown

  const result: string[] = []
  let fence: string | null = null
  let inMathBlock = false

  const isBlockBoundary = (line: string): boolean => {
    const t = line.trim()
    if (!t) return true
    if (/^(`{3,}|~{3,})/.test(t)) return true
    if (/^\$\$/.test(t)) return true
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|\||::|---+$|\*\*\*+$)/.test(t)) return true
    return false
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      result.push(line)
      continue
    }
    if (fence) {
      result.push(line)
      continue
    }

    if (trimmed === '$$') {
      inMathBlock = !inMathBlock
      result.push(line)
      continue
    }
    if (inMathBlock) {
      result.push(line)
      continue
    }

    const nextLine = lines[i + 1]
    if (
      nextLine !== undefined &&
      !isBlockBoundary(line) &&
      !isBlockBoundary(nextLine) &&
      !line.endsWith('  ') &&
      !line.endsWith('\\')
    ) {
      result.push(`${line}  `)
    } else {
      result.push(line)
    }
  }

  return result.join('\n')
}

/* -------------------------------------------------------------------------- */
/*                     1. 选择框组件（紧凑字号与行高、极简卡片风格）              */
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

  const rangeHint =
    !def.hasExplicitRange && def.maxSelect <= 1
      ? null
      : def.minSelect === def.maxSelect
        ? `选 ${def.minSelect} 项`
        : `可选 ${def.minSelect}–${def.maxSelect} 项`
  const belowMin = interacted && selected.length < def.minSelect
  const reachedMax = def.maxSelect > 1 && selected.length >= def.maxSelect

  return (
    <section
      className="not-prose ui-widget-card ui-choose-card my-4 overflow-hidden rounded-lg border border-ink-200/80 bg-white/95 shadow-2xs transition-colors dark:border-white/10 dark:bg-white/[0.03]"
      data-ui-id={def.id}
      data-source-line={sourceLine}
    >
      {(def.name || rangeHint) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/60 bg-ink-50/50 px-3 py-1.5 dark:border-white/[0.07] dark:bg-white/[0.02]">
          {def.name ? (
            <span className="text-xs font-semibold text-ink-800 dark:text-ink-100">
              <InlineMathText text={def.name} />
            </span>
          ) : (
            <span />
          )}
          {rangeHint && (
            <span
              className={`text-[11px] transition ${
                belowMin
                  ? 'font-medium text-amber-600 dark:text-amber-300'
                  : 'text-ink-400 dark:text-ink-500'
              }`}
            >
              {rangeHint}
            </span>
          )}
        </div>
      )}

      <div className="divide-y divide-ink-200/55 dark:divide-white/[0.07]">
        {def.options.map((opt) => {
          const active = selected.includes(opt.index)
          const disabledByCap = !active && reachedMax
          const formatted = preserveOptionLineBreaks(opt.content)
          return (
            <div
              key={opt.index}
              role={def.maxSelect <= 1 ? 'radio' : 'checkbox'}
              aria-checked={active}
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement | null)?.closest('a,button,input,summary')) return
                toggleOption(opt.index)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleOption(opt.index)
                }
              }}
              className={`group flex items-start gap-2.5 px-3 py-1.5 transition-colors duration-150 outline-none focus-visible:bg-brand-500/8 ${
                active
                  ? 'cursor-pointer bg-brand-500/[0.065] dark:bg-brand-400/[0.09]'
                  : disabledByCap
                    ? 'cursor-not-allowed opacity-45'
                    : 'cursor-pointer hover:bg-ink-50/75 dark:hover:bg-white/[0.025]'
              }`}
            >
              <span
                className={`mt-[1px] inline-flex min-h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded border px-1 text-[11px] leading-none font-semibold transition-all duration-150 ${
                  active
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-ink-200/90 bg-white text-ink-600 group-hover:border-brand-400/70 group-hover:text-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-300 dark:group-hover:text-brand-300'
                }`}
              >
                <InlineMathText text={opt.label} />
              </span>
              <div className="min-w-0 flex-1 text-[13px] leading-[1.48] text-ink-800 dark:text-ink-200 [&_.katex-display]:my-1.5">
                {ctx ? ctx.renderMarkdownBlock(formatted) : formatted}
              </div>
            </div>
          )
        })}
      </div>
    </section>
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
    const minWidth = Math.max(rect.width, def.search ? 184 : 148)
    const left = Math.max(8, Math.min(rect.left, viewportW - minWidth - 8))
    setPanelPos({ top: rect.bottom + 5, left, minWidth })
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
      className="z-[120] max-w-xs overflow-hidden rounded-lg border border-ink-200/85 bg-white/98 shadow-lg shadow-ink-950/8 backdrop-blur-md dark:border-white/12 dark:bg-ink-900/98"
      data-ui-select-menu={def.id}
    >
      {def.search && (
        <div className="flex items-center gap-1.5 border-b border-ink-200/60 px-2.5 py-1.5 dark:border-white/10">
          <Search size={12} className="shrink-0 text-ink-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索…"
            className="w-full bg-transparent text-xs text-ink-900 outline-none placeholder:text-ink-400 dark:text-white"
          />
        </div>
      )}
      {def.maxSelect > 1 && (
        <div className="border-b border-ink-200/50 bg-ink-50/60 px-2.5 py-1 text-[11px] text-ink-400 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-ink-400">
          可选 {def.minSelect}–{def.maxSelect} 项
        </div>
      )}
      <div className="max-h-52 overflow-y-auto p-1">
        {filteredOptions.length === 0 ? (
          <div className="px-2.5 py-1.5 text-center text-xs text-ink-400">无匹配选项</div>
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
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                  active
                    ? 'bg-brand-500/10 font-medium text-brand-700 dark:bg-brand-400/15 dark:text-brand-200'
                    : disabledByCap
                      ? 'cursor-not-allowed opacity-40'
                      : 'text-ink-700 hover:bg-ink-100/75 dark:text-ink-200 dark:hover:bg-white/[0.07]'
                }`}
              >
                <span className="truncate">
                  <InlineMathText text={opt.content} />
                </span>
                {active && <Check size={12} className="shrink-0 text-brand-500" />}
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
        className={`inline-flex h-[24px] items-center gap-1 rounded-md border px-2 text-[12.5px] leading-none font-medium shadow-2xs transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20 ${
          summaryLabels.length > 0
            ? 'border-brand-500/45 bg-brand-500/[0.05] text-ink-900 hover:border-brand-500 dark:border-brand-400/40 dark:bg-brand-400/10 dark:text-ink-100'
            : 'border-ink-200/90 bg-white/95 text-ink-500 hover:border-ink-300 hover:text-ink-800 dark:border-white/15 dark:bg-white/[0.05] dark:text-ink-400 dark:hover:border-white/25 dark:hover:text-ink-200'
        }`}
      >
        <span className="max-w-[13rem] truncate">
          {summaryLabels.length > 0 ? <InlineMathText text={summaryLabels.join('、')} /> : '请选择'}
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-ink-400 transition-transform duration-150 ${open ? 'rotate-180 text-brand-500' : ''}`}
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
/*                3. 是否框组件（紧凑字号行高 + 多行逐行删除线动画）              */
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
    <section
      className="not-prose ui-widget-card ui-if-card my-4 divide-y divide-ink-200/55 overflow-hidden rounded-lg border border-ink-200/80 bg-white/95 shadow-2xs dark:divide-white/[0.07] dark:border-white/10 dark:bg-white/[0.03]"
      data-ui-id={def.id}
      data-source-line={sourceLine}
    >
      {def.items.map((item, idx) => {
        const on = Boolean(checked[idx])
        const formatted = preserveOptionLineBreaks(item.content)
        return (
          <div
            key={item.index}
            role="checkbox"
            aria-checked={on}
            tabIndex={0}
            onClick={(e) => {
              if ((e.target as HTMLElement | null)?.closest('a,button,input,summary')) return
              toggleIndex(idx)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleIndex(idx)
              }
            }}
            className="group flex cursor-pointer items-start gap-2.5 px-3 py-1.5 transition-colors duration-150 outline-none hover:bg-ink-50/75 focus-visible:bg-brand-500/8 dark:hover:bg-white/[0.025]"
          >
            <span
              className={`mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-all duration-200 ${
                on
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-ink-300 bg-white group-hover:border-brand-400 dark:border-white/22 dark:bg-white/[0.04]'
              }`}
            >
              <Check
                size={10.5}
                strokeWidth={3}
                className={`transition-transform duration-200 ${on ? 'scale-100' : 'scale-0'}`}
              />
            </span>
            <div
              className={`ui-if-content min-w-0 flex-1 text-[13px] leading-[1.48] transition-opacity duration-250 [&_.katex-display]:my-1.5 ${
                def.lined ? 'ui-if-lined' : ''
              } ${
                on && def.lined
                  ? 'is-lined-checked opacity-55'
                  : 'opacity-100'
              }`}
            >
              {ctx
                ? ctx.renderMarkdownBlock(formatted, { linedStrikethrough: def.lined })
                : formatted}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/*              4. 填空框组件（紧凑字号与高度，无外层包裹边框盒）                 */
/* -------------------------------------------------------------------------- */

export function UiWriteField({ def }: { def: UiWriteWidgetDef }) {
  const ctx = useContext(UiWidgetsContext)
  const inputId = useId()
  const fallback = useMemo(() => createInitialWidgetState(def), [def])
  const current = ctx?.states[def.id]
  const value = current?.kind === 'write' ? current.value : (fallback as { value: string }).value

  const updateValue = (raw: string) => {
    if (!ctx) return
    if (def.real) {
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

  // 行内模式：紧跟当前行文本后，小巧紧凑
  if (!def.isNew) {
    const widthCh = Math.max(4.2, Math.min(16, (value?.length || 2) + 2.2))
    return (
      <span className="not-prose ui-write-inline mx-1 inline-flex items-center align-baseline" data-ui-id={def.id}>
        <input
          id={inputId}
          type="text"
          inputMode={def.real ? (def.real.bit === 0 ? 'numeric' : 'decimal') : 'text'}
          value={value}
          maxLength={def.len?.up}
          onChange={(e) => updateValue(e.target.value)}
          onBlur={normalizeOnBlur}
          style={{ width: `${widthCh}ch` }}
          aria-label={def.name || def.id}
          className="h-[23px] rounded border border-ink-200/90 bg-white/95 px-1.5 text-center font-mono text-[12.5px] leading-none text-ink-900 shadow-2xs outline-none transition duration-150 hover:border-brand-400/75 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-white/15 dark:bg-white/[0.05] dark:text-ink-100"
        />
      </span>
    )
  }

  // 独立行 / 多列 merge / faster 滑块模式：紧凑高度与字号，无多余外层边框盒
  const step = def.real ? Number(Math.pow(10, -def.real.bit).toFixed(Math.min(8, def.real.bit))) : 1
  const numericSliderVal = def.real
    ? Number(resolveEffectiveRealString(value, def.real).effective)
    : 0
  const realStatus = def.real ? resolveEffectiveRealString(value, def.real) : null
  const lenTooShort = Boolean(def.len && value.length > 0 && value.length < def.len.down)
  const invalidHint =
    def.real && realStatus && !realStatus.valid && realStatus.hint
      ? realStatus.hint
      : lenTooShort && def.len
        ? `至少 ${def.len.down} 个字符`
        : null

  return (
    <div
      className="not-prose ui-write-field flex min-w-0 flex-col gap-1"
      data-ui-id={def.id}
    >
      {(def.name || invalidHint) && (
        <div className="flex items-center justify-between gap-2 leading-tight">
          {def.name ? (
            <label htmlFor={inputId} className="text-xs font-medium text-ink-600 dark:text-ink-300">
              <InlineMathText text={def.name} />
            </label>
          ) : (
            <span />
          )}
          {invalidHint && (
            <span className="font-mono text-[11px] text-rose-500 dark:text-rose-400">{invalidHint}</span>
          )}
        </div>
      )}

      {def.faster && def.real ? (
        <div className="flex h-[28px] items-center gap-2.5">
          <input
            id={inputId}
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
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-ink-200/85 accent-brand-500 dark:bg-white/15"
          />
          <input
            type="text"
            inputMode={def.real.bit === 0 ? 'numeric' : 'decimal'}
            value={value}
            onChange={(e) => updateValue(e.target.value)}
            onBlur={normalizeOnBlur}
            aria-label={`${def.name || def.id} 数值输入`}
            className="h-[26px] w-14 shrink-0 rounded-md border border-ink-200/90 bg-white/95 px-1.5 text-center font-mono text-xs text-ink-900 shadow-2xs outline-none transition duration-150 hover:border-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-100"
          />
        </div>
      ) : (
        <input
          id={inputId}
          type="text"
          inputMode={def.real ? (def.real.bit === 0 ? 'numeric' : 'decimal') : 'text'}
          value={value}
          maxLength={def.len?.up}
          onChange={(e) => updateValue(e.target.value)}
          onBlur={normalizeOnBlur}
          aria-label={def.name || def.id}
          aria-invalid={Boolean(invalidHint)}
          placeholder={
            def.len
              ? `请输入 ${def.len.down}–${def.len.up} 个字符…`
              : def.real
                ? `${def.real.down} ~ ${def.real.up}`
                : '请输入…'
          }
          className={`h-[29px] w-full rounded-md border bg-white/95 px-2.5 text-[12.5px] leading-none text-ink-900 shadow-2xs outline-none transition duration-150 placeholder:text-[11.5px] placeholder:text-ink-400 dark:bg-white/[0.04] dark:text-ink-100 dark:placeholder:text-ink-500 ${
            invalidHint
              ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 dark:border-rose-400/80'
              : 'border-ink-200/90 hover:border-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-white/12 dark:hover:border-white/20 dark:focus:border-brand-400'
          }`}
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
      className="not-prose ui-write-row my-2.5 grid items-end gap-3"
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
