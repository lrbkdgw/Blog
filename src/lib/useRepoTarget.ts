import { useEffect, useState } from 'react'
import { getRepoTarget } from './github'
import type { RepoTarget } from './github'

/**
 * 订阅仓库目标配置：对象引用保持稳定（避免 useEffect 依赖抖动），
 * 在「设置」里修改仓库配置后自动刷新。
 */
export function useRepoTarget(): RepoTarget {
  const [target, setTarget] = useState<RepoTarget>(() => getRepoTarget())
  useEffect(() => {
    const handler = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name
      if (!name || name === 'repository') setTarget(getRepoTarget())
    }
    window.addEventListener('starlog:settings-changed', handler)
    return () => window.removeEventListener('starlog:settings-changed', handler)
  }, [])
  return target
}
