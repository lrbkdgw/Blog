import { githubConfig, oauthConfig, STORAGE_KEYS } from './config'
import { readPersonalSetting, writePersonalSetting } from './settingsStore'

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
  const stored = readPersonalSetting<Partial<RepoTarget>>('repository', STORAGE_KEYS.ghRepo)
  if (stored && stored.owner && stored.repo) return { ...githubConfig, ...stored }
  return { ...githubConfig }
}

export function setRepoTarget(target: RepoTarget) {
  writePersonalSetting('repository', target)
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
    if (res.status === 401) message = 'GitHub 授权已失效，请重新连接'
    if (res.status === 403 && /rate limit/i.test(message)) message = 'GitHub API 调用频率超限，请稍后再试'
    if (res.status === 404) message = `找不到资源（${path}）。请检查仓库名、分支以及 OAuth 授权范围`
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/* --------------------------------- 认证 ---------------------------------- */

export function verifyToken(token: string): Promise<GhUser> {
  return gh<GhUser>('/user', {}, token)
}

/** 检查用户对目标仓库的权限 */
export async function checkUserRepoPermissions(
  username: string,
  target = getRepoTarget(),
): Promise<{ canPush: boolean; canAdmin: boolean }> {
  if (!username) return { canPush: false, canAdmin: false }
  if (username.toLowerCase() === target.owner.toLowerCase()) {
    return { canPush: true, canAdmin: true }
  }
  try {
    const repoInfo = await gh<{ permissions?: { push?: boolean; admin?: boolean } }>(
      `/repos/${target.owner}/${target.repo}`,
    )
    if (repoInfo?.permissions) {
      return {
        canPush: Boolean(repoInfo.permissions.push),
        canAdmin: Boolean(repoInfo.permissions.admin),
      }
    }
  } catch {
    // 无法直接查询时按非协作者处理
  }
  return { canPush: false, canAdmin: false }
}

/* --------------------------- OAuth Device Flow ---------------------------- */

export interface DeviceAuthInfo {
  /** 轮询换取 access_token 时使用的设备码（不展示给用户） */
  deviceCode: string
  /** 用户在 github.com/login/device 页面输入的验证码，如 XXXX-XXXX */
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

function oauthRelay(path: string): string {
  const relay = oauthConfig.relayUrl.trim()
  if (!relay) return path
  return `${relay.replace(/\/+$/, '')}${path}`
}

async function readOAuthJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.headers.get('content-type')?.toLowerCase().includes('json')) {
    throw new Error(
      'OAuth 中转不可用：若站点部署在 GitHub Pages，请配置 oauthConfig.relayUrl 指向已部署的 oauth-relay Worker，详见 README',
    )
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

export async function requestDeviceCode(): Promise<DeviceAuthInfo> {
  if (!oauthConfig.clientId.trim()) {
    throw new Error('尚未配置 OAuth App Client ID（oauthConfig.clientId），请按 README 设置')
  }
  let res: Response
  try {
    res = await fetch(oauthRelay('/login/device/code'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId.trim(),
        scope: oauthConfig.scope,
      }).toString(),
    })
  } catch {
    throw new Error('无法连接 OAuth 中转服务，请检查网络或中转地址配置')
  }
  const data = await readOAuthJson(res)
  if (!res.ok || typeof data.device_code !== 'string') {
    const msg = data.error_description || data.error
    if (msg === 'device_flow_disabled' || /device flow/i.test(String(msg))) {
      throw new Error('该 OAuth App 未启用 Device Flow：请到其设置页勾选 “Enable Device Flow”')
    }
    throw new Error(String(msg || `无法获取设备验证码（HTTP ${res.status}）`))
  }
  return {
    deviceCode: data.device_code,
    userCode: String(data.user_code || ''),
    verificationUri: String(data.verification_uri || 'https://github.com/login/device'),
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 900,
    interval: typeof data.interval === 'number' && data.interval > 0 ? data.interval : 5,
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollDeviceToken(info: DeviceAuthInfo, signal?: AbortSignal): Promise<string> {
  let interval = info.interval
  const deadline = Date.now() + info.expiresIn * 1000
  for (;;) {
    if (Date.now() >= deadline) throw new Error('验证码已过期，请重新开始授权')
    await sleep(interval * 1000, signal)
    let res: Response
    try {
      res = await fetch(oauthRelay('/login/oauth/access_token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        signal,
        body: new URLSearchParams({
          client_id: oauthConfig.clientId.trim(),
          device_code: info.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      continue
    }
    const data = await readOAuthJson(res)
    if (typeof data.access_token === 'string' && data.access_token) return data.access_token
    switch (data.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval = typeof data.interval === 'number' ? data.interval : interval + 5
        continue
      case 'access_denied':
        throw new Error('已取消授权')
      case 'expired_token':
        throw new Error('验证码已过期，请重新开始授权')
      case 'device_flow_disabled':
        throw new Error('该 OAuth App 未启用 Device Flow：请到其设置页勾选 “Enable Device Flow”')
      default:
        throw new Error(String(data.error_description || data.error || '授权失败，请重试'))
    }
  }
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

export async function fetchRemoteFile(
  path: string,
  target = getRepoTarget(),
  ref = target.branch,
) {
  const item = await gh<ContentItem>(
    `/repos/${target.owner}/${target.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
  )
  return { sha: item.sha, text: item.content ? decodeBase64(item.content) : '' }
}

async function getSha(path: string, target: RepoTarget, ref = target.branch): Promise<string | undefined> {
  try {
    const item = await gh<ContentItem>(
      `/repos/${target.owner}/${target.repo}/contents/${path}?ref=${ref}`,
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

export interface PostHistoryVersion {
  sha: string
  message: string
  committedAt: string
  author: {
    login?: string
    name: string
    avatarUrl?: string
  }
}

/**
 * Every contents API update is a Git commit, so Git itself is the durable version
 * store. This reads the history for one Markdown path without duplicating article
 * bodies in localStorage.
 */
export async function listPostHistory(
  slug: string,
  target = getRepoTarget(),
  filePath?: string,
): Promise<PostHistoryVersion[]> {
  const path = filePath || `${target.postsDir}/${slug}.md`
  const params = new URLSearchParams({ path, sha: target.branch, per_page: '100' })
  const commits = await gh<
    {
      sha: string
      commit: { message: string; author?: { name?: string; date?: string } }
      author?: { login?: string; avatar_url?: string }
    }[]
  >(`/repos/${target.owner}/${target.repo}/commits?${params.toString()}`)
  return commits.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message.split('\n')[0] || '更新文章',
    committedAt: commit.commit.author?.date || '',
    author: {
      login: commit.author?.login,
      name: commit.author?.login || commit.commit.author?.name || '未知作者',
      avatarUrl: commit.author?.avatar_url,
    },
  }))
}

export async function fetchPostHistoryMarkdown(
  slug: string,
  sha: string,
  target = getRepoTarget(),
  filePath?: string,
): Promise<string> {
  const path = filePath || `${target.postsDir}/${slug}.md`
  const { text } = await fetchRemoteFile(path, target, sha)
  return text
}

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

/* --------------------------------- PR 投稿与审核 --------------------------------- */

export interface PublicationPR {
  number: number
  title: string
  articleTitle: string
  slug: string
  state: 'open' | 'closed' | 'merged'
  html_url: string
  created_at: string
  updated_at: string
  merged_at?: string
  author: {
    login: string
    avatar_url: string
  }
}

const LOCAL_PRS_KEY = 'starlog:submitted-prs'

function readLocalPRs(): PublicationPR[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_PRS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeLocalPRs(prs: PublicationPR[]) {
  localStorage.setItem(LOCAL_PRS_KEY, JSON.stringify(prs))
  window.dispatchEvent(new CustomEvent('starlog:prs-changed'))
}

export function saveLocalPR(pr: PublicationPR) {
  const list = readLocalPRs().filter((item) => item.number !== pr.number)
  list.unshift(pr)
  writeLocalPRs(list)
}

/** 提交文章发表申请（创建 PR） */
export async function submitPublicationPR(
  slug: string,
  markdown: string,
  title: string,
  target = getRepoTarget(),
): Promise<PublicationPR> {
  const token = getToken()
  if (!token) throw new Error('请先使用 GitHub 账号登录')
  const user = await verifyToken(token)

  const filePath = `${target.postsDir}/${slug}.md`
  const branchName = `submit-post-${slug}-${Date.now().toString(36)}`

  // 1. 尝试在用户 Fork 或原仓库创建分支并提交文件
  let headRef = ''
  let repoOwnerForBranch = target.owner

  const perms = await checkUserRepoPermissions(user.login, target)
  if (!perms.canPush) {
    // 非仓库写权限用户：检查/创建 Fork
    try {
      await gh(`/repos/${target.owner}/${target.repo}/forks`, { method: 'POST' })
    } catch {
      /* fork 可能已存在 */
    }
    repoOwnerForBranch = user.login
    headRef = `${user.login}:${branchName}`
  } else {
    headRef = branchName
  }

  // 获取基础分支最新的 commit sha
  const baseBranchData = await gh<{ object: { sha: string } }>(
    `/repos/${target.owner}/${target.repo}/git/ref/heads/${target.branch}`,
  )
  const baseSha = baseBranchData.object.sha

  // 在目标仓库或 Fork 仓库中创建新分支
  await gh(`/repos/${repoOwnerForBranch}/${target.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    }),
  })

  // 在新分支上提交文章
  await gh(`/repos/${repoOwnerForBranch}/${target.repo}/contents/${encodeURI(filePath)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `post(blog): 申请发表《${title}》`,
      content: encodeBase64(markdown),
      branch: branchName,
    }),
  })

  // 创建 Pull Request
  const prRes = await gh<{
    number: number
    html_url: string
    title: string
    state: string
    created_at: string
    updated_at: string
    user: { login: string; avatar_url: string }
  }>(`/repos/${target.owner}/${target.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `post(submit): ${title} (${slug})`,
      head: headRef,
      base: target.branch,
      body: `### 文章发表申请\n\n- **文章标题**：${title}\n- **URL 别名**：${slug}\n- **提交作者**：@${user.login}\n\n*由 Starlog 在线编辑器自动创建*`,
    }),
  })

  const newPR: PublicationPR = {
    number: prRes.number,
    title: prRes.title,
    articleTitle: title,
    slug,
    state: 'open',
    html_url: prRes.html_url,
    created_at: prRes.created_at,
    updated_at: prRes.updated_at,
    author: {
      login: prRes.user?.login || user.login,
      avatar_url: prRes.user?.avatar_url || user.avatar_url,
    },
  }

  saveLocalPR(newPR)
  return newPR
}

/** 获取所有发表申请 PR 列表（包括处理情况） */
export async function listPublicationPRs(target = getRepoTarget()): Promise<PublicationPR[]> {
  const localPRs = readLocalPRs()
  try {
    const rawPRs = await gh<
      {
        number: number
        title: string
        state: string
        merged_at: string | null
        html_url: string
        created_at: string
        updated_at: string
        user: { login: string; avatar_url: string }
      }[]
    >(`/repos/${target.owner}/${target.repo}/pulls?state=all&per_page=30`)

    const remotePRs: PublicationPR[] = rawPRs
      .filter((p) => p.title.startsWith('post(') || p.title.startsWith('post:') || p.title.includes('发表'))
      .map((p) => {
        let articleTitle = p.title.replace(/^post\([^)]+\):\s*/i, '').replace(/^post:\s*/i, '')
        let slug = ''
        const m = articleTitle.match(/^(.+?)\s*\(([^)]+)\)$/)
        if (m) {
          articleTitle = m[1].trim()
          slug = m[2].trim()
        }
        return {
          number: p.number,
          title: p.title,
          articleTitle: articleTitle || p.title,
          slug: slug || `pr-${p.number}`,
          state: p.merged_at ? 'merged' : (p.state as 'open' | 'closed'),
          html_url: p.html_url,
          created_at: p.created_at,
          updated_at: p.updated_at,
          merged_at: p.merged_at || undefined,
          author: {
            login: p.user?.login || 'unknown',
            avatar_url: p.user?.avatar_url || '',
          },
        }
      })

    // 合并远程与本地 PR 记录
    const map = new Map<number, PublicationPR>()
    for (const p of remotePRs) map.set(p.number, p)
    for (const p of localPRs) {
      if (!map.has(p.number)) map.set(p.number, p)
    }

    const merged = [...map.values()].sort((a, b) => b.number - a.number)
    writeLocalPRs(merged)
    return merged
  } catch {
    return localPRs
  }
}

/** 仓库管理员审批通过并合并 PR */
export async function mergePublicationPR(
  prNumber: number,
  target = getRepoTarget(),
): Promise<void> {
  await gh(`/repos/${target.owner}/${target.repo}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({
      commit_title: `chore(blog): 合并文章发表 PR #${prNumber}`,
      merge_method: 'squash',
    }),
  })
}

/** 仓库管理员关闭 PR */
export async function closePublicationPR(
  prNumber: number,
  target = getRepoTarget(),
): Promise<void> {
  await gh(`/repos/${target.owner}/${target.repo}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  })
}

/* ---------------------------- 账号外观偏好 ---------------------------- */

export interface GithubFontPreference {
  family: string
  updatedAt: number
}

const FONT_SETTINGS_DIR = '.starlog/settings/font-preferences'

function fontSettingsPath(login: string): string {
  const safeLogin = login.trim().replace(/[^a-zA-Z0-9-]/g, '')
  if (!safeLogin) throw new Error('GitHub 用户名无效')
  return `${FONT_SETTINGS_DIR}/${safeLogin}.json`
}

export async function fetchGithubFontPreference(
  login: string,
  target = getRepoTarget(),
): Promise<GithubFontPreference | null> {
  try {
    const { text } = await fetchRemoteFile(fontSettingsPath(login), target)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed.family !== 'string') return null
    return {
      family: parsed.family,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return null
    throw err
  }
}

export async function saveGithubFontPreference(
  login: string,
  preference: GithubFontPreference,
  target = getRepoTarget(),
): Promise<void> {
  const path = fontSettingsPath(login)
  const sha = await getSha(path, target)
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `chore(settings): 保存 @${login} 的字体偏好`,
      content: encodeBase64(
        JSON.stringify(
          { version: 1, family: preference.family, updatedAt: preference.updatedAt || Date.now() },
          null,
          2,
        ) + '\n',
      ),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  })
}

export interface GithubBackgroundPreference {
  color: string
  intensity: number
  updatedAt: number
}

const BACKGROUND_SETTINGS_DIR = '.starlog/settings/background-preferences'

function backgroundSettingsPath(login: string): string {
  const safeLogin = login.trim().replace(/[^a-zA-Z0-9-]/g, '')
  if (!safeLogin) throw new Error('GitHub 用户名无效')
  return `${BACKGROUND_SETTINGS_DIR}/${safeLogin}.json`
}

export async function fetchGithubBackgroundPreference(
  login: string,
  target = getRepoTarget(),
): Promise<GithubBackgroundPreference | null> {
  try {
    const { text } = await fetchRemoteFile(backgroundSettingsPath(login), target)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed.color !== 'string') return null
    return {
      color: parsed.color,
      intensity: typeof parsed.intensity === 'number' ? parsed.intensity : 50,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return null
    throw err
  }
}

export async function saveGithubBackgroundPreference(
  login: string,
  preference: GithubBackgroundPreference,
  target = getRepoTarget(),
): Promise<void> {
  const path = backgroundSettingsPath(login)
  const sha = await getSha(path, target)
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `chore(settings): 保存 @${login} 的背景颜色偏好`,
      content: encodeBase64(
        JSON.stringify(
          {
            version: 2,
            color: preference.color,
            intensity: preference.intensity,
            updatedAt: preference.updatedAt || Date.now(),
          },
          null,
          2,
        ) + '\n',
      ),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  })
}
