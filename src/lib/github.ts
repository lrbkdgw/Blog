import { githubConfig, oauthConfig, STORAGE_KEYS } from './config'

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
  // 留空 = 同源中转：Cloudflare Pages 部署时由仓库内置的
  // functions/login/[[path]].ts 提供，天然无 CORS 问题
  if (!relay) return path
  return `${relay.replace(/\/+$/, '')}${path}`
}

/** 读取中转响应；GitHub Pages 上没有 Pages Function，会返回静态 HTML，这里给出可操作的提示 */
async function readOAuthJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.headers.get('content-type')?.toLowerCase().includes('json')) {
    throw new Error(
      'OAuth 中转不可用：若站点部署在 GitHub Pages，请配置 oauthConfig.relayUrl 指向已部署的 oauth-relay Worker（或改用 Cloudflare Pages 一体化部署），详见 README',
    )
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

export async function requestDeviceCode(): Promise<DeviceAuthInfo> {
  if (!oauthConfig.clientId.trim()) {
    throw new Error('尚未配置 OAuth App Client ID（oauthConfig.clientId），请按 README「配置 OAuth 登录」一节设置')
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

/**
 * 按 GitHub 指定的 interval 轮询，直到用户完成授权 / 取消 / 过期。
 * 返回 OAuth access_token。取消时抛出 AbortError。
 */
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
      // 网络抖动：继续按节奏轮询，直到过期
      continue
    }
    const data = await readOAuthJson(res)
    if (typeof data.access_token === 'string' && data.access_token) return data.access_token
    switch (data.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        // 按要求放慢：GitHub 在响应里给出新的 interval，否则在旧值上加 5 秒
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

export async function fetchRemoteFile(path: string, target = getRepoTarget()) {
  const item = await gh<ContentItem>(
    `/repos/${target.owner}/${target.repo}/contents/${path}?ref=${target.branch}`,
  )
  return { sha: item.sha, text: item.content ? decodeBase64(item.content) : '' }
}

/* ---------------------------- 账号外观偏好 ---------------------------- */

export interface GithubFontPreference {
  /** 字体栈（issue #9）：按优先级排列的多个字体 */
  families: string[]
  updatedAt: number
}

const FONT_SETTINGS_DIR = '.starlog/settings/font-preferences'

function fontSettingsPath(login: string): string {
  const safeLogin = login.trim().replace(/[^a-zA-Z0-9-]/g, '')
  if (!safeLogin) throw new Error('GitHub 用户名无效，无法保存字体设置')
  return `${FONT_SETTINGS_DIR}/${safeLogin}.json`
}

/** 读取保存在当前博客仓库内、按 GitHub 账号区分的字体偏好（兼容旧版单字体格式）。 */
export async function fetchGithubFontPreference(
  login: string,
  target = getRepoTarget(),
): Promise<GithubFontPreference | null> {
  try {
    const { text } = await fetchRemoteFile(fontSettingsPath(login), target)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const families = Array.isArray(parsed.families)
      ? parsed.families.filter((f: unknown) => typeof f === 'string' && f.trim()).map((f: string) => f.trim())
      : typeof parsed.family === 'string' && parsed.family.trim()
        ? [parsed.family.trim()]
        : []
    return {
      families,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return null
    throw err
  }
}

/** 将字体偏好提交到当前博客仓库；下次同一 GitHub 账号登录时会自动恢复。 */
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
          { version: 2, families: preference.families, updatedAt: preference.updatedAt || Date.now() },
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
  if (!safeLogin) throw new Error('GitHub 用户名无效，无法保存背景设置')
  return `${BACKGROUND_SETTINGS_DIR}/${safeLogin}.json`
}

/** 读取保存在当前博客仓库内、按 GitHub 账号区分的背景颜色偏好。 */
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

/** 将背景颜色偏好提交到当前博客仓库；下次同一 GitHub 账号登录时会自动恢复。 */
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

/* ------------------------- 仓库权限 / Fork / PR（issue #15） ------------------------- */

export interface RepoAccess {
  exists: boolean
  /** 是否对目标仓库有写（直接提交）权限 */
  push: boolean
}

/** 查询当前令牌对目标仓库的权限（会话级缓存） */
export async function getRepoAccess(target = getRepoTarget(), force = false): Promise<RepoAccess> {
  const key = `starlog:repo-access:${target.owner}/${target.repo}`
  if (!force) {
    try {
      const cached = sessionStorage.getItem(key)
      if (cached) return JSON.parse(cached) as RepoAccess
    } catch {
      /* ignore */
    }
  }
  try {
    const info = await gh<{ permissions?: { push?: boolean } }>(`/repos/${target.owner}/${target.repo}`)
    const access: RepoAccess = { exists: true, push: !!info.permissions?.push }
    try {
      sessionStorage.setItem(key, JSON.stringify(access))
    } catch {
      /* ignore */
    }
    return access
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return { exists: false, push: false }
    throw err
  }
}

export interface ForkInfo {
  owner: string
  repo: string
  defaultBranch: string
}

/** 确保当前用户拥有目标仓库的 fork（没有就创建并等待其就绪） */
export async function ensureFork(target: RepoTarget, user: GhUser): Promise<ForkInfo> {
  try {
    const existing = await gh<{ default_branch: string }>(`/repos/${user.login}/${target.repo}`)
    return { owner: user.login, repo: target.repo, defaultBranch: existing.default_branch }
  } catch {
    /* 还没有 fork，继续创建 */
  }

  await gh(`/repos/${target.owner}/${target.repo}/forks`, { method: 'POST', body: '{}' })
  // fork 在 GitHub 侧是异步完成的，轮询等待就绪
  const deadline = Date.now() + 60_000
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      const created = await gh<{ default_branch: string }>(`/repos/${user.login}/${target.repo}`)
      return { owner: user.login, repo: target.repo, defaultBranch: created.default_branch }
    } catch {
      if (Date.now() > deadline) throw new Error('创建 Fork 超时，请稍后重试')
    }
  }
}

export interface GitLocation {
  owner: string
  repo: string
  branch: string
}

async function getFileShaAt(path: string, loc: GitLocation): Promise<string | undefined> {
  try {
    const item = await gh<ContentItem>(`/repos/${loc.owner}/${loc.repo}/contents/${path}?ref=${encodeURIComponent(loc.branch)}`)
    return item.sha
  } catch {
    return undefined
  }
}

/** 在指定仓库的指定分支上新建/更新文件 */
export async function upsertFileAt(path: string, content: string, message: string, loc: GitLocation): Promise<string> {
  const sha = await getFileShaAt(path, loc)
  const res = await gh<{ commit: { html_url: string } }>(
    `/repos/${loc.owner}/${loc.repo}/contents/${encodeURI(path)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: encodeBase64(content),
        branch: loc.branch,
        ...(sha ? { sha } : {}),
      }),
    },
  )
  return res.commit.html_url
}

export async function getBranchHead(loc: GitLocation): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>(
    `/repos/${loc.owner}/${loc.repo}/git/ref/heads/${encodeURIComponent(loc.branch)}`,
  )
  return ref.object.sha
}

/** 创建分支；已存在则直接复用 */
export async function createBranch(owner: string, repo: string, branch: string, fromSha: string): Promise<void> {
  try {
    await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    })
  } catch (err) {
    if (err instanceof Error && /already exists/i.test(err.message)) return
    throw err
  }
}

export interface PullInfo {
  number: number
  url: string
  state: 'open' | 'closed'
  merged: boolean
  title: string
  author: string
  /** 形如 "someone:branch" 的来源标识 */
  headLabel: string
  createdAt: number
}

function toPullInfo(raw: {
  number: number
  title: string
  html_url: string
  state: string
  merged_at: string | null
  created_at: string
  user: { login: string }
  head: { label: string }
}): PullInfo {
  return {
    number: raw.number,
    url: raw.html_url,
    state: raw.state === 'open' ? 'open' : 'closed',
    merged: !!raw.merged_at,
    title: raw.title,
    author: raw.user.login,
    headLabel: raw.head.label,
    createdAt: new Date(raw.created_at).getTime(),
  }
}

/** 按 head 查找未关闭的 PR（fork 投稿用于复用同一个 PR） */
export async function findOpenPull(head: string, target = getRepoTarget()): Promise<PullInfo | null> {
  const list = await gh<Parameters<typeof toPullInfo>[0][]>(
    `/repos/${target.owner}/${target.repo}/pulls?head=${encodeURIComponent(head)}&state=open&per_page=5`,
  )
  return list[0] ? toPullInfo(list[0]) : null
}

export async function createPull(
  opts: { title: string; body: string; head: string; base: string },
  target = getRepoTarget(),
): Promise<PullInfo> {
  try {
    const raw = await gh<Parameters<typeof toPullInfo>[0]>(`/repos/${target.owner}/${target.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify(opts),
    })
    return toPullInfo(raw)
  } catch (err) {
    if (err instanceof Error && /pull request already exists/i.test(err.message)) {
      const existing = await findOpenPull(opts.head, target)
      if (existing) return existing
    }
    throw err
  }
}

/** 查询单个 PR 的处理状态 */
export async function getPullStatus(
  prNumber: number,
  target = getRepoTarget(),
): Promise<{ state: 'open' | 'merged' | 'closed' }> {
  const raw = await gh<{ state: string; merged: boolean; merged_at: string | null }>(
    `/repos/${target.owner}/${target.repo}/pulls/${prNumber}`,
  )
  if (raw.merged || raw.merged_at) return { state: 'merged' }
  return { state: raw.state === 'open' ? 'open' : 'closed' }
}

/** 列出目标仓库的未合并 PR（管理者审核投稿用） */
export async function listOpenPulls(target = getRepoTarget()): Promise<PullInfo[]> {
  const list = await gh<Parameters<typeof toPullInfo>[0][]>(
    `/repos/${target.owner}/${target.repo}/pulls?state=open&per_page=30&sort=created&direction=desc`,
  )
  return list.map(toPullInfo)
}

/** 合并 PR（需要目标仓库写权限） */
export async function mergePull(prNumber: number, target = getRepoTarget()): Promise<void> {
  await gh(`/repos/${target.owner}/${target.repo}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: 'squash' }),
  })
}

/** 关闭（拒绝）PR（需要目标仓库写权限） */
export async function closePull(prNumber: number, target = getRepoTarget()): Promise<void> {
  await gh(`/repos/${target.owner}/${target.repo}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  })
}

/* ---------------------- 文件最近一次提交时间（issue #8） ---------------------- */

function commitTimeCacheKey(target: RepoTarget): string {
  return `starlog:commit-times:${target.owner}/${target.repo}@${target.branch}`
}

export function readCommitTimeCache(target = getRepoTarget()): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(commitTimeCacheKey(target)) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeCommitTimeCache(map: Record<string, number>, target = getRepoTarget()) {
  try {
    localStorage.setItem(commitTimeCacheKey(target), JSON.stringify(map))
  } catch {
    /* 缓存写不进去就算了（比如隐私模式） */
  }
}

/** 自己刚提交完，直接记录时间，免得再去问一遍 GitHub */
export function recordCommitTime(path: string, ts: number, target = getRepoTarget()) {
  const map = readCommitTimeCache(target)
  map[path] = ts
  writeCommitTimeCache(map, target)
}

/**
 * 批量获取一组文件「上次发布（提交）到 GitHub 的时间」。
 * 本地有缓存的先取缓存，缺失的并发调用 Commits API，结果写回缓存。
 * 值为 0 表示查询失败或没有提交记录。
 */
export async function fetchCommitTimes(
  paths: string[],
  target = getRepoTarget(),
): Promise<Record<string, number>> {
  const cached = readCommitTimeCache(target)
  const missing = paths.filter((p) => typeof cached[p] !== 'number')
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (path) => {
        try {
          const list = await gh<{ commit: { committer: { date: string } } }[]>(
            `/repos/${target.owner}/${target.repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(target.branch)}&per_page=1`,
          )
          cached[path] = list[0] ? new Date(list[0].commit.committer.date).getTime() : 0
        } catch {
          cached[path] = 0
        }
      }),
    )
    writeCommitTimeCache(cached, target)
  }
  return Object.fromEntries(paths.map((p) => [p, cached[p] ?? 0]))
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
  recordCommitTime(path, Date.now(), target)
  return { path, commitUrl: res.commit.html_url }
}

/** 读取仓库中的一个 JSON 文件（公开仓库未登录也可读）；不存在时返回 null */
export async function readRemoteJson<T>(
  path: string,
  target = getRepoTarget(),
): Promise<{ sha?: string; data: T } | null> {
  try {
    const { sha, text } = await fetchRemoteFile(path, target)
    return { sha, data: JSON.parse(text) as T }
  } catch (err) {
    if (err instanceof Error && /找不到资源/.test(err.message)) return null
    if (err instanceof SyntaxError) return { sha: undefined, data: null as unknown as T }
    throw err
  }
}

/** 把 JSON 数据写回仓库（需要已连接具备写权限的 GitHub 账号） */
export async function writeRemoteJson(
  path: string,
  data: unknown,
  message: string,
  target = getRepoTarget(),
): Promise<string> {
  const sha = await getSha(path, target)
  const res = await gh<{ commit: { html_url: string } }>(
    `/repos/${target.owner}/${target.repo}/contents/${encodeURI(path)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: encodeBase64(JSON.stringify(data, null, 2) + '\n'),
        branch: target.branch,
        ...(sha ? { sha } : {}),
      }),
    },
  )
  return res.commit.html_url
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
