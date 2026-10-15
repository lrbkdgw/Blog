import { createServer } from 'vite'
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } })
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
try {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  globalThis.window = { dispatchEvent() {}, addEventListener() {} }
  globalThis.CustomEvent = class { constructor(t) { this.type = t } }
  store.set('starlog:gh-token', 'tok')
  const mode = process.env.MODE || 'normal'
  const log = []
  let forkTries = 0
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url).replace('https://api.github.com', '')
    const m = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    log.push({ m, u, body })
    if (u === '/user') return json({ login: 'alice', avatar_url: '' })
    if (u === '/repos/lrbkdgw/Blog' && m === 'GET') return json({ permissions: { push: false, admin: false } })
    if (u === '/repos/lrbkdgw/Blog/forks') return json({}, 202)
    if (u === '/repos/lrbkdgw/Blog/git/ref/heads/main') return json({ object: { sha: 'base' } })
    if (u === '/repos/alice/Blog/git/refs' && m === 'POST') {
      forkTries += 1
      if (forkTries < 3) return json({ message: 'Not Found' }, 404)
      return json({ ref: body.ref }, 201)
    }
    if (u.startsWith('/repos/lrbkdgw/Blog/contents/content/posts/post-x.md') && m === 'GET') return json({ sha: 'oldsha' })
    if (u.startsWith('/repos/alice/Blog/contents/content/posts/post-x.md') && m === 'PUT') return json({ commit: {} })
    if (u.startsWith('/repos/lrbkdgw/Blog/contents/content/posts/old-slug.md') && m === 'GET') return json({ sha: 'delsha' })
    if (u.startsWith('/repos/alice/Blog/contents/content/posts/old-slug.md') && m === 'DELETE') return json({ commit: {} })
    if (u === '/repos/lrbkdgw/Blog/pulls' && m === 'POST') {
      if (mode === 'prfail') return json({ message: 'Validation Failed' }, 422)
      return json({ number: 7, html_url: 'https://github.com/lrbkdgw/Blog/pull/7', title: 't', state: 'open', created_at: '', updated_at: '', user: { login: 'alice', avatar_url: '' } }, 201)
    }
    if (u.startsWith('/repos/alice/Blog/git/refs/heads/') && m === 'DELETE') return json({}, 204)
    return json({ message: 'unexpected ' + m + ' ' + u }, 500)
  }
  const gh = await server.ssrLoadModule('/src/lib/github.ts')
  try {
    const pr = await gh.submitPublicationPR('post-x', '# new', 'X', undefined, { deleteSlug: 'old-slug' })
    console.log('PR number:', pr.number)
  } catch (e) { console.log('PR error:', e.message) }
  console.log('fork ref attempts:', forkTries)
  for (const c of log.filter((c) => c.m !== 'GET' || c.u.includes('contents'))) {
    console.log(c.m, c.u.replace(/\?ref=.*/, ''), c.body ? JSON.stringify({ sha: c.body.sha, branch: c.body.branch, hasContent: !!c.body.content }) : '')
  }
  console.log('cleanup branch called:', log.some((c) => c.m === 'DELETE' && c.u.includes('/git/refs/heads/')))
} catch (e) { console.log('ERROR', e.stack?.slice(0, 900)) } finally { await server.close() }
