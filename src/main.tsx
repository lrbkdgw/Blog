// 必须排在最前：离线版在模块求值阶段接管 localStorage（详见 lib/offlineStorage.ts），
// 晚于业务模块 import 就会让首屏读到未接管的存储。
import './lib/offlineStorage'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './lib/theme'
import { FontProvider } from './lib/font'
import { BackgroundProvider } from './lib/background'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './components/Toast'
import { StorageGuard } from './components/StorageGuard'
import { initOfflineStorage } from './lib/offlineStorage'
import { OFFLINE } from './lib/runtime'
import './styles/index.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

function Tree() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FontProvider>
          <BackgroundProvider>
            <ToastProvider>
              <StorageGuard>
                <App />
              </StorageGuard>
            </ToastProvider>
          </BackgroundProvider>
        </FontProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

async function boot() {
  if (OFFLINE) {
    try {
      await initOfflineStorage()
    } catch (err) {
      // 初始化异常不阻塞渲染：StorageGuard 会显示阻断式错误页
      console.error('[离线存储] 初始化失败', err)
    }
  }

  // file:// 下 History API 的路径不可用，离线版一律使用 hash 路由
  let tree: ReactNode = <Tree />
  if (OFFLINE) {
    tree = <HashRouter>{tree}</HashRouter>
  } else {
    tree = (
      <BrowserRouter basename={basename || '/'}>
        {tree}
      </BrowserRouter>
    )
  }

  createRoot(document.getElementById('root')!).render(<StrictMode>{tree}</StrictMode>)
}

void boot()
