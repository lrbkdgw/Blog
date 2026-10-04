import { useCallback, useEffect, useState } from 'react'
import { getAllPosts, getAllPostsFlat, getPublishedPosts } from './posts'
import type { Post } from './types'

function usePostsSource(read: () => Post[]): [Post[], () => void] {
  const [posts, setPosts] = useState<Post[]>(read)
  const refresh = useCallback(() => setPosts(read()), [read])

  useEffect(() => {
    refresh()
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

/** 订阅文章数据（本地草稿变更后自动刷新） */
export function usePosts(includeDrafts = false): [Post[], () => void] {
  return usePostsSource(
    useCallback(() => (includeDrafts ? getAllPosts() : getPublishedPosts()), [includeDrafts]),
  )
}

/**
 * 管理页数据源（issue #8）：仓库文章与本地草稿同名时保留两份，
 * 便于区分「已发布」与「本地草稿」两个状态。
 */
export function useAdminPosts(): [Post[], () => void] {
  return usePostsSource(useCallback(() => getAllPostsFlat(), []))
}
