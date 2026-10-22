/**
 * Cloudflare Pages Function：回声洞匿名写入中继（`/api/echo`）。
 *
 * 当在 Cloudflare Pages 环境变量中配置了 `ECHO_GITHUB_TOKEN`（或 `GITHUB_TOKEN`）时，
 * 任何访客无需手动登录即可直接把回声写入仓库 GitHub Discussions，
 * 并基于访客匿名指纹自动附带 `echo-sender:anon:<hash>` 标记以执行每小时 3 条 / 每天 10 条识别限制。
 * 若未配置环境变量则返回 501，前端自动衔接 GitHub OAuth 授权续发流程。
 */

interface Env {
  ECHO_GITHUB_TOKEN?: string
  GITHUB_TOKEN?: string
  GITHUB_OWNER?: string
  GITHUB_REPO?: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const ECHO_CAVE_TITLE = '回声洞'
const ECHO_CAVE_MARKER = '<!-- starlog-echo-cave -->'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

async function hashSenderIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`starlog-echo:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `anon:${hex}`
}

async function ghGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Starlog-EchoCave',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (!res.ok || json.errors?.length || !json.data) {
    throw new Error(json.errors?.map((e) => e.message).join('; ') || `GitHub HTTP ${res.status}`)
  }
  return json.data
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: CORS })
  }

  const token = env.ECHO_GITHUB_TOKEN || env.GITHUB_TOKEN
  if (!token) {
    return Response.json({ error: 'NO_SERVER_TOKEN' }, { status: 501, headers: CORS })
  }

  let bodyJson: { text?: string }
  try {
    bodyJson = (await request.json()) as { text?: string }
  } catch {
    return Response.json({ error: '请求格式无效' }, { status: 400, headers: CORS })
  }

  const clean = (bodyJson.text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r?\n+/g, ' ')
    .trim()
    .slice(0, 300)

  if (!clean) {
    return Response.json({ error: '内容不能为空' }, { status: 400, headers: CORS })
  }

  const owner = env.GITHUB_OWNER || 'lrbkdgw'
  const repo = env.GITHUB_REPO || 'Blog'
  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  const senderKey = await hashSenderIp(clientIp)

  try {
    const repoData = await ghGraphql<{
      repository: {
        id: string
        discussionCategories: { nodes: Array<{ id: string; slug: string }> }
        discussions: {
          nodes: Array<{
            id: string
            title: string
            body: string
            comments: { nodes: Array<{ body: string; createdAt: string }> }
          }>
        }
      }
    }>(
      token,
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          discussionCategories(first: 20) { nodes { id slug } }
          discussions(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              id
              title
              body
              comments(last: 100) { nodes { body createdAt } }
            }
          }
        }
      }`,
      { owner, name: repo },
    )

    let discussion = repoData.repository.discussions.nodes.find(
      (d) =>
        d.body.includes(ECHO_CAVE_MARKER) ||
        d.title.trim() === ECHO_CAVE_TITLE ||
        d.title.trim().startsWith(`[${ECHO_CAVE_TITLE}]`),
    )

    if (!discussion) {
      const cat =
        repoData.repository.discussionCategories.nodes.find(
          (c) => c.slug.toLowerCase() === 'general',
        ) ?? repoData.repository.discussionCategories.nodes[0]
      if (!cat) {
        return Response.json({ error: '仓库未启用 Discussions' }, { status: 500, headers: CORS })
      }
      const created = await ghGraphql<{
        createDiscussion: { discussion: { id: string } }
      }>(
        token,
        `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
          createDiscussion(input: {
            repositoryId: $repositoryId,
            categoryId: $categoryId,
            title: $title,
            body: $body
          }) {
            discussion { id }
          }
        }`,
        {
          repositoryId: repoData.repository.id,
          categoryId: cat.id,
          title: ECHO_CAVE_TITLE,
          body: `这里是百宝箱「回声洞」的留言存档。\n\n${ECHO_CAVE_MARKER}`,
        },
      )
      discussion = {
        id: created.createDiscussion.discussion.id,
        title: ECHO_CAVE_TITLE,
        body: ECHO_CAVE_MARKER,
        comments: { nodes: [] },
      }
    }

    const now = Date.now()
    const tag = `<!-- echo-sender:${senderKey} -->`
    const saved = await ghGraphql<{
      addDiscussionComment: {
        comment: { id: string; body: string; createdAt: string }
      }
    }>(
      token,
      `mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment { id body createdAt }
        }
      }`,
      {
        discussionId: discussion.id,
        body: `${clean}\n\n${tag}`,
      },
    )

    const sameSenderTimes = discussion.comments.nodes
      .filter((c) => c.body.includes(tag))
      .map((c) => Date.parse(c.createdAt))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)

    const accepted: number[] = []
    for (const t of sameSenderTimes) {
      const inHour = accepted.filter((p) => t - p >= 0 && t - p < HOUR_MS).length
      const inDay = accepted.filter((p) => t - p >= 0 && t - p < DAY_MS).length
      if (inHour < 3 && inDay < 10) accepted.push(t)
    }
    const recognized =
      accepted.filter((p) => now - p >= 0 && now - p < HOUR_MS).length < 3 &&
      accepted.filter((p) => now - p >= 0 && now - p < DAY_MS).length < 10

    return Response.json(
      {
        comment: {
          id: saved.addDiscussionComment.comment.id,
          body: saved.addDiscussionComment.comment.body,
          createdAt: saved.addDiscussionComment.comment.createdAt,
          authorLogin: null,
          authorAssociation: 'NONE',
        },
        recognized,
      },
      { status: 200, headers: CORS },
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : '写入 Discussions 失败' },
      { status: 502, headers: CORS },
    )
  }
}
