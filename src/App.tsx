import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import Home from './pages/Home'

/**
 * 修复 #13「首次打开 tags 页时卡死」：
 * 每次发布文章都会触发整站重新部署，部署完成后旧的懒加载 chunk 会失效——
 * 此时从旧页面点击导航，动态 import 会 404，页面看起来就像卡死了，只能手动刷新。
 * 这里在 chunk 加载失败时自动刷新一次拿到新版本；30 秒内不重复刷新，防止死循环。
 */
const CHUNK_RELOAD_KEY = 'starlog:chunk-reload-at'
const CHUNK_RELOAD_WINDOW = 30_000

function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}

function safeSessionRemove(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends { default: React.ComponentType<any> }>(factory: () => Promise<T>) {
  return lazy(async () => {
    try {
      const mod = await factory()
      safeSessionRemove(CHUNK_RELOAD_KEY)
      return mod
    } catch (err) {
      const last = Number(safeSessionGet(CHUNK_RELOAD_KEY) || 0)
      if (Date.now() - last > CHUNK_RELOAD_WINDOW) {
        safeSessionSet(CHUNK_RELOAD_KEY, String(Date.now()))
        window.location.reload()
        // 页面即将刷新，永远不 resolve，避免短暂渲染出错内容
        return new Promise<T>(() => {})
      }
      throw err
    }
  })
}

const PostPage = lazyWithRetry(() => import('./pages/PostPage'))
const Archive = lazyWithRetry(() => import('./pages/Archive'))
const TagsPage = lazyWithRetry(() => import('./pages/TagsPage'))
const About = lazyWithRetry(() => import('./pages/About'))
const Login = lazyWithRetry(() => import('./pages/Login'))
const Admin = lazyWithRetry(() => import('./pages/Admin'))
const Editor = lazyWithRetry(() => import('./pages/Editor'))
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'))
const AppearanceSettings = lazyWithRetry(() => import('./pages/AppearanceSettings'))
const NotFound = lazyWithRetry(() => import('./pages/NotFound'))

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  )
}

const protect = (node: React.ReactNode) => <ProtectedRoute>{node}</ProtectedRoute>

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="posts/:slug" element={<PostPage />} />
            <Route path="archive" element={<Archive />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="tags/:tag" element={<TagsPage />} />
            <Route path="about" element={<About />} />
            <Route path="login" element={<Login />} />
            {/* 个性化设置对访客开放（issue #9），不放在 ProtectedRoute 里 */}
            <Route path="settings" element={<AppearanceSettings />} />
            <Route path="admin" element={protect(<Admin />)} />
            <Route path="admin/new" element={protect(<Editor />)} />
            <Route path="admin/edit/:slug" element={protect(<Editor />)} />
            <Route path="admin/settings" element={protect(<SettingsPage />)} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
