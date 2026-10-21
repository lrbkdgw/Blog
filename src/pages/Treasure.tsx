import { ChevronRight, Github, Sparkles, Waves } from 'lucide-react'
import { Link } from 'react-router-dom'
import { echoCaveConfig } from '../lib/config'

/**
 * 百宝箱（issue #93）。
 *
 * 页头导航上的一个独立入口，用来收纳「和写文章无关、但有点好玩」的小模块。
 * 现在只有「回声洞」一个模块；以后新增模块时，往 `MODULES` 里加一项即可。
 */
interface TreasureModule {
  to: string
  title: string
  subtitle: string
  description: string
  icon: typeof Waves
  tags: string[]
  /** 卡片右侧的强调色（Tailwind 渐变，浅色 / 深色各一套） */
  glow: string
}

const MODULES: TreasureModule[] = [
  {
    to: '/treasure/echo',
    title: '回声洞',
    subtitle: 'Echo Cave',
    description:
      '把想说的话折成小船丢进洞里。轻点屏幕，会听见来自洞里的回声——有些来自 hitokoto，有些来自每一个路过并留下声音的人。',
    icon: Waves,
    tags: ['点击显示', 'GitHub Discussions', `每人每小时 ${echoCaveConfig.perHour} 条 · 每天 ${echoCaveConfig.perDay} 条`],
    glow: 'from-sky-400/20 via-brand-400/10 to-indigo-400/20 dark:from-sky-400/15 dark:via-brand-500/10 dark:to-indigo-500/15',
  },
]

export default function Treasure() {
  return (
    <div className="container-page max-w-4xl pt-16" data-yield-list>
      <header className="animate-fade-up">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-600 dark:text-brand-300">
          <Sparkles size={13} />
          百宝箱 · Treasure Box
        </div>
        <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          百宝箱
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          一些和写文章无关、但偶尔想打开看看的小东西。每个模块都是一扇独立的小门，点进去就好。
        </p>
      </header>

      <section className="mt-10 grid gap-5 sm:grid-cols-2" data-yield-list>
        {MODULES.map((module, index) => (
          <Link
            key={module.to}
            to={module.to}
            className="card group relative flex animate-fade-up flex-col overflow-hidden p-6 transition duration-200 hover:-translate-y-1 hover:border-brand-300 dark:hover:border-brand-400/30"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity duration-300 group-hover:opacity-100 ${module.glow}`}
              aria-hidden
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 text-brand-600 shadow-sm ring-1 ring-brand-500/15 dark:bg-white/10 dark:text-brand-300 dark:ring-white/10">
                  <module.icon size={21} />
                </span>
                <div>
                  <h2 className="font-serif text-xl font-bold text-ink-900 dark:text-white">{module.title}</h2>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-ink-400">{module.subtitle}</p>
                </div>
              </div>
              <ChevronRight
                size={18}
                className="mt-1 shrink-0 text-ink-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-ink-500"
              />
            </div>

            <p className="relative mt-4 flex-1 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
              {module.description}
            </p>

            <div className="relative mt-5 flex flex-wrap gap-1.5">
              {module.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}

        <div className="flex min-h-[13rem] flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 p-6 text-center dark:border-white/10">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-500/5 text-ink-300 dark:bg-white/5 dark:text-ink-500">
            <Sparkles size={18} />
          </span>
          <p className="mt-3 text-sm font-medium text-ink-500 dark:text-ink-400">还有几个小东西在打磨中</p>
          <p className="mt-1 text-xs text-ink-400 dark:text-ink-500">想放什么进来，也可以写在回声洞里。</p>
        </div>
      </section>

      <p className="mt-10 flex items-center gap-1.5 text-xs text-ink-400">
        <Github size={13} />
        回声洞的内容保存在目标仓库的 GitHub Discussions 里，和文章评论共用同一套授权。
      </p>
    </div>
  )
}
