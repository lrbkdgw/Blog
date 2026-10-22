import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'

export default function Toolbox() {
  return (
    <div className="container-page max-w-4xl pt-16" data-yield-list>
      <header className="animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          百宝箱
        </h1>
        <p className="mt-2 text-sm text-ink-500">收纳一些独立的小模块。</p>
      </header>

      <div className="mt-10 grid gap-5 sm:grid-cols-2" data-yield-list>
        <Link
          to="/toolbox/echo"
          className="card group relative flex flex-col justify-between p-6 transition hover:-translate-y-0.5 hover:border-brand-300 dark:hover:border-brand-400/30"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-xl font-semibold tracking-tight text-ink-900 transition group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-300">
                回声洞
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                轻点屏幕倾听来自远处的回声，或在洞底悄悄留下一句话。
              </p>
            </div>
            <ArrowUpRight
              size={18}
              className="mt-1 shrink-0 text-ink-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-500"
            />
          </div>
        </Link>
      </div>
    </div>
  )
}
