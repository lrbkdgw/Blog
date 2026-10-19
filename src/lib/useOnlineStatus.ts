import { useEffect, useState } from 'react'
import { hasNetwork } from './runtime'

/** 订阅浏览器联网状态：离线版用它提示「当前离线，导入到线上需要联网」 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(hasNetwork)
  useEffect(() => {
    const update = () => setOnline(hasNetwork())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
