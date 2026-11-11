import { Link } from 'react-router-dom'
import { ArrowLeft, Search } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[70vh] flex-col items-start justify-center py-16" data-yield-list>
      <p className="animate-fade-up font-mono text-[11.5px] font-medium uppercase tracking-[0.18em] text-ink-400 dark:text-ink-500">
        Error 404
      </p>
      <h1
        className="mt-4 animate-fade-up text-[2.4rem] font-semibold leading-[1.1] tracking-[-0.035em] text-ink-900 sm:text-[3.2rem] dark:text-white"
        style={{ animationDelay: '50ms' }}
      >
        这个页面走丢了
      </h1>
      <p
        className="mt-3 max-w-md animate-fade-up text-[14px] leading-[1.8] text-ink-500 dark:text-ink-400"
        style={{ animationDelay: '100ms' }}
      >
        你要找的内容可能已被移动或删除。试试从首页重新开始，或者到归档里翻一翻。
      </p>
      <div className="mt-7 flex animate-fade-up flex-wrap gap-2.5" style={{ animationDelay: '150ms' }}>
        <Link to="/" className="btn-primary h-9">
          <ArrowLeft size={14} />
          回到首页
        </Link>
        <Link to="/archive" className="btn-outline h-9">
          <Search size={14} />
          浏览归档
        </Link>
      </div>
    </div>
  )
}
