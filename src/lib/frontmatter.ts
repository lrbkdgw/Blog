import yaml from 'js-yaml'

const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/

export interface Parsed {
  data: Record<string, unknown>
  content: string
}

/** 浏览器友好的 frontmatter 解析（gray-matter 依赖 Node Buffer，这里自己实现） */
export function parseFrontmatter(raw: string): Parsed {
  const match = raw.match(FM_RE)
  if (!match) return { data: {}, content: raw.replace(/^\uFEFF/, '') }
  let data: Record<string, unknown> = {}
  try {
    const loaded = yaml.load(match[1])
    if (loaded && typeof loaded === 'object') data = loaded as Record<string, unknown>
  } catch (err) {
    console.warn('[frontmatter] YAML 解析失败：', err)
  }
  return { data, content: raw.slice(match[0].length) }
}

function quote(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 把元信息 + 正文序列化回 Markdown 文件内容 */
export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}: [${value.map((v) => quote(String(v))).join(', ')}]`)
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`)
    } else {
      lines.push(`${key}: ${quote(String(value))}`)
    }
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n${content.replace(/^\n+/, '')}\n`.replace(/\n{3,}$/, '\n')
}
