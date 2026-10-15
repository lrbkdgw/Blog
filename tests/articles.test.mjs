import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let vite
let posts
let markdown

before(async () => {
  vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  posts = await vite.ssrLoadModule('/src/lib/posts.ts')
  markdown = await vite.ssrLoadModule('/src/components/Markdown.tsx')
})

after(async () => {
  await vite?.close()
})

test('本地同名草稿不覆盖已发布文章，也不会让新草稿出现在公开列表', () => {
  const saved = globalThis.localStorage
  const originals = posts.getPublishedPosts()
  const published = originals.find((post) => !post.encryption)
  assert.ok(published)
  const drafts = [
    { slug: published.slug, raw: `---\ntitle: "尚未发布的修改"\ndraft: true\n---\n\n草稿正文`, savedAt: 1 },
    { slug: 'not-published', raw: `---\ntitle: "本地新文章"\n---\n\n尚未发布`, savedAt: 2 },
  ]
  globalThis.localStorage = { getItem: (key) => key === 'starlog:drafts' ? JSON.stringify(drafts) : null }
  try {
    assert.equal(posts.getPostBySlug(published.slug, 'local').title, '尚未发布的修改')
    assert.equal(posts.getReadablePost(published.slug, false, true).title, published.title)
    assert.equal(posts.getReadablePost(published.slug, true, false).title, published.title)
    assert.equal(posts.getReadablePost(published.slug, true, true).title, '尚未发布的修改')
    assert.equal(posts.getReadablePost('not-published', false, true), undefined)
    assert.equal(posts.getReadablePost('not-published', true, false), undefined)
    assert.equal(posts.getReadablePost('not-published', true, true).title, '本地新文章')
    assert.deepEqual(posts.getPublishedPosts().map(({ slug }) => slug), originals.map(({ slug }) => slug))
    assert.equal(posts.getPublishedPosts().find(({ slug }) => slug === published.slug).content, published.content)
    assert.equal(posts.getPublishedPosts().some(({ slug }) => slug === 'not-published'), false)
  } finally {
    if (saved === undefined) delete globalThis.localStorage
    else globalThis.localStorage = saved
  }
})

test('不匹配的代码围栏不会提前结束，并且围栏内的扩展指令保持原文', () => {
  const source = '````md\n~~~\n:::info[example]\n## hidden\n:::\n```\n## still hidden\n````\n## shown'
  const result = markdown.preprocessMarkdownDetailed(source)
  assert.equal(result.text, source)
  assert.deepEqual(result.lineMap, source.split('\n').map((_, index) => index))
  assert.deepEqual(posts.extractToc(source).map(({ text }) => text), ['shown'])
  const html = renderToStaticMarkup(createElement(markdown.Markdown, { content: source }))
  assert.equal((html.match(/<pre\b/g) || []).length, 1)
  assert.equal(html.includes('class="callout callout-info"'), false)
  assert.equal(html.includes('still hidden'), true)
  assert.equal(html.includes('id="shown"'), true)
})

test('重复标题和带数字后缀的标题在目录中使用与页面相同的锚点', () => {
  const source = '## section\n## section\n## section-1\n## section'
  const ids = posts.extractToc(source).map(({ id }) => id)
  assert.deepEqual(ids, ['section', 'section-1', 'section-1-1', 'section-2'])
  const html = renderToStaticMarkup(createElement(markdown.Markdown, { content: source }))
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`))
})

test('折叠框标题中的 HTML 特殊字符按文本显示', () => {
  const html = renderToStaticMarkup(createElement(markdown.Markdown, {
    content: ':::info[A <img src=x onerror=alert(1)> B]\n内容\n:::',
  }))
  assert.match(html, /A &lt;img src=x onerror=alert\(1\)&gt; B/)
  assert.equal(html.includes('<img'), false)
  assert.match(html, /内容/)
})

test('仓库中每篇非加密文章都能渲染正文，展示框、公式和长文正常加载', () => {
  const articles = posts.getRepoPosts().filter((post) => !post.encryption)
  assert.ok(articles.length >= 5)
  for (const article of articles) {
    const html = renderToStaticMarkup(createElement(markdown.Markdown, { content: article.content }))
    assert.ok(html.length > 500, `${article.slug} should render content`)
    assert.match(html, /<div class="prose /)
  }
  const syntax = articles.find((post) => post.title.startsWith('Markdown&'))
  assert.ok(syntax)
  const html = renderToStaticMarkup(createElement(markdown.Markdown, { content: syntax.content }))
  assert.match(html, /class="show-box /)
  assert.match(html, /class="katex/)
  assert.match(html, /class="callout callout-info"/)
})
