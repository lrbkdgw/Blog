import { githubConfig, STORAGE_KEYS } from './config'

export interface RepoTarget {
  owner: string
  repo: string
  branch: string
  postsDir: string
}

export interface GhUser {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
}

const API = 'https://api.github.com'

/* --------------------------------- 配置 ---------------------------------- */

export function getRepoTarget(): RepoTarget {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.ghRepo) || 'null')
    if (stored && stored.owner && stored.repo) return { ...githubConfig, ...stored }
  } catch {
    /* ignore */
  }
  return { ...githubConfig }
}

export function setRepoTarget(target: RepoTarget) {
  localStorage.setItem(STORAGE_KEYS.ghRepo, JSON.stringify(target))
}

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.token)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(STORAGE_KEYS.token, token)
  else localStorage.removeItem(STORAGE_KEYS.token)
}

/* ------------------------------- 请求封装 -------------------------------- */

async function gh<T>(path: string, init: RequestInit = {}, token = getToken()): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.message) message = body.message
    } catch {
      /* ignore */
    }
    if (res.status === 401) message = 'Token 无效或已过期，请重新登录'
    if (res.status === 403 && /rate limit/i.test(message)) message = 'GitHub API 调用频率超限，请稍后再试'
    if (res.status === 404) message = `找不到资源（${path}）。请检查仓库名、分支以及 Token 权限`
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/* --------------------------------- 认证 ---------------------------------- */

export function verifyToken(token: string): Promise<GhUser> {
  return gh<GhUser>('/user', {}, token)
}

/* ------------------------------ Base64 编解码 ----------------------------- */

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/* ------------------------------- 内容操作 -------------------------------- */

interface ContentItem {
  name: string
  path: string
  sha: string
  type: 'file' | 'dir'
  content?: string
}

export async function listRemotePosts(target = getRepoTarget()): Promise<ContentItem[]> {
  try {
    const items = await gh<ContentItem[]>(
      `/repos/${target.owner}/${target.repo}/contents/${target.postsDir}?ref=${target.branch}`,
    )
    return items.filter((i) => i.type === 'file' && i.name.endsWith('.md'))
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return []
    throw err
  }
}

export async function fetchRemoteFile(path: string, target = getRepoTarget()) {
  const item = await gh<ContentItem>(
    `/repos/${target.owner}/${target.repo}/contents/${path}?ref=${target.branch}`,
  )
  return { sha: item.sha, text: item.content ? decodeBase64(item.content) : '' }
}

async function getSha(path: string, target: RepoTarget): Promise<string | undefined> {
  try {
    const item = await gh<ContentItem>(
      `/repos/${target.owner}/${target.repo}/contents/${path}?ref=${target.branch}`,
    )
    return item.sha
  } catch {
    return undefined
  }
}

export interface CommitResult {
  path: string
  commitUrl: string
}

/** 新建或更新一个 Markdown 文件 */
export async function commitPost(
  slug: string,
  markdown: string,
  message: string,
  target = getRepoTarget(),
): Promise<CommitResult> {
  const path = `${target.postsDir}/${slug}.md`
  const sha = await getSha(path, target)
  const res = await gh<{ commit: { html_url: string } }>(
    `/repos/${target.owner}/${target.repo}/contents/${encodeURI(path)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: encodeBase64(markdown),
        branch: target.branch,
        ...(sha ? { sha } : {}),
      }),
    },
  )
  return { path, commitUrl: res.commit.html_url }
}

export async function deleteRemotePost(slug: string, target = getRepoTarget()): Promise<void> {
  const path = `${target.postsDir}/${slug}.md`
  const sha = await getSha(path, target)
  if (!sha) throw new Error('远程仓库中不存在这篇文章')
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: `chore(blog): 删除文章 ${slug}`, sha, branch: target.branch }),
  })
}

/** 上传图片到 assets 目录，返回可直接引用的 raw 链接 */
export async function uploadImage(file: File, target = getRepoTarget()): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  buf.forEach((b) => (binary += String.fromCharCode(b)))
  const safeName = file.name.replace(/[^\w.-]+/g, '-')
  const path = `public/uploads/${Date.now()}-${safeName}`
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `chore(blog): 上传图片 ${safeName}`,
      content: btoa(binary),
      branch: target.branch,
    }),
  })
  return `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${path}`
}
