import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import Home from './pages/Home'

const PostPage = lazy(() => import('./pages/PostPage'))
const Archive = lazy(() => import('./pages/Archive'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const About = lazy(() => import('./pages/About'))
const Login = lazy(() => import('./pages/Login'))
const Admin = lazy(() => import('./pages/Admin'))
const Editor = lazy(() => import('./pages/Editor'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const NotFound = lazy(() => import('./pages/NotFound'))

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
          <Route path="admin" element={protect(<Admin />)} />
          <Route path="admin/new" element={protect(<Editor />)} />
          <Route path="admin/edit/:slug" element={protect(<Editor />)} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
