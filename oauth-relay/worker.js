/**
 * Starlog OAuth Relay —— GitHub OAuth (Device Flow) 极简 CORS 中转
 *
 * 为什么需要它：
 *   GitHub 的 OAuth 端点位于 https://github.com/login/*，它们不返回
 *   Access-Control-Allow-Origin，浏览器（纯静态站点）无法跨域读取响应。
 *   这个 Worker 只做一件事：把下面两个端点的 POST 请求转发给 github.com，
 *   并给响应补上 CORS 头。
 *
 *     POST /login/device/code          （申请设备验证码）
 *     POST /login/oauth/access_token   （轮询换取 access token）
 *
 * 安全性说明：
 *   Device Flow（RFC 8628）不需要 client_secret，本中转不持有任何机密；
 *   路径与方法有严格白名单，且透传 body 有大小限制，无法被当成通用代理滥用。
 *   如需进一步限制，可配置环境变量 ALLOWED_ORIGIN（例如 https://<user>.github.io）。
 *
 * 部署：
 *   见 oauth-relay/README.md（Cloudflare Workers 免费额度足够）。
 */

const TARGET_HOST = 'https://github.com'

/** 只允许转发这两条路径 */
const ALLOWED_PATHS = new Set(['/login/device/code', '/login/oauth/access_token'])

/** 防止被当成大文件代理，OAuth 请求体通常只有几百字节 */
const MAX_BODY_BYTES = 4096

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export default {
  async fetch(request, env) {
    const allowedOrigin = (env && env.ALLOWED_ORIGIN) || '*'
    const cors = corsHeaders(allowedOrigin)

    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(request.url)

    if (request.method !== 'POST' || !ALLOWED_PATHS.has(url.pathname)) {
      return json({ error: 'not_found' }, 404, cors)
    }

    let body
    try {
      body = await request.text()
    } catch {
      return json({ error: 'bad_request' }, 400, cors)
    }
    if (body.length > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, cors)
    }

    let upstream
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
      return json({ error: 'upstream_unreachable' }, 502, cors)
    }

    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  },
}
