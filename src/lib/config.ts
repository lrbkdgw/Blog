/**
 * 站点配置 —— 部署前把这里改成你自己的信息即可。
 */
export const siteConfig = {
  /** 站点名 */
  title: '个人博客',
  /** 英文副名（可留空） */
  titleEn: '',
  /** 一句话简介 */
  description: '记录数学、代码与一些深夜里的胡思乱想。',
  /** 首页大标题下的长简介 */
  intro:
    '这是一个完全静态、托管在 GitHub Pages 上的个人博客：支持 Markdown 与 KaTeX 公式、在线编辑、深色模式，并且可以把文章一键提交回 GitHub 仓库。',
  /** 作者 */
  author: {
    name: 'lrbkdgw',
    bio: '一个喜欢把想法写下来的人。偶尔写点数学，偶尔写点代码。',
    avatar: '', // 留空则使用自动生成的渐变头像
  },
  /** 社交链接，留空的项不会显示 */
  social: {
    github: 'https://github.com/lrbkdgw',
    email: '',
    twitter: '',
    rss: '',
  },
  /** 每页文章数 */
  postsPerPage: 6,
  /** 备案号 / 版权附加信息，可留空 */
  footerNote: '',
} as const

/**
 * GitHub 仓库信息：用于「一键发布」把 Markdown 提交回仓库。
 * 也可以在站内「设置」里临时修改（保存在浏览器本地）。
 */
export const githubConfig = {
  owner: 'lrbkdgw',
  repo: 'Blog',
  branch: 'main',
  /** 文章目录（相对仓库根目录） */
  postsDir: 'content/posts',
}

/**
 * 本地登录密码的 SHA-256（十六进制小写）。
 * 默认密码为：starlog
 *
 * ⚠️ 前端密码只是一道「不让人随手点进后台」的门帘，并非真正的安全边界
 *   （静态站点的所有代码都是公开的）。真正的写权限由 GitHub Token 控制。
 *
 * 修改方法：在浏览器控制台执行下面这段，把输出替换到这里：
 *   crypto.subtle.digest('SHA-256', new TextEncoder().encode('你的新密码'))
 *     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))
 */
export const AUTH_PASSWORD_SHA256 =
  import.meta.env.VITE_AUTH_PASSWORD_HASH ||
  '3f8d4abe496a6defe2a765df5a7a1200efbcbbaf044b842ae7424427dbbf0612'

export const STORAGE_KEYS = {
  theme: 'starlog:theme',
  font: 'starlog:font',
  fontAccounts: 'starlog:font-accounts',
  session: 'starlog:session',
  token: 'starlog:gh-token',
  ghUser: 'starlog:gh-user',
  ghRepo: 'starlog:gh-repo',
  drafts: 'starlog:drafts',
} as const
