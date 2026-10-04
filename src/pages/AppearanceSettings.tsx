import { Link } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { BackgroundSection, FontSection, ThemeSection } from '../components/AppearanceSections'
import { useAuth } from '../lib/auth'

/**
 * 个性化设置页（issue #9）：对所有人开放——
 * 访客无需登录即可设置主题 / 字体 / 背景，保存在本浏览器；
 * 登录并连接 GitHub 后还可以把偏好同步到账号。
 */
export default function AppearanceSettings() {
  const { isAuthed } = useAuth()
  return (
    <div className="container-page max-w-3xl pt-12">
      <header className="mb-8 animate-fade-up">
        <h1 className="flex items-center gap-2.5 font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">
          <Settings2 size={26} className="text-brand-500" />
          个性化设置
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          主题、字体与背景颜色对所有访客开放，设置会保存在当前浏览器。
          {isAuthed ? (
            <Link to="/admin/settings" className="ml-2 text-brand-600 hover:underline dark:text-brand-300">
              前往管理设置 →
            </Link>
          ) : (
            <Link to="/login" className="ml-2 text-brand-600 hover:underline dark:text-brand-300">
              登录后可同步到 GitHub 账号 →
            </Link>
          )}
        </p>
      </header>

      <div className="space-y-5">
        <ThemeSection />
        <FontSection />
        <BackgroundSection />
      </div>

      <div className="h-16" />
    </div>
  )
}
