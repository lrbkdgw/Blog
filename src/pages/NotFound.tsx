import { Link } from 'react-router-dom'
import { Home, Search } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[70vh] flex-col items-center justify-center gap-5 text-center">
      <p className="animate-fade-up bg-gradient-to-br from-brand-400 to-indigo-600 bg-clip-text font-mono text-7xl font-bold text-transparent sm:text-8xl">
        404
      </p>
      <h1 className="animate-fade-up font-serif text-2xl font-semibold text-ink-900 dark:text-white" style={{ animationDelay: '60ms' }}>
        这个页面走丢了
      </h1>
      <p className="max-w-sm animate-fade-up text-sm text-ink-500" style={{ animationDelay: '120ms' }}>
        你要找的内容可能已被移动或删除。试试从首页重新开始，或者搜索一下。
      </p>
      <div className="mt-2 flex animate-fade-up gap-3" style={{ animationDelay: '180ms' }}>
        <Link to="/" className="btn-primary h-10">
          <Home size={16} />
          回到首页
        </Link>
        <Link to="/archive" className="btn-outline h-10">
          <Search size={16} />
          浏览归档
        </Link>
      </div>
    </div>
  )
}
