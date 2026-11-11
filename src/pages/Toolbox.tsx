import { Link } from 'react-router-dom'
import { ArrowUpRight, Waves } from 'lucide-react'

export default function Toolbox() {
  return (
    <div className="container-page max-w-3xl pt-16 sm:pt-20" data-yield-list>
      <header className="animate-fade-up">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink-400 dark:text-ink-500">
          Toolbox
        </p>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.03em] text-ink-900 dark:text-white">
          百宝箱
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-500 dark:text-ink-400">收纳一些独立的小模块。</p>
      </header>

      <div className="mt-9 grid animate-fade-up gap-4 sm:grid-cols-2" style={{ animationDelay: '60ms' }} data-yield-list>
        <Link
          to="/toolbox/echo"
          className="card card-hover group relative flex flex-col justify-between p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ink-900/[.05] text-ink-500 transition-colors duration-300 group-hover:bg-brand-500/10 group-hover:text-brand-600 dark:bg-white/[.07] dark:text-ink-300 dark:group-hover:text-brand-300">
                <Waves size={15} />
              </span>
              <h2 className="mt-3.5 text-[15px] font-semibold tracking-tight text-ink-900 dark:text-white">
                回声洞
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500 dark:text-ink-400">
                轻点屏幕倾听来自远处的回声，或在洞底悄悄留下一句话。
              </p>
            </div>
            <ArrowUpRight
              size={16}
              className="mt-0.5 shrink-0 text-ink-300 transition-all duration-300 ease-smooth group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-ink-600"
            />
          </div>
        </Link>
      </div>
    </div>
  )
}
