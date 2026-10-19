import { commentsConfig, githubConfig, oauthConfig, STORAGE_KEYS } from './config'
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

/**
 * 目标仓库：owner / repo 可在「设置」里覆盖；分支与文章目录始终使用构建时的配置。
 * 站点是静态构建的，只会读取构建时 `githubConfig.branch` 与 `githubConfig.postsDir` 下的文章。
 * 若允许在设置里改这两项，文章会被写到站点永远不读取的位置，表现为“发布成功但看不到”。
 */
export function getRepoTarget(): RepoTarget {
  const stored = readPersonalSetting<Partial<RepoTarget>>('repository', STORAGE_KEYS.ghRepo)
  if (stored && stored.owner && stored.repo) {
    return { ...githubConfig, owner: stored.owner, repo: stored.repo }
  }
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
    const error = new Error(message) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

interface GraphqlResponse<T> {
  data?: T
  errors?: { message?: string; type?: string }[]
}

async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token = getToken(),
): Promise<T> {
  if (!token) throw new Error('请先使用 GitHub 登录后再访问评论')
  const response = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query, variables }),
  })
  let payload: GraphqlResponse<T> = {}
  try {
    payload = await response.json() as GraphqlResponse<T>
  } catch {
    // Use the HTTP error below when GitHub did not return JSON.
  }
  if (!response.ok || payload.errors?.length || !payload.data) {
    let message = payload.errors?.map((error) => error.message).filter(Boolean).join('；')
      || `${response.status} ${response.statusText}`
    if (response.status === 401) message = 'GitHub 授权已失效，请重新登录'
    if (response.status === 403) message = '当前 GitHub 授权无法访问 Discussions，请确认仓库已开启讨论功能'
    throw new Error(message)
  }
  return payload.data
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
  size?: number
  download_url?: string | null
}

export async function listRemotePosts(target = getRepoTarget()): Promise<ContentItem[]> {
  try {
    const items = await gh<ContentItem[]>(
      `/repos/${target.owner}/${target.repo}/contents/${target.postsDir}?ref=${encodeURIComponent(target.branch)}`,
    )
    return items.filter((i) => i.type === 'file' && i.name.endsWith('.md'))
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return []
    throw err
  }
}

/** 把仓库路径按 / 分段编码，避免空格、#、? 等字符破坏 URL。 */
function encodeRepoPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export async function fetchRemoteFile(
  path: string,
  target = getRepoTarget(),
  ref = target.branch,
) {
  const item = await gh<ContentItem>(
    `/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
  )
  // 超过 1MB 的文件 contents API 不再内联返回 content，改走 download_url。
  if (!item.content && item.size && item.download_url) {
    const res = await fetch(item.download_url)
    if (!res.ok) throw new Error(`无法下载文件内容（${res.status} ${res.statusText}）`)
    return { sha: item.sha, text: await res.text() }
  }
  return { sha: item.sha, text: item.content ? decodeBase64(item.content) : '' }
}

/** 返回文件的 blob sha；文件不存在（404）时返回 undefined。
 *  其他错误（鉴权失效、网络故障、限流等）必须继续抛出，否则会被误判为“文件不存在”。 */
async function getSha(path: string, target: RepoTarget, ref = target.branch): Promise<string | undefined> {
  try {
    const item = await gh<ContentItem>(
      `/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
    )
    return item.sha
  } catch (err) {
    if ((err as { status?: number }).status === 404) return undefined
    throw err
  }
}

export interface CommitResult {
  path: string
  commitUrl: string
}

export interface FileChange {
  /** 仓库根目录相对路径（不能以 / 开头） */
  path: string
  /** 文本内容 */
  text?: string
  /** 二进制内容（base64），与 text 二选一 */
  base64?: string
  /** 删除该文件 */
  delete?: boolean
}

/**
 * 把多个文件更改合并为一次 Git 提交（Git Data API：blob → tree → commit → ref），
 * 用于「待更新队列」的批量更新：N 项更改一次提交、一次部署。
 */
export async function commitFileChanges(
  changes: FileChange[],
  message: string,
  target = getRepoTarget(),
): Promise<CommitResult> {
  if (changes.length === 0) throw new Error('没有需要提交的更改')
  const { owner, repo, branch } = target

  const refData = await gh<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  )
  const baseSha = refData.object.sha
  const baseCommit = await gh<{ tree: { sha: string } }>(
    `/repos/${owner}/${repo}/git/commits/${baseSha}`,
  )

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
  for (const change of changes) {
    const path = change.path.replace(/^\/+/, '')
    if (change.delete) {
      tree.push({ path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    const blob = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify(
        change.base64 !== undefined
          ? { content: change.base64, encoding: 'base64' }
          : { content: change.text ?? '', encoding: 'utf-8' },
      ),
    })
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }

  const newTree = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  })
  const commit = await gh<{ sha: string; html_url: string }>(
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
    },
  )
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
  return { path: changes.map((c) => c.path).join(', '), commitUrl: commit.html_url }
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
    `/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(path)}`,
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
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(path)}`, {
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
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(path)}`, {
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

interface CreatedPullRequest {
  number: number
  html_url: string
  title: string
  state: string
  created_at: string
  updated_at: string
  user: { login: string; avatar_url: string }
}

/** 新建 Fork 后，GitHub 需要几秒才能完成复制；遇到“找不到资源”时稍后重试。 */
async function retryWhileForkPreparing<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if ((err as { status?: number }).status !== 404 && (err as { status?: number }).status !== 422) throw err
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  throw lastError
}

/** 提交文章发表申请（创建 PR）。
 *  - 更新已有文章时会带上基础分支上的文件 sha（否则 contents API 返回 422）；
 *  - 可选 deleteSlug：同一 PR 中删除旧 slug 的文件（修改 slug 后避免重复文章）；
 *  - Fork 是异步创建的，建分支时会短暂重试，直到 Fork 可用为止；
 *  - PR 创建失败时删除刚建的分支，避免留下孤立分支。 */
export async function submitPublicationPR(
  slug: string,
  markdown: string,
  title: string,
  target = getRepoTarget(),
  options: { deleteSlug?: string } = {},
): Promise<PublicationPR> {
  const token = getToken()
  if (!token) throw new Error('请先使用 GitHub 账号登录')
  const user = await verifyToken(token)

  const filePath = `${target.postsDir}/${slug}.md`
  const deletePath =
    options.deleteSlug && options.deleteSlug !== slug
      ? `${target.postsDir}/${options.deleteSlug}.md`
      : undefined
  const branchName = `submit-post-${slug}-${Date.now().toString(36)}`

  // 1. 确定分支所在仓库：有写权限直接用目标仓库，否则使用用户的 Fork
  let headRef = ''
  let repoOwnerForBranch = target.owner

  const perms = await checkUserRepoPermissions(user.login, target)
  if (!perms.canPush) {
    // Fork 已存在时 GitHub 同样返回成功；真正的失败会在后面建分支时暴露
    await gh(`/repos/${target.owner}/${target.repo}/forks`, { method: 'POST' }).catch(() => undefined)
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

  // 在目标仓库或 Fork 中创建新分支（Fork 刚创建时可能还不可用，短暂重试）
  await retryWhileForkPreparing(() =>
    gh(`/repos/${repoOwnerForBranch}/${target.repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    }),
  )

  let prRes: CreatedPullRequest
  try {
    // 在新分支上写入文章；若基础分支已有该文件，必须带上它的 sha 才能更新
    const existingSha = await getSha(filePath, target)
    await gh(`/repos/${repoOwnerForBranch}/${target.repo}/contents/${encodeRepoPath(filePath)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `post(blog): 申请发表《${title}》`,
        content: encodeBase64(markdown),
        branch: branchName,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    })

    // 修改了 slug：在同一分支删除旧文件（只在旧文件确实存在时）
    if (deletePath) {
      const oldSha = await getSha(deletePath, target)
      if (oldSha) {
        await gh(`/repos/${repoOwnerForBranch}/${target.repo}/contents/${encodeRepoPath(deletePath)}`, {
          method: 'DELETE',
          body: JSON.stringify({
            message: `chore(blog): 申请发表《${title}》时移除旧路径 ${options.deleteSlug}`,
            sha: oldSha,
            branch: branchName,
          }),
        })
      }
    }

    // 创建 Pull Request
    prRes = await gh<CreatedPullRequest>(`/repos/${target.owner}/${target.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `post(submit): ${title} (${slug})`,
        head: headRef,
        base: target.branch,
        body: `### 文章发表申请\n\n- **文章标题**：${title}\n- **URL 别名**：${slug}${
          options.deleteSlug && options.deleteSlug !== slug
            ? `\n- **旧 URL 别名（将被删除）**：${options.deleteSlug}`
            : ''
        }\n- **提交作者**：@${user.login}\n\n*由 Starlog 在线编辑器自动创建*`,
      }),
    })
  } catch (err) {
    // 写入或创建 PR 失败：清理刚建的分支，避免留下孤立分支
    await gh(`/repos/${repoOwnerForBranch}/${target.repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
      method: 'DELETE',
    }).catch(() => undefined)
    throw err
  }

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

/* -------------------------- GitHub Discussions 评论 ------------------------- */

export interface BlogDiscussionComment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  url: string
  viewerCanDelete: boolean
  viewerDidAuthor: boolean
  authorAssociation: string
  author: {
    login: string
    avatarUrl: string
    url: string
  } | null
}

export interface BlogDiscussionThread {
  id: string
  number: number
  url: string
}

export interface BlogCommentsResult {
  repositoryId: string
  categoryId: string
  discussion: BlogDiscussionThread | null
  comments: BlogDiscussionComment[]
}

interface DiscussionCategoryNode {
  id: string
  name: string
}

function discussionMarker(postSlug: string): string {
  return `<!-- starlog-comments:${encodeURIComponent(postSlug)} -->`
}

async function getDiscussionRepository(
  target: RepoTarget,
): Promise<{ repositoryId: string; categoryId: string }> {
  const data = await githubGraphql<{
    repository: {
      id: string
      hasDiscussionsEnabled: boolean
      discussionCategories: { nodes: DiscussionCategoryNode[] }
    } | null
  }>(
    `query DiscussionRepository($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
        hasDiscussionsEnabled
        discussionCategories(first: 100) {
          nodes { id name }
        }
      }
    }`,
    { owner: target.owner, repo: target.repo },
  )
  const repository = data.repository
  if (!repository) throw new Error('找不到评论所使用的 GitHub 仓库')
  if (!repository.hasDiscussionsEnabled) {
    throw new Error('目标仓库尚未开启 GitHub Discussions，请先在仓库 Settings → Features 中启用')
  }
  const category = repository.discussionCategories.nodes.find(
    (item) => item.name.toLowerCase() === commentsConfig.category.toLowerCase(),
  )
  if (!category) {
    throw new Error(`GitHub Discussions 中没有“${commentsConfig.category}”分类，请修改 commentsConfig.category`)
  }
  return { repositoryId: repository.id, categoryId: category.id }
}

interface DiscussionCommentConnection {
  nodes: BlogDiscussionComment[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

interface DiscussionNode extends BlogDiscussionThread {
  body: string
  comments: DiscussionCommentConnection
}

async function findBlogDiscussion(
  postSlug: string,
  categoryId: string,
  target: RepoTarget,
): Promise<DiscussionNode | null> {
  const marker = discussionMarker(postSlug)
  let after: string | null = null
  do {
    const data: {
      repository: {
        discussions: {
          nodes: DiscussionNode[]
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      } | null
    } = await githubGraphql(
      `query BlogDiscussions(
        $owner: String!
        $repo: String!
        $categoryId: ID!
        $after: String
      ) {
        repository(owner: $owner, name: $repo) {
          discussions(
            first: 50
            after: $after
            categoryId: $categoryId
            orderBy: { field: UPDATED_AT, direction: DESC }
          ) {
            nodes {
              id number url body
              comments(first: 100) {
                nodes {
                  id body createdAt updatedAt url viewerCanDelete viewerDidAuthor authorAssociation
                  author { login avatarUrl url }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      {
        owner: target.owner,
        repo: target.repo,
        categoryId,
        after,
      },
    )
    if (!data.repository) throw new Error('找不到评论所使用的 GitHub 仓库')
    const match = data.repository.discussions.nodes.find((discussion) => discussion.body.includes(marker))
    if (match) return match
    const pageInfo = data.repository.discussions.pageInfo
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return null
    after = pageInfo.endCursor
  } while (after)
  return null
}

async function loadRemainingDiscussionComments(
  discussion: DiscussionNode,
  target: RepoTarget,
): Promise<BlogDiscussionComment[]> {
  const comments = [...discussion.comments.nodes]
  let pageInfo = discussion.comments.pageInfo
  while (pageInfo.hasNextPage && pageInfo.endCursor) {
    const data: {
      repository: {
        discussion: { comments: DiscussionCommentConnection } | null
      } | null
    } = await githubGraphql(
      `query BlogDiscussionComments(
        $owner: String!
        $repo: String!
        $number: Int!
        $after: String
      ) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            comments(first: 100, after: $after) {
              nodes {
                id body createdAt updatedAt url viewerCanDelete viewerDidAuthor authorAssociation
                author { login avatarUrl url }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      {
        owner: target.owner,
        repo: target.repo,
        number: discussion.number,
        after: pageInfo.endCursor,
      },
    )
    const connection = data.repository?.discussion?.comments
    if (!connection) break
    comments.push(...connection.nodes)
    pageInfo = connection.pageInfo
  }
  return comments
}

export async function loadBlogDiscussionComments(
  postSlug: string,
  target = getRepoTarget(),
): Promise<BlogCommentsResult> {
  const repository = await getDiscussionRepository(target)
  const discussion = await findBlogDiscussion(postSlug, repository.categoryId, target)
  const comments = discussion ? await loadRemainingDiscussionComments(discussion, target) : []
  return {
    ...repository,
    discussion: discussion
      ? { id: discussion.id, number: discussion.number, url: discussion.url }
      : null,
    comments: comments.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  }
}

export async function createBlogDiscussion(
  repositoryId: string,
  categoryId: string,
  postSlug: string,
  postTitle: string,
): Promise<BlogDiscussionThread> {
  const title = `${commentsConfig.titlePrefix} ${postTitle.trim() || postSlug}`.slice(0, 180)
  const body = [
    `此讨论用于文章「${postTitle.trim() || postSlug}」的评论。`,
    '',
    '评论请遵守 GitHub 社区准则。',
    '',
    discussionMarker(postSlug),
  ].join('\n')
  const data = await githubGraphql<{
    createDiscussion: { discussion: BlogDiscussionThread | null }
  }>(
    `mutation CreateBlogDiscussion(
      $repositoryId: ID!
      $categoryId: ID!
      $title: String!
      $body: String!
    ) {
      createDiscussion(input: {
        repositoryId: $repositoryId
        categoryId: $categoryId
        title: $title
        body: $body
      }) {
        discussion { id number url }
      }
    }`,
    { repositoryId, categoryId, title, body },
  )
  if (!data.createDiscussion.discussion) throw new Error('无法创建文章对应的 GitHub Discussion')
  return data.createDiscussion.discussion
}

export async function addBlogDiscussionComment(
  discussionId: string,
  body: string,
): Promise<void> {
  await githubGraphql(
    `mutation AddBlogDiscussionComment($discussionId: ID!, $body: String!) {
      addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
        comment { id }
      }
    }`,
    { discussionId, body },
  )
}

export async function deleteBlogDiscussionComment(commentId: string): Promise<void> {
  await githubGraphql(
    `mutation DeleteBlogDiscussionComment($commentId: ID!) {
      deleteDiscussionComment(input: { id: $commentId }) {
        comment { id }
      }
    }`,
    { commentId },
  )
}

/* ---------------------------- 账号外观偏好 ---------------------------- */

export interface GithubFontPreference {
  /** 正文字体，逗号分隔，按优先级从高到低 */
  family: string
  /** 代码字体，逗号分隔，按优先级从高到低（version 3 起，旧文件没有这一项） */
  monoFamily: string
  sizePercent: number
  updatedAt: number
}

const FONT_SETTINGS_DIR = '.starlog/settings/font-preferences'

export function fontSettingsPath(login: string): string {
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
    if (!parsed || typeof parsed !== 'object') return null
    // version 2 的旧文件只有 family；version 3 起多一个 monoFamily（代码字体）。
    const family = typeof parsed.family === 'string' ? parsed.family : ''
    const monoFamily = typeof parsed.monoFamily === 'string' ? parsed.monoFamily : ''
    if (!family && !monoFamily) return null
    return {
      family,
      monoFamily,
      sizePercent: typeof parsed.sizePercent === 'number' ? parsed.sizePercent : 100,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return null
    throw err
  }
}

export interface SettingsFileUpdate {
  path: string
  text: string
  message: string
}

/** 构造字体偏好设置文件内容（供立即提交或「待更新队列」暂存使用）。 */
export function buildFontPreferenceFile(
  login: string,
  preference: GithubFontPreference,
): SettingsFileUpdate {
  return {
    path: fontSettingsPath(login),
    message: `chore(settings): 保存 @${login} 的字体与字号偏好`,
    text:
      JSON.stringify(
        {
          version: 3,
          family: preference.family,
          monoFamily: preference.monoFamily || '',
          sizePercent: preference.sizePercent,
          updatedAt: preference.updatedAt || Date.now(),
        },
        null,
        2,
      ) + '\n',
  }
}

export async function saveGithubFontPreference(
  login: string,
  preference: GithubFontPreference,
  target = getRepoTarget(),
): Promise<void> {
  const file = buildFontPreferenceFile(login, preference)
  const sha = await getSha(file.path, target)
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(file.path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: file.message,
      content: encodeBase64(file.text),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  })
}

export interface GithubAnimatedBackgroundPreference {
  scene: string
  values: Record<string, Record<string, number>>
}

/**
 * 账号外观偏好文件（`background-preferences/<login>.json`）。
 *
 * version 2 只保存渐变背景色与强度；version 3 起同时保存配色主题、明暗模式
 * 与动态背景场景参数，旧文件仍然可以正常读取（缺少的字段按本地默认值处理）。
 */
export interface GithubBackgroundPreference {
  color: string
  intensity: number
  updatedAt: number
  /** 配色主题 id（见 src/lib/themes.ts） */
  colorTheme?: string
  /** 明暗模式：light / dark / system */
  themeMode?: string
  /** 动态背景场景与每个场景各自的参数 */
  animatedBackground?: GithubAnimatedBackgroundPreference
}

const BACKGROUND_SETTINGS_DIR = '.starlog/settings/background-preferences'

export function backgroundSettingsPath(login: string): string {
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
      colorTheme: typeof parsed.colorTheme === 'string' ? parsed.colorTheme : undefined,
      themeMode: typeof parsed.themeMode === 'string' ? parsed.themeMode : undefined,
      animatedBackground: parseAnimatedBackgroundPreference(parsed.animatedBackground),
    }
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return null
    throw err
  }
}

/** 读取账号文件里的动态背景偏好；无效数据返回 undefined，由本地默认值兜底。 */
function parseAnimatedBackgroundPreference(raw: unknown): GithubAnimatedBackgroundPreference | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const data = raw as { scene?: unknown; values?: unknown }
  if (typeof data.scene !== 'string') return undefined
  const values: Record<string, Record<string, number>> = {}
  if (data.values && typeof data.values === 'object') {
    for (const [scene, params] of Object.entries(data.values as Record<string, unknown>)) {
      if (!params || typeof params !== 'object') continue
      const numbers: Record<string, number> = {}
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) numbers[key] = value
      }
      values[scene] = numbers
    }
  }
  return { scene: data.scene, values }
}

/** 构造外观偏好设置文件内容（供立即提交或「待更新队列」暂存使用）。 */
export function buildBackgroundPreferenceFile(
  login: string,
  preference: GithubBackgroundPreference,
): SettingsFileUpdate {
  return {
    path: backgroundSettingsPath(login),
    message: `chore(settings): 保存 @${login} 的外观偏好`,
    text:
      JSON.stringify(
        {
          version: 3,
          color: preference.color,
          intensity: preference.intensity,
          colorTheme: preference.colorTheme ?? '',
          themeMode: preference.themeMode ?? 'system',
          animatedBackground: preference.animatedBackground ?? { scene: 'none', values: {} },
          updatedAt: preference.updatedAt || Date.now(),
        },
        null,
        2,
      ) + '\n',
  }
}

export async function saveGithubBackgroundPreference(
  login: string,
  preference: GithubBackgroundPreference,
  target = getRepoTarget(),
): Promise<void> {
  const file = buildBackgroundPreferenceFile(login, preference)
  const sha = await getSha(file.path, target)
  await gh(`/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(file.path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: file.message,
      content: encodeBase64(file.text),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  })
}
