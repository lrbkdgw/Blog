import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Github,
  HardDrive,
  LayoutDashboard,
  LogIn,
  LogOut,
  Mail,
  Menu,
  Moon,
  PenLine,
  Rss,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { siteConfig } from '../lib/config'
import { installHeaderYield, requestHeaderYieldRefresh } from '../lib/headerYield'
import { useTheme } from '../lib/theme'
import { DEFAULT_COLOR_THEME } from '../lib/themes'
import { useAuth } from '../lib/auth'
import { AnimatedBackdrop } from './AnimatedBackdrop'
import { useAnimatedBackground, useAnimatedSceneOverride, getSceneValues } from '../lib/animatedBackground'
import { SearchDialog } from './SearchDialog'
import { OFFLINE } from '../lib/runtime'
import { countLocalContent } from '../lib/offlineBundle'
import { ThemePicker } from './ThemePicker'
import logoVenti from '../assets/logo-venti.jpg'

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/archive', label: '归档' },
  { to: '/tags', label: '标签' },
  { to: '/toolbox', label: '百宝箱' },
  { to: '/about', label: '帮助' },
]

function ThemeToggle() {
  const { theme, toggle, colorTheme } = useTheme()
  // 开启配色主题后，明暗切换收进「配色主题」面板（面板里仍有浅色/深色/跟随系统），
  // 页头不再重复占位。
  if (colorTheme !== DEFAULT_COLOR_THEME) return null
  return (
    <button
      onClick={toggle}
      type="button"
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      title={theme === 'dark' ? '浅色模式' : '深色模式'}
      className="btn-ghost relative h-9 w-9 overflow-hidden !px-0"
    >
      <Sun
        size={18}
        className={`absolute transition-all duration-300 ${
          theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
        }`}
      />
      <Moon
        size={18}
        className={`absolute transition-all duration-300 ${
          theme === 'dark' ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
      />
    </button>
  )
}

function Logo() {
  return (
    <Link to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="回到首页">
      <img
        src={logoVenti}
        alt="温迪"
        width={30}
        height={30}
        fetchPriority="high"
        className="h-[30px] w-[30px] rounded-full object-cover ring-1 ring-ink-900/[0.08] transition duration-300 ease-smooth group-hover:ring-brand-400/60 dark:ring-white/[0.12]"
      />
      <span className="hidden flex-col leading-none sm:flex">
        <span className="text-[14px] font-semibold tracking-tight text-ink-900 dark:text-white">
          {siteConfig.title}
        </span>
        {siteConfig.titleEn ? (
          <span className="mt-[3px] font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-ink-500">
            {siteConfig.titleEn}
          </span>
        ) : null}
      </span>
    </Link>
  )
}

function UserMenu() {
  const { isAuthed, ghUser, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  if (!isAuthed) {
    return (
      <Link to="/login" className="btn-outline hidden h-9 sm:inline-flex">
        <LogIn size={15} />
        登录
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-ink-200 bg-ink-900 text-[11px] font-semibold text-white transition duration-200 hover:ring-[3px] hover:ring-ink-900/[0.08] dark:border-white/[0.12] dark:bg-white/[0.12] dark:hover:ring-white/[0.1]"
        aria-label="账户菜单"
      >
        {ghUser?.avatar_url ? (
          <img src={ghUser.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          (siteConfig.author.name[0] || 'A').toUpperCase()
        )}
      </button>

      {open && (
        <div className="card-pop absolute right-0 top-10 w-56 animate-scale-in overflow-hidden p-1.5">
          <div className="border-b border-ink-200/70 px-3 py-2.5 dark:border-white/[0.08]">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-white">
              {ghUser?.name || ghUser?.login || siteConfig.author.name}
            </p>
            <p className="truncate text-xs text-ink-400">
              {ghUser ? `GitHub 账号 · @${ghUser.login}` : '已登录'}
            </p>
          </div>
          {[
            { to: '/admin', icon: LayoutDashboard, label: '内容管理' },
            { to: '/admin/new', icon: PenLine, label: '写新文章' },
            { to: '/admin/settings', icon: Settings, label: '设置' },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-600 transition duration-150 hover:bg-ink-900/[.045] hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/[.06] dark:hover:text-white"
            >
              <item.icon size={15} />
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => {
              logout()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-rose-600 transition duration-150 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}

function Header({ onSearch }: { onSearch: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isAuthed } = useAuth()
  const location = useLocation()

  useEffect(() => setMobileOpen(false), [location.pathname])

  return (
    <header className="site-header no-print sticky top-0 z-50">
      <div className="container-page flex h-[4.25rem] items-center gap-2">
        <Logo />

        {/* 主导航：居中偏左的纯文字标签，选中态只用一条下划线，不加底色块 */}
        <nav className="ml-4 hidden items-center gap-0.5 md:flex" aria-label="主导航">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative rounded-lg px-2.5 py-1.5 text-[13.5px] transition duration-200 ${
                  isActive
                    ? 'font-medium text-ink-900 dark:text-white'
                    : 'text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  <span
                    className={`absolute inset-x-2.5 -bottom-0.5 h-[1.5px] rounded-full bg-brand-500 transition-all duration-300 ease-smooth ${
                      isActive ? 'opacity-100' : 'scale-x-0 opacity-0'
                    }`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {/* 搜索：宽屏是一条带快捷键提示的胶囊，窄屏收成图标 */}
          <button
            onClick={onSearch}
            className="group hidden h-8 items-center gap-2 rounded-full border border-ink-200/80 bg-white/60 pl-2.5 pr-1.5 text-[12.5px] text-ink-400 transition duration-200 hover:border-ink-300 hover:text-ink-700 sm:inline-flex dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-ink-500 dark:hover:border-white/[0.16] dark:hover:text-ink-200"
            aria-label="搜索"
          >
            <Search size={14} />
            <span className="hidden lg:inline">搜索</span>
            <kbd className="ml-1 rounded-[5px] border border-ink-200/80 bg-ink-50 px-1.5 pb-[1px] font-mono text-[10px] leading-4 text-ink-400 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-ink-500">
              ⌘K
            </kbd>
          </button>
          <button onClick={onSearch} className="btn-ghost h-8 w-8 !px-0 sm:hidden" aria-label="搜索">
            <Search size={17} />
          </button>

          <Link
            to="/settings"
            className="btn-ghost h-8 w-8 !px-0"
            title="设置"
            aria-label="设置"
          >
            <Settings size={16} />
          </Link>

          <OfflineBadge />

          <ThemePicker />

          <ThemeToggle />

          <Link to="/admin/new" className="btn-primary ml-1 hidden h-8 sm:inline-flex">
            <PenLine size={14} />
            写文章
          </Link>

          {/* 离线版没有账号体系：不登录、也不能登录（那需要联网） */}
          {!OFFLINE && <UserMenu />}

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="btn-ghost h-8 w-8 !px-0 md:hidden"
            aria-label="菜单"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="site-header-panel animate-fade-in md:hidden">
          <nav className="container-page flex flex-col py-3" aria-label="移动端导航">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-[14px] transition ${
                    isActive
                      ? 'bg-brand-500/[0.08] font-medium text-ink-900 dark:text-white'
                      : 'text-ink-600 hover:bg-ink-900/[.04] dark:text-ink-300 dark:hover:bg-white/[.05]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-2 flex gap-2 border-t border-ink-200/60 pt-3 dark:border-white/[0.08]">
              <Link to="/settings" className="btn-outline">
                <Settings size={15} />
                设置
              </Link>
              {OFFLINE ? (
                <>
                  <Link to="/admin" className="btn-outline flex-1">
                    <LayoutDashboard size={15} />
                    管理
                  </Link>
                  <Link to="/admin/new" className="btn-primary flex-1">
                    <PenLine size={15} />
                    写文章
                  </Link>
                </>
              ) : isAuthed ? (
                <>
                  <Link to="/admin" className="btn-outline flex-1">
                    <LayoutDashboard size={15} />
                    管理
                  </Link>
                  <Link to="/admin/new" className="btn-primary flex-1">
                    <PenLine size={15} />
                    写文章
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/admin/new" className="btn-outline flex-1">
                    <PenLine size={15} />
                    写文章
                  </Link>
                  <Link to="/login" className="btn-primary flex-1">
                    <LogIn size={15} />
                    登录
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

function Footer() {
  const { social } = siteConfig
  // 离线版不联网：GitHub / RSS 这类外链在这里点了也没用，只保留 mailto（由邮件客户端处理，不是网络请求）
  const links = (
    [
      !OFFLINE && social.github && { href: social.github, icon: Github, label: 'GitHub' },
      social.email && { href: `mailto:${social.email}`, icon: Mail, label: 'Email' },
      !OFFLINE && social.rss && { href: social.rss, icon: Rss, label: 'RSS' },
    ].filter(Boolean) as { href: string; icon: typeof Github; label: string }[]
  )

  return (
    <footer className="no-print mt-24" data-yield-list>
      <div className="container-page">
        <div className="hairline" />
        <div className="flex flex-col items-center justify-between gap-6 py-10 sm:flex-row">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <p className="text-[12.5px] font-medium text-ink-600 dark:text-ink-300">
              © {new Date().getFullYear()} {siteConfig.author.name}
              {siteConfig.footerNote ? ` · ${siteConfig.footerNote}` : ''}
            </p>
            <p className="text-[11.5px] text-ink-400 dark:text-ink-500">
              {OFFLINE ? '离线单文件版 · 全程不联网' : 'Markdown + KaTeX · React + Vite · GitHub Pages'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                aria-label={l.label}
                className="btn-ghost h-8 w-8 !px-0"
              >
                <l.icon size={16} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

function AnimatedBackdropLayer({ ignoreOverride = false }: { ignoreOverride?: boolean }) {
  const pref = useAnimatedBackground()
  // 文章开头的 ::set-background[<id>]（issue #59）可在阅读本文时临时强制场景，
  // 参数仍用读者为该场景保存（或默认）的值；回声洞等独立全屏页始终使用用户自己选择的背景。
  const override = useAnimatedSceneOverride()
  const scene = ignoreOverride ? pref.scene : (override ?? pref.scene)
  if (scene === 'none') return null
  return <AnimatedBackdrop scene={scene} values={getSceneValues(pref, scene)} />
}

/**
 * 离线版页头徽标。
 *
 * 只说两件事：这是离线文件（不联网）、本机已经写了多少篇。
 * 点进去是「离线文章包」面板——导出文件给线上站点，不在这个文件里做任何网络请求。
 */
function OfflineBadge() {
  const [local, setLocal] = useState(() => (OFFLINE ? countLocalContent() : null))
  useEffect(() => {
    if (!OFFLINE) return
    const refresh = () => setLocal(countLocalContent())
    window.addEventListener('starlog:posts-changed', refresh)
    window.addEventListener('starlog:queue-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('starlog:posts-changed', refresh)
      window.removeEventListener('starlog:queue-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  if (!OFFLINE) return null
  const count = (local?.posts ?? 0) + (local?.drafts ?? 0)
  return (
    <Link
      to="/admin?tab=export"
      title={`离线版：本站不发起任何网络请求。本机已写 ${count} 篇${local && local.images > 0 ? `、暂存 ${local.images} 张图片` : ''}；点这里导出文章包后在线上站点导入`}
      className="btn-ghost h-8 gap-1.5 !px-2 text-[12px]"
    >
      <HardDrive size={15} />
      <span className="hidden lg:inline">离线版</span>
      {count > 0 && (
        <span className="rounded-full bg-ink-500/12 px-1.5 py-0.5 text-[10px] font-bold text-ink-600 dark:text-ink-200">
          本机 {count} 篇
        </span>
      )}
    </Link>
  )
}

export const EDITOR_FULLSCREEN_EVENT = 'starlog:editor-fullscreen'

export function setEditorFullscreenActive(active: boolean) {
  if (typeof document !== 'undefined') {
    if (active) document.documentElement.dataset.editorFullscreen = 'true'
    else delete document.documentElement.dataset.editorFullscreen
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<boolean>(EDITOR_FULLSCREEN_EVENT, { detail: active }))
  }
}

export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const { pathname, search } = useLocation()
  const isFullscreen = /^\/toolbox\/echo(?:\/|$)/.test(pathname)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    // 换页之后正文不一定触发滚动事件，主动请重算一次「让路」状态（issue #71 / #78）
    requestHeaderYieldRefresh()
  }, [pathname])

  useEffect(() => {
    requestHeaderYieldRefresh()
  }, [search])

  const [editorFullscreen, setEditorFullscreen] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.editorFullscreen === 'true',
  )
  const hideChrome = isFullscreen || editorFullscreen

  useEffect(() => {
    const onFullscreenChange = (e: Event) => {
      const next = Boolean((e as CustomEvent<boolean>).detail)
      setEditorFullscreen(next)
      if (next) setSearchOpen(false)
    }
    window.addEventListener(EDITOR_FULLSCREEN_EVENT, onFullscreenChange)
    return () => window.removeEventListener(EDITOR_FULLSCREEN_EVENT, onFullscreenChange)
  }, [])

  // issue #71：正文滚到页头这一栏下方时先渐变淡掉（只改正文，不碰背景）
  useEffect(() => installHeaderYield(), [])

  useEffect(() => {
    if (hideChrome) return
    const onKey = (e: KeyboardEvent) => {
      // 编辑器内已消费的快捷键（例如 ⌘K / Ctrl+K 插入链接）不再触发全站搜索弹层
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if (e.key === '/' && !/input|textarea/i.test((e.target as HTMLElement)?.tagName || '')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hideChrome])

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* 背景装饰：正序 z-0 图层确保任何 stacking context 下都不会被 body 底色遮挡 */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="site-background-glow-primary absolute -left-40 -top-40 h-[32rem] w-[32rem] animate-float rounded-full blur-[110px]" />
        <div
          className="site-background-glow-secondary absolute -right-32 top-40 h-[26rem] w-[26rem] animate-float rounded-full blur-[110px]"
          style={{ animationDelay: '-4s' }}
        />
        <div className="site-background-hairline absolute inset-x-0 top-0 h-px" />
        {/* 动态背景（樱花 / 粒子星链 / 雪花 / 暴雨 / 竹林）：回声洞始终沿用用户自己选择的背景 */}
        <AnimatedBackdropLayer ignoreOverride={isFullscreen} />
      </div>

      {!hideChrome && <Header onSearch={() => setSearchOpen(true)} />}
      {/* 注意：main 保持 z-index: auto（不设 z-10），既能按 DOM 顺序盖在 fixed z-0 背景之上，
          又不会创建独立层叠上下文把全屏编辑器（z-[80]）与弹窗（z-[90+]）压在页头（z-50）下面。 */}
      <main className="relative flex-1">
        <Outlet />
      </main>
      {!hideChrome && (
        <div className="relative">
          <Footer />
        </div>
      )}
      {!hideChrome && <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
