import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Github,
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
import { useTheme } from '../lib/theme'
import { useAuth } from '../lib/auth'
import { SearchDialog } from './SearchDialog'
import logoVenti from '../assets/logo-venti.jpg'

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/archive', label: '归档' },
  { to: '/tags', label: '标签' },
  { to: '/about', label: '关于' },
]

function ThemeToggle() {
  const { theme, toggle } = useTheme()
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
    <Link to="/" className="group flex shrink-0 items-center" aria-label="回到首页">
      <img
        src={logoVenti}
        alt="温迪"
        width={40}
        height={40}
        fetchPriority="high"
        className="h-10 w-10 rounded-xl object-cover shadow-md shadow-brand-600/20 ring-1 ring-black/5 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 dark:ring-white/10"
      />
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
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-ink-200 bg-gradient-to-br from-brand-400 to-indigo-600 text-xs font-bold text-white transition hover:ring-4 hover:ring-brand-500/15 dark:border-white/15"
        aria-label="账户菜单"
      >
        {ghUser?.avatar_url ? (
          <img src={ghUser.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          (siteConfig.author.name[0] || 'A').toUpperCase()
        )}
      </button>

      {open && (
        <div className="card absolute right-0 top-11 w-56 animate-scale-in overflow-hidden p-1.5 !bg-white/95 dark:!bg-ink-900/95">
          <div className="border-b border-ink-200/70 px-3 py-2.5 dark:border-white/10">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-white">
              {ghUser?.name || ghUser?.login || siteConfig.author.name}
            </p>
            <p className="truncate text-xs text-ink-400">
              {ghUser ? `已连接 GitHub · @${ghUser.login}` : '本地登录 · 仅浏览器草稿'}
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
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-600 transition hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5"
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
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
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
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isAuthed } = useAuth()
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => setMobileOpen(false), [location.pathname])

  return (
    <header
      className={`no-print sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-ink-200/60 bg-white/75 backdrop-blur-xl dark:border-white/[0.08] dark:bg-ink-950/75'
          : 'border-b border-transparent'
      }`}
    >
      <div className="container-page flex h-16 items-center gap-3">
        <Logo />

        <nav className="ml-3 hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive && (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-brand-400 to-indigo-500" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onSearch}
            className="btn-ghost group hidden h-9 gap-2 !px-3 text-ink-400 sm:inline-flex"
            aria-label="搜索"
          >
            <Search size={16} />
            <span className="hidden text-xs lg:inline">搜索</span>
            <kbd className="hidden rounded border border-ink-200 px-1.5 font-mono text-[10px] lg:inline dark:border-white/15">
              ⌘K
            </kbd>
          </button>
          <button onClick={onSearch} className="btn-ghost h-9 w-9 !px-0 sm:hidden" aria-label="搜索">
            <Search size={17} />
          </button>

          <Link to="/settings" className="btn-ghost h-9 w-9 !px-0 text-ink-500 hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300" title="设置" aria-label="设置">
            <Settings size={18} />
          </Link>

          <ThemeToggle />

          {isAuthed && (
            <Link to="/admin/new" className="btn-primary hidden h-9 sm:inline-flex">
              <PenLine size={15} />
              写文章
            </Link>
          )}

          <UserMenu />

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="btn-ghost h-9 w-9 !px-0 md:hidden"
            aria-label="菜单"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="animate-fade-in border-t border-ink-200/60 bg-white/95 backdrop-blur-xl md:hidden dark:border-white/10 dark:bg-ink-950/95">
          <nav className="container-page flex flex-col py-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'text-ink-600 dark:text-ink-300'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-2 flex gap-2 border-t border-ink-200/60 pt-3 dark:border-white/10">
              <Link to="/settings" className="btn-outline">
                <Settings size={15} />
                设置
              </Link>
              {isAuthed ? (
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
                <Link to="/login" className="btn-primary flex-1">
                  <LogIn size={15} />
                  登录
                </Link>
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
  const links = [
    social.github && { href: social.github, icon: Github, label: 'GitHub' },
    social.email && { href: `mailto:${social.email}`, icon: Mail, label: 'Email' },
    social.rss && { href: social.rss, icon: Rss, label: 'RSS' },
  ].filter(Boolean) as { href: string; icon: typeof Github; label: string }[]

  return (
    <footer className="no-print mt-24 border-t border-ink-200/60 py-10 dark:border-white/[0.08]">
      <div className="container-page flex flex-col items-center justify-between gap-5 sm:flex-row">
        <div className="text-center sm:text-left">
          <p className="text-xs text-ink-400">
            © {new Date().getFullYear()} {siteConfig.author.name}
            {siteConfig.footerNote ? ` · ${siteConfig.footerNote}` : ''} · 由 React + Vite 驱动，托管于 GitHub Pages
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              aria-label={l.label}
              className="btn-ghost h-9 w-9 !px-0"
            >
              <l.icon size={17} />
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}

export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      {/* 背景装饰 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="site-background-glow-primary absolute -left-40 -top-40 h-[32rem] w-[32rem] animate-float rounded-full blur-[110px]" />
        <div
          className="site-background-glow-secondary absolute -right-32 top-40 h-[26rem] w-[26rem] animate-float rounded-full blur-[110px]"
          style={{ animationDelay: '-4s' }}
        />
        <div className="site-background-hairline absolute inset-x-0 top-0 h-px" />
      </div>

      <Header onSearch={() => setSearchOpen(true)} />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
