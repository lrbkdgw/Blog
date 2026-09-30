# OAuth Relay —— 极简 CORS 中转

> 💡 如果把整个博客托管到 **Cloudflare Pages**（见根目录 README「路线 A」），
> 仓库内置的 `functions/login/[[path]].ts` 会提供同源中转，**不需要部署本 Worker**。
> 本目录只服务于 **GitHub Pages** 部署的场景。

静态站点（GitHub Pages）无法直接调用 GitHub 的 OAuth 接口：`github.com/login/*`
端点不返回 CORS 头，浏览器读不到响应。这个不到 100 行的 Worker 只转发 OAuth
Device Flow 需要的两个端点，并补上 CORS 头：

- `POST /login/device/code` —— 申请设备验证码
- `POST /login/oauth/access_token` —— 换取 access token

> Device Flow 不需要 `client_secret`，这个中转**不包含任何机密信息**，只做透明转发，
> 并有路径/方法白名单与请求体大小限制。它也可以部署到 Deno Deploy、Vercel Edge
> Functions 等任意支持 Web API 的平台。

## 部署到 Cloudflare Workers（免费额度足够）

### 方式 A：命令行（wrangler）

```bash
cd oauth-relay
npx wrangler login          # 首次使用，登录 Cloudflare
npx wrangler deploy         # 按 worker.js/wrangler.toml 部署
```

输出里会看到 Worker 地址，形如 `https://starlog-oauth-relay.<你的子域>.workers.dev`。

### 方式 B：网页控制台（不用装任何东西）

1. 打开 <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker** → Deploy。
2. 点 **Edit code**，把 `worker.js` 的全部内容粘进去覆盖默认代码 → **Deploy**。
3. 在 **Settings → Domains & Routes** 里可以看到 Worker 的默认地址。

### 拿到 Worker 地址后

把它填到主项目的 `src/lib/config.ts`：

```ts
export const oauthConfig = {
  clientId: '<OAuth App 的 Client ID>',
  scope: 'public_repo',
  relayUrl: 'https://starlog-oauth-relay.<你的子域>.workers.dev',
}
```

或者用环境变量（本地 `.env.local` / GitHub Actions Variables，见根目录 README）：

```bash
VITE_OAUTH_RELAY_URL=https://starlog-oauth-relay.<你的子域>.workers.dev
```

## 可选：锁定来源域名

默认 `Access-Control-Allow-Origin: *`。由于中转不含机密，这样是安全的；
如想更严格，在 `wrangler.toml` 的 `[vars]` 或控制台 **Settings → Variables** 中设置：

```
ALLOWED_ORIGIN = https://<user>.github.io
```

## 自测

```bash
curl -X POST https://<你的 Worker 地址>/login/device/code \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'client_id=<Client ID>&scope=public_repo' -i
```

应返回 200，响应头中带 `access-control-allow-origin`，响应体含 `user_code`。
