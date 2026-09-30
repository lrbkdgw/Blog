export type PostSource = 'repo' | 'local'

export interface PostMeta {
  /** URL 中使用的唯一标识 */
  slug: string
  title: string
  /** ISO 日期字符串 yyyy-MM-dd */
  date: string
  updated?: string
  /** 最近一次发布到 GitHub 的时间（ISO 8601）；旧文章缺失时回退到发布日期 */
  publishedAt?: string
  summary: string
  tags: string[]
  cover?: string
  /** 草稿不会在公开列表中出现（仅登录后可见） */
  draft: boolean
  /** 置顶 */
  pinned?: boolean
  author?: string
}

export interface Post extends PostMeta {
  content: string
  /** 来源：仓库中的 md 文件 / 浏览器本地草稿 */
  source: PostSource
  /** 仓库文件路径（source === 'repo' 时存在） */
  path?: string
  /** 本地保存时间戳 */
  savedAt?: number
  wordCount: number
  readingTime: number
}
