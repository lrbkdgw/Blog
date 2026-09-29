import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * GitHub Pages 部署说明：
 * - 项目主页（https://<user>.github.io/<repo>/）：BASE_PATH 设为 "/<repo>/"，本仓库默认 "/Blog/"
 * - 用户主页（https://<user>.github.io/）：BASE_PATH 设为 "/"
 * 可以通过环境变量 VITE_BASE_PATH 覆盖（GitHub Actions 中已自动注入仓库名）。
 */
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = command === 'serve' ? '/' : env.VITE_BASE_PATH || '/Blog/'

  return {
    base,
    plugins: [
      react(),
      {
        // SPA 在 GitHub Pages 上刷新子路由会 404，复制一份 index.html 作为 404.html 兜底
        name: 'spa-404-fallback',
        closeBundle() {
          const dist = path.resolve(process.cwd(), 'dist')
          const index = path.join(dist, 'index.html')
          if (fs.existsSync(index)) {
            fs.copyFileSync(index, path.join(dist, '404.html'))
            fs.writeFileSync(path.join(dist, '.nojekyll'), '')
          }
        },
      },
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1200,
    },
  }
})
