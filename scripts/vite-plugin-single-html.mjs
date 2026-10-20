/**
 * Vite 插件：把整个站点打包成**一个** HTML 文件（离线版）。
 *
 * 做法：
 *   1. 构建产物只有一个 JS chunk 与一个 CSS 文件（见 vite.offline.config.ts 里的
 *      `inlineDynamicImports` / `cssCodeSplit: false`），把它们就地内联进 index.html；
 *   2. 任何仍然被单独发出的资源（KaTeX 字体、图片等）按内容转成 data URI，
 *      并把它在 JS / CSS / HTML 里的引用整体替换掉；
 *   3. 收尾做**强制自检**：只要还有任何一条外链/本地文件引用没被内联，或 KaTeX /
 *      highlight.js 的样式没进最终文件，就直接构建失败——离线版最怕的就是
 *      「构建成功、打开才发现公式和高亮全坏掉」，这类问题必须在 CI 里炸掉。
 *
 * 不使用 vite-plugin-singlefile：它的资源内联与转义策略不覆盖本项目
 * （KaTeX 字体、内联脚本里的 `</script`、public 下的 favicon），并且失败会静默跳过。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import vm from 'node:vm'

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
}

export function mimeType(name) {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
  return MIME[ext] || 'application/octet-stream'
}

export function toDataUri(buffer, name) {
  return `data:${mimeType(name)};base64,${Buffer.from(buffer).toString('base64')}`
}

function assetSource(asset) {
  if (typeof asset.source === 'string') return Buffer.from(asset.source, 'utf8')
  if (asset.source instanceof Uint8Array || Buffer.isBuffer(asset.source)) return Buffer.from(asset.source)
  return null
}

/**
 * 取出产物的文本内容。
 *
 * ⚠️ Rollup 的 chunk 把代码放在 `.code`，asset 才放在 `.source`。
 * 只读 `.source` 会安静地拿到空字符串——「构建成功但整站没有 JS」就是这么来的，
 * 因此这里显式区分两种类型，取不到内容直接报错。
 */
function chunkText(item, label) {
  const value = item?.type === 'chunk' ? item.code : item?.source
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('utf8')
  throw new Error(`[single-html] ${label} 内容为空或类型未知，无法内联`)
}

function asText(value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('utf8')
  return ''
}

/**
 * 把 JS 变成「能安全放进 <script> 原始文本」的形态。
 *
 * 两种序列都必须破坏（Markdown 正文会原样进包，所以这不是理论问题）：
 *   - `</script`：浏览器立刻闭合脚本，后面的代码变成正文 → 白屏；
 *   - `<!--`：让脚本进入 HTML 的 escaped 状态，此后的 `</script>` 不再被认作闭合标记。
 * 统一用「插入反斜杠」破坏：字符串里它等价于原字符，出现在注释里也无害。
 */
function escapeScriptClose(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\u0021--')
}

/** 转义是否彻底（返回问题列表，空即安全） */
function scriptSafetyIssues(code) {
  const issues = []
  if (/<\/script/i.test(code)) issues.push('残留 </script')
  if (/<!--/.test(code)) issues.push('残留 <!--，会让浏览器进入 escaped 状态而吃掉闭合标签')
  return issues
}

/** 内联 <style> 里的 `</style` 同理 */
function escapeStyleClose(css) {
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

function assert(condition, message) {
  if (!condition) throw new Error(`[single-html] ${message}`)
}

/**
 * @param {object} [options]
 * @param {string} [options.root]  项目根目录（解析 public/ 下的资源用）
 * @param {number} [options.maxBytes] 成品体积上限，超过直接失败
 * @param {(msg: string) => void} [options.warn]
 * @param {string[]} [options.publicLinks] 需要从 public/ 内联的 HTML 引用（默认 favicon）
 */
export function singleHtmlPlugin(options = {}) {
  const root = options.root ?? process.cwd()
  const maxBytes = options.maxBytes ?? 48 * 1024 * 1024
  const warn = options.warn ?? ((message) => console.warn(`[single-html] ${message}`))

  /** 需要在 index.html 阶段就地内联的 public 资源（Vite 不会把它们当作构建产物） */
  const inlinePublicLinks = async (html) => {
    let out = html
    // <link rel="icon" ... href="%BASE_URL%favicon-venti.png" />
    const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi
    const matches = [...out.matchAll(linkRe)]
    for (const match of matches) {
      const [tag, href] = match
      const attrs = match[0]
      if (!/rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon|mask-icon)["']/i.test(attrs)) continue
      if (/^(https?:|data:|\/\/)/i.test(href)) continue
      const relative = href.replace(/^\.?\//, '').replace(/^%BASE_URL%\/?/, '')
      const file = resolve(root, 'public', basename(relative))
      if (!existsSync(file)) {
        // 离线文件里出现一个必然 404 的引用就是 bug，不能悄悄丢掉
        if (/favicon/i.test(href)) {
          warn(`找不到 ${relative}，已移除该 <link>（浏览器会退回默认 favicon）`)
          out = out.replace(tag, '')
          continue
        }
        throw new Error(`HTML 里引用了 ${href}，但在 public/ 下找不到对应文件，无法内联`)
      }
      const dataUri = toDataUri(readFileSync(file), file)
      out = out.replace(tag, () => tag.replace(href, () => dataUri))
    }
    // 离线版没有服务器可用：manifest / 预连接 / 外部脚本一律清掉（保留会在 file:// 下报错）
    out = out
      .replace(/<link\b[^>]*\brel\s*=\s*["']manifest["'][^>]*>\s*/gi, '')
      .replace(/<link\b[^>]*\brel\s*=\s*["'](?:preconnect|dns-prefetch|modulepreload)["'][^>]*>\s*/gi, '')
    return out
  }

  return {
    name: 'starlog:single-html',
    apply: 'build',
    enforce: 'post',

    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return inlinePublicLinks(html)
      },
    },

    generateBundle(_options, bundle) {
      const htmlKeys = Object.keys(bundle).filter((key) => key.endsWith('.html'))
      assert(htmlKeys.length === 1, `期望只有 1 个 HTML，实际 ${htmlKeys.length} 个`)
      const htmlKey = htmlKeys[0]
      let html = asText(bundle[htmlKey].source)

      const jsKeys = Object.keys(bundle).filter((key) => key.endsWith('.js'))
      assert(jsKeys.length === 1, `期望只有 1 个 JS chunk（检查 inlineDynamicImports），实际：${jsKeys.join(', ')}`)
      const cssKeys = Object.keys(bundle).filter((key) => key.endsWith('.css'))
      assert(cssKeys.length <= 1, `期望最多 1 个 CSS，实际：${cssKeys.join(', ')}`)

      let js = chunkText(bundle[jsKeys[0]], `JS chunk ${jsKeys[0]}`)
      let css = cssKeys.length > 0 ? chunkText(bundle[cssKeys[0]], `CSS ${cssKeys[0]}`) : ''
      assert(js.length > 1000, `内联的 JS 只有 ${js.length} 字节，明显不完整`)

      // ---------- 1) 把仍然独立发出的资源转成 data URI，并替换所有引用 ----------
      const otherKeys = Object.keys(bundle).filter(
        (key) => !key.endsWith('.html') && !key.endsWith('.js') && !key.endsWith('.css'),
      )
      let inlinedAssets = 0
      for (const key of otherKeys) {
        const asset = bundle[key]
        if (asset.type !== 'asset') {
          // 未被内联的 chunk 说明代码分割没关掉
          throw new Error(`产物里出现了额外的 chunk「${key}」，无法内联（请检查 rollupOptions.output.inlineDynamicImports）`)
        }
        const buffer = assetSource(asset)
        assert(buffer, `资源「${key}」没有可读取的内容，无法内联`)
        const dataUri = toDataUri(buffer, key)
        const name = basename(key)
        let replaced = 0
        for (const [label, code] of [
          ['js', js],
          ['css', css],
          ['html', html],
        ]) {
          if (!code.includes(name)) continue
          const next = code.split(name).join(dataUri)
          replaced += code.split(name).length - 1
          if (label === 'js') js = next
          else if (label === 'css') css = next
          else html = next
        }
        if (replaced === 0) warn(`资源 ${key} 内联后没有任何引用命中，可能是多余产物`)
        delete bundle[key]
        inlinedAssets += 1
      }

      // ---------- 2) 内联样式与脚本 ----------
      assert(css.length > 0, '构建没有产出 CSS：样式（含 KaTeX 与代码高亮）全部缺失')
      assert(css.includes('.katex'), 'KaTeX 样式没有进入最终 CSS，公式排版会失效（检查 index.css 的 @import）')
      assert(css.includes('hljs-'), 'highlight.js 主题样式没有进入最终 CSS，代码高亮会失色')
      assert(css.includes('@font-face'), 'CSS 里没有 @font-face：KaTeX 字体缺失，公式会退化成形同纯文本的排版')
      for (const name of [/url\(\s*["']?\.\/?assets\//i, /url\(\s*["']?\/?assets\//i]) {
        assert(!name.test(css), `CSS 里仍有指向 ./assets/ 的引用，离线打开会缺字体：${css.match(name)?.[0]}`)
      }
      const urlInCss = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
        .map((match) => match[1])
        .filter((url) => !url.startsWith('data:') && !url.startsWith('#'))
      assert(urlInCss.length === 0, `CSS 里仍有未内联的 url()：${urlInCss.slice(0, 3).join(', ')}`)

      if (css) html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>\s*/gi, '')
      const styleTag = css ? `<style data-starlog-inline="css">${escapeStyleClose(css)}</style>` : ''
      // ⚠️ 必须用「函数」形式做替换：代码里只要出现 $& $` $' 这些序列，
      // 字符串形式的替换参数会把它们当成替换模式展开（$& = 命中文本，$` = 命中点之前的整段 HTML），
      // 结果是产物「构建成功但语法被破坏」。这里踩过，别改回去。
      html = html.includes('</head>')
        ? html.replace('</head>', () => `${styleTag}\n  </head>`)
        : `${styleTag}${html}`

      // 去掉 <script type="module" src="..."> 后把代码内联为普通脚本（file:// 下 module 会被 CORS 拦）
      html = html.replace(/<script\b[^>]*\bsrc=["'][^"']+\.js["'][^>]*>\s*<\/script>/gi, '')
      const safeJs = escapeScriptClose(js)
      const scriptTag = `<script data-starlog-inline="js">\n${safeJs}\n</script>`
      html = html.includes('</body>')
        ? html.replace('</body>', () => `${scriptTag}\n  </body>`)
        : `${html}${scriptTag}`

      // ---------- 3) 收尾自检 ----------
      const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)].map((match) => match[1])
      const broken = refs.filter(
        (url) =>
          !url.startsWith('data:') &&
          !url.startsWith('#') &&
          !/^(mailto:|tel:)/i.test(url) &&
          !/^(https?:)?\/\//i.test(url),
      )
      assert(
        broken.length === 0,
        `最终 HTML 里仍有指向文件的相对引用，离线打开必然 404：${broken.slice(0, 5).join(', ')}`,
      )
      const external = refs.filter((url) => /^(https?:)?\/\//i.test(url))
      if (external.length > 0) {
        warn(`HTML 外壳里保留了 ${external.length} 条外部地址（不影响离线使用）：${external.slice(0, 3).join(', ')}`)
      }
      assert(
        !/<script\b[^>]*\btype=["']module["']/i.test(html),
        '最终 HTML 里还有 type="module" 的脚本，file:// 下会被 CORS 拦截',
      )
      // 内联代码的转义必须彻底。注意不能靠「数标签」判断：
      // 文章正文里合法出现的 <script> 字符串会让计数对不上，而它其实不影响解析。
      const jsIssues = scriptSafetyIssues(safeJs)
      assert(
        jsIssues.length === 0,
        `内联 JS 转义不彻底：${jsIssues.join('；')}（需要在 escapeScriptClose() 里补替换规则）`,
      )

      // 最后一道保险：内联脚本必须真的是一段合法 JS（上面那类破坏只能在这里才被看出来）
      try {
        new vm.Script(safeJs, { filename: 'starlog-offline-inline.js' })
      } catch (error) {
        throw new Error(`[single-html] 内联脚本语法校验失败：${error.message}`)
      }

      const bytes = Buffer.byteLength(html, 'utf8')
      assert(
        bytes <= maxBytes,
        `离线单文件体积 ${formatSize(bytes)} 超过上限 ${formatSize(maxBytes)}，请精简内置内容或调高上限`,
      )

      // 内容已经进了 index.html，这两个 chunk 本身不能再发出（否则产物不止一个文件）
      delete bundle[jsKeys[0]]
      for (const key of cssKeys) delete bundle[key]

      bundle[htmlKey] = { type: 'asset', fileName: htmlKey, source: html }
      const leftovers = Object.keys(bundle).filter((key) => key !== htmlKey)
      assert(
        leftovers.length === 0,
        `产物目录里还有多余文件（离线版只应有一个 HTML）：${leftovers.slice(0, 5).join(', ')}`,
      )
      console.log(
        `[single-html] 已内联 1 个 JS、${cssKeys.length} 个 CSS 与 ${inlinedAssets} 个资源，成品 ${formatSize(bytes)}`,
      )
      // 供 vite.offline.config.ts 在 closeBundle 阶段做体积播报
      this.__starlogSingleHtml = { bytes, inlinedAssets, jsBytes: Buffer.byteLength(js, 'utf8'), cssBytes: Buffer.byteLength(css, 'utf8') }
    },
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
