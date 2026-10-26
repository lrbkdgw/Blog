import GithubSlugger, { slug as normalizeGithubSlug } from 'github-slugger'

/** 没有可 slug 化字符的标题（如 ???）使用的可读回退锚点。 */
export const EMPTY_HEADING_SLUG = 'section'

/**
 * 目录提取与 rehype 正文渲染共用的唯一锚点生成器。
 *
 * 先按 github-slugger 规则取得基础 slug，再进入同一套冲突去重；空基础 slug 改为
 * section，既保留普通标题的历史锚点，也让 ???、emoji 被过滤后的空标题等可跳转。
 */
export function createHeadingSlugger(): (text: string) => string {
  const slugger = new GithubSlugger()
  return (text: string) => slugger.slug(normalizeGithubSlug(text) || EMPTY_HEADING_SLUG)
}
