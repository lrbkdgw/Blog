/**
 * 文章历史版本的统一入口。
 *
 * - 线上站点：历史就是 Git 提交历史（仓库里每个版本都是一次提交）；
 * - 离线单文件版：没有仓库，改用「本机快照」（每次保存时留存一份，见 offlineLibrary.ts），
 *   这样历史浏览、版本命名、版本对比、"以该版本新建草稿" 等能力在离线版同样可用。
 */
import {
  fetchPostHistoryMarkdown,
  getRepoTarget,
  listPostHistory,
  type PostHistoryVersion,
} from './github'
import { isLocalVersionSha, listLocalVersions, readLocalVersion, toPostHistoryVersions } from './offlineLibrary'
import { OFFLINE } from './runtime'

/** 版本来源的展示名称（离线版界面与提示统一使用） */
export const VERSION_SOURCE_LABEL = OFFLINE ? '本机快照' : 'Git 提交'

export async function loadPostHistory(slug: string, filePath?: string): Promise<PostHistoryVersion[]> {
  if (OFFLINE) return toPostHistoryVersions(listLocalVersions(slug))
  return listPostHistory(slug, getRepoTarget(), filePath)
}

export async function loadPostHistoryMarkdown(
  slug: string,
  sha: string,
  filePath?: string,
): Promise<string> {
  if (OFFLINE) {
    if (!isLocalVersionSha(sha)) throw new Error('离线版只能查看本机保存的历史版本')
    const raw = readLocalVersion(slug, sha)
    if (raw === null) throw new Error('这个本机版本已经不在存储中（可能因容量上限被裁剪）')
    return raw
  }
  return fetchPostHistoryMarkdown(slug, sha, getRepoTarget(), filePath)
}

/** 当前版本列表是否有可展示的内容（离线版首篇尚无快照时为 false） */
export function hasLocalHistory(slug: string): boolean {
  return listLocalVersions(slug).length > 0
}
