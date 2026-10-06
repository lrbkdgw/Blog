/**
 * VS Code 内置 Markdown 预览里的交互脚本：让展示框的变量控件真正可用。
 *
 * 预览每次刷新都会整体替换 DOM，所以这里用 MutationObserver 重新初始化，
 * 并按展示框的内容哈希记住当前取值，编辑文章时不会把滑动条弹回默认值。
 */

import {
  clampShowVariable,
  evaluateShowToken,
  showValueKey,
  type ShowMapping,
  type ShowValue,
  type ShowVariable,
} from '../core/showBox'

interface BoxModel {
  variables: ShowVariable[]
  mappings: ShowMapping[]
}

const memory: Record<string, Record<string, ShowValue>> = {}

function readModel(element: HTMLElement): BoxModel | null {
  const raw = element.getAttribute('data-sl-model')
  if (!raw) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as BoxModel
    if (!parsed || !parsed.variables) return null
    return { variables: parsed.variables, mappings: parsed.mappings || [] }
  } catch {
    return null
  }
}

function refresh(box: HTMLElement, model: BoxModel, values: Record<string, ShowValue>): void {
  const spans = box.querySelectorAll('[data-sl-kind]')
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index] as HTMLElement
    const kind = span.getAttribute('data-sl-kind') || 'show'
    const arg = span.getAttribute('data-sl-arg') || ''
    span.textContent = evaluateShowToken({ kind: kind as any, arg }, values, model.mappings)
  }
}

function setupBox(box: HTMLElement): void {
  if (box.getAttribute('data-sl-ready') === 'true') return
  const model = readModel(box)
  if (!model) return
  box.setAttribute('data-sl-ready', 'true')

  const key = box.getAttribute('data-sl-box') || ''
  const values: Record<string, ShowValue> = {}
  for (const variable of model.variables) values[variable.name] = variable.initial
  const remembered = memory[key]
  if (remembered) {
    for (const variable of model.variables) {
      if (Object.prototype.hasOwnProperty.call(remembered, variable.name)) {
        values[variable.name] = remembered[variable.name]
      }
    }
  }
  memory[key] = values

  const inputs = box.querySelectorAll('[data-sl-input]')
  const byName: Record<string, HTMLInputElement[]> = {}
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index] as HTMLInputElement
    const name = input.getAttribute('data-sl-input') || ''
    if (!byName[name]) byName[name] = []
    byName[name].push(input)
  }

  const variableByName: Record<string, ShowVariable> = {}
  for (const variable of model.variables) variableByName[variable.name] = variable

  const sync = (name: string, source?: HTMLInputElement) => {
    const text = showValueKey(values[name])
    for (const input of byName[name] || []) {
      if (input !== source && input.value !== text) input.value = text
    }
  }

  for (const name of Object.keys(byName)) {
    for (const input of byName[name]) {
      input.addEventListener('input', () => {
        const variable = variableByName[name]
        if (!variable) return
        const next = clampShowVariable(variable, input.value)
        // 输入过程中允许暂时为空/半成品，不要立刻把光标里的内容改掉。
        values[name] = next
        memory[key] = values
        sync(name, input)
        refresh(box, model, values)
      })
      input.addEventListener('change', () => {
        sync(name)
      })
    }
    sync(name)
  }

  refresh(box, model, values)
}

function setupAll(): void {
  const boxes = document.querySelectorAll('.starlog-showbox[data-sl-model]')
  for (let index = 0; index < boxes.length; index += 1) setupBox(boxes[index] as HTMLElement)
}

function start(): void {
  setupAll()
  const observer = new MutationObserver(() => setupAll())
  observer.observe(document.body, { childList: true, subtree: true })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
