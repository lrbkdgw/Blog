import { useCallback, useEffect, useState } from 'react'
import { getAllPosts, getPublishedPosts } from './posts'
import type { Post } from './types'

/** 订阅文章数据（本地草稿变更后自动刷新） */
export function usePosts(includeDrafts = false): [Post[], () => void] {
  const read = useCallback(
    () => (includeDrafts ? getAllPosts() : getPublishedPosts()),
    [includeDrafts],
  )
  const [posts, setPosts] = useState<Post[]>(read)

  const refresh = useCallback(() => setPosts(read()), [read])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('starlog:posts-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('starlog:posts-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [refresh])

  return [posts, refresh]
}
