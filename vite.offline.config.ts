import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { singleHtmlPlugin } from './scripts/vite-plugin-single-html.mjs'
import { attachLanCollabHub } from './scripts/lan-collab-hub.mjs'

/**
 * 离线单文件版构建配置：`npm run build:offline`
 *
 * 产物只有一个文件 —— `dist-offline/index.html`：JS、CSS、KaTeX 字体、favicon 与
 * 全部内置文章都在里面，双击即可在 `file://` 下运行，断网也能写作、排版、搜索、
 * 加密文章、看历史版本。
 *
 * 关键点（都是为「一个文件 + 断网可用」服务的）：
 *   - `base: './'` + `copyPublicDir: false`：不依赖站点根路径，也不留下需要额外分发的文件；
 *   - `inlineDynamicImports: true` + `cssCodeSplit: false`：只产出一个 JS chunk 与一个 CSS，
 *     内联插件据此拼装；出现多余产物时插件直接报错，不会「构建成功但文件不完整」；
 *   - `format: 'iife'`：`file://` 下 `type="module"` 脚本会被 CORS 拦住，必须用普通脚本；
 *   - `assetsInlineLimit` 拉到极大：让 Vite 自己就把字体 / 图片转成 data URI；
 *     即使它没内联，插件也会兜底转换，并在最后校验「不许再有未内联的引用」。
 *
 * 不注入任何 VITE_ 环境变量：离线版本身就应当完全脱机可用。
 */
const MAX_OFFLINE_BYTES = 48 * 1024 * 1024

export default defineConfig({
  base: './',
  define: {
    __STARLOG_OFFLINE__: 'true',
  },
  plugins: [
    react(),
    {
      // 离线版改标题，并打上构建标记（便于确认手里这个文件确实是离线版）
      name: 'starlog:offline-html-meta',
      apply: 'build',
      transformIndexHtml(html) {
        return html
          .replace(
            /<title>([^<]*)<\/title>/i,
            '<title>$1 · 离线版</title>\n    <meta name="starlog:build" content="offline-single-file" />',
          )
      },
    },
    {
      // 预览或开发离线版时，自动在同端口挂载局域网 IP + 房间号 WebSocket 协同中枢
      name: 'starlog:offline-lan-collab-hub',
      configureServer(server) {
        if (!server.httpServer) return
        const hub = attachLanCollabHub(server.httpServer)
        server.middlewares.use((req, res, next) => {
          if (hub.handleInfoRequest(req, res)) return
          next()
        })
      },
      configurePreviewServer(server) {
        if (!server.httpServer) return
        const hub = attachLanCollabHub(server.httpServer)
        server.middlewares.use((req, res, next) => {
          if (hub.handleInfoRequest(req, res)) return
          next()
        })
      },
    },
    singleHtmlPlugin({ maxBytes: MAX_OFFLINE_BYTES }),
  ],
  build: {
    outDir: 'dist-offline',
    emptyOutDir: true,
    copyPublicDir: false,
    target: 'es2020',
    minify: 'esbuild',
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 40000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'index.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
