import type { Post } from '../lib/types'
import { BentoGrid } from './magicui/bento-grid'
import { PostCard } from './PostCard'

/** Alternating 2:1 / 1:2 rows. An unpaired final article fills the row, without changing post order. */
export function PostGrid({ posts, className }: { posts: Post[]; className?: string }) {
  return <BentoGrid className={className}>
    {posts.map((post, index) => {
      const single = index === posts.length - 1 && posts.length % 2 === 1
      const wide = index % 4 === 0 || index % 4 === 3
      return <PostCard key={post.slug} post={post} index={index} className={single ? 'sm:col-span-2 lg:col-span-3' : wide ? 'lg:col-span-2' : ''} wide={single || wide} />
    })}
  </BentoGrid>
}
