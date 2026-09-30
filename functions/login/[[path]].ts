/**
 * Cloudflare Pages Function：GitHub OAuth Device Flow 同源中转
 *
 * 仅当站点部署在 Cloudflare Pages 时生效：
 *   前端 POST /login/device/code 与 /login/oauth/access_token 会被本函数
 *   转发到 github.com 并返回 JSON 结果。与页面同源，天然不涉及 CORS，
 *   因此此时无需单独部署 oauth-relay/ Worker，relayUrl 留空即可。
 *
 * 其余请求（如浏览器 GET /login 打开登录页）一律放行给静态站点（context.next()）。
 *
 * 安全说明与 oauth-relay/worker.js 相同：路径/方法白名单、请求体大小限制，
 * Device Flow 无需 client_secret，本函数不持有任何机密。
 *
 * 注：本文件不在 tsc --noEmit 检查范围内（由 Cloudflare 构建时打包），
 *     因此使用就地最小类型定义，不依赖 @cloudflare/workers-types。
 */

const TARGET_HOST = 'https://github.com'

const ALLOWED_PATHS = new Set(['/login/device/code', '/login/oauth/access_token'])

const MAX_BODY_BYTES = 4096

interface NextableContext {
  request: Request
  next: () => Promise<Response>
}

function json(data: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export const onRequest = async (context: NextableContext): Promise<Response> => {
  const { request, next } = context
  const url = new URL(request.url)

  // 不是 OAuth 中转请求 → 交给静态站点（SPA 路由、静态资源、_redirects）
  if (request.method !== 'POST' || !ALLOWED_PATHS.has(url.pathname)) {
    return next()
  }

  let body: string
  try {
    body = await request.text()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (body.length > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413)
  }

  let upstream: Response
  try {
    upstream = await fetch(TARGET_HOST + url.pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'starlog-oauth-relay',
      },
      body,
    })
  } catch {
    return json({ error: 'upstream_unreachable' }, 502)
  }

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
