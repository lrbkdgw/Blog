/**
 * 文章投稿（issue #15）：
 * 已登录（连接 GitHub）但没有目标仓库写权限的用户，可以把文章「申请发表」——
 * 系统会自动 fork 仓库、在 fork 的分支上提交文章，并向目标仓库发起 PR；
 * 仓库管理者在内容管理页（或 GitHub 上）合并/关闭 PR 完成审批，
 * 投稿人在本站即可看到每个投稿的处理情况（审核中 / 已合并 / 已关闭）。
 */
import {
  createBranch,
  createPull,
  ensureFork,
  findOpenPull,
  getBranchHead,
  getPullStatus,
  getRepoTarget,
  upsertFileAt,
} from './github'
import type { GhUser } from './github'
import { serializePost } from './posts'
import type { Post } from './types'

export interface Submission {
  slug: string
  title: string
  /** 目标仓库中的 PR 编号 */
  prNumber: number
  prUrl: string
  /** PR 来源标识，形如 "someone:starlog-post-slug" */
  head: string
  submittedAt: number
  updatedAt: number
}

export type SubmissionState = 'open' | 'merged' | 'closed'

const STORAGE_KEY = 'starlog:submissions'

/* ------------------------------- 本地记录 ------------------------------- */

export function getSubmissions(): Submission[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is Submission =>
        !!s &&
        typeof s === 'object' &&
        typeof s.slug === 'string' &&
        typeof s.prNumber === 'number' &&
        typeof s.prUrl === 'string' &&
        typeof s.head === 'string',
    )
  } catch {
    return []
  }
}

function writeSubmissions(list: Submission[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function upsertSubmission(record: Submission): Submission {
  const list = getSubmissions().filter((s) => !(s.slug === record.slug && s.head === record.head))
  list.unshift(record)
  writeSubmissions(list)
  return record
}

export function removeSubmission(slug: string) {
  writeSubmissions(getSubmissions().filter((s) => s.slug !== slug))
}

/* ------------------------------- 投稿流程 ------------------------------- */

function sanitizeBranch(slug: string): string {
  const branch = slug
    .trim()
    .replace(/[\s~^:?*[\]\\]+/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/[/]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return `starlog-${branch || 'post'}`.slice(0, 80)
}

/**
 * 把文章通过 PR 投稿到目标仓库：
 * 1) 确保有 fork → 2) 在 fork 上建/复用分支并提交文章 → 3) 复用或创建 PR → 4) 本地记录。
 */
export async function submitPostAsPR(post: Post, user: GhUser): Promise<Submission> {
  const target = getRepoTarget()
  const fork = await ensureFork(target, user)
  const branch = sanitizeBranch(post.slug)

  const headSha = await getBranchHead({ owner: fork.owner, repo: fork.repo, branch: fork.defaultBranch })
  await createBranch(fork.owner, fork.repo, branch, headSha)

  const path = `${target.postsDir}/${post.slug}.md`
  await upsertFileAt(path, serializePost(post), `post(blog): 投稿 ${post.title}`, {
    owner: fork.owner,
    repo: fork.repo,
    branch,
  })

  const head = `${fork.owner}:${branch}`
  let pr = await findOpenPull(head, target)
  if (!pr) {
    pr = await createPull(
      {
        title: `投稿：${post.title}`,
        head,
        base: target.branch,
        body: [
          `通过 [星野笔记 / Starlog](https://github.com/${target.owner}/${target.repo}) 站内「申请发表」提交。`,
          '',
          `- 文章：${post.title}`,
          `- Slug：\`${post.slug}\``,
          `- 文件：\`${path}\``,
          '',
          '合并此 PR 即发表；关闭即拒绝。',
        ].join('\n'),
      },
      target,
    )
  }

  const existing = getSubmissions().find((s) => s.slug === post.slug && s.head === head)
  return upsertSubmission({
    slug: post.slug,
    title: post.title,
    prNumber: pr.number,
    prUrl: pr.url,
    head,
    submittedAt: existing?.submittedAt ?? Date.now(),
    updatedAt: Date.now(),
  })
}

/** 刷新一批投稿在目标仓库中的最新处理状态 */
export async function fetchSubmissionStates(
  submissions: Submission[],
): Promise<Map<number, SubmissionState>> {
  const target = getRepoTarget()
  const out = new Map<number, SubmissionState>()
  await Promise.all(
    submissions.map(async (s) => {
      try {
        const { state } = await getPullStatus(s.prNumber, target)
        out.set(s.prNumber, state)
      } catch {
        /* 单个失败不影响其他 */
      }
    }),
  )
  return out
}
