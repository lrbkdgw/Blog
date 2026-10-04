import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Home, RefreshCw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * 全局兜底（issue #13 防护）：任何页面渲染异常都不应该让整个站点
 * 变成一片空白的「卡死」状态，而是给出可操作的错误界面。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[starlog] 页面渲染出错：', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="container-page flex min-h-[70vh] flex-col items-center justify-center gap-4 py-20 text-center">
        <TriangleAlert size={40} className="text-amber-500" />
        <h1 className="font-serif text-2xl font-semibold text-ink-900 dark:text-white">页面出了点小问题</h1>
        <p className="max-w-md break-all text-sm leading-relaxed text-ink-500">
          {error.message || '未知错误'}。通常是版本更新导致的资源过时，刷新一次就能解决。
        </p>
        <div className="mt-2 flex gap-3">
          <button onClick={() => window.location.reload()} className="btn-primary h-10">
            <RefreshCw size={15} />
            刷新页面
          </button>
          <Link to="/" onClick={this.reset} className="btn-outline h-10">
            <Home size={15} />
            回到首页
          </Link>
        </div>
      </div>
    )
  }
}
