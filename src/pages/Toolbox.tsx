import { Link } from 'react-router-dom'
import { ArrowRight, Database, HardDrive, Package, Sparkles, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { OFFLINE } from '../lib/runtime'

/**
 * 百宝箱（issue #93）：顶部导航新增的工具集合页。
 *
 * 目前只有「回声洞」一个模块。之后要再加小工具时，在 TOOLS 里加一项并在
 * App.tsx 里补一条 /toolbox/<id> 路由即可，卡片样式与说明会自动排好。
 */
interface ToolboxTool {
  id: string
  to: string
  name: string
  tagline: string
  description: string
  icon: LucideIcon
  /** 数据从哪来（写在卡片底部，让访客点进去之前心里有数） */
  sources: string[]
}

const TOOLS: ToolboxTool[] = [
  {
    id: 'echo-cave',
    to: '/toolbox/echo-cave',
    name: '回声洞',
    tagline: '轻敲石壁，听一句留给后来人的话',
    description:
      '每点一次，洞里就传回一句随机的回声：有的是访客们留在这里的话，有的来自 hitokoto 一言。你也可以在页面下方的横线上留下一句，它会被保存到 GitHub Discussions，等着被后来的人听到。',
    icon: Waves,
    sources: ['GitHub Discussions', 'hitokoto 一言'],
  },
]

export default function Toolbox() {
  return (
    <div className="container-page max-w-4xl pt-16" data-yield-list>
      <header className="animate-fade-up">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-600 dark:text-brand-300">
          <Package size={13} />
          百宝箱 · 站内小工具
        </div>
        <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          百宝箱
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          文章之外的小玩意都收在这里。目前有 {TOOLS.length} 个模块，点开卡片就能进去玩。
        </p>
      </header>

      {OFFLINE && (
        <div className="mt-6 flex animate-fade-up gap-2.5 rounded-xl border border-amber-300/50 bg-amber-50/70 p-3.5 text-xs leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200" style={{ animationDelay: '40ms' }} data-yield-list>
          <HardDrive size={15} className="mt-0.5 shrink-0" />
          <p>
            这是离线单文件版：百宝箱不会发起任何网络请求。回声洞在离线版里只回响你保存在这台
            设备上的句子，不会读取 GitHub Discussions，也不会请求 hitokoto 一言。
          </p>
        </div>
      )}

      <div className="mt-10 grid gap-5 sm:grid-cols-2" data-yield-list>
        {TOOLS.map((tool, i) => (
          <Link
            key={tool.id}
            to={tool.to}
            className="card group animate-fade-up p-6 transition duration-200 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl hover:shadow-brand-600/10 dark:hover:border-brand-400/30"
            style={{ animationDelay: `${60 + i * 60}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-indigo-600 text-white shadow-lg shadow-brand-600/25 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
                <tool.icon size={22} />
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
                <Sparkles size={11} />
                {OFFLINE ? '本机可用' : '点开即玩'}
              </span>
            </div>

            <h2 className="mt-4 font-serif text-xl font-bold tracking-tight text-ink-900 transition group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-300">
              {tool.name}
            </h2>
            <p className="mt-1 text-sm font-medium text-brand-600 dark:text-brand-300">{tool.tagline}</p>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{tool.description}</p>

            <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-ink-200/60 pt-4 dark:border-white/10">
              <Database size={12} className="text-ink-400" />
              {tool.sources.map((source) => (
                <span key={source} className="chip !py-0.5 text-[11px]">
                  {source}
                </span>
              ))}
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-400 transition group-hover:text-brand-600 dark:group-hover:text-brand-300">
                进入
                <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
