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
 * GitHub OAuth 登录（Device Flow，RFC 8628）。
 *
 * 纯静态站点无法直接调用 GitHub 的 OAuth 接口：github.com 的 /login/* 端点
 * 不支持跨域（CORS），浏览器读不到响应，因此前端会经过一个极简中转
 * （Device Flow 不需要 client_secret，中转不含任何机密，只做转发）。
 *
 * 中转的两种形态，按部署平台二选一：
 *
 * A. Cloudflare Pages 部署（推荐，最省事）：
 *    仓库自带 functions/login/[[path]].ts，部署后自动成为同源中转，
 *    relayUrl 留空即可，无需任何额外服务。
 *
 * B. GitHub Pages 部署：
 *    把仓库自带 oauth-relay/worker.js 部署为一个独立的 Cloudflare Worker
 *    （见 oauth-relay/README.md，约 2 分钟），把它的地址填到 relayUrl。
 *
 * 另外都需要一个启用了 Device Flow 的 OAuth App（免费，只需名字 + 主页地址）：
 *      https://github.com/settings/developers → New OAuth App → 勾选
 *      “Enable Device Flow”，把 Client ID 填到下面的 clientId。
 *
 * 配置也可以用环境变量（本地 .env.local / CI 变量，避免改代码）：
 *    VITE_GITHUB_CLIENT_ID / VITE_OAUTH_RELAY_URL
 */
export const oauthConfig = {
  /** OAuth App 的 Client ID */
  clientId: 'Ov23lid9P8sdNuiKhkzy',
  /**
   * 申请权限范围：public_repo = 读写公开仓库；
   * 若博客仓库是私有的，需要改成 'repo'。
   */
  scope: 'public_repo',
  /**
   * OAuth 中转地址：
   * - Cloudflare Pages 部署：留空（自动走仓库内置的同源 Pages Function）
   * - GitHub Pages 部署：必填，为 oauth-relay Worker 地址，如 https://xxx.workers.dev
   */
  relayUrl: '',
}

export const STORAGE_KEYS = {
  theme: 'starlog:theme',
  font: 'starlog:font',
  fontAccounts: 'starlog:font-accounts',
  background: 'starlog:background',
  backgroundAccounts: 'starlog:background-accounts',
  /** 集中保存个人偏好；采用和评论区一致的 localStorage + 事件更新方式。 */
  personalSettings: 'starlog:personal-settings',
  session: 'starlog:session',
  /** GitHub OAuth 授权拿到的访问令牌（仅存于浏览器本地） */
  token: 'starlog:gh-token',
  ghUser: 'starlog:gh-user',
  ghRepo: 'starlog:gh-repo',
  drafts: 'starlog:drafts',
} as const
