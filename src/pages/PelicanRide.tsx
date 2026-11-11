import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Pause, Play } from 'lucide-react'
import { useTheme } from '../lib/theme'
// 整个动画就是这一个自包含的 SVG 文件（样式与关键帧都写在文件里），这里只是把它内联进页面。
// 内联而不是 <img>：这样围巾能跟随配色主题、夜景能跟随深色模式，也方便暂停与变速。
import pelicanSvg from '/src/assets/pelican-bicycle.svg?raw'

type SceneMode = 'auto' | 'day' | 'night'

const SCENES: Array<{ id: SceneMode; label: string }> = [
  { id: 'auto', label: '跟随站点' },
  { id: 'day', label: '白昼' },
  { id: 'night', label: '夜晚' },
]

const SPEEDS = [0.5, 1, 2]

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export default function PelicanRide() {
  const { theme } = useTheme()
  const stageRef = useRef<HTMLDivElement>(null)
  // 系统开启「减少动态效果」时默认停在第一帧，由用户自己决定是否播放
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [speed, setSpeed] = useState(1)
  const [scene, setScene] = useState<SceneMode>('auto')

  const isNight = scene === 'night' || (scene === 'auto' && theme === 'dark')

  useEffect(() => {
    const svg = stageRef.current?.querySelector('svg')
    if (!svg) return
    svg.classList.toggle('pb-paused', !playing)
    svg.classList.toggle('pb-night', scene === 'night')
    svg.classList.toggle('pb-day', scene === 'day')
  }, [playing, scene])

  useEffect(() => {
    const svg = stageRef.current?.querySelector('svg')
    // Web Animations API：直接改播放速率，所有图层同步变速且不会跳帧
    const animations = svg?.getAnimations?.({ subtree: true }) ?? []
    for (const animation of animations) animation.playbackRate = speed
  }, [speed])

  const download = useCallback(() => {
    // 导出的独立文件里没有站点的 CSS 变量，把当前的围巾颜色与昼夜写死进去，所见即所得
    const style = getComputedStyle(document.documentElement)
    const vars = ['--brand-500', '--brand-700']
      .map((name) => [name, style.getPropertyValue(name).trim()] as const)
      .filter(([, value]) => /^\d+\s+\d+\s+\d+$/.test(value))
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ')
    const rootClass = `pb-root ${isNight ? 'pb-night' : 'pb-day'}`
    const source = pelicanSvg.replace(
      'class="pb-root"',
      `class="${rootClass}"${vars ? ` style="${vars}"` : ''}`,
    )
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pelican-bicycle.svg'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [isNight])

  return (
    <div className="container-page max-w-5xl pt-16" data-yield-list>
      <header className="animate-fade-up">
        <Link
          to="/toolbox"
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300"
        >
          <ArrowLeft size={15} />
          百宝箱
        </Link>
        <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          鹈鹕骑车
        </h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
          一只系着围巾的鹈鹕沿海滨公路蹬车兜风，车筐里的鱼看起来不太放心。纯 SVG + CSS，没有一行脚本。
        </p>
      </header>

      <div className="card mt-8 animate-fade-up overflow-hidden" style={{ animationDelay: '60ms' }}>
        <div
          ref={stageRef}
          data-pelican-stage
          className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: pelicanSvg }}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-ink-200/70 px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="btn-primary h-9"
            aria-pressed={!playing}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? '暂停' : '播放'}
          </button>

          <div className="flex items-center gap-1.5" role="group" aria-label="播放速度">
            <span className="text-xs text-ink-400">速度</span>
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSpeed(value)}
                aria-pressed={speed === value}
                className={`chip cursor-pointer ${speed === value ? '!border-brand-400 !text-brand-700 dark:!text-brand-200' : ''}`}
              >
                {value}×
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5" role="group" aria-label="场景">
            <span className="text-xs text-ink-400">场景</span>
            {SCENES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScene(item.id)}
                aria-pressed={scene === item.id}
                className={`chip cursor-pointer ${scene === item.id ? '!border-brand-400 !text-brand-700 dark:!text-brand-200' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button type="button" onClick={download} className="btn-outline ml-auto h-9">
            <Download size={15} />
            下载 SVG
          </button>
        </div>
      </div>

      <ul className="mt-6 animate-fade-up space-y-1.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400" style={{ animationDelay: '120ms' }}>
        <li>· 腿是真的踩在脚踏上的：大腿、小腿、脚掌的角度由反向运动学离线解算成关键帧。</li>
        <li>· 车轮转速与路面后退速度严格匹配（轮周长 = 每圈路面位移），轮胎不打滑；棕榈、远山、云按远近分层滚动。</li>
        <li>· 围巾颜色跟随配色主题，深色模式自动切到夜景（车灯、路灯、灯塔会亮）；下载的文件可独立使用。</li>
      </ul>
    </div>
  )
}
