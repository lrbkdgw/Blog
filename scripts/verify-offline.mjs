/**
 * 离线单文件版的构建后自检：`npm run verify:offline`（`npm run build:offline` 会自动执行）。
 *
 * 为什么单独写一个脚本：离线版最容易出的事故是「构建绿了，但文件不可用」——
 * 少一个字体、漏一篇文章、残留一条要联网的引用，浏览器里都只是安静地坏掉。
 * 这里把这些问题全部变成**构建失败**，并给出可操作的说明。
 *
 * 检查项：
 *   1. dist-offline/ 里只有一个 index.html（多余产物 = 离线打开必然缺文件）；
 *   2. 体积在合理区间（过大 / 过小都直接失败，过小通常意味着内容根本没打进去）；
 *   3. HTML 里不存在任何指向文件的相对引用（data: / # / http(s) 之外都算残留）；
 *   4. 内联脚本必须是普通脚本（file:// 下 type="module" 会被 CORS 拦截）、且 `</script>` 已转义；
 *   5. KaTeX 与 highlight.js 的样式、KaTeX 字体（data: URI）都在文件里；
 *   6. content/posts/ 下每一篇 .md 的标题都确实进了这个文件（防「文章静默丢失」）；
 *   7. 离线文章库 / 存储层的关键字符串在产物里可见。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'dist-offline')
const htmlPath = join(outDir, 'index.html')
const MAX_BYTES = 48 * 1024 * 1024
const MIN_BYTES = 1024 * 1024

const failures = []
const warnings = []
const notes = []

const fail = (message) => failures.push(message)
const warn = (message) => warnings.push(message)
const note = (message) => notes.push(message)

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

if (!existsSync(htmlPath)) {
  console.error(
    `❌ 找不到 ${htmlPath}\n   请先执行 npm run build:offline（vite build --config vite.offline.config.ts）。`,
  )
  process.exit(1)
}

const html = readFileSync(htmlPath, 'utf8')
const bytes = statSync(htmlPath).size

/* --------------------------- 1) 目录里只能有一个文件 -------------------------- */

const extra = readdirSync(outDir).filter((name) => name !== 'index.html')
if (extra.length > 0) {
  fail(`dist-offline/ 里有多余文件：${extra.slice(0, 8).join(', ')} —— 单文件版必须自带全部内容`)
}

/* -------------------------------- 2) 体积区间 -------------------------------- */

if (bytes > MAX_BYTES) fail(`体积 ${formatSize(bytes)} 超过上限 ${formatSize(MAX_BYTES)}`)
if (bytes < MIN_BYTES) {
  fail(`体积只有 ${formatSize(bytes)}（下限 ${formatSize(MIN_BYTES)}）—— 很可能样式或文章没打进文件`)
}

/* ----------------------------- 3) 相对引用是否清干净 ---------------------------- */

const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)].map((match) => match[1])
const broken = refs.filter(
  (url) =>
    !url.startsWith('data:') &&
    !url.startsWith('#') &&
    !/^(https?:)?\/\//i.test(url) &&
    !/^(mailto:|tel:)/i.test(url),
)
if (broken.length > 0) {
  fail(`HTML 里仍有指向文件的相对引用（离线打开必然 404）：${broken.slice(0, 6).join(', ')}`)
}
const external = refs.filter((url) => /^(https?:)?\/\//i.test(url))
if (external.length > 0) {
  warn(`HTML 外壳保留了 ${external.length} 条绝对地址（联网时才可用）：${external.slice(0, 4).join(', ')}`)
}

/* ------------------------------- 4) 内联脚本形态 ------------------------------ */

const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
if (scriptTags.some((tag) => /type\s*=\s*["']module["']/i.test(tag))) {
  fail('存在 type="module" 的内联脚本：file:// 下模块脚本会被 CORS 拦截，离线版必须用 iife')
}
// 不能数标签：文章正文里的 `<script>` 字符串是合法内容。真正致命的只有两种序列，
// 它们出现在内联脚本体里就说明转义漏了（浏览器会提前闭合或吃掉闭合标签 → 白屏）。
const inlinedJs = html.match(/<script\b[^>]*data-starlog-inline="js"[^>]*>([\s\S]*?)<\/script\s*>/i)?.[1] ?? ''
if (!inlinedJs) {
  fail('取不到内联脚本内容，无法判断是否可执行')
} else {
  if (/<\/script/i.test(inlinedJs)) fail('内联脚本里残留未转义的 </script，浏览器会提前闭合脚本导致白屏')
  if (/<!--/.test(inlinedJs)) fail('内联脚本里残留 <!--，HTML 会进入 escaped 状态并吃掉闭合标签')
  if (inlinedJs.length < 100_000) fail(`内联脚本只有 ${inlinedJs.length} 字节，明显不完整（应用代码没打进来？）`)
  // 真正按 JS 语法解析一遍：产物「能构建但不能执行」的问题只有这里能抓到
  try {
    new vm.Script(inlinedJs, { filename: 'starlog-offline-inline.js' })
  } catch (error) {
    fail(`内联脚本语法错误，浏览器不会执行它：${error.message}`)
  }
}
if (!/data-starlog-inline="js"/.test(html)) fail('没有看到被内联的 JS（data-starlog-inline="js"）')
if (!/data-starlog-inline="css"/.test(html)) fail('没有看到被内联的 CSS（data-starlog-inline="css"）')

/* ---------------------------- 5) 排版能力：公式与高亮 --------------------------- */

const styleMatch = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)
const css = styleMatch ? styleMatch[1] : ''
if (!css) fail('没有内联样式，页面会完全没有排版')
if (!css.includes('.katex')) fail('CSS 中缺少 .katex 规则：KaTeX 公式会退化成纯文本样式')
const fontFaces = css.match(/@font-face/g) ?? []
if (fontFaces.length < 10) {
  fail(`@font-face 只有 ${fontFaces.length} 条（KaTeX 需要约 20+ 条）：公式字形会缺失`)
}
const nonDataUrls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
  .map((match) => match[1])
  .filter((url) => !url.startsWith('data:') && !url.startsWith('#'))
if (nonDataUrls.length > 0) {
  fail(`CSS 里仍有未内联的 url()：${nonDataUrls.slice(0, 6).join(', ')}`)
}
if (!css.includes('hljs-')) fail('CSS 中缺少 hljs-* 规则：代码高亮不会有任何配色')

/* ------------------------------- 6) 文章是否都在 ------------------------------ */

const postsDir = join(root, 'content', 'posts')
const markdownFiles = existsSync(postsDir)
  ? readdirSync(postsDir).filter((name) => extname(name).toLowerCase() === '.md')
  : []
if (markdownFiles.length === 0) {
  fail('content/posts/ 下一篇文章也没有，离线版将只剩空壳')
} else {
  const missing = []
  for (const file of markdownFiles) {
    const raw = readFileSync(join(postsDir, file), 'utf8')
    const title = raw.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
    const slug = file.replace(/\.md$/i, '')
    const hasSlug = html.includes(`/content/posts/${file}`) || html.includes(`content/posts/${file}`)
    const hasTitle = title ? html.includes(title) : false
    if (!hasSlug && !hasTitle) missing.push(`${slug}${title ? `（${title}）` : ''}`)
  }
  if (missing.length > 0) {
    fail(`有 ${missing.length} 篇内置文章没有进离线文件：${missing.slice(0, 6).join('、')}`)
  } else if (markdownFiles.length > 0) {
    note(`${markdownFiles.length} 篇内置文章全部在文件里`)
  }
}

/* --------------------- 8) 离线版不得包含互联网端点 -------------------------- */

// 这些字符串一旦被打包进来，就说明某处在线能力没被离线开关切断。
// 做法上依赖两点：`vite.offline.config.ts` 的 define 把 __STARLOG_OFFLINE__ 换成 true，
// 以及 config / github / font 里「端点常量在 OFFLINE 下取空串」的写法，让压缩器有东西可删。
const FORBIDDEN = [
  ['GitHub API 端点', 'api.github.com'],
  ['GitHub GraphQL', '/graphql'],
  ['一言 API（hitokoto）', 'hitokoto.cn'],
  ['OAuth Device Flow', 'login/device/code'],
  ['OAuth 令牌交换', 'login/oauth/access_token'],
  ['云端字体（Google Fonts）', 'fonts.googleapis.com'],
  ['云端字体资源域名', 'fonts.gstatic.com'],
  ['OAuth App Client ID', 'Ov23lid9P8sdNuiKhkzy'],
]
const found = FORBIDDEN.filter(([, needle]) => html.includes(needle))
if (found.length > 0) {
  fail(
    `离线产物里出现了在线端点：${found.map(([label]) => label).join('、')}。` +
      '离线版按设计不访问互联网——请把对应调用放进 if (OFFLINE) 提前返回之后，' +
      '或像 config.ts / github.ts 那样把端点常量写成 OFFLINE ? \'\' : \'https://…\'。',
  )
}
for (const [label, needle] of [
  ['离线存储层', 'starlog:drafts'],
  ['离线文章库', 'starlog:offline-hidden'],
  ['离线能力标记', '离线版'],
  ['局域网协作连接码', 'STARLOG-LAN1.'],
  ['WebRTC 点对点能力', 'RTCPeerConnection'],
]) {
  if (!html.includes(needle)) fail(`产物里找不到「${label}」相关标记（${needle}），离线功能可能没被打包`)
}

// issue #112：协作只允许手动信令 + 局域网 WebRTC 直连，不能借离线版之名引入互联网中继。
const lanSource = readFileSync(join(root, 'src/components/LanCollaboration.tsx'), 'utf8')
if (!lanSource.includes('new RTCPeerConnection({ iceServers: [] })')) {
  fail('局域网协作必须显式使用空 iceServers，禁止默认或外部 STUN / TURN 服务')
}
if (/\b(?:stun|turn):/i.test(lanSource)) {
  fail('局域网协作源码出现 STUN / TURN 地址；离线版只允许手动交换连接码后的点对点直连')
}

/* --------------------------------- 汇报结果 --------------------------------- */

const jsMatch = html.match(/<script\b[^>]*data-starlog-inline="js"[^>]*>([\s\S]*?)<\/script>/i)
const breakdown = [
  ['总体积', formatSize(bytes)],
  ['内联 CSS', formatSize(Buffer.byteLength(css, 'utf8'))],
  ['内联 JS', formatSize(Buffer.byteLength(jsMatch ? jsMatch[1] : '', 'utf8'))],
  [
    'data: 内联资源',
    `${formatSize(
      (html.match(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi) ?? []).reduce((sum, item) => sum + item.length, 0),
    )}（${(html.match(/data:[a-z/+.-]+;base64,/gi) ?? []).length} 个）`,
  ],
  ['@font-face', String(fontFaces.length)],
  ['内置文章', String(markdownFiles.length)],
]

console.log('\n离线单文件自检')
console.log('─'.repeat(58))
for (const [label, value] of breakdown) console.log(`${label.padEnd(12, ' ')}${value}`)
console.log('─'.repeat(58))
for (const item of notes) console.log(`ℹ️  ${item}`)
for (const item of warnings) console.log(`⚠️  ${item}`)
for (const item of failures) console.log(`❌ ${item}`)

if (failures.length > 0) {
  console.error(`\n构建自检未通过：${failures.length} 项硬性检查失败。请修复后重新执行 npm run build:offline。`)
  process.exit(1)
}
console.log(`\n✅ 自检通过：${formatSize(bytes)} 的单文件可离线使用（建议 < 25MB；> ${formatSize(MAX_BYTES)} 会被拒绝）\n`)
