export type PostSource = 'repo' | 'local'

export interface PostMeta {
  /** URL 中使用的唯一标识 */
  slug: string
  title: string
  /** ISO 日期字符串 yyyy-MM-dd */
  date: string
  updated?: string
  summary: string
  tags: string[]
  cover?: string
  /** 草稿不会在公开列表中出现（仅登录后可见） */
  draft: boolean
  /** 置顶 */
  pinned?: boolean
  author?: string
  /** 加密文章的序列化信封；标题与标签公开，content 仅是占位内容，需要密码或本机密钥解锁。 */
  encryption?: string
  /**
   * 本地草稿专用：作者勾选了「发布为带密码的加密文章」但尚未发布。
   * 只保存在浏览器的草稿存储里，不会写入仓库；重新打开草稿时恢复勾选状态。
   */
  encryptIntent?: boolean
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
