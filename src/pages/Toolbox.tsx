import { Link } from 'react-router-dom'
import { ArrowUpRight, Bike, PlaneLanding, Waves, type LucideIcon } from 'lucide-react'

interface ToolboxModule {
  to: string
  title: string
  desc: string
  icon: LucideIcon
}

const MODULES: ToolboxModule[] = [
  {
    to: '/toolbox/echo',
    title: '回声洞',
    desc: '轻点屏幕倾听来自远处的回声，或在洞底悄悄留下一句话。',
    icon: Waves,
  },
  {
    to: '/toolbox/pelican',
    title: '鹈鹕骑车',
    desc: '一只系着围巾的鹈鹕沿海滨公路蹬车兜风。纯 SVG + CSS 动画，可下载。',
    icon: Bike,
  },
  {
    to: '/toolbox/landing',
    title: '降落',
    desc: '客机进近、拉平、接地、减速的实时 3D 动画，可换机位、拖进度。',
    icon: PlaneLanding,
  },
]

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
        {MODULES.map(({ to, title, desc, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="card group relative flex flex-col justify-between p-6 transition hover:-translate-y-0.5 hover:border-brand-300 dark:hover:border-brand-400/30"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight text-ink-900 transition group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-300">
                  <Icon size={18} className="shrink-0 text-brand-500 dark:text-brand-300" aria-hidden />
                  {title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{desc}</p>
              </div>
              <ArrowUpRight
                size={18}
                className="mt-1 shrink-0 text-ink-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-500"
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
