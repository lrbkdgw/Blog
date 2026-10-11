/** 将博客的同一份组件、依赖与 Tailwind 样式打包成离线可安装的 VS Code 扩展。 */
import { build, context } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const blogRoot = resolve(root, '../..')
const requireBlog = createRequire(join(blogRoot, 'package.json'))
const postcss = requireBlog('postcss')
const tailwindcss = requireBlog('tailwindcss')
const loadConfig = requireBlog('tailwindcss/loadConfig')
const autoprefixer = requireBlog('autoprefixer')
const watch = process.argv.includes('--watch')
const { version, displayName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const licenses = new Map()

/** 不让 Tailwind preflight/正文样式污染 VS Code 的工具栏；根变量与页面外壳保留。 */
const scopedRules = new WeakSet()
const scopeStyles = {
  postcssPlugin: 'markdown-extension-scope',
  Rule(rule) {
    if (scopedRules.has(rule)) return
    scopedRules.add(rule)
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    rule.selectors = rule.selectors.map((selector) => {
      if ([':root', 'html', 'body', '.dark', '.dark body'].includes(selector)) return selector
      if (selector.startsWith('.dark ')) return `.dark .markdown-extension-preview ${selector.slice(6)}`
      return `.markdown-extension-preview ${selector}`
    })
  },
}

const blogStyles = {
  name: 'blog-styles',
  setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      // 外壳也从博客主题解析 @apply，但不加正文命名空间。
      const adapter = path === join(root, 'media/preview.css')
      const plugins = []
      const watchFiles = []
      if (adapter || path === join(blogRoot, 'src/styles/index.css')) {
        const configFile = join(blogRoot, 'tailwind.config.js')
        const config = loadConfig(configFile)
        config.content = config.content.map((pattern) => resolve(blogRoot, pattern))
        plugins.push(tailwindcss(config), autoprefixer)
        watchFiles.push(configFile)
      }
      if (!adapter) plugins.push(scopeStyles)
      const { css } = await postcss(plugins).process(readFileSync(path, 'utf8'), { from: path })
      return { contents: css, loader: 'css', resolveDir: dirname(path), watchFiles }
    })
  },
}

/** 保留所有实际打包依赖的版权/许可（包括 KaTeX 字体），不把 node_modules 塞进 VSIX。 */
const licenseNotices = {
  name: 'third-party-notices',
  setup(builder) {
    builder.onEnd((result) => {
      if (!result.metafile) return
      for (const input of Object.keys(result.metafile.inputs)) {
        const path = resolve(root, input).replace(/\\/g, '/')
        const packageDir = path.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/)?.[1]
        if (!packageDir || licenses.has(packageDir)) continue
        let info
        try { info = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) } catch { continue }
        for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
          try {
            licenses.set(packageDir, `${info.name} ${info.version}\n${readFileSync(join(packageDir, filename), 'utf8').split('\n').map((line) => line.trimEnd()).join('\n').trim()}`)
            break
          } catch { /* 尝试下一个许可证文件名。 */ }
        }
      }
      mkdirSync(join(root, 'resources'), { recursive: true })
      writeFileSync(join(root, 'resources/third-party-notices.txt'),
        [...licenses.values()].sort().join('\n\n' + '='.repeat(72) + '\n\n') + '\n')
    })
  },
}

const common = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  sourcemap: false,
  metafile: true,
  target: ['es2020'],
  // 避免生成包含行尾空白的多行模板字面量，构建产物也可通过 diff --check。
  supported: { 'template-literal': false },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
}

function buildMpeStyle() {
  const css = readFileSync(join(root, 'media/mpe.css'), 'utf8')
  const body = css.split('\n').map((line) => line ? '  ' + line : '').join('\n')
  mkdirSync(join(root, 'resources/mpe'), { recursive: true })
  writeFileSync(join(root, 'resources/mpe/style.less'),
    `// starlog-markdown:style v${version}\n// ${displayName}：MPE 静态兼容样式，完整同款效果请使用内置预览。\n.markdown-preview.markdown-preview {\n${body}\n}\n`)
}

const mpeOutput = {
  name: 'mpe-single-expression',
  setup(builder) {
    builder.onLoad({ filter: /parserEntry\.ts$/ }, ({ path }) => ({
      contents: readFileSync(path, 'utf8'),
      loader: 'ts',
      watchFiles: [join(root, 'package.json'), join(root, 'media/mpe.css')],
    }))
    builder.onEnd((result) => {
      if (result.errors.length || !result.outputFiles) return
      const code = result.outputFiles[0].text
      // Crossnote 在 QuickJS 沙箱中用 (parser.js) 求值：产物必须是单表达式。
      const wrapped = `/* starlog-markdown:parser v${version} — ${displayName}，MPE 静态兼容模式。 */\n(function () {\nvar module = { exports: {} };\nvar exports = module.exports;\n${code}\nvar api = module.exports.default || module.exports;\nreturn { onWillParseMarkdown: api.onWillParseMarkdown, onDidParseMarkdown: api.onDidParseMarkdown };\n})()\n`
      mkdirSync(join(root, 'resources/mpe'), { recursive: true })
      writeFileSync(join(root, 'resources/mpe/parser.js'), wrapped)
      buildMpeStyle()
    })
  },
}

const targets = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    loader: { '.css': 'empty' },
    plugins: [licenseNotices],
  },
  {
    ...common,
    entryPoints: ['src/preview/preview.tsx'],
    outfile: 'out/preview.js',
    platform: 'browser',
    format: 'iife',
    assetNames: 'fonts/[name]',
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    plugins: [blogStyles, licenseNotices],
  },
  {
    ...common,
    entryPoints: ['src/mpe/parserEntry.ts'],
    outfile: 'resources/mpe/parser.js',
    write: false,
    platform: 'neutral',
    format: 'cjs',
    plugins: [mpeOutput, licenseNotices],
  },
]

if (watch) {
  for (const options of targets) {
    const ctx = await context(options)
    await ctx.watch()
  }
  console.log(`[${displayName}] 正在监听博客组件、样式与扩展源码…`)
} else {
  for (const options of targets) await build(options)
  console.log(`[${displayName}] 构建完成`)
}
