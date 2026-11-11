import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react'
import { useTheme } from '../lib/theme'
import { FLIGHT, PHASE_LABELS, toFeet, toKnots, type FlightState } from '../lib/landing/flight'
import type { CameraMode, FrameInfo, LandingController } from '../lib/landing/scene'

type Status = 'loading' | 'ready' | 'unsupported' | 'error'

const CAMERAS: Array<{ id: CameraMode; label: string }> = [
  { id: 'auto', label: '导演' },
  { id: 'chase', label: '尾随' },
  { id: 'side', label: '侧面' },
  { id: 'tower', label: '塔台' },
  { id: 'cockpit', label: '驾驶舱' },
  { id: 'free', label: '自由' },
]

const SPEEDS = [0.5, 1, 2]

const MARKERS = [
  { t: FLIGHT.flareStart, label: '拉平' },
  { t: FLIGHT.touchdown, label: '接地' },
  { t: FLIGHT.noseTouchdown, label: '前轮' },
]

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function hasWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

function formatTime(t: number): string {
  return `${t.toFixed(1).padStart(4, '0')}s`
}

export default function PlaneLanding() {
  const { theme, colorThemeMeta } = useTheme()
  const accent = colorThemeMeta.swatch[1]

  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<LandingController | null>(null)
  // HUD 每帧都在变：直接写 DOM，不走 React 状态，避免每秒 60 次重渲染
  const phaseRef = useRef<HTMLSpanElement>(null)
  const shotRef = useRef<HTMLSpanElement>(null)
  const altRef = useRef<HTMLSpanElement>(null)
  const speedRef = useRef<HTMLSpanElement>(null)
  const sinkRef = useRef<HTMLSpanElement>(null)
  const fadeRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const scrubbingRef = useRef(false)
  const initialRef = useRef({ night: theme === 'dark', accent })

  const [status, setStatus] = useState<Status>('loading')
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [camera, setCamera] = useState<CameraMode>('auto')
  const [speed, setSpeed] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const cameraRef = useRef<CameraMode>('auto')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!hasWebGL2()) {
      setStatus('unsupported')
      return
    }
    let cancelled = false
    let controller: LandingController | null = null
    const reduced = prefersReducedMotion()

    const onFrame = (state: FlightState, info: FrameInfo) => {
      if (phaseRef.current) phaseRef.current.textContent = PHASE_LABELS[state.phase]
      if (shotRef.current) shotRef.current.textContent = info.shot
      if (altRef.current) altRef.current.textContent = String(Math.round(toFeet(state.h)))
      if (speedRef.current) speedRef.current.textContent = String(Math.round(toKnots(state.speed)))
      if (sinkRef.current) sinkRef.current.textContent = String(Math.round((toFeet(state.verticalSpeed) * 60) / 10) * 10)
      if (fadeRef.current) fadeRef.current.style.opacity = String(info.fade)
      if (clockRef.current) clockRef.current.textContent = formatTime(state.t)
      if (sliderRef.current && !scrubbingRef.current) sliderRef.current.value = String(state.t)
    }

    import('../lib/landing/scene')
      .then(({ createLandingScene }) => {
        if (cancelled) return
        controller = createLandingScene({
          canvas,
          night: initialRef.current.night,
          accent: initialRef.current.accent,
          // 系统开启「减少动态效果」：停在拉平的那一帧，由用户决定是否播放
          autoplay: !reduced,
          startTime: reduced ? 14.6 : 0,
          onFrame,
          onPlayingChange: setPlaying,
          onContextLost: () => setStatus('error'),
        })
        controller.setCamera(cameraRef.current)
        controllerRef.current = controller
        setStatus('ready')
      })
      .catch((error) => {
        console.error('[landing] 场景初始化失败', error)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      controller?.dispose()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    initialRef.current.night = theme === 'dark'
    controllerRef.current?.setNight(theme === 'dark')
  }, [theme])

  useEffect(() => {
    initialRef.current.accent = accent
    controllerRef.current?.setAccent(accent)
  }, [accent])

  useEffect(() => {
    cameraRef.current = camera
    controllerRef.current?.setCamera(camera)
  }, [camera])

  useEffect(() => {
    controllerRef.current?.setSpeed(speed)
  }, [speed])

  const togglePlay = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return
    if (controller.isPlaying()) controller.pause()
    else controller.play()
  }, [])

  const restart = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setTime(0)
    controller.play()
  }, [])

  const seekBy = useCallback((delta: number) => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setTime(Math.max(0, Math.min(FLIGHT.duration - 0.01, controller.getTime() + delta)))
  }, [])

  // 拖动画面 = 进入自由视角并环视；自由视角下滚轮缩放
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let moved = 0
    let lastX = 0
    let lastY = 0
    const down = (e: PointerEvent) => {
      dragging = true
      moved = 0
      lastX = e.clientX
      lastY = e.clientY
      canvas.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      if (moved < 6) return
      if (cameraRef.current !== 'free') setCamera('free')
      controllerRef.current?.orbit(dx, dy)
    }
    const up = (e: PointerEvent) => {
      dragging = false
      canvas.releasePointerCapture?.(e.pointerId)
    }
    const wheel = (e: WheelEvent) => {
      if (cameraRef.current !== 'free') return // 其他机位不拦截页面滚动
      e.preventDefault()
      controllerRef.current?.zoom(Math.exp(e.deltaY * 0.0012))
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void frame.requestFullscreen?.().catch(() => {})
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekBy(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekBy(1)
      }
    },
    [seekBy, togglePlay],
  )

  const ready = status === 'ready'
  const chip = (active: boolean) =>
    `chip cursor-pointer ${active ? '!border-brand-400 !text-brand-700 dark:!text-brand-200' : ''}`

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
          降落
        </h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
          一架客机沿 3° 下滑道进近、拉平、主轮接地、放下机头、打开扰流板与反推减速——32 秒的实时 3D 动画，可以换机位、拖进度、变速。
        </p>
      </header>

      <div
        ref={frameRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-landing-frame
        className={`card mt-8 flex animate-fade-up flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 ${
          fullscreen ? '!rounded-none !border-0 bg-ink-950' : ''
        }`}
        style={{ animationDelay: '60ms' }}
      >
        <div className={`relative bg-ink-950 ${fullscreen ? 'min-h-0 flex-1' : 'aspect-video'}`}>
          <canvas
            ref={canvasRef}
            className={`absolute inset-0 h-full w-full touch-pan-y ${camera === 'free' ? 'cursor-grab active:cursor-grabbing' : ''}`}
            aria-label="飞机降落的 3D 动画"
            role="img"
          />

          {/* 循环首尾的黑场 */}
          <div ref={fadeRef} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: ready ? 0 : 1 }} />

          {ready && (
            <>
              <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5 sm:left-4 sm:top-4">
                <span
                  ref={phaseRef}
                  className="rounded-full bg-black/45 px-3 py-1 text-xs font-medium tracking-wide text-white backdrop-blur-sm sm:text-sm"
                />
                <span ref={shotRef} className="rounded-full bg-black/30 px-2.5 py-0.5 text-[11px] text-white/80 backdrop-blur-sm" />
              </div>
              <dl className="pointer-events-none absolute right-3 top-3 grid grid-cols-3 gap-x-4 rounded-xl bg-black/40 px-3 py-2 text-right font-mono text-white backdrop-blur-sm sm:right-4 sm:top-4 sm:gap-x-5">
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/60">高度 ft</dt>
                  <dd className="text-sm tabular-nums sm:text-base">
                    <span ref={altRef}>0</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/60">地速 kt</dt>
                  <dd className="text-sm tabular-nums sm:text-base">
                    <span ref={speedRef}>0</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/60">升降 fpm</dt>
                  <dd className="text-sm tabular-nums sm:text-base">
                    <span ref={sinkRef}>0</span>
                  </dd>
                </div>
              </dl>
            </>
          )}

          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-white/70">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
              正在搭建机场…
            </div>
          )}
          {(status === 'unsupported' || status === 'error') && (
            <div
              data-landing-fallback
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/75"
            >
              <p className="text-base font-medium text-white">
                {status === 'unsupported' ? '当前浏览器不支持 WebGL 2，无法播放 3D 动画' : '3D 场景加载失败'}
              </p>
              <p>
                {status === 'unsupported'
                  ? '请换用较新的 Chrome、Edge、Firefox 或 Safari，并确认没有关闭硬件加速。'
                  : '显卡上下文可能被系统回收了，刷新页面即可重试。'}
              </p>
            </div>
          )}
        </div>

        <div className={`space-y-3 border-t border-ink-200/70 px-4 py-3 dark:border-white/10 ${fullscreen ? 'bg-white dark:bg-ink-900' : ''}`}>
          {/* 窄屏时进度条独占一行（否则只剩一百来像素，三个刻度文字会叠在一起） */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!ready}
              className="btn-primary h-9 w-9 shrink-0 !px-0"
              aria-label={playing ? '暂停' : '播放'}
              title={playing ? '暂停（空格）' : '播放（空格）'}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              type="button"
              onClick={restart}
              disabled={!ready}
              className="btn-ghost h-9 w-9 shrink-0 !px-0"
              aria-label="从头播放"
              title="从头播放"
            >
              <RotateCcw size={16} />
            </button>
            <div className="relative order-last w-full min-w-0 pb-4 sm:order-none sm:w-auto sm:flex-1">
              <input
                ref={sliderRef}
                type="range"
                min={0}
                max={FLIGHT.duration}
                step={0.01}
                defaultValue={0}
                disabled={!ready}
                aria-label="进度"
                className="block w-full cursor-pointer accent-brand-500"
                onPointerDown={() => {
                  scrubbingRef.current = true
                }}
                onPointerUp={() => {
                  scrubbingRef.current = false
                }}
                onPointerCancel={() => {
                  scrubbingRef.current = false
                }}
                onInput={(e) => controllerRef.current?.setTime(Number((e.target as HTMLInputElement).value))}
              />
              {MARKERS.map((marker) => (
                <span
                  key={marker.label}
                  className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-[10px] leading-none text-ink-400"
                  style={{ left: `${(marker.t / FLIGHT.duration) * 100}%` }}
                >
                  {marker.label}
                </span>
              ))}
            </div>
            <span
              ref={clockRef}
              data-landing-clock
              className="ml-auto w-12 shrink-0 text-right font-mono text-xs tabular-nums text-ink-500 sm:ml-0 dark:text-ink-400"
            >
              00.0s
            </span>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="btn-ghost h-9 w-9 shrink-0 !px-0"
              aria-label={fullscreen ? '退出全屏' : '全屏'}
              title={fullscreen ? '退出全屏' : '全屏'}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="机位">
              <span className="text-xs text-ink-400">机位</span>
              {CAMERAS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCamera(item.id)}
                  aria-pressed={camera === item.id}
                  className={chip(camera === item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="播放速度">
              <span className="text-xs text-ink-400">速度</span>
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSpeed(value)}
                  aria-pressed={speed === value}
                  className={chip(speed === value)}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ul className="mt-6 animate-fade-up space-y-1.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400" style={{ animationDelay: '120ms' }}>
        <li>· 在画面上拖动即可进入自由视角环视飞机，滚轮缩放；空格播放 / 暂停，← → 逐秒前后跳。</li>
        <li>· 飞机、跑道标线、助航灯光、航站楼与远山全部由代码生成，没有加载任何模型或贴图文件，离线版同样可用。</li>
        <li>· 深色模式是夜航：进近灯的顺序闪光、PAPI、舷窗与着陆灯都会亮起；机身涂装跟随配色主题。</li>
      </ul>
    </div>
  )
}
